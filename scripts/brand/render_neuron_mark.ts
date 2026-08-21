#!/usr/bin/env -S deno run -A
/**
 * Issue #3805 — re-export the neuron-A mark from the signed-off B5 SVG.
 *
 * `docs/brand/templates/neuron-a-mark.png` is the organic A the previews
 * composite into their generated wordmark. It was once exported by hand, and a
 * corrupt export shipped artwork with a blank A slot because the rasteriser
 * skips an undecodable `<image>` without complaining. Generating it here makes
 * the export repeatable, and the bytes are checked before they are written.
 *
 * Usage: `deno run -A scripts/brand/render_neuron_mark.ts [--out FILE]`
 *
 * The rasteriser is `@resvg/resvg-js`, mapped in `deno.json` and pulled from
 * npm on first run — a developer tool for regenerating committed artwork, not a
 * runtime dependency.
 */

import { Resvg } from "@resvg/resvg-js";
import { dirname, fromFileUrl, resolve } from "@std/path";
import { buildNeuronMarkSvg, MARK_HEIGHT, MARK_WIDTH } from "./neuron_mark.ts";
import { assertSoundPng } from "./png_integrity.ts";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const TEMPLATE_PATH = `${REPO_ROOT}/docs/brand/templates/neuron-a.svg`;
const DEFAULT_OUT = `${REPO_ROOT}/docs/brand/templates/neuron-a-mark.png`;

/** Rasterise `svg`, failing loudly on a wrong canvas or unsound bytes. */
export function renderMarkPng(svg: string, label: string): Uint8Array {
  const image = new Resvg(svg, { font: { loadSystemFonts: true } }).render();
  if (image.width !== MARK_WIDTH || image.height !== MARK_HEIGHT) {
    throw new Error(
      `rendered ${image.width}x${image.height}, expected ${MARK_WIDTH}x${MARK_HEIGHT}`,
    );
  }
  const png = image.asPng();
  assertSoundPng(png, label);
  return png;
}

async function main(): Promise<void> {
  const outIndex = Deno.args.indexOf("--out");
  const outPath = outIndex >= 0 && Deno.args[outIndex + 1]
    ? resolve(Deno.args[outIndex + 1])
    : DEFAULT_OUT;

  const template = await Deno.readTextFile(TEMPLATE_PATH);
  const png = renderMarkPng(buildNeuronMarkSvg(template), outPath);
  await Deno.mkdir(dirname(outPath), { recursive: true });
  await Deno.writeFile(outPath, png);
  console.info(`Rendered the neuron-A mark into ${outPath}`);
}

if (import.meta.main) await main();
