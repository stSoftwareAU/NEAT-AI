/**
 * Creature module - focused submodules extracted from Creature.ts.
 *
 * Issue #1409: Extract Creature.ts (3,069 lines) into focused modules.
 *
 * Each module handles a single responsibility:
 * - CreatureActivation.ts  - Forward pass and WASM activation
 * - CreatureTopology.ts    - Neuron/synapse management, connection queries
 * - CreatureTraining.ts    - Training orchestration, evolution, scoring
 * - CreatureSerialization.ts - JSON import/export, cloning
 * - CreatureMutation.ts    - Network structure repair, random connections
 */

export {
  activateAndTraceWasm,
  activateWasm,
  disposeWasm,
  evaluateDir,
  getUnsupportedWasmSquashFunctions,
  isWasmEligible,
  requireWasmOrThrow,
} from "./CreatureActivation.ts";

export {
  binarySearchSynapse,
  bulkLoadInwardConnections,
  findInsertionPoint,
  getAvailableConnections,
  getConnectionSet,
  getHiddenNeuronUUIDs,
  getSynapse,
  hasConnection,
  inFocus,
  INWARD_INDEX_BUILD_THRESHOLD,
  inwardConnections,
  isAvailableConnectionsCacheBuilt,
  isInwardIndexBuilt,
  outwardConnections,
  PREBUILD_SYNAPSE_THRESHOLD,
  prebuildInwardIndex,
  prebuildInwardIndexIfLarge,
  selfConnection,
} from "./CreatureTopology.ts";
export type { TopologyCaches } from "./CreatureTopology.ts";

export {
  applyLearnings,
  discoveryDir,
  discoveryReplayDir,
  evolveDataSet,
  evolveDir,
  propagate,
  propagateUpdate,
  record,
  scoreDir,
  traceDir,
} from "./CreatureTraining.ts";

export {
  exportJSON,
  fromJSON,
  loadFrom,
  shallowClone,
  traceJSON,
} from "./CreatureSerialization.ts";

export { fix, makeRandomConnection } from "./CreatureMutation.ts";
