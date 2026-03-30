/**
 * TrainingEventEmitter.ts - Safe, fire-and-forget event emission.
 *
 * Issue #1615: Provides a helper to emit structured training lifecycle
 * events via the optional callback. Exceptions thrown by the callback
 * are silently caught to avoid disrupting the training loop.
 */

import type {
  TrainingEvent,
  TrainingEventCallback,
} from "@config/TrainingEvent.ts";
import { getLogger } from "@utils/Logger.ts";

/**
 * Safely emits a training event to the callback.
 *
 * If the callback is undefined, this is a no-op (zero cost).
 * If the callback throws, the exception is caught and logged
 * at debug level to avoid disrupting the training loop.
 */
export function emitTrainingEvent(
  callback: TrainingEventCallback | undefined,
  event: TrainingEvent,
): void {
  if (!callback) return;
  try {
    callback(event);
  } catch (err) {
    getLogger().debug(
      `[TrainingEvent] Callback threw for '${event.kind}':`,
      err,
    );
  }
}
