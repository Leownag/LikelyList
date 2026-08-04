import { test } from "node:test";
import assert from "node:assert/strict";
import { zodResponseFormat } from "openai/helpers/zod";

import { FeedExtractionSchema, SCHEMA_NAME, describeSourceKind } from "./schema";

/**
 * Guards the two properties extraction correctness depends on. Both are produced
 * by the zod helper rather than written out by hand, so they need asserting rather
 * than assuming — a stray `.optional()` in schema.ts would silently reintroduce
 * invented artist names.
 */

type JsonSchemaNode = {
  type?: unknown;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  $ref?: string;
  $defs?: Record<string, JsonSchemaNode>;
};

const format = zodResponseFormat(FeedExtractionSchema, SCHEMA_NAME);
const root = format.json_schema.schema as JsonSchemaNode;

/** Walks every object node, following $ref into $defs. */
function eachObjectNode(
  node: JsonSchemaNode,
  defs: Record<string, JsonSchemaNode>,
  visit: (node: JsonSchemaNode) => void,
  seen = new Set<JsonSchemaNode>(),
) {
  if (!node || seen.has(node)) return;
  seen.add(node);

  if (node.$ref) {
    const name = node.$ref.split("/").pop();
    const target = name ? defs[name] : undefined;
    if (target) eachObjectNode(target, defs, visit, seen);
    return;
  }

  if (node.properties) {
    visit(node);
    for (const child of Object.values(node.properties)) {
      eachObjectNode(child, defs, visit, seen);
    }
  }
  if (node.items) eachObjectNode(node.items, defs, visit, seen);
  for (const branch of node.anyOf ?? []) eachObjectNode(branch, defs, visit, seen);
}

/** A complete, minimal extraction of a music app screenshot. */
function musicAppExtraction(overrides: Record<string, unknown> = {}) {
  return {
    not_music_related: false,
    source_kind: "music_app",
    artists: [
      { name: "Turnstile", prominence: "primary", confidence: 0.95 },
      { name: "Blood Orange", prominence: "mentioned", confidence: 0.7 },
      { name: "Unclear", prominence: null, confidence: 0.3 },
    ],
    tracks: [
      { title: "NEVER ENOUGH", artist: "Turnstile" },
      { title: "A Song With No Artist Shown", artist: null },
    ],
    genres: ["hardcore"],
    // Null for a music app screen, which is the usual case.
    venue: null,
    city: null,
    state: null,
    date: null,
    time: null,
    ticket_url: null,
    raw_text: "Made For You · Your Top Songs",
    overall_confidence: 0.9,
    ...overrides,
  };
}

test("the response format is strict", () => {
  assert.equal(format.type, "json_schema");
  assert.equal(format.json_schema.strict, true);
  assert.equal(format.json_schema.name, SCHEMA_NAME);
});

test("every property is required and no extra keys are allowed", () => {
  const defs = root.$defs ?? {};
  let checked = 0;

  eachObjectNode(root, defs, (node) => {
    checked += 1;
    const properties = Object.keys(node.properties ?? {});
    const required = node.required ?? [];

    assert.deepEqual(
      [...properties].sort(),
      [...required].sort(),
      `object with properties [${properties.join(", ")}] has required [${required.join(", ")}]`,
    );
    assert.equal(
      node.additionalProperties,
      false,
      "additionalProperties must be false under strict mode",
    );
  });

  // Root, artist and track objects.
  assert.ok(checked >= 3, `expected to inspect at least 3 objects, saw ${checked}`);
});

test("absent information is expressible as null, not as a missing key", () => {
  const properties = root.properties ?? {};

  for (const field of [
    "source_kind",
    "venue",
    "city",
    "state",
    "date",
    "time",
    "ticket_url",
    "raw_text",
    "overall_confidence",
  ]) {
    const node = properties[field];
    assert.ok(node, `${field} should be present in the schema`);
    assert.match(
      JSON.stringify(node),
      /null/,
      `${field} must accept null so "not shown" is representable`,
    );
  }
});

test("a music app screenshot parses", () => {
  assert.doesNotThrow(() => FeedExtractionSchema.parse(musicAppExtraction()));
});

test("a fully-null, nothing-found extraction parses", () => {
  assert.doesNotThrow(() =>
    FeedExtractionSchema.parse({
      not_music_related: true,
      source_kind: null,
      artists: [],
      tracks: [],
      genres: [],
      venue: null,
      city: null,
      state: null,
      date: null,
      time: null,
      ticket_url: null,
      raw_text: null,
      overall_confidence: null,
    }),
  );
});

test("a truncated extraction is rejected", () => {
  const missingTracks: Record<string, unknown> = musicAppExtraction();
  delete missingTracks.tracks;
  assert.throws(() => FeedExtractionSchema.parse(missingTracks));
});

test("prominence is limited to the two readings we can justify", () => {
  // "headliner"/"support" was the old flyer-shaped vocabulary and must not come
  // back — it means nothing on a playlist screen.
  assert.throws(() =>
    FeedExtractionSchema.parse(
      musicAppExtraction({
        artists: [{ name: "X", prominence: "headliner", confidence: null }],
      }),
    ),
  );
});

test("source_kind is limited to the recognised shapes", () => {
  for (const kind of ["music_app", "playlist", "concert_flyer", "other"]) {
    assert.doesNotThrow(() =>
      FeedExtractionSchema.parse(musicAppExtraction({ source_kind: kind })),
    );
  }
  assert.throws(() =>
    FeedExtractionSchema.parse(musicAppExtraction({ source_kind: "spotify" })),
  );
});

test("a flyer still parses, with its flyer fields populated", () => {
  assert.doesNotThrow(() =>
    FeedExtractionSchema.parse(
      musicAppExtraction({
        source_kind: "concert_flyer",
        tracks: [],
        venue: "Roadrunner",
        city: "Boston",
        state: "MA",
        date: "2026-08-09",
        time: "20:00",
        ticket_url: "https://example.com/tickets",
      }),
    ),
  );
});

test("source kinds have readable descriptions, including the unknown case", () => {
  assert.equal(describeSourceKind("music_app"), "a music app screen");
  assert.equal(describeSourceKind("playlist"), "a playlist or song list");
  assert.equal(describeSourceKind("concert_flyer"), "a show flyer");
  assert.equal(describeSourceKind(null), "an image");
});
