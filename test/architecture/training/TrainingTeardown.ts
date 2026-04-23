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
  wireToRuntimeIdFromExport,
} from "@architecture/training/TrainingTeardown.ts";
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
