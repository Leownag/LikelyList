import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for the seed scripts.
 *
 * Separate from src/lib/supabase/admin.ts because these scripts run under plain
 * Node with `tsx --env-file`, outside any Next or Worker request context.
 */
export function adminClientFromProcessEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. " +
        "Copy .env.example to .env.local and fill them in.",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
