/**
 * Discovery Runner Type Definitions
 *
 * Interfaces and types for the DiscoveryRunner, including worker abstractions,
 * factory patterns, and result types.
 *
 * Extracted from DiscoveryRunner.ts as part of #1598.
 */

import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import type { DiscoverResult } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type { WasmCacheConfig } from "../config/WasmCacheConfig.ts";
import type { CostName } from "../Costs.ts";
import type { Creature } from "../Creature.ts";
import type { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import type { NeatOptions } from "../config/NeatOptions.ts";
import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";
import type { DiscoveryEvaluationSummary } from "./DiscoveryEvaluationSummary.ts";

export interface DiscoveryRunnerWorker {
  discover(
    creature: Creature,
    options: NeatOptions,
  ): Promise<Awaited<ReturnType<WorkerHandler["discover"]>>>;
  evaluate(
    creature: Creature,
    feedbackLoop: boolean,
  ): Promise<Awaited<ReturnType<WorkerHandler["evaluate"]>>>;
  terminate(): void;
  waitUntilReady?(): Promise<void>;
}

export interface DiscoveryRunnerWorkerFactoryArgs {
  dataDir: string;
  costName: CostName;
  direct: boolean;
  customCost?: { filePath: string };
  /** Issue #1567: WASM cache configuration to propagate to the worker. */
  wasmCache?: WasmCacheConfig;
}

export type DiscoveryRunnerWorkerFactory = (
  args: DiscoveryRunnerWorkerFactoryArgs,
) => DiscoveryRunnerWorker;

export interface DiscoveryRunnerDeps {
  workerFactory?: DiscoveryRunnerWorkerFactory;
  candidateBuilder?: (
    creature: Creature,
    discovery: DiscoverResult,
    options?: { skipCombinedCandidates?: boolean },
  ) => DiscoveryCandidate[];
  rustDiscoveryEnabled?: () => boolean;
}

export interface DiscoveryDirInput {
  creature: Creature;
  dataDir: string;
  options: NeatOptions;
}

export interface DiscoveryDirResult {
  discovery: DiscoverResult;
  original: {
    error: number;
    score: number;
  };
  improvement?: {
    changeType: string;
    error: number;
    score: number;
    scoreDelta: number;
    message: string;
    creature: CreatureExport;
  };
  evaluations?: DiscoveryEvaluationSummary[];
  candidateArchiveDir?: string;
  reScoringTime?: number; // Time spent re-scoring candidates (ms)
}

/**
 * Minimal interface for dependency injection in `Creature.discoveryDir()`.
 * Allows substituting the runner in tests without coupling to the full
 * DiscoveryRunner implementation.
 */
export type DiscoveryRunnerLike = {
  discoverDir(input: DiscoveryDirInput): Promise<DiscoveryDirResult>;
};
