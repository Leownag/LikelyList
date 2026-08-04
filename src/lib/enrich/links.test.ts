import { test } from "node:test";
import assert from "node:assert/strict";

import {
  safeExternalUrl,
  spotifySearchUrl,
  youtubeSearchUrl,
  youtubeThumbnailUrl,
} from "./links";

test("search links encode names that would otherwise break the URL", () => {
  assert.equal(
    spotifySearchUrl("Sigur Rós"),
    "https://open.spotify.com/search/Sigur%20R%C3%B3s",
  );
  assert.equal(
    spotifySearchUrl("AC/DC"),
    "https://open.spotify.com/search/AC%2FDC",
  );
  // Spaces and the "+" in band names are the ones that actually break a query
  // string; encodeURIComponent leaves "!" alone, which is fine.
  assert.equal(
    youtubeSearchUrl("Godspeed You! Black Emperor"),
    "https://www.youtube.com/results?search_query=Godspeed%20You!%20Black%20Emperor%20live",
  );
  assert.ok(youtubeSearchUrl("Florence + the Machine").includes("%2B"));
});

test("thumbnails use hqdefault, never maxresdefault", () => {
  const url = youtubeThumbnailUrl("dQw4w9WgXcQ");
  assert.equal(url, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  // maxresdefault 404s unpredictably on older uploads, and a broken image in a
  // delivered email cannot be fixed.
  assert.ok(!url.includes("maxresdefault"));
});

test("safeExternalUrl accepts http(s) and rejects everything else", () => {
  assert.equal(
    safeExternalUrl("https://tickets.example.com/show"),
    "https://tickets.example.com/show",
  );
  assert.equal(safeExternalUrl("http://example.com/"), "http://example.com/");

  // ticket_url is read out of an untrusted image, so these must not survive to
  // become a rendered link.
  assert.equal(safeExternalUrl("javascript:alert(1)"), null);
  assert.equal(safeExternalUrl("data:text/html,<script>"), null);
  assert.equal(safeExternalUrl("file:///etc/passwd"), null);
  assert.equal(safeExternalUrl("not a url"), null);
  assert.equal(safeExternalUrl("#anchor"), null);
  assert.equal(safeExternalUrl(null), null);
  assert.equal(safeExternalUrl(""), null);
});
