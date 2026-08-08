import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { chooseNeurons } from "@propagate/sparse/ChooseNeurons.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";

/**
 * Cluster-expansion tests for the breadth-first traversal inside
 * `chooseNeurons` (the non-exported `getConnectedNeurons`, issue #1030).
 *
 * Every test drives the real `chooseNeurons` entry point over a creature whose
 * topology makes the one-step / two-step outcome assertable: each component has
 * a diameter of two, so a cluster seeded anywhere inside it expands to exactly
 * that component and never crosses into a disconnected one.
 */

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34];

/** Runs `chooseNeurons` under a seeded RNG so the shuffle is reproducible. */
function selectNeurons(
  creature: Creature,
  sparseRatio: number,
  seed: number,
): Set<number> {
  const previousRng = getRandomNumberGenerator();
  try {
    setRandomNumberGenerator(createSeededRng(seed));
    const config = createBackPropagationConfig({ sparseRatio });
    return new Set(chooseNeurons(exportJSONWithRuntimeIds(creature), config));
  } finally {
    setRandomNumberGenerator(previousRng);
  }
}

/** Maps stable neuron UUIDs to the runtime integer ids `chooseNeurons` returns. */
function idsOf(creature: Creature, uuids: string[]): Set<number> {
  const byUuid = new Map<string, number>();
  creature.neurons.forEach((neuron) => {
    if (neuron.uuid !== undefined) byUuid.set(neuron.uuid, neuron.id);
  });

  return new Set(uuids.map((uuid) => {
    const id = byUuid.get(uuid);
    assert(id !== undefined, `No neuron with uuid ${uuid}`);
    return id;
  }));
}

function makeCreature(json: CreatureExport): Creature {
  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

/**
 * Two disconnected diamonds. Each hub feeds two hidden neurons that rejoin at
 * an output, so the component contains an (undirected) cycle and every member
 * is at most two steps from every other.
 */
function makeTwinDiamonds(): Creature {
  return makeCreature({
    neurons: [
      { type: "hidden", uuid: "a-hub", bias: 0, squash: "RELU" },
      { type: "hidden", uuid: "a-1", bias: 0, squash: "RELU" },
      { type: "hidden", uuid: "a-2", bias: 0, squash: "RELU" },
      { type: "hidden", uuid: "b-hub", bias: 0, squash: "RELU" },
      { type: "hidden", uuid: "b-1", bias: 0, squash: "RELU" },
      { type: "hidden", uuid: "b-2", bias: 0, squash: "RELU" },
      { type: "output", uuid: "output-0", bias: 0, squash: "RELU" },
      { type: "output", uuid: "output-1", bias: 0, squash: "RELU" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "a-hub", weight: 0.5 },
      { fromUUID: "a-hub", toUUID: "a-1", weight: 0.5 },
      { fromUUID: "a-hub", toUUID: "a-2", weight: 0.5 },
      { fromUUID: "a-1", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "a-2", toUUID: "output-0", weight: 0.5 },

      { fromUUID: "input-1", toUUID: "b-hub", weight: 0.5 },
      { fromUUID: "b-hub", toUUID: "b-1", weight: 0.5 },
      { fromUUID: "b-hub", toUUID: "b-2", weight: 0.5 },
      { fromUUID: "b-1", toUUID: "output-1", weight: 0.5 },
      { fromUUID: "b-2", toUUID: "output-1", weight: 0.5 },
    ],
    input: 2,
    output: 2,
  });
}

/** Two disconnected three-neuron paths: `c-0 — c-1 — output-0`. */
function makeTwinPaths(): Creature {
  return makeCreature({
    neurons: [
      { type: "hidden", uuid: "c-0", bias: 0, squash: "RELU" },
      { type: "hidden", uuid: "c-1", bias: 0, squash: "RELU" },
      { type: "hidden", uuid: "d-0", bias: 0, squash: "RELU" },
      { type: "hidden", uuid: "d-1", bias: 0, squash: "RELU" },
      { type: "output", uuid: "output-0", bias: 0, squash: "RELU" },
      { type: "output", uuid: "output-1", bias: 0, squash: "RELU" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "c-0", weight: 0.5 },
      { fromUUID: "c-0", toUUID: "c-1", weight: 0.5 },
      { fromUUID: "c-1", toUUID: "output-0", weight: 0.5 },

      { fromUUID: "input-1", toUUID: "d-0", weight: 0.5 },
      { fromUUID: "d-0", toUUID: "d-1", weight: 0.5 },
      { fromUUID: "d-1", toUUID: "output-1", weight: 0.5 },
    ],
    input: 2,
    output: 2,
  });
}

/**
 * One three-neuron path plus `output-1`, which is driven straight from an input
 * and therefore has no eligible (hidden/output) neighbour at all.
 */
function makePathWithIsolatedOutput(): Creature {
  return makeCreature({
    neurons: [
      { type: "hidden", uuid: "c-0", bias: 0, squash: "RELU" },
      { type: "hidden", uuid: "c-1", bias: 0, squash: "RELU" },
      { type: "output", uuid: "output-0", bias: 0, squash: "RELU" },
      { type: "output", uuid: "output-1", bias: 0, squash: "RELU" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "c-0", weight: 0.5 },
      { fromUUID: "c-0", toUUID: "c-1", weight: 0.5 },
      { fromUUID: "c-1", toUUID: "output-0", weight: 0.5 },

      { fromUUID: "input-1", toUUID: "output-1", weight: 0.5 },
    ],
    input: 2,
    output: 2,
  });
}

/**
 * `clusterCount` disconnected fans, each `input-i → hub-i → leaf-i-j → output-i`,
 * giving `leafCount + 2` eligible neurons per component and a diameter of two.
 */
function makeFanClusters(clusterCount: number, leafCount: number): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  for (let cluster = 0; cluster < clusterCount; cluster++) {
    const hub = `hub-${cluster}`;
    neurons.push({ type: "hidden", uuid: hub, bias: 0, squash: "RELU" });
    synapses.push({
      fromUUID: `input-${cluster}`,
      toUUID: hub,
      weight: 0.5,
    });

    for (let leaf = 0; leaf < leafCount; leaf++) {
      const uuid = `leaf-${cluster}-${leaf}`;
      neurons.push({ type: "hidden", uuid, bias: 0, squash: "RELU" });
      synapses.push({ fromUUID: hub, toUUID: uuid, weight: 0.5 });
      synapses.push({
        fromUUID: uuid,
        toUUID: `output-${cluster}`,
        weight: 0.5,
      });
    }
  }

  for (let cluster = 0; cluster < clusterCount; cluster++) {
    neurons.push({
      type: "output",
      uuid: `output-${cluster}`,
      bias: 0,
      squash: "RELU",
    });
  }

  return makeCreature({
    neurons,
    synapses,
    input: clusterCount,
    output: clusterCount,
  });
}

function clusterUuids(cluster: number, leafCount: number): string[] {
  const uuids = [`hub-${cluster}`, `output-${cluster}`];
  for (let leaf = 0; leaf < leafCount; leaf++) {
    uuids.push(`leaf-${cluster}-${leaf}`);
  }
  return uuids;
}

Deno.test("chooseNeurons - cluster expansion stays inside one component", () => {
  const creature = makeTwinDiamonds();
  const diamondA = idsOf(creature, ["a-hub", "a-1", "a-2", "output-0"]);
  const diamondB = idsOf(creature, ["b-hub", "b-1", "b-2", "output-1"]);

  for (const seed of SEEDS) {
    // 4 of the 8 eligible neurons — exactly one diamond's worth.
    const selected = selectNeurons(creature, 0.5, seed);

    assert(
      setsEqual(selected, diamondA) || setsEqual(selected, diamondB),
      `seed ${seed}: expected one whole diamond, got ${[...selected]}`,
    );
  }
});

Deno.test("chooseNeurons - two-step reach covers the far end of a path", () => {
  const creature = makeTwinPaths();
  const pathC = idsOf(creature, ["c-0", "c-1", "output-0"]);
  const pathD = idsOf(creature, ["d-0", "d-1", "output-1"]);

  for (const seed of SEEDS) {
    // 3 of the 6 eligible neurons — one whole path. The ends of a path are two
    // steps apart, so the quota can only be filled from a single path when the
    // traversal walks both hops out from the seed.
    const selected = selectNeurons(creature, 0.5, seed);

    assert(
      setsEqual(selected, pathC) || setsEqual(selected, pathD),
      `seed ${seed}: expected one whole path, got ${[...selected]}`,
    );
  }
});

Deno.test("chooseNeurons - a neuron with no eligible neighbours still terminates", () => {
  const creature = makePathWithIsolatedOutput();
  const pathC = idsOf(creature, ["c-0", "c-1", "output-0"]);
  const isolated = idsOf(creature, ["output-1"]);
  const eligible = new Set([...pathC, ...isolated]);

  for (const seed of SEEDS) {
    // 3 of the 4 eligible neurons.
    const selected = selectNeurons(creature, 0.75, seed);

    assertEquals(selected.size, 3, `seed ${seed}: wrong selection size`);
    for (const id of selected) {
      assert(eligible.has(id), `seed ${seed}: ${id} is not an eligible neuron`);
    }
    // The isolated output contributes no neighbours, so the remaining places
    // must be filled from the connected path.
    const fromPath = [...selected].filter((id) => pathC.has(id));
    assert(
      fromPath.length >= 2,
      `seed ${seed}: expected at least two path neurons, got ${fromPath}`,
    );
  }
});

Deno.test("chooseNeurons - larger creature still selects a single cluster", () => {
  const clusterCount = 3;
  const leafCount = 4;
  const creature = makeFanClusters(clusterCount, leafCount);
  const clusters = Array.from(
    { length: clusterCount },
    (_, cluster) => idsOf(creature, clusterUuids(cluster, leafCount)),
  );

  for (const seed of SEEDS) {
    // 6 of the 18 eligible neurons — exactly one fan.
    const selected = selectNeurons(creature, 1 / clusterCount, seed);

    assert(
      clusters.some((cluster) => setsEqual(selected, cluster)),
      `seed ${seed}: expected one whole cluster, got ${[...selected]}`,
    );
  }
});
