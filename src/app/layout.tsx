import type { Metadata } from "next";
import { Geist, Geist_Mono, Silkscreen } from "next/font/google";
import "./globals.css";
import { SessionSync } from "@/components/session-sync";

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

export const metadata: Metadata = {
  title: "likelylist — shows you'd probably want to see",
  description:
    "A weekly Friday email of upcoming shows near you, picked from the cities and genres you follow and the flyers you feed it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${silkscreen.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-text">
        {/* Session refresh lives here rather than in a proxy.ts — see the note
            in SessionSync for why that file cannot exist in this project. */}
        <SessionSync />
        {children}
      </body>
    </html>
  );
}
