/**
 * GitHub Settings → Social preview uploads.
 *
 * The hand-authored masters in `source/` stay at native resolution. GitHub's
 * upload slot wants 1280×640 and refuses files of 1 MB or larger, so this
 * encodes the already-fitted opaque PNG as a JPEG under that cap.
 *
 * Usage is via `scale_social_previews.ts` / `render_social_previews.ts`; do
 * not overwrite `source/`.
 */

import { Buffer } from "node:buffer";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from "./preview_art.ts";

/** GitHub's documented Social-preview size cap ("smaller than 1 MB"). */
export const GITHUB_MAX_BYTES = 1_000_000;

export const GITHUB_SUBDIR = "github";

const START_QUALITY = 90;
const MIN_QUALITY = 50;
const QUALITY_STEP = 5;

export function githubJpegName(pngName: string): string {
  if (!pngName.toLowerCase().endsWith(".png")) {
    throw new Error(`expected a .png name, got ${pngName}`);
  }
  return `${pngName.slice(0, -4)}.jpg`;
}

/**
 * Width and height from a baseline JPEG's SOF0 marker. Used by the brand
 * tests so a too-small GitHub upload fails here rather than in Settings.
 */
export function jpegSize(
  bytes: Uint8Array,
  label: string,
): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error(`${label} is not a JPEG`);
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      throw new Error(`${label} is a corrupt JPEG at byte ${offset}`);
    }
    const marker = bytes[offset + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
      };
    }
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    offset += 2 + length;
  }
  throw new Error(`${label} has no SOF dimensions`);
}

function decodePngRgba(
  pngBytes: Uint8Array,
): { width: number; height: number; data: Buffer } {
  const png = PNG.sync.read(Buffer.from(pngBytes));
  return { width: png.width, height: png.height, data: png.data };
}

/**
 * Encode `pngBytes` as a baseline JPEG small enough for GitHub's upload slot.
 * Tries quality 90 down to 50. Throws if even the floor still exceeds 1 MB.
 */
export function encodeGithubJpeg(
  pngBytes: Uint8Array,
  label: string,
): { jpeg: Uint8Array; quality: number } {
  const { width, height, data } = decodePngRgba(pngBytes);
  if (width !== PREVIEW_WIDTH || height !== PREVIEW_HEIGHT) {
    throw new Error(
      `${label} is ${width}×${height}, expected ` +
        `${PREVIEW_WIDTH}×${PREVIEW_HEIGHT} before the GitHub JPEG encode`,
    );
  }

  for (
    let quality = START_QUALITY;
    quality >= MIN_QUALITY;
    quality -= QUALITY_STEP
  ) {
    const encoded = jpeg.encode({ data, width, height }, quality);
    const jpegBytes = new Uint8Array(encoded.data);
    if (jpegBytes.byteLength < GITHUB_MAX_BYTES) {
      return { jpeg: jpegBytes, quality };
    }
  }

  throw new Error(
    `${label} could not fit under ${GITHUB_MAX_BYTES} bytes at JPEG quality ` +
      `${MIN_QUALITY}`,
  );
}

/** Write `github/<stem>.jpg` next to the other social-preview variants. */
export async function writeGithubJpeg(
  previewsDir: string,
  pngName: string,
  pngBytes: Uint8Array,
): Promise<{ name: string; quality: number; bytes: number }> {
  const name = githubJpegName(pngName);
  const { jpeg: jpegBytes, quality } = encodeGithubJpeg(
    pngBytes,
    `${GITHUB_SUBDIR}/${name}`,
  );
  const dir = `${previewsDir}/${GITHUB_SUBDIR}`;
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeFile(`${dir}/${name}`, jpegBytes);
  return { name, quality, bytes: jpegBytes.byteLength };
}
