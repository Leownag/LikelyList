import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { DIGEST_WEEKDAY } from "../src/lib/time";

const ROOT = join(import.meta.dirname, "..");

/**
 * The day the product promises, derived rather than typed.
 *
 * 2026-08-02 is a Sunday, so adding DIGEST_WEEKDAY lands on the right day
 * whatever it is set to.
 */
const EXPECTED_EN = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long",
}).format(new Date(Date.UTC(2026, 7, 2 + DIGEST_WEEKDAY)));

const EN_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** 週三 / 星期三 and the other six. */
const ZH_DAYS = ["日", "一", "二", "三", "四", "五", "六"];
const EXPECTED_ZH = ZH_DAYS[DIGEST_WEEKDAY];

function read(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), "utf8");
}

/**
 * Source with comments removed.
 *
 * Comments legitimately discuss the old day — "a Friday email used to arrive on
 * a Thursday" is the explanation for why the weekday is a constant now. Only
 * what reaches a reader is in scope.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function wrongDays(text: string, days: string[], expected: string): string[] {
  return days.filter((day) => day !== expected && text.includes(day));
}

test("both message catalogues name the digest's own weekday", () => {
  // What this exists for: the day lives in DIGEST_WEEKDAY, but it is also
  // written out in roughly forty strings. Moving the send and missing one of
  // them leaves the product contradicting itself, and no browser test notices
  // because each page is individually consistent.
  const en = read("src/lib/i18n/messages/en.json");
  assert.deepEqual(
    wrongDays(en, EN_DAYS, EXPECTED_EN),
    [],
    `en.json names a weekday that is not ${EXPECTED_EN}`,
  );

  const zh = read("src/lib/i18n/messages/zh-Hant.json");
  const zhWrong = ZH_DAYS.filter(
    (day) =>
      day !== EXPECTED_ZH &&
      (zh.includes(`週${day}`) || zh.includes(`星期${day}`)),
  );
  assert.deepEqual(zhWrong, [], `zh-Hant.json names a weekday that is not 週${EXPECTED_ZH}`);
});

test("the auth emails name it too", () => {
  // These are pasted into Supabase's dashboard and rendered by Supabase, so no
  // test that drives a browser can ever see them. They were missed by a sweep
  // that covered everything under src/, and a reader's sign-in email offered to
  // "stop the Friday email" while the app beside it said Wednesday.
  const dir = join(ROOT, "supabase/email-templates");
  const templates = readdirSync(dir).filter((name) => name.endsWith(".html"));
  assert.ok(templates.length > 0, "no email templates found");

  for (const name of templates) {
    const html = readFileSync(join(dir, name), "utf8");
    assert.deepEqual(
      wrongDays(html, EN_DAYS, EXPECTED_EN),
      [],
      `${name} names a weekday that is not ${EXPECTED_EN}`,
    );
  }
});

test("no page hardcodes a different weekday outside a comment", () => {
  // Several surfaces are deliberately untranslated and hold their copy as JSX
  // literals, so the catalogue check above cannot see them.
  const offenders: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      // Tests and fixtures talk about specific dates on purpose.
      if (/\.test\.tsx?$/.test(entry.name)) continue;

      const source = withoutComments(readFileSync(path, "utf8"));
      for (const day of wrongDays(source, EN_DAYS, EXPECTED_EN)) {
        // "Fri, Aug 7" style output comes from Intl at runtime; a bare weekday
        // name in a format option list is not copy.
        if (new RegExp(`weekday|${day}day`).test(source) && !source.includes(`${day} `)) {
          continue;
        }
        offenders.push(`${path.slice(ROOT.length + 1)} → ${day}`);
      }
    }
  };

  walk(join(ROOT, "src"));
  assert.deepEqual(offenders, [], `expected every weekday mention to be ${EXPECTED_EN}`);
});
