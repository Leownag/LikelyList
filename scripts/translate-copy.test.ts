import assert from "node:assert/strict";
import test from "node:test";
import { keysToTranslate, parseReply, placeholders } from "./translate-copy";

const en = {
  "a.one": "Cities",
  "a.two": "Save",
  "b.one": "{count} screenshots processed",
};

test("a key copied across from English untranslated is picked up", () => {
  const zh = { "a.one": "城市", "a.two": "Save", "b.one": "" };
  const args = { all: false, dryRun: false, write: false, prefixes: [] };

  // "Save" is identical in both objects, which is what an untranslated key looks like
  // once the type has forced it to exist; "" is one that was never filled in.
  assert.deepEqual(keysToTranslate(en, zh, args), ["a.two", "b.one"]);
});

test("--all and --keys override that", () => {
  const zh = { "a.one": "城市", "a.two": "儲存", "b.one": "已處理 {count} 張截圖" };

  assert.deepEqual(keysToTranslate(en, zh, { all: true, dryRun: false, write: false, prefixes: [] }), [
    "a.one",
    "a.two",
    "b.one",
  ]);
  assert.deepEqual(
    keysToTranslate(en, zh, { all: false, dryRun: false, write: false, prefixes: ["b."] }),
    ["b.one"],
  );
});

test("a reply survives the model wrapping it in a code fence", () => {
  assert.deepEqual(parseReply('{"a.one":"城市"}'), { "a.one": "城市" });
  assert.deepEqual(parseReply('```json\n{"a.one":"城市"}\n```'), { "a.one": "城市" });
  assert.throws(() => parseReply('["城市"]'), /object/);
});

test("placeholders are compared by name, not by position", () => {
  // The whole point: Chinese reorders these, and that has to be allowed.
  assert.deepEqual(
    placeholders("{count} screenshots processed"),
    placeholders("已處理 {count} 張截圖"),
  );
  // A dropped one is not allowed, and is what this check exists to catch.
  assert.notDeepEqual(placeholders("Next: {when}"), placeholders("下一次"));
});
