import { type NextRequest } from "next/server";
import { readEnv } from "@/lib/env";
import { DEV_MODE_COOKIE, devModeToken, timingSafeEqual } from "@/lib/dev-mode";
import { standalonePage } from "@/lib/standalone-page";

/**
 * Turns dev mode on or off for this browser.
 *
 *   /dev-mode?key=<CRON_SECRET>   turn it on
 *   /dev-mode?off=1               turn it off
 *   /dev-mode                     show whether it is on
 *
 * A GET that sets a cookie is normally something to avoid, but there is nothing to
 * protect against here: it changes only how verbosely errors are described to the
 * caller who already holds the operator secret, and it is not linked from
 * anywhere. The trade for being able to paste one URL into a phone browser while
 * diagnosing a live problem is worth it.
 */
export async function GET(request: NextRequest) {
  const env = readEnv();
  const key = request.nextUrl.searchParams.get("key");
  const off = request.nextUrl.searchParams.get("off");

  if (off) {
    return page(
      {
        title: "Dev mode off",
        body: "Error responses are back to plain messages with no codes or upstream detail.",
      },
      env.siteUrl,
      { clear: true },
    );
  }

  if (!key) {
    const current = request.cookies.get(DEV_MODE_COOKIE)?.value;
    const on = Boolean(current) && timingSafeEqual(current!, await devModeToken(env.cronSecret));
    return page(
      {
        title: on ? "Dev mode is on" : "Dev mode is off",
        body: on
          ? "Error responses in this browser include the error code and the raw upstream detail. Add ?off=1 to turn it off."
          : "Append ?key=<CRON_SECRET> to switch it on for this browser only.",
      },
      env.siteUrl,
    );
  }

  if (!env.cronSecret) {
    return page(
      {
        title: "Dev mode unavailable",
        body: "CRON_SECRET is not configured on this deployment, so there is no operator secret to check against.",
      },
      env.siteUrl,
      { status: 503 },
    );
  }

  if (!timingSafeEqual(key, env.cronSecret)) {
    // Same wording as a missing key: no hint about whether the guess was close.
    return page(
      { title: "Not authorised", body: "That key is not valid." },
      env.siteUrl,
      { status: 401 },
    );
  }

  return page(
    {
      title: "Dev mode on",
      body:
        "Error responses in this browser will now include the error code and the raw upstream detail. " +
        "Nobody else sees them. Visit /dev-mode?off=1 to turn it off.",
    },
    env.siteUrl,
    { set: await devModeToken(env.cronSecret) },
  );
}

function page(
  content: { title: string; body: string },
  siteUrl: string,
  options: { set?: string; clear?: boolean; status?: number } = {},
): Response {
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  });

  if (options.set) {
    headers.append(
      "Set-Cookie",
      // HttpOnly: nothing in the browser needs to read it, and it keeps the value
      // out of reach of any script on the page.
      `${DEV_MODE_COOKIE}=${options.set}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${60 * 60 * 24 * 30}`,
    );
  }
  if (options.clear) {
    headers.append(
      "Set-Cookie",
      `${DEV_MODE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`,
    );
  }

  return new Response(
    standalonePage({ title: content.title, body: content.body, siteUrl }),
    { status: options.status ?? 200, headers },
  );
}
