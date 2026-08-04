import { type NextRequest } from "next/server";
import { readEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyToken } from "@/lib/tokens";
import { escapeHtml, standalonePage } from "@/lib/standalone-page";
import {
  i18nFromRequest,
  languageChoices,
  type RequestI18n,
} from "@/lib/i18n/request";

/**
 * One-click unsubscribe (RFC 8058).
 *
 * Both verbs live on one URL, and they behave differently on purpose:
 *
 *   POST — unsubscribes immediately with no confirmation page. This is what the
 *          `List-Unsubscribe` / `List-Unsubscribe-Post` headers point at, and
 *          the spec requires exactly this: accept POST, act, do not ask again.
 *
 *   GET  — renders a page with a single button that POSTs. It does NOT
 *          unsubscribe. Email security scanners and link prefetchers fetch every
 *          URL in a message with GET, so acting on GET would silently
 *          unsubscribe people who never clicked anything.
 *
 * Deliberately self-contained: no session, no cookies, no React. A mail client's
 * POST arrives with nothing attached, and this endpoint must be the least
 * breakable thing in the app. Localised from `Accept-Language`, because someone who
 * wants out should not have to read English to manage it.
 *
 * Note there is no expiry on these tokens, unlike the preview links. Someone must
 * always be able to get out, including from an email they find a year later.
 */

export async function POST(request: NextRequest) {
  const env = readEnv();
  const i18n = i18nFromRequest(request);
  const token = tokenFrom(request);

  const verified = await verifyToken(env.unsubscribeHmacSecret, "unsubscribe", token);
  if (!verified) return invalid(env.siteUrl, i18n, request);

  const supabase = createAdminClient(env);
  const { error } = await supabase
    .from("profiles")
    .update({ digest_enabled: false })
    .eq("id", verified.userId);

  if (error) {
    return html(
      standalonePage({
        title: i18n.t("error.generic.title"),
        body: i18n.t("error.generic.body"),
        ...chrome(env.siteUrl, i18n, request),
      }),
      500,
    );
  }

  return html(
    standalonePage({
      title: i18n.t("unsubscribe.done.title"),
      body: i18n.t("unsubscribe.done.body"),
      // Via /login: this page is opened from an email, in a browser that most
      // likely holds no session, and /app/settings alone would drop the reader on
      // a bare sign-in page having forgotten where they were going.
      linkHref: `${env.siteUrl}/login?next=${encodeURIComponent("/app/settings")}`,
      linkLabel: i18n.t("unsubscribe.done.link"),
      ...chrome(env.siteUrl, i18n, request),
    }),
  );
}

export async function GET(request: NextRequest) {
  const env = readEnv();
  const i18n = i18nFromRequest(request);
  const token = tokenFrom(request);

  const verified = await verifyToken(env.unsubscribeHmacSecret, "unsubscribe", token);
  if (!verified) return invalid(env.siteUrl, i18n, request);

  // A form, not an automatic action: see the note above about link scanners. The
  // language is carried through so the POST renders in the same one.
  const action = `/unsubscribe?t=${escapeHtml(token ?? "")}&lang=${escapeHtml(i18n.locale)}`;

  return html(
    standalonePage({
      title: i18n.t("unsubscribe.confirm.title"),
      body: i18n.t("unsubscribe.confirm.body"),
      extra: `<form method="post" action="${action}">
                <button type="submit" class="btn">${escapeHtml(
                  i18n.t("unsubscribe.confirm.action"),
                )}</button>
              </form>`,
      ...chrome(env.siteUrl, i18n, request),
    }),
  );
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
      ...chrome(siteUrl, i18n, request),
    }),
    400,
  );
}

/** The bits every page on this route shares. */
function chrome(siteUrl: string, i18n: RequestI18n, request: NextRequest) {
  return {
    siteUrl,
    htmlLang: i18n.htmlLang,
    privacyLabel: i18n.t("common.privacy"),
    languages: languageChoices(request, i18n.locale),
  };
}

function tokenFrom(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("t");
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Nothing here should be cached by an intermediary. `Vary` matters because
      // the body depends on the request's language.
      "Cache-Control": "no-store",
      Vary: "Accept-Language",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
