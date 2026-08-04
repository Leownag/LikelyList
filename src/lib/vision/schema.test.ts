import { test } from "node:test";
import assert from "node:assert/strict";
import { zodResponseFormat } from "openai/helpers/zod";

import { FeedExtractionSchema, SCHEMA_NAME } from "./schema";

/**
 * Guards the two properties the extraction correctness depends on. Both are
 * produced by the zod helper rather than written out by hand, so they need to be
 * asserted rather than assumed — a stray `.optional()` in schema.ts would
 * silently reintroduce hallucinated field values.
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

    // Strict mode's contract: every declared property must be required.
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

  // Root object plus the artist object.
  assert.ok(checked >= 2, `expected to inspect at least 2 objects, saw ${checked}`);
});

test("absent information is expressible as null, not as a missing key", () => {
  const properties = root.properties ?? {};

  // These are the fields a flyer commonly omits. Each must accept null so the
  // model has a correct way to say "not printed" while still satisfying
  // `required`.
  for (const field of [
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
    const accepted = JSON.stringify(node);
    assert.match(
      accepted,
      /null/,
      `${field} must accept null so "not printed" is representable`,
    );
  }
});

test("the schema parses a fully-null extraction and rejects a truncated one", () => {
  const allNull = {
    not_an_event_poster: true,
    artists: [],
    venue: null,
    city: null,
    state: null,
    date: null,
    time: null,
    genres: [],
    ticket_url: null,
    raw_text: null,
    overall_confidence: null,
  };
  assert.doesNotThrow(() => FeedExtractionSchema.parse(allNull));

  const missingVenue: Record<string, unknown> = { ...allNull };
  delete missingVenue.venue;
  assert.throws(() => FeedExtractionSchema.parse(missingVenue));
});

test("artist roles are limited to the two we can actually justify", () => {
  assert.doesNotThrow(() =>
    FeedExtractionSchema.parse({
      not_an_event_poster: false,
      artists: [
        { name: "Turnstile", role: "headliner", confidence: 0.9 },
        { name: "Blood Orange", role: "support", confidence: 0.6 },
        { name: "Unclear Act", role: null, confidence: 0.3 },
      ],
      venue: "Roadrunner",
      city: "Boston",
      state: "MA",
      date: "2026-08-09",
      time: "20:00",
      genres: ["hardcore"],
      ticket_url: null,
      raw_text: "TURNSTILE",
      overall_confidence: 0.8,
    }),
  );

  assert.throws(() =>
    FeedExtractionSchema.parse({
      not_an_event_poster: false,
      artists: [{ name: "X", role: "opener", confidence: null }],
      venue: null,
      city: null,
      state: null,
      date: null,
      time: null,
      genres: [],
      ticket_url: null,
      raw_text: null,
      overall_confidence: null,
    }),
  );
});
