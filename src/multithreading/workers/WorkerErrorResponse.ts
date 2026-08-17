/**
 * Build a worker {@link ResponseData} for a failed task (Issue #3780 / #1761).
 *
 * Preserves the real error on `error`. Does **not** fabricate a blank
 * `train.creature` with `input: 0` / `error: Infinity` — that previously
 * caused `Creature.fromJSON` to throw a secondary ValidationError that masked
 * the root cause.
 */

import type {
  RequestData,
  ResponseData,
} from "@multithreading/workers/WorkerHandler.ts";
import { toError, toErrorMessage } from "@utils/ErrorSerialisation.ts";

/**
 * Construct an error {@link ResponseData} for the given request.
 */
export function buildWorkerErrorResponse(
  data: RequestData,
  error: unknown,
  durationMs: number,
): ResponseData {
  const err = toError(error);
  const errorResponse: ResponseData = {
    taskID: data.taskID,
    duration: durationMs,
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
    },
  };

  if (data.evaluate) {
    errorResponse.evaluate = {
      error: Number.POSITIVE_INFINITY,
    };
  } else if (data.train) {
    // Issue #3780: leave `train` unset. Callers must honour `error` and must
    // not attempt to load a fabricated creature export.
  } else if (data.discover) {
    errorResponse.discover = {
      ID: "error",
    };
  } else if (data.echo) {
    errorResponse.echo = {
      message: `Error: ${toErrorMessage(error)}`,
    };
  } else if (data.configureCache) {
    errorResponse.configureCache = {
      status: `ERROR: ${toErrorMessage(error)}`,
    };
  } else if (data.requestCacheStats) {
    errorResponse.cacheStats = {
      activationCacheCount: 0,
      activationCacheMax: 0,
      compilationCacheSize: 0,
      compilationCacheMax: 0,
    };
  } else if (data.initialize) {
    errorResponse.initialize = {
      status: "ERROR",
      error: toErrorMessage(error),
    };
  } else if (data.breed) {
    errorResponse.breed = {
      success: false,
    };
  }

  return errorResponse;
}
