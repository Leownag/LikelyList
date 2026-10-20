"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readEnv } from "@/lib/env";
import { DIGEST_SEND_HOURS, TIMEZONES } from "@/lib/time";

export async function updateSchedule(formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();

  const timezone = String(formData.get("timezone") ?? "");
  const hour = Number(formData.get("digest_send_hour"));
  const enabled = formData.get("digest_enabled") === "on";

  // Validated against the offered list rather than trusted: an arbitrary string
  // here would make Intl throw every time the drainer computed a send time,
  // which would break this subscriber's digest permanently.
  if (!TIMEZONES.includes(timezone as (typeof TIMEZONES)[number])) {
    throw new Error("Unrecognised timezone.");
  }
  if (!(DIGEST_SEND_HOURS as readonly number[]).includes(hour)) {
    throw new Error("Send hour must be one of the offered morning hours.");
  }

  await supabase
    .from("profiles")
    .update({
      timezone,
      digest_send_hour: hour,
      digest_enabled: enabled,
    })
    .eq("id", user.id);

  revalidatePath("/app/settings");
  revalidatePath("/app");
}

/**
 * Deletes the account and everything attached to it.
 *
 * Removing the auth user is what actually cascades: every application table
 * references profiles(id), which references auth.users(id) with ON DELETE
 * CASCADE. Deleting a user requires the service role, so this is the one server
 * action that reaches for the admin client — after re-verifying the session, and
 * using only the id from that session.
 */
export async function deleteAccount(formData: FormData) {
  const user = await requireUser();

  // Typing the word is the confirmation; a single click should not be able to do
  // this by accident.
  if (String(formData.get("confirm") ?? "").trim().toLowerCase() !== "delete") {
    throw new Error("Type DELETE to confirm.");
  }

  const env = readEnv();
  const admin = createAdminClient(env);

  // Any retained feed images live under a folder named for the user id. Storage
  // objects are not covered by the database cascade, so they go first.
  const { data: files } = await admin.storage.from("feeds").list(user.id);
  if (files && files.length > 0) {
    await admin.storage
      .from("feeds")
      .remove(files.map((file) => `${user.id}/${file.name}`));
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) throw new Error(`Could not delete the account: ${error.message}`);

  const supabase = await createClient();
  await supabase.auth.signOut();

  redirect("/");
}
