/**
 * WasmTopologyExport.ts — TypeScript wrapper for NEAT-AI-core topology exports.
 *
 * Issue #2417: Expose the `to_dot` / `to_topology_json` capability added to
 * `CompiledNetwork` in NEAT-AI-core PR #32 (`neat-core/src/topology_export.rs`).
 *
 * Both functions delegate formatting to the Rust implementation — there is no
 * TypeScript re-implementation of the DOT or JSON formatter. If the WASM
 * bundle cannot be loaded, callers receive a clear error pointing at
 * `./build.sh`.
 */
import type { Creature } from "@creature";
import type { CompiledCreatureData } from "@wasm/CompileToWasm.ts";
import type {
  WasmCompiledNetwork,
  WasmCompiledNetworkConstructor,
} from "@wasm/WasmCompiledNetwork.ts";
import { getCompiledNetworkClass } from "@wasm/WasmModuleLoader.ts";

/**
 * Resolver for the WASM `CompiledNetwork` class. Defaults to the live
 * module loader; tests inject a stub to exercise the error path.
 */
export type CompiledNetworkClassResolver = () =>
  | WasmCompiledNetworkConstructor
  | null;

/** Throws a clear error when the WASM bundle is unavailable. */
function requireCompiledNetworkClass(
  resolver: CompiledNetworkClassResolver,
  name: string,
): WasmCompiledNetworkConstructor {
  const ctor = resolver();
  if (!ctor) {
    throw new Error(
      `WasmTopologyExport.${name} requires the NEAT-AI-core WASM bundle, ` +
        `but it could not be loaded. Run ./build.sh to refresh ` +
        `wasm_activation/pkg from the pinned core revision.`,
    );
  }
  return ctor;
}

/** Build a `CompiledNetwork` from a creature for a single export call. */
function compileForExport(
  creature: Creature,
  caller: string,
  resolver: CompiledNetworkClassResolver,
  method: "to_dot" | "to_topology_json",
): { network: WasmCompiledNetwork; numOutputs: number } {
  const ctor = requireCompiledNetworkClass(resolver, caller);
  // Surface a clear error when the pinned NEAT-AI-core rev predates PR #32
  // (which added the topology export bindings). Without this guard callers
  // would get an unhelpful "X.to_dot is not a function" error.
  const proto = ctor.prototype as Record<string, unknown>;
  if (typeof proto[method] !== "function") {
    throw new Error(
      `WasmTopologyExport.${caller} requires NEAT-AI-core PR #32 ` +
        `(CompiledNetwork.${method}). The current pinned core revision does ` +
        `not expose this binding. Bump deno.json neatCore.rev to a release ` +
        `that includes topology_export.rs and re-run ./build.sh.`,
    );
  }
  const topo = creature.buildTypedTopology();
  const compiled: CompiledCreatureData = {
    data: topo.toWasmBinary(),
    numNeurons: topo.numNeurons,
    numInputs: topo.numInputs,
    numOutputs: topo.numOutputs,
    numSynapses: topo.numSynapses,
  };
  const network = new ctor(compiled.data);
  return { network, numOutputs: compiled.numOutputs };
}

/**
 * Topology JSON record for a single neuron, mirroring the shape produced by
 * NEAT-AI-core's `to_topology_json` formatter.
 */
export interface TopologyExportNode {
  /** Absolute neuron index in the compiled network. */
  index: number;
  /** Classification: `input`, `hidden`, `output`, or `constant`. */
  kind: "input" | "hidden" | "output" | "constant";
  /** Bias value (omitted for input neurons). */
  bias?: number;
  /** Squash (activation) function name (omitted for input neurons). */
  squash?: string;
}

/** Topology JSON record for a single synapse. */
export interface TopologyExportSynapse {
  from: number;
  to: number;
  weight: number;
  type: "Standard" | "Condition" | "Negative" | "Positive";
}

/**
 * Parsed shape of the JSON returned by `exportTopologyJson`.
 *
 * Field names are snake_case to match the Rust serialiser exactly so the
 * shape round-trips through JSON without re-keying.
 */
export interface TopologyExportJson {
  // deno-lint-ignore camelcase
  num_inputs: number;
  // deno-lint-ignore camelcase
  num_outputs: number;
  // deno-lint-ignore camelcase
  num_neurons: number;
  nodes: TopologyExportNode[];
  synapses: TopologyExportSynapse[];
}

/**
 * Export the creature's topology as a Graphviz DOT string.
 *
 * Delegates entirely to the core `to_dot(network, num_outputs)` binding;
 * no TS-side formatting.
 *
 * @param creature - source creature.
 * @param resolver - optional injection point that returns the WASM
 *   `CompiledNetwork` class. Defaults to the live module loader; tests
 *   pass `() => null` to exercise the missing-WASM error path.
 */
export function exportTopologyDot(
  creature: Creature,
  resolver: CompiledNetworkClassResolver = getCompiledNetworkClass,
): string {
  const { network, numOutputs } = compileForExport(
    creature,
    "exportTopologyDot",
    resolver,
    "to_dot",
  );
  try {
    return network.to_dot(numOutputs);
  } finally {
    try {
      network.free();
    } catch (_e) {
      // Ignore free errors — see WasmActivation.free for the same pattern.
    }
  }
}

/**
 * Export the creature's topology as a structured JSON object.
 *
 * Delegates to the core `to_topology_json(network, num_outputs)` binding and
 * returns the parsed object so callers do not have to re-parse the string.
 *
 * @param creature - source creature.
 * @param resolver - optional injection point; see {@link exportTopologyDot}.
 */
export function exportTopologyJson(
  creature: Creature,
  resolver: CompiledNetworkClassResolver = getCompiledNetworkClass,
): TopologyExportJson {
  const { network, numOutputs } = compileForExport(
    creature,
    "exportTopologyJson",
    resolver,
    "to_topology_json",
  );
  try {
    const raw = network.to_topology_json(numOutputs);
    return JSON.parse(raw) as TopologyExportJson;
  } finally {
    try {
      network.free();
    } catch (_e) {
      // Ignore free errors.
    }
  }
}
