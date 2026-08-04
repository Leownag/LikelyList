import type { MetadataRoute } from "next";
import { siteUrlFromEnv } from "@/lib/site-url";

/**
 * Crawl rules.
 *
 * The important entries are `/preview/` and `/unsubscribe` — both carry a signed
 * token in the URL. Indexing them would publish those tokens, and a crawler
 * following an unsubscribe link is exactly the accident the GET handler already
 * guards against. Belt and braces.
 *
 * Everything behind sign-in is excluded too, not for secrecy (it is already
 * gated) but because a crawler hitting it just burns Worker invocations.
 */
export default function robots(): MetadataRoute.Robots {
  const siteUrl = siteUrlFromEnv();

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/privacy"],
        disallow: ["/app", "/api/", "/auth/", "/preview/", "/unsubscribe", "/login"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
