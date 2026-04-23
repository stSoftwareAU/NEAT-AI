import { assert, assertEquals, assertFalse } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import {
  calculateWeightBiasPenalty,
  simplifyLargeWeights,
} from "@compact/SimplifyLargeWeights.ts";

function maxAbs(exported: CreatureExport): number {
  let max = 0;
  for (const s of exported.synapses) max = Math.max(max, Math.abs(s.weight));
  for (const n of exported.neurons) max = Math.max(max, Math.abs(n.bias));
  return max;
}

Deno.test("simplifyLargeWeights: rescales imbalanced ABSOLUTE bridge and reduces penalty", () => {
  const exported: CreatureExport = {
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: "ABSOLUTE", bias: 1e6 },
      { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1e6 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1e-6 },
    ],
    input: 1,
    output: 1,
  };
  normaliseCreatureExport(exported);

  const beforePenalty = calculateWeightBiasPenalty(exported);
  const beforeMax = maxAbs(exported);

  const changed = simplifyLargeWeights(exported);

  assert(
    changed,
    "Expected simplifyLargeWeights to rescale the imbalanced pair",
  );
  const afterPenalty = calculateWeightBiasPenalty(exported);
  const afterMax = maxAbs(exported);

  assert(
    afterPenalty < beforePenalty,
    `penalty should drop (before=${beforePenalty}, after=${afterPenalty})`,
  );
  assert(
    afterMax < beforeMax,
    `max |weight|/|bias| should drop (before=${beforeMax}, after=${afterMax})`,
  );

  // All values remain finite.
  for (const s of exported.synapses) assert(Number.isFinite(s.weight));
  for (const n of exported.neurons) assert(Number.isFinite(n.bias));
});

Deno.test("simplifyLargeWeights: no-op for balanced weights", () => {
  const exported: CreatureExport = {
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: "IDENTITY", bias: 0.25 },
      { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: -0.75 },
    ],
    input: 1,
    output: 1,
  };
  normaliseCreatureExport(exported);

  const snapshot = JSON.stringify(exported);
  const changed = simplifyLargeWeights(exported);
  assertFalse(changed, "Balanced weights should not be rescaled");
  assertEquals(JSON.stringify(exported), snapshot);
});

Deno.test("simplifyLargeWeights: non-homogeneous squash (TANH) is left alone", () => {
  const exported: CreatureExport = {
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: "TANH", bias: 1e6 },
      { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1e6 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1e-6 },
    ],
    input: 1,
    output: 1,
  };
  normaliseCreatureExport(exported);

  const snapshot = JSON.stringify(exported);
  const changed = simplifyLargeWeights(exported);
  assertFalse(changed, "TANH is not scale-homogeneous — no rescaling expected");
  assertEquals(JSON.stringify(exported), snapshot);
});

Deno.test("calculateWeightBiasPenalty: returns 0 for an empty creature export", () => {
  const empty: CreatureExport = {
    neurons: [],
    synapses: [],
    input: 0,
    output: 0,
  };
  assertEquals(calculateWeightBiasPenalty(empty), 0);
});
