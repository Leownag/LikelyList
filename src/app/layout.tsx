import type { Metadata } from "next";
import { Geist, Geist_Mono, Silkscreen } from "next/font/google";
import "./globals.css";
import { SessionSync } from "@/components/session-sync";
import { I18nProvider } from "@/lib/i18n/client";
import { getI18n } from "@/lib/i18n/server";
import { siteUrlFromEnv } from "@/lib/site-url";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// True 1-bit pixel face. Used for the wordmark and small uppercase labels only
// — it is unreadable as body copy, and it cannot be loaded inside an email, so
// the digest template falls back to web-safe fonts.
const silkscreen = Silkscreen({
  variable: "--font-silkscreen",
  weight: ["400", "700"],
  subsets: ["latin"],
});

const DESCRIPTION =
  "A weekly Wednesday email of upcoming shows near you, picked from the cities and genres you follow and the flyers you feed it.";

export const metadata: Metadata = {
  // Required for the `alternates` and `openGraph` URLs below to resolve absolute.
  // NEXT_PUBLIC_SITE_URL is inlined at build time, so a build with the wrong value
  // points every canonical at the wrong origin — see the release checklist in README.
  metadataBase: new URL(siteUrlFromEnv()),
  title: {
    default: "likelylist — shows you'd probably want to see",
    // Every other page supplies a bare title; the suffix is added here rather than
    // repeated by hand in nine files.
    template: "%s — likelylist",
  },
  description: DESCRIPTION,
  // Deliberately no title or description here. A page-level `openGraph` *replaces* this
  // object rather than merging into it, so anything named here is a field every page has
  // to repeat or silently lose. Left absent, og:title and og:description fall back to
  // each page's own title and description, which is what a share card should say.
  openGraph: {
    type: "website",
    siteName: "likelylist",
    locale: "en_US",
  },
  // No image is declared yet. A card with no image degrades to a text card; a card
  // pointing at a 404 renders as broken, which is the worse of the two.
  twitter: { card: "summary_large_image" },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Resolved once here, for the whole tree: `lang` on <html> has to agree with the copy
  // below it, and the provider is what lets client components translate without each one
  // re-deriving the locale and flashing the wrong language on hydration.
  const { locale, htmlLang } = await getI18n();

  return (
    <html
      lang={htmlLang}
      className={`${geistSans.variable} ${geistMono.variable} ${silkscreen.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-text">
        {/* Session refresh lives here rather than in a proxy.ts — see the note
            in SessionSync for why that file cannot exist in this project. */}
        <SessionSync />
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
