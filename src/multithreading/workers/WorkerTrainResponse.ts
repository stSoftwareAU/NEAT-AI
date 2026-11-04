/**
 * Builds the `train` payload of a worker response (Issue #4119).
 *
 * The deadline fields (`timedOut`, `bestMeasure`) are copied only when the
 * trainer set them. A deadline-capable native run sets both; the TypeScript
 * loop and legacy engines set neither, and their responses must keep exactly
 * their old shape. Structured clone keeps a key whose value is `undefined`, so
 * the keys are omitted rather than assigned as `undefined`.
 */

import type { TrainingResult } from "@architecture/training/TrainingTypes.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { ResponseData } from "@multithreading/workers/WorkerHandler.ts";

export function buildTrainResponseBody(
  result: TrainingResult,
  creature: CreatureExport,
): NonNullable<ResponseData["train"]> {
  const body: NonNullable<ResponseData["train"]> = {
    ID: result.ID,
    creature,
    error: result.error,
    trace: result.trace,
    compact: result.compact,
  };
  if (result.timedOut !== undefined) body.timedOut = result.timedOut;
  if (result.bestMeasure !== undefined) body.bestMeasure = result.bestMeasure;
  return body;
}
