/**
 * Transfer Learning Module
 *
 * Issue #1861: Provides foundational transfer learning support for NEAT-AI:
 * - Checkpoint export/import for reusing trained creatures across tasks
 * - UUID mapping for different input/output configurations
 * - Weight freezing for fine-tuning imported creatures
 * - Population seeding with pre-trained creatures
 */

export type {
  CheckpointInterface,
  CheckpointMetadata,
} from "@transfer/CheckpointInterface.ts";

export { exportCheckpoint, importCheckpoint } from "@transfer/Checkpoint.ts";

export type {
  CheckpointExportOptions,
  CheckpointImportOptions,
} from "@transfer/Checkpoint.ts";

export { createSeededPopulation } from "@transfer/PopulationSeeding.ts";

export type { PopulationSeedingOptions } from "@transfer/PopulationSeeding.ts";

/**
 * DNA-sharing strategy interface and bake-off harness (Issue #2491).
 *
 * Each candidate primitive (knob tuning, sub-graph graft, distillation,
 * pruning template) implements `DnaSharingStrategy`. The bake-off harness
 * (`bench/DnaSharingBakeOff.ts`) measures every strategy against the same
 * probe dataset, generation budget, and seed.
 */
export type {
  DnaSharingPrepareOptions,
  DnaSharingStrategy,
} from "@transfer/DnaSharingStrategy.ts";
export { NoOpStrategy } from "@transfer/NoOpStrategy.ts";
export {
  countSharedHiddenUuids,
  formatBakeOffMarkdown,
  runBakeOff,
  scoreOnProbe,
} from "@transfer/DnaSharingBakeOff.ts";
export type {
  BakeOffOptions,
  BakeOffRow,
  EvolveStep,
} from "@transfer/DnaSharingBakeOff.ts";
