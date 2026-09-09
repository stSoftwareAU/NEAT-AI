/**
 * @module
 *
 * Issue #3976 — what `SubConnection` does now that the removal itself belongs
 * to NEAT-AI-core's `prune_synapse`.
 *
 * The pre-existing `test/mutate/SubConnection.ts` and
 * `test/mutate/SubConnectionStaleFromIndex.ts` cases are the acceptance gate for
 * the migration and pass unaltered. These are the extra ones: the outcomes core
 * produces that the superseded TypeScript could not, each of which is a
 * deliberate improvement rather than incidental drift. One pre-existing case
 * elsewhere did change — `test/propagate/IfElse.ts::if-fix` asserted the old
 * refusal directly, and now asserts the invariant that survives it.
 *
 * The `IF` cases are the headline. `SubConnection#wouldBreakIfNeuron` used to
 * decline any removal that would leave an `IF` short a role, so typed `IF`
 * structure was simply unreachable to the mutation operators. Core rewrites
 * instead, and both rewrites are exact — they compute the same number on every
 * record:
 *
 * - the condition goes, or every condition source is structurally fixed → the
 *   `IF` flattens to the branch that condition always took, as an `IDENTITY`
 *   sum, and the unreachable branch cascades away with it;
 * - a `positive` / `negative` branch is emptied while the condition still
 *   varies → a **zero-weight** edge from a support constant is put back into
 *   that role, because an empty branch sum is `0` and so is `0 · 1`.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { SynapseRole } from "@architecture/SynapseKey.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { SubConnection } from "@mutate/SubConnection.ts";
import {
  getRandomNumberGenerator,
  type RandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { danglingMemeticReferences } from "../_memeticReferences.ts";
import { hiddenChainExport, ifRolesExport } from "../_pruneFixtures.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * An RNG that always answers the same number.
 *
 * `SubConnection` picks uniformly from the forward synapses in focus, so
 * pinning the draw to the position of the edge under test is what makes a
 * structural assertion about *that* edge deterministic — rather than a search
 * over seeds that quietly stops asserting when the shape changes.
 */
function fixedDraw(value: number): RandomNumberGenerator {
  return {
    random: () => value,
    randomInt: (min: number) => min,
    choice: <T>(array: readonly T[]) => array[0],
    seeded: false,
    seed: null,
  };
}

/** Run one mutation with the candidate at `from → to : role` chosen. */
function removeEdge(
  creature: Creature,
  from: number,
  to: number,
  role?: SynapseRole,
): boolean {
  const forward = creature.synapses.filter((synapse) =>
    synapse.to > synapse.from
  );
  const position = forward.findIndex((synapse) =>
    synapse.from === from && synapse.to === to && synapse.type === role
  );
  assert(position >= 0, `the fixture must carry ${from} -> ${to} (${role})`);

  const previous = getRandomNumberGenerator();
  // Math.floor(value · forward.length) === position.
  setRandomNumberGenerator(fixedDraw((position + 0.5) / forward.length));
  try {
    return new SubConnection(creature).mutate();
  } finally {
    setRandomNumberGenerator(previous);
  }
}

/** The indices of the named neurons, after whatever reordering a load did. */
function indexOf(creature: Creature, uuid: string): number {
  const found = creature.neurons.findIndex((neuron) => neuron.uuid === uuid);
  assert(found >= 0, `the fixture must carry ${uuid}`);
  return found;
}

/** The shared fixtures, as live creatures. */
function chainFixture(): Creature {
  return Creature.fromJSON(hiddenChainExport());
}

function ifFixture(): Creature {
  return Creature.fromJSON(ifRolesExport());
}

Deno.test("SubConnection: a target left with no inward edge becomes constant support", () => {
  const creature = chainFixture();
  assert(
    removeEdge(creature, 0, indexOf(creature, "h-1")),
    "removing the last inward edge must be a change, not a refusal",
  );

  const survivor = creature.neurons.find((neuron) => neuron.uuid === "h-1");
  assert(survivor, "the stranded hidden must survive as support");
  assertEquals(survivor.type, "constant");
  creatureValidate(creature);
});

Deno.test("SubConnection: a source left with no outward edge cascades away with its feeders", () => {
  const creature = chainFixture();
  assert(
    removeEdge(
      creature,
      indexOf(creature, "h-1"),
      indexOf(creature, "output-0"),
    ),
    "removing the last outward edge must be a change, not a refusal",
  );

  assertEquals(
    creature.neurons.some((neuron) => neuron.uuid === "h-1"),
    false,
    "the orphaned source must be gone",
  );
  assertEquals(
    creature.synapses.length,
    1,
    "the edge that fed it must have gone with it",
  );
  creatureValidate(creature);
});

Deno.test("SubConnection: removing the last IF condition flattens the IF instead of refusing", () => {
  // The superseded `#wouldBreakIfNeuron` returned `false` here, so this whole
  // class of typed structure was unreachable to mutation.
  const creature = ifFixture();
  assert(
    removeEdge(creature, 0, indexOf(creature, "if-1"), "condition"),
    "core must rewrite the IF rather than decline the removal",
  );

  const rewritten = creature.neurons.find((neuron) => neuron.uuid === "if-1");
  assert(rewritten, "the IF neuron itself survives as the branch it took");
  assertEquals(rewritten.squash, IDENTITY.NAME);
  assertEquals(
    creature.synapses.some((synapse) => synapse.type === "condition"),
    false,
    "no condition edge may survive a flattened IF",
  );
  creatureValidate(creature);
});

Deno.test("SubConnection: emptying one IF branch restores it with a zero-weight support edge", () => {
  const creature = ifFixture();
  assert(
    removeEdge(creature, 1, indexOf(creature, "if-1"), "positive"),
    "core must rewrite the IF rather than decline the removal",
  );

  const ifIndex = indexOf(creature, "if-1");
  assertEquals(
    creature.neurons[ifIndex].squash,
    "IF",
    "an IF whose condition still varies stays an IF",
  );
  const positive = creature.inwardConnections(ifIndex).filter((synapse) =>
    synapse.type === "positive"
  );
  assertEquals(
    positive.length,
    1,
    "the emptied branch must be given a row back",
  );
  assertEquals(
    positive[0].weight,
    0,
    "an empty branch sums to zero, and so does this",
  );
  creatureValidate(creature);
});

Deno.test("SubConnection: a shared branch pair loses only the role that was chosen", () => {
  // Issue #3873: one source may feed two branches of one IF, so the identity
  // of the edge is the `(from, to, type)` triple and not the ordered pair.
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { uuid: "if-1", type: "hidden", squash: "IF", bias: 0 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "if-1", weight: 0.5, type: "condition" },
      { fromUUID: "input-1", toUUID: "if-1", weight: 0.6, type: "positive" },
      { fromUUID: "input-1", toUUID: "if-1", weight: 0.7, type: "negative" },
      { fromUUID: "if-1", toUUID: "output-0", weight: 1 },
    ],
  } as CreatureExport);

  assert(
    removeEdge(creature, 1, indexOf(creature, "if-1"), "negative"),
    "the negative role of the shared pair must be removable",
  );

  const inward = creature.inwardConnections(indexOf(creature, "if-1"));
  const positive = inward.find((synapse) =>
    synapse.type === "positive" && synapse.from === 1
  );
  assert(positive, "the other role of the same pair must survive untouched");
  assertEquals(positive.weight, 0.6);
  creatureValidate(creature);
});

Deno.test("SubConnection: an edge incident on an observation neuron is an ordinary candidate", () => {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.5 },
    ],
  } as CreatureExport);

  assert(
    removeEdge(creature, 0, indexOf(creature, "output-0")),
    "nothing about the declared widths is touched by removing one term",
  );
  assertEquals(creature.input, 2, "the observation width is unchanged");
  assertEquals(creature.synapses.length, 1);
  creatureValidate(creature);
});

Deno.test("SubConnection: memetic is pruned entry by entry, not dropped wholesale", () => {
  // The superseded operator ended with `delete creature.memetic`, throwing away
  // every fine-tuning record a removal did not invalidate. Core prunes only the
  // entries that stop naming live structure.
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { uuid: "h-1", type: "hidden", squash: IDENTITY.NAME, bias: 0.5 },
      { uuid: "h-2", type: "hidden", squash: IDENTITY.NAME, bias: 0.4 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h-1", weight: 1 },
      { fromUUID: "input-1", toUUID: "h-2", weight: 0.7 },
      { fromUUID: "h-1", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "h-2", toUUID: "output-0", weight: 0.9 },
    ],
    memetic: {
      generation: 3,
      score: -0.5,
      biases: { "h-1": 0.5, "h-2": 0.4 },
      weights: [
        { fromUUID: "h-1", toUUID: "output-0", weight: 0.8 },
        { fromUUID: "h-2", toUUID: "output-0", weight: 0.9 },
      ],
    },
  } as unknown as CreatureExport);

  assert(
    removeEdge(
      creature,
      indexOf(creature, "h-1"),
      indexOf(creature, "output-0"),
    ),
    "the removal must succeed",
  );

  assert(creature.memetic, "the whole memetic record must not be thrown away");
  assertEquals(
    danglingMemeticReferences(creature.exportJSON()),
    [],
    "no memetic entry may still name structure the removal took",
  );
  const exported = creature.exportJSON();
  assert(
    exported.memetic?.biases &&
      Object.keys(exported.memetic.biases).includes("h-2"),
    "the survivor's own fine-tuning record must be kept",
  );
  creatureValidate(creature);
});
