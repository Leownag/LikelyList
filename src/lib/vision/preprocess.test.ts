import { test } from "node:test";
import assert from "node:assert/strict";

import { estimateDataUrlBytes, fitDimensions } from "./preprocess";

test("large images are downscaled without exceeding the long-edge budget", () => {
  // A 4032x3024 phone screenshot: the common case, and the expensive one.
  const fitted = fitDimensions(4032, 3024);
  assert.ok(Math.max(fitted.width, fitted.height) <= 2048);
  // Aspect ratio preserved to within a rounded pixel.
  assert.ok(Math.abs(fitted.width / fitted.height - 4032 / 3024) < 0.01);
});

test("very tall screenshots are reduced by the short edge, not stretched", () => {
  // An Instagram story: 1170x2532. Reducing to a 768 short edge is what keeps
  // the token cost sane; the long edge ends up well under the cap.
  const fitted = fitDimensions(1170, 2532);
  assert.equal(fitted.width, 768);
  assert.ok(fitted.height <= 2048);
});

test("small images are never upscaled", () => {
  // Upscaling would add tokens and zero information.
  assert.deepEqual(fitDimensions(400, 300), { width: 400, height: 300 });
  assert.deepEqual(fitDimensions(100, 100), { width: 100, height: 100 });
});

test("an image already in range is left alone", () => {
  assert.deepEqual(fitDimensions(1024, 768), { width: 1024, height: 768 });
});

test("dimensions never round down to zero", () => {
  const fitted = fitDimensions(10000, 1);
  assert.ok(fitted.width >= 1);
  assert.ok(fitted.height >= 1);
});

test("estimateDataUrlBytes accounts for base64 padding", () => {
  // "hi" -> aGk= (one padding char)
  assert.equal(estimateDataUrlBytes("data:image/png;base64,aGk="), 2);
  // "hip" -> aGlw (no padding)
  assert.equal(estimateDataUrlBytes("data:image/png;base64,aGlw"), 3);
  // "h" -> aA== (two padding chars)
  assert.equal(estimateDataUrlBytes("data:image/png;base64,aA=="), 1);
  assert.equal(estimateDataUrlBytes("not-a-data-url"), 0);
});
