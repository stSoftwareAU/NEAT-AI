/**
 * Issue #2117: Tests that compactUnused cleans up orphaned neurons
 * after removing a neuron.
 *
 * When compactUnused removes a hidden neuron that was the only outward
 * target of another hidden neuron, that feeder neuron is left with zero
 * outward connections. This must be cleaned up before validation.
 */

import { assert } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { compactUnused } from "@compact/CompactUnused.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

/**
 * Trace a creature with random data and run compactUnused.
 * Returns the compacted creature or undefined if no compaction occurred.
 */
function traceAndCompact(
  creature: Creature,
  sampleCount = 100,
): Creature | undefined {
  const inputCount = creature.input;
  const data: number[][] = [];
  for (let i = sampleCount; i--;) {
    const row: number[] = [];
    for (let j = inputCount; j--;) {
      row.push(Math.random());
    }
    data.push(row);
  }

  const config = createBackPropagationConfig();
  const sparseConfig = new SparseConfig(
    exportJSONWithRuntimeIds(creature),
    config,
  );

  const outputs: Float32Array[] = new Array(data.length);
  for (let i = data.length; i--;) {
    outputs[i] = creature.activate(new Float32Array(data[i]), false);
  }

  for (let i = data.length; i--;) {
    creature.activateAndTrace(
      new Float32Array(data[i]),
      false,
      sparseConfig,
    );
    creature.propagate(outputs[i], config, sparseConfig);
  }

  return compactUnused(creature.traceJSON(), config.plankConstant);
}

/**
 * Assert that a creature has no orphaned hidden or constant neurons
 * (i.e. every hidden/constant neuron has at least one outward connection).
 */
function assertNoOrphanedNeurons(creature: Creature): void {
  const exported = creature.exportJSON();
  const neuronsWithOutward = new Set<string>();
  for (const synapse of exported.synapses) {
    if (synapse.fromUUID) neuronsWithOutward.add(synapse.fromUUID);
  }

  for (const neuron of exported.neurons) {
    if (neuron.type === "hidden" || neuron.type === "constant") {
      assert(
        neuronsWithOutward.has(neuron.uuid!),
        `Orphaned ${neuron.type} neuron ${neuron.uuid} has no outward connections`,
      );
    }
  }
}

Deno.test("compactUnused - no orphaned neurons after removal (issue #2117)", () => {
  // Structure: input → hidden-A → hidden-B → output, plus input → output
  // hidden-A's only outward connection goes through hidden-B.
  // Whichever hidden neuron is removed, the other may become orphaned.
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-A", squash: "IDENTITY", bias: 0.5 },
      { type: "hidden", uuid: "hidden-B", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-A", weight: 2.0 },
      { fromUUID: "hidden-A", toUUID: "hidden-B", weight: 1.0 },
      { fromUUID: "hidden-B", toUUID: "output-0", weight: 0.001 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  creature.validate();

  // Run multiple attempts since compactUnused uses shuffled indices
  let compactedAtLeastOnce = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const fresh = Creature.fromJSON(json);
    const compacted = traceAndCompact(fresh);
    if (compacted) {
      compactedAtLeastOnce = true;
      // Core assertion: validation must pass (no orphaned neuron errors)
      compacted.validate();
      assertNoOrphanedNeurons(compacted);
    }
  }
  assert(compactedAtLeastOnce, "compactUnused should compact at least once");
});

Deno.test("compactUnused - cascade cleanup of chain of orphaned neurons (issue #2117)", () => {
  // Structure: input → A → B → C → output, plus input → output
  // Removing any neuron in the chain may orphan the others.
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-A", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-B", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-C", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-A", weight: 2.0 },
      { fromUUID: "hidden-A", toUUID: "hidden-B", weight: 1.0 },
      { fromUUID: "hidden-B", toUUID: "hidden-C", weight: 1.0 },
      { fromUUID: "hidden-C", toUUID: "output-0", weight: 0.001 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  creature.validate();

  let compactedAtLeastOnce = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const fresh = Creature.fromJSON(json);
    const compacted = traceAndCompact(fresh);
    if (compacted) {
      compactedAtLeastOnce = true;
      // Core assertion: no orphaned neurons after compaction
      compacted.validate();
      assertNoOrphanedNeurons(compacted);
    }
  }
  assert(compactedAtLeastOnce, "compactUnused should compact at least once");
});
