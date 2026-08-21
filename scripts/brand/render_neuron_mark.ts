#!/usr/bin/env -S deno run -A
/**
 * Issue #3805 — re-export the neuron-A mark from the signed-off B5 lockup.
 *
 * Usage: `deno run -A scripts/brand/render_neuron_mark.ts [--out FILE]`
 *
 * Writes `docs/brand/templates/neuron-a-mark.png`, the artwork every social
 * preview embeds. The mark carries no text, so the render depends on no host
 * font — unlike the previews, re-exporting it here reproduces the committed
 * bytes anywhere. The written PNG is checked before it lands: a hand-exported
 * mark whose image data was corrupt shipped previews with a blank gap where
 * the neuron should be, and nothing failed.
 *
 * Re-render the previews afterwards with
 * `deno run -A scripts/brand/render_social_previews.ts`.
 */

import { Resvg } from "@resvg/resvg-js";
import { dirname, fromFileUrl, resolve } from "@std/path";
import { buildMarkSvg, markCanvas } from "./neuron_mark_svg.ts";
import { assertSoundPng } from "./png_integrity.ts";

const TEMPLATES_DIR = resolve(
  dirname(fromFileUrl(import.meta.url)),
  "../../docs/brand/templates",
);
const LOCKUP_PATH = `${TEMPLATES_DIR}/neuron-a.svg`;
const MARK_PATH = `${TEMPLATES_DIR}/neuron-a-mark.png`;

/** Rasterise the lockup's mark to PNG bytes, failing loud on bad output. */
export function renderMarkPng(lockupSvg: string): Uint8Array {
  const canvas = markCanvas(lockupSvg);
  const image = new Resvg(buildMarkSvg(lockupSvg), {
    font: { loadSystemFonts: false },
  }).render();
  if (image.width !== canvas.width || image.height !== canvas.height) {
    throw new Error(
      `rendered ${image.width}x${image.height}, expected ` +
        `${canvas.width}x${canvas.height}`,
    );
  }
  const bytes = image.asPng();
  assertSoundPng(bytes, "rendered neuron-A mark");
  return bytes;
}

async function main(): Promise<void> {
  const outIndex = Deno.args.indexOf("--out");
  const outPath = outIndex >= 0 && Deno.args[outIndex + 1]
    ? resolve(Deno.args[outIndex + 1])
    : MARK_PATH;

  const bytes = renderMarkPng(await Deno.readTextFile(LOCKUP_PATH));
  await Deno.writeFile(outPath, bytes);
  console.info(`Rendered the neuron-A mark into ${outPath}`);
}

if (import.meta.main) await main();
