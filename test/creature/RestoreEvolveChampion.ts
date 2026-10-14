import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  restoreEvolveChampion,
  snapshotEvolveCaller,
} from "@creature/EvolveTeardown.ts";

/**
 * A tiny 2-input, 1-output creature. `weight` and `bias` make each genome
 * distinguishable when comparing exports.
 */
function tinyCreature(weight: number, bias: number): Creature {
  return Creature.fromJSON({
    neurons: [{
      bias: 0,
      type: "input",
      squash: "LOGISTIC",
      index: 0,
    }, {
      bias: 0,
      type: "input",
      squash: "LOGISTIC",
      index: 1,
    }, {
      bias,
      type: "output",
      squash: "BIPOLAR_SIGMOID",
      index: 2,
    }],
    synapses: [{
      weight,
      from: 0,
      to: 2,
    }, { weight: weight / 2, from: 1, to: 2 }],
    input: 2,
    output: 1,
  });
}

/** The topology and weights of a creature, without uuid, score or tags. */
function genome(creature: Creature): string {
  const exported = creature.exportJSON();
  return JSON.stringify({
    neurons: exported.neurons,
    synapses: exported.synapses,
  });
}

/**
 * A caller whose original genome has been snapshotted, then overwritten by
 * the run, so restoring from the snapshot is observably different from doing
 * nothing.
 */
function setupRun(): {
  caller: Creature;
  snapshot: Creature;
  originalGenome: string;
} {
  const caller = tinyCreature(0.5, -0.25);
  const originalGenome = genome(caller);
  const snapshot = snapshotEvolveCaller(caller);
  caller.loadFrom(tinyCreature(0.9, 0.75), false, "test:run");
  return { caller, snapshot, originalGenome };
}

Deno.test("restoreEvolveChampion restores a usable champion into the caller", () => {
  const { caller, snapshot } = setupRun();
  const champion = tinyCreature(0.125, 0.5);
  const championGenome = genome(champion);

  restoreEvolveChampion(caller, champion, snapshot, false, "test:champion");

  assertEquals(genome(caller), championGenome);
  caller.validate();
  assert(
    typeof CreatureUtil.makeUUID(caller) === "string",
    "caller should have a computable uuid after restore",
  );
});

Deno.test("restoreEvolveChampion falls back to the snapshot when the champion is unusable", () => {
  const { caller, snapshot, originalGenome } = setupRun();
  const champion = tinyCreature(0.125, 0.5);
  champion.dispose();
  assertEquals(champion.neurons.length, 0);

  restoreEvolveChampion(caller, champion, snapshot, false, "test:unusable");

  assertEquals(genome(caller), originalGenome);
  assert(
    caller.neurons.length >= caller.input + caller.output,
    "caller should have at least input + output neurons after fallback",
  );
  assert(
    typeof CreatureUtil.makeUUID(caller) === "string",
    "caller uuid should compute after snapshot fallback",
  );
});

Deno.test("restoreEvolveChampion falls back to the snapshot when there is no champion", () => {
  const { caller, snapshot, originalGenome } = setupRun();

  restoreEvolveChampion(caller, undefined, snapshot, false, "test:no-champion");

  assertEquals(genome(caller), originalGenome);
  assert(
    caller.neurons.length >= caller.input + caller.output,
    "caller should have at least input + output neurons after fallback",
  );
  assert(
    typeof CreatureUtil.makeUUID(caller) === "string",
    "caller uuid should compute after snapshot fallback",
  );
});

Deno.test("restoreEvolveChampion throws and leaves the caller untouched when neither the champion nor the snapshot is usable", () => {
  const { caller, snapshot } = setupRun();
  const champion = tinyCreature(0.125, 0.5);
  champion.dispose();
  snapshot.dispose();

  const callerGenomeBefore = genome(caller);
  const neuronsBefore = caller.neurons.length;

  assertThrows(
    () =>
      restoreEvolveChampion(
        caller,
        champion,
        snapshot,
        false,
        "test:neither",
      ),
    Error,
    "neither the champion nor the caller's original genome is usable",
  );

  assertEquals(caller.neurons.length, neuronsBefore);
  assertEquals(genome(caller), callerGenomeBefore);
});

Deno.test("snapshotEvolveCaller is independent of the caller", () => {
  const caller = tinyCreature(0.5, -0.25);
  const originalGenome = genome(caller);
  const snapshot = snapshotEvolveCaller(caller);
  const snapshotNeurons = snapshot.neurons.length;

  caller.dispose();

  assertEquals(caller.neurons.length, 0);
  assertEquals(snapshot.neurons.length, snapshotNeurons);
  assert(snapshotNeurons >= snapshot.input + snapshot.output);
  assertEquals(genome(snapshot), originalGenome);
});
