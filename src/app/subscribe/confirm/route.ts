import { NextResponse, type NextRequest } from "next/server";
import { readEnv } from "@/lib/env";
import { confirmSubscription } from "@/lib/subscribe/anonymous";
import { escapeHtml, standalonePage } from "@/lib/standalone-page";
import {
  i18nFromRequest,
  languageChoices,
  type RequestI18n,
} from "@/lib/i18n/request";

/**
 * Anonymous subscribe: step two of two.
 *
 * Same verb split as /unsubscribe, for the same reason:
 *
 *   GET  — renders a page with one button. It does NOT confirm. Mail security
 *          scanners and link prefetchers fetch every URL in a message, and a
 *          scanner confirming a subscription would defeat the entire purpose of
 *          double opt-in.
 *   POST — confirms, creating (or reusing) the account.
 *
 * Self-contained HTML with no session, no cookies and no React, so it works in
 * whatever browser a mail client hands it to.
 */

export async function GET(request: NextRequest) {
  const env = readEnv();
  const i18n = i18nFromRequest(request);
  const token = request.nextUrl.searchParams.get("t");

  if (!token) return invalid(env.siteUrl, i18n, request);

  const action = `/subscribe/confirm?t=${escapeHtml(token)}&lang=${escapeHtml(i18n.locale)}`;

  return html(
    standalonePage({
      title: i18n.t("subscribe.confirm.title"),
      body: i18n.t("subscribe.confirm.body"),
      extra: `<form method="post" action="${action}">
                <button type="submit" class="btn">${escapeHtml(
                  i18n.t("subscribe.confirm.action"),
                )}</button>
              </form>`,
      ...chrome(env.siteUrl, i18n, request),
    }),
  );
}

export async function POST(request: NextRequest) {
  const env = readEnv();
  const i18n = i18nFromRequest(request);
  const outcome = await confirmSubscription(
    env,
    request.nextUrl.searchParams.get("t"),
  );

  switch (outcome.status) {
    case "confirmed": {
      // Straight into the app, already signed in.
      //
      // Clicking a link from this mailbox is the same proof a magic link asks for,
      // so demanding they now go and type the same address and wait for a *second*
      // email was asking for it twice. /auth/callback turns the minted token into a
      // session; `next` lands them where the promise of the email actually is.
      //
      // This is the one place this route sets a cookie, which is why it does not
      // hold to the no-session rule the rest of the file follows.
      if (outcome.signInTokenHash) {
        const target = new URL("/auth/callback", env.siteUrl);
        target.searchParams.set("token_hash", outcome.signInTokenHash);
        target.searchParams.set("type", "magiclink");
        target.searchParams.set("next", "/app/subscriptions");
        return NextResponse.redirect(target, 303);
      }

      // Minting failed. The subscription is already written, so say so and offer
      // the ordinary way in rather than implying something went wrong.
      return html(
        standalonePage({
          title: i18n.t("subscribe.done.title"),
          body: i18n.t("subscribe.done.body"),
          linkHref: `${env.siteUrl}/login`,
          linkLabel: i18n.t("subscribe.done.link"),
          ...chrome(env.siteUrl, i18n, request),
        }),
      );
    }

    case "expired":
      return html(
        standalonePage({
          title: i18n.t("subscribe.expired.title"),
          body: i18n.t("subscribe.expired.body"),
          linkHref: env.siteUrl,
          linkLabel: i18n.t("common.home"),
          ...chrome(env.siteUrl, i18n, request),
        }),
        410,
      );

    case "error":
      return html(
        standalonePage({
          title: i18n.t("error.generic.title"),
          // The reason is operational detail rather than a translated string;
          // showing it beats hiding why nothing happened.
          body: outcome.reason,
          linkHref: `${env.siteUrl}/login`,
          linkLabel: i18n.t("common.signIn"),
          ...chrome(env.siteUrl, i18n, request),
        }),
        500,
      );

    default:
      return invalid(env.siteUrl, i18n, request);
  }
}

function invalid(
  siteUrl: string,
  i18n: RequestI18n,
  request: NextRequest,
): Response {
  return html(
    standalonePage({
      title: i18n.t("link.invalid.title"),
      body: i18n.t("link.invalid.body"),
      linkHref: `${siteUrl}/login`,
      linkLabel: i18n.t("common.signIn"),
      ...chrome(siteUrl, i18n, request),
    }),
    400,
  );
}

function chrome(siteUrl: string, i18n: RequestI18n, request: NextRequest) {
  return {
    siteUrl,
    htmlLang: i18n.htmlLang,
    privacyLabel: i18n.t("common.privacy"),
    languages: languageChoices(request, i18n.locale),
  };
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      Vary: "Accept-Language",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
