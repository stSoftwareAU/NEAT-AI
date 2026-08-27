/**
 * GitHub's Social-preview upload slot refuses files of 1 MB or larger, so the
 * family ships a set under `github/` that is 1280×640 and under that cap.
 * Since Issue #3903 those uploads are **transparent** PNGs — quantised onto a
 * palette rather than flattened onto the brand navy as JPEGs.
 *
 * Behavioural tests: they read the committed uploads' pixels and assert what
 * Settings would reject or a viewer would notice — wrong canvas, oversize
 * file, a lost transparent background, or a sibling with no upload.
 * `source/` masters stay at native resolution and are not part of this set.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";
import {
  GITHUB_MAX_BYTES,
  GITHUB_SUBDIR,
  githubUploadName,
} from "../../scripts/brand/github_preview.ts";
import {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
} from "../../scripts/brand/preview_art.ts";
import { readPngPixels } from "./_pngPixels.ts";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const PREVIEWS_DIR = `${REPO_ROOT}/docs/brand/social-previews`;
const GITHUB_DIR = `${PREVIEWS_DIR}/${GITHUB_SUBDIR}`;

/** Sample every Nth pixel — a full 1280×640 sweep proves nothing extra. */
const SAMPLE_STEP = 8;

/** The pad around the artwork, so a flattened upload fails here. */
const MIN_TRANSPARENT_SHARE = 0.2;

async function pngNamesIn(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(".png")) names.push(entry.name);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return names;
    throw error;
  }
  return names.sort();
}

Deno.test("each social preview ships a GitHub upload under 1 MB", async () => {
  const previews = await pngNamesIn(PREVIEWS_DIR);
  const expected = previews.map(githubUploadName).sort();
  const onDisk = await pngNamesIn(GITHUB_DIR);
  assertEquals(
    onDisk,
    expected,
    `docs/brand/social-previews/${GITHUB_SUBDIR}/ must mirror the preview set`,
  );
  assert(onDisk.length > 0, `no GitHub uploads in ${GITHUB_DIR}`);

  const inspections = await Promise.all(onDisk.map(async (name) => {
    const path = `${GITHUB_DIR}/${name}`;
    const bytes = await Deno.readFile(path);
    const problems: string[] = [];
    if (bytes.byteLength >= GITHUB_MAX_BYTES) {
      problems.push(
        `${name} is ${
          (bytes.byteLength / 1024).toFixed(1)
        } KB; GitHub cap is 1 MB`,
      );
    }
    const png = await readPngPixels(path);
    if (png.width !== PREVIEW_WIDTH || png.height !== PREVIEW_HEIGHT) {
      problems.push(`${name} is ${png.width}×${png.height}`);
    }
    return problems;
  }));
  assertEquals(
    inspections.flat(),
    [],
    "GitHub uploads must be 1280×640 PNGs under 1 MB",
  );
});

Deno.test("every GitHub upload keeps its transparent background", async () => {
  const names = await pngNamesIn(GITHUB_DIR);
  assert(names.length > 0, `no GitHub uploads in ${GITHUB_DIR}`);

  const profiles = await Promise.all(names.map(async (name) => {
    const png = await readPngPixels(`${GITHUB_DIR}/${name}`);
    let transparent = 0;
    let sampled = 0;
    for (let y = 0; y < png.height; y += SAMPLE_STEP) {
      for (let x = 0; x < png.width; x += SAMPLE_STEP) {
        sampled++;
        if (png.alphaAt(x, y) === 0) transparent++;
      }
    }
    return {
      name,
      corners: [
        png.alphaAt(0, 0),
        png.alphaAt(png.width - 1, 0),
        png.alphaAt(0, png.height - 1),
        png.alphaAt(png.width - 1, png.height - 1),
      ],
      transparentShare: transparent / sampled,
    };
  }));

  const failures = profiles.flatMap((profile) => {
    const problems: string[] = [];
    if (profile.corners.some((alpha) => alpha !== 0)) {
      problems.push(
        `${profile.name} corners are not transparent: ${profile.corners}`,
      );
    }
    if (profile.transparentShare < MIN_TRANSPARENT_SHARE) {
      problems.push(
        `${profile.name} is only ${
          (profile.transparentShare * 100).toFixed(1)
        }% transparent`,
      );
    }
    return problems;
  });
  assertEquals(
    failures,
    [],
    "GitHub uploads must keep the transparent background",
  );
});

Deno.test("no flattened JPEG uploads are left behind", async () => {
  const leftovers: string[] = [];
  for await (const entry of Deno.readDir(GITHUB_DIR)) {
    if (entry.isFile && !entry.name.endsWith(".png")) {
      leftovers.push(entry.name);
    }
  }
  assertEquals(
    leftovers.sort(),
    [],
    `${GITHUB_SUBDIR}/ must hold only the transparent PNG uploads`,
  );
});
