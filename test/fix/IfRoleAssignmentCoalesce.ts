/**
 * Issue #3880: `IF.fix` hands a role to an inward synapse by writing
 * `synapse.type` in place. Two things follow from that write, and both reached
 * the GRQ fleet as creatures its own `creatureValidate` rejects:
 *
 * - the source may already carry the role it was handed, leaving two rows of
 *   one `(from, to, type)` triple — `duplicate synapse input-1216 -> …-if0`;
 * - the rewritten row moves within its `(from, to)` run, leaving the run in
 *   descending role order — `synapses not sorted … type: condition last type:
 *   negative`.
 *
 * The producer settles both before it returns: it prefers a role the source
 * still has free, sums the row into the existing one when none is, and
 * restores the canonical `(from, to, type)` order.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { IF } from "@methods/activations/aggregate/IF.ts";
import {
  coalesceInwardDuplicates,
  normaliseInwardRoles,
} from "@architecture/CoalesceInwardSynapses.ts";
import { Synapse } from "@architecture/Synapse.ts";
import {
  getRandomNumberGenerator,
  type RandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

/** The two weights verbatim from the `upgrade-4x` creature in Issue #3880. */
const WEIGHT_A = -4.7776948980020784e-05;
const WEIGHT_B = 2.2347282587429075e-05;

/**
 * An `IF` gate fed a spare untyped row by a source that already feeds it in
 * `roles`. `IF.fix` must type that spare row without repeating a triple.
 */
function gateWithSpareUntypedRow(
  roles: ReadonlyArray<"condition" | "negative" | "positive">,
): CreatureExport {
  const shared = roles.map((type, i) => ({
    fromUUID: "input-0",
    toUUID: "gate",
    weight: 0.25 + i / 100,
    type,
  }));
  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "gate", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "gate", weight: WEIGHT_A },
      ...shared,
      { fromUUID: "input-1", toUUID: "gate", weight: 1, type: "condition" },
      { fromUUID: "input-2", toUUID: "gate", weight: 1, type: "negative" },
      { fromUUID: "input-2", toUUID: "gate", weight: 1, type: "positive" },
      { fromUUID: "gate", toUUID: "output-0", weight: 1 },
    ],
  };
}

/** An RNG whose `random()` always answers `value`, for a deterministic branch. */
function fixedRng(value: number): RandomNumberGenerator {
  return {
    random: () => value,
    randomInt: (min: number) => min,
    choice: <T>(array: readonly T[]) => array[0],
    seeded: true,
    seed: 1,
  };
}

/**
 * Run `fn` once per RNG value, with an RNG pinned to that value — so every
 * branch of the role choice is exercised deterministically.
 */
function forEachRngValue(
  values: readonly number[],
  fn: (rngValue: number) => void,
): Promise<void> {
  return withRngTestLock(() => {
    const held = getRandomNumberGenerator();
    try {
      for (const value of values) {
        setRandomNumberGenerator(fixedRng(value));
        fn(value);
      }
    } finally {
      setRandomNumberGenerator(held);
    }
  });
}

function gateNeuron(creature: Creature) {
  const gate = creature.neurons.find((neuron) => neuron.uuid === "gate");
  assert(gate, "expected the IF gate neuron");
  return gate;
}

/** Every inward row of `to` from `from`, in `creature.synapses` order. */
function rowsFrom(creature: Creature, from: number, to: number): Synapse[] {
  return creature.synapses.filter((s) => s.from === from && s.to === to);
}

Deno.test("Issue #3880: IF.fix never hands a source a role it already carries", async () => {
  // Every role of `input-0 -> gate` is taken, so the spare untyped row cannot
  // be given a distinct role — it is summed into the row it would duplicate.
  await forEachRngValue([0, 0.5, 0.99], (rngValue) => {
    const creature = Creature.fromJSON(
      gateWithSpareUntypedRow(["condition", "negative", "positive"]),
    );
    creatureValidate(creature); // The starting shape is legal under Issue #3873.

    new IF().fix(gateNeuron(creature));

    creatureValidate(creature);

    const gate = gateNeuron(creature);
    const shared = rowsFrom(creature, 0, gate.index);
    assertEquals(
      shared.map((s) => s.type),
      ["condition", "negative", "positive"],
      `rng ${rngValue}: one row per role, in ascending role order`,
    );

    // An untyped row into an `IF` is read as the positive branch, so summing it
    // into the positive row leaves the creature computing the same function.
    const positive = shared[2];
    assertAlmostEquals(positive.weight, 0.27 + WEIGHT_A, 1e-12);
  });
});

Deno.test("Issue #3880: IF.fix leaves each (from, to) run in ascending role order", async () => {
  // `input-0` holds only `condition`, so the spare row takes a free role — the
  // rewrite moves it within the run, which must be re-sorted before returning.
  await forEachRngValue([0, 0.5, 0.99], (rngValue) => {
    const creature = Creature.fromJSON(gateWithSpareUntypedRow(["condition"]));

    new IF().fix(gateNeuron(creature));

    creatureValidate(creature);

    const gate = gateNeuron(creature);
    const roles = rowsFrom(creature, 0, gate.index).map((s) => s.type);
    assertEquals(roles.length, 2, `rng ${rngValue}: both rows survive`);
    assertEquals(
      roles[0],
      "condition",
      `rng ${rngValue}: the run stays in ascending role order`,
    );
    assert(
      roles[1] === "negative" || roles[1] === "positive",
      `rng ${rngValue}: the spare row took a role the source had free, got ${
        String(roles[1])
      }`,
    );
  });
});

Deno.test("Issue #3880: coalesceInwardDuplicates sums two rows of one role on an IF target", () => {
  // The shape straight out of the field dump: one source, one IF target, two
  // rows of the same role with small opposite-sign weights.
  const creature = Creature.fromJSON(gateWithSpareUntypedRow(["positive"]));
  const gate = gateNeuron(creature);
  creature.synapses.push(new Synapse(0, gate.index, WEIGHT_B, "positive"));
  creature.synapses.sort((a, b) => a.from - b.from || a.to - b.to);
  creature.clearCache();

  const merged = coalesceInwardDuplicates(creature, gate.index);

  assertEquals(merged, 1, "the repeated triple is one row, not two");
  const positives = rowsFrom(creature, 0, gate.index).filter((s) =>
    s.type === "positive"
  );
  assertEquals(positives.length, 1);
  assertAlmostEquals(positives[0].weight, 0.25 + WEIGHT_B, 1e-12);

  // The untyped row is a different triple into an IF, so it is left alone.
  assertEquals(rowsFrom(creature, 0, gate.index).length, 2);
});

Deno.test("Issue #3880: coalesceInwardDuplicates sums every role on a non-IF target", () => {
  // Every squash but IF sums its inward synapses regardless of role, so the
  // rows one source feeds it are exactly one row with the summed weight —
  // `input-0` (untyped + positive) and `input-2` (negative + positive) alike.
  const creature = Creature.fromJSON(gateWithSpareUntypedRow(["positive"]));
  const gate = gateNeuron(creature);
  gate.setSquash("IDENTITY");

  const merged = coalesceInwardDuplicates(creature, gate.index);

  assertEquals(merged, 2);
  const shared = rowsFrom(creature, 0, gate.index);
  assertEquals(shared.length, 1);
  assertAlmostEquals(shared[0].weight, WEIGHT_A + 0.25, 1e-12);
  assertEquals(rowsFrom(creature, 2, gate.index).length, 1);
});

Deno.test("Issue #3880: normaliseInwardRoles restores canonical order with nothing to merge", () => {
  const creature = Creature.fromJSON(
    gateWithSpareUntypedRow(["condition", "negative"]),
  );
  const gate = gateNeuron(creature);

  // Re-enact the in-place role write: the untyped row becomes `positive`, which
  // sorts after `condition`/`negative` but still sits ahead of them.
  const spare = rowsFrom(creature, 0, gate.index)[0];
  assertEquals(spare.type, undefined);
  spare.type = "positive";

  assertEquals(normaliseInwardRoles(creature, gate.index), 0);

  assertEquals(
    rowsFrom(creature, 0, gate.index).map((s) => s.type),
    ["condition", "negative", "positive"],
  );
  creatureValidate(creature);
});
