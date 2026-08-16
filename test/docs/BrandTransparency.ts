/**
 * Issue #3764 — the family social previews are re-rendered with transparent
 * backgrounds so the artwork works in both light and dark modes, and the hub
 * README leads with the transparent hub preview.
 *
 * Behavioural tests: they read the committed PNGs' pixels and the committed
 * README, and assert what a reader would see — the canonical set really is
 * transparent, an opaque variant exists for GitHub's Social-preview upload
 * slot, and the README shows the hub mark plus the sibling gallery.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";
import { readPngPixels } from "./_pngPixels.ts";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const PREVIEWS_DIR = `${REPO_ROOT}/docs/brand/social-previews`;
const OPAQUE_DIR = `${PREVIEWS_DIR}/opaque`;
const README = `${REPO_ROOT}/README.md`;

/** The hub mark and its earlier approved alternate — not sibling repos. */
const HUB_PREVIEWS = ["neat-ai.png", "neat-ai-organic-approved.png"];

/** Sample every Nth pixel — a full 1280x640 sweep proves nothing extra. */
const SAMPLE_STEP = 8;

async function pngNamesIn(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".png")) names.push(entry.name);
  }
  return names.sort();
}

/** Alpha statistics over a sampled grid of the image. */
async function alphaProfile(path: string) {
  const png = await readPngPixels(path);
  let transparent = 0;
  let opaque = 0;
  let sampled = 0;
  for (let y = 0; y < png.height; y += SAMPLE_STEP) {
    for (let x = 0; x < png.width; x += SAMPLE_STEP) {
      const alpha = png.alphaAt(x, y);
      sampled++;
      if (alpha === 0) transparent++;
      if (alpha === 255) opaque++;
    }
  }
  return {
    colourType: png.colourType,
    corners: [
      png.alphaAt(0, 0),
      png.alphaAt(png.width - 1, 0),
      png.alphaAt(0, png.height - 1),
      png.alphaAt(png.width - 1, png.height - 1),
    ],
    transparentShare: transparent / sampled,
    opaqueShare: opaque / sampled,
  };
}

Deno.test("every social preview has a transparent background", async () => {
  const names = await pngNamesIn(PREVIEWS_DIR);
  assert(names.length > 0, "docs/brand/social-previews/ has no images");

  const profiles = await Promise.all(
    names.map(async (name) => ({
      name,
      ...(await alphaProfile(`${PREVIEWS_DIR}/${name}`)),
    })),
  );

  const failures = profiles.flatMap(({ name, ...profile }) => {
    if (profile.colourType !== 6) {
      return [
        `${name} has no alpha channel (colour type ${profile.colourType})`,
      ];
    }
    const problems: string[] = [];
    if (profile.corners.some((alpha) => alpha !== 0)) {
      problems.push(`${name} corners are not transparent: ${profile.corners}`);
    }
    if (profile.transparentShare < 0.2) {
      problems.push(
        `${name} is only ${
          (profile.transparentShare * 100).toFixed(1)
        }% transparent`,
      );
    }
    return problems;
  });
  assertEquals(
    failures,
    [],
    "social previews must have transparent backgrounds",
  );
});

Deno.test("every social preview still draws artwork", async () => {
  const names = await pngNamesIn(PREVIEWS_DIR);
  const shares = await Promise.all(
    names.map(async (name) => ({
      name,
      share: (await alphaProfile(`${PREVIEWS_DIR}/${name}`)).opaqueShare,
    })),
  );
  const blank = shares.filter((s) => s.share < 0.02).map((s) => s.name);
  assertEquals(
    blank,
    [],
    "transparent previews must still carry visible artwork",
  );
});

Deno.test("each social preview ships an opaque variant for GitHub uploads", async () => {
  const transparent = await pngNamesIn(PREVIEWS_DIR);
  const opaque = await pngNamesIn(OPAQUE_DIR);
  assertEquals(
    opaque,
    transparent,
    "docs/brand/social-previews/opaque/ must mirror the transparent set",
  );

  const shares = await Promise.all(
    opaque.map(async (name) => ({
      name,
      share: (await alphaProfile(`${OPAQUE_DIR}/${name}`)).opaqueShare,
    })),
  );
  const failures = shares
    .filter((s) => s.share < 1)
    .map((s) =>
      `opaque/${s.name} is only ${(s.share * 100).toFixed(1)}% opaque`
    );
  assertEquals(failures, [], "GitHub upload variants must be fully opaque");
});

Deno.test("the README leads with the transparent hub preview", async () => {
  const readme = await Deno.readTextFile(README);
  assert(
    readme.includes("docs/brand/social-previews/neat-ai.png"),
    "README.md does not show docs/brand/social-previews/neat-ai.png",
  );
  assert(
    !readme.includes("docs/logo.png"),
    "README.md still shows the superseded docs/logo.png",
  );
});

Deno.test("the README gallery links every sibling preview", async () => {
  const readme = await Deno.readTextFile(README);
  const siblings = (await pngNamesIn(PREVIEWS_DIR)).filter(
    (name) => !HUB_PREVIEWS.includes(name),
  );
  assert(siblings.length > 0, "no sibling previews found");

  const missing = siblings.filter(
    (name) => !readme.includes(`docs/brand/social-previews/${name}`),
  );
  assertEquals(missing, [], "README.md sibling gallery is missing preview(s)");
});
