import { Resend } from "resend";
import type { AppEnv } from "@/lib/env";
import { requireKey } from "@/lib/env";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { signToken, verifyToken, SUBSCRIBE_TOKEN_MAX_AGE_MS } from "@/lib/tokens";
import { renderConfirmEmail } from "@/lib/email/confirm-email";
import { TIMEZONES } from "@/lib/time";
import { geoCellKey } from "@/lib/geo-cell";
import { geocodePostalCode } from "@/lib/geocode";
import type { City, Genre } from "@/lib/db";
import { placeLabel } from "@/lib/places";

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

/**
 * Ceiling on genres in one request.
 *
 * Above the 22 rows seed-genres.ts creates, because /explore's subscribe button sends
 * every genre when the reader filtered by none — which is what "email me this" means
 * when what they were shown was everything. A cap of 20 silently dropped two.
 */
const MAX_GENRES = 40;

/** Project-wide daily cap on confirmation emails. */
const DAILY_CONFIRM_BUDGET = 200;
const USAGE_KIND = "anon_subscribe_email";

export type RequestOutcome =
  | { status: "sent" }
  /** Address already has an account. Reported to the caller, never to the browser. */
  | { status: "already_subscribed" }
  | { status: "rate_limited"; reason: string }
  | { status: "invalid"; reason: string };

/**
 * Where a subscription will be centred, resolved from whatever the caller named it by.
 *
 * A point rather than a city, because /explore searches by point — and its subscribe
 * button promises "email me *this*", which has to mean the place that was searched even
 * when that place is one of the 32,329 Census towns rather than one of the 43 curated
 * metros. `cityId` stays set when there is one, so the city grid still shows it.
 */
export type SubscribePlace = {
  cityId: number | null;
  name: string;
  stateCode: string | null;
  latitude: number;
  longitude: number;
};

export async function requestSubscription(
  env: AppEnv,
  input: {
    email: string;
    citySlug: string | null;
    /** Census GEOID from the town typeahead. */
    placeGeoid?: string | null;
    /** Used when the search above was by ZIP. Re-resolved here, never trusted as a point. */
    postalCode?: string | null;
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

  // Resolved before the budget is spent, so a request naming a place or a genre we
  // cannot resolve does not eat one of the day's 200 confirmations.
  const place = await resolvePlace(supabase, input);
  const genres = await findGenres(supabase, input.genreIds);

  // Both of these are the same failure: a subscription that confirms cleanly and then
  // produces nothing. Without a point the planner has nowhere to search, and without a
  // genre buildDigest filters everything out — so either one would mean an account that
  // gets silence every Wednesday. The Zod schema cannot catch them: it sees a non-empty
  // array and a well-shaped ZIP, not whether they name anything that exists here.
  if (!place) {
    return {
      status: "invalid",
      reason: "We could not find that place. Pick one from the list.",
    };
  }
  if (genres.length === 0) {
    return {
      status: "invalid",
      reason: "Pick at least one genre — that's what the email filters on.",
    };
  }

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
        city_id: place.cityId,
        place_name: place.name,
        state_code: place.stateCode,
        latitude: place.latitude,
        longitude: place.longitude,
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
    cityName: placeLabel(place.name, place.stateCode),
    genreNames: genres.map((genre) => genre.name),
    siteUrl: env.siteUrl,
  });

  const { error: sendError } = await resend.emails.send({
    from: requireKey(env.emailFrom, "EMAIL_FROM", "sending the confirmation"),
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
    .select(
      "id, email, city_id, place_name, state_code, latitude, longitude, genre_ids, timezone, expires_at",
    )
    .eq("id", verified.userId)
    .maybeSingle<{
      id: string;
      email: string;
      city_id: number | null;
      place_name: string | null;
      state_code: string | null;
      latitude: number | null;
      longitude: number | null;
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

  // The point was resolved when the request was made (see resolvePlace), so it is
  // copied straight in — a subscription has been a point since 0014, and a row without
  // one is unusable because the planner searches by point and radius.
  //
  // The city fallback is for rows written before 0016, which hold a city_id and no
  // coordinates. Those expire within a week, but a confirmation already in someone's
  // inbox must not turn into a subscription to nowhere.
  const point =
    pending.latitude != null && pending.longitude != null
      ? {
          cityId: pending.city_id,
          name: pending.place_name ?? "",
          stateCode: pending.state_code,
          latitude: Number(pending.latitude),
          longitude: Number(pending.longitude),
        }
      : await legacyCityPoint(supabase, pending.city_id);

  if (point) {
    await supabase.from("subscriptions").upsert(
      {
        user_id: userId,
        city_id: point.cityId,
        latitude: point.latitude,
        longitude: point.longitude,
        place_name: point.name,
        state_code: point.stateCode,
        geo_cell: geoCellKey(point.latitude, point.longitude),
      },
      { onConflict: "user_id,latitude,longitude", ignoreDuplicates: true },
    );
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

  return {
    status: "confirmed",
    email: pending.email,
    cityName: point?.name || null,
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

/**
 * The point to subscribe to, from whichever way the caller named it.
 *
 * Every branch resolves against our own data — `cities` by slug, `places` by GEOID,
 * `postal_codes` (via the cached geocoder) by ZIP. A browser can therefore choose any
 * real US place but cannot invent coordinates, which matters because each distinct grid
 * cell costs one Ticketmaster query per week out of a 5000/day project-wide quota.
 *
 * First match wins, in the order the UI offers them.
 */
async function resolvePlace(
  supabase: AdminClient,
  input: {
    citySlug: string | null;
    placeGeoid?: string | null;
    postalCode?: string | null;
  },
): Promise<SubscribePlace | null> {
  if (input.citySlug) {
    const { data } = await supabase
      .from("cities")
      .select("id, name, state_code, latitude, longitude")
      .eq("slug", input.citySlug)
      .maybeSingle<
        Pick<City, "id" | "name" | "state_code" | "latitude" | "longitude">
      >();
    if (data?.latitude != null && data.longitude != null) {
      return {
        cityId: data.id,
        name: data.name,
        stateCode: data.state_code,
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
      };
    }
  }

  if (input.placeGeoid && /^\d{2,10}$/.test(input.placeGeoid)) {
    const { data } = await supabase
      .from("places")
      .select("name, state_code, latitude, longitude")
      .eq("geoid", input.placeGeoid)
      .maybeSingle<{
        name: string;
        state_code: string | null;
        latitude: number;
        longitude: number;
      }>();
    if (data) {
      return {
        cityId: null,
        name: data.name,
        stateCode: data.state_code,
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
      };
    }
  }

  if (input.postalCode) {
    const point = await geocodePostalCode(supabase, input.postalCode);
    if (point) {
      return {
        cityId: null,
        name: point.placeName ?? input.postalCode,
        stateCode: point.stateCode,
        latitude: point.latitude,
        longitude: point.longitude,
      };
    }
  }

  return null;
}

/** A pre-0016 pending row's city, as a point. See the call site for why this remains. */
async function legacyCityPoint(
  supabase: AdminClient,
  cityId: number | null,
): Promise<SubscribePlace | null> {
  if (!cityId) return null;

  const { data } = await supabase
    .from("cities")
    .select("id, name, state_code, latitude, longitude")
    .eq("id", cityId)
    .maybeSingle<
      Pick<City, "id" | "name" | "state_code" | "latitude" | "longitude">
    >();

  if (!data || data.latitude == null || data.longitude == null) return null;
  return {
    cityId: data.id,
    name: data.name,
    stateCode: data.state_code,
    latitude: Number(data.latitude),
    longitude: Number(data.longitude),
  };
}

async function findGenres(
  supabase: AdminClient,
  ids: number[],
): Promise<Pick<Genre, "id" | "name">[]> {
  // Above the 22 genres Ticketmaster publishes, so "every genre" fits. See MAX_GENRES.
  const wanted = ids.filter(Number.isInteger).slice(0, MAX_GENRES);
  if (wanted.length === 0) return [];
  const { data } = await supabase
    .from("genres")
    .select("id, name")
    .in("id", wanted);
  return (data ?? []) as Pick<Genre, "id" | "name">[];
}
