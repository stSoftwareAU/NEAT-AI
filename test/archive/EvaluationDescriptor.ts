/**
 * Descriptor stability and reproducibility (Issue #3929).
 *
 * The archive's whole contract is that a slot means the same thing in every
 * record. These tests hold that contract two ways: a **committed** creature
 * fixture whose descriptor is also committed, so a change to the computation
 * shows up as a failing diff rather than as a silently mixed feature space;
 * and the layout invariants that make a mixed archive detectable at all.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import {
  computeEvaluationDescriptor,
  DESCRIPTOR_V1_FIELD_NAMES,
  DESCRIPTOR_V1_SCALAR_NAMES,
  DESCRIPTOR_V1_SQUASH_NAMES,
  EVALUATION_DESCRIPTOR_LENGTH,
  EVALUATION_DESCRIPTOR_VERSION,
  NO_REFERENCE_DISTANCE,
} from "@archive/EvaluationDescriptor.ts";

const FIXTURE_DIR = new URL("../fixtures/archive/", import.meta.url);

async function readFixture<T>(name: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(new URL(name, FIXTURE_DIR)));
}

/** Slot index of a named field, so tests never hard-code an offset. */
function slot(name: string): number {
  const index = DESCRIPTOR_V1_FIELD_NAMES.indexOf(name);
  assert(index >= 0, `no descriptor slot named ${name}`);
  return index;
}

Deno.test("descriptor v1 — committed fixture re-derives to the committed vector", async () => {
  const json = await readFixture<CreatureExport>("descriptor-v1-creature.json");
  const expected = await readFixture<number[]>("descriptor-v1-expected.json");

  const descriptor = computeEvaluationDescriptor(Creature.fromJSON(json));

  // Exact equality, not "almost": a descriptor that drifts in the last bit is
  // a different feature space, and the drift is undetectable downstream.
  assertEquals(descriptor, expected);
});

Deno.test("descriptor v1 — survives an export/import round trip unchanged", async () => {
  const json = await readFixture<CreatureExport>("descriptor-v1-creature.json");
  const creature = Creature.fromJSON(json);

  const before = computeEvaluationDescriptor(creature);
  const after = computeEvaluationDescriptor(
    Creature.fromJSON(creature.exportJSON()),
  );

  assertEquals(after, before);
});

Deno.test("descriptor v1 — layout is fixed length with unique slot names", () => {
  assertEquals(EVALUATION_DESCRIPTOR_VERSION, 1);
  assertEquals(DESCRIPTOR_V1_FIELD_NAMES.length, EVALUATION_DESCRIPTOR_LENGTH);
  assertEquals(
    EVALUATION_DESCRIPTOR_LENGTH,
    DESCRIPTOR_V1_SCALAR_NAMES.length + DESCRIPTOR_V1_SQUASH_NAMES.length + 1,
  );
  assertEquals(
    new Set(DESCRIPTOR_V1_FIELD_NAMES).size,
    DESCRIPTOR_V1_FIELD_NAMES.length,
  );
});

Deno.test("descriptor v1 — every creature yields the same vector length", async () => {
  const json = await readFixture<CreatureExport>("descriptor-v1-creature.json");
  const small = new Creature(2, 1);
  const fixture = Creature.fromJSON(json);

  assertEquals(
    computeEvaluationDescriptor(small).length,
    EVALUATION_DESCRIPTOR_LENGTH,
  );
  assertEquals(
    computeEvaluationDescriptor(fixture).length,
    EVALUATION_DESCRIPTOR_LENGTH,
  );
});

Deno.test("descriptor v1 — squash aliases share one slot", () => {
  const withCanonical: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [{ type: "output", uuid: "output-0", squash: "ReLU", bias: 0 }],
    synapses: [{ fromUUID: "input-0", toUUID: "output-0", weight: 1 }],
  };
  const withAlias: CreatureExport = {
    ...withCanonical,
    neurons: [{ type: "output", uuid: "output-0", squash: "RELU", bias: 0 }],
  };

  const canonical = computeEvaluationDescriptor(
    Creature.fromJSON(withCanonical),
  );
  const alias = computeEvaluationDescriptor(Creature.fromJSON(withAlias));

  assertEquals(canonical[slot("squash:ReLU")], 1);
  assertEquals(alias, canonical);
});

Deno.test("descriptor v1 — genetic distance uses a sentinel when no reference exists", async () => {
  const json = await readFixture<CreatureExport>("descriptor-v1-creature.json");
  const creature = Creature.fromJSON(json);
  const twin = Creature.fromJSON(json);
  const distanceSlot = slot("geneticDistanceToReference");

  const unreferenced = computeEvaluationDescriptor(creature);
  assertEquals(unreferenced[distanceSlot], NO_REFERENCE_DISTANCE);

  // An identical twin is zero distance away — and that must not be confused
  // with "no reference", which is why the sentinel is negative.
  const referenced = computeEvaluationDescriptor(creature, twin);
  assertEquals(referenced[distanceSlot], 0);
  assertNotEquals(referenced[distanceSlot], NO_REFERENCE_DISTANCE);
});

Deno.test("descriptor v1 — structure moves the vector", async () => {
  const json = await readFixture<CreatureExport>("descriptor-v1-creature.json");
  const grown = structuredClone(json);
  grown.neurons.splice(4, 0, {
    type: "hidden",
    uuid: "hidden-e",
    squash: "SINE",
    bias: 0.4,
  });
  grown.synapses.push({
    fromUUID: "hidden-d",
    toUUID: "hidden-e",
    weight: 0.3,
  }, {
    fromUUID: "hidden-e",
    toUUID: "output-0",
    weight: 0.2,
  });

  const base = computeEvaluationDescriptor(Creature.fromJSON(json));
  const bigger = computeEvaluationDescriptor(Creature.fromJSON(grown));

  assertEquals(bigger[slot("neurons")], base[slot("neurons")] + 1);
  assertEquals(bigger[slot("hiddenNeurons")], base[slot("hiddenNeurons")] + 1);
  assertEquals(bigger[slot("synapses")], base[slot("synapses")] + 2);
  assertEquals(bigger[slot("squash:SINE")], 1);
});
