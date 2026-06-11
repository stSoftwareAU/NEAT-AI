import { assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { appendAll } from "@utils/ArrayAppend.ts";

// Issue #2900: FindTunePopulation.make() appends fine-tuned batches into
// `fineTunedPopulation` (FineTunePopulation.ts:153/162/218/255). The batch size
// scales with `fineTunePopSize`, which is derived from the configured
// population size (>= ceil(populationSize / 5)), so spreading the batch into
// `push(...batch)` could throw `RangeError: Maximum call stack size exceeded`
// at large population sizes.
//
// Driving make() at that scale is impractical for a unit test — it would need
// hundreds of thousands of scored, species-assigned creatures and the heavy
// per-creature fine-tuning compute, far exceeding the 120s unit-test budget.
// These tests instead exercise the exact operation the fixed lines now perform:
// appending a large Creature[] batch into a population array via the stack-safe
// helper, with a canary proving the old spread crashes at the same size.

function makeMinimalCreature(): Creature {
  // Smallest valid creature: two inputs wired to one output.
  return Creature.fromJSON({
    neurons: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 1 },
      { bias: 0, type: "output", squash: "BIPOLAR_SIGMOID", index: 2 },
    ],
    synapses: [{ weight: 0.5, from: 1, to: 2 }],
    input: 2,
    output: 1,
  });
}

Deno.test("FineTunePopulation append - large fine-tuned batch appends without RangeError (regression #2900)", () => {
  const SIZE = 200_000;
  const batch: Creature[] = new Array(SIZE);
  const shared = makeMinimalCreature();
  for (let i = 0; i < SIZE; i++) batch[i] = shared;

  // Canary: this is the spread that FineTunePopulation.ts used to run.
  const canary: Creature[] = [];
  assertThrows(() => canary.push(...batch), RangeError);

  // Fix: the population already holds a seed creature; appending the batch
  // preserves the seed at the front and the batch order behind it.
  const fineTunedPopulation: Creature[] = [shared];
  appendAll(fineTunedPopulation, batch);

  assertEquals(fineTunedPopulation.length, SIZE + 1);
  assertEquals(fineTunedPopulation[0], shared);
  assertEquals(fineTunedPopulation[SIZE], shared);
});

Deno.test("FineTunePopulation append - order and contents preserved for a small batch", () => {
  const a = makeMinimalCreature();
  const b = makeMinimalCreature();
  const c = makeMinimalCreature();

  const fineTunedPopulation: Creature[] = [a];
  appendAll(fineTunedPopulation, [b, c]);

  assertEquals(fineTunedPopulation, [a, b, c]);
});
