/**
 * GitHub's Social-preview upload slot refuses files of 1 MB or larger, so the
 * family ships a JPEG set under `github/` that is 1280×640 and under that cap.
 *
 * Behavioural tests: they read the committed JPEGs and assert what Settings
 * would reject — wrong canvas, oversize file, or a sibling with no upload.
 * `source/` masters stay at native resolution and are not part of this set.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";
import {
  GITHUB_MAX_BYTES,
  GITHUB_SUBDIR,
  githubJpegName,
  jpegSize,
} from "../../scripts/brand/github_preview.ts";
import {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
} from "../../scripts/brand/preview_art.ts";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const PREVIEWS_DIR = `${REPO_ROOT}/docs/brand/social-previews`;
const GITHUB_DIR = `${PREVIEWS_DIR}/${GITHUB_SUBDIR}`;

async function pngNamesIn(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".png")) names.push(entry.name);
  }
  return names.sort();
}

async function jpgNamesIn(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(".jpg")) names.push(entry.name);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return names;
    throw error;
  }
  return names.sort();
}

Deno.test("each social preview ships a GitHub upload under 1 MB", async () => {
  const previews = await pngNamesIn(PREVIEWS_DIR);
  const expected = previews.map(githubJpegName).sort();
  const onDisk = await jpgNamesIn(GITHUB_DIR);
  assertEquals(
    onDisk,
    expected,
    `docs/brand/social-previews/${GITHUB_SUBDIR}/ must mirror the preview set`,
  );

  const inspections = await Promise.all(onDisk.map(async (name) => {
    const bytes = await Deno.readFile(`${GITHUB_DIR}/${name}`);
    const problems: string[] = [];
    if (bytes.byteLength >= GITHUB_MAX_BYTES) {
      problems.push(
        `${name} is ${
          (bytes.byteLength / 1024).toFixed(1)
        } KB; GitHub cap is 1 MB`,
      );
    }
    const { width, height } = jpegSize(bytes, name);
    if (width !== PREVIEW_WIDTH || height !== PREVIEW_HEIGHT) {
      problems.push(`${name} is ${width}×${height}`);
    }
    return problems;
  }));
  const failures = inspections.flat();
  assert(onDisk.length > 0, `no GitHub uploads in ${GITHUB_DIR}`);
  assertEquals(failures, [], "GitHub uploads must be 1280×640 and under 1 MB");
});
