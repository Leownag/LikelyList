/**
 * Live security assertions against the real database.
 *
 * Run with: npm run security:check
 *
 * Checks the things that can only be verified with an actual signed-in session
 * against actual RLS policies and column grants. Unit tests cannot reach any of
 * this, and the failure modes are quiet: an over-restrictive grant breaks the
 * settings page, and an under-restrictive one turns the digest into a way to mail
 * strangers.
 *
 * Deliberately tests BOTH directions. "Denied" is only half the story — the same
 * migration that must stop a user rewriting their email must still let them change
 * their timezone, and only checking the denials would hide that.
 *
 * Self-contained: creates a throwaway confirmed user with the service role, acts
 * as that user, and deletes it at the end. No manual setup, no residue.
 */

type Check = {
  name: string;
  status: "pass" | "fail";
  detail: string;
  why?: string;
};

const checks: Check[] = [];

function record(check: Check) {
  checks.push(check);
  const mark =
    check.status === "pass" ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${mark}  ${check.name}`);
  console.log(`      ${check.detail}`);
  if (check.why && check.status === "fail") console.log(`      → ${check.why}`);
}

const URL_BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const ANON = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

if (!URL_BASE || !ANON || !SERVICE) {
  console.error(
    "Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const serviceHeaders = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  "Content-Type": "application/json",
};

async function main() {
  const email = `preflight-${crypto.randomUUID()}@likelylist.invalid`;
  const password = crypto.randomUUID();

  console.log("\nlikelylist security check\n");
  console.log(`Using a throwaway account: ${email}\n`);

  const userId = await createUser(email, password);
  if (!userId) {
    console.error("Could not create the test user; aborting.");
    process.exit(1);
  }

  try {
    const token = await signIn(email, password);
    if (!token) {
      record({
        name: "a confirmed user can sign in",
        status: "fail",
        detail: "password grant did not return an access token",
        why: "Email/password sign-in may be disabled for this project, or the account was not created as confirmed.",
      });
      return;
    }
    record({
      name: "a confirmed user can sign in",
      status: "pass",
      detail: "password grant returned an access token",
    });

    const userHeaders = {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };

    // --- Must be allowed -----------------------------------------------------
    // Guards against 0005 being too strict. If this breaks, the settings page is
    // broken for every user.
    await expectAllowed({
      name: "own timezone is writable",
      userId,
      headers: userHeaders,
      body: { timezone: "America/Chicago", digest_send_hour: 9, digest_enabled: true },
      why: "Migration 0005 re-grants UPDATE on (timezone, digest_send_hour, digest_enabled). If this fails, that column list is wrong and /app/settings cannot save.",
    });

    await expectVisible({
      name: "own profile is readable",
      userId,
      headers: userHeaders,
      why: "The RLS select policy on profiles is not matching auth.uid().",
    });

    // --- Must be denied ------------------------------------------------------
    await expectFieldUnchanged({
      name: "own email is NOT writable",
      userId,
      headers: userHeaders,
      field: "email",
      attempt: "attacker@example.com",
      expected: email,
      why: "profiles.email decides where the digest is delivered. If a user can rewrite it, this service can be made to mail an arbitrary address every week from our own verified domain. Apply migration 0005.",
    });

    await expectFieldUnchanged({
      name: "an unsupported timezone is rejected",
      userId,
      headers: userHeaders,
      field: "timezone",
      attempt: "Not/AZone",
      expected: "America/Chicago",
      why: "Intl throws on an unknown zone, and the weekly planner computes a send time for every subscriber in one pass. Migration 0005 adds the CHECK constraint that stops one row taking out the whole run.",
    });

    await expectRpcDenied({
      name: "rpc/claim_digest_jobs is not callable as a user",
      headers: userHeaders,
      rpc: "claim_digest_jobs",
      body: { p_limit: 1 },
      why: "A signed-in user could otherwise lease every pending job and burn its retries, permanently suppressing every subscriber's email. Apply migration 0004.",
    });

    await expectRpcDenied({
      name: "rpc/bump_global_usage is not callable as a user",
      headers: userHeaders,
      rpc: "bump_global_usage",
      body: { p_kind: "youtube_search", p_day: "2026-01-01", p_amount: 1000 },
      why: "Otherwise a user can exhaust the project-wide YouTube search budget for everybody. Apply migration 0004.",
    });

    // bump_usage IS callable — the feed upload route needs it — but only for the
    // caller's own counter.
    await expectRpcDenied({
      name: "rpc/bump_usage cannot target another user",
      headers: userHeaders,
      rpc: "bump_usage",
      body: {
        p_user_id: "00000000-0000-0000-0000-000000000000",
        p_kind: "feed_upload",
        p_day: "2026-01-01",
        p_amount: 99,
      },
      why: "Without the auth.uid() guard in 0004, anyone can exhaust another user's daily upload quota.",
    });

    await expectRpcAllowed({
      name: "rpc/bump_usage still works for oneself",
      headers: userHeaders,
      rpc: "bump_usage",
      body: {
        p_user_id: userId,
        p_kind: "feed_upload",
        p_day: "2026-01-01",
        p_amount: 1,
      },
      why: "The feed upload route calls this with the user's own client. If it is denied, screenshot uploads fail with a quota error.",
    });

    await expectDenied({
      name: "the shared event cache is not readable by a user",
      url: `${URL_BASE}/rest/v1/events_cache?select=tm_event_id&limit=1`,
      headers: userHeaders,
      why: "events_cache has RLS enabled with no policies, so it should be invisible to anon and authenticated.",
    });

    await expectDenied({
      name: "the anonymous signup waiting room is not readable by a user",
      url: `${URL_BASE}/rest/v1/pending_subscriptions?select=email&limit=1`,
      headers: userHeaders,
      why: "pending_subscriptions holds unconfirmed email addresses. It must be service-role only.",
    });

    await expectDenied({
      name: "a Spotify refresh token is not readable by a user",
      url: `${URL_BASE}/rest/v1/spotify_links?select=refresh_token&limit=1`,
      headers: userHeaders,
      why: "spotify_links holds a long-lived OAuth credential. It has RLS on with no policies precisely so no browser session can reach it — including the owner's own.",
    });

    // Pins are the first table added with per-user policies rather than deny-all, so
    // both directions are worth asserting: the reader can write their own, and cannot
    // write somebody else's.
    await expectWriteDenied({
      name: "a user cannot pin on behalf of someone else",
      url: `${URL_BASE}/rest/v1/pinned_events`,
      headers: userHeaders,
      body: {
        user_id: "00000000-0000-0000-0000-000000000000",
        tm_event_id: "security-check-probe",
        name: "Probe",
      },
      why: "The insert policy checks auth.uid() = user_id. Without it, one reader could fill another's Pinned page.",
    });
  } finally {
    await deleteUser(userId);
    console.log(`\nCleaned up ${email}.`);
  }

  const failed = checks.filter((c) => c.status === "fail");
  console.log(
    `\n${checks.length - failed.length} passed · ${failed.length} failed\n`,
  );
  if (failed.length > 0) process.exit(1);
  console.log("All live security assertions hold.\n");
}

/* -------------------------------------------------------------------------- */

async function createUser(email: string, password: string): Promise<string | null> {
  const response = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!response.ok) {
    console.error(`createUser: HTTP ${response.status} ${await response.text()}`);
    return null;
  }
  const body = (await response.json()) as { id?: string };
  return body.id ?? null;
}

/**
 * A write that must be refused.
 *
 * Separate from expectDenied because a rejected INSERT and a rejected SELECT look
 * different over PostgREST: RLS turns a blocked read into an empty 200, while a blocked
 * write is a 401/403. Treating them the same would let a silently-allowed insert pass.
 */
async function expectWriteDenied(options: {
  name: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  why: string;
}) {
  const response = await fetch(options.url, {
    method: "POST",
    headers: { ...options.headers, "Content-Type": "application/json" },
    body: JSON.stringify(options.body),
  });

  const denied = response.status === 401 || response.status === 403;
  record({
    name: options.name,
    status: denied ? "pass" : "fail",
    detail: `HTTP ${response.status}${denied ? "" : " — the write was accepted"}`,
    why: options.why,
  });
}

async function deleteUser(userId: string): Promise<void> {
  await fetch(`${URL_BASE}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: serviceHeaders,
  });
}

async function signIn(email: string, password: string): Promise<string | null> {
  const response = await fetch(
    `${URL_BASE}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { access_token?: string };
  return body.access_token ?? null;
}

type PatchArgs = {
  name: string;
  userId: string;
  headers: Record<string, string>;
  why?: string;
};

async function patchProfile(
  userId: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ status: number; text: string }> {
  const response = await fetch(
    `${URL_BASE}/rest/v1/profiles?id=eq.${userId}`,
    { method: "PATCH", headers, body: JSON.stringify(body) },
  );
  return { status: response.status, text: (await response.text()).slice(0, 200) };
}

async function readProfileField(
  userId: string,
  field: string,
): Promise<string | null> {
  // Read back with the service role, so a restrictive select policy cannot make a
  // failed write look like a successful block.
  const response = await fetch(
    `${URL_BASE}/rest/v1/profiles?id=eq.${userId}&select=${field}`,
    { headers: serviceHeaders },
  );
  if (!response.ok) return null;
  const rows = (await response.json()) as Record<string, string>[];
  return rows[0]?.[field] ?? null;
}

async function expectAllowed({
  name,
  userId,
  headers,
  body,
  why,
}: PatchArgs & { body: Record<string, unknown> }) {
  const result = await patchProfile(userId, headers, body);
  const ok = result.status >= 200 && result.status < 300;
  record({
    name,
    status: ok ? "pass" : "fail",
    detail: `HTTP ${result.status} ${ok ? "" : result.text}`.trim(),
    why,
  });
}

/**
 * The strongest form of the denial assertion: attempt the write, then read the
 * value back with the service role.
 *
 * Status alone is not enough — PostgREST answers an RLS-filtered update with 200
 * and an empty array, so a "successful" response can still mean nothing changed.
 * What matters is that the stored value did not move.
 */
async function expectFieldUnchanged({
  name,
  userId,
  headers,
  field,
  attempt,
  expected,
  why,
}: PatchArgs & { field: string; attempt: string; expected: string }) {
  const result = await patchProfile(userId, headers, { [field]: attempt });
  const after = await readProfileField(userId, field);

  const unchanged = after === expected;
  record({
    name,
    status: unchanged ? "pass" : "fail",
    detail: unchanged
      ? `HTTP ${result.status}; ${field} is still ${JSON.stringify(after)}`
      : `${field} became ${JSON.stringify(after)} — the write went through (HTTP ${result.status})`,
    why,
  });
}

async function expectVisible({ name, userId, headers, why }: PatchArgs) {
  const response = await fetch(
    `${URL_BASE}/rest/v1/profiles?id=eq.${userId}&select=id`,
    { headers },
  );
  const rows = response.ok ? ((await response.json()) as unknown[]) : [];
  record({
    name,
    status: rows.length === 1 ? "pass" : "fail",
    detail: `HTTP ${response.status}, ${rows.length} row(s)`,
    why,
  });
}

async function expectDenied({
  name,
  url,
  headers,
  why,
}: {
  name: string;
  url: string;
  headers: Record<string, string>;
  why?: string;
}) {
  const response = await fetch(url, { headers });
  // Either an explicit refusal, or zero rows — RLS with no policy yields the
  // latter, and both mean "not readable".
  let rows: unknown[] = [];
  if (response.ok) {
    try {
      rows = (await response.json()) as unknown[];
    } catch {
      rows = [];
    }
  }
  const denied = !response.ok || rows.length === 0;
  record({
    name,
    status: denied ? "pass" : "fail",
    detail: denied
      ? `HTTP ${response.status}, ${rows.length} row(s) visible`
      : `readable — ${rows.length} row(s) returned`,
    why,
  });
}

async function callRpc(
  rpc: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ status: number; text: string }> {
  const response = await fetch(`${URL_BASE}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, text: (await response.text()).slice(0, 200) };
}

async function expectRpcDenied({
  name,
  headers,
  rpc,
  body,
  why,
}: {
  name: string;
  headers: Record<string, string>;
  rpc: string;
  body: Record<string, unknown>;
  why?: string;
}) {
  const result = await callRpc(rpc, headers, body);
  const denied = result.status >= 400;
  record({
    name,
    status: denied ? "pass" : "fail",
    detail: `HTTP ${result.status} ${denied ? "" : result.text}`.trim(),
    why,
  });
}

async function expectRpcAllowed({
  name,
  headers,
  rpc,
  body,
  why,
}: {
  name: string;
  headers: Record<string, string>;
  rpc: string;
  body: Record<string, unknown>;
  why?: string;
}) {
  const result = await callRpc(rpc, headers, body);
  const ok = result.status >= 200 && result.status < 300;
  record({
    name,
    status: ok ? "pass" : "fail",
    detail: `HTTP ${result.status} ${ok ? "" : result.text}`.trim(),
    why,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
