/**
 * The neuron-A mark is embedded in every social preview as base64 PNG bytes.
 * A corrupt mark is dropped silently by the rasteriser — the preview renders
 * without the family mark and nothing reports a fault — so the committed mark
 * is checked here, and the checker itself is driven with damaged input.
 */

import { assertThrows } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";
import { assertSoundPng } from "../../scripts/brand/png_integrity.ts";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const MARK_PATH = `${REPO_ROOT}/docs/brand/templates/neuron-a-mark.png`;

/** Offset of the first chunk's type field, past the 8-byte PNG signature. */
const FIRST_CHUNK_TYPE = 12;

Deno.test("the committed neuron-A mark is a sound PNG", async () => {
  assertSoundPng(await Deno.readFile(MARK_PATH), MARK_PATH);
});

Deno.test("a mark with a damaged chunk fails loudly", async () => {
  const bytes = await Deno.readFile(MARK_PATH);
  const damaged = bytes.slice();
  damaged[damaged.length - 20] ^= 0xff;
  assertThrows(
    () => assertSoundPng(damaged, "damaged.png"),
    Error,
    "is corrupt",
  );
});

Deno.test("a truncated mark fails loudly", async () => {
  const bytes = await Deno.readFile(MARK_PATH);
  assertThrows(
    () => assertSoundPng(bytes.slice(0, bytes.length - 40), "truncated.png"),
    Error,
    "truncated.png",
  );
});

Deno.test("bytes that are not a PNG fail loudly", () => {
  assertThrows(
    () => assertSoundPng(new TextEncoder().encode("not a png"), "text.png"),
    Error,
    "not a PNG",
  );
});

Deno.test("a PNG missing its IHDR fails loudly", async () => {
  const bytes = await Deno.readFile(MARK_PATH);
  const renamed = bytes.slice();
  renamed.set(new TextEncoder().encode("iHDr"), FIRST_CHUNK_TYPE);
  assertThrows(
    () => assertSoundPng(renamed, "no-ihdr.png"),
    Error,
    // The rename breaks that chunk's CRC first, which is itself a loud failure.
    "no-ihdr.png",
  );
});
