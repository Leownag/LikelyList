import type { FeedExtractionResult } from "./schema";

/**
 * Extraction provider interface.
 *
 * There is exactly one implementation today (OpenAI vision) and that is a
 * deliberate choice, not an oversight: for show flyers — stylised display type,
 * text over photography, non-linear layout — traditional OCR measures far worse
 * than a vision model, and more importantly it destroys the layout information
 * needed to tell a headliner from a support act.
 *
 * The interface exists so that swapping or adding a provider later does not
 * touch the route handler, the quota accounting or the confirmation UI.
 */
export type VisionProvider = {
  readonly name: string;
  /** Model identifier, recorded on the feed row for later debugging. */
  readonly model: string;
  extract(input: ExtractInput): Promise<FeedExtractionResult>;
};

export type ExtractInput = {
  /** `data:image/png;base64,...` — already downscaled by the client. */
  dataUrl: string;
  /**
   * Today's date in the user's timezone, as `YYYY-MM-DD`.
   *
   * Flyers routinely print "SAT AUG 9" with no year. Without a reference date
   * the model has to guess one, and it guesses its training cutoff.
   */
  today: string;
};

export class VisionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "VisionError";
  }
}
