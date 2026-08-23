/**
 * Issue #3843: a creature's `uuid` is content-derived, so it must never survive
 * a change to the creature's content.
 *
 * `CreatureUtil.makeUUID` used to short-circuit on any cached value, which made
 * the invariant depend on all ~26 mutation sites remembering to
 * `delete creature.uuid`. A single forgotten delete is not cosmetic: `Fitness`
 * skips creatures that already carry a `score` and deduplicates the evaluation
 * queue by uuid, copying the representative's score/error/tags onto every
 * "duplicate". A structurally-changed creature holding its parent's uuid is
 * therefore handed a score it never earned.
 *
 * These tests pin the invariant at three levels:
 *  1. `makeUUID` itself — every kind of content change must produce a new uuid,
 *     and a no-op must not.
 *  2. The passes named in the issue — compact, compact-unused, IF-collapse,
 *     simplify and restore-source.
 *  3. The real-world consequence in `Fitness.calculate`.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { compactCreature } from "@compact/CompactCreature.ts";
import {
  compactUnused,
  removeNeuron as removeUnusedNeuron,
} from "@compact/CompactUnused.ts";
import { collapseConstantIf } from "@compact/IfCollapse.ts";
import { createConstantOne } from "@compact/OrphanedNeuronCleanup.ts";
import { simplify } from "@optimize/Simplify.ts";
import { restoreSource } from "@blackbox/RestoreSource.ts";
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

// ── 1. makeUUID itself ──────────────────────────────────────────────────────

Deno.test("Issue #3843: makeUUID recomputes after a bias changes", () => {
  const creature = Creature.fromJSON(baseExport());
  const before = CreatureUtil.makeUUID(creature);

  creature.neurons[creature.input].bias += 1;

  assertNotEquals(
    CreatureUtil.makeUUID(creature),
    before,
    "a changed bias must produce a new uuid",
  );
});

Deno.test("Issue #3843: makeUUID recomputes after a weight changes", () => {
  const creature = Creature.fromJSON(baseExport());
  const before = CreatureUtil.makeUUID(creature);

  creature.synapses[0].weight += 1;

  assertNotEquals(
    CreatureUtil.makeUUID(creature),
    before,
    "a changed weight must produce a new uuid",
  );
});

Deno.test("Issue #3843: makeUUID recomputes after a synapse is removed", () => {
  const creature = Creature.fromJSON(baseExport());
  const before = CreatureUtil.makeUUID(creature);

  const doomed = creature.synapses[0];
  creature.disconnect(doomed.from, doomed.to);

  assertNotEquals(
    CreatureUtil.makeUUID(creature),
    before,
    "a removed synapse must produce a new uuid",
  );
});

Deno.test("Issue #3843: makeUUID recomputes after a neuron is added", () => {
  const creature = Creature.fromJSON(baseExport());
  const before = CreatureUtil.makeUUID(creature);

  // `createConstantOne` is the in-place neuron insertion the compaction passes
  // use; it never touches `uuid`.
  createConstantOne(creature, 0);

  assertNotEquals(
    CreatureUtil.makeUUID(creature),
    before,
    "an added neuron must produce a new uuid",
  );
});

Deno.test("Issue #3843: makeUUID recomputes after a squash changes", () => {
  const creature = Creature.fromJSON(baseExport());
  const before = CreatureUtil.makeUUID(creature);

  creature.neurons[creature.input].squash = "LOGISTIC";

  assertNotEquals(
    CreatureUtil.makeUUID(creature),
    before,
    "a changed squash must produce a new uuid",
  );
});

Deno.test("Issue #3843: makeUUID is stable when nothing changed", () => {
  const creature = Creature.fromJSON(baseExport());
  const first = CreatureUtil.makeUUID(creature);

  for (let i = 0; i < 5; i++) {
    assertEquals(
      CreatureUtil.makeUUID(creature),
      first,
      "an unchanged creature must keep its identity",
    );
  }

  // A change and its exact reversal must land back on the same identity.
  const originalBias = creature.neurons[creature.input].bias;
  creature.neurons[creature.input].bias = originalBias + 1;
  const moved = CreatureUtil.makeUUID(creature);
  assertNotEquals(moved, first);
  creature.neurons[creature.input].bias = originalBias;
  assertEquals(
    CreatureUtil.makeUUID(creature),
    first,
    "reverting the change must restore the original identity",
  );
});

Deno.test("Issue #3843: structurally different creatures never share a uuid", () => {
  // The hash already covers bias, weight, squash and synapse.type — verify
  // that rather than assume it. Each variant differs from the base in exactly
  // one content dimension.
  const seen = new Map<string, string>();

  const variants: { name: string; build: () => Creature }[] = [
    { name: "base", build: () => Creature.fromJSON(baseExport()) },
    {
      name: "bias",
      build: () => {
        const json = baseExport();
        json.neurons[0].bias += 1e-9;
        return Creature.fromJSON(json);
      },
    },
    {
      name: "weight",
      build: () => {
        const json = baseExport();
        json.synapses[0].weight += 1e-9;
        return Creature.fromJSON(json);
      },
    },
    {
      name: "squash",
      build: () => {
        const json = baseExport();
        json.neurons[0].squash = "LOGISTIC";
        return Creature.fromJSON(json);
      },
    },
    {
      name: "extra-synapse",
      build: () => {
        const json = baseExport();
        json.synapses.push({
          fromUUID: "input-0",
          toUUID: "hidden-1",
          weight: 0.11,
        });
        return Creature.fromJSON(json);
      },
    },
    {
      name: "fewer-synapses",
      build: () => {
        const json = baseExport();
        json.synapses.splice(1, 1);
        return Creature.fromJSON(json);
      },
    },
    {
      name: "renamed-neuron",
      build: () => {
        const json = baseExport();
        json.neurons[1].uuid = "hidden-1-renamed";
        json.synapses[2].toUUID = "hidden-1-renamed";
        json.synapses[4].fromUUID = "hidden-1-renamed";
        return Creature.fromJSON(json);
      },
    },
  ];

  for (const variant of variants) {
    const uuid = CreatureUtil.makeUUID(variant.build());
    const clash = seen.get(uuid);
    assertEquals(
      clash,
      undefined,
      `uuid collision: '${variant.name}' shares a uuid with '${clash}'`,
    );
    seen.set(uuid, variant.name);
  }

  // Identical content must still collapse to one identity.
  assertEquals(
    CreatureUtil.makeUUID(Creature.fromJSON(baseExport())),
    CreatureUtil.makeUUID(Creature.fromJSON(baseExport())),
    "identical creatures must share a uuid",
  );
});

// ── 2. The passes named in the issue ────────────────────────────────────────

/**
 * A pass that changed the creature must not hand back the input's identity.
 *
 * The contract is on `makeUUID`, not on the raw `uuid` field: the field is a
 * cache, and a pass that works on a `CreatureExport` (IF-collapse) can carry a
 * parent's uuid through the export without ever touching a live creature.
 * `makeUUID` is what `Fitness` asks, so that is what must be right.
 */
function assertIdentityNotInherited(
  pass: string,
  parentUuid: string,
  result: Creature | undefined,
) {
  if (result === undefined) return; // no change → nothing to assert
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

  // A no-op pass must leave the input's own identity intact.
  assertEquals(
    CreatureUtil.makeUUID(creature),
    parentUuid,
    "compactCreature must not disturb the creature it was given",
  );
});

Deno.test("Issue #3843: collapseConstantIf does not pass on the parent's uuid", () => {
  const exported = ifCollapseFixture() as CreatureExport & { uuid?: string };
  const parent = Creature.fromJSON(ifCollapseFixture(), false);
  const parentUuid = CreatureUtil.makeUUID(parent);
  exported.uuid = parentUuid;

  const result = collapseConstantIf(exported);
  assert(result.changed, "fixture should collapse an IF");

  const collapsed = Creature.fromJSON(exported, false);
  assertIdentityNotInherited("collapseConstantIf", parentUuid, collapsed);
});

Deno.test("Issue #3843: simplify does not pass on the parent's uuid", () => {
  const creature = Creature.fromJSON(baseExport());
  const parentUuid = CreatureUtil.makeUUID(creature);

  const simplified = simplify(creature);
  assertIdentityNotInherited("simplify", parentUuid, simplified);

  assertEquals(
    CreatureUtil.makeUUID(creature),
    parentUuid,
    "simplify must not disturb the creature it was given",
  );
});

Deno.test("Issue #3843: restoreSource does not pass on the parent's uuid", () => {
  const json = baseExport() as CreatureExport & {
    memetic?: {
      generation: number;
      score: number;
      biases: Record<string, number>;
      weights: Record<string, { toId: number; weight: number }[]>;
    };
  };
  const creature = Creature.fromJSON(json);
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

Deno.test("Issue #3843: compactUnused does not pass on the parent's uuid", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(ifCollapseFixture(), false);
  const parentUuid = CreatureUtil.makeUUID(creature);

  const config = createBackPropagationConfig();
  const sparseConfig = new SparseConfig(
    exportJSONWithRuntimeIds(creature),
    config,
  );
  for (let i = 0; i < 25; i++) {
    const row = new Float32Array(creature.input);
    for (let j = 0; j < creature.input; j++) {
      row[j] = (i % 7) / 7 - 0.5;
    }
    creature.activateAndTrace(row, false, sparseConfig);
  }

  const traced = creature.traceJSON() as unknown as { uuid?: string };
  traced.uuid = parentUuid;

  const compacted = compactUnused(
    traced as unknown as Parameters<typeof compactUnused>[0],
    1e-8,
  );
  assertIdentityNotInherited("compactUnused", parentUuid, compacted);
});

Deno.test("Issue #3843: CompactUnused.removeNeuron invalidates the live creature's uuid", () => {
  const creature = Creature.fromJSON(baseExport());
  const parentUuid = CreatureUtil.makeUUID(creature);

  const hidden = creature.neurons[creature.input];
  const removed = removeUnusedNeuron(hidden.id, creature, 0.5);
  assert(removed, "the neuron should have been removed");

  assertNotEquals(
    CreatureUtil.makeUUID(creature),
    parentUuid,
    "removeNeuron mutates the creature in place — its identity must change",
  );
});

// ── 3. The Fitness consequence ──────────────────────────────────────────────

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

  // The derivative is what a compaction / simplification pass produces: a
  // structurally different creature that forgot to shed its parent's identity.
  const derivative = Creature.fromJSON(baseExport());
  derivative.uuid = parentUuid;
  const doomed = derivative.synapses[0];
  derivative.disconnect(doomed.from, doomed.to);

  assertNotEquals(
    derivative.synapses.length,
    parent.synapses.length,
    "the derivative must really differ from its parent",
  );

  await fitness.calculate([parent, derivative]);

  assert(
    Number.isFinite(parent.score),
    "the parent should have been scored",
  );
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
