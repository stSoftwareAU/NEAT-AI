import { assert } from "@std/assert";
import { Creature } from "@creature";
import { Offspring } from "@architecture/Offspring.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import {
  createSeededRng,
  resetGlobalRandomNumberGeneratorForTesting,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Issue #3090: the forward-only Offspring repair routines used to rescan an
 * entire parent's neuron array (recomputing a wire label per entry) once per
 * offspring neuron, for both parents — an O(n²) on the default breeding path.
 * They now precompute a `wire label -> parent index` map once per parent and
 * resolve each label in O(1).
 *
 * These tests pin the observable contract the optimisation must preserve:
 * forward-only offspring are still repaired so that every hidden/output neuron
 * keeps at least one inbound connection and every constant keeps at least one
 * outbound connection, and breeding remains reproducible under a seeded RNG.
 */

/** Mother whose forward-only breeding regularly needs inbound/constant repair. */
function motherJson(): CreatureExport {
  return {
    input: 2,
    output: 1,
    forwardOnly: true,
    semanticVersion: "4.0.0",
    neurons: [
      { type: "constant", uuid: "constant-bias", bias: 0.3 },
      { type: "hidden", uuid: "hidden-a", squash: IDENTITY.NAME, bias: 0.1 },
      { type: "hidden", uuid: "hidden-b", squash: IDENTITY.NAME, bias: 0.2 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.4 },
      { fromUUID: "input-1", toUUID: "hidden-a", weight: -0.1 },
      { fromUUID: "constant-bias", toUUID: "hidden-a", weight: 0.2 },
      { fromUUID: "hidden-a", toUUID: "hidden-b", weight: 0.3 },
      { fromUUID: "input-0", toUUID: "hidden-b", weight: 0.2 },
      { fromUUID: "constant-bias", toUUID: "hidden-b", weight: 0.15 },
      { fromUUID: "hidden-b", toUUID: "output-0", weight: 0.9 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.05 },
    ],
  };
}

/** Father sharing some — but not all — wire labels with the mother. */
function fatherJson(): CreatureExport {
  return {
    input: 2,
    output: 1,
    forwardOnly: true,
    semanticVersion: "4.0.0",
    neurons: [
      { type: "constant", uuid: "constant-bias", bias: 0.3 },
      { type: "hidden", uuid: "hidden-b", squash: IDENTITY.NAME, bias: 0.05 },
      { type: "hidden", uuid: "hidden-c", squash: IDENTITY.NAME, bias: 0.06 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-b", weight: 0.11 },
      { fromUUID: "input-1", toUUID: "hidden-b", weight: 0.12 },
      { fromUUID: "hidden-b", toUUID: "hidden-c", weight: 0.13 },
      { fromUUID: "constant-bias", toUUID: "hidden-c", weight: 0.25 },
      { fromUUID: "input-1", toUUID: "hidden-c", weight: 0.14 },
      { fromUUID: "hidden-c", toUUID: "output-0", weight: 0.15 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.16 },
    ],
  };
}

/**
 * Every hidden/output neuron must have an inbound connection and every constant
 * must have an outbound connection after forward-only repair — the invariants
 * the wire-label map lookup is responsible for restoring.
 */
function assertRepairInvariants(child: Creature): void {
  for (let i = 0; i < child.neurons.length; i++) {
    const neuron = child.neurons[i];
    if (neuron.type === "hidden" || neuron.type === "output") {
      assert(
        child.inwardConnections(i).length > 0,
        `${neuron.type} neuron at index ${i} left without an inbound connection`,
      );
    } else if (neuron.type === "constant") {
      assert(
        child.outwardConnections(i).length > 0,
        `constant neuron at index ${i} left without an outbound connection`,
      );
    }
  }
}

Deno.test(
  "Offspring.breed: forward-only repair restores connectivity via wire-label map",
  async () => {
    await initWasmForTests();

    const mum = Creature.fromJSON(motherJson());
    const dad = Creature.fromJSON(fatherJson());
    mum.validate({ forwardOnly: true });
    dad.validate({ forwardOnly: true });

    let validChildren = 0;
    for (let i = 0; i < 400; i++) {
      const child = Offspring.breed(mum, dad, { forwardOnly: true });
      if (!child) continue;
      // Must not throw: repair must leave a valid forward-only topology.
      child.validate({ forwardOnly: true });
      assertRepairInvariants(child);
      validChildren++;
    }

    assert(validChildren > 0, "Expected at least one valid forward-only child");
  },
);

Deno.test(
  "Offspring.breed: forward-only repair is reproducible under a seeded RNG",
  async () => {
    await initWasmForTests();

    const mum = Creature.fromJSON(motherJson());
    const dad = Creature.fromJSON(fatherJson());
    mum.validate({ forwardOnly: true });
    dad.validate({ forwardOnly: true });

    const breedWithSeed = (seed: number): string | undefined => {
      setRandomNumberGenerator(createSeededRng(seed));
      const child = Offspring.breed(mum, dad, { forwardOnly: true });
      return child ? JSON.stringify(child.exportJSON()) : undefined;
    };

    try {
      // Find a seed that yields offspring, then confirm that re-breeding with
      // the same seed is byte-identical: the O(1) map lookup resolves the same
      // parent neuron the linear scan did.
      let seed = -1;
      let first: string | undefined;
      for (let s = 1; s <= 64 && first === undefined; s++) {
        first = breedWithSeed(s);
        if (first !== undefined) seed = s;
      }
      assert(first !== undefined, "No seed in range produced offspring");

      const second = breedWithSeed(seed);
      assert(
        first === second,
        "Seeded forward-only breeding must be reproducible",
      );

      const reborn = Creature.fromJSON(JSON.parse(first!));
      reborn.validate({ forwardOnly: true });
      assertRepairInvariants(reborn);
    } finally {
      resetGlobalRandomNumberGeneratorForTesting();
    }
  },
);
