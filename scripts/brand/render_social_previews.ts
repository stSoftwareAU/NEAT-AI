#!/usr/bin/env -S deno run -A
/**
 * Issue #3764 — render the family social previews.
 *
 * Writes both sets from the one source of truth in `preview_specs.ts`:
 *
 * - `docs/brand/social-previews/*.png` — canonical, transparent background.
 * - `docs/brand/social-previews/opaque/*.png` — flattened on the brand navy.
 * - `docs/brand/social-previews/github/*.png` — the transparent set quantised
 *   under 1 MB for GitHub's Social preview upload slot.
 *
 * Specs that have a master in `social-previews/source/` are skipped — those
 * are hand-authored and fitted by `scale_social_previews.ts`.
 *
 * Usage: `deno run -A scripts/brand/render_social_previews.ts [--out DIR]`
 *
 * The rasteriser is `@resvg/resvg-js`, mapped in `deno.json` and pulled from
 * npm on first run — it is a developer tool for regenerating committed
 * artwork, not a runtime dependency of the library. Text is laid out from measured glyph extents, so
 * the lockup stays centred whichever font of {@link FONT_STACK} the host
 * resolves; re-render on a host with Helvetica or DejaVu Sans for artwork that
 * matches the committed set.
 */

import { Resvg } from "@resvg/resvg-js";
import { dirname, fromFileUrl, resolve } from "@std/path";
import {
  buildPreviewSvg,
  FONT_STACK,
  paletteFor,
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  type TextExtent,
  type ThemeName,
  xmlEscape,
} from "./preview_art.ts";
import { writeGithubPng } from "./github_preview.ts";
import { PREVIEW_SPECS } from "./preview_specs.ts";

const RESVG_OPTIONS = { font: { loadSystemFonts: true } } as const;

/** Measured text extents, keyed by run — resvg is re-entered per measure. */
const measurements = new Map<string, TextExtent>();

function measure(
  text: string,
  fontSize: number,
  fontWeight: number,
  fontFamily = FONT_STACK,
): TextExtent {
  const key = `${fontFamily}/${fontWeight}/${fontSize}/${text}`;
  const cached = measurements.get(key);
  if (cached) return cached;

  const probe = `<svg xmlns="http://www.w3.org/2000/svg" width="6000" ` +
    `height="1200"><text x="0" y="900" font-family="${fontFamily}" ` +
    `font-size="${fontSize}" font-weight="${fontWeight}" fill="#000">` +
    `${xmlEscape(text)}</text></svg>`;
  const box = new Resvg(probe, RESVG_OPTIONS).getBBox();
  if (!box) throw new Error(`could not measure text run: ${text}`);
  const extent: TextExtent = { width: box.width, height: box.height };
  measurements.set(key, extent);
  return extent;
}

function renderPng(svg: string): Uint8Array {
  const resvg = new Resvg(svg, RESVG_OPTIONS);
  const image = resvg.render();
  if (image.width !== PREVIEW_WIDTH || image.height !== PREVIEW_HEIGHT) {
    throw new Error(
      `rendered ${image.width}x${image.height}, expected ${PREVIEW_WIDTH}x${PREVIEW_HEIGHT}`,
    );
  }
  return image.asPng();
}

async function main(): Promise<void> {
  const args = Deno.args;
  const outIndex = args.indexOf("--out");
  const repoRoot = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
  const outDir = outIndex >= 0 && args[outIndex + 1]
    ? resolve(args[outIndex + 1])
    : `${repoRoot}/docs/brand/social-previews`;

  const sourceDir = `${outDir}/source`;
  const sourced = new Set<string>();
  try {
    for await (const entry of Deno.readDir(sourceDir)) {
      if (entry.isFile && entry.name.endsWith(".png")) sourced.add(entry.name);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }

  const themes: ThemeName[] = ["transparent", "opaque"];
  const jobs = PREVIEW_SPECS.flatMap((spec) => {
    if (sourced.has(spec.file)) return [];
    return themes.map((theme) => {
      const svg = buildPreviewSvg(spec, paletteFor(theme), measure);
      const png = renderPng(svg);
      const path = theme === "transparent"
        ? `${outDir}/${spec.file}`
        : `${outDir}/opaque/${spec.file}`;
      return {
        path,
        png,
        githubFile: theme === "transparent" ? spec.file : null,
      };
    });
  });

  await Promise.all(
    jobs.map(async (job) => {
      await Deno.mkdir(dirname(job.path), { recursive: true });
      await Deno.writeFile(job.path, job.png);
      if (job.githubFile) {
        await writeGithubPng(outDir, job.githubFile, job.png);
      }
    }),
  );
  console.info(
    `Rendered ${jobs.length} previews into ${outDir}` +
      (sourced.size ? ` (skipped ${sourced.size} sourced)` : ""),
  );
}

if (import.meta.main) await main();
