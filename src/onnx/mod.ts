/**
 * ONNX export module for NEAT-AI creatures.
 *
 * Issue #1866: Provides functions to export trained creatures as ONNX
 * models for deployment in standard ML pipelines.
 *
 * @example
 * ```ts
 * import { Creature } from "@creature";
 * import { exportToOnnx, checkOnnxCompatibility } from "@onnx/mod.ts";
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

export { checkOnnxCompatibility, exportToOnnx } from "@onnx/OnnxExport.ts";

export type {
  OnnxCompatibilityResult,
  OnnxExportOptions,
} from "@onnx/OnnxExport.ts";

export {
  buildActivationNodes,
  isAggregateFunction,
  isSquashSupported,
} from "@onnx/ActivationMapping.ts";

export type { ActivationMapping } from "@onnx/ActivationMapping.ts";
