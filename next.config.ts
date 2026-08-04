import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Every image in this app is a hotlinked third-party URL (Ticketmaster's
    // CDN, YouTube thumbnails). Optimising them through Next would mean
    // proxying someone else's CDN on every render for no benefit, and both
    // providers' terms point towards serving their images directly.
    unoptimized: true,
  },
};

export default nextConfig;

// Gives `getCloudflareContext()` access to Cloudflare bindings during
// `next dev`, so local development sees the same env shape as production.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
void initOpenNextCloudflareForDev();
