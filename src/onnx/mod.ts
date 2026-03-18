/**
 * ONNX export module for NEAT-AI creatures.
 *
 * Issue #1866: Provides functions to export trained creatures as ONNX
 * models for deployment in standard ML pipelines.
 *
 * @example
 * ```ts
 * import { Creature } from "../Creature.ts";
 * import { exportToOnnx, checkOnnxCompatibility } from "./mod.ts";
 *
 * const creature = new Creature(2, 1, { layers: [{ count: 3, squash: "TANH" }] });
 * // ... train the creature ...
 *
 * const compat = checkOnnxCompatibility(creature);
 * if (compat.compatible) {
 *   const onnxBytes = exportToOnnx(creature);
 *   Deno.writeFileSync("model.onnx", onnxBytes);
 * }
 * ```
 */

export { checkOnnxCompatibility, exportToOnnx } from "./OnnxExport.ts";

export type {
  OnnxCompatibilityResult,
  OnnxExportOptions,
} from "./OnnxExport.ts";

export {
  buildActivationNodes,
  isAggregateFunction,
  isSquashSupported,
} from "./ActivationMapping.ts";

export type { ActivationMapping } from "./ActivationMapping.ts";
