import { NextResponse } from "next/server";
import { DIGEST_SEND_HOURS, DIGEST_WEEKDAY, TIMEZONES } from "@/lib/time";

/**
 * What is actually running here.
 *
 * Exists so a deploy can be verified rather than assumed. `npm run deploy`
 * reports success as soon as Cloudflare accepts the upload, which says nothing
 * about *what* was uploaded — a release tagged from an unmerged branch deployed
 * cleanly and shipped the previous build, and the only thing that revealed it
 * was someone asking whether a fix was live.
 *
 * Public and uncached on purpose. It carries no secret: the commit SHA of a
 * public repository, the version from package.json, and the two scheduling
 * constants a reader could read off the settings page anyway. Deliberately NOT
 * which third-party services are configured — that is a map of what to probe,
 * and `npm run preflight` already answers it for whoever holds the keys.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      sha: process.env.BUILD_SHA ?? "unknown",
      version: process.env.BUILD_VERSION ?? "unknown",
      digest: {
        // 0 = Sunday, matching Date#getUTCDay.
        weekday: DIGEST_WEEKDAY,
        sendHours: DIGEST_SEND_HOURS,
        timezones: TIMEZONES.length,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
