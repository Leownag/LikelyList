import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { readEnv } from "@/lib/env";
import { createOpenAiVisionProvider } from "@/lib/vision/openai";
import { VisionError } from "@/lib/vision/provider";
import { estimateDataUrlBytes } from "@/lib/vision/preprocess";
import { localDateString } from "@/lib/time";
import { USAGE_FEED_UPLOAD, type Profile } from "@/lib/db";

/** Decoded payload ceiling. The client downscales first; this is the backstop. */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

const BodySchema = z.object({
  dataUrl: z.string().regex(DATA_URL_PATTERN, "Expected a base64 image data URL"),
});

/**
 * Extracts structured data from one pasted or uploaded screenshot.
 *
 * The image is never persisted on the happy path. It is held in memory for the
 * length of this request, sent to the extractor, and dropped — only the
 * structured result is stored. If extraction fails the image *is* written to
 * private storage, so a retry does not make the user find the screenshot again.
 */
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const env = readEnv();
  if (!env.openaiApiKey) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY is not configured on the server, so screenshots cannot be read yet.",
      },
      { status: 503 },
    );
  }

  // Rejected on the declared length before the body is read. `request.json()`
  // buffers and decodes the whole payload, so checking the size only afterwards
  // means an oversized request has already consumed the memory and CPU it was
  // meant to be refused for. Base64 inflates by ~4/3, plus JSON overhead.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_IMAGE_BYTES * 1.4) {
    return NextResponse.json(
      { error: "That image is too large to process. Try a smaller screenshot." },
      { status: 413 },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Send a JSON body with a base64 image data URL." },
      { status: 400 },
    );
  }

  // Checked again on the decoded payload: content-length is client-supplied and
  // may be absent on a chunked request.
  const bytes = estimateDataUrlBytes(body.dataUrl);
  if (bytes === 0 || bytes > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "That image is too large to process. Try a smaller screenshot." },
      { status: 413 },
    );
  }

  const supabase = await createClient();

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle<Pick<Profile, "timezone">>();
  const timezone = profileRow?.timezone ?? "America/New_York";

  // Quota. Increment-then-check is deliberate: it is race-free, and the worst
  // case is counting one rejected attempt, which fails safe.
  const today = localDateString(timezone, new Date());
  const { data: usedToday, error: quotaError } = await supabase.rpc("bump_usage", {
    p_user_id: user.id,
    p_kind: USAGE_FEED_UPLOAD,
    p_day: today,
    p_amount: 1,
  });

  if (quotaError) {
    return NextResponse.json(
      { error: `Could not check your daily limit: ${quotaError.message}` },
      { status: 500 },
    );
  }
  if (typeof usedToday === "number" && usedToday > env.feedDailyUploadLimit) {
    return NextResponse.json(
      {
        error: `You've reached today's limit of ${env.feedDailyUploadLimit} screenshots. It resets at midnight in your timezone.`,
      },
      { status: 429 },
    );
  }

  const { data: feed, error: insertError } = await supabase
    .from("feeds")
    .insert({ user_id: user.id, status: "processing" })
    .select("id")
    .single<{ id: string }>();

  if (insertError || !feed) {
    return NextResponse.json(
      { error: `Could not start processing: ${insertError?.message}` },
      { status: 500 },
    );
  }

  const provider = createOpenAiVisionProvider(
    env.openaiApiKey,
    env.openaiVisionModel,
  );

  try {
    const extracted = await provider.extract({
      dataUrl: body.dataUrl,
      today,
    });

    await supabase
      .from("feeds")
      .update({
        status: "done",
        model: provider.model,
        extracted,
        confidence: extracted.overall_confidence,
        not_an_event: extracted.not_an_event_poster,
      })
      .eq("id", feed.id);

    return NextResponse.json({ id: feed.id, extracted });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = error instanceof VisionError ? error.retryable : false;

    // Keep the bytes only because extraction failed, so a retry does not need
    // the user to find the screenshot again.
    const imagePath = await stashForRetry(supabase, user.id, feed.id, body.dataUrl);

    await supabase
      .from("feeds")
      .update({
        status: "failed",
        model: provider.model,
        error: message,
        image_path: imagePath,
      })
      .eq("id", feed.id);

    return NextResponse.json(
      { id: feed.id, error: message, retryable },
      { status: retryable ? 503 : 502 },
    );
  }
}

async function stashForRetry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  feedId: string,
  dataUrl: string,
): Promise<string | null> {
  try {
    const [header, base64] = dataUrl.split(",");
    const mime = header.slice(5, header.indexOf(";"));
    const extension = mime.split("/")[1] ?? "png";
    // The first path segment is the ownership check in the storage policy.
    const path = `${userId}/${feedId}.${extension}`;

    const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const { error } = await supabase.storage
      .from("feeds")
      .upload(path, binary, { contentType: mime, upsert: true });

    return error ? null : path;
  } catch {
    // Losing the retry copy is not worth failing the request over.
    return null;
  }
}
