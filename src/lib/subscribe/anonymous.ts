import { Resend } from "resend";
import type { AppEnv } from "@/lib/env";
import { requireKey } from "@/lib/env";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { signToken, verifyToken, SUBSCRIBE_TOKEN_MAX_AGE_MS } from "@/lib/tokens";
import { renderConfirmEmail } from "@/lib/email/confirm-email";
import { TIMEZONES } from "@/lib/time";
import { geoCellKey } from "@/lib/geo-cell";
import type { City, Genre } from "@/lib/db";

/**
 * Subscribing without an account, safely.
 *
 * The rule this whole module exists to enforce: an address is never added to the
 * send list until someone holding that mailbox clicks a link. Writing an
 * unverified address straight in would turn the landing page into a way to mail
 * strangers weekly, from our own verified domain.
 *
 * The other rule is that this must not create a second delivery path. Confirming
 * creates an ordinary Supabase auth user; the digest pipeline reads subscribers
 * only from `profiles`; auth.users enforces one row per address. So an address can
 * hold at most one subscription no matter how it arrived, and signing up "properly"
 * later resolves to the same account rather than a duplicate.
 */

/** Deliberately loose — real validation is that the confirmation link is clicked. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@,]+\.[^\s@,]{2,}$/;

/** Cap on confirmation emails per address, so this cannot be used to pester one. */
const MAX_CONFIRMS_PER_ADDRESS = 3;

/** Project-wide daily cap on confirmation emails. */
const DAILY_CONFIRM_BUDGET = 200;
const USAGE_KIND = "anon_subscribe_email";

export type RequestOutcome =
  | { status: "sent" }
  /** Address already has an account. Reported to the caller, never to the browser. */
  | { status: "already_subscribed" }
  | { status: "rate_limited"; reason: string }
  | { status: "invalid"; reason: string };

export async function requestSubscription(
  env: AppEnv,
  input: {
    email: string;
    citySlug: string | null;
    genreIds: number[];
    timezone: string;
  },
): Promise<RequestOutcome> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return { status: "invalid", reason: "That doesn't look like an email address." };
  }

  const supabase = createAdminClient(env);

  // An address that already has an account is already subscribed, so there is
  // nothing to do — and crucially nothing is sent. Emailing "you already have an
  // account" would let anyone use this endpoint to repeatedly poke a stranger's
  // inbox, and would confirm to a stranger that the address is registered here.
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle<{ id: string }>();
  if (existing) return { status: "already_subscribed" };

  const day = new Date().toISOString().slice(0, 10);
  const { data: sentToday } = await supabase.rpc("bump_global_usage", {
    p_kind: USAGE_KIND,
    p_day: day,
    p_amount: 1,
  });
  if (typeof sentToday === "number" && sentToday > DAILY_CONFIRM_BUDGET) {
    return {
      status: "rate_limited",
      reason: "Too many signups today. Try again tomorrow.",
    };
  }

  const city = input.citySlug
    ? await findCity(supabase, input.citySlug)
    : null;
  const genres = await findGenres(supabase, input.genreIds);
  const timezone = TIMEZONES.includes(input.timezone as (typeof TIMEZONES)[number])
    ? input.timezone
    : "America/New_York";

  // Upsert on email: resubmitting replaces the previous request rather than
  // stacking rows, and carries the confirmation count forward.
  const { data: pending, error } = await supabase
    .from("pending_subscriptions")
    .upsert(
      {
        email,
        city_id: city?.id ?? null,
        genre_ids: genres.map((genre) => genre.id),
        timezone,
      },
      { onConflict: "email" },
    )
    .select("id, confirm_count")
    .single<{ id: string; confirm_count: number }>();

  if (error || !pending) {
    return {
      status: "rate_limited",
      reason: "Could not record that request. Try again shortly.",
    };
  }

  if (pending.confirm_count >= MAX_CONFIRMS_PER_ADDRESS) {
    // Silently stop. From the browser's point of view this is indistinguishable
    // from success, which is the point.
    return { status: "sent" };
  }

  const token = await signToken(
    env.unsubscribeHmacSecret,
    "subscribe",
    pending.id,
  );
  const confirmUrl = `${env.siteUrl}/subscribe/confirm?t=${token}`;

  const resend = new Resend(
    requireKey(env.resendApiKey, "RESEND_API_KEY", "sending the confirmation"),
  );

  const message = await renderConfirmEmail({
    confirmUrl,
    cityName: city?.name ?? null,
    genreNames: genres.map((genre) => genre.name),
    siteUrl: env.siteUrl,
  });

  const { error: sendError } = await resend.emails.send({
    from: env.emailFrom,
    to: email,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  if (sendError) {
    return {
      status: "rate_limited",
      reason: "Could not send the confirmation email. Try again shortly.",
    };
  }

  await supabase
    .from("pending_subscriptions")
    .update({
      confirm_count: pending.confirm_count + 1,
      confirm_sent_at: new Date().toISOString(),
    })
    .eq("id", pending.id);

  return { status: "sent" };
}

export type ConfirmOutcome =
  | {
      status: "confirmed";
      email: string;
      cityName: string | null;
      genreCount: number;
      /**
       * A one-shot token that signs this person straight in, or null if minting it
       * failed.
       *
       * They have just proved they hold the mailbox by clicking a link from it,
       * which is exactly the evidence a magic link asks for — so sending them to
       * /login to type the same address and wait for a second email would be asking
       * for the same proof twice. The caller redirects through /auth/callback with
       * this instead.
       */
      signInTokenHash: string | null;
    }
  | { status: "expired" }
  | { status: "invalid" }
  | { status: "error"; reason: string };

/**
 * Turns a confirmed request into a real subscriber.
 *
 * Idempotent in the way that matters: the pending row is deleted at the end, so a
 * second click reports `invalid` rather than creating anything twice, and the
 * subscription writes themselves are upserts.
 */
export async function confirmSubscription(
  env: AppEnv,
  token: string | null,
): Promise<ConfirmOutcome> {
  const verified = await verifyToken(env.unsubscribeHmacSecret, "subscribe", token, {
    maxAgeMs: SUBSCRIBE_TOKEN_MAX_AGE_MS,
  });
  if (!verified) {
    // Distinguish a stale link from a forged one, so the page can say something
    // useful.
    const unexpired = await verifyToken(
      env.unsubscribeHmacSecret,
      "subscribe",
      token,
    );
    return unexpired ? { status: "expired" } : { status: "invalid" };
  }

  const supabase = createAdminClient(env);

  const { data: pending } = await supabase
    .from("pending_subscriptions")
    .select("id, email, city_id, genre_ids, timezone, expires_at")
    .eq("id", verified.userId)
    .maybeSingle<{
      id: string;
      email: string;
      city_id: number | null;
      genre_ids: number[];
      timezone: string;
      expires_at: string;
    }>();

  if (!pending) return { status: "invalid" };
  if (new Date(pending.expires_at).getTime() < Date.now()) {
    return { status: "expired" };
  }

  const userId = await findOrCreateUser(supabase, pending.email);
  if (!userId) {
    return {
      status: "error",
      reason: "Could not create your account. Please try signing up directly.",
    };
  }

  // The trigger on auth.users creates this, but writing it here removes any
  // dependence on trigger timing and sets the timezone in the same statement.
  await supabase.from("profiles").upsert(
    {
      id: userId,
      email: pending.email,
      timezone: pending.timezone,
      digest_enabled: true,
    },
    { onConflict: "id" },
  );

  if (pending.city_id) {
    // Copies the city's coordinates in, because a subscription is a point since 0014.
    // A row without one is unusable: the planner searches by point and radius.
    const city = await findCityById(supabase, pending.city_id);
    if (city && city.latitude != null && city.longitude != null) {
      await supabase.from("subscriptions").upsert(
        {
          user_id: userId,
          city_id: city.id,
          latitude: Number(city.latitude),
          longitude: Number(city.longitude),
          place_name: city.name,
          state_code: city.state_code,
          geo_cell: geoCellKey(Number(city.latitude), Number(city.longitude)),
        },
        { onConflict: "user_id,latitude,longitude", ignoreDuplicates: true },
      );
    }
  }

  const genreIds = pending.genre_ids ?? [];
  if (genreIds.length > 0) {
    await supabase.from("genre_prefs").upsert(
      genreIds.map((genreId) => ({
        user_id: userId,
        genre_id: genreId,
        source: "explicit" as const,
        weight: 1,
      })),
      { onConflict: "user_id,genre_id", ignoreDuplicates: true },
    );
  }

  // The waiting room is emptied last, so a failure above leaves the link usable.
  await supabase.from("pending_subscriptions").delete().eq("id", pending.id);

  const city = pending.city_id
    ? await findCityById(supabase, pending.city_id)
    : null;

  return {
    status: "confirmed",
    email: pending.email,
    cityName: city?.name ?? null,
    genreCount: genreIds.length,
    signInTokenHash: await mintSignInToken(supabase, pending.email),
  };
}

/**
 * A `token_hash` that /auth/callback can verify, minted without sending anything.
 *
 * `generateLink` exists for projects that deliver their own mail: it returns the
 * hashed token and does **not** email anybody, which is the property this depends
 * on — a second message arriving here would be worse than the extra click it
 * replaces.
 *
 * Returns null rather than throwing. Failing to mint a convenience token must not
 * undo a confirmation that has already been written; the caller falls back to the
 * ordinary "go and sign in" page.
 */
async function mintSignInToken(
  supabase: AdminClient,
  email: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (error) return null;
    return data.properties?.hashed_token ?? null;
  } catch {
    return null;
  }
}

/**
 * The auth user for this address, creating one if needed.
 *
 * `email_confirm: true` is correct here and only here: clicking the confirmation
 * link is proof of control of the mailbox, which is the same evidence a magic link
 * asks for. Marking it confirmed is also what lets the account be signed into
 * immediately afterwards without a second round trip to the inbox.
 */
async function findOrCreateUser(
  supabase: AdminClient,
  email: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle<{ id: string }>();
  if (existing) return existing.id;

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) return null;
  return data.user.id;
}

async function findCity(
  supabase: AdminClient,
  slug: string,
): Promise<Pick<City, "id" | "name"> | null> {
  const { data } = await supabase
    .from("cities")
    .select("id, name")
    .eq("slug", slug)
    .maybeSingle<Pick<City, "id" | "name">>();
  return data ?? null;
}

async function findCityById(
  supabase: AdminClient,
  id: number,
): Promise<Pick<
  City,
  "id" | "name" | "state_code" | "latitude" | "longitude"
> | null> {
  const { data } = await supabase
    .from("cities")
    .select("id, name, state_code, latitude, longitude")
    .eq("id", id)
    // Coordinates included since 0014: a subscription stores a point, and without one
    // the planner has nothing to search from.
    .maybeSingle<
      Pick<City, "id" | "name" | "state_code" | "latitude" | "longitude">
    >();
  return data ?? null;
}

async function findGenres(
  supabase: AdminClient,
  ids: number[],
): Promise<Pick<Genre, "id" | "name">[]> {
  const wanted = ids.filter(Number.isInteger).slice(0, 20);
  if (wanted.length === 0) return [];
  const { data } = await supabase
    .from("genres")
    .select("id, name")
    .in("id", wanted);
  return (data ?? []) as Pick<Genre, "id" | "name">[];
}
