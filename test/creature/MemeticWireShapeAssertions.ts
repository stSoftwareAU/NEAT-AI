/**
 * Shared assertions for the canonical memetic wire shape.
 *
 * The normative definition lives in `test/fixtures/golden/README.md`
 * ("🧠 The canonical memetic wire shape"). Two gates assert against it and
 * must not drift apart: the golden fixture gate
 * (`test/creature/GoldenMetadataRoundTrip.ts`, Issue #3814) checks the bytes
 * committed to disk, and the export gate
 * (`test/creature/MemeticCanonicalWireShape.ts`, Issue #3816) checks what a
 * freshly exported creature emits.
 *
 * This module holds assertions only — it registers no tests of its own.
 */
import { assert, assertEquals } from "@std/assert";
import type { MemeticWireData } from "@blackbox/MemeticWireData.ts";
import type { MemeticWeightWireRow } from "@creature/MemeticWireExport.ts";

/** A snapshot plus every ancestry snapshot beneath it, most recent first. */
export function snapshotsOf(memetic: MemeticWireData): MemeticWireData[] {
  const flat = [memetic];
  for (const ancestor of memetic.ancestry ?? []) {
    flat.push(...snapshotsOf(ancestor));
  }
  return flat;
}

/**
 * Asserts the canonical wire shape of one snapshot's `weights`: an array of
 * `{fromUUID, toUUID, weight}` rows, never a map. This is the exact contract
 * Issue #3810 found the Rust deserialiser had drifted from.
 */
export function assertWeightRows(
  weights: MemeticWireData["weights"],
  where: string,
): MemeticWeightWireRow[] {
  assert(
    Array.isArray(weights),
    `${where}: memetic weights must be an array of rows, not a map`,
  );
  for (const row of weights) {
    assertEquals(
      Object.keys(row).sort(),
      ["fromUUID", "toUUID", "weight"],
      `${where}: every weight row carries exactly fromUUID, toUUID and weight`,
    );
    assert(
      typeof row.fromUUID === "string" && row.fromUUID.length > 0,
      `${where}: weight row fromUUID must be a wire uuid`,
    );
    assert(
      typeof row.toUUID === "string" && row.toUUID.length > 0,
      `${where}: weight row toUUID must be a wire uuid`,
    );
    assertEquals(
      typeof row.weight,
      "number",
      `${where}: weight row weight must be a number`,
    );
  }
  return weights;
}

/**
 * Asserts the canonical shape of `biases`: a JSON object keyed by wire neuron
 * identity, never an array and never absent.
 */
export function assertBiasMap(
  biases: MemeticWireData["biases"],
  where: string,
): Record<string, number> {
  assert(
    biases !== undefined && biases !== null && typeof biases === "object" &&
      !Array.isArray(biases),
    `${where}: memetic biases must be an object, not an array or absent`,
  );
  for (const key of Object.keys(biases)) {
    assert(key.length > 0, `${where}: bias keys must be wire identities`);
    assertEquals(
      typeof biases[key],
      "number",
      `${where}: bias ${key} must be a number`,
    );
  }
  return biases;
}

/**
 * Asserts every snapshot of a memetic block — the top-level one and every
 * ancestry snapshot, at any depth — carries the canonical shape. Catches a
 * mix of shapes within a single creature, not just a wrong top-level shape.
 */
export function assertCanonicalMemetic(
  memetic: MemeticWireData,
  where: string,
): void {
  let depth = 0;
  for (const snapshot of snapshotsOf(memetic)) {
    const at = `${where} snapshot ${depth++}`;
    assertWeightRows(snapshot.weights, at);
    assertBiasMap(snapshot.biases, at);
  }
}
