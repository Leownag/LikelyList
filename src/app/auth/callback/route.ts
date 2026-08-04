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
  const next = safeNext(url.searchParams.get("next"));

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
 * Only same-site relative paths are honoured.
 *
 * `next` arrives in a URL, so treating it as a trusted redirect target would be
 * an open redirect: an attacker could send someone a real Supabase login link
 * that bounces them to a look-alike site after signing in.
 */
function safeNext(value: string | null): string {
  if (!value) return "/app";
  if (!value.startsWith("/") || value.startsWith("//")) return "/app";
  return value;
}
