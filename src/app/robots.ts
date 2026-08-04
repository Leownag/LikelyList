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
        allow: ["/", "/explore", "/privacy"],
        disallow: [
          "/app",
          "/api/",
          "/auth/",
          "/preview/",
          "/unsubscribe",
          "/login",
          // The language switcher is a link in the header of every public page, so a
          // crawler would otherwise follow four of them per page and be redirected
          // straight back — each round trip a Worker invocation, and a set-cookie
          // response Google would have to decide what to do with.
          "/lang",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
