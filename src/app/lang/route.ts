import { NextResponse, type NextRequest } from "next/server";
import { isEnabledLocale } from "@/lib/i18n/locales";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/lib/i18n/cookie";
import { safeRedirectPath } from "@/lib/safe-redirect";

/**
 * Switches language and returns you to the page you were on.
 *
 * `/lang?to=zh-Hant&next=/app/subscriptions`
 *
 * A GET that sets a cookie, which is normally worth avoiding — but there is nothing to
 * protect here: the worst a forged link can do is show somebody the site in Chinese, and
 * a POST would mean a form and JavaScript on pages that deliberately have neither.
 *
 * `next` is sanitised rather than trusted: it arrives inside a URL anyone can compose, so
 * without that check this would be an open redirect wearing a language switcher's clothes.
 */
export async function GET(request: NextRequest) {
  const to = request.nextUrl.searchParams.get("to");
  const next = safeRedirectPath(
    request.nextUrl.searchParams.get("next"),
    request.nextUrl.origin,
  );

  const response = NextResponse.redirect(new URL(next, request.nextUrl.origin));

  if (isEnabledLocale(to)) {
    response.cookies.set(LOCALE_COOKIE, to, {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
      // Readable from the browser on purpose — see cookie.ts.
      httpOnly: false,
    });
  }

  return response;
}
