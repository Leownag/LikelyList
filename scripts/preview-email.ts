/**
 * Renders the digest email to a file with sample data.
 *
 * Run with: npm run preview:email
 *
 * Exists because email is the one surface you cannot iterate on in a dev server:
 * it has to be looked at as static HTML, and its size has to be measured rather
 * than eyeballed. Prints the byte count against Gmail's clipping threshold.
 */

import { writeFile } from "node:fs/promises";
import { GMAIL_CLIP_BYTES, renderWithinSizeBudget } from "../src/lib/email/render";
import type { Digest, DigestEvent } from "../src/lib/digest/types";

const SAMPLE_EVENTS: Omit<DigestEvent, "performers">[] = [
  {
    tmEventId: "e1",
    name: "Turnstile: Never Enough Tour",
    url: "https://www.ticketmaster.com/event/e1",
    dateLabel: "Fri, Aug 7",
    timeLabel: "8:00 PM",
    localTime: "20:00:00",
    timezone: "America/New_York",
    localDate: "2026-08-07",
    venueName: "Roadrunner",
    cityLabel: "Boston, MA",
    imageUrl:
      "https://s1.ticketm.net/dam/a/1e1/sample_EVENT_DETAIL_PAGE_16_9.jpg",
    genreName: "Rock",
    score: 12,
    matchedArtists: ["Turnstile"],
  },
  {
    tmEventId: "e2",
    name: "Boston Calling Music Festival — Day 2",
    url: "https://www.ticketmaster.com/event/e2",
    dateLabel: "Sat, Aug 8",
    timeLabel: "12:00 PM",
    localTime: "12:00:00",
    timezone: "America/New_York",
    localDate: "2026-08-08",
    venueName: "Harvard Athletic Complex",
    cityLabel: "Boston, MA",
    imageUrl: null,
    genreName: "Alternative",
    score: 6,
    matchedArtists: [],
  },
  {
    tmEventId: "e3",
    name: "Wednesday",
    url: "https://www.ticketmaster.com/event/e3",
    dateLabel: "Tue, Aug 11",
    timeLabel: null,
    localTime: null,
    timezone: "America/New_York",
    localDate: "2026-08-11",
    venueName: "Brighton Music Hall",
    cityLabel: "Boston, MA",
    imageUrl:
      "https://s1.ticketm.net/dam/a/3e3/sample_EVENT_DETAIL_PAGE_16_9.jpg",
    genreName: "Rock",
    score: 3,
    matchedArtists: [],
  },
];

function performers(names: string[], headliner: string | null) {
  return names.map((name) => ({
    name,
    isHeadliner: name === headliner,
    tmUrl: `https://www.ticketmaster.com/artist/${encodeURIComponent(name)}`,
    imageUrl: "https://s1.ticketm.net/dam/a/aaa/sample_ARTIST_PAGE_3_2.jpg",
    youtubeUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(name)}`,
    youtubeThumbnailUrl: null,
    spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(name)}`,
  }));
}

const digest: Digest = {
  userId: "sample-user",
  email: "you@example.com",
  timezone: "America/New_York",
  windowLabel: "Aug 7 – Aug 13",
  events: [
    // Headliner identifiable from the title.
    { ...SAMPLE_EVENTS[0], performers: performers(["Turnstile", "Blood Orange", "Mannequin Pussy"], "Turnstile") },
    // A festival: no headliner can be justified, and the bill is long enough to
    // exercise the "+ N more" summary.
    {
      ...SAMPLE_EVENTS[1],
      performers: performers(
        [
          "Fontaines D.C.",
          "Japanese Breakfast",
          "Militarie Gun",
          "Been Stellar",
          "घर",
          "Sigur Rós",
        ],
        null,
      ),
    },
    // Single act, no image, no time printed.
    { ...SAMPLE_EVENTS[2], performers: performers(["Wednesday"], "Wednesday") },
  ],
  totalEventCount: 17,
  // A full section, so the measured size is the worst realistic case rather than
  // the one that happens to be cheap.
  onsale: [
    {
      tmEventId: "onsale-1",
      name: "Turnstile — Never Enough Tour",
      url: "https://www.ticketmaster.com/event/onsale-1",
      dateLabel: "Sat, Nov 15",
      venueName: "MGM Music Hall at Fenway",
      cityLabel: "Boston, MA",
      onsaleStart: "2026-08-08T14:00:00Z",
      matchedArtists: ["Turnstile"],
      score: 5.5,
    },
    {
      tmEventId: "onsale-2",
      name: "Japanese Breakfast",
      url: "https://www.ticketmaster.com/event/onsale-2",
      dateLabel: "Thu, Oct 2",
      venueName: "Roadrunner",
      cityLabel: "Boston, MA",
      onsaleStart: "2026-08-08T14:00:00Z",
      matchedArtists: [],
      score: 1,
    },
    {
      tmEventId: "onsale-3",
      name: "black midi",
      url: "https://www.ticketmaster.com/event/onsale-3",
      dateLabel: "Fri, Dec 5",
      venueName: "Brooklyn Steel",
      cityLabel: "Brooklyn, NY",
      onsaleStart: "2026-08-11T15:00:00Z",
      matchedArtists: [],
      score: 1,
    },
    {
      tmEventId: "onsale-4",
      name: "Godspeed You! Black Emperor",
      url: "https://www.ticketmaster.com/event/onsale-4",
      dateLabel: "Sun, Jan 18",
      venueName: "Paradise Rock Club",
      cityLabel: "Boston, MA",
      onsaleStart: "2026-08-12T17:00:00Z",
      matchedArtists: [],
      score: 1,
    },
  ],
  cities: ["Boston", "Brooklyn"],
  fallbackReason: null,
  ordering: "relevance" as const,
  previewUrl: "http://localhost:3000/preview/digest/sample.token",
  unsubscribeUrl: "http://localhost:3000/unsubscribe?t=sample.token",
  unsubscribeMailto: "unsubscribe@mail.example.com",
  siteUrl: "http://localhost:3000",
};

const OUT_HTML = "email-preview.html";
const OUT_TEXT = "email-preview.txt";

// Wrapped rather than using top-level await: this package is CommonJS, so tsx
// transpiles to CJS and rejects a top-level await.
async function main() {
  const rendered = await renderWithinSizeBudget(digest);

  await writeFile(OUT_HTML, rendered.html, "utf8");
  await writeFile(OUT_TEXT, rendered.text, "utf8");

  const kb = (rendered.bytes / 1024).toFixed(1);
  const limit = (GMAIL_CLIP_BYTES / 1024).toFixed(0);

  console.log(`subject: ${rendered.subject}`);
  console.log(`html:    ${OUT_HTML} (${kb} KB of ${limit} KB before Gmail clips)`);
  console.log(`text:    ${OUT_TEXT}`);

  if (rendered.bytes >= GMAIL_CLIP_BYTES) {
    console.error(
      "\nOVER Gmail's clipping threshold — the unsubscribe link would be hidden.",
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
