/**
 * WasmTopologyExport unit tests (Issue #2417).
 *
 * Verifies the thin TypeScript wrapper that delegates to the NEAT-AI-core
 * `CompiledNetwork.to_dot` and `CompiledNetwork.to_topology_json` bindings.
 *
 * The happy-path tests require a NEAT-AI-core revision that exposes
 * `to_dot` / `to_topology_json` on `CompiledNetwork` (NEAT-AI-core PR #32).
 * When the vendored WASM bundle predates that PR they skip with a clear
 * note; the error-path tests still run unconditionally and exercise the
 * wrapper logic.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { Creature } from "@creature";
import {
  getCompiledNetworkClass,
  initWasmActivation,
} from "@wasm/WasmModuleLoader.ts";
import {
  exportTopologyDot,
  exportTopologyJson,
} from "@wasm/WasmTopologyExport.ts";

await initWasmActivation();

/**
 * Probe whether the loaded WASM bundle exposes the topology export bindings.
 * Returns false when the pinned core rev predates NEAT-AI-core PR #32.
 */
function topologyExportAvailable(): boolean {
  const ctor = getCompiledNetworkClass();
  if (!ctor) return false;
  const proto = ctor.prototype as Record<string, unknown>;
  return typeof proto.to_dot === "function" &&
    typeof proto.to_topology_json === "function";
}

const HAPPY_PATH_AVAILABLE = topologyExportAvailable();

/**
 * Build a small deterministic 2-input → 1-output creature with a hidden
 * neuron. It produces 4 synapses (input-0→hidden-0, input-1→hidden-0,
 * hidden-0→output-0, plus a direct input-1→output-0 skip connection).
 */
function buildSmallCreature(): Creature {
  return Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", bias: 0.1, squash: "TANH" },
      { type: "output", uuid: "output-0", bias: -0.2, squash: "LOGISTIC" },
    ],
    synapses: [
      { weight: 0.5, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: -0.3, fromUUID: "input-1", toUUID: "hidden-0" },
      { weight: 0.7, fromUUID: "hidden-0", toUUID: "output-0" },
      { weight: 0.25, fromUUID: "input-1", toUUID: "output-0" },
    ],
  });
}

Deno.test({
  name:
    "exportTopologyDot returns a non-empty digraph with one edge per synapse",
  ignore: !HAPPY_PATH_AVAILABLE,
  fn() {
    const creature = buildSmallCreature();
    try {
      const dot = exportTopologyDot(creature);

      assert(dot.length > 0, "DOT output should be non-empty");
      assert(
        dot.startsWith("digraph"),
        `DOT should start with "digraph", got: ${dot.slice(0, 32)}`,
      );

      // One `->` edge per synapse — the small creature has 4 synapses.
      const edgeMatches = dot.match(/->/g) ?? [];
      assertEquals(
        edgeMatches.length,
        creature.synapses.length,
        "DOT edge count should match creature synapse count",
      );

      // Sanity: contains some neuron declarations.
      assertStringIncludes(dot, "n0");
    } finally {
      creature.dispose();
    }
  },
});

Deno.test({
  name:
    "exportTopologyJson neuron and synapse counts match the source creature",
  ignore: !HAPPY_PATH_AVAILABLE,
  fn() {
    const creature = buildSmallCreature();
    try {
      const exported = exportTopologyJson(creature);

      // creature.neurons already includes input neurons.
      const expectedNeurons = creature.neurons.length;
      assertEquals(
        exported.num_neurons,
        expectedNeurons,
        "num_neurons should match creature total neuron count",
      );
      assertEquals(exported.num_inputs, creature.input);
      assertEquals(exported.num_outputs, creature.output);
      assertEquals(
        exported.nodes.length,
        expectedNeurons,
        "nodes.length should equal num_neurons",
      );
      assertEquals(
        exported.synapses.length,
        creature.synapses.length,
        "synapses.length should match creature synapse count",
      );

      // Spot-check kinds: the first `input` entries should be classified as input.
      for (let i = 0; i < creature.input; i++) {
        assertEquals(exported.nodes[i].kind, "input");
      }
    } finally {
      creature.dispose();
    }
  },
});

Deno.test({
  name:
    "exportTopologyDot reports a clear error when the pinned core rev predates PR #32",
  // Only meaningful when the bundle actually predates PR #32 — otherwise the
  // happy-path tests already exercise the binding.
  ignore: HAPPY_PATH_AVAILABLE,
  fn() {
    const creature = buildSmallCreature();
    try {
      assertThrows(
        () => exportTopologyDot(creature),
        Error,
        "PR #32",
      );
    } finally {
      creature.dispose();
    }
  },
});

Deno.test("exportTopologyDot reports a clear error when WASM is unavailable", () => {
  const creature = buildSmallCreature();
  try {
    // Inject a resolver that simulates the WASM bundle being absent.
    assertThrows(
      () => exportTopologyDot(creature, () => null),
      Error,
      "WASM bundle",
    );
  } finally {
    creature.dispose();
  }
});

Deno.test("exportTopologyJson reports a clear error when WASM is unavailable", () => {
  const creature = buildSmallCreature();
  try {
    assertThrows(
      () => exportTopologyJson(creature, () => null),
      Error,
      "WASM bundle",
    );
  } finally {
    creature.dispose();
  }
});
