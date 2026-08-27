/**
 * Issue #3903 — the GitHub Settings → Social preview uploads keep their
 * transparent background, so the encoder writes a quantised indexed PNG
 * instead of a flattened navy JPEG.
 *
 * Behavioural tests: they encode real RGBA pixels and decode the result,
 * asserting what GitHub's upload slot and a viewer would see — a PNG on the
 * 1280×640 canvas, under the 1 MB cap, with the transparent pad intact.
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { Buffer } from "node:buffer";
import { PNG } from "pngjs";
import {
  encodeGithubPng,
  GITHUB_MAX_BYTES,
  githubUploadName,
  writeGithubPng,
} from "../../scripts/brand/github_preview.ts";
import {
  encodeIndexedPng,
  quantise,
} from "../../scripts/brand/png_quantise.ts";
import {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
} from "../../scripts/brand/preview_art.ts";
import { assertSoundPng } from "../../scripts/brand/png_integrity.ts";
import { decodePngPixels } from "./_pngPixels.ts";

/**
 * An RGBA canvas shaped like the brand art: a transparent pad around a
 * gradient block, which is what forces quantisation to earn its keep.
 */
function gradientCanvas(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  const padX = Math.floor(width / 8);
  const padY = Math.floor(height / 8);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (x < padX || x >= width - padX || y < padY || y >= height - padY) {
        continue; // transparent pad: RGBA all zero
      }
      data[i] = (x * 251) % 256;
      data[i + 1] = (y * 199) % 256;
      data[i + 2] = ((x + y) * 137) % 256;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** Encode `data` as a truecolour-with-alpha PNG — the encoder's real input. */
function rgbaPng(width: number, height: number, data: Uint8Array): Uint8Array {
  const png = new PNG({ width, height });
  png.data = Buffer.from(data);
  return new Uint8Array(PNG.sync.write(png));
}

Deno.test("githubUploadName keeps the PNG extension", () => {
  assertEquals(githubUploadName("neat-ai.png"), "neat-ai.png");
  assertThrows(
    () => githubUploadName("neat-ai.jpg"),
    Error,
    "expected a .png name",
  );
});

Deno.test("quantise collapses colours but keeps the transparent pad", () => {
  const width = 64;
  const height = 32;
  const data = gradientCanvas(width, height);
  const { palette, indices } = quantise({ width, height, data }, 32);

  assert(palette.length / 4 <= 32, "palette exceeded the requested colours");
  assertEquals(indices.length, width * height);

  // The pad is fully transparent, so its palette entry must be alpha 0.
  const corner = indices[0];
  assertEquals(
    palette[corner * 4 + 3],
    0,
    "corner pixel lost its transparency",
  );

  // A lit pixel keeps a visible alpha.
  const centre = indices[(height / 2) * width + width / 2];
  assertEquals(palette[centre * 4 + 3], 255, "centre pixel lost its opacity");
});

Deno.test("quantise keeps every colour when the image has few", () => {
  const width = 4;
  const height = 2;
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    data[p * 4] = p % 2 === 0 ? 255 : 0;
    data[p * 4 + 3] = p < 4 ? 0 : 255;
  }
  const { palette, indices } = quantise({ width, height, data }, 256);
  const decoded = new Uint8Array(width * height * 4);
  for (let p = 0; p < indices.length; p++) {
    decoded.set(palette.subarray(indices[p] * 4, indices[p] * 4 + 4), p * 4);
  }
  // Fully transparent pixels normalise to RGBA 0,0,0,0 — alpha is what shows.
  for (let p = 0; p < width * height; p++) {
    assertEquals(decoded[p * 4 + 3], data[p * 4 + 3], `alpha at pixel ${p}`);
    if (data[p * 4 + 3] === 0) continue;
    assertEquals(decoded[p * 4], data[p * 4], `red at pixel ${p}`);
  }
});

Deno.test("encodeIndexedPng writes a sound, decodable PNG", async () => {
  const width = 16;
  const height = 8;
  const data = gradientCanvas(width, height);
  const { palette, indices } = quantise({ width, height, data }, 64);
  const png = encodeIndexedPng(width, height, palette, indices);

  assertSoundPng(png, "encodeIndexedPng output");
  const decoded = await decodePngPixels(png, "encodeIndexedPng output");
  assertEquals(decoded.width, width);
  assertEquals(decoded.height, height);
  assertEquals(decoded.colourType, 3, "expected an indexed PNG");
  assertEquals(decoded.alphaAt(0, 0), 0, "transparent pad was flattened");
  assertEquals(decoded.alphaAt(width / 2, height / 2), 255);
});

Deno.test("encodeGithubPng fits the preview canvas under GitHub's cap", async () => {
  const data = gradientCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT);
  const source = rgbaPng(PREVIEW_WIDTH, PREVIEW_HEIGHT, data);

  const { png, colours } = encodeGithubPng(source, "gradient.png");
  assert(
    png.byteLength < GITHUB_MAX_BYTES,
    `upload is ${png.byteLength} bytes; cap is ${GITHUB_MAX_BYTES}`,
  );
  assert(colours > 0 && colours <= 256, `unexpected palette size ${colours}`);

  const decoded = await decodePngPixels(png, "gradient upload");
  assertEquals(decoded.width, PREVIEW_WIDTH);
  assertEquals(decoded.height, PREVIEW_HEIGHT);
  assertEquals(decoded.alphaAt(0, 0), 0, "upload lost its transparent pad");
  assertEquals(
    decoded.alphaAt(PREVIEW_WIDTH / 2, PREVIEW_HEIGHT / 2),
    255,
    "upload lost its artwork",
  );
});

Deno.test("encodeGithubPng rejects art that is not the preview canvas", () => {
  const width = 640;
  const height = 320;
  const source = rgbaPng(width, height, gradientCanvas(width, height));
  assertThrows(
    () => encodeGithubPng(source, "small.png"),
    Error,
    "640×320",
  );
});

Deno.test("encodeGithubPng rejects bytes that are not a PNG", () => {
  assertThrows(
    () => encodeGithubPng(new Uint8Array([1, 2, 3, 4]), "junk.png"),
    Error,
    "junk.png",
  );
});

Deno.test("writeGithubPng writes the upload beside the previews", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat-github-preview-" });
  try {
    const source = rgbaPng(
      PREVIEW_WIDTH,
      PREVIEW_HEIGHT,
      gradientCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT),
    );
    const written = await writeGithubPng(dir, "neat-ai.png", source);
    assertEquals(written.name, "neat-ai.png");
    assert(written.bytes < GITHUB_MAX_BYTES);

    const onDisk = await Deno.readFile(`${dir}/github/neat-ai.png`);
    assertEquals(onDisk.byteLength, written.bytes);
    assertSoundPng(onDisk, "github/neat-ai.png");

    await assertRejects(
      () => writeGithubPng(dir, "neat-ai.jpg", source),
      Error,
      "expected a .png name",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
