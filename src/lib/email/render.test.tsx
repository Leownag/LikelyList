import { test } from "node:test";
import assert from "node:assert/strict";

import type { Digest, DigestEvent } from "@/lib/digest/types";
import {
  MAX_EMAIL_EVENTS,
  MAX_EMAIL_PERFORMERS,
  MAX_ONSALE_EVENTS,
} from "@/lib/digest/types";
import {
  GMAIL_CLIP_BYTES,
  buildPlainText,
  renderDigestEmail,
  renderWithinSizeBudget,
  shrinkOneStep,
} from "./render";

/** A worst-case-ish digest: many events, long bills, every field populated. */
function makeDigest(
  eventCount: number,
  performersPerEvent = 4,
  overrides: Partial<Digest> = {},
): Digest {
  const events: DigestEvent[] = Array.from({ length: eventCount }, (_, i) => ({
    tmEventId: `evt-${i}`,
    name: `A Reasonably Long Concert Name Number ${i}: The Extended Tour 2026`,
    url: `https://www.ticketmaster.com/event/${i}`,
    dateLabel: "Fri, Aug 7",
    timeLabel: "8:00 PM",
    localDate: "2026-08-07",
    venueName: "Roadrunner",
    cityLabel: "Boston, MA",
    imageUrl: `https://s1.ticketm.net/dam/a/abc/event-${i}_EVENT_DETAIL_PAGE_16_9.jpg`,
    genreName: "Rock",
    performers: Array.from({ length: performersPerEvent }, (_, p) => ({
      name: `Performer ${i}-${p} With A Long Band Name`,
      isHeadliner: p === 0,
      tmUrl: `https://www.ticketmaster.com/artist/${i}-${p}`,
      imageUrl: `https://s1.ticketm.net/dam/a/def/artist-${i}-${p}_ARTIST_PAGE_3_2.jpg`,
      youtubeUrl: `https://www.youtube.com/watch?v=video${i}${p}`,
      youtubeThumbnailUrl: `https://i.ytimg.com/vi/video${i}${p}/hqdefault.jpg`,
      spotifyUrl: `https://open.spotify.com/search/Performer%20${i}`,
    })),
    score: 10 - i,
    matchedArtists: i % 2 === 0 ? ["Turnstile"] : [],
  }));

  return {
    userId: "user-1",
    email: "listener@example.com",
    timezone: "America/New_York",
    windowLabel: "Aug 7 – Aug 13",
    events,
    totalEventCount: eventCount,
    onsale: [],
    cities: ["Boston", "Brooklyn"],
    fallbackReason: null,
    previewUrl: "https://likelylist.example.com/preview/digest/tok.sig",
    unsubscribeUrl: "https://likelylist.example.com/unsubscribe?t=tok.sig",
    unsubscribeMailto: "unsubscribe@mail.likelylist.example.com",
    siteUrl: "https://likelylist.example.com",
    ...overrides,
  };
}

test("a full digest renders well under Gmail's clipping threshold", async () => {
  const rendered = await renderDigestEmail(makeDigest(MAX_EMAIL_EVENTS, 4));
  assert.ok(
    rendered.bytes < GMAIL_CLIP_BYTES,
    `rendered ${rendered.bytes} bytes, must stay under ${GMAIL_CLIP_BYTES}`,
  );
});

test("an oversized digest is trimmed rather than clipped", async () => {
  // 40 events with 8 performers each would blow the budget if rendered whole.
  const rendered = await renderWithinSizeBudget(makeDigest(40, 8));
  assert.ok(
    rendered.bytes < GMAIL_CLIP_BYTES,
    `rendered ${rendered.bytes} bytes after trimming`,
  );
  // The unsubscribe link must survive the trim — that is the entire point.
  assert.ok(rendered.html.includes("/unsubscribe?t="));
});

test("the email carries no rounded corners", async () => {
  // Classic Outlook renders through Word and ignores border-radius, so the
  // design does not use it anywhere.
  const { html } = await renderDigestEmail(makeDigest(3));
  assert.ok(!/border-radius/i.test(html));
});

test("layout is tables only — no flexbox or grid", async () => {
  const { html } = await renderDigestEmail(makeDigest(3));
  assert.ok(!/display\s*:\s*flex/i.test(html));
  assert.ok(!/display\s*:\s*grid/i.test(html));
  assert.ok(html.includes("<table"));
});

test("every image has explicit dimensions, and content images have alt text", async () => {
  const { html } = await renderDigestEmail(makeDigest(3));
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  assert.ok(imgs.length > 0, "expected the digest to contain images");

  for (const img of imgs) {
    // Dimensions on everything: without them Outlook sizes images from the file
    // and the layout blows out before the image even loads.
    assert.match(img, /\swidth="?\d+/i, `image is missing width: ${img}`);
    assert.match(img, /\sheight="?\d+/i, `image is missing height: ${img}`);
    // An alt attribute must always be present, even if empty.
    assert.match(img, /\salt="/i, `image has no alt attribute at all: ${img}`);

    // The YouTube and Spotify marks are decorative: the word "YouTube" sits next
    // to them as real text, so alt="" is the correct accessible choice and a
    // duplicate label would be noise in a screen reader. The likelylist mark in the
    // header is decorative for the same reason — the wordmark beside it is live
    // text. Everything else carries information and must be described.
    const decorative = /\/brand\/|logo-mark\.png/.test(img);
    if (!decorative) {
      assert.match(
        img,
        /\salt="[^"]+"/i,
        `content image is missing alt text: ${img}`,
      );
    }
  }
});

test("the brand marks are present but never the only label", async () => {
  const { html } = await renderDigestEmail(makeDigest(2, 2));
  assert.ok(html.includes("/brand/youtube.svg"));
  assert.ok(html.includes("/brand/spotify.svg"));

  // With every image stripped, the service names must still be readable — an icon
  // that fails to load must not leave an unexplained gap where a link was.
  const withoutImages = html.replace(/<img\b[^>]*>/gi, "");
  assert.ok(withoutImages.includes("YouTube"));
  assert.ok(withoutImages.includes("Spotify"));
});

test("all images are https and no Spotify CDN images are hotlinked", async () => {
  const { html } = await renderDigestEmail(makeDigest(3));
  const sources = [...html.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/gi)].map((m) => m[1]);

  for (const src of sources) {
    assert.ok(src.startsWith("https://"), `image src must be https: ${src}`);
    // Spotify's i.scdn.co URLs expire, and an email lives in an inbox for weeks.
    assert.ok(!src.includes("scdn.co"), `must not hotlink Spotify images: ${src}`);
    // maxresdefault 404s unpredictably; a broken image in a delivered email
    // cannot be fixed.
    assert.ok(!src.includes("maxresdefault"), `must not use maxresdefault: ${src}`);
  }
});

test("the email reads without images: nothing is image-only", async () => {
  const digest = makeDigest(3);
  const { html } = await renderDigestEmail(digest);

  // Strip every image tag, then check the surviving text still carries the
  // essentials for each event.
  const withoutImages = html.replace(/<img\b[^>]*>/gi, "");
  for (const event of digest.events) {
    assert.ok(withoutImages.includes(event.name), `${event.name} missing`);
    assert.ok(withoutImages.includes("Roadrunner"), "venue missing");
    assert.ok(withoutImages.includes("Fri, Aug 7"), "date missing");

    // Only the performers the template actually renders. The rest are
    // deliberately summarised as a count, not omitted by accident — the assertion
    // is "nothing shown depends on an image", not "everything is shown".
    for (const performer of event.performers.slice(0, MAX_EMAIL_PERFORMERS)) {
      assert.ok(
        withoutImages.includes(performer.name),
        `${performer.name} missing`,
      );
    }
  }
  assert.ok(withoutImages.includes("/unsubscribe?t="));
});

test("performers are labelled honestly about billing order", async () => {
  const { html } = await renderDigestEmail(makeDigest(2, 3));
  assert.ok(html.includes("headliner"));
  assert.ok(html.includes("same bill"));

  // Ticketmaster publishes no billing order, so no performer may be given a
  // support role. The footer disclaimer is allowed to use the phrase — that is
  // the sentence explaining why we do not — so it is excluded before checking.
  const withoutDisclaimer = html.replace(
    /sharing the bill rather than[\s\S]*?opening acts?\.?/i,
    "",
  );
  assert.ok(!/opening act/i.test(withoutDisclaimer));
  assert.ok(!/\bopener\b/i.test(withoutDisclaimer));
  assert.ok(!/support act/i.test(withoutDisclaimer));
});

test("a long festival bill is summarised, not listed in full", async () => {
  // 12 acts on one bill: the tail must be counted rather than rendered, or the
  // email blows the size budget. Derived from the constant so tuning the cap for
  // byte budget reasons does not break this test.
  const bill = 12;
  const listed = MAX_EMAIL_PERFORMERS - 1; // the headliner takes one slot
  const hidden = bill - 1 - listed;

  const { html } = await renderDigestEmail(makeDigest(1, bill));
  assert.match(html, new RegExp(`\\+\\s*${hidden} more on the bill`));
  assert.ok(html.includes("see the full lineup"));

  // The listed ones are the first few; the summarised tail must not also appear.
  assert.ok(html.includes(`Performer 0-${listed} With A Long Band Name`));
  assert.ok(!html.includes(`Performer 0-${bill - 1} With A Long Band Name`));
});

test("an event with no identifiable headliner says so neutrally", async () => {
  const digest = makeDigest(1, 3);
  for (const performer of digest.events[0].performers) {
    performer.isHeadliner = false;
  }
  const { html } = await renderDigestEmail(digest);
  assert.ok(html.includes("on the bill"));
  assert.ok(!html.includes("headliner"));
});

test("an empty week still renders a usable email", async () => {
  const digest = makeDigest(0);
  const { html, text, subject } = await renderDigestEmail(digest);

  assert.match(subject, /Nothing matched/);
  assert.ok(html.includes("Nothing matched this week."));
  assert.ok(html.includes("/unsubscribe?t="));
  assert.ok(text.includes("Unsubscribe:"));
});

test("the plain-text part mirrors the HTML, links included", async () => {
  const digest = makeDigest(3, 2);
  const text = buildPlainText(digest);

  assert.ok(text.startsWith("LIKELYLIST"));
  for (const event of digest.events) {
    assert.ok(text.includes(event.name));
  }
  assert.ok(text.includes("YouTube: https://www.youtube.com/watch?v="));
  assert.ok(text.includes("Spotify: https://open.spotify.com/search/"));
  assert.ok(text.includes(digest.unsubscribeUrl));
  assert.ok(text.includes("https://www.youtube.com/t/terms"));
  assert.ok(text.includes("Ticketmaster"));

  // Same rule as the HTML: the only permitted mention is the disclaimer.
  const withoutDisclaimer = text.replace(
    /sharing the bill rather than[\s\S]*?opening acts?\.?/i,
    "",
  );
  assert.ok(!/opening act/i.test(withoutDisclaimer));
});

test("required attribution is present in the HTML", async () => {
  const { html } = await renderDigestEmail(makeDigest(2));
  assert.ok(html.includes("Ticketmaster"), "Ticketmaster attribution required");
  assert.ok(
    html.includes("https://www.youtube.com/t/terms"),
    "YouTube's developer policies require linking their Terms of Service",
  );
});

test("the subject names the acts rather than being generic", async () => {
  const { subject } = await renderDigestEmail(makeDigest(5, 2));
  assert.ok(subject.includes("Performer 0-0"));
  assert.ok(subject.includes("and 3 more"));
  assert.ok(subject.includes("Aug 7 – Aug 13"));
});

/** A full onsale section, for the shedding and disclosure tests. */
function onsaleRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    tmEventId: `onsale-${i}`,
    name: `Announced Band ${i} With A Long Tour Name`,
    url: `https://www.ticketmaster.com/event/onsale-${i}`,
    dateLabel: "Sat, Nov 15",
    venueName: "MGM Music Hall at Fenway",
    cityLabel: "Boston, MA",
    onsaleStart: "2026-08-08T14:00:00Z",
    matchedArtists: i === 0 ? ["Turnstile"] : [],
    score: 5 - i,
  }));
}

test("onsale times are rendered in the subscriber's own timezone", async () => {
  // 14:00Z is 10am Eastern and 7am Pacific. Getting this wrong sends someone to a
  // queue three hours after it opened, which is the exact failure the section
  // exists to prevent.
  const eastern = await renderDigestEmail(
    makeDigest(2, 2, { onsale: onsaleRows(1), timezone: "America/New_York" }),
  );
  assert.ok(eastern.html.includes("10:00 AM"), "expected 10:00 AM for Eastern");

  const pacific = await renderDigestEmail(
    makeDigest(2, 2, { onsale: onsaleRows(1), timezone: "America/Los_Angeles" }),
  );
  assert.ok(pacific.html.includes("7:00 AM"), "expected 7:00 AM for Pacific");
});

test("the budget sheds every onsale row before it sheds a single show", () => {
  // Ordering is the whole point: a dropped show is a listing the reader never
  // sees, while a dropped onsale row costs a line of text.
  let working = makeDigest(5, 2, { onsale: onsaleRows(MAX_ONSALE_EVENTS) });

  for (let remaining = MAX_ONSALE_EVENTS - 1; remaining >= 0; remaining--) {
    const smaller = shrinkOneStep(working);
    assert.ok(smaller, "expected a smaller digest while onsale rows remain");
    assert.equal(smaller.onsale.length, remaining);
    // Not one event has been touched yet.
    assert.equal(smaller.events.length, 5);
    working = smaller;
  }

  // Only now do events start going, and the last one is never given up.
  for (let remaining = 4; remaining >= 1; remaining--) {
    const smaller = shrinkOneStep(working);
    assert.ok(smaller);
    assert.equal(smaller.events.length, remaining);
    working = smaller;
  }
  assert.equal(shrinkOneStep(working), null);
  // The "view all N" count still reports the truth after all that trimming.
  assert.equal(working.totalEventCount, 5);
});

test("an onsale section survives in a digest that comfortably fits", async () => {
  const { html, text } = await renderWithinSizeBudget(
    makeDigest(3, 2, { onsale: onsaleRows(MAX_ONSALE_EVENTS) }),
  );
  assert.ok(html.includes("On sale this week"));
  assert.ok(html.includes("MGM Music Hall at Fenway"));
  // The plain-text part carries the section too, matched artists and all. Asserted
  // on the text rather than the HTML because JSX splits "because you follow" and
  // the name into separate nodes, so they are never contiguous in the markup.
  assert.ok(text.includes("ON SALE THIS WEEK"));
  assert.ok(text.includes("because you follow Turnstile"));
});

test("an unfiltered digest says so, in HTML and in text", async () => {
  // Presenting an unfiltered list as a filtered one teaches the reader that the
  // filtering is broken, so the disclosure has to reach both parts of the message
  // — including for someone whose client shows only plain text.
  const { html, text } = await renderDigestEmail(
    makeDigest(3, 2, { fallbackReason: "no_preferences" }),
  );
  assert.ok(html.includes("not a filtered"));
  assert.ok(text.includes("not a filtered"));
});
