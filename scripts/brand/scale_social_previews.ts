#!/usr/bin/env -S deno run -A
/**
 * Fit large masters in `docs/brand/social-previews/source/` onto GitHub's
 * 1280×640 canvas.
 *
 * Hand-authored socials are kept at native resolution under `source/` so they
 * can be downscaled again later. This writes:
 *
 * - `docs/brand/social-previews/<file>` — contain-fitted, transparent pad
 * - `docs/brand/social-previews/opaque/<file>` — the same pixels on brand navy
 * - `docs/brand/social-previews/github/<file>` — the same transparent pixels
 *   quantised to a 1280×640 PNG under 1 MB for GitHub Settings → Social
 *   preview. `source/` is never written.
 *
 * Usage:
 *   deno run -A scripts/brand/scale_social_previews.ts
 *   deno run -A scripts/brand/scale_social_previews.ts --github-only
 *
 * `--github-only` rebuilds `github/*.png` from the already-fitted transparent
 * PNGs and does not read or write `source/`.
 *
 * Previews without a `source/` master are left alone (they still come from
 * `render_social_previews.ts`).
 */

import { Resvg } from "@resvg/resvg-js";
import { fromFileUrl, resolve } from "@std/path";
import { writeGithubPng } from "./github_preview.ts";
import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from "./preview_art.ts";
import { assertSoundPng } from "./png_integrity.ts";

const NAVY = "#0B1220";
const RESVG_OPTIONS = { font: { loadSystemFonts: false } } as const;

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function encodeBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Scale `src` to sit inside the canvas without cropping or stretching. */
function containBox(
  srcWidth: number,
  srcHeight: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(
    PREVIEW_WIDTH / srcWidth,
    PREVIEW_HEIGHT / srcHeight,
  );
  const width = srcWidth * scale;
  const height = srcHeight * scale;
  return {
    x: (PREVIEW_WIDTH - width) / 2,
    y: (PREVIEW_HEIGHT - height) / 2,
    width,
    height,
  };
}

function previewSvg(
  href: string,
  box: { x: number; y: number; width: number; height: number },
  background: string | null,
): string {
  const bg = background
    ? `<rect width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" fill="${background}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}">${bg}<image href="${href}" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"/></svg>`;
}

function renderPng(svg: string): Uint8Array {
  const image = new Resvg(svg, RESVG_OPTIONS).render();
  if (image.width !== PREVIEW_WIDTH || image.height !== PREVIEW_HEIGHT) {
    throw new Error(
      `rendered ${image.width}x${image.height}, expected ${PREVIEW_WIDTH}x${PREVIEW_HEIGHT}`,
    );
  }
  return image.asPng();
}

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

async function writeGithubFromFitted(outDir: string): Promise<void> {
  const names = await pngNamesIn(outDir);
  if (names.length === 0) {
    throw new Error(`no fitted PNGs in ${outDir}`);
  }
  const uploads = await Promise.all(names.map(async (name) => {
    const bytes = await Deno.readFile(`${outDir}/${name}`);
    assertSoundPng(bytes, name);
    const upload = await writeGithubPng(outDir, name, bytes);
    return { png: name, ...upload };
  }));
  for (const upload of uploads) {
    console.info(
      `${upload.png} → github/${upload.name} ${upload.colours} colours ` +
        `${(upload.bytes / 1024).toFixed(0)} KB`,
    );
  }
}

async function main(): Promise<void> {
  const args = Deno.args;
  const outIndex = args.indexOf("--out");
  const repoRoot = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
  const outDir = outIndex >= 0 && args[outIndex + 1]
    ? resolve(args[outIndex + 1])
    : `${repoRoot}/docs/brand/social-previews`;

  if (args.includes("--github-only")) {
    await writeGithubFromFitted(outDir);
    return;
  }
  const sourceDir = `${outDir}/source`;

  const masters = await pngNamesIn(sourceDir);
  if (masters.length === 0) {
    throw new Error(`no PNG masters in ${sourceDir}`);
  }

  await Deno.mkdir(`${outDir}/opaque`, { recursive: true });

  const jobs = await Promise.all(masters.map(async (name) => {
    const bytes = await Deno.readFile(`${sourceDir}/${name}`);
    assertSoundPng(bytes, `source/${name}`);
    const { width, height } = pngSize(bytes);
    const box = containBox(width, height);
    const href = `data:image/png;base64,${encodeBase64(bytes)}`;

    const transparent = renderPng(previewSvg(href, box, null));
    const opaque = renderPng(previewSvg(href, box, NAVY));
    assertSoundPng(transparent, name);
    assertSoundPng(opaque, `opaque/${name}`);

    return { name, width, height, transparent, opaque };
  }));

  await Promise.all(jobs.flatMap((job) => [
    Deno.writeFile(`${outDir}/${job.name}`, job.transparent),
    Deno.writeFile(`${outDir}/opaque/${job.name}`, job.opaque),
  ]));

  const github = await Promise.all(
    jobs.map((job) => writeGithubPng(outDir, job.name, job.transparent)),
  );

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const upload = github[i];
    console.info(
      `${job.name}: ${job.width}×${job.height} → ${PREVIEW_WIDTH}×` +
        `${PREVIEW_HEIGHT}; github/${upload.name} ${upload.colours} colours ` +
        `${(upload.bytes / 1024).toFixed(0)} KB`,
    );
  }
}

if (import.meta.main) await main();
