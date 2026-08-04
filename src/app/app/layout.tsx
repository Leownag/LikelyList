import Link from "next/link";
import { requireProfile } from "@/lib/supabase/server";
import { Wordmark } from "@/components/wordmark";
import { PixelRule } from "@/components/pixel";

const NAV = [
  { href: "/app", label: "Overview" },
  { href: "/app/subscriptions", label: "Cities & genres" },
  { href: "/app/feeds", label: "Feeds" },
  { href: "/app/settings", label: "Settings" },
] as const;

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  // Every protected page re-verifies on the server rather than trusting the
  // proxy, which only refreshes the token.
  const { profile } = await requireProfile();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Wordmark />
        <div className="flex items-center gap-4">
          <span className="hidden text-xs text-faint sm:inline">
            {profile.email}
          </span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="text-xs text-muted underline hover:text-text"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <nav className="mt-8 flex flex-wrap gap-1">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="border border-transparent px-3 py-1.5 text-sm text-muted hover:border-border hover:text-text"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <PixelRule className="mt-3" />

      <main className="mt-8 flex-1">{children}</main>
    </div>
  );
}
