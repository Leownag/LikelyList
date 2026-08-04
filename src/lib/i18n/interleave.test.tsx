import assert from "node:assert/strict";
import test from "node:test";
import { SLOT, interleave } from "./interleave";
import { translator } from "./messages";

test("a translation decides where its links go, not the English word order", () => {
  const en = "Pin a show from {feed} or {search}, and it waits here.";
  // Chinese fronts the clause: the same two nodes come out in the same order, at the
  // positions the translated string put them.
  const zh = "在{feed}或{search}裡收藏一場演出，它就會留在這裡。";

  const fill = (template: string) =>
    interleave(
      template.replace("{feed}", SLOT).replace("{search}", SLOT),
      ["FEED", "SEARCH"],
    );

  assert.deepEqual(fill(en), ["Pin a show from ", "FEED", " or ", "SEARCH", ", and it waits here."]);
  assert.deepEqual(fill(zh), ["在", "FEED", "或", "SEARCH", "裡收藏一場演出，它就會留在這裡。"]);
});

test("a slot at the very start or end does not lose text", () => {
  assert.deepEqual(interleave(`${SLOT}後面`, ["X"]), ["", "X", "後面"]);
  assert.deepEqual(interleave(`before${SLOT}`, ["X"]), ["before", "X", ""]);
  assert.deepEqual(interleave("no slots", ["X"]), ["no slots"]);
});

test("a missing node renders as nothing rather than throwing on a live page", () => {
  assert.deepEqual(interleave(`a${SLOT}b${SLOT}c`, ["X"]), ["a", "X", "b", null, "c"]);
});

test("the real catalogue strings carry the slots the pages fill", () => {
  for (const locale of ["en", "zh-Hant"] as const) {
    const t = translator(locale);
    assert.match(t("pinned.empty.body"), /\{feed\}[\s\S]*\{search\}/, locale);
    assert.match(t("overview.paused"), /\{settings\}/, locale);
    assert.match(t("login.sent.body"), /\{email\}/, locale);
  }
});
