/**
 * GitHub Settings → Social preview uploads.
 *
 * The hand-authored masters in `source/` stay at native resolution. GitHub's
 * upload slot wants 1280×640 and refuses files of 1 MB or larger, so this
 * quantises the fitted **transparent** PNG onto a palette small enough to fit
 * under that cap (Issue #3903 — the uploads used to be flattened navy JPEGs,
 * which cannot carry an alpha channel).
 *
 * Usage is via `scale_social_previews.ts` / `render_social_previews.ts`; do
 * not overwrite `source/`.
 */

import { Buffer } from "node:buffer";
import { PNG } from "pngjs";
import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from "./preview_art.ts";
import { encodeIndexedPng, MAX_PALETTE, quantise } from "./png_quantise.ts";

/** GitHub's documented Social-preview size cap ("smaller than 1 MB"). */
export const GITHUB_MAX_BYTES = 1_000_000;

export const GITHUB_SUBDIR = "github";

/**
 * Palette budgets tried in turn. The first that fits under the cap wins, so
 * the artwork only loses colours when it has to.
 */
const PALETTE_BUDGETS = [MAX_PALETTE, 192, 128, 96, 64, 48, 32];

/** The upload keeps the preview's own name — it is a PNG at both ends. */
export function githubUploadName(pngName: string): string {
  if (!pngName.toLowerCase().endsWith(".png")) {
    throw new Error(`expected a .png name, got ${pngName}`);
  }
  return pngName;
}

/**
 * Width, height and colour type from a PNG's IHDR chunk. Used by the brand
 * tests so a wrong-sized GitHub upload fails here rather than in Settings.
 */
export function pngHeader(
  bytes: Uint8Array,
  label: string,
): { width: number; height: number; colourType: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    bytes.length < 26 || signature.some((expected, i) => bytes[i] !== expected)
  ) {
    throw new Error(`${label} is not a PNG`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    colourType: bytes[25],
  };
}

function decodePngRgba(
  pngBytes: Uint8Array,
  label: string,
): { width: number; height: number; data: Uint8Array } {
  pngHeader(pngBytes, label);
  const png = PNG.sync.read(Buffer.from(pngBytes));
  return {
    width: png.width,
    height: png.height,
    data: new Uint8Array(png.data),
  };
}

/**
 * Quantise `pngBytes` into an indexed PNG small enough for GitHub's upload
 * slot, keeping the transparent background. Throws if even the narrowest
 * palette still exceeds the cap.
 */
export function encodeGithubPng(
  pngBytes: Uint8Array,
  label: string,
): { png: Uint8Array; colours: number; bytes: number } {
  const { width, height, data } = decodePngRgba(pngBytes, label);
  if (width !== PREVIEW_WIDTH || height !== PREVIEW_HEIGHT) {
    throw new Error(
      `${label} is ${width}×${height}, expected ` +
        `${PREVIEW_WIDTH}×${PREVIEW_HEIGHT} before the GitHub PNG encode`,
    );
  }

  for (const budget of PALETTE_BUDGETS) {
    const { palette, indices } = quantise({ width, height, data }, budget);
    const png = encodeIndexedPng(width, height, palette, indices);
    if (png.byteLength < GITHUB_MAX_BYTES) {
      return { png, colours: palette.length / 4, bytes: png.byteLength };
    }
  }

  throw new Error(
    `${label} could not fit under ${GITHUB_MAX_BYTES} bytes at ` +
      `${PALETTE_BUDGETS[PALETTE_BUDGETS.length - 1]} colours`,
  );
}

/** Write `github/<name>.png` next to the other social-preview variants. */
export async function writeGithubPng(
  previewsDir: string,
  pngName: string,
  pngBytes: Uint8Array,
): Promise<{ name: string; colours: number; bytes: number }> {
  const name = githubUploadName(pngName);
  const { png, colours, bytes } = encodeGithubPng(
    pngBytes,
    `${GITHUB_SUBDIR}/${name}`,
  );
  const dir = `${previewsDir}/${GITHUB_SUBDIR}`;
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeFile(`${dir}/${name}`, png);
  return { name, colours, bytes };
}
