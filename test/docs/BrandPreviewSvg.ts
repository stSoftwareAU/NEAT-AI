/**
 * Issue #3764 — the social previews are generated, so the generator itself is
 * under test: the transparent palette must not paint a background, the opaque
 * one must, and the catalogue the renderer reads from must describe exactly the
 * PNGs committed under `docs/brand/social-previews/`.
 *
 * These call the real builder with the real specs and assert on the SVG it
 * returns, so a regression shows up here rather than in re-rendered artwork.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";
import {
  buildPreviewSvg,
  paletteFor,
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  type TextExtent,
  xmlEscape,
} from "../../scripts/brand/preview_art.ts";
import { type MotifId, motifSvg } from "../../scripts/brand/preview_motifs.ts";
import { PREVIEW_SPECS } from "../../scripts/brand/preview_specs.ts";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const PREVIEWS_DIR = `${REPO_ROOT}/docs/brand/social-previews`;

/** Stand-in for the rasteriser's glyph metrics: 0.6 em per character. */
function stubMeasure(
  text: string,
  fontSize: number,
): TextExtent {
  return { width: text.length * fontSize * 0.6, height: fontSize * 0.72 };
}

const HUB = PREVIEW_SPECS[0];

Deno.test("the transparent palette paints no background", () => {
  const svg = buildPreviewSvg(HUB, paletteFor("transparent"), stubMeasure);
  assertStringIncludes(svg, `width="${PREVIEW_WIDTH}"`);
  assertStringIncludes(svg, `height="${PREVIEW_HEIGHT}"`);
  assert(
    !svg.includes(
      `<rect width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}"`,
    ),
    "transparent previews must not paint a full-canvas background",
  );
});

Deno.test("the opaque palette paints the brand background", () => {
  const svg = buildPreviewSvg(HUB, paletteFor("opaque"), stubMeasure);
  assertStringIncludes(
    svg,
    `<rect width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" fill="#0B1220"/>`,
  );
});

Deno.test("each preview carries its own subtitle and descriptor", () => {
  for (const spec of PREVIEW_SPECS) {
    const svg = buildPreviewSvg(spec, paletteFor("transparent"), stubMeasure);
    assertStringIncludes(svg, `>${xmlEscape(spec.subtitle)}</text>`);
    assertStringIncludes(svg, `>${xmlEscape(spec.descriptor)}</text>`);
    assertStringIncludes(svg, ">NE</text>");
    assertStringIncludes(svg, ">T-AI</text>");
  }
});

Deno.test("the soma is a friendly round neuron with a smiley face", () => {
  const svg = buildPreviewSvg(HUB, paletteFor("transparent"), stubMeasure);
  const teal = paletteFor("transparent").teal;
  assert(
    new RegExp(`<circle cx="[^"]+" cy="[^"]+" r="[^"]+" fill="${teal}"/>`).test(
      svg,
    ),
    "Issue #3781: the A is a round teal soma without a sticker-like halo ring",
  );
  // Smiley face: two filled eyes plus a stroke smile.
  assert(
    [...svg.matchAll(/fill="#0B1220"/g)].length >= 2,
    "Issue #3781: soma must keep the smiley-face eyes",
  );
  assertStringIncludes(svg, `stroke="#0B1220"`);
  assertStringIncludes(svg, '<path d="M');
});

Deno.test("the same spec renders identically every time", () => {
  const first = buildPreviewSvg(HUB, paletteFor("transparent"), stubMeasure);
  const second = buildPreviewSvg(HUB, paletteFor("transparent"), stubMeasure);
  assertEquals(first, second, "preview rendering must be deterministic");
});

Deno.test("xmlEscape neutralises markup in a label", () => {
  assertEquals(
    xmlEscape(`<a href="x">&'`),
    "&lt;a href=&quot;x&quot;&gt;&amp;&apos;",
  );
});

Deno.test("an unknown motif fails loudly", () => {
  assertThrows(
    () => motifSvg("not-a-motif" as MotifId, paletteFor("transparent"), "#000"),
    Error,
    "unknown motif",
  );
});

Deno.test("the render catalogue matches the committed previews", async () => {
  const onDisk: string[] = [];
  for await (const entry of Deno.readDir(PREVIEWS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".png")) onDisk.push(entry.name);
  }
  assertEquals(
    PREVIEW_SPECS.map((spec) => spec.file).sort(),
    onDisk.sort(),
    "scripts/brand/preview_specs.ts and docs/brand/social-previews/ disagree",
  );
});
