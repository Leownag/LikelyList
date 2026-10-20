import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

const nextConfig: NextConfig = {
  // Inlined at build time, which is the only way the running Worker can know
  // which commit it was built from: Cloudflare's runtime env comes from wrangler
  // vars, not from the shell that ran the build. /api/health reports it, and the
  // smoke test compares it against local HEAD.
  //
  // The failure that earned this: a release was tagged and deployed from a
  // branch that had never been merged, so `npm run deploy` reported success
  // while shipping the previous build. Nothing noticed for an hour.
  env: {
    BUILD_SHA: process.env.BUILD_SHA ?? "unknown",
    // Read here rather than from process.env at runtime: npm_package_version is
    // a property of the shell npm ran the build in, and the Worker has no shell.
    BUILD_VERSION: version,
  },

  images: {
    // Every image in this app is a hotlinked third-party URL (Ticketmaster's
    // CDN, YouTube thumbnails). Optimising them through Next would mean
    // proxying someone else's CDN on every render for no benefit, and both
    // providers' terms point towards serving their images directly.
    unoptimized: true,
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // The one-click unsubscribe endpoint posts a form. Without a frame
          // guard it could be embedded invisibly and clicked through, which is
          // low-impact but trivially avoidable.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Inbox links carry a signed token in the path; do not leak it to the
          // sites a reader clicks through to.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

// Gives `getCloudflareContext()` access to Cloudflare bindings during
// `next dev`, so local development sees the same env shape as production.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
void initOpenNextCloudflareForDev();
