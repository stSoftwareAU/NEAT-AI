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
