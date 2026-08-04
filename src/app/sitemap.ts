import type { MetadataRoute } from "next";
import { siteUrlFromEnv } from "@/lib/site-url";

/**
 * Only the two pages that should be indexed at all.
 *
 * Everything else is either behind sign-in or carries a token in the URL, so
 * listing it would be actively harmful rather than merely useless.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = siteUrlFromEnv();

  return [
    { url: siteUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
