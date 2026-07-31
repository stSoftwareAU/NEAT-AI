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
 * Each candidate primitive (sub-graph graft, distillation, pruning template)
 * implements `DnaSharingStrategy`. The bake-off harness
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

/**
 * Compact sub-graph graft primitive (Issue #2493).
 *
 * Detects dense, high-activation modules in a small donor (Europa-style)
 * and grafts them into a larger sparser recipient (production-style) at
 * periodic import time. Donor neuron UUIDs are preserved verbatim so
 * subsequent breeding can re-align by UUID.
 */
export {
  compactModuleGraft,
  CompactModuleGraftStrategy,
  detectDenseModules,
  scoreModulesByActivation,
} from "@transfer/CompactModuleGraft.ts";
export type {
  CompactModuleGraftOptions,
  DenseModule,
  DenseModuleDetectionOptions,
} from "@transfer/CompactModuleGraft.ts";

/**
 * Knowledge distillation primitive (Issue #2494).
 *
 * Treats Europa as a teacher network and adds a small new student pathway
 * in the production recipient, trained to imitate the teacher's outputs on
 * the probe dataset. Pre-existing neuron `uuid`s and biases are unchanged
 * (AGENTS.md UUID stability invariant) — only the new student pathway
 * trains.
 */
export {
  addStudentPathway,
  captureTeacherActivations,
  knowledgeDistillation,
  KnowledgeDistillationStrategy,
  trainStudentPathway,
} from "@transfer/KnowledgeDistillation.ts";
export type {
  KnowledgeDistillationOptions,
  TeacherCapture,
} from "@transfer/KnowledgeDistillation.ts";

/**
 * Pruning template primitive (Issue #2495).
 *
 * Uses Europa as an oracle to identify production hidden neurons whose role
 * is already covered by Europa's smaller equivalent — those candidates are
 * removed validate-then-commit (only when removing them does not regress
 * the recipient's score on the probe dataset beyond a configurable
 * tolerance). Surviving recipient neurons keep their original `uuid` per
 * the AGENTS.md UUID stability invariant. Europa is *not* mutated.
 */
export {
  buildActivationFingerprints,
  findRedundantHiddenNeurons,
  fingerprintCorrelation,
  pruningTemplate,
  PruningTemplateStrategy,
} from "@transfer/PruningTemplate.ts";
export type {
  PruningTemplateOptions,
  PruningTemplateResult,
} from "@transfer/PruningTemplate.ts";

/**
 * Recommended DNA-sharing strategy from the bake-off (Issue #2496).
 *
 * After running the four primitives (#2492 – #2495) plus the `NoOpStrategy`
 * baseline through `bench/DnaSharingBakeOff.ts` across seeds 1, 7, and 42,
 * `PruningTemplateStrategy` was the only primitive that produced a strictly
 * positive lift on every seed. The full result table lives in
 * `docs/dna-sharing-bake-off-results.md`.
 *
 * The knob-tuning primitive (#2492) has since been retired (#3554): it
 * produced zero lift, and no consumer ever set the `dnaSharingMode` option it
 * stamped. Operators who want the winning primitive should invoke
 * `PruningTemplateStrategy` explicitly.
 */
export const recommendedDnaSharingStrategy = "PruningTemplate" as const;
