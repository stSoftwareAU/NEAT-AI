/**
 * @module
 *
 * Issue #3976 — the TypeScript adapter over NEAT-AI-core's `prune_synapse`.
 *
 * These cases drive the adapter through the real vendored WASM bundle: a
 * `CreatureExport` and a `(from, to, role)` triple go in, a rewritten
 * `CreatureExport` comes back, and the report says what the removal cost. They
 * cover the contract the production `SubConnection` mutation now depends on —
 * the exact structural fold, the typed-role identity an `IF` needs, the two
 * `IF` rewrites that replace the old TypeScript refusal, the orphan cascade,
 * metadata NEAT-AI carries and core does not model, and the refusals that must
 * never be mistaken for a rewrite.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import {
  fixedSourceExport,
  hiddenChainExport,
  ifRolesExport,
} from "../_pruneFixtures.ts";
import { initWasmActivation } from "@wasm/WasmModuleLoader.ts";
import { corePruneSynapse, type PruneRole } from "@wasm/WasmPruneSynapse.ts";
import { WasmError } from "@errors/WasmError.ts";

await initWasmActivation();

/** Aliases for the shared builders, kept so the cases read as before. */
const constantFixture = fixedSourceExport;
const ifFixture = ifRolesExport;
const hiddenFixture = hiddenChainExport;

Deno.test("corePruneSynapse: folds a fixed source into the target's bias exactly", () => {
  const outcome = corePruneSynapse(constantFixture(), {
    fromUUID: "c-1",
    toUUID: "output-0",
  });
  assert(outcome.ok, "a constant-sourced edge must prune");

  const output = outcome.creature.neurons.find((n) => n.uuid === "output-0");
  assert(output, "the output neuron must survive");
  // The constant is worth 0.5 on every record and carried 0.2 of it.
  assertAlmostEquals(output.bias, 0.25 + 0.2 * 0.5, 1e-9);
  assertEquals(outcome.transform, "exact");

  const fold = outcome.biasFolds.find((f) => f.targetUUID === "output-0");
  assert(fold, "the fold must be reported, never silent");
  assertEquals(fold.exact, true);
  assertEquals(
    outcome.removedSynapses.map((s) => `${s.fromUUID}->${s.toUUID}`),
    ["c-1->output-0"],
  );
});

Deno.test("corePruneSynapse: folds the caller's mean when the source is not fixed", () => {
  const outcome = corePruneSynapse(
    hiddenFixture(),
    { fromUUID: "h-1", toUUID: "output-0" },
    { meanActivation: 0.4 },
  );
  assert(outcome.ok, "the removal must succeed");

  const output = outcome.creature.neurons.find((n) => n.uuid === "output-0");
  assert(output, "the output neuron must survive");
  assertAlmostEquals(output.bias, 0.1 + 0.8 * 0.4, 1e-9);
  assertEquals(outcome.uncompensated.length, 0);
});

Deno.test("corePruneSynapse: cascades away a source left with no outward edge", () => {
  const outcome = corePruneSynapse(hiddenFixture(), {
    fromUUID: "h-1",
    toUUID: "output-0",
  });
  assert(outcome.ok, "the removal must succeed");

  assert(
    outcome.cascadeNeurons.includes("h-1"),
    "the orphaned source must be cascaded away and reported",
  );
  assertEquals(
    outcome.cascadeSynapses.map((s) => `${s.fromUUID}->${s.toUUID}`),
    ["input-0->h-1"],
    "the edge that fed it must be reported as cascaded too",
  );
});

Deno.test("corePruneSynapse: a hidden left with no inward edge becomes a constant", () => {
  const outcome = corePruneSynapse(hiddenFixture(), {
    fromUUID: "input-0",
    toUUID: "h-1",
  });
  assert(outcome.ok, "the removal must succeed");

  const survivor = outcome.creature.neurons.find((n) => n.uuid === "h-1");
  assert(survivor, "the stranded hidden must survive as support");
  assertEquals(survivor.type, "constant");
  assert(
    outcome.foldedNeurons.includes("h-1"),
    "the fold must be reported, never inferred by the caller",
  );
});

Deno.test("corePruneSynapse: removing the last IF condition flattens to the branch it always took", () => {
  // The superseded TypeScript refused this removal outright
  // (`SubConnection#wouldBreakIfNeuron`); core rewrites instead.
  const outcome = corePruneSynapse(ifFixture(), {
    fromUUID: "input-0",
    toUUID: "if-1",
    type: "condition",
  });
  assert(outcome.ok, "core must rewrite rather than refuse");

  assertEquals(outcome.staticIfNeurons, [{ uuid: "if-1", branch: "negative" }]);
  const rewritten = outcome.creature.neurons.find((n) => n.uuid === "if-1");
  assert(rewritten, "the IF neuron must survive as the branch it took");
  assertEquals(rewritten.squash, IDENTITY.NAME);
  assertEquals(
    outcome.creature.synapses.some((s) =>
      s.toUUID === "if-1" && s.type === "positive"
    ),
    false,
    "the unreachable branch must go with the condition",
  );
});

Deno.test("corePruneSynapse: emptying one IF branch restores it with a zero-weight support edge", () => {
  const outcome = corePruneSynapse(ifFixture(), {
    fromUUID: "input-1",
    toUUID: "if-1",
    type: "positive",
  });
  assert(outcome.ok, "core must rewrite rather than refuse");

  assertEquals(outcome.restoredIfRoles.length, 1);
  const restored = outcome.restoredIfRoles[0];
  assertEquals(restored.toUUID, "if-1");
  assertEquals(restored.type, "positive");

  const support = outcome.creature.synapses.find((s) =>
    s.toUUID === "if-1" && s.type === "positive"
  );
  assert(support, "the emptied branch must be given a row back");
  assertEquals(
    support.weight,
    0,
    "an empty branch sums to zero, and so does this",
  );
  const stillIf = outcome.creature.neurons.find((n) => n.uuid === "if-1");
  assertEquals(stillIf?.squash, "IF", "the IF must stay an IF");
});

Deno.test("corePruneSynapse: a typed role names one edge of a shared pair", () => {
  const creature = ifFixture();
  // One source feeding two branches of the same IF — legal only at an IF.
  creature.synapses[2] = {
    fromUUID: "input-1",
    toUUID: "if-1",
    weight: 0.7,
    type: "negative",
  };

  const outcome = corePruneSynapse(creature, {
    fromUUID: "input-1",
    toUUID: "if-1",
    type: "negative",
  });
  assert(outcome.ok, "the removal must succeed");

  assertEquals(outcome.removedSynapses, [{
    fromUUID: "input-1",
    toUUID: "if-1",
    type: "negative",
  }]);
  const positive = outcome.creature.synapses.find((s) =>
    s.fromUUID === "input-1" && s.toUUID === "if-1" && s.type === "positive"
  );
  assert(positive, "the other role of the same pair must survive untouched");
  assertAlmostEquals(positive.weight, 0.6, 1e-9);
});

Deno.test("corePruneSynapse: a role means nothing at a target that cannot tell roles apart", () => {
  // Every squash but `IF` sums whatever reaches it, so the readable key is the
  // pair — asking for a role of such a pair takes the term the pair carries.
  const outcome = corePruneSynapse(constantFixture(), {
    fromUUID: "c-1",
    toUUID: "output-0",
    type: "positive",
  });
  assert(outcome.ok, "the untyped edge of the pair is the edge named");
  assertEquals(outcome.removedSynapses.length, 1);
  assertEquals(outcome.removedSynapses[0].type, "standard");
});

Deno.test("corePruneSynapse: an edge incident on an observation or output neuron is an ordinary candidate", () => {
  const creature: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [{
      uuid: "output-0",
      type: "output",
      squash: IDENTITY.NAME,
      bias: 0.1,
    }],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.5 },
    ],
  };

  const outcome = corePruneSynapse(creature, {
    fromUUID: "input-0",
    toUUID: "output-0",
  });
  assert(outcome.ok, "nothing about the declared widths is touched");
  assertEquals(outcome.creature.input, 2);
  assertEquals(outcome.creature.synapses.length, 1);
});

Deno.test("corePruneSynapse: preserves tags and frozen, which core does not model", () => {
  const creature = hiddenFixture();
  creature.tags = [{ name: "approach", value: "mutation" }];
  creature.neurons[1].tags = [{ name: "role", value: "survivor" }];
  creature.neurons[1].frozen = true;
  creature.synapses[2].tags = [{ name: "origin", value: "seed" }];
  creature.synapses[2].frozen = true;

  const outcome = corePruneSynapse(creature, {
    fromUUID: "h-1",
    toUUID: "output-0",
  }, { meanActivation: 0.5 });
  assert(outcome.ok, "the removal must succeed");

  assertEquals(outcome.creature.tags, [{
    name: "approach",
    value: "mutation",
  }]);
  const output = outcome.creature.neurons.find((n) => n.uuid === "output-0");
  assertEquals(output?.tags, [{ name: "role", value: "survivor" }]);
  assertEquals(output?.frozen, true);
  const kept = outcome.creature.synapses.find((s) =>
    s.fromUUID === "input-1" && s.toUUID === "output-0"
  );
  assertEquals(kept?.tags, [{ name: "origin", value: "seed" }]);
  assertEquals(kept?.frozen, true);
});

Deno.test("corePruneSynapse: refuses a triple the creature does not carry", () => {
  const outcome = corePruneSynapse(hiddenFixture(), {
    fromUUID: "input-1",
    toUUID: "h-1",
  });
  assert(!outcome.ok, "an absent edge is a refusal, not a rewrite");
  assertEquals(outcome.reason, "UNKNOWN_SYNAPSE");
});

Deno.test("corePruneSynapse: refuses a role spelling core does not carry", () => {
  // `PruneRole` rejects this spelling at compile time, so the cast is what a
  // JavaScript caller — or a role read off untyped JSON — would reach the
  // bridge with. Core answers `malformed` for it, which is a bug report about
  // this repo rather than a verdict on the creature, so the bridge names the
  // offending value itself.
  const thrown = assertThrows(
    () =>
      corePruneSynapse(hiddenFixture(), {
        fromUUID: "input-0",
        toUUID: "h-1",
        type: "POSITIVE" as PruneRole,
      }),
    WasmError,
  );
  assertStringIncludes(thrown.message, "POSITIVE");
  assertStringIncludes(thrown.message, "input-0 -> h-1");
});

Deno.test("corePruneSynapse: refuses a non-finite statistic loudly", () => {
  const thrown = assertThrows(
    () =>
      corePruneSynapse(
        hiddenFixture(),
        { fromUUID: "h-1", toUUID: "output-0" },
        { meanActivation: Number.NaN },
      ),
    WasmError,
  );
  assertStringIncludes(thrown.message, "meanActivation");
});

Deno.test("corePruneSynapse: throws when the bundle is unavailable — never a silent skip", () => {
  const thrown = assertThrows(
    () =>
      corePruneSynapse(
        hiddenFixture(),
        { fromUUID: "h-1", toUUID: "output-0" },
        undefined,
        null,
        new Error("bundle missing"),
      ),
    WasmError,
  );
  assertStringIncludes(thrown.message, "no TypeScript fallback");
  assertStringIncludes(thrown.message, "bundle missing");
});

Deno.test("corePruneSynapse: an unavailable bundle is reported before the request shape", () => {
  // Both faults are real, but only one of them is actionable: told the
  // statistic was unusable, an operator fixes the measurement and still has no
  // bundle. The missing bundle is the fault to name.
  const thrown = assertThrows(
    () =>
      corePruneSynapse(
        hiddenFixture(),
        { fromUUID: "h-1", toUUID: "output-0" },
        { meanActivation: Number.NaN },
        null,
        new Error("bundle missing"),
      ),
    WasmError,
  );
  assertStringIncludes(thrown.message, "no TypeScript fallback");
});

Deno.test("corePruneSynapse: a malformed answer is a bridge fault, not a refusal", () => {
  const thrown = assertThrows(
    () =>
      corePruneSynapse(
        hiddenFixture(),
        { fromUUID: "h-1", toUUID: "output-0" },
        undefined,
        () => "not json at all",
      ),
    WasmError,
  );
  assertStringIncludes(thrown.message, "not JSON");
});

Deno.test("corePruneSynapse: a malformed failure is a bridge fault, not a refusal", () => {
  const thrown = assertThrows(
    () =>
      corePruneSynapse(
        hiddenFixture(),
        { fromUUID: "h-1", toUUID: "output-0" },
        undefined,
        () =>
          JSON.stringify({
            ok: false,
            failure: {
              reason: "MALFORMED_REQUEST",
              message: "missing field `synapse`",
              malformed: true,
            },
          }),
      ),
    WasmError,
  );
  assertStringIncludes(thrown.message, "missing field");
});

Deno.test("corePruneSynapse: a rewrite reporting an unreadable removed edge fails loud", () => {
  const thrown = assertThrows(
    () =>
      corePruneSynapse(
        hiddenFixture(),
        { fromUUID: "h-1", toUUID: "output-0" },
        undefined,
        () =>
          JSON.stringify({
            ok: true,
            creature: hiddenFixture(),
            transform: "exact",
            passes: 1,
            removedSynapses: [{ toUUID: "output-0" }],
          }),
      ),
    WasmError,
  );
  assertStringIncludes(thrown.message, "fromUUID");
});

Deno.test("corePruneSynapse: a static-IF report without a branch fails loud", () => {
  const thrown = assertThrows(
    () =>
      corePruneSynapse(
        hiddenFixture(),
        { fromUUID: "h-1", toUUID: "output-0" },
        undefined,
        () =>
          JSON.stringify({
            ok: true,
            creature: hiddenFixture(),
            transform: "exact",
            passes: 1,
            staticIfNeurons: [{ uuid: "if-1" }],
          }),
      ),
    WasmError,
  );
  assertStringIncludes(thrown.message, "staticIfNeurons[0]");
});
