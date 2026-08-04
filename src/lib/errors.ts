/**
 * Error handling contract.
 *
 * Two audiences, and they need different things:
 *
 *   The reader gets a sentence that says what happened and what to do about it.
 *   Never an upstream error string — those leak internals (model names, parameter
 *   names, provider hostnames, occasionally fragments of a request) and they are
 *   written for whoever wrote the API, not for someone trying to add a screenshot.
 *
 *   The operator gets the code and the raw detail, but only in dev mode. See
 *   lib/dev-mode.ts for how that is switched on in production without exposing it
 *   to everyone.
 *
 * The pattern: throw or construct an AppError with a stable `code` and a
 * human-readable `userMessage`, and attach the raw thing as `detail`. Routes hand
 * it to `errorResponse()`, which decides how much to say.
 */

/**
 * Stable machine codes.
 *
 * Stable because they end up in logs and in operator conversations. Add, never
 * repurpose.
 */
export const ErrorCode = {
  NOT_SIGNED_IN: "NOT_SIGNED_IN",
  NOT_FOUND: "NOT_FOUND",
  BAD_REQUEST: "BAD_REQUEST",

  FEED_IMAGE_TOO_LARGE: "FEED_IMAGE_TOO_LARGE",
  FEED_DAILY_LIMIT: "FEED_DAILY_LIMIT",
  FEED_EXTRACTION_FAILED: "FEED_EXTRACTION_FAILED",
  FEED_EXTRACTION_BUSY: "FEED_EXTRACTION_BUSY",
  FEED_NOT_READY: "FEED_NOT_READY",
  FEED_TOO_MANY_ARTISTS: "FEED_TOO_MANY_ARTISTS",

  SEARCH_FAILED: "SEARCH_FAILED",
  SEARCH_DAILY_LIMIT: "SEARCH_DAILY_LIMIT",
  SEARCH_TOO_FAST: "SEARCH_TOO_FAST",

  DIGEST_BUILD_FAILED: "DIGEST_BUILD_FAILED",
  EMAIL_SEND_FAILED: "EMAIL_SEND_FAILED",

  SUBSCRIBE_INVALID_EMAIL: "SUBSCRIBE_INVALID_EMAIL",
  SUBSCRIBE_RATE_LIMITED: "SUBSCRIBE_RATE_LIMITED",

  NOT_CONFIGURED: "NOT_CONFIGURED",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly status: number;
  /** Shown to the reader. Must be complete, plain, and free of internals. */
  readonly userMessage: string;
  /** Raw upstream text. Only ever revealed in dev mode. */
  readonly detail?: string;

  constructor(options: {
    code: ErrorCodeValue;
    status: number;
    userMessage: string;
    detail?: string;
    cause?: unknown;
  }) {
    // The Error message carries the detail so server logs stay useful; it is the
    // response body that is filtered, not the log.
    super(options.detail ?? options.userMessage, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.status = options.status;
    this.userMessage = options.userMessage;
    this.detail = options.detail;
  }
}

export type ErrorBody = {
  error: string;
  /** Present only in dev mode. */
  code?: ErrorCodeValue;
  /** Present only in dev mode. */
  detail?: string;
};

/**
 * The safe fallback for anything that was not deliberately turned into an
 * AppError. Deliberately vague, because by definition we do not know what it
 * contains.
 */
const UNEXPECTED: Omit<AppError, keyof Error | "detail"> & { userMessage: string } = {
  code: ErrorCode.INTERNAL,
  status: 500,
  userMessage: "Something went wrong on our side. Please try again in a moment.",
};

/** Builds the JSON body, revealing the code and detail only in dev mode. */
export function errorBody(error: unknown, devMode: boolean): ErrorBody {
  if (error instanceof AppError) {
    return devMode
      ? { error: error.userMessage, code: error.code, detail: error.detail }
      : { error: error.userMessage };
  }

  const raw = error instanceof Error ? error.message : String(error);
  return devMode
    ? { error: UNEXPECTED.userMessage, code: UNEXPECTED.code, detail: raw }
    : { error: UNEXPECTED.userMessage };
}

export function errorStatus(error: unknown): number {
  return error instanceof AppError ? error.status : UNEXPECTED.status;
}

/** Convenience for the common shapes. */
export const errors = {
  notSignedIn: () =>
    new AppError({
      code: ErrorCode.NOT_SIGNED_IN,
      status: 401,
      userMessage: "You need to be signed in to do that.",
    }),

  notFound: (what = "that") =>
    new AppError({
      code: ErrorCode.NOT_FOUND,
      status: 404,
      userMessage: `We couldn't find ${what}.`,
    }),

  badRequest: (userMessage: string, detail?: string) =>
    new AppError({
      code: ErrorCode.BAD_REQUEST,
      status: 400,
      userMessage,
      detail,
    }),

  notConfigured: (what: string, detail?: string) =>
    new AppError({
      code: ErrorCode.NOT_CONFIGURED,
      status: 503,
      // Phrased as our problem rather than naming the variable — a reader cannot
      // act on "SUPABASE_SERVICE_ROLE_KEY is not set", and it tells a stranger
      // about our infrastructure. The detail carries it for dev mode.
      userMessage: `${what} isn't available right now. This is on us — try again later.`,
      detail,
    }),
};
