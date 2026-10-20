"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readEnv } from "@/lib/env";
import { DIGEST_SEND_HOURS, TIMEZONES } from "@/lib/time";

/**
 * What `profiles.timezone` holds when nobody has chosen one.
 *
 * Mirrors the column default in migration 0001. Kept as a named constant so the
 * "has this ever been set" test is legible rather than a bare string compare.
 */
const UNCHOSEN_TIMEZONE = "America/New_York";

/** What the form shows after a submit. */
export type ScheduleState = { ok: true } | { ok: false; message: string };

/**
 * Returns its failures rather than throwing them.
 *
 * A thrown error from a server action reaches the reader as Next's error
 * boundary — a blank screen in place of the settings page, for something as
 * ordinary as a hour that is not on the list. The caller renders these in a
 * status line beside the save button instead.
 */
/**
 * Adopts the browser's timezone for a profile that has never had one chosen.
 *
 * Called once, from the client, right after requireProfile creates a row — the
 * only moment at which the stored value is a column default rather than
 * somebody's decision.
 *
 * Guarded server-side as well as client-side: it writes only while the stored
 * value is still that default, so a repeat or a crafted call cannot move a
 * timezone the reader has actually set.
 */
export async function adoptDetectedTimezone(zone: string): Promise<void> {
  if (!TIMEZONES.includes(zone as (typeof TIMEZONES)[number])) return;
  if (zone === UNCHOSEN_TIMEZONE) return;

  const user = await requireUser();
  const supabase = await createClient();

  await supabase
    .from("profiles")
    .update({ timezone: zone })
    .eq("id", user.id)
    .eq("timezone", UNCHOSEN_TIMEZONE);

  revalidatePath("/app/settings");
  revalidatePath("/app");
}

export async function updateSchedule(
  _state: ScheduleState | null,
  formData: FormData,
): Promise<ScheduleState> {
  const user = await requireUser();
  const supabase = await createClient();

  const timezone = String(formData.get("timezone") ?? "");
  const hour = Number(formData.get("digest_send_hour"));
  const enabled = formData.get("digest_enabled") === "on";

  // Validated against the offered list rather than trusted: an arbitrary string
  // here would make Intl throw every time the drainer computed a send time,
  // which would break this subscriber's digest permanently.
  if (!TIMEZONES.includes(timezone as (typeof TIMEZONES)[number])) {
    return { ok: false, message: "That is not one of the offered timezones." };
  }
  if (!(DIGEST_SEND_HOURS as readonly number[]).includes(hour)) {
    return { ok: false, message: "That is not one of the offered morning hours." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      timezone,
      digest_send_hour: hour,
      digest_enabled: enabled,
    })
    .eq("id", user.id);

  if (error) {
    return { ok: false, message: "Could not save that. Try again." };
  }

  revalidatePath("/app/settings");
  revalidatePath("/app");
  return { ok: true };
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

  // Not a bare "/": the reader lands on the marketing page, subscribe box and
  // all, with no acknowledgement that the thing they just typed DELETE to
  // confirm actually happened.
  redirect("/?deleted=1");
}
