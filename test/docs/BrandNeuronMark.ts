/**
 * Issue #3805 — the neuron-A mark is exported from the signed-off B5 SVG.
 *
 * A hand-exported mark shipped corrupt once and the rasteriser dropped it
 * without complaining, so every preview rendered with a blank A slot. These
 * are behavioural tests of the export: the builder pulls the neuron out of the
 * template, places its face where the generated wordmark leaves the gap, and
 * carries none of the template's own lettering. The committed PNG is then read
 * back and its ink checked in that same slot, so a blank or misplaced mark
 * fails here instead of in artwork nobody re-inspects.
 */

import { assert, assertAlmostEquals, assertThrows } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";
import {
  buildNeuronMarkSvg,
  extractElement,
  LOCKUP_FACE,
  LOCKUP_SCALE,
  MARK_HEIGHT,
  MARK_WIDTH,
  TEMPLATE_FACE,
} from "../../scripts/brand/neuron_mark.ts";
import { readPngPixels } from "./_pngPixels.ts";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const TEMPLATES_DIR = `${REPO_ROOT}/docs/brand/templates`;
const TEMPLATE_PATH = `${TEMPLATES_DIR}/neuron-a.svg`;
const MARK_PATH = `${TEMPLATES_DIR}/neuron-a-mark.png`;

async function template(): Promise<string> {
  return await Deno.readTextFile(TEMPLATE_PATH);
}

/** The `translate(dx dy) scale(s)` the builder wrote, as numbers. */
function placementOf(svg: string): { dx: number; dy: number; scale: number } {
  const match = svg.match(
    /transform="translate\((-?[\d.]+) (-?[\d.]+)\) scale\(([\d.]+)\)"/,
  );
  assert(match, "mark SVG has no placement transform");
  return {
    dx: Number(match[1]),
    dy: Number(match[2]),
    scale: Number(match[3]),
  };
}

Deno.test("the neuron group is extracted whole, with balanced nesting", async () => {
  const neuron = extractElement(await template(), "neuron");
  assert(
    neuron.startsWith('<g id="neuron">'),
    "extraction missed the open tag",
  );
  assert(neuron.endsWith("</g>"), "extraction missed the close tag");
  const opens = neuron.match(/<g\b/g)?.length ?? 0;
  const closes = neuron.match(/<\/g>/g)?.length ?? 0;
  assert(opens > 1, "the neuron group should hold nested groups");
  assert(
    opens === closes,
    `unbalanced extraction: ${opens} <g> against ${closes} </g>`,
  );
});

Deno.test("an unknown id fails loudly", async () => {
  const svg = await template();
  assertThrows(
    () => extractElement(svg, "not-in-the-template"),
    Error,
    'no element id="not-in-the-template"',
  );
});

Deno.test("an unclosed element fails loudly", () => {
  assertThrows(
    () => extractElement('<svg><g id="neuron"><g></g></svg>', "neuron"),
    Error,
    "is never closed",
  );
});

Deno.test("a self-closing element is extracted as one tag", () => {
  assertThrows(
    () => extractElement('<svg><circle id="dot" r="4"/></svg>', "missing"),
    Error,
    "no element",
  );
  const dot = extractElement('<svg><circle id="dot" r="4"/></svg>', "dot");
  assert(dot === '<circle id="dot" r="4"/>', `unexpected extraction: ${dot}`);
});

Deno.test("depth counts only same-name tags, not prefixed neighbours", () => {
  // `<glyph>` shares the `g` prefix and `<path/>` closes itself, so neither may
  // move the depth counter that finds the group's own `</g>`.
  const svg = '<svg><g id="neuron"><glyph></glyph><g><path d="M0 0"/></g></g>' +
    "<g>after</g></svg>";
  const neuron = extractElement(svg, "neuron");
  assert(
    neuron === '<g id="neuron"><glyph></glyph><g><path d="M0 0"/></g></g>',
    `unexpected extraction: ${neuron}`,
  );
});

Deno.test("the mark SVG carries the neuron on the preview canvas", async () => {
  const svg = buildNeuronMarkSvg(await template());
  assert(
    svg.includes(`width="${MARK_WIDTH}"`) &&
      svg.includes(`height="${MARK_HEIGHT}"`),
    "the mark must use the 1280x640 preview canvas",
  );
  assert(svg.includes('<g id="neuron">'), "the mark must carry the neuron");
  assert(svg.includes("linearGradient"), "the mark must carry the gradient");
});

Deno.test("the mark SVG drops the template's own lettering", async () => {
  const svg = buildNeuronMarkSvg(await template());
  assert(!svg.includes("<text"), "the mark must not carry any text");
  assert(
    !svg.includes("NeuroEvolution"),
    "the mark must not carry the template's subtitle",
  );
});

Deno.test("the neuron's face lands in the generated wordmark's A slot", async () => {
  const svg = buildNeuronMarkSvg(await template());
  const { dx, dy, scale } = placementOf(svg);
  assertAlmostEquals(scale, LOCKUP_SCALE, 0.001, "unexpected mark scale");
  assertAlmostEquals(
    TEMPLATE_FACE.x * scale + dx,
    LOCKUP_FACE.x,
    0.01,
    "the face is off the A slot horizontally",
  );
  assertAlmostEquals(
    TEMPLATE_FACE.y * scale + dy,
    LOCKUP_FACE.y,
    0.01,
    "the face is off the A slot vertically",
  );
});

Deno.test("a custom placement moves the neuron with it", async () => {
  const svg = buildNeuronMarkSvg(await template(), {
    scale: 2,
    face: { x: 100, y: 200 },
  });
  const { dx, dy, scale } = placementOf(svg);
  assertAlmostEquals(scale, 2, 0.001);
  assertAlmostEquals(TEMPLATE_FACE.x * scale + dx, 100, 0.01);
  assertAlmostEquals(TEMPLATE_FACE.y * scale + dy, 200, 0.01);
});

Deno.test("the committed mark paints ink in the A slot", async () => {
  const png = await readPngPixels(MARK_PATH);
  assert(
    png.width === MARK_WIDTH && png.height === MARK_HEIGHT,
    `the mark is ${png.width}x${png.height}, expected ${MARK_WIDTH}x${MARK_HEIGHT}`,
  );

  // The soma fills the slot, so the face and the body around it must be ink.
  const face = { x: Math.round(LOCKUP_FACE.x), y: Math.round(LOCKUP_FACE.y) };
  for (const [dx, dy] of [[0, 0], [-30, 0], [30, 0], [0, -60], [0, 60]]) {
    assert(
      png.alphaAt(face.x + dx, face.y + dy) > 0,
      `the mark is blank at (${face.x + dx}, ${face.y + dy})`,
    );
  }
});

Deno.test("the committed mark leaves the rest of the canvas clear", async () => {
  const png = await readPngPixels(MARK_PATH);
  // The wordmark, subtitle, and pill row are drawn by the renderer, so the
  // mark must not paint over the canvas edges or the pill band.
  for (
    const [x, y] of [[8, 8], [MARK_WIDTH - 8, 8], [8, MARK_HEIGHT - 8], [
      MARK_WIDTH - 8,
      MARK_HEIGHT - 8,
    ], [Math.round(MARK_WIDTH / 2), MARK_HEIGHT - 60]]
  ) {
    assert(
      png.alphaAt(x, y) === 0,
      `the mark paints outside the lockup at (${x}, ${y})`,
    );
  }
});
