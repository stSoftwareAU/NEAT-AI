import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import {
  BehaviourCheckpoints,
  buildProbeInputs,
  isExactBehaviourPreserved,
  isWithinBehaviourAllowance,
  measureBehaviourDeviation,
} from "@architecture/BehaviourGuard.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Issue #3840: the compaction / simplification / low-impact-removal passes
 * documented a behaviour (and therefore score) guarantee that nothing checked.
 * These tests cover the shared probe-based verifier those passes now use.
 */

function chain(biasB: number, weightAB: number): CreatureExport {
  return {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "b", squash: "IDENTITY", bias: biasB },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "a", weight: 1 },
      { fromUUID: "a", toUUID: "b", weight: weightAB },
      { fromUUID: "b", toUUID: "output-0", weight: 1 },
    ],
  };
}

Deno.test("behaviour guard: probe inputs are deterministic and bounded", () => {
  const first = buildProbeInputs(3, { samples: 8 });
  const second = buildProbeInputs(3, { samples: 8 });

  assertEquals(first.length, 8, "one row per requested sample");
  for (let row = 0; row < first.length; row++) {
    assertEquals(first[row].length, 3, "one column per input");
    for (let i = 0; i < 3; i++) {
      assertEquals(
        second[row][i],
        first[row][i],
        "same seed must yield the same probes",
      );
      assert(
        Number.isFinite(first[row][i]) && Math.abs(first[row][i]) <= 3,
        `probe ${first[row][i]} out of range`,
      );
    }
  }

  // A different seed must explore a different corner of the input space.
  const other = buildProbeInputs(3, { samples: 8, seed: 42 });
  const identical = other.every((row, r) =>
    row.every((value, i) => value === first[r][i])
  );
  assert(!identical, "a different seed must produce different probes");
});

Deno.test("behaviour guard: an unchanged creature deviates by zero", async () => {
  await initWasmForTests();

  const creature = Creature.fromJSON(chain(0.25, 2), false);
  const twin = Creature.fromJSON(chain(0.25, 2), false);

  const deviation = measureBehaviourDeviation(creature, twin);

  assertEquals(deviation.nonFinite, false, "no non-finite outputs");
  assertEquals(deviation.worstDelta, 0, "identical creatures must not deviate");
  assert(
    isExactBehaviourPreserved(deviation),
    "identical creatures satisfy the exact contract",
  );
});

Deno.test("behaviour guard: a dropped bias fails the exact contract", async () => {
  await initWasmForTests();

  const original = Creature.fromJSON(chain(0.25, 2), false);
  // The classic broken fold: the middle neuron's bias is discarded.
  const broken = Creature.fromJSON(chain(0, 2), false);

  const deviation = measureBehaviourDeviation(original, broken);

  assertAlmostEquals(deviation.worstDelta, 0.25, 1e-5, "bias of 0.25 is lost");
  assert(
    !isExactBehaviourPreserved(deviation),
    "a lost bias is not behaviour preserving",
  );
});

Deno.test("behaviour guard: float32 rounding stays inside the exact contract", async () => {
  await initWasmForTests();

  const original = Creature.fromJSON(chain(0.25, 2), false);
  // A weight nudge far below the float32 noise floor must not be flagged.
  const rounded = Creature.fromJSON(chain(0.25, 2 + 1e-9), false);

  const deviation = measureBehaviourDeviation(original, rounded);

  assert(
    isExactBehaviourPreserved(deviation),
    `rounding noise ${deviation.worstDelta} must not be reported as a defect`,
  );
});

Deno.test("behaviour guard: allowance bounds a deliberately lossy change", async () => {
  await initWasmForTests();

  const original = Creature.fromJSON(chain(0.25, 2), false);
  const drifted = Creature.fromJSON(chain(0.3, 2), false);

  const deviation = measureBehaviourDeviation(original, drifted);

  assert(
    isWithinBehaviourAllowance(deviation, 0.5),
    "a 0.05 shift is inside a 50% allowance",
  );
  assert(
    !isWithinBehaviourAllowance(deviation, 0.000_1),
    "a 0.05 shift is outside a 0.01% allowance",
  );
});

Deno.test("behaviour guard: a different output count is a violation", async () => {
  await initWasmForTests();

  const original = Creature.fromJSON(chain(0.25, 2), false);
  const twoOutputs = Creature.fromJSON({
    input: 1,
    output: 2,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-0", toUUID: "output-1", weight: 1 },
    ],
  }, false);

  const deviation = measureBehaviourDeviation(original, twoOutputs);

  assert(deviation.nonFinite, "a shape change cannot be compared");
  assert(
    !isExactBehaviourPreserved(deviation),
    "a shape change is a violation",
  );
  assert(
    !isWithinBehaviourAllowance(deviation, 1),
    "a shape change exceeds every allowance",
  );
});

Deno.test("behaviour guard: checkpoints name the pass that broke behaviour", async () => {
  await initWasmForTests();

  const original = Creature.fromJSON(chain(0.25, 2), false);
  const checkpoints = new BehaviourCheckpoints(original);

  // First pass is exact — a weight moved onto the neighbouring synapse.
  const exactState = chain(0.25, 2);
  checkpoints.record("exact-fold", exactState);

  // Second pass drops the bias, so it is the one to blame.
  const brokenState = chain(0, 2);
  checkpoints.record("bias-dropping-fold", brokenState);

  const candidate = Creature.fromJSON(brokenState, false);
  const result = checkpoints.verify(candidate, "unit-test");

  assertEquals(result.ok, false, "the guard must reject the candidate");
  assertEquals(
    result.pass,
    "bias-dropping-fold",
    "the guard must name the offending pass",
  );
});

Deno.test("behaviour guard: checkpoints accept a behaviour-preserving pipeline", async () => {
  await initWasmForTests();

  const original = Creature.fromJSON(chain(0.25, 2), false);
  const checkpoints = new BehaviourCheckpoints(original);

  // Exact fold: neuron `b` disappears, its weight rides the bypass synapse and
  // its bias moves onto the (additive) output neuron.
  const folded: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "a", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.25 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "a", weight: 1 },
      { fromUUID: "a", toUUID: "output-0", weight: 2 },
    ],
  };
  checkpoints.record("exact-fold", folded);

  const candidate = Creature.fromJSON(folded, false);
  const result = checkpoints.verify(candidate, "unit-test");

  assertEquals(result.ok, true, "an exact pipeline must be accepted");
  assertEquals(result.pass, undefined, "nothing to blame");
});
