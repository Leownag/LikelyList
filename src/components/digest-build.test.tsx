import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { DigestSummaryPanel } from "./digest-build";

const summary = {
  subject: "Your week — 6 shows near Boston",
  window: "2026-10-21 … 2026-10-27",
  eventCount: 6,
  cities: ["Boston, MA"],
  bytes: 10_842,
  withinGmailLimit: true,
  sent: false,
  previewUrl: "https://likelylist.tech/preview/digest/abc",
};

test("a reader without dev mode still gets the result and the link", () => {
  // The regression this exists for. The whole panel sat behind one flag, so in
  // production — where isDevMode is false without the cookie — pressing "Build
  // it now" produced no preview, no count, no error and no link: just a button
  // that locked itself for three minutes. Hiding the byte size had hidden the
  // answer with it.
  const html = renderToStaticMarkup(<DigestSummaryPanel summary={summary} />);

  assert.match(html, /6 shows/, "the reader is not told what was built");
  assert.match(html, /preview\/digest\/abc/, "the link to read it is missing");
  assert.match(html, /Not emailed/, "it does not say whether mail was sent");

  // And none of the operator detail.
  assert.doesNotMatch(html, /Gmail/, "Gmail's clip limit leaked to a reader");
  assert.doesNotMatch(html, /10\.6 KB/, "byte size leaked to a reader");
  assert.doesNotMatch(html, /Your week —/, "the raw subject line leaked");
});

test("dev mode adds the operator rows without removing anything", () => {
  const html = renderToStaticMarkup(
    <DigestSummaryPanel summary={summary} diagnostics />,
  );

  assert.match(html, /6 shows/);
  assert.match(html, /preview\/digest\/abc/);
  assert.match(html, /Gmail/);
  assert.match(html, /10\.6 KB/);
});

test("an empty week says so rather than rendering nothing", () => {
  // Second half of the same report: with no shows the panel had nothing to put
  // in its table and simply did not explain itself.
  const html = renderToStaticMarkup(
    <DigestSummaryPanel summary={{ ...summary, eventCount: 0 }} />,
  );

  assert.match(html, /nothing on for your week/i);
  assert.match(html, /refreshed by the weekly run/i);
});

test("an error reaches the reader whether or not dev mode is on", () => {
  for (const diagnostics of [false, true]) {
    const html = renderToStaticMarkup(
      <DigestSummaryPanel
        summary={{ error: "Ticketmaster is not answering." }}
        diagnostics={diagnostics}
      />,
    );
    assert.match(html, /Ticketmaster is not answering/, `diagnostics=${diagnostics}`);
  }
});
