"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, requireUser } from "@/lib/supabase/server";
import type { PinInput } from "@/lib/pins/types";

/**
 * Pin and unpin.
 *
 * Server actions rather than a route handler: the callers are React components, so
 * this skips hand-writing a fetch and a JSON contract on both sides. Everything goes
 * through the request-scoped client, so RLS enforces ownership — the policies in
 * migration 0013 are what actually stop one reader touching another's pins, not the
 * `user_id` written below.
 *
 * The payload is validated even though it comes from our own UI. It arrives over the
 * network from a browser, which makes it input regardless of who wrote the form.
 */

const PinSchema = z.object({
  tmEventId: z.string().min(1).max(64),
  name: z.string().min(1).max(300),
  url: z.string().url().max(2000).nullable(),
  // Dates are stored as given, not parsed into an instant: the local reading is what
  // is printed on the ticket.
  localDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  localTime: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .nullable(),
  timezone: z.string().max(64).nullable(),
  venueName: z.string().max(300).nullable(),
  cityLabel: z.string().max(300).nullable(),
  imageUrl: z.string().url().max(2000).nullable(),
  genreName: z.string().max(120).nullable(),
  performers: z
    .array(
      z.object({
        name: z.string().min(1).max(300),
        isHeadliner: z.boolean(),
      }),
    )
    // Bounded because a festival bill is long and this is stored per pin. The card
    // shows a handful; keeping forty would be storing a lineup, not a reminder.
    .max(12)
    .default([]),
});

export async function pinEvent(input: PinInput): Promise<{ pinned: true }> {
  const user = await requireUser();
  const parsed = PinSchema.parse(input);
  const supabase = await createClient();

  // Upsert rather than insert: the unique constraint makes a second pin idempotent,
  // and a reader double-clicking should not see an error.
  const { error } = await supabase.from("pinned_events").upsert(
    {
      user_id: user.id,
      tm_event_id: parsed.tmEventId,
      name: parsed.name,
      url: parsed.url,
      local_date: parsed.localDate,
      local_time: parsed.localTime,
      timezone: parsed.timezone,
      venue_name: parsed.venueName,
      city_label: parsed.cityLabel,
      image_url: parsed.imageUrl,
      genre_name: parsed.genreName,
      performers: parsed.performers,
    },
    { onConflict: "user_id,tm_event_id" },
  );

  if (error) throw new Error(`Could not pin that: ${error.message}`);

  revalidatePath("/app/pinned");
  return { pinned: true };
}

export async function unpinEvent(tmEventId: string): Promise<{ pinned: false }> {
  const user = await requireUser();
  const supabase = await createClient();

  await supabase
    .from("pinned_events")
    .delete()
    .eq("user_id", user.id)
    .eq("tm_event_id", tmEventId);

  revalidatePath("/app/pinned");
  return { pinned: false };
}
