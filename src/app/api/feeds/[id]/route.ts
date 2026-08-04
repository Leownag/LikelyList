import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { readEnv } from "@/lib/env";
import { applyFeed } from "@/lib/feeds/apply";
import type { Feed } from "@/lib/db";

const BodySchema = z.object({
  artists: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        role: z.enum(["headliner", "support"]).nullable(),
      }),
    )
    .max(50),
  printedGenres: z.array(z.string().max(80)).max(20).default([]),
});

/**
 * Applies a user-confirmed extraction to their preferences.
 *
 * Split from extraction on purpose: the model's output is a proposal, and this
 * is the point at which the user has agreed to it (possibly after editing the
 * names). Nothing before this touches a preference.
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteContext<"/api/feeds/[id]">,
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // `params` is a promise in Next 16 — synchronous access was removed.
  const { id } = await params;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Send the confirmed artists and genres." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  // RLS would block a foreign row anyway; this makes the 404 explicit rather
  // than surfacing as a confusing empty update.
  const { data: feed } = await supabase
    .from("feeds")
    .select("id, status, applied_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle<Pick<Feed, "id" | "status" | "applied_at">>();

  if (!feed) {
    return NextResponse.json({ error: "No such feed." }, { status: 404 });
  }
  if (feed.status !== "done") {
    return NextResponse.json(
      { error: "That feed hasn't finished processing." },
      { status: 409 },
    );
  }

  const env = readEnv();

  const result = await applyFeed(supabase, {
    userId: user.id,
    feedId: feed.id,
    artists: body.artists,
    printedGenres: body.printedGenres,
    ticketmasterApiKey: env.ticketmasterApiKey,
  });

  return NextResponse.json(result);
}

/** Discards a feed and any retained image. */
export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext<"/api/feeds/[id]">,
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const supabase = await createClient();

  const { data: feed } = await supabase
    .from("feeds")
    .select("id, image_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle<Pick<Feed, "id" | "image_path">>();

  if (!feed) {
    return NextResponse.json({ error: "No such feed." }, { status: 404 });
  }

  if (feed.image_path) {
    await supabase.storage.from("feeds").remove([feed.image_path]);
  }
  await supabase.from("feeds").delete().eq("id", feed.id);

  return NextResponse.json({ ok: true });
}
