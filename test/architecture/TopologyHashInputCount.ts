/**
 * Test suite verifying that getTopologyHash includes the creature's input
 * count in the hash computation.
 *
 * Issue #2301: The WASM compilation cache topology hash did not include
 * creature.input. When Upgrade.correct() extends input count (e.g. 5 → 12)
 * without adding neurons or synapses, the topology hash remained identical,
 * causing a cache collision where a WASM module compiled for 5 inputs was
 * reused for a creature with 12 inputs.
 */
import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("topology hash differs when input count differs (#2301)", () => {
  // Build two creatures with identical neurons and synapses but different
  // input counts. The topology hash MUST differ because the WASM binary
  // template encodes numInputs.
  const makeJson = (inputCount: number): CreatureExport => ({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "LOGISTIC", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: inputCount,
    output: 1,
  });

  const creature5 = Creature.fromJSON(makeJson(5));
  const creature12 = Creature.fromJSON(makeJson(12));

  const hash5 = CreatureUtil.getTopologyHash(creature5);
  const hash12 = CreatureUtil.getTopologyHash(creature12);

  assertNotEquals(
    hash5,
    hash12,
    "Creatures with different input counts must produce different topology hashes",
  );
});

Deno.test("topology hash is stable when input count is the same (#2301)", () => {
  // Ensure that including input count does not break the existing behaviour
  // where two creatures with the same topology produce the same hash.
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.3 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.7 },
    ],
    input: 3,
    output: 1,
  };

  const creature1 = Creature.fromJSON(json);
  const creature2 = Creature.fromJSON(json);

  assertEquals(
    CreatureUtil.getTopologyHash(creature1),
    CreatureUtil.getTopologyHash(creature2),
    "Creatures with identical topology and input count must produce the same hash",
  );
});

Deno.test("topology hash differs for various input count pairs (#2301)", () => {
  // Test multiple input count pairs to confirm robustness.
  const makeCreature = (inputCount: number): Creature =>
    Creature.fromJSON({
      neurons: [
        { type: "hidden", uuid: "hidden-a", squash: "RELU", bias: 0.0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-a", weight: 1.0 },
        { fromUUID: "hidden-a", toUUID: "output-0", weight: 1.0 },
      ],
      input: inputCount,
      output: 1,
    });

  const hashes = new Set<string>();
  for (const count of [1, 2, 5, 10, 20, 100]) {
    const creature = makeCreature(count);
    const hash = CreatureUtil.getTopologyHash(creature);
    hashes.add(hash);
  }

  assertEquals(
    hashes.size,
    6,
    "Each distinct input count must produce a unique topology hash",
  );
});

Deno.test("incremental hash includes input count after neuron cache reuse (#2301)", () => {
  // Issue #2258 introduced neuron-key caching. Verify that the input count
  // is still included even when the neuron cache is reused.
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.3 },
    ],
    input: 4,
    output: 1,
  });

  // Full computation.
  creature.topologyHash = undefined;
  creature._cachedNeuronTopologyKey = undefined;
  creature._cachedUuidLookup = undefined;
  const fullHash = CreatureUtil.getTopologyHash(creature);

  // Incremental computation (neuron cache retained).
  creature.topologyHash = undefined;
  const incrementalHash = CreatureUtil.getTopologyHash(creature);

  assertEquals(
    fullHash,
    incrementalHash,
    "Incremental hash must match full recompute when input count is the same",
  );
});
