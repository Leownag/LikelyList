/**
 * A sign-in failure, as the person in front of it should read it.
 *
 * Supabase's raw messages are written for whoever built the thing: "Error sending
 * confirmation email" names our SMTP problem as if the reader could fix it, and an
 * unrecognised failure surfaces as the literal string `{}` — auth-js falls back to
 * `JSON.stringify(body)` when an error response carries no `msg`, so an empty body
 * becomes two braces on the screen. Neither tells a reader what to do next.
 *
 * So this maps to copy, and the fallback is deliberately generic rather than
 * pass-through: a message is only shown verbatim when it is known to be readable.
 * The raw detail is not lost — callers log it, and /dev-mode exists for reading it.
 *
 * Pure, and used from both sides: the login form for a send failure, /auth/callback
 * for a link that no longer works.
 */

export type AuthFailure = {
  message?: string | null;
  /** GoTrue's `error_code`, e.g. `over_email_send_rate_limit`. */
  code?: string | null;
  status?: number | null;
};

/** What we tell someone when we genuinely do not know. Always actionable. */
const GENERIC =
  "That didn't work. Try again in a moment — if it keeps happening, the sign-in email service is down rather than your address.";

export function signInErrorMessage(error: AuthFailure): string {
  const code = error.code ?? "";
  const raw = (error.message ?? "").trim();

  switch (code) {
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many links requested for that address. Wait a few minutes and try again — the last one we sent still works.";

    case "otp_expired":
      return "That link has expired or was already used. Links work once and last an hour — ask for a new one.";

    case "email_address_invalid":
    case "validation_failed":
      return "That doesn't look like an email address we can send to. Check it and try again.";

    case "signup_disabled":
    case "otp_disabled":
      return "New sign-ups are turned off at the moment, so we can't email a link to an address we haven't seen before.";

    // Ours, not theirs. Saying "we" matters: the reader can retype their address a
    // hundred times and it will not help.
    case "unexpected_failure":
      return "We couldn't send the email — that's a fault on our side, not with your address. Try again shortly.";
  }

  // GoTrue's throttle answers with a countdown and no error code on older versions.
  if (/only request this after/i.test(raw)) {
    return "That was too soon after the last link. Give it a minute and try again.";
  }
  if (/sending.*email/i.test(raw)) {
    return "We couldn't send the email — that's a fault on our side, not with your address. Try again shortly.";
  }
  if (/invalid or has expired/i.test(raw)) {
    return "That link has expired or was already used. Links work once and last an hour — ask for a new one.";
  }
  if (/api key/i.test(raw)) {
    return "This site isn't configured to sign anyone in right now. That's ours to fix.";
  }

  if (error.status === 429) {
    return "Too many attempts. Wait a few minutes and try again.";
  }
  if (typeof error.status === "number" && error.status >= 500) {
    return "The sign-in service isn't answering. That's on our side — try again shortly.";
  }

  return isReadable(raw) ? raw : GENERIC;
}

/**
 * Whether a raw message can be shown to a reader as-is.
 *
 * Rejects `{}` and `[]` explicitly, since that is what an error response with no
 * message serialises to, and anything that reads like a stack trace or a serialised
 * object rather than a sentence.
 */
function isReadable(raw: string): boolean {
  if (raw.length < 8 || raw.length > 200) return false;
  if (/^[{[]/.test(raw)) return false;
  if (/[{}<>]|\bat \w+\(|Error:/.test(raw)) return false;
  return /[a-z]{3}/i.test(raw);
}
