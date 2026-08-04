import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign out.
 *
 * POST-only, because signing out from a GET would be triggerable by any image
 * tag. The Origin check on top closes the cross-site form post: a third-party
 * page should not be able to log someone out of this site. Harmless as attacks
 * go, but it costs three lines.
 */
export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");

  // Same-origin form posts from a browser always send Origin. A request without
  // one is not coming from our UI.
  if (origin !== url.origin) {
    return NextResponse.json(
      { error: "Cross-origin sign-out is not allowed." },
      { status: 403 },
    );
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", url.origin), { status: 303 });
}
