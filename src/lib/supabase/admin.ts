import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { AppEnv } from "@/lib/env";
import { requireKey } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS.
 *
 * Only the digest pipeline and the one-click unsubscribe endpoint use this —
 * both act on behalf of a user who is not present to hold a session. It must
 * never be constructed in code that can reach the browser, which is why the key
 * is read from an explicit AppEnv rather than a `NEXT_PUBLIC_` variable.
 */
export function createAdminClient(env: AppEnv) {
  return createSupabaseClient(
    env.supabaseUrl,
    requireKey(
      env.supabaseServiceRoleKey,
      "SUPABASE_SERVICE_ROLE_KEY",
      "the digest pipeline",
    ),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export type AdminClient = ReturnType<typeof createAdminClient>;
