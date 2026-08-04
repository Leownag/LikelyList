"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps the auth cookie fresh from the browser.
 *
 * This exists in place of a `proxy.ts` (what Next 15 called middleware), which is
 * the conventional home for Supabase token refresh. That is not an option here:
 * Next 16 runs Proxy on the Node.js runtime and explicitly forbids opting into
 * Edge — setting `runtime` in a Proxy file throws — and `@opennextjs/cloudflare`
 * does not support Node middleware, so a `proxy.ts` present in the tree makes the
 * Cloudflare build produce no worker at all.
 *   https://github.com/opennextjs/opennextjs-cloudflare/issues/962
 *
 * What this does instead: the browser Supabase client can both read the session
 * cookie and write a refreshed one, because `@supabase/ssr` stores it as a
 * JS-readable cookie rather than HttpOnly. Calling getSession() on mount triggers
 * a refresh if the access token has expired, and router.refresh() then makes the
 * server re-read the new cookie.
 *
 * The residual gap: a hard navigation made *after* the access token expired can
 * still render one server pass without a session, which may bounce the reader to
 * /login. Because this component lives in the root layout it runs there too, so
 * the refresh happens and they are moved straight into the app. The visible cost
 * is a flash, not a dead end.
 */
export function SessionSync() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    // Triggers a refresh when the stored access token has expired, and writes the
    // new one back to the cookie the server reads.
    void supabase.auth.getSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === "TOKEN_REFRESHED" ||
        event === "SIGNED_IN" ||
        event === "SIGNED_OUT"
      ) {
        // Re-render server components against the updated cookie.
        router.refresh();
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  return null;
}
