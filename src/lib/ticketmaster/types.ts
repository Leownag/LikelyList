/**
 * Ticketmaster Discovery API v2 response shapes.
 *
 * Everything here is optional except where the docs guarantee it, because the
 * API omits fields rather than nulling them and coverage varies per event. In
 * particular: `_embedded.attractions` is frequently absent entirely, and
 * `externalLinks` provider keys are undocumented.
 */

/** The one classification ID the official docs actually publish. */
export const MUSIC_SEGMENT_ID = "KZFzniwnSyZfZ7v7nJ";

export type TmImage = {
  url: string;
  ratio?: "16_9" | "3_2" | "4_3";
  width?: number;
  height?: number;
  /** True means this is a generic category image, not artwork for this item. */
  fallback?: boolean;
  attribution?: string;
};

export type TmClassificationRef = { id?: string; name?: string };

export type TmClassification = {
  primary?: boolean;
  segment?: TmClassificationRef;
  genre?: TmClassificationRef;
  subGenre?: TmClassificationRef;
  type?: TmClassificationRef;
  subType?: TmClassificationRef;
};

export type TmExternalLink = { id?: string; url?: string };

export type TmAttraction = {
  id: string;
  name: string;
  type?: string;
  url?: string;
  locale?: string;
  images?: TmImage[];
  classifications?: TmClassification[];
  aliases?: string[];
  localizedAliases?: Record<string, string[]>;
  /**
   * Documented as a map of provider key -> link array, but the docs never list
   * the provider keys and never show a populated example. Parse defensively.
   */
  externalLinks?: Record<string, TmExternalLink[]>;
  test?: boolean;
};

export type TmVenue = {
  id?: string;
  name?: string;
  city?: { name?: string };
  state?: { name?: string; stateCode?: string };
  country?: { name?: string; countryCode?: string };
  location?: { latitude?: string; longitude?: string };
  timezone?: string;
};

export type TmEvent = {
  id: string;
  name: string;
  url?: string;
  info?: string;
  pleaseNote?: string;
  images?: TmImage[];
  classifications?: TmClassification[];
  dates?: {
    start?: {
      localDate?: string;
      localTime?: string;
      dateTime?: string;
      /** True when only the date is confirmed. */
      dateTBD?: boolean;
      timeTBA?: boolean;
      noSpecificTime?: boolean;
    };
    timezone?: string;
    status?: { code?: string };
  };
  _embedded?: {
    venues?: TmVenue[];
    /**
     * All performers Ticketmaster has associated with the event — NOT an
     * ordered lineup. There is no billing/role field anywhere in the schema and
     * array order is neither documented nor guaranteed, so the headliner has to
     * be inferred (see inferHeadliner in ./lineup).
     */
    attractions?: TmAttraction[];
  };
};

export type TmPage = {
  size?: number;
  totalElements?: number;
  totalPages?: number;
  number?: number;
};

export type TmEventsResponse = {
  _embedded?: { events?: TmEvent[] };
  page?: TmPage;
};

export type TmAttractionsResponse = {
  _embedded?: { attractions?: TmAttraction[] };
  page?: TmPage;
};

export type TmGenreNode = {
  id: string;
  name: string;
  _embedded?: { subgenres?: { id: string; name: string }[] };
};

export type TmSegmentNode = {
  id: string;
  name: string;
  _embedded?: { genres?: TmGenreNode[] };
};

export type TmClassificationsResponse = {
  _embedded?: {
    classifications?: {
      segment?: TmSegmentNode;
      type?: { id: string; name: string };
    }[];
  };
  page?: TmPage;
};
