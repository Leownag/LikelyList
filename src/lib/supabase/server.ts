import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { redirect } from "next/navigation";
import type { Profile } from "@/lib/db";
import { accessTokenIsFresh } from "./session-cookie";

/**
 * Request-scoped Supabase client for server components, server actions and
 * route handlers.
 *
 * `cookies()` is async in Next 16 — synchronous access was removed, not just
 * deprecated — so this factory is async too.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server components cannot write cookies, and there is no proxy.ts to
            // refresh the session server-side (the Cloudflare adapter cannot run
            // one — see README), so refresh happens in components/session-sync.tsx.
            //
            // Anything that lands here is therefore *lost*, which is why getUser()
            // refuses to run when a refresh is imminent — see accessTokenIsFresh.
            // Route handlers and server actions, which *can* write cookies, do not
            // take this branch.
          }
        },
      },
    },
  );
}

/**
 * Returns the authenticated user, or null.
 *
 * Always `getUser()`, never `getSession()`: getSession trusts whatever is in
 * the cookie, while getUser revalidates it against the auth server. Anything
 * that gates access has to use this one.
 */
export async function getUser() {
  const cookieStore = await cookies();

  // A server component cannot write cookies. If auth-js refreshes here it rotates
  // the refresh token and the replacement is dropped by setAll above — the copy
  // still in the browser is then "Already Used", auth-js emits SIGNED_OUT, and the
  // reader is signed out for real. So: bail out before that happens and let
  // SessionSync, which *can* write the cookie, do the refresh.
  //
  // ponytail: costs one anonymous render on a cold arrival (a visible flash on /
  // and /explore, a bounce through /login inside /app). Removing that flash means
  // rendering a third "session is stale, hold on" state; not worth it until
  // someone complains about the flash rather than the sign-out.
  if (!accessTokenIsFresh(cookieStore.getAll())) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

/** Redirects to /login when not signed in. For use in protected pages. */
export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * The signed-in user plus their profile row.
 *
 * The profile is created by a database trigger on auth.users, but a brand-new
 * account can in principle reach a page before that row is visible, so this
 * backfills rather than assuming.
 */
export async function requireProfile(): Promise<{
  userId: string;
  profile: Profile;
}> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  if (data) return { userId: user.id, profile: data };

  const { data: created, error } = await supabase
    .from("profiles")
    .insert({ id: user.id, email: user.email ?? "" })
    .select("*")
    .single<Profile>();

  if (error || !created) {
    throw new Error(`Could not load or create a profile: ${error?.message}`);
  }
  return { userId: user.id, profile: created };
}
