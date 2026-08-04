import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { readEnv } from "@/lib/env";
import { createOpenAiVisionProvider } from "@/lib/vision/openai";
import { VisionError } from "@/lib/vision/provider";
import { estimateDataUrlBytes } from "@/lib/vision/preprocess";
import { localDateString } from "@/lib/time";
import { USAGE_FEED_UPLOAD, type Profile } from "@/lib/db";
import { AppError, ErrorCode, errors } from "@/lib/errors";
import { errorResponse } from "@/lib/api-error";

/** Decoded payload ceiling. The client downscales first; this is the backstop. */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

const BodySchema = z.object({
  dataUrl: z.string().regex(DATA_URL_PATTERN, "Expected a base64 image data URL"),
});

/**
 * Reads one pasted or uploaded screenshot.
 *
 * Usually a music app screen — a Spotify home page, a liked-songs list, a
 * top-artists page — from which we learn who the person listens to.
 *
 * The image is never persisted on the happy path. It is held in memory for the
 * length of this request, sent to the extractor, and dropped — only the
 * structured result is stored. If extraction fails the image *is* written to
 * private storage, so a retry does not make the user find the screenshot again.
 *
 * Every failure path goes through errorResponse, so an upstream message never
 * reaches the browser unless the caller is in dev mode.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) throw errors.notSignedIn();

    const env = readEnv();
    if (!env.openaiApiKey) {
      throw errors.notConfigured("Reading screenshots", "OPENAI_API_KEY is not set");
    }

    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(await request.json());
    } catch (cause) {
      throw errors.badRequest(
        "That didn't look like an image we can read. Try a PNG or JPEG screenshot.",
        cause instanceof Error ? cause.message : String(cause),
      );
    }

    const bytes = estimateDataUrlBytes(body.dataUrl);
    if (bytes === 0 || bytes > MAX_IMAGE_BYTES) {
      throw new AppError({
        code: ErrorCode.FEED_IMAGE_TOO_LARGE,
        status: 413,
        userMessage:
          "That image is too large to read. A screenshot rather than a full-resolution photo usually does it.",
        detail: `decoded ${bytes} bytes, limit ${MAX_IMAGE_BYTES}`,
      });
    }

    const supabase = await createClient();

    const { data: profileRow } = await supabase
      .from("profiles")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle<Pick<Profile, "timezone">>();
    const timezone = profileRow?.timezone ?? "America/New_York";

    // Quota. Increment-then-check is deliberate: it is race-free, and the worst
    // case is counting one rejected attempt, which fails safe.
    const today = localDateString(timezone, new Date());
    const { data: usedToday, error: quotaError } = await supabase.rpc("bump_usage", {
      p_user_id: user.id,
      p_kind: USAGE_FEED_UPLOAD,
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
    if (typeof usedToday === "number" && usedToday > env.feedDailyUploadLimit) {
      throw new AppError({
        code: ErrorCode.FEED_DAILY_LIMIT,
        status: 429,
        userMessage: `You've used all ${env.feedDailyUploadLimit} screenshot reads for today. It resets at midnight in your timezone.`,
        detail: `used ${usedToday}`,
      });
    }

    const { data: feed, error: insertError } = await supabase
      .from("feeds")
      .insert({ user_id: user.id, status: "processing" })
      .select("id")
      .single<{ id: string }>();

    if (insertError || !feed) {
      throw new AppError({
        code: ErrorCode.INTERNAL,
        status: 500,
        userMessage: "We couldn't start reading that screenshot. Please try again.",
        detail: insertError?.message,
      });
    }

    const provider = createOpenAiVisionProvider(
      env.openaiApiKey,
      env.openaiVisionModel,
    );

    try {
      const extracted = await provider.extract({ dataUrl: body.dataUrl, today });

      await supabase
        .from("feeds")
        .update({
          status: "done",
          model: provider.model,
          extracted,
          confidence: extracted.overall_confidence,
          not_music_related: extracted.not_music_related,
        })
        .eq("id", feed.id);

      return NextResponse.json({ id: feed.id, extracted });
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : String(cause);
      const retryable = cause instanceof VisionError ? cause.retryable : false;

      // Keep the bytes only because extraction failed, so a retry does not need
      // the user to find the screenshot again.
      const imagePath = await stashForRetry(
        supabase,
        user.id,
        feed.id,
        body.dataUrl,
      );

      await supabase
        .from("feeds")
        .update({
          status: "failed",
          model: provider.model,
          // The raw text is kept on the row for the operator; it is the *response*
          // that is filtered.
          error: raw,
          image_path: imagePath,
        })
        .eq("id", feed.id);

      throw new AppError({
        code: retryable
          ? ErrorCode.FEED_EXTRACTION_BUSY
          : ErrorCode.FEED_EXTRACTION_FAILED,
        status: retryable ? 503 : 502,
        userMessage: retryable
          ? "The image reader is busy right now. Give it a minute and try again — your screenshot is saved."
          : "We couldn't read that screenshot. A clearer shot with artist or song names as text usually works better.",
        detail: raw,
        cause,
      });
    }
  } catch (error) {
    return errorResponse(request, error);
  }
}

async function stashForRetry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  feedId: string,
  dataUrl: string,
): Promise<string | null> {
  try {
    const [header, base64] = dataUrl.split(",");
    const mime = header.slice(5, header.indexOf(";"));
    const extension = mime.split("/")[1] ?? "png";
    // The first path segment is the ownership check in the storage policy.
    const path = `${userId}/${feedId}.${extension}`;

    const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const { error } = await supabase.storage
      .from("feeds")
      .upload(path, binary, { contentType: mime, upsert: true });

    return error ? null : path;
  } catch {
    // Losing the retry copy is not worth failing the request over.
    return null;
  }
}
