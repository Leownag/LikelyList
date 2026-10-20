import { createClient, requireProfile } from "@/lib/supabase/server";
import { Card, EmptyState, Notice, SectionHeading } from "@/components/ui";
import { PixelDot } from "@/components/pixel";
import { localDateString } from "@/lib/time";
import { USAGE_FEED_UPLOAD, type Feed } from "@/lib/db";
import { readEnv } from "@/lib/env";
import { FeedUploader } from "./feed-uploader";
import { PendingFeed } from "./pending-feed";

/**
 * Screenshot import, as a section of the page it shapes.
 *
 * It used to be /app/feeds, a nav item of its own. That was the wrong shape: reading
 * artists off a screenshot is not a destination, it is one of four ways this page's
 * artist and genre weights get set — and having it elsewhere meant the result of an
 * upload appeared on a screen the reader had just left.
 */
export async function ScreenshotSection() {
  const { userId, profile } = await requireProfile();
  const supabase = await createClient();
  const env = readEnv();

  const today = localDateString(profile.timezone, new Date());

  const [feedsResult, usageResult] = await Promise.all([
    supabase
      .from("feeds")
      .select(
        "id, status, extracted, confidence, not_music_related, applied_at, error, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("usage_counters")
      .select("count")
      .eq("user_id", userId)
      .eq("day", today)
      .eq("kind", USAGE_FEED_UPLOAD)
      .maybeSingle<{ count: number }>(),
  ]);

  const feeds = (feedsResult.data ?? []) as Pick<
    Feed,
    | "id"
    | "status"
    | "extracted"
    | "confidence"
    | "not_music_related"
    | "applied_at"
    | "error"
    | "created_at"
  >[];

  const usedToday = usageResult.data?.count ?? 0;
  const remaining = Math.max(0, env.feedDailyUploadLimit - usedToday);

  const awaitingReview = feeds.filter(
    (feed) =>
      feed.status === "done" &&
      !feed.applied_at &&
      !feed.not_music_related &&
      feed.extracted,
  );
  const history = feeds.filter((feed) => !awaitingReview.includes(feed));

  return (
    <div className="space-y-8">
      <div>
        <SectionHeading hint="Screenshot whatever you're already listening to. likelylist reads the artist and song names and uses them to weight your digest.">
          From a screenshot
        </SectionHeading>
        <FeedUploader />
        <p className="mt-3 text-xs text-faint">
          {remaining} of {env.feedDailyUploadLimit} reads left today.
        </p>
      </div>

      {awaitingReview.length > 0 ? (
        <div>
          <SectionHeading hint="Read, but not applied yet. Nothing changes until you confirm.">
            Waiting for you
          </SectionHeading>
          <div className="space-y-3">
            {awaitingReview.map((feed) => (
              <PendingFeed
                key={feed.id}
                feedId={feed.id}
                extraction={feed.extracted!}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <SectionHeading>Screenshot history</SectionHeading>
        {history.length === 0 ? (
          <EmptyState title="nothing yet">
            Open Spotify, screenshot your home screen, and paste it above.
          </EmptyState>
        ) : (
          <Card className="divide-y divide-border">
            {history.map((feed) => (
              <div
                key={feed.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <PixelDot
                    size={6}
                    color={statusColor(feed.status, feed.not_music_related)}
                  />
                  <span className="text-muted">
                    {new Intl.DateTimeFormat("en-US", {
                      timeZone: profile.timezone,
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(feed.created_at))}
                  </span>
                  <span className="text-text">{describe(feed)}</span>
                </div>
                {feed.error ? (
                  <span className="font-mono text-xs text-danger">
                    {feed.error.slice(0, 80)}
                  </span>
                ) : null}
              </div>
            ))}
          </Card>
        )}
      </div>

      <Notice>
        Reading small text off a screenshot is imperfect, so every result is shown
        to you before it changes anything. The image itself is not kept — it is read
        once and dropped. Text inside an image is treated strictly as content to
        transcribe, never as an instruction, so a screenshot cannot tell likelylist
        what to do.
      </Notice>
    </div>
  );
}

function statusColor(status: Feed["status"], notMusicRelated: boolean): string {
  if (status === "failed") return "var(--danger)";
  if (notMusicRelated) return "var(--faint)";
  if (status === "done") return "var(--pixel-1)";
  return "var(--pixel-3)";
}

function describe(feed: {
  status: Feed["status"];
  not_music_related: boolean;
  applied_at: string | null;
  extracted: Feed["extracted"];
}): string {
  if (feed.status === "failed") return "Could not be read";
  if (feed.status !== "done") return "Processing";
  if (feed.not_music_related) return "Not music — nothing learned";

  // Counts both, because applying a screenshot can change either. Reporting
  // only artists meant a feed that contributed a genre and no names read as
  // "Applied · 0 artists" — true about artists, and an understatement of what
  // it actually did, while the genre grid credited that same feed.
  const artists = feed.extracted?.artists?.length ?? 0;
  const genres = feed.extracted?.genres?.length ?? 0;

  const parts: string[] = [];
  if (artists > 0) parts.push(`${artists} artist${artists === 1 ? "" : "s"}`);
  if (genres > 0) parts.push(`${genres} genre${genres === 1 ? "" : "s"}`);
  const what = parts.join(" · ") || "nothing legible";

  return feed.applied_at ? `Applied · ${what}` : `Read · ${what}`;
}
