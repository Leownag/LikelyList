import { z } from "zod";

/**
 * The shape the extractor is *constrained* to produce.
 *
 * Two rules make this work, and both are easy to get wrong:
 *
 *  1. Every field is `.nullable()`, never `.optional()`. OpenAI's strict mode
 *     requires every property to appear in `required`, so "the poster doesn't
 *     say" has to be expressed as an explicit null. This is the single most
 *     important detail here — without it the model fills gaps by inventing a
 *     venue or a start time, and an invented time in someone's calendar is
 *     worse than no time at all.
 *
 *  2. No refinements, defaults or transforms. Strict JSON-schema mode supports
 *     only a plain structural subset, so anything clever here fails at the API
 *     rather than at runtime.
 *
 * `raw_text` and the confidence fields exist so the confirmation UI can show the
 * user what was actually read, and so low-confidence rows can be flagged rather
 * than silently trusted.
 */

export const FeedArtistSchema = z.object({
  name: z.string(),
  /**
   * Billing role, when the flyer's layout makes it clear (big name on top vs.
   * small names underneath). This is the only place billing order is ever
   * available to us — Ticketmaster's API has no such field — which is why a
   * vision model reading the layout beats OCR that flattens it to text.
   */
  role: z.enum(["headliner", "support"]).nullable(),
  confidence: z.number().nullable(),
});

export const FeedExtractionSchema = z.object({
  /** True when the image plainly is not a show flyer or artist page. */
  not_an_event_poster: z.boolean(),
  artists: z.array(FeedArtistSchema),
  venue: z.string().nullable(),
  city: z.string().nullable(),
  /** Two-letter code when shown, else null. Never inferred from the city. */
  state: z.string().nullable(),
  /** ISO `YYYY-MM-DD` when a full date is legible, else null. */
  date: z.string().nullable(),
  /** 24-hour `HH:MM` when legible, else null. */
  time: z.string().nullable(),
  /** Genre words as printed, not mapped to any taxonomy. */
  genres: z.array(z.string()),
  ticket_url: z.string().nullable(),
  /** Everything legible, so the user can see what the model saw. */
  raw_text: z.string().nullable(),
  overall_confidence: z.number().nullable(),
});

export type FeedExtractionResult = z.infer<typeof FeedExtractionSchema>;

export const SCHEMA_NAME = "show_flyer_extraction";
