import { type NextRequest } from "next/server";
import { readEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyToken } from "@/lib/tokens";

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
 * Deliberately self-contained: no session, no cookies, no React, and excluded
 * from the proxy matcher. A mail client's POST arrives with nothing attached, and
 * this endpoint must be the least breakable thing in the app.
 */

export async function POST(request: NextRequest) {
  const env = readEnv();
  const token = tokenFrom(request);

  const verified = await verifyToken(env.unsubscribeHmacSecret, "unsubscribe", token);
  if (!verified) {
    return html(page("That link isn't valid", "It may have already been used, or the link was truncated by your mail client."), 400);
  }

  const supabase = createAdminClient(env);
  const { error } = await supabase
    .from("profiles")
    .update({ digest_enabled: false })
    .eq("id", verified.userId);

  if (error) {
    return html(
      page("Something went wrong", "We couldn't update your subscription. Please try again in a moment."),
      500,
    );
  }

  return html(
    page(
      "Unsubscribed",
      "You won't get the weekly email any more. Your account and everything you've followed are untouched — you can turn the digest back on from Settings whenever you like.",
      `${env.siteUrl}/app/settings`,
      "Open settings",
    ),
  );
}

export async function GET(request: NextRequest) {
  const env = readEnv();
  const token = tokenFrom(request);

  const verified = await verifyToken(env.unsubscribeHmacSecret, "unsubscribe", token);
  if (!verified) {
    return html(page("That link isn't valid", "It may have already been used, or the link was truncated by your mail client."), 400);
  }

  // A form, not an automatic action: see the note above about link scanners.
  return html(
    page(
      "Stop the weekly email?",
      "One click and the Friday digest stops. Your account, cities, genres and feeds all stay as they are.",
      undefined,
      undefined,
      `<form method="post" action="/unsubscribe?t=${escapeHtml(token ?? "")}">
         <button type="submit" class="btn">Unsubscribe</button>
       </form>`,
    ),
  );
}

function tokenFrom(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("t");
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Nothing here should be cached by an intermediary.
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

/** Minimal standalone page, styled to match the app without importing it. */
function page(
  title: string,
  body: string,
  linkHref?: string,
  linkLabel?: string,
  extra?: string,
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} — likelylist</title>
<style>
  :root { color-scheme: dark; }
  * { border-radius: 0 !important; box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 24px;
    background: #0a0a0a; color: #fafafa;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  main { max-width: 460px; }
  .mark {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 14px; letter-spacing: 0.22em; text-transform: uppercase;
    color: #fafafa;
  }
  .blocks { display: flex; gap: 2px; margin: 20px 0 24px; }
  .blocks i { width: 8px; height: 8px; display: block; }
  h1 { font-size: 22px; margin: 0 0 12px; letter-spacing: -0.01em; }
  p { font-size: 14px; line-height: 1.65; color: #a1a1aa; margin: 0 0 20px; }
  .btn {
    display: inline-block; padding: 10px 18px; border: 0; cursor: pointer;
    background: #e4ff3f; color: #0a0a0a; font: inherit; font-size: 14px;
    font-weight: 600; text-decoration: none;
  }
  .btn:hover { background: #ffffff; }
  a.quiet { color: #a1a1aa; font-size: 13px; }
</style>
</head>
<body>
  <main>
    <div class="mark">likelylist</div>
    <div class="blocks" aria-hidden="true">
      <i style="background:#e4ff3f"></i><i style="background:#ff4d6d"></i>
      <i style="background:#4dd8ff"></i><i style="background:#262626"></i>
      <i style="background:#e4ff3f"></i>
    </div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(body)}</p>
    ${extra ?? ""}
    ${
      linkHref && linkLabel
        ? `<p><a class="quiet" href="${escapeHtml(linkHref)}">${escapeHtml(linkLabel)}</a></p>`
        : ""
    }
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
