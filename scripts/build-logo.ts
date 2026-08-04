/**
 * Renders the mark in src/lib/logo.ts to PNG, and regenerates the favicon SVG.
 *
 * Run with: npm run build:logo
 *
 * Why a PNG exists at all, when the app itself uses inline SVG: **Gmail does not
 * render the mark when it is built from coloured table cells**, which is how the
 * auth emails first carried it. Table cells were chosen because they survive
 * Classic Outlook and still show with images blocked — both true, and both useless
 * if the largest mail client in the world shows nothing. A hosted SVG is not an
 * option either: Gmail and Outlook both refuse SVG in <img>. That leaves a raster.
 *
 * The trade accepted by moving to PNG: with images blocked the mark is gone and only
 * its alt text remains. Tolerable here and nowhere else in the email — the wordmark
 * beside it is live text, so the header still reads as likelylist either way. The
 * digest's PixelStrip stays as table cells for that same reason.
 *
 * Written with node:zlib and a hand-rolled PNG encoder rather than a dependency: the
 * image is a few hundred solid-colour pixels, and the alternative is adding an image
 * library to a project that otherwise has no use for one.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MARK_COLS, MARK_ROWS_COUNT, markCells } from "../src/lib/logo";

/**
 * Pixels per cell.
 *
 * The email displays the mark at 42x35 CSS pixels and this renders at 3x, so it
 * stays sharp on the retina displays most mail is read on. Any integer multiple
 * works; a fractional one would resample the pixel art and defeat the whole look.
 */
const SCALE = 21;

const WIDTH = MARK_COLS * SCALE;
const HEIGHT = MARK_ROWS_COUNT * SCALE;

/** Red, green, blue, alpha. */
type Rgba = [number, number, number, number];

const TRANSPARENT: Rgba = [0, 0, 0, 0];

function hexToRgba(hex: string): Rgba {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
    255,
  ];
}

/**
 * The mark rasterised as one RGBA quad per pixel, on a transparent background.
 *
 * Transparent rather than filled with the site's near-black. The mark has to survive
 * landing on a surface we do not control — a mail client that forces its own
 * background, a light-themed inbox — and a baked-in dark plate becomes a black
 * rectangle in exactly those cases, which reads as a rendering fault rather than as
 * a logo. Only the L and the three coloured dots are opaque; everything between them
 * shows whatever is behind.
 */
function rasterise(): Rgba[][] {
  const rows: Rgba[][] = Array.from({ length: HEIGHT }, () =>
    Array.from({ length: WIDTH }, () => TRANSPARENT),
  );

  for (const { col, row, color } of markCells()) {
    const rgba = hexToRgba(color);
    for (let y = row * SCALE; y < (row + 1) * SCALE; y++) {
      for (let x = col * SCALE; x < (col + 1) * SCALE; x++) {
        rows[y][x] = rgba;
      }
    }
  }

  return rows;
}

/** CRC-32, which every PNG chunk carries. */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function encodePng(pixels: Rgba[][]): Buffer {
  // Each scanline is prefixed with its filter type; 0 means "none", which is what
  // a palette of flat blocks wants — a filter would only cost CPU here.
  const raw = Buffer.alloc(HEIGHT * (1 + WIDTH * 4));
  let offset = 0;
  for (const row of pixels) {
    raw[offset++] = 0;
    for (const [r, g, b, a] of row) {
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6 = truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * The favicon, regenerated from the same grid.
 *
 * Padded back out to a square with a one-cell margin: a 6x5 mark stretched into a
 * square tab icon would distort, and browsers render favicons small enough that the
 * breathing room is what keeps the L readable.
 *
 * Transparent, like the PNG. The cost is real and accepted: a yellow-green L on a
 * light tab bar is lower contrast than it was on the dark plate. The alternative is
 * a black square in every light-themed browser, which is the more conspicuous wrong.
 */
function faviconSvg(): string {
  const grid = Math.max(MARK_COLS, MARK_ROWS_COUNT) + 2;
  const size = 32;
  const unit = size / grid;
  const offsetX = ((grid - MARK_COLS) / 2) * unit;
  const offsetY = ((grid - MARK_ROWS_COUNT) / 2) * unit;

  const rects = markCells()
    .map(({ col, row, color }) => {
      const x = +(offsetX + col * unit).toFixed(3);
      const y = +(offsetY + row * unit).toFixed(3);
      const side = +unit.toFixed(3);
      return `  <rect x="${x}" y="${y}" width="${side}" height="${side}" fill="${color}"/>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">
  <!-- GENERATED by scripts/build-logo.ts from src/lib/logo.ts. Do not edit by hand.
       No background rect: the mark is transparent so it sits on the tab bar's own
       colour rather than punching a dark square into a light one. -->
${rects}
</svg>
`;
}

const root = join(import.meta.dirname, "..");

const png = encodePng(rasterise());
writeFileSync(join(root, "public", "logo-mark.png"), png);

const svg = faviconSvg();
writeFileSync(join(root, "src", "app", "icon.svg"), svg);

console.log(
  `public/logo-mark.png   ${WIDTH}x${HEIGHT} (${SCALE}x), ${(png.length / 1024).toFixed(1)} KB`,
);
console.log(`src/app/icon.svg       regenerated, ${svg.length} bytes`);
console.log(
  "\nThe email templates reference logo-mark.png by absolute URL, so a change\n" +
    "only reaches already-sent mail once this file is deployed.",
);
