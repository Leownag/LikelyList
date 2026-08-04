import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MARK_COLORS,
  MARK_COLS,
  MARK_ROWS,
  MARK_ROWS_COUNT,
  markCells,
} from "./logo";

/**
 * The grid is the single source for three renderings — the app's inline SVG, the PNG
 * the emails use, and the favicon. These assert the invariants each of those depends
 * on, because a malformed grid would produce three subtly different broken logos
 * rather than one obvious error.
 */

test("the grid is rectangular", () => {
  // Every renderer indexes by column, so a short row would silently drop cells from
  // one of them and not the others.
  for (const [index, row] of MARK_ROWS.entries()) {
    assert.equal(row.length, MARK_COLS, `row ${index} is ${row.length} wide`);
  }
  assert.equal(MARK_ROWS.length, MARK_ROWS_COUNT);
});

test("every non-empty character maps to a colour", () => {
  // A typo like "Z" would be silently skipped by markCells, leaving a hole in the mark
  // that only shows up by eye.
  for (const row of MARK_ROWS) {
    for (const key of row) {
      if (key === ".") continue;
      assert.ok(MARK_COLORS[key], `no colour for ${JSON.stringify(key)}`);
    }
  }
});

test("colours are literal hex, not CSS variables", () => {
  // Two of the three consumers cannot resolve a custom property: a PNG encoder has no
  // cascade, and email clients strip them. A var() here would render as nothing.
  for (const [key, value] of Object.entries(MARK_COLORS)) {
    assert.match(value, /^#[0-9a-f]{6}$/i, `${key} is ${value}`);
  }
});

test("markCells returns each filled cell once, inside bounds", () => {
  const cells = markCells();
  const filled = MARK_ROWS.join("").split("").filter((key) => key !== ".").length;

  assert.equal(cells.length, filled);

  const seen = new Set<string>();
  for (const cell of cells) {
    assert.ok(cell.col >= 0 && cell.col < MARK_COLS, `col ${cell.col} out of range`);
    assert.ok(
      cell.row >= 0 && cell.row < MARK_ROWS_COUNT,
      `row ${cell.row} out of range`,
    );
    const key = `${cell.col},${cell.row}`;
    assert.ok(!seen.has(key), `cell ${key} emitted twice`);
    seen.add(key);
  }
});

test("the mark still reads as an L", () => {
  // The recognisable part, asserted so a well-meaning tidy-up of the grid cannot
  // quietly turn the logo into abstract confetti: a full left column and a foot along
  // the bottom row.
  const cells = markCells();
  const at = (col: number, row: number) =>
    cells.some((cell) => cell.col === col && cell.row === row);

  for (let row = 0; row < MARK_ROWS_COUNT; row++) {
    assert.ok(at(0, row), `left column is broken at row ${row}`);
  }
  const bottom = MARK_ROWS_COUNT - 1;
  assert.ok(at(1, bottom) && at(2, bottom), "the foot of the L is missing");
});
