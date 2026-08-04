/**
 * A pinned event, as the UI sees it.
 *
 * Its own module for the same reason as lib/explore/types: both a client component and
 * a server action reference it, and importing a type from a route or an action file
 * drags that module into the client bundle.
 */

export type PinnedPerformer = {
  name: string;
  isHeadliner: boolean;
};

/**
 * Everything needed to render a pin — deliberately a copy rather than a reference.
 *
 * `events_cache` lives for 36 hours because Ticketmaster's terms forbid archiving
 * listings, so a pin that pointed at it would go blank in two days.
 */
export type PinInput = {
  tmEventId: string;
  name: string;
  url: string | null;
  /** Venue-local, `YYYY-MM-DD`. */
  localDate: string | null;
  /** Venue-local `HH:MM:SS`. */
  localTime: string | null;
  /** The venue's IANA zone. Required by "add to calendar" to resolve an instant. */
  timezone: string | null;
  venueName: string | null;
  cityLabel: string | null;
  imageUrl: string | null;
  genreName: string | null;
  performers: PinnedPerformer[];
};

export type Pin = PinInput & {
  id: number;
  pinnedAt: string;
};
