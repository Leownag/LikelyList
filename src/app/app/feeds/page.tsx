import { createClient, requireProfile } from "@/lib/supabase/server";
import { Card, EmptyState, Notice, SectionHeading } from "@/components/ui";
import { PixelDot } from "@/components/pixel";
import { localDateString } from "@/lib/time";
import { USAGE_FEED_UPLOAD, type Feed } from "@/lib/db";
import { readEnv } from "@/lib/env";
import { FeedUploader } from "./feed-uploader";
import { PendingFeed } from "./pending-feed";

export const metadata = { title: "Feeds — likelylist" };

export default async function FeedsPage() {
  const { userId, profile } = await requireProfile();
  const supabase = await createClient();
  const env = readEnv();

  const today = localDateString(profile.timezone, new Date());

  const [feedsResult, usageResult] = await Promise.all([
    supabase
      .from("feeds")
      .select(
        "id, status, extracted, confidence, not_an_event, applied_at, error, created_at",
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
    | "not_an_event"
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
      !feed.not_an_event &&
      feed.extracted,
  );
  const history = feeds.filter((feed) => !awaitingReview.includes(feed));

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading
          hint="Screenshots are read once to work out which artists and genres you're into. The image itself is not stored."
        >
          Add a feed
        </SectionHeading>
        <FeedUploader />
        <p className="mt-3 text-xs text-faint">
          {remaining} of {env.feedDailyUploadLimit} reads left today.
        </p>
      </section>

      {awaitingReview.length > 0 ? (
        <section>
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
        </section>
      ) : null}

      <section>
        <SectionHeading>History</SectionHeading>
        {history.length === 0 ? (
          <EmptyState title="nothing yet">
            Paste your first show poster above.
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
                    color={statusColor(feed.status, feed.not_an_event)}
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
                  <span className="text-text">
                    {describe(feed)}
                  </span>
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
      </section>

      <Notice>
        Flyer reading is imperfect and always shown to you before it changes
        anything. Text inside an image is treated as content to transcribe, never
        as an instruction — so a screenshot cannot tell likelylist what to do.
      </Notice>
    </div>
  );
}

function statusColor(status: Feed["status"], notAnEvent: boolean): string {
  if (status === "failed") return "var(--danger)";
  if (notAnEvent) return "var(--faint)";
  if (status === "done") return "var(--pixel-1)";
  return "var(--pixel-3)";
}

function describe(feed: {
  status: Feed["status"];
  not_an_event: boolean;
  applied_at: string | null;
  extracted: Feed["extracted"];
}): string {
  if (feed.status === "failed") return "Could not be read";
  if (feed.status !== "done") return "Processing";
  if (feed.not_an_event) return "Not a show flyer — nothing learned";

  const count = feed.extracted?.artists.length ?? 0;
  if (feed.applied_at) {
    return `Applied · ${count} artist${count === 1 ? "" : "s"}`;
  }
  return `Read · ${count} artist${count === 1 ? "" : "s"}`;
}
