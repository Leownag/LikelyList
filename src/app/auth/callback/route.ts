import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / email-confirmation landing point.
 *
 * Supabase redirects here with a `code`, which is exchanged for a session. The
 * exchange has to happen server-side so the session lands in an HttpOnly cookie
 * rather than in the URL fragment.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"), url.origin);

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

/**
 * Only same-origin paths are honoured.
 *
 * `next` arrives in a URL, so treating it as a trusted redirect target would be
 * an open redirect: an attacker could send someone a genuine Supabase login link
 * that bounces them to a look-alike site *after* they successfully sign in,
 * which is the most convincing phishing setup there is.
 *
 * Checking the string ("starts with / but not //") is not enough. The WHATWG URL
 * parser treats a backslash as a path separator in special schemes, so `/\evil.com`
 * passes that test and then resolves to `https://evil.com/`. Rather than
 * blacklisting characters, this resolves the candidate and requires the result to
 * land on the same origin — which is the property we actually care about.
 */
export function safeNext(value: string | null, origin: string): string {
  const fallback = "/app";
  if (!value || !value.startsWith("/")) return fallback;

  let resolved: URL;
  try {
    resolved = new URL(value, origin);
  } catch {
    return fallback;
  }

  if (resolved.origin !== origin) return fallback;
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
