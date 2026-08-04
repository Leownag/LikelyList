"use server";

import { revalidatePath } from "next/cache";
import { createClient, requireUser } from "@/lib/supabase/server";

/**
 * Subscription and preference mutations.
 *
 * Server actions rather than route handlers: these are simple toggles driven
 * from a form, and running them through the request-scoped Supabase client
 * means RLS enforces ownership rather than this code having to.
 */

export async function toggleCity(cityId: number) {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("user_id", user.id)
    .eq("city_id", cityId)
    .maybeSingle();

  if (existing) {
    await supabase.from("subscriptions").delete().eq("id", existing.id);
  } else {
    await supabase
      .from("subscriptions")
      .insert({ user_id: user.id, city_id: cityId });
  }

  revalidatePath("/app/subscriptions");
  revalidatePath("/app");
}

/**
 * Turns a genre on or off.
 *
 * Turning one off records an explicit row with weight 0 rather than deleting it.
 * That distinction matters: feed processing only ever inserts a genre when the
 * user has *no* row for it, so a zero-weight row is a permanent opt-out. If
 * switching off simply deleted the row, the next flyer of that genre would
 * quietly turn it back on, and a user who said "not metal" would keep getting
 * metal.
 */
export async function toggleGenre(genreId: number) {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("genre_prefs")
    .select("id, weight")
    .eq("user_id", user.id)
    .eq("genre_id", genreId)
    .maybeSingle();

  const turningOn = !existing || existing.weight === 0;

  if (existing) {
    await supabase
      .from("genre_prefs")
      .update({ weight: turningOn ? 1 : 0, source: "explicit" })
      .eq("id", existing.id);
  } else {
    await supabase.from("genre_prefs").insert({
      user_id: user.id,
      genre_id: genreId,
      source: "explicit",
      weight: 1,
    });
  }

  revalidatePath("/app/subscriptions");
  revalidatePath("/app");
}

export async function removeArtistPref(artistPrefId: number) {
  const user = await requireUser();
  const supabase = await createClient();

  await supabase
    .from("artist_prefs")
    .delete()
    .eq("id", artistPrefId)
    .eq("user_id", user.id);

  revalidatePath("/app/subscriptions");
}

