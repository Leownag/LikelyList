/**
 * Browser-side image preparation, run before upload.
 *
 * Note what this deliberately does NOT do: no binarisation, no greyscale, no
 * adaptive thresholding, no sharpening. Those are Tesseract-era techniques —
 * they help a classical OCR engine and actively hurt a vision model, which
 * relies on the colour and contrast cues that binarising throws away.
 *
 * What is left is the part that genuinely helps:
 *   - honour EXIF orientation, so a phone photo of a poster is not sideways
 *   - downscale to the tokeniser's useful range, which is a cost decision:
 *     a 4032x3024 screenshot costs several times more than necessary and reads
 *     no better
 *   - never upscale, which adds tokens and no information
 *   - keep PNG for screenshots and high-quality JPEG for photos, because
 *     aggressive compression smears exactly the thin stylised glyphs that
 *     matter
 */

/** Longest edge. Above this, extra pixels buy nothing. */
const MAX_LONG_EDGE = 2048;
/** Shortest edge target. Below this, stylised small print starts to fail. */
const TARGET_SHORT_EDGE = 768;

export const ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

/** Guard before we spend a request on something that cannot be an image. */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export type PreparedImage = {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  /** Data URL of a small thumbnail, kept only in memory for the confirm UI. */
  previewUrl: string;
};

export async function prepareImage(source: Blob): Promise<PreparedImage> {
  if (source.size > MAX_SOURCE_BYTES) {
    throw new Error("That image is larger than 20 MB. Try a screenshot instead.");
  }
  if (source.type && !ACCEPTED_TYPES.includes(source.type as never)) {
    throw new Error(`${source.type} is not a supported image type.`);
  }

  // `imageOrientation: "from-image"` is what applies the EXIF rotation; without
  // it a camera photo arrives rotated and reads measurably worse.
  const bitmap = await createImageBitmap(source, {
    imageOrientation: "from-image",
  });

  const { width, height } = fitDimensions(bitmap.width, bitmap.height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not prepare the image.");

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // Screenshots are flat-colour and compress better and losslessly as PNG;
  // photographs of posters are far smaller as JPEG at a quality that does not
  // visibly smear type.
  const isScreenshot = source.type === "image/png";
  const dataUrl = isScreenshot
    ? canvas.toDataURL("image/png")
    : canvas.toDataURL("image/jpeg", 0.85);

  const preview = document.createElement("canvas");
  const previewScale = Math.min(1, 320 / Math.max(width, height));
  preview.width = Math.round(width * previewScale);
  preview.height = Math.round(height * previewScale);
  preview
    .getContext("2d")
    ?.drawImage(canvas, 0, 0, preview.width, preview.height);

  return {
    dataUrl,
    width,
    height,
    bytes: estimateDataUrlBytes(dataUrl),
    previewUrl: preview.toDataURL("image/jpeg", 0.7),
  };
}

/**
 * Scales so the longest edge is at most MAX_LONG_EDGE and the shortest is around
 * TARGET_SHORT_EDGE — but never enlarges. A small image is left alone.
 */
export function fitDimensions(
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  const longEdge = Math.max(sourceWidth, sourceHeight);
  const shortEdge = Math.min(sourceWidth, sourceHeight);

  const longScale = MAX_LONG_EDGE / longEdge;
  const shortScale = TARGET_SHORT_EDGE / shortEdge;

  // Take the more aggressive reduction of the two, and clamp at 1 so we never
  // upscale.
  const scale = Math.min(1, longScale, shortScale);

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

/** Byte length of the decoded payload behind a base64 data URL. */
export function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return 0;
  const base64 = dataUrl.slice(comma + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Pulls the first image out of a paste event, if there is one. */
export function imageFromClipboard(items: DataTransferItemList): File | null {
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}
