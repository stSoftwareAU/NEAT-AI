/**
 * Issue #3970: `compactUnused` must not delete a freshly inserted neuron
 * before the gradient step that gives its structure a job.
 *
 * A neuron inserted under a reduced `structuralWeightScale` has a near-zero
 * outward weight, so its effect score (`activation range × outward weight`)
 * makes it the *first* removal candidate. The `newborn-grace` tag written by
 * `AddNeuron` exempts it for the configured number of compaction passes; each
 * pass that actually compacts spends one round of that budget.
 *
 * The traces below are written by hand rather than sampled from a training
 * run so the effect ordering — quiet neuron weakest, loud neuron next — is
 * exact and the test cannot flake on sampling.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature, type CreatureTrace } from "../../mod.ts";
import type { NeuronStateInterface } from "@architecture/CreatureState.ts";
import type { TagInterface } from "@stsoftware/tags/mod";
import { compactUnused } from "@compact/CompactUnused.ts";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import {
  NEWBORN_GRACE_TAG,
  newbornGraceRemaining,
} from "@architecture/NewbornGrace.ts";

const PLANK = 1e-7;

/** A traced neuron that swings across the full [0, 1] activation range. */
function activeTrace(): NeuronStateInterface {
  return {
    count: 10,
    totalBias: 0,
    totalAdjustedBias: 0,
    hintValue: 0,
    maximumActivation: 1,
    minimumActivation: 0,
    totalActivation: 5,
  };
}

/**
 * Two hidden neurons feeding one output. `hidden-quiet` has a near-identity
 * outward weight, so it is the neuron `compactUnused` removes first; the
 * `input-0 → output-0` synapse keeps the output fed either way.
 */
function tracedCreature(quietTags?: TagInterface[]): CreatureTrace {
  return {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-quiet",
        squash: "IDENTITY",
        bias: 0,
        tags: quietTags,
        trace: activeTrace(),
      },
      {
        type: "hidden",
        uuid: "hidden-loud",
        squash: "IDENTITY",
        bias: 0,
        trace: activeTrace(),
      },
      {
        type: "output",
        uuid: "output-0",
        squash: "IDENTITY",
        bias: 0,
        trace: activeTrace(),
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-quiet", weight: 1 },
      { fromUUID: "input-1", toUUID: "hidden-loud", weight: 1 },
      { fromUUID: "hidden-quiet", toUUID: "output-0", weight: 1e-6 },
      { fromUUID: "hidden-loud", toUUID: "output-0", weight: 0.9 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
    ],
    input: 2,
    output: 1,
  } as unknown as CreatureTrace;
}

function uuids(creature: Creature): string[] {
  return creature.exportJSON().neurons.map((n) => n.uuid!);
}

Deno.test("compactUnused - removes the quiet neuron when it has no grace", () => {
  const compacted = compactUnused(tracedCreature(), PLANK);
  assert(compacted !== undefined, "The pass should have compacted something");
  assert(
    !uuids(compacted).includes("hidden-quiet"),
    "Without grace the near-identity neuron is the first removed",
  );
});

Deno.test("compactUnused - a newborn survives one compaction pass, then becomes removable", () => {
  const first = compactUnused(
    tracedCreature([{ name: NEWBORN_GRACE_TAG, value: "1" }]),
    PLANK,
  );
  assert(first !== undefined, "The pass should have compacted something");
  assert(
    uuids(first).includes("hidden-quiet"),
    "The newborn must survive its grace round",
  );
  assert(
    !uuids(first).includes("hidden-loud"),
    "The next-weakest neuron should have been removed instead",
  );

  const survivor = first.neurons.find((n) => n.uuid === "hidden-quiet");
  assert(survivor !== undefined, "The newborn should be findable");
  assertEquals(
    newbornGraceRemaining(survivor),
    0,
    "A compacting pass must spend one round of the grace budget",
  );

  // Grace spent: the same neuron is now an ordinary removal candidate.
  const second = compactUnused(
    tracedCreature([{ name: NEWBORN_GRACE_TAG, value: "0" }]),
    PLANK,
  );
  assert(second !== undefined, "The second pass should compact too");
  assert(
    !uuids(second).includes("hidden-quiet"),
    "Once its grace is spent the newborn is removable again",
  );
});

Deno.test("compactUnused - a two-round grace outlasts the first pass", () => {
  const first = compactUnused(
    tracedCreature([{ name: NEWBORN_GRACE_TAG, value: "2" }]),
    PLANK,
  );
  assert(first !== undefined, "The pass should have compacted something");
  const survivor = first.neurons.find((n) => n.uuid === "hidden-quiet");
  assert(survivor !== undefined, "The newborn must survive its grace round");
  assertEquals(
    newbornGraceRemaining(survivor),
    1,
    "One round of a two-round budget should remain",
  );
});

Deno.test("AddNeuron - tags the neuron it inserts with the configured grace", () => {
  const creature = Creature.fromJSON(
    Creature.fromJSON(tracedCreature()).exportJSON(),
  );
  const before = new Set(creature.neurons.map((n) => n.uuid));

  const operator = new AddNeuron(creature, {
    structuralWeightScale: 1e-4,
    structuralNewbornGraceRounds: 2,
  });
  assert(operator.mutate(), "AddNeuron should have changed the creature");

  const added = creature.neurons.find((n) =>
    n.type === "hidden" && !before.has(n.uuid)
  );
  assert(added !== undefined, "The inserted neuron should be findable");
  assertEquals(
    newbornGraceRemaining(added),
    2,
    "The newborn should carry the configured grace budget",
  );

  // The default is zero grace — no tag, hence behaviour identical to before.
  const plain = Creature.fromJSON(
    Creature.fromJSON(tracedCreature()).exportJSON(),
  );
  const plainBefore = new Set(plain.neurons.map((n) => n.uuid));
  assert(new AddNeuron(plain).mutate(), "AddNeuron should have changed it");
  const plainAdded = plain.neurons.find((n) =>
    n.type === "hidden" && !plainBefore.has(n.uuid)
  );
  assert(plainAdded !== undefined, "The inserted neuron should be findable");
  assertEquals(
    newbornGraceRemaining(plainAdded),
    0,
    "The default must leave the newborn an ordinary compaction candidate",
  );
});

Deno.test("compactUnused - a pass that compacts nothing spends no grace", () => {
  // Issue #3970 regression: `compactUnused` returns `undefined` when every
  // candidate is protected, and the training teardown then falls back to
  // `compactVariants`. That fallback creature is a third lineage leaving the
  // teardown and it inherits the *un-decremented* tag, so the callers must age
  // it themselves. Pin the contract that makes that necessary: a pass that
  // compacts nothing must not have quietly spent a round anywhere.
  const grace: TagInterface[] = [{ name: NEWBORN_GRACE_TAG, value: "2" }];
  const trace = tracedCreature(grace);
  // Protect the other hidden neuron too, so no candidate is left at all.
  trace.neurons[1].tags = [{ name: NEWBORN_GRACE_TAG, value: "2" }];

  const nothing = compactUnused(trace, PLANK);
  assertEquals(nothing, undefined, "Every candidate was protected");

  assertEquals(
    trace.neurons.map((n) => newbornGraceRemaining(n)),
    [2, 2, 0],
    "A non-compacting pass must leave every grace budget untouched",
  );
});
