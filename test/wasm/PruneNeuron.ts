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

/**
 * Issue #3975 — a response core sends that does not match its own contract is
 * a fault in this bridge or in the ABI between them, and must be reported as
 * one. Coercing the missing field (`String(undefined)` → `"undefined"`,
 * `Number(undefined)` → `NaN`) would hand the caller plausible-looking data:
 * a fold naming a neuron that does not exist is silently skipped downstream,
 * so the Issue #2421 overflow guard would quietly stop covering that target.
 */
function respondingWith(response: unknown): (request: string) => string {
  return () => JSON.stringify(response);
}

/** A minimally valid success, for tests that damage exactly one field. */
function successResponse(): Record<string, unknown> {
  return {
    ok: true,
    transform: "exact",
    passes: 1,
    removedNeuron: "hidden-0",
    cascadeNeurons: [],
    foldedNeurons: [],
    downgradedIfNeurons: [],
    biasFolds: [],
    weightShares: [],
    uncompensated: [],
    creature: {
      input: 2,
      output: 1,
      neurons: [
        { uuid: "hidden-1", type: "hidden", squash: IDENTITY.NAME, bias: 0.2 },
        { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0.05 },
      ],
      synapses: [
        { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.3 },
        { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.35 },
      ],
    },
  };
}

/** Run `corePruneNeuron` against a canned response and return what it threw. */
function thrownFor(response: unknown, uuid = "hidden-0"): unknown {
  try {
    corePruneNeuron(fixture(), uuid, undefined, respondingWith(response));
    return undefined;
  } catch (error) {
    return error;
  }
}

Deno.test("corePruneNeuron: the canned success fixture is itself accepted", () => {
  // Guards the negative tests below: each damages one field of this response,
  // so the undamaged response must succeed or those tests prove nothing.
  const outcome = corePruneNeuron(
    fixture(),
    "hidden-0",
    undefined,
    respondingWith(successResponse()),
  );
  assert(outcome.ok, "the undamaged canned success must be accepted");
  assertEquals(outcome.passes, 1);
});

Deno.test("corePruneNeuron: a success whose creature is not a creature fails loud", () => {
  const response = successResponse();
  response.creature = { input: 2, output: 1 };
  const thrown = thrownFor(response);
  assert(
    thrown instanceof WasmError,
    "a creature with no neurons array must fail loud, not die later as a " +
      "TypeError naming neither core nor the bridge",
  );
  assertEquals(thrown.reason, "INVALID_REQUEST");
  assertStringIncludes(thrown.message, "neurons");
});

Deno.test("corePruneNeuron: a bias fold naming no target fails loud", () => {
  const response = successResponse();
  response.biasFolds = [{ weightSum: 0.25, delta: 0.1, exact: true }];
  const thrown = thrownFor(response);
  assert(thrown instanceof WasmError, "a fold with no targetUUID must throw");
  assertEquals(thrown.reason, "INVALID_REQUEST");
  assertStringIncludes(thrown.message, "targetUUID");
});

Deno.test("corePruneNeuron: a bias fold with an unusable delta fails loud", () => {
  const response = successResponse();
  response.biasFolds = [{ targetUUID: "output-0", weightSum: 0.25 }];
  const thrown = thrownFor(response);
  assert(thrown instanceof WasmError, "a fold with no delta must throw");
  assertEquals(thrown.reason, "INVALID_REQUEST");
  assertStringIncludes(thrown.message, "delta");
});

Deno.test("corePruneNeuron: a rewrite reporting the wrong neuron fails loud", () => {
  const response = successResponse();
  response.removedNeuron = "some-other-neuron";
  const thrown = thrownFor(response);
  assert(
    thrown instanceof WasmError,
    "core answering about a neuron nobody asked about must fail loud",
  );
  assertEquals(thrown.reason, "INVALID_REQUEST");
  assertStringIncludes(thrown.message, "some-other-neuron");
});

Deno.test("corePruneNeuron: a refusal with no reason fails loud", () => {
  const thrown = thrownFor({ ok: false, failure: { message: "nope" } });
  assert(
    thrown instanceof WasmError,
    "a refusal must name a stable reason token, not coerce to 'undefined'",
  );
  assertEquals(thrown.reason, "INVALID_REQUEST");
  assertStringIncludes(thrown.message, "reason");
});

Deno.test("corePruneNeuron: a refusal core understood is not an error", () => {
  const outcome = corePruneNeuron(
    fixture(),
    "hidden-0",
    undefined,
    respondingWith({
      ok: false,
      failure: { reason: "PROTECTED_NEURON", message: "constant node" },
    }),
  );
  assertEquals(outcome.ok, false, "an understood refusal is not a throw");
  assert(!outcome.ok);
  assertEquals(outcome.reason, "PROTECTED_NEURON");
});

Deno.test("corePruneNeuron: an error quotes the fault without dumping the creature", () => {
  // A response is a whole creature and can run to megabytes; the message must
  // stay small enough to be readable in a log.
  const response = successResponse();
  response.transform = "wishful";
  (response.creature as { neurons: unknown[] }).neurons = Array.from(
    { length: 4000 },
    (_, i) => ({
      uuid: `n-${i}`,
      type: "hidden",
      squash: IDENTITY.NAME,
      bias: 0,
    }),
  );
  const thrown = thrownFor(response);
  assert(thrown instanceof WasmError);
  assert(
    thrown.message.length < 1000,
    `the error should not dump the creature, got ${thrown.message.length} bytes`,
  );
});

Deno.test("corePruneNeuron: a malformed failure is a bridge fault, not a refusal", () => {
  // `malformed` says the payload never reached the rewrite, so it says nothing
  // about the creature. Returning it as a refusal would let a bug in this
  // bridge masquerade as a neuron core declined to remove — and the caller
  // reads a refusal as an ordinary "no change".
  const thrown = thrownFor({
    ok: false,
    failure: {
      reason: "MALFORMED_REQUEST",
      message: "missing field `uuid`",
      malformed: true,
    },
  });
  assert(
    thrown instanceof WasmError,
    "a malformed request must throw, never come back as a refusal",
  );
  assertEquals(thrown.reason, "INVALID_REQUEST");
  assertStringIncludes(thrown.message, "missing field");
});

Deno.test("corePruneNeuron: a fold claiming exactness it did not send fails loud", () => {
  const response = successResponse();
  response.biasFolds = [{
    targetUUID: "output-0",
    weightSum: 0.25,
    delta: 0.1,
  }];
  const thrown = thrownFor(response);
  assert(
    thrown instanceof WasmError,
    "an absent `exact` must not be read as an approximate fold",
  );
  assertEquals(thrown.reason, "INVALID_REQUEST");
  assertStringIncludes(thrown.message, "exact");
});
