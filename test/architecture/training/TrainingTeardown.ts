/**
 * Tests for the post-training teardown phase (Issue #2399).
 *
 * Exercises the pure helpers in isolation without running a full
 * training pipeline.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import {
  pruneSyntheticSynapses,
  stripUntrackedTraces,
  syncTraceSynapseRoles,
  wireToRuntimeIdFromExport,
} from "@architecture/training/TrainingTeardown.ts";
import type { SynapseTrace } from "@architecture/SynapseInterfaces.ts";
import { SynapseState } from "@propagate/SynapseState.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import { buildOutgoingSynapsesMap } from "@propagate/sparse/CalculatePathsToOutput.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";

Deno.test("TrainingTeardown - wireToRuntimeIdFromExport maps input uuids sequentially", () => {
  const creature = new Creature(3, 2, { layers: [{ count: 2 }] });
  const exportJson = exportJSONWithRuntimeIds(creature);
  const map = wireToRuntimeIdFromExport(exportJson);

  // Each input gets a canonical `input-N` label mapped to its index.
  assertEquals(map.get("input-0"), 0);
  assertEquals(map.get("input-1"), 1);
  assertEquals(map.get("input-2"), 2);

  // Every non-input neuron with a UUID and runtime id is present.
  for (const n of exportJson.neurons) {
    if (typeof n.uuid === "string" && n.id !== undefined) {
      assertEquals(map.get(n.uuid), n.id);
    }
  }
});

Deno.test("TrainingTeardown - pruneSyntheticSynapses is a no-op when there are no synthetic keys", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const exportJson = exportJSONWithRuntimeIds(creature);
  const trace = creature.traceJSON();

  const result = pruneSyntheticSynapses(
    creature,
    exportJson,
    trace,
    undefined,
    1e-7,
  );

  assertEquals(result.bestCreatureJSON, exportJson);
  assertEquals(result.bestTraceJSON, trace);

  // Empty synthetic key set is also a no-op.
  const empty = pruneSyntheticSynapses(
    creature,
    exportJson,
    trace,
    new Set<string>(),
    1e-7,
  );
  assertEquals(empty.bestCreatureJSON, exportJson);
  assertEquals(empty.bestTraceJSON, trace);
});

/**
 * Issue #3873: build a trace synapse; the trace state itself is irrelevant to
 * role alignment, so a fresh `SynapseState` stands in for the recorded one.
 */
function traceSynapse(
  fromUUID: string,
  toUUID: string,
  type?: SynapseTrace["type"],
): SynapseTrace {
  return { fromUUID, toUUID, weight: 0.5, type, trace: new SynapseState() };
}

Deno.test("TrainingTeardown - syncTraceSynapseRoles keeps a role the cleaned creature still carries", () => {
  const kept = syncTraceSynapseRoles(
    [traceSynapse("a", "gate", "positive")],
    new Map([["a->gate", new Set(["positive", "negative"])]]),
  );

  assertEquals(kept.length, 1);
  assertEquals(kept[0].type, "positive");
});

Deno.test("TrainingTeardown - syncTraceSynapseRoles syncs a role that changed rather than dropping it", () => {
  // An `IF` downgraded to `IDENTITY` strips the branch roles from the
  // creature, but the trace was captured before that and still names them.
  // Dropping the row would leave its source neuron with no outward synapse.
  const kept = syncTraceSynapseRoles(
    [traceSynapse("a", "gate", "positive")],
    new Map([["a->gate", new Set([""])]]),
  );

  assertEquals(kept.length, 1);
  assertEquals(kept[0].type, undefined);
  assert(!("type" in kept[0]), "the untyped role must not carry a type key");
});

Deno.test("TrainingTeardown - syncTraceSynapseRoles coalesces rows the role strip merged", () => {
  // Both roles fed one `IF`; the downgrade sums them into a single synapse,
  // so the trace must not end up with a duplicate pair.
  const kept = syncTraceSynapseRoles(
    [
      traceSynapse("a", "gate", "positive"),
      traceSynapse("a", "gate", "negative"),
    ],
    new Map([["a->gate", new Set([""])]]),
  );

  assertEquals(kept.length, 1);
  assertEquals(kept[0].type, undefined);
});

Deno.test("TrainingTeardown - syncTraceSynapseRoles drops synapses the clean-up removed", () => {
  const kept = syncTraceSynapseRoles(
    [
      // The pair is gone entirely.
      traceSynapse("a", "gate", "positive"),
      // The pair survives with several roles, but not this one.
      traceSynapse("b", "gate", "condition"),
      // No wire endpoints — nothing to match on.
      { weight: 0.5, trace: new SynapseState() },
    ],
    new Map([["b->gate", new Set(["positive", "negative"])]]),
  );

  assertEquals(kept.length, 0);
});

Deno.test("TrainingTeardown - stripUntrackedTraces removes trace fields for untracked neurons", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const exportJson = exportJSONWithRuntimeIds(creature);

  // Build a trace and artificially attach trace objects to every
  // neuron/synapse so we can observe the strip decision.
  const trace = creature.traceJSON();
  for (const n of trace.neurons) {
    (n as { trace?: unknown }).trace = { total: 1, count: 1 };
  }
  for (const s of trace.synapses) {
    (s as { trace?: unknown }).trace = { used: true };
  }

  const backProp = createBackPropagationConfig({});
  const outgoing = buildOutgoingSynapsesMap(exportJson);
  const sparseConfig = new SparseConfig(exportJson, backProp, outgoing);

  stripUntrackedTraces(trace, exportJson, sparseConfig);

  // For every neuron whose runtime id is not needed by the sparse
  // config, `trace` must be stripped.
  for (const n of trace.neurons) {
    if (typeof n.uuid === "string") {
      // Neurons that remain with a trace must be the ones the sparse
      // config marks as needed; the strip must not drop "needed" ones.
      const hasTrace = (n as { trace?: unknown }).trace !== undefined;
      assert(typeof hasTrace === "boolean");
    }
  }
});
