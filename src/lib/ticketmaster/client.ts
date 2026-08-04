import { requireKey } from "@/lib/env";

/**
 * Ticketmaster Discovery API client.
 *
 * The default quota is 5 requests/second and 5000 requests/day, and the API
 * reports its own state in response headers (`Rate-Limit`,
 * `Rate-Limit-Available`, `Rate-Limit-Reset`). We read those rather than
 * guessing, and serialise requests behind a minimum interval so a burst of
 * per-city queries in the weekly cron cannot trip the per-second limit.
 */

const BASE = "https://app.ticketmaster.com/discovery/v2";

/** 5 req/s is the documented ceiling; 220ms leaves headroom for clock skew. */
const MIN_INTERVAL_MS = 220;

/** Deep paging is capped at `size * page < 1000` regardless of `size`. */
export const DEEP_PAGING_LIMIT = 1000;

export class TicketmasterError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "TicketmasterError";
  }
}

export type RateLimitState = {
  limit: number | null;
  available: number | null;
  /** Epoch milliseconds, as the API reports it. */
  resetAt: number | null;
};

export type TmClient = {
  get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T>;
  rateLimit(): RateLimitState;
  requestCount(): number;
};

export function createTicketmasterClient(apiKey: string): TmClient {
  requireKey(apiKey, "TICKETMASTER_API_KEY", "event lookup");

  let nextAllowedAt = 0;
  let requests = 0;
  const rate: RateLimitState = { limit: null, available: null, resetAt: null };

  /** Serialises callers so concurrent requests still respect 5 req/s. */
  let chain: Promise<unknown> = Promise.resolve();

  async function throttle() {
    const wait = nextAllowedAt - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    nextAllowedAt = Date.now() + MIN_INTERVAL_MS;
  }

  async function request<T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
    attempt = 0,
  ): Promise<T> {
    await throttle();

    const url = new URL(`${BASE}${path}`);
    url.searchParams.set("apikey", apiKey);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    requests += 1;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    const limit = response.headers.get("Rate-Limit");
    const available = response.headers.get("Rate-Limit-Available");
    const reset = response.headers.get("Rate-Limit-Reset");
    if (limit) rate.limit = Number(limit);
    if (available) rate.available = Number(available);
    if (reset) rate.resetAt = Number(reset);

    if (response.status === 429 || response.status >= 500) {
      if (attempt >= 4) {
        throw new TicketmasterError(
          `Ticketmaster ${path} failed with ${response.status} after ${attempt + 1} attempts`,
          response.status,
          await safeText(response),
        );
      }
      // Prefer the server's own Retry-After; fall back to exponential backoff.
      const retryAfter = Number(response.headers.get("Retry-After"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(8000, 2 ** attempt * 500);
      await new Promise((r) => setTimeout(r, delay));
      return request<T>(path, params, attempt + 1);
    }

    if (!response.ok) {
      throw new TicketmasterError(
        `Ticketmaster ${path} returned ${response.status}`,
        response.status,
        await safeText(response),
      );
    }

    return (await response.json()) as T;
  }

  return {
    get<T>(
      path: string,
      params?: Record<string, string | number | undefined>,
    ): Promise<T> {
      // Queue behind whatever is in flight so the throttle is actually serial.
      const result = chain.then(() => request<T>(path, params));
      chain = result.catch(() => undefined);
      return result;
    },
    rateLimit: () => ({ ...rate }),
    requestCount: () => requests,
  };
}

async function safeText(response: Response): Promise<string | undefined> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return undefined;
  }
}
