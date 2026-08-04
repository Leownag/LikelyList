import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

/**
 * OAuth / email-confirmation landing point.
 *
 * Supabase redirects here with a `code`, which is exchanged for a session. The
 * exchange has to happen server-side so the session lands in an HttpOnly cookie
 * rather than in the URL fragment.
 *
 * `next` arrives inside a URL an attacker can compose, so it is never used as a
 * redirect target directly — see lib/safe-redirect for why a string check is not
 * sufficient.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeRedirectPath(url.searchParams.get("next"), url.origin);

  if (!code) {
    const error = url.searchParams.get("error_description") ?? "missing_code";
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error)}`, url.origin),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
