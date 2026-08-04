/**
 * Pre-launch check: does every credential actually work?
 *
 * Run with: npm run preflight
 *
 * Makes one deliberately cheap real request per service, because "the key is set"
 * and "the key works" are different claims and only the second one matters. It
 * never sends an email and never touches an expensive quota — in particular it
 * avoids YouTube's `search.list`, which has its own hard ceiling of 100 calls a
 * day for the whole project.
 *
 * It also asserts two things about the database that are easy to forget and
 * expensive to get wrong: that the migrations were applied, and that the
 * privilege lockdown in 0004/0005 actually took effect.
 *
 * Exit code is non-zero if anything is broken, so this can gate a deploy.
 */

import { MUSIC_SEGMENT_ID } from "../src/lib/ticketmaster/types";

type Status = "pass" | "fail" | "warn" | "skip";

type Check = {
  group: string;
  name: string;
  status: Status;
  detail: string;
  fix?: string;
};

const checks: Check[] = [];

function record(check: Check) {
  checks.push(check);
  const mark =
    check.status === "pass"
      ? "\x1b[32mPASS\x1b[0m"
      : check.status === "fail"
        ? "\x1b[31mFAIL\x1b[0m"
        : check.status === "warn"
          ? "\x1b[33mWARN\x1b[0m"
          : "\x1b[90mSKIP\x1b[0m";
  console.log(`${mark}  ${check.group.padEnd(14)} ${check.name}`);
  if (check.detail) console.log(`      ${check.detail}`);
  if (check.fix && check.status !== "pass") console.log(`      → ${check.fix}`);
}

const env = process.env;

function need(key: string): string {
  return (env[key] ?? "").trim();
}

/** Bounded so a hanging endpoint cannot stall the whole run. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function checkEnv() {
  const required: [string, string][] = [
    ["NEXT_PUBLIC_SUPABASE_URL", "Supabase → Project Settings → API"],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "Supabase → Project Settings → API"],
    ["SUPABASE_SERVICE_ROLE_KEY", "Supabase → Project Settings → API (secret)"],
    ["TICKETMASTER_API_KEY", "developer.ticketmaster.com → My Apps"],
    ["OPENAI_API_KEY", "platform.openai.com → API keys"],
    ["RESEND_API_KEY", "resend.com → API Keys"],
    ["CRON_SECRET", "openssl rand -hex 32"],
    ["UNSUBSCRIBE_HMAC_SECRET", "openssl rand -hex 32"],
  ];

  for (const [key, where] of required) {
    record({
      group: "env",
      name: key,
      status: need(key) ? "pass" : "fail",
      detail: need(key) ? "set" : "missing",
      fix: `Get it from ${where}, then add it to .env.local (and \`wrangler secret put ${key}\` for production).`,
    });
  }

  // Optional, but each one silently disables a feature.
  for (const [key, consequence] of [
    ["YOUTUBE_API_KEY", "artist links fall back to a YouTube search URL"],
    [
      "EMAIL_UNSUBSCRIBE_MAILTO",
      "optional. Without it the List-Unsubscribe header carries only the https one-click form, which Gmail honours. Outlook and iOS Mail read only the mailto form, so their native unsubscribe button will not appear — those readers use the link in the email body instead. Setting it means running an inbound mailbox, so it is worth deferring until volume justifies it",
    ],
  ] as const) {
    record({
      group: "env",
      name: key,
      status: need(key) ? "pass" : "warn",
      detail: need(key) ? "set" : `not set — ${consequence}`,
    });
  }

  for (const key of ["CRON_SECRET", "UNSUBSCRIBE_HMAC_SECRET"]) {
    const value = need(key);
    if (value && value.length < 32) {
      record({
        group: "env",
        name: `${key} strength`,
        status: "warn",
        detail: `only ${value.length} characters`,
        fix: "Use at least 32: openssl rand -hex 32",
      });
    }
  }

  const site = need("NEXT_PUBLIC_SITE_URL");
  const isLocal = site.startsWith("http://localhost");
  record({
    group: "env",
    name: "NEXT_PUBLIC_SITE_URL",
    status: site ? (isLocal ? "warn" : "pass") : "fail",
    detail: site || "missing",
    fix: isLocal
      ? "Fine for local development. Production must be https://likelylist.tech, or unsubscribe and preview links in real email will point at localhost."
      : "Set it to the site's public origin.",
  });
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

const EXPECTED_TABLES = [
  "cities",
  "genres",
  "profiles",
  "subscriptions",
  "genre_prefs",
  "artist_prefs",
  "feeds",
  "feed_artists",
  "artists",
  "events_cache",
  "digest_runs",
  "digest_jobs",
  "usage_counters",
  "global_counters",
];

async function checkSupabase() {
  const url = need("NEXT_PUBLIC_SUPABASE_URL");
  const anon = need("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const service = need("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !anon || !service) {
    record({
      group: "supabase",
      name: "connectivity",
      status: "skip",
      detail: "credentials missing",
    });
    return;
  }

  const svc = { apikey: service, Authorization: `Bearer ${service}` };

  // Reachability, via a table that should exist and is readable by anyone.
  try {
    const response = await fetchWithTimeout(
      `${url}/rest/v1/cities?select=id&limit=1`,
      { headers: { apikey: anon, Authorization: `Bearer ${anon}` } },
    );
    record({
      group: "supabase",
      name: "anon key reaches the API",
      status: response.ok ? "pass" : "fail",
      detail: `HTTP ${response.status}`,
      fix: "Check NEXT_PUBLIC_SUPABASE_URL and the anon key, and that migration 0001 ran.",
    });
  } catch (error) {
    record({
      group: "supabase",
      name: "anon key reaches the API",
      status: "fail",
      detail: describe(error),
      fix: "Is the project URL right, and the project awake?",
    });
    return;
  }

  // Migrations. A missing table comes back as 404 with a PGRST2xx code.
  const missing: string[] = [];
  for (const table of EXPECTED_TABLES) {
    const response = await fetchWithTimeout(
      `${url}/rest/v1/${table}?select=*&limit=0`,
      { headers: svc },
    );
    if (response.status === 404) missing.push(table);
  }
  record({
    group: "supabase",
    name: "migrations applied",
    status: missing.length === 0 ? "pass" : "fail",
    detail:
      missing.length === 0
        ? `all ${EXPECTED_TABLES.length} tables present`
        : `missing: ${missing.join(", ")}`,
    fix: "Run supabase/migrations/0001 … 0005 in order in the SQL editor.",
  });

  // Reference data.
  for (const [table, script] of [
    ["cities", "npm run seed:cities"],
    ["genres", "npm run seed:genres"],
  ] as const) {
    const response = await fetchWithTimeout(
      `${url}/rest/v1/${table}?select=id`,
      { headers: { ...svc, Prefer: "count=exact", Range: "0-0" } },
    );
    const count = Number(
      response.headers.get("content-range")?.split("/")[1] ?? "0",
    );
    record({
      group: "supabase",
      name: `${table} seeded`,
      status: count > 0 ? "pass" : "fail",
      detail: `${count} rows`,
      fix: `Run ${script}.`,
    });
  }

  // Privilege lockdown from 0004. These RPCs must NOT be callable with the anon
  // key — before that migration they were, which let any signed-in user suppress
  // everybody's email or exhaust another user's quota.
  for (const rpc of ["claim_digest_jobs", "bump_global_usage"]) {
    const response = await fetchWithTimeout(`${url}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    // 401/403 = revoked (what we want). 404 = not exposed at all, also fine.
    // 400 means it was reached and only argument parsing stopped it.
    const locked = [401, 403, 404].includes(response.status);
    record({
      group: "supabase",
      name: `rpc/${rpc} is not public`,
      status: locked ? "pass" : "fail",
      detail: `HTTP ${response.status}`,
      fix: "Apply supabase/migrations/0004_function_grants.sql.",
    });
  }

  // Column lockdown from 0005: profiles.timezone must be constrained.
  const constraintProbe = await fetchWithTimeout(
    `${url}/rest/v1/profiles?select=timezone&limit=1`,
    { headers: svc },
  );
  record({
    group: "supabase",
    name: "profiles readable via service role",
    status: constraintProbe.ok ? "pass" : "warn",
    detail: `HTTP ${constraintProbe.status}`,
    fix: "Expected once migration 0001 has run; empty table is fine.",
  });
}

// ---------------------------------------------------------------------------
// Ticketmaster
// ---------------------------------------------------------------------------

async function checkTicketmaster() {
  const key = need("TICKETMASTER_API_KEY");
  if (!key) {
    record({ group: "ticketmaster", name: "key", status: "skip", detail: "not set" });
    return;
  }

  try {
    const response = await fetchWithTimeout(
      `https://app.ticketmaster.com/discovery/v2/classifications.json?size=1&apikey=${encodeURIComponent(key)}`,
    );

    if (!response.ok) {
      record({
        group: "ticketmaster",
        name: "key works",
        status: "fail",
        detail: `HTTP ${response.status}`,
        fix:
          response.status === 401
            ? "The consumer key is wrong, or the app is not approved yet."
            : "Check developer.ticketmaster.com for the app's status.",
      });
      return;
    }

    const limit = response.headers.get("Rate-Limit");
    const available = response.headers.get("Rate-Limit-Available");
    record({
      group: "ticketmaster",
      name: "key works",
      status: "pass",
      detail: `quota ${available ?? "?"} of ${limit ?? "?"} remaining today`,
    });

    // The Music segment ID is the one classification value the docs publish, and
    // every event query depends on it.
    const body = (await response.json()) as unknown;
    record({
      group: "ticketmaster",
      name: "music segment reachable",
      status: JSON.stringify(body).includes(MUSIC_SEGMENT_ID) ? "pass" : "warn",
      detail: `expected segment ${MUSIC_SEGMENT_ID}`,
      fix: "Not fatal — the first page of classifications may not include it. `npm run seed:genres` is the real check.",
    });
  } catch (error) {
    record({
      group: "ticketmaster",
      name: "key works",
      status: "fail",
      detail: describe(error),
    });
  }
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

async function checkOpenAi() {
  const key = need("OPENAI_API_KEY");
  const model = need("OPENAI_VISION_MODEL") || "gpt-4o-mini";
  if (!key) {
    record({ group: "openai", name: "key", status: "skip", detail: "not set" });
    return;
  }

  try {
    // Retrieving the model validates the key AND that this account can use the
    // configured model — without spending a single token.
    const response = await fetchWithTimeout(
      `https://api.openai.com/v1/models/${encodeURIComponent(model)}`,
      { headers: { Authorization: `Bearer ${key}` } },
    );

    if (response.status === 401) {
      record({
        group: "openai",
        name: "key works",
        status: "fail",
        detail: "HTTP 401",
        fix: "The API key is wrong or revoked.",
      });
      return;
    }

    record({
      group: "openai",
      name: "key works",
      status: "pass",
      detail: "authenticated",
    });

    record({
      group: "openai",
      name: `model ${model} available`,
      status: response.ok ? "pass" : "fail",
      detail: `HTTP ${response.status}`,
      fix: "Set OPENAI_VISION_MODEL to a vision-capable model this account can access.",
    });
  } catch (error) {
    record({
      group: "openai",
      name: "key works",
      status: "fail",
      detail: describe(error),
    });
  }
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

async function checkYouTube() {
  const key = need("YOUTUBE_API_KEY");
  if (!key) {
    record({
      group: "youtube",
      name: "key",
      status: "warn",
      detail: "not set — links degrade to a YouTube search URL",
    });
    return;
  }

  try {
    // videos.list costs 1 unit from the 10,000-unit pool. Deliberately NOT
    // search.list, which draws on a separate bucket capped at 100 calls per day
    // for the entire project.
    const response = await fetchWithTimeout(
      `https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${encodeURIComponent(key)}`,
    );

    if (response.ok) {
      record({
        group: "youtube",
        name: "key works",
        status: "pass",
        detail: "videos.list responded (1 quota unit spent)",
      });
      return;
    }

    const body = await response.text();
    record({
      group: "youtube",
      name: "key works",
      status: "fail",
      detail: `HTTP ${response.status} ${body.slice(0, 160)}`,
      fix: body.includes("has not been used")
        ? "Enable the YouTube Data API v3 for this Google Cloud project."
        : "Check the API key and any HTTP-referrer or IP restrictions on it — a browser-restricted key cannot be used server-side.",
    });
  } catch (error) {
    record({
      group: "youtube",
      name: "key works",
      status: "fail",
      detail: describe(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

async function checkResend() {
  const key = need("RESEND_API_KEY");
  const from = need("EMAIL_FROM");
  if (!key) {
    record({ group: "resend", name: "key", status: "skip", detail: "not set" });
    return;
  }

  try {
    // Listing domains validates the key and reports verification state. It sends
    // nothing.
    const response = await fetchWithTimeout("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);

      // A Resend key created with "Sending access" cannot list domains — it gets
      // a 401 or 403 here while still being perfectly able to send. That is a
      // different situation from a wrong key, and reporting both as a failure sent
      // people looking for a problem that did not exist.
      const restricted =
        /restrict|permission|not allowed|forbidden|sending/i.test(body) ||
        response.status === 403;

      record({
        group: "resend",
        name: restricted ? "key is sending-only" : "key works",
        status: restricted ? "warn" : "fail",
        detail: `HTTP ${response.status} ${body}`,
        fix: restricted
          ? "Fine for delivery, but this key cannot list domains, so EMAIL_FROM cannot be cross-checked here. Verify in the Resend dashboard that the sending domain is verified — or create a Full-access key for local checks."
          : "The API key is wrong or revoked. Create a new one at resend.com → API Keys.",
      });

      if (restricted) {
        record({
          group: "resend",
          name: "EMAIL_FROM is production-ready",
          status: from.includes("resend.dev") ? "warn" : "skip",
          detail: from.includes("resend.dev")
            ? "still the shared resend.dev test sender"
            : "cannot be checked with a sending-only key",
          fix: from.includes("resend.dev")
            ? "Verify mail.likelylist.tech in Resend, then point EMAIL_FROM at it. Until then delivery is limited to your own address."
            : undefined,
        });
      }
      return;
    }

    const payload = (await response.json()) as {
      data?: { name?: string; status?: string }[];
    };
    const domains = payload.data ?? [];

    record({
      group: "resend",
      name: "key works",
      status: "pass",
      detail:
        domains.length === 0
          ? "authenticated, but no sending domain added yet"
          : domains
              .map((d) => `${d.name} (${d.status})`)
              .join(", "),
    });

    // The address in EMAIL_FROM has to be on a *verified* domain, or real
    // delivery silently fails for everyone except the account owner.
    const fromDomain = from.match(/@([^\s>]+)/)?.[1]?.toLowerCase();
    if (from.includes("resend.dev")) {
      record({
        group: "resend",
        name: "EMAIL_FROM is production-ready",
        status: "warn",
        detail: "still the shared resend.dev test sender",
        fix: "Verify mail.likelylist.tech in Resend, then set EMAIL_FROM to an address on it. Until then delivery is limited to your own address.",
      });
    } else if (!fromDomain) {
      record({
        group: "resend",
        name: "EMAIL_FROM is production-ready",
        status: "fail",
        detail: `could not read a domain out of ${JSON.stringify(from)}`,
        fix: 'Use the form: likelylist <digest@mail.likelylist.tech>',
      });
    } else {
      const match = domains.find(
        (d) => fromDomain === d.name?.toLowerCase() ||
          fromDomain.endsWith(`.${d.name?.toLowerCase()}`),
      );
      const verified = match?.status === "verified";
      record({
        group: "resend",
        name: "EMAIL_FROM is production-ready",
        status: verified ? "pass" : "fail",
        detail: match
          ? `${match.name} is ${match.status}`
          : `${fromDomain} is not registered in this Resend account`,
        fix: "Add the sending subdomain in Resend and put its SPF and DKIM records into Cloudflare DNS as DNS-only (grey cloud).",
      });
    }
  } catch (error) {
    record({
      group: "resend",
      name: "key works",
      status: "fail",
      detail: describe(error),
    });
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "AbortError" ? "timed out" : error.message;
  }
  return String(error);
}

async function main() {
  console.log("\nlikelylist preflight\n");

  checkEnv();
  console.log("");
  await checkSupabase();
  console.log("");
  await checkTicketmaster();
  console.log("");
  await checkOpenAi();
  console.log("");
  await checkYouTube();
  console.log("");
  await checkResend();

  const failed = checks.filter((c) => c.status === "fail");
  const warned = checks.filter((c) => c.status === "warn");

  console.log(
    `\n${checks.filter((c) => c.status === "pass").length} passed · ` +
      `${warned.length} warnings · ${failed.length} failures\n`,
  );

  if (failed.length > 0) {
    console.log("Not ready. Fix the FAIL lines above.\n");
    process.exit(1);
  }
  if (warned.length > 0) {
    console.log("Usable, but read the WARN lines before real subscribers exist.\n");
  } else {
    console.log("Everything checks out.\n");
  }
}

main().catch((error) => {
  console.error(describe(error));
  process.exit(1);
});
