/**
 * A single self-contained HTML page, built as a string.
 *
 * Used by the two endpoints a mail client opens directly: unsubscribe and
 * subscribe-confirm. Both deliberately avoid React, the app layout, cookies and
 * any session — a mail client's request arrives with nothing attached, and these
 * are the two pages that must be the least breakable things in the app. Sharing
 * one renderer keeps them looking identical without either importing the other.
 *
 * Every interpolation is escaped except `extra`, which is markup this codebase
 * constructs (a form), never anything from a request.
 */

export type StandalonePage = {
  title: string;
  body: string;
  linkHref?: string;
  linkLabel?: string;
  /** Trusted markup, e.g. the confirm form. Never request-derived. */
  extra?: string;
  siteUrl?: string;
  /**
   * Already-translated strings. The caller resolves the locale, because it is the
   * one holding the request headers; this function only renders.
   */
  htmlLang?: string;
  privacyLabel?: string;
};

export function standalonePage({
  title,
  body,
  linkHref,
  linkLabel,
  extra,
  siteUrl = "",
  htmlLang = "en",
  privacyLabel = "Privacy",
}: StandalonePage): string {
  return `<!doctype html>
<html lang="${escapeHtml(htmlLang)}">
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
    <p><a class="quiet" href="${escapeHtml(siteUrl)}/privacy">${escapeHtml(privacyLabel)}</a></p>
  </main>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
