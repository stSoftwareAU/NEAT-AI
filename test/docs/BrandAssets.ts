/**
 * NEAT-AI-Lamarck Issue #149 — the family brand set moved out of
 * NEAT-AI-Lamarck into this hub repository, so `docs/brand/` is now the
 * canonical home for the shared visual identity.
 *
 * These are behavioural ("what") tests: they read the committed files and
 * assert observable facts — the catalogue and the directory agree, every
 * social preview really is GitHub's 1280x640 canvas, and the brand docs'
 * relative links resolve. A half-finished move (catalogue row without an
 * image, image without a row, wrong-sized artwork) fails here rather than
 * being discovered when someone uploads a broken preview.
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const BRAND_DIR = `${REPO_ROOT}/docs/brand`;
const BRAND_README = `${BRAND_DIR}/README.md`;
const PREVIEWS_DIR = `${BRAND_DIR}/social-previews`;
const PREVIEWS_README = `${PREVIEWS_DIR}/README.md`;

/** GitHub's social preview canvas. */
const PREVIEW_WIDTH = 1280;
const PREVIEW_HEIGHT = 640;

/** PNG file names quoted in `content` as inline code, e.g. `foo.png`. */
function quotedPngNames(content: string): string[] {
  return [...content.matchAll(/`([\w.-]+\.png)`/g)].map((m) => m[1]);
}

/** PNG file names present in the directory at `dir`. */
async function pngFilesIn(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".png")) names.push(entry.name);
  }
  return names.sort();
}

/**
 * Width and height from a PNG's IHDR chunk — the first chunk of every PNG,
 * whose payload starts at byte 16 with two big-endian 32-bit integers.
 */
async function pngSize(
  path: string,
): Promise<{ width: number; height: number }> {
  const bytes = await Deno.readFile(path);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  assert(
    signature.every((b, i) => bytes[i] === b),
    `${path} is not a PNG`,
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Every PNG the renderer consumes or ships: the embedded neuron-A mark, the
 * canonical previews, and their opaque upload variants.
 */
async function renderedPngPaths(): Promise<string[]> {
  const previews = await pngFilesIn(PREVIEWS_DIR);
  const opaque = await pngFilesIn(`${PREVIEWS_DIR}/opaque`);
  return [
    `${BRAND_DIR}/templates/neuron-a-mark.png`,
    ...previews.map((name) => `${PREVIEWS_DIR}/${name}`),
    ...opaque.map((name) => `${PREVIEWS_DIR}/opaque/${name}`),
  ];
}

/**
 * Inflate a PNG's image data, throwing if the file is not decodable.
 *
 * The rasteriser (`@resvg/resvg-js`) skips an undecodable `<image>` without
 * complaining, so a corrupt asset silently renders as blank artwork instead of
 * failing loud. Concatenating the IDAT chunks and inflating them reproduces the
 * decode any renderer must do, so corruption surfaces here instead.
 */
async function assertPngDecodes(path: string): Promise<void> {
  const bytes = await Deno.readFile(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idat: Uint8Array[] = [];
  let offset = 8; // skip the 8-byte signature
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(
      bytes.subarray(offset + 4, offset + 8),
    );
    if (type === "IDAT") {
      idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length; // length + type + payload + CRC
  }
  assert(idat.length > 0, `${path} has no IDAT image data`);

  const stream = new Blob(idat as BlobPart[]).stream()
    .pipeThrough(new DecompressionStream("deflate"));
  let pixelBytes = 0;
  for await (const chunk of stream) pixelBytes += chunk.length;
  assert(pixelBytes > 0, `${path} decoded to no pixels`);
}

/** Relative link targets (no http(s), no bare anchors) found in `content`. */
function relativeLinkTargets(content: string): string[] {
  const targets: string[] = [];
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (target.startsWith("http://") || target.startsWith("https://")) continue;
    if (target.startsWith("#")) continue;
    const [pathPart] = target.split("#");
    if (pathPart) targets.push(pathPart);
  }
  return targets;
}

Deno.test("social-previews catalogue lists exactly the committed images", async () => {
  const catalogue = new Set(
    quotedPngNames(await Deno.readTextFile(PREVIEWS_README)),
  );
  const onDisk = await pngFilesIn(PREVIEWS_DIR);

  const missing = onDisk.filter((name) => !catalogue.has(name));
  assertEquals(
    missing,
    [],
    "docs/brand/social-previews/README.md omits committed preview(s)",
  );

  const orphaned = [...catalogue].filter((name) => !onDisk.includes(name));
  assertEquals(
    orphaned,
    [],
    "docs/brand/social-previews/README.md lists preview(s) that are not committed",
  );
});

Deno.test("every social preview uses GitHub's 1280x640 canvas", async () => {
  const names = await pngFilesIn(PREVIEWS_DIR);
  assert(names.length > 0, "docs/brand/social-previews/ has no images");

  const sizes = await Promise.all(
    names.map(async (name) => ({
      name,
      ...(await pngSize(`${PREVIEWS_DIR}/${name}`)),
    })),
  );
  const wrong = sizes
    .filter((s) => s.width !== PREVIEW_WIDTH || s.height !== PREVIEW_HEIGHT)
    .map((s) => `${s.name} is ${s.width}x${s.height}`);
  assertEquals(
    wrong,
    [],
    `social previews must be ${PREVIEW_WIDTH}x${PREVIEW_HEIGHT}`,
  );
});

Deno.test("brand docs' relative links resolve", async () => {
  const checked = await Promise.all(
    [BRAND_README, PREVIEWS_README].map(async (doc) => {
      const content = await Deno.readTextFile(doc);
      return await Promise.all(
        relativeLinkTargets(content).map(async (target) => {
          const resolved = resolve(dirname(doc), target);
          try {
            await Deno.stat(resolved);
            return null;
          } catch {
            return `${doc}: broken link ${target}`;
          }
        }),
      );
    }),
  );
  const failures = checked.flat().filter((c): c is string => c !== null);
  assertEquals(failures, [], "brand docs have broken relative links");
});

Deno.test("every rendered brand PNG decodes", async () => {
  const paths = await renderedPngPaths();
  assert(paths.length > 0, "docs/brand/ has no images");
  await Promise.all(paths.map(assertPngDecodes));
});

Deno.test("the documentation index points at the brand home", async () => {
  const index = await Deno.readTextFile(`${REPO_ROOT}/docs/README.md`);
  assert(
    relativeLinkTargets(index).some((t) =>
      t.replace(/^\.\//, "") ===
        "brand/README.md"
    ),
    "docs/README.md does not link docs/brand/README.md",
  );
});
