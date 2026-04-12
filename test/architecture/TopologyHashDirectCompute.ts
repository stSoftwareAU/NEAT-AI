/**
 * Test suite verifying that getTopologyHash produces identical results
 * when computed directly from internal structures (Issue #2257 optimisation)
 * vs the reference implementation using exportJSON().
 *
 * The optimisation in Issue #2257 changed getTopologyHash to compute the
 * hash directly from the creature's neurons and synapses arrays, avoiding
 * a full exportJSON() call. This test ensures the hash remains identical
 * to the export-based reference computation.
 */
import { assertEquals } from "@std/assert";
import { generate as generateV5Sync } from "@architecture/SyncV5.ts";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/** UUID namespace for topology hash (must match CreatureUtils.TOPOLOGY_NAMESPACE). */
const TOPOLOGY_NAMESPACE = "a1b2c3d4-e5f6-47a8-9b0c-d1e2f3a4b5c6";
const TE = new TextEncoder();

/**
 * Reference implementation: compute topology hash via exportJSON().
 * This is the original algorithm before the Issue #2257 optimisation.
 */
function referenceTopologyHash(creature: Creature): string {
  const holdDebug = creature.DEBUG;
  try {
    creature.DEBUG = false;
    const json = creature.exportJSON();

    const topologyNeurons = json.neurons.map((n) => ({
      uuid: n.uuid,
      type: n.type,
      squash: n.squash || "",
    }));

    topologyNeurons.sort((a, b) => (a.uuid ?? "").localeCompare(b.uuid ?? ""));

    const topologySynapses = json.synapses.map((s) => ({
      fromUUID: s.fromUUID,
      toUUID: s.toUUID,
    }));

    topologySynapses.sort((a, b) => {
      const fc = (a.fromUUID ?? "").localeCompare(b.fromUUID ?? "");
      if (fc !== 0) return fc;
      return (a.toUUID ?? "").localeCompare(b.toUUID ?? "");
    });

    const topologyData = {
      neurons: topologyNeurons,
      synapses: topologySynapses,
    };

    const txt = JSON.stringify(topologyData);
    const utf8 = TE.encode(txt);
    return generateV5Sync(TOPOLOGY_NAMESPACE, utf8);
  } finally {
    creature.DEBUG = holdDebug;
  }
}

Deno.test("direct topology hash matches export-based reference - simple creature", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  creature.topologyHash = undefined;
  const directHash = CreatureUtil.getTopologyHash(creature);
  const referenceHash = referenceTopologyHash(creature);

  assertEquals(
    directHash,
    referenceHash,
    "Direct-compute topology hash must match export-based reference",
  );
});

Deno.test("direct topology hash matches reference - multi-layer creature", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-a", squash: "TANH", bias: 0.1 },
      { type: "hidden", uuid: "hidden-b", squash: "LOGISTIC", bias: 0.2 },
      { type: "hidden", uuid: "hidden-c", squash: "RELU", bias: 0.3 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.1 },
      { fromUUID: "input-1", toUUID: "hidden-a", weight: 0.2 },
      { fromUUID: "input-0", toUUID: "hidden-b", weight: 0.3 },
      { fromUUID: "hidden-a", toUUID: "hidden-c", weight: 0.4 },
      { fromUUID: "hidden-b", toUUID: "hidden-c", weight: 0.5 },
      { fromUUID: "hidden-c", toUUID: "output-0", weight: 0.6 },
    ],
    input: 3,
    output: 1,
  });

  creature.topologyHash = undefined;
  const directHash = CreatureUtil.getTopologyHash(creature);
  const referenceHash = referenceTopologyHash(creature);

  assertEquals(
    directHash,
    referenceHash,
    "Direct-compute hash must match reference for multi-layer creature",
  );
});

Deno.test("direct topology hash matches reference - constant neurons", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "constant", uuid: "const-0", bias: 1.0 },
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "const-0", toUUID: "hidden-0", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  creature.topologyHash = undefined;
  const directHash = CreatureUtil.getTopologyHash(creature);
  const referenceHash = referenceTopologyHash(creature);

  assertEquals(
    directHash,
    referenceHash,
    "Direct-compute hash must match reference with constant neurons",
  );
});

Deno.test("direct topology hash matches reference - large constructed creature", () => {
  const creature = new Creature(20, 10, {
    layers: [{ count: 50 }, { count: 30 }],
  });

  creature.topologyHash = undefined;
  const directHash = CreatureUtil.getTopologyHash(creature);
  const referenceHash = referenceTopologyHash(creature);

  assertEquals(
    directHash,
    referenceHash,
    "Direct-compute hash must match reference for large constructed creature",
  );
});

Deno.test("direct topology hash matches reference - multiple outputs", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "BIPOLAR_SIGMOID", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-2", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.1 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-1", weight: 0.4 },
      { fromUUID: "hidden-0", toUUID: "output-2", weight: 0.5 },
    ],
    input: 3,
    output: 3,
  };
  const creature = Creature.fromJSON(json);

  creature.topologyHash = undefined;
  const directHash = CreatureUtil.getTopologyHash(creature);
  const referenceHash = referenceTopologyHash(creature);

  assertEquals(
    directHash,
    referenceHash,
    "Direct-compute hash must match reference with multiple outputs",
  );
});
