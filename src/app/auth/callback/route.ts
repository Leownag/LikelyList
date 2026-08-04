import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * The single landing point for signing in.
 *
 * One shape arrives here — `?token_hash=` — and it is verified server-side with
 * `verifyOtp`. That is not an implementation detail, it is the reason the product
 * works: people request a link in one browser and click it from whatever their mail
 * client opens. PKCE keeps its code verifier in the browser that *started* the
 * flow, so a `?code=` link clicked anywhere else fails with "both auth code and
 * code verifier should be non-empty". With an emailed link as the only way in, that
 * failure is a lockout rather than an inconvenience.
 *
 * There is no OAuth branch any more: Google was the only provider and it was
 * carried mainly to paper over exactly the cross-browser problem that token_hash
 * solves properly.
 *
 * Requires both auth email templates to point here with `{{ .TokenHash }}` rather
 * than `{{ .ConfirmationURL }}` — see README, Setup step 3, and
 * supabase/email-templates/.
 *
 * The session lands in an HttpOnly cookie rather than in the URL.
 *
 * `next` arrives inside a URL an attacker can compose, so it is never used as a
 * redirect target directly — see lib/safe-redirect for why a string check is not
 * sufficient.
 */

/** The `type` values we accept. Anything else is not a sign-in. */
const OTP_TYPES: readonly EmailOtpType[] = [
  "magiclink",
  "email",
  "signup",
  "invite",
  "recovery",
  "email_change",
];

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = safeRedirectPath(url.searchParams.get("next"), url.origin);

  if (tokenHash && type && OTP_TYPES.includes(type as EmailOtpType)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });
    return error
      ? failed(url, error.message)
      : NextResponse.redirect(new URL(next, url.origin));
  }

  // A `code` here means an email template is still on `{{ .ConfirmationURL }}`.
  // Worth naming, because it is the one misconfiguration this whole setup invites
  // and the symptom otherwise reads as "the link is broken".
  if (url.searchParams.get("code")) {
    return failed(
      url,
      "That link used the wrong format. The Supabase email template needs " +
        "{{ .TokenHash }} rather than {{ .ConfirmationURL }} — ask for a new link.",
    );
  }

  return failed(
    url,
    url.searchParams.get("error_description") ?? "That link was incomplete.",
  );
}

/**
 * Back to the login form with the reason.
 *
 * An expired or already-used link is the common case here, not an edge case —
 * single-use links get prefetched by mail clients — so this has to land somewhere
 * a person can simply ask for another one.
 */
function failed(url: URL, reason: string) {
  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent(reason)}`, url.origin),
  );
}
