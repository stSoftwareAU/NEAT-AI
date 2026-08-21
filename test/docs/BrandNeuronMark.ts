/**
 * Issue #3805 — the committed neuron-A mark is the B5 lockup's neuron, cut
 * out of `docs/brand/templates/neuron-a.svg`.
 *
 * Behavioural tests: they drive the real cut with the real lockup and read the
 * committed PNG's own header and pixels. A mark that lost the artwork, gained
 * the wordmark, or drifted off the lockup's canvas — which would slide the
 * neuron away from the gap the previews leave for it — fails here.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";
import {
  buildMarkSvg,
  MARK_GROUP_ID,
  markCanvas,
} from "../../scripts/brand/neuron_mark_svg.ts";
import { markOffsetX, PREVIEW_WIDTH } from "../../scripts/brand/preview_art.ts";
import { readPngPixels } from "./_pngPixels.ts";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const TEMPLATES_DIR = `${REPO_ROOT}/docs/brand/templates`;
const LOCKUP_PATH = `${TEMPLATES_DIR}/neuron-a.svg`;
const MARK_PATH = `${TEMPLATES_DIR}/neuron-a-mark.png`;

async function lockup(): Promise<string> {
  return await Deno.readTextFile(LOCKUP_PATH);
}

Deno.test("the mark carries the neuron artwork and its gradient", async () => {
  const source = await lockup();
  const mark = buildMarkSvg(source);

  assertStringIncludes(mark, `<g id="${MARK_GROUP_ID}">`);
  assertStringIncludes(mark, '<linearGradient id="neuronGrad"');
  // The soma — the organic A itself — and the smile that makes it a face.
  assertStringIncludes(mark, 'fill="url(#neuronGrad)"');
  assertStringIncludes(mark, 'stroke="#0B1220"');
  assertEquals(
    (mark.match(/<g\b[^>]*>/g) ?? []).length,
    (mark.match(/<\/g\s*>/g) ?? []).length,
    "the extracted group must be balanced",
  );
});

Deno.test("the mark drops the wordmark, subtitle, and pills", async () => {
  const source = await lockup();
  assertStringIncludes(source, "NeuroEvolution");
  assert(
    !buildMarkSvg(source).includes("<text"),
    "the previews draw their own text; the mark must carry none",
  );
});

Deno.test("the mark keeps the lockup's canvas", async () => {
  const source = await lockup();
  const canvas = markCanvas(source);
  const mark = buildMarkSvg(source);

  assertStringIncludes(mark, `width="${canvas.width}"`);
  assertStringIncludes(mark, `height="${canvas.height}"`);
  assertStringIncludes(mark, `viewBox="${canvas.viewBox}"`);
});

Deno.test("a lockup with no marked group fails loudly", () => {
  assertThrows(
    () =>
      buildMarkSvg(
        '<svg width="10" height="10" viewBox="0 0 10 10"><g/></svg>',
      ),
    Error,
    MARK_GROUP_ID,
  );
});

Deno.test("an unclosed mark group fails loudly", () => {
  assertThrows(
    () =>
      buildMarkSvg(
        `<svg width="10" height="10" viewBox="0 0 10 10">` +
          `<g id="${MARK_GROUP_ID}"><g><circle r="1"/></g></svg>`,
      ),
    Error,
    "never closed",
  );
});

Deno.test("a lockup with no canvas fails loudly", () => {
  assertThrows(
    () => markCanvas(`<svg height="10"><g id="${MARK_GROUP_ID}"/></svg>`),
    Error,
    "width",
  );
});

Deno.test("a non-numeric canvas fails loudly", () => {
  assertThrows(
    () => markCanvas('<svg width="wide" height="10" viewBox="0 0 10 10"/>'),
    Error,
    "non-numeric",
  );
});

/**
 * Horizontal extent of the soma — the organic A itself, and the only closed
 * path in the mark; the dendrites are open strokes.
 */
function somaExtent(markSvg: string): { min: number; max: number } {
  const closed = [...markSvg.matchAll(/<path[^>]*\bd="([^"]*Z)"/g)];
  assertEquals(closed.length, 1, "the mark should hold exactly one soma path");
  const numbers = (closed[0][1].match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const xs = numbers.filter((_, index) => index % 2 === 0);
  return { min: Math.min(...xs), max: Math.max(...xs) };
}

Deno.test("the wordmark gap holds the mark's soma", async () => {
  const soma = somaExtent(buildMarkSvg(await lockup()));

  // Two fonts' worth of measured glyph edges: where the E ends and the T
  // begins. The soma has to clear both, or the A collides with a letter.
  for (const [eEnd, tStart] of [[455, 662], [500, 700]]) {
    const dx = markOffsetX(eEnd, tStart);
    const centre = (soma.min + soma.max) / 2 + dx;
    assert(
      soma.min + dx > eEnd && soma.max + dx < tStart,
      `the soma spans ${soma.min + dx}…${soma.max + dx}, outside the ` +
        `${eEnd}…${tStart} gap`,
    );
    assert(
      Math.abs(centre - (eEnd + tStart) / 2) < 1,
      "the soma should sit centred in the gap",
    );
    assert(soma.max + dx < PREVIEW_WIDTH, "the mark must stay on canvas");
  }
});

Deno.test("the committed mark sits on the lockup's canvas", async () => {
  const canvas = markCanvas(await lockup());
  const png = await readPngPixels(MARK_PATH);

  assertEquals(
    { width: png.width, height: png.height },
    { width: canvas.width, height: canvas.height },
    "the mark and the lockup must share a canvas, or the neuron lands off-centre",
  );
});

Deno.test("the committed mark is transparent artwork, not a filled frame", async () => {
  const png = await readPngPixels(MARK_PATH);
  assertEquals(png.colourType, 6, "the mark needs an alpha channel");
  assertEquals(
    [
      png.alphaAt(0, 0),
      png.alphaAt(png.width - 1, 0),
      png.alphaAt(0, png.height - 1),
      png.alphaAt(png.width - 1, png.height - 1),
    ],
    [0, 0, 0, 0],
    "the mark's corners must be transparent",
  );

  // The neuron really is drawn: sample a grid and require opaque pixels.
  let opaque = 0;
  for (let y = 0; y < png.height; y += 8) {
    for (let x = 0; x < png.width; x += 8) {
      if (png.alphaAt(x, y) === 255) opaque++;
    }
  }
  assert(opaque > 100, `the mark has almost no artwork (${opaque} samples)`);
});
