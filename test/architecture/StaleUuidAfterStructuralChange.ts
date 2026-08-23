/**
 * Issue #3843: a creature's `uuid` is content-derived, and it is trustworthy
 * only while it has been **under NEAT-AI's control the whole time**.
 *
 * Two halves to the contract:
 *
 *  1. **Provenance.** A uuid computed in-process by `CreatureUtil.makeUUID` is
 *     cached and returned as-is on every later call — recomputing a ~3 ms hash
 *     per creature per generation is exactly the expense the cache exists to
 *     avoid, so the short-circuit is a requirement, not an implementation
 *     detail. A uuid that arrived from *outside* the process (read from a file,
 *     deserialised from JSON, received over a wire) carries no such guarantee
 *     and must be discarded at the boundary.
 *
 *  2. **Invalidation.** Every in-process mutation that changes a hash input
 *     must shed the uuid, so the cached value can never describe a creature
 *     other than the one holding it.
 *
 * Why it matters: `Fitness.calculate` evaluates only creatures whose `score` is
 * `undefined` and deduplicates the queue **by uuid**, copying the
 * representative's `score` / `error` / tags onto every "duplicate". A creature
 * carrying an identity it did not earn is handed a score it never earned.
 *
 * Two things this must not break: per-neuron uuids are stable identity labels
 * and must survive a load; and a tag-only change must invalidate nothing.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type {
  CreatureExport,
  CreatureInternal,
} from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { compactCreature } from "@compact/CompactCreature.ts";
import { removeNeuron as removeUnusedNeuron } from "@compact/CompactUnused.ts";
import {
  createConstantOne,
  removeHiddenNeuron,
} from "@compact/OrphanedNeuronCleanup.ts";
import { simplify } from "@optimize/Simplify.ts";
import { restoreSource } from "@blackbox/RestoreSource.ts";
import { repairInvalidIfNeuronsInCreature } from "@architecture/RepairInvalidIfNeurons.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { initWasmForTests } from "../_initWasm.ts";

function baseExport(): CreatureExport {
  return {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: -0.25 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.25 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: -0.75 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.3 },
    ],
    input: 2,
    output: 1,
  };
}

function ifCollapseFixture(): CreatureExport {
  return JSON.parse(
    Deno.readTextFileSync("test/data/if-collapse-positive.json"),
  ) as CreatureExport;
}

// ── 1. Provenance: what arrives from outside is not trusted ─────────────────

Deno.test("Issue #3843: a creature loaded from JSON does not inherit the file's uuid", () => {
  // A file whose uuid does not describe its content — exactly what a pass that
  // forgot to shed identity writes to disk.
  const json = baseExport() as CreatureExport & CreatureInternal;
  json.uuid = "b026c94a-b626-57a2-9e88-53742edcb0aa";

  const loaded = Creature.fromJSON(json);

  assertEquals(
    loaded.uuid,
    undefined,
    "the incoming creature-level uuid must be discarded at the boundary",
  );
  assertNotEquals(
    CreatureUtil.makeUUID(loaded),
    json.uuid,
    "the identity must be recomputed from the loaded content, not adopted",
  );
});

Deno.test("Issue #3843: loading preserves per-neuron uuids", () => {
  // Neuron uuids are stable identity labels (breeding aligns parents by them)
  // and an *input* to the creature hash — they are never shed.
  const json = baseExport() as CreatureExport & CreatureInternal;
  json.uuid = "b026c94a-b626-57a2-9e88-53742edcb0aa";

  const loaded = Creature.fromJSON(json);

  const hiddenUuids = loaded.neurons
    .filter((n) => n.type === "hidden")
    .map((n) => n.uuid);
  assertEquals(
    hiddenUuids.sort(),
    ["hidden-0", "hidden-1"],
    "hidden neuron uuids must survive the load unchanged",
  );
});

Deno.test("Issue #3843: an in-process uuid is cached, never recomputed", () => {
  // The short-circuit is a requirement: recomputing a ~3 ms hash per creature
  // per generation is the expense the cache exists to avoid. Proven by editing
  // a hash input *behind* the cache — a caller that recomputed would notice;
  // a caller honouring the cache cannot.
  const creature = Creature.fromJSON(baseExport());
  const first = CreatureUtil.makeUUID(creature);

  for (let i = 0; i < 5; i++) {
    assertEquals(
      CreatureUtil.makeUUID(creature),
      first,
      "a cached identity must be returned as-is",
    );
  }

  creature.synapses[0].weight += 1;
  assertEquals(
    CreatureUtil.makeUUID(creature),
    first,
    "makeUUID must trust the cache — invalidation is the mutation site's job",
  );
});

Deno.test("Issue #3843: a tag-only change invalidates nothing", () => {
  const creature = Creature.fromJSON(baseExport());
  const before = CreatureUtil.makeUUID(creature);

  addTag(creature, "approach", "compact");
  addTag(creature.neurons[creature.input], "unused", "yes");
  creature.score = -0.25;

  assertEquals(
    creature.uuid,
    before,
    "tags and score are excluded from the hash — identity must not be shed",
  );
  assertEquals(
    CreatureUtil.makeUUID(creature),
    before,
    "a tag-only change must not move the uuid",
  );
});

// ── 2. Invalidation: every in-process structural entry point sheds identity ──

/**
 * Table-driven guard over the structural entry points that mutate a live
 * `Creature`. Each applies a real hash-input change and must leave the creature
 * without its previous identity.
 */
const structuralEntryPoints: {
  name: string;
  apply: (creature: Creature) => void;
}[] = [
  {
    name: "createConstantOne (splices a neuron in)",
    apply: (creature) => {
      createConstantOne(creature, 0);
    },
  },
  {
    name: "removeHiddenNeuron (removes a neuron)",
    apply: (creature) => {
      removeHiddenNeuron(creature, creature.input + 1);
    },
  },
  {
    name: "CompactUnused.removeNeuron (rewrites biases, then removes)",
    apply: (creature) => {
      removeUnusedNeuron(creature.neurons[creature.input].id, creature, 0.5);
    },
  },
];

for (const entry of structuralEntryPoints) {
  Deno.test(`Issue #3843: ${entry.name} sheds the creature's identity`, () => {
    const creature = Creature.fromJSON(baseExport());
    const before = CreatureUtil.makeUUID(creature);
    const neuronUuidsBefore = creature.neurons
      .filter((n) => n.type === "hidden")
      .map((n) => n.uuid);

    entry.apply(creature);

    assertEquals(
      creature.uuid,
      undefined,
      `${entry.name}: the stale identity must be shed at the mutation site`,
    );
    assertNotEquals(
      CreatureUtil.makeUUID(creature),
      before,
      `${entry.name}: the recomputed identity must differ`,
    );

    // The inverse guard: per-neuron uuids are provenance keys, not caches.
    for (const uuid of neuronUuidsBefore) {
      const survivor = creature.neurons.find((n) => n.uuid === uuid);
      if (survivor) {
        assertEquals(
          survivor.uuid,
          uuid,
          "a surviving neuron must keep its own uuid",
        );
      }
    }
  });
}

Deno.test("Issue #3843: repairInvalidIfNeuronsInCreature sheds identity when it repairs", () => {
  const creature = Creature.fromJSON(ifCollapseFixture(), false);
  CreatureUtil.makeUUID(creature);

  // Break the IF: strip the condition role so the repair has work to do.
  const ifNeuron = creature.neurons.find((n) => n.squash === "IF");
  assert(ifNeuron !== undefined, "fixture should carry an IF neuron");
  for (const synapse of creature.inwardConnections(ifNeuron.index)) {
    delete synapse.type;
  }

  const repaired = repairInvalidIfNeuronsInCreature(creature);
  assert(repaired, "the malformed IF should have been repaired");
  assertEquals(
    creature.uuid,
    undefined,
    "the repair rewrites squash and synapse roles — identity must be shed",
  );
});

Deno.test("Issue #3843: a backprop step sheds identity even when no neuron downgrades", async () => {
  // `applyLearnings` gated identity invalidation on `changed`, which reports
  // only an IF/MAXIMUM/MINIMUM structural downgrade from
  // `Neuron.applyLearnings` — not whether the gradient step moved anything. The
  // `propagateUpdate` above it rewrites every weight and bias, both hash
  // inputs, so an ordinary training pass left the uuid describing the
  // pre-training creature. `trainingMutationRate: 0` forces `changed === false`.
  await initWasmForTests();
  const creature = Creature.fromJSON(baseExport());
  const before = CreatureUtil.makeUUID(creature);

  const config = createBackPropagationConfig({ trainingMutationRate: 0 });
  const sparseConfig = new SparseConfig(
    exportJSONWithRuntimeIds(creature),
    config,
  );
  for (let i = 0; i < 10; i++) {
    const row = new Float32Array([(i % 5) / 5 - 0.5, (i % 3) / 3 - 0.5]);
    creature.activateAndTrace(row, false, sparseConfig);
    creature.propagate(
      new Float32Array([row[0] * 0.5 + 0.25]),
      config,
      sparseConfig,
    );
  }

  const changed = creature.applyLearnings(config, sparseConfig);
  assertEquals(changed, false, "no neuron should have downgraded");
  assertEquals(
    creature.uuid,
    undefined,
    "the gradient step rewrote weights and biases — identity must be shed",
  );
  assertNotEquals(
    CreatureUtil.makeUUID(creature),
    before,
    "the trained creature must not report its pre-training identity",
  );
});

// ── 3. The passes named in the issue ────────────────────────────────────────

/**
 * A pass that changed the creature must not hand back the input's identity.
 */
function assertIdentityNotInherited(
  pass: string,
  parentUuid: string,
  result: Creature | undefined,
) {
  if (result === undefined) return; // no change → nothing to assert
  assertNotEquals(
    result.uuid,
    parentUuid,
    `${pass}: changed the creature but kept the parent's uuid`,
  );
  assertNotEquals(
    CreatureUtil.makeUUID(result),
    parentUuid,
    `${pass}: changed the creature but still reports the parent's uuid`,
  );
}

Deno.test("Issue #3843: compactCreature does not pass on the parent's uuid", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(ifCollapseFixture(), false);
  const parentUuid = CreatureUtil.makeUUID(creature);

  const compacted = compactCreature(creature, false);
  assert(compacted !== undefined, "fixture should compact");
  assertIdentityNotInherited("compactCreature", parentUuid, compacted);

  // A pass that changed nothing must not disturb the input's own identity.
  assertEquals(
    creature.uuid,
    parentUuid,
    "compactCreature must not disturb the creature it was given",
  );
});

Deno.test("Issue #3843: simplify does not pass on the parent's uuid", () => {
  const creature = Creature.fromJSON(baseExport());
  const parentUuid = CreatureUtil.makeUUID(creature);

  const simplified = simplify(creature);
  assertIdentityNotInherited("simplify", parentUuid, simplified);

  assertEquals(
    creature.uuid,
    parentUuid,
    "simplify must not disturb the creature it was given",
  );
});

Deno.test("Issue #3843: restoreSource does not pass on the parent's uuid", () => {
  const creature = Creature.fromJSON(baseExport());
  const parentUuid = CreatureUtil.makeUUID(creature);

  const hidden = creature.neurons[creature.input];
  const output = creature.neurons[creature.neurons.length - 1];
  creature.memetic = {
    generation: 1,
    score: 0.25,
    biases: { [hidden.id]: hidden.bias + 2 },
    weights: {
      [hidden.id]: [{ toId: output.id, weight: 9.5 }],
    },
  } as unknown as typeof creature.memetic;

  const restored = restoreSource(creature);
  assert(restored !== undefined, "memetic source should restore");
  assertIdentityNotInherited("restoreSource", parentUuid, restored);
});

// ── 4. The Fitness consequence ──────────────────────────────────────────────

class MockWorkerHandler {
  public evaluateCallCount = 0;

  addIdleListener(_callback: () => void): void {}

  isBusy(): boolean {
    return false;
  }

  // deno-lint-ignore require-await
  async evaluate(
    creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    this.evaluateCallCount++;
    // A deterministic, structure-dependent error so a creature that is really
    // evaluated cannot accidentally match one that inherited a score.
    return {
      evaluate: {
        error: 0.1 + creature.synapses.length / 100 +
          creature.neurons.length / 1000,
      },
    };
  }
}

Deno.test("Issue #3843: Fitness does not hand a stale-uuid derivative its parent's score", async () => {
  const worker = new MockWorkerHandler();
  const fitness = new Fitness(
    [worker as unknown as WorkerHandler],
    0.0001,
    false,
  );

  const parent = Creature.fromJSON(baseExport());
  const parentUuid = CreatureUtil.makeUUID(parent);

  // The real-world path: a creature file written by a pass that changed the
  // structure but forgot to shed the identity, read back off disk into the same
  // population as the creature that uuid actually belongs to. Adopting the
  // file's uuid deduplicates the derivative onto the parent, and `Fitness`
  // copies across a score the derivative never earned.
  const fromDisk = baseExport() as CreatureExport & CreatureInternal;
  fromDisk.synapses.splice(1, 1);
  fromDisk.uuid = parentUuid;

  const derivative = Creature.fromJSON(fromDisk);

  assertNotEquals(
    derivative.synapses.length,
    parent.synapses.length,
    "the derivative must really differ from its parent",
  );
  assertNotEquals(
    CreatureUtil.makeUUID(derivative),
    parentUuid,
    "the derivative must not report the parent's identity",
  );

  await fitness.calculate([parent, derivative]);

  assert(Number.isFinite(parent.score), "the parent should have been scored");
  assert(
    Number.isFinite(derivative.score),
    "the derivative should have been scored",
  );
  assertNotEquals(
    derivative.score,
    parent.score,
    "the derivative must be scored on its own merits, not handed the " +
      "parent's score through uuid deduplication",
  );
  assertEquals(
    worker.evaluateCallCount,
    2,
    "both structurally distinct creatures must be evaluated",
  );
});

Deno.test("Issue #3843: Fitness still deduplicates genuinely identical creatures", async () => {
  // The inverse guard — shedding identity must not defeat the #1016
  // deduplication that makes evolution affordable.
  const worker = new MockWorkerHandler();
  const fitness = new Fitness(
    [worker as unknown as WorkerHandler],
    0.0001,
    false,
  );

  const population = [
    Creature.fromJSON(baseExport()),
    Creature.fromJSON(baseExport()),
    Creature.fromJSON(baseExport()),
  ];

  await fitness.calculate(population);

  assertEquals(
    worker.evaluateCallCount,
    1,
    "identical creatures must still be evaluated once",
  );
  assertEquals(population[0].score, population[1].score);
  assertEquals(population[1].score, population[2].score);
});
