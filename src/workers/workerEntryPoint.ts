/**
 * Shared worker entry point infrastructure.
 *
 * Provides the common message-handling loop, init timeout, and error
 * handling used by both multithreading and intelligentDesign deno/worker.ts
 * entry points.
 *
 * Issue #1600: Extracted as single source of truth for worker entry points.
 *
 * @module
 */

import type {
  BaseRequestData,
  BaseResponseData,
} from "@workers/WorkerInterface.ts";
import { getInitTimeoutMs } from "@workers/WorkerHandlerBase.ts";

/**
 * A processor that can handle worker requests.
 */
interface WorkerProcessor<
  TRequest extends BaseRequestData,
  TResponse extends BaseResponseData,
> {
  process(data: TRequest): Promise<TResponse>;
}

/**
 * Typed handle for the Deno Worker global scope.
 */
interface WorkerSelf<
  TRequest extends BaseRequestData,
  TResponse extends BaseResponseData,
> {
  onmessage: ((message: { data: TRequest }) => void) | null;
  postMessage: (data: TResponse) => void;
}

/**
 * Sets up the standard worker message loop.
 *
 * Handles:
 * - Init timeout (configurable via NEAT_AI_WORKER_INIT_TIMEOUT_MS)
 * - Routing messages to the processor
 * - Error handling via a caller-supplied error response builder
 *
 * @param processor - The domain-specific WorkerProcessor
 * @param buildErrorResponse - Creates a domain-appropriate error response
 */
export function setupWorkerMessageLoop<
  TRequest extends BaseRequestData & { initialize?: unknown },
  TResponse extends BaseResponseData,
>(
  processor: WorkerProcessor<TRequest, TResponse>,
  buildErrorResponse: (
    data: TRequest,
    error: unknown,
    durationMs: number,
  ) => TResponse,
): void {
  const INIT_TIMEOUT_MS = getInitTimeoutMs();
  const workerSelf = self as unknown as WorkerSelf<TRequest, TResponse>;

  workerSelf.onmessage = async function (message: { data: TRequest }) {
    const start = Date.now();
    try {
      let result: TResponse;
      if (message.data.initialize) {
        const timeoutPromise = new Promise<TResponse>((_, reject) => {
          setTimeout(
            () =>
              reject(
                new Error(
                  `Worker init timed out after ${
                    INIT_TIMEOUT_MS / 1000
                  }s (WASM may still be loading)`,
                ),
              ),
            INIT_TIMEOUT_MS,
          );
        });
        result = await Promise.race([
          processor.process(message.data),
          timeoutPromise,
        ]);
      } else {
        result = await processor.process(message.data);
      }
      workerSelf.postMessage(result);
    } catch (error) {
      workerSelf.postMessage(
        buildErrorResponse(message.data, error, Date.now() - start),
      );
    }
  };
}
