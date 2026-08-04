import { z } from "zod";

/**
 * The shape the extractor is *constrained* to produce.
 *
 * What this reads is primarily a screenshot of a music app — a Spotify or Apple
 * Music home screen, a liked-songs list, a playlist, a top-artists page, a
 * now-playing screen. The point is to learn who someone actually listens to, so
 * artist and track names are the payload. A concert flyer is also accepted,
 * because people paste those too, but it is the secondary case rather than the
 * design target.
 *
 * Two rules make this work, and both are easy to get wrong:
 *
 *  1. Every field is `.nullable()`, never `.optional()`. OpenAI's strict mode
 *     requires every property to appear in `required`, so "the screenshot doesn't
 *     show this" has to be an explicit null. Without it the model fills gaps by
 *     inventing artists that were never on screen — and an invented artist
 *     silently reshapes someone's recommendations.
 *
 *  2. No refinements, defaults or transforms. Strict JSON-schema mode supports
 *     only a plain structural subset, so anything clever here fails at the API
 *     rather than at runtime.
 *
 * `raw_text` and the confidence fields exist so the confirmation UI can show the
 * user what was actually read, and so low-confidence rows can be flagged rather
 * than silently trusted.
 */

/** What the image appears to be. Drives the wording of the confirmation UI. */
export const SourceKindSchema = z.enum([
  "music_app",
  "playlist",
  "concert_flyer",
  "other",
]);

export const FeedArtistSchema = z.object({
  name: z.string(),
  /**
   * How central the artist is to the screenshot.
   *
   * `primary` — displayed as an artist in their own right: an artist tile, a
   *   followed-artists row, a top-artists list, the headline name on a flyer.
   * `mentioned` — only present as the performer of a listed track.
   *
   * Weighted differently when applied, because "I follow this artist" is a
   * stronger signal than "one of their songs appears in a playlist".
   */
  prominence: z.enum(["primary", "mentioned"]).nullable(),
  confidence: z.number().nullable(),
});

export const FeedTrackSchema = z.object({
  title: z.string(),
  /** Null when the screenshot shows a title with no artist beside it. */
  artist: z.string().nullable(),
});

export const FeedExtractionSchema = z.object({
  /** True when the image has nothing to do with music. */
  not_music_related: z.boolean(),
  source_kind: SourceKindSchema.nullable(),

  artists: z.array(FeedArtistSchema),
  tracks: z.array(FeedTrackSchema),
  /** Genre words actually printed on the image, not a classification. */
  genres: z.array(z.string()),

  /* Flyer-only fields. Null for a music app screenshot, which is the usual case. */
  venue: z.string().nullable(),
  city: z.string().nullable(),
  /** Two-letter code when shown, else null. Never inferred from the city. */
  state: z.string().nullable(),
  /** ISO `YYYY-MM-DD` when a full date is legible, else null. */
  date: z.string().nullable(),
  /** 24-hour `HH:MM` when legible, else null. */
  time: z.string().nullable(),
  ticket_url: z.string().nullable(),

  /** Everything legible, so the user can see what the model saw. */
  raw_text: z.string().nullable(),
  overall_confidence: z.number().nullable(),
});

export type FeedExtractionResult = z.infer<typeof FeedExtractionSchema>;
export type FeedSourceKind = z.infer<typeof SourceKindSchema>;

export const SCHEMA_NAME = "music_screenshot_extraction";

/** Human wording for what was recognised, used in the confirmation UI. */
export function describeSourceKind(kind: FeedSourceKind | null): string {
  switch (kind) {
    case "music_app":
      return "a music app screen";
    case "playlist":
      return "a playlist or song list";
    case "concert_flyer":
      return "a show flyer";
    case "other":
      return "something music-related";
    default:
      return "an image";
  }
}
