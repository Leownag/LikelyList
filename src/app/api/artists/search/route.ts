import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { readEnv } from "@/lib/env";
import { createTicketmasterClient } from "@/lib/ticketmaster/client";
import { searchAttractions } from "@/lib/ticketmaster/attractions";
import { primaryClassification, pickImage } from "@/lib/ticketmaster/lineup";
import { localDateString } from "@/lib/time";
import { USAGE_ARTIST_SEARCH, type Profile } from "@/lib/db";
import { AppError, ErrorCode, errors } from "@/lib/errors";
import { errorResponse } from "@/lib/api-error";

/**
 * Artist lookup for the follow box on /app/subscriptions.
 *
 * Screenshots were the only way to follow an artist, which is backwards for the
 * one thing this audience most wants to say: "I missed this band, tell me next
 * time." Typing a name is the direct expression of that, and it needs no vision
 * model and no quota beyond one Ticketmaster call.
 *
 * Resolving against Ticketmaster rather than storing the raw string is what makes
 * the follow actually work: digest matching is done on `normalized_name` against
 * the names Ticketmaster puts in event lineups, so a name the API has never heard
 * of would be a follow that can never match anything.
 */

const BodySchema = z.object({
  query: z.string().min(2, "Type at least two characters.").max(120),
});

/** Enough to disambiguate a tribute act from the real one; short enough to scan. */
const MAX_RESULTS = 8;

export async function POST(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) throw errors.notSignedIn();

    const env = readEnv();
    if (!env.ticketmasterApiKey) {
      throw errors.notConfigured(
        "Artist search",
        "TICKETMASTER_API_KEY is not set",
      );
    }

    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(await request.json());
    } catch (cause) {
      throw errors.badRequest(
        cause instanceof z.ZodError
          ? (cause.issues[0]?.message ?? "Check your search.")
          : "Check your search.",
        cause instanceof Error ? cause.message : String(cause),
      );
    }

    const supabase = await createClient();

    const { data: profile } = await supabase
      .from("profiles")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle<Pick<Profile, "timezone">>();

    // Counted against the user's own day, matching the feed uploader, so "resets
    // at midnight" means the midnight they actually experience.
    const today = localDateString(profile?.timezone ?? "UTC", new Date());
    const { data: usedToday, error: quotaError } = await supabase.rpc("bump_usage", {
      p_user_id: user.id,
      p_kind: USAGE_ARTIST_SEARCH,
      p_day: today,
      p_amount: 1,
    });

    if (quotaError) {
      throw new AppError({
        code: ErrorCode.INTERNAL,
        status: 500,
        userMessage: "We couldn't check your daily limit. Please try again.",
        detail: quotaError.message,
      });
    }
    if (
      typeof usedToday === "number" &&
      usedToday > env.artistDailySearchLimit
    ) {
      throw new AppError({
        code: ErrorCode.SEARCH_DAILY_LIMIT,
        status: 429,
        userMessage: `You've used all ${env.artistDailySearchLimit} artist searches for today. It resets at midnight in your timezone.`,
        detail: `used ${usedToday}`,
      });
    }

    let results;
    try {
      results = await searchAttractions(
        createTicketmasterClient(env.ticketmasterApiKey),
        body.query,
        MAX_RESULTS,
      );
    } catch (cause) {
      throw new AppError({
        code: ErrorCode.SEARCH_FAILED,
        status: 502,
        userMessage: "Ticketmaster didn't answer. Try that again in a moment.",
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    }

    return NextResponse.json({
      artists: results.slice(0, MAX_RESULTS).map((attraction) => ({
        tmAttractionId: attraction.id,
        name: attraction.name,
        imageUrl: pickImage(attraction.images, { maxWidth: 320, ratio: "3_2" }),
        tmGenreId: primaryClassification(attraction).genreId,
      })),
    });
  } catch (error) {
    return errorResponse(request, error);
  }
}
