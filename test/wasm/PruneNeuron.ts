/**
 * @module
 *
 * Issue #3975 — the TypeScript adapter over NEAT-AI-core's `prune_neuron`.
 *
 * These cases drive the adapter through the real vendored WASM bundle: a
 * `CreatureExport` goes in, a pruned `CreatureExport` comes back, and the
 * report says what the rewrite cost. They cover the contract the production
 * discovery removal path now depends on — the mean bias fold, the exact
 * structural fold, the orphan cascade, metadata NEAT-AI carries and core does
 * not model, and the refusals that must never be mistaken for a rewrite.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertStringIncludes,
} from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { initWasmActivation } from "@wasm/WasmModuleLoader.ts";
import { corePruneNeuron } from "@wasm/WasmPruneNeuron.ts";
import { WasmError } from "@errors/WasmError.ts";

await initWasmActivation();

/**
 * `hidden-0` feeds the output and is fed by `input-0`; `hidden-1` keeps the
 * output wired once `hidden-0` goes.
 */
function fixture(): CreatureExport {
  return {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "hidden-1", type: "hidden", squash: IDENTITY.NAME, bias: 0.2 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0.05 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.35 },
    ],
  };
}

Deno.test("corePruneNeuron: removes the named hidden neuron and its synapses", () => {
  const outcome = corePruneNeuron(fixture(), "hidden-0");
  assert(outcome.ok, "a hidden neuron with a surviving path must prune");

  assertEquals(
    outcome.creature.neurons.some((n) => n.uuid === "hidden-0"),
    false,
    "the requested neuron must be gone",
  );
  assertEquals(
    outcome.creature.synapses.some((s) =>
      s.fromUUID === "hidden-0" || s.toUUID === "hidden-0"
    ),
    false,
    "every synapse naming it must be gone",
  );
  assertEquals(outcome.removedNeuron, "hidden-0");
});

Deno.test("corePruneNeuron: folds the caller's mean into each target's bias", () => {
  const outcome = corePruneNeuron(fixture(), "hidden-0", {
    meanActivation: 0.4,
  });
  assert(outcome.ok, "the removal must succeed");

  const output = outcome.creature.neurons.find((n) => n.uuid === "output-0");
  assert(output, "the output neuron must survive");
  // bias += weightSum · mean = 0.05 + 0.25 · 0.4
  assertAlmostEquals(output.bias, 0.05 + 0.25 * 0.4, 1e-9);

  const fold = outcome.biasFolds.find((f) => f.targetUUID === "output-0");
  assert(fold, "the fold must be reported, never silent");
  assertAlmostEquals(fold.weightSum, 0.25, 1e-9);
  assertAlmostEquals(fold.delta, 0.25 * 0.4, 1e-9);
});

Deno.test("corePruneNeuron: cascades away a feeder left with no outward edge", () => {
  const creature = fixture();
  // `hidden-2` exists only to feed `hidden-0`, so removing `hidden-0` orphans it.
  creature.neurons.push({
    uuid: "hidden-2",
    type: "hidden",
    squash: IDENTITY.NAME,
    bias: 0.3,
  });
  creature.synapses.push(
    { fromUUID: "input-0", toUUID: "hidden-2", weight: 0.4 },
    { fromUUID: "hidden-2", toUUID: "hidden-0", weight: 0.5 },
  );

  const outcome = corePruneNeuron(creature, "hidden-0");
  assert(outcome.ok, "the removal must succeed");
  assertEquals(
    outcome.creature.neurons.some((n) => n.uuid === "hidden-2"),
    false,
    "the orphaned feeder must be cascaded away",
  );
  assert(
    outcome.cascadeNeurons.includes("hidden-2"),
    "the cascade must be reported",
  );
});

Deno.test("corePruneNeuron: preserves tags and frozen, which core does not model", () => {
  const creature = fixture();
  creature.tags = [{ name: "approach", value: "discovery" }];
  creature.neurons[1].tags = [{ name: "role", value: "survivor" }];
  creature.neurons[1].frozen = true;
  creature.synapses[3].tags = [{ name: "origin", value: "seed" }];
  creature.synapses[3].frozen = true;

  const outcome = corePruneNeuron(creature, "hidden-0");
  assert(outcome.ok, "the removal must succeed");

  assertEquals(outcome.creature.tags, [{
    name: "approach",
    value: "discovery",
  }]);
  const survivor = outcome.creature.neurons.find((n) => n.uuid === "hidden-1");
  assert(survivor, "the survivor must be there");
  assertEquals(survivor.tags, [{ name: "role", value: "survivor" }]);
  assertEquals(survivor.frozen, true);

  const kept = outcome.creature.synapses.find((s) =>
    s.fromUUID === "hidden-1" && s.toUUID === "output-0"
  );
  assert(kept, "the survivor's synapse must be there");
  assertEquals(kept.tags, [{ name: "origin", value: "seed" }]);
  assertEquals(kept.frozen, true);
});

Deno.test("corePruneNeuron: refuses an unknown neuron rather than rewriting", () => {
  const outcome = corePruneNeuron(fixture(), "hidden-nope");
  assertEquals(outcome.ok, false);
  assert(!outcome.ok);
  assertEquals(outcome.reason, "UNKNOWN_NEURON");
});

Deno.test("corePruneNeuron: refuses a protected output neuron", () => {
  const outcome = corePruneNeuron(fixture(), "output-0");
  assert(!outcome.ok);
  assertEquals(outcome.reason, "PROTECTED_NEURON");
});

Deno.test("corePruneNeuron: refuses a non-finite statistic loudly", () => {
  // JSON writes `Infinity` as `null`, so sending it would reach core as a
  // *missing* measurement. The bridge must say which number was unusable.
  let thrown: unknown;
  try {
    corePruneNeuron(fixture(), "hidden-0", {
      meanActivation: Number.POSITIVE_INFINITY,
    });
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof WasmError, "a non-finite statistic must fail loud");
  assertEquals(thrown.reason, "INVALID_REQUEST");
  assertStringIncludes(thrown.message, "meanActivation");
});

Deno.test("corePruneNeuron: throws when the bundle is unavailable — never a silent skip", () => {
  let thrown: unknown;
  try {
    corePruneNeuron(fixture(), "hidden-0", undefined, null, null);
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof WasmError, "an absent bundle must fail loud");
  assertEquals(thrown.reason, "MODULE_NOT_LOADED");
});

Deno.test("corePruneNeuron: a malformed answer is a bridge fault, not a refusal", () => {
  let thrown: unknown;
  try {
    corePruneNeuron(fixture(), "hidden-0", undefined, () => "not json");
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof WasmError);
  assertEquals(thrown.reason, "INVALID_REQUEST");
});
