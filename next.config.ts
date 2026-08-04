import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
