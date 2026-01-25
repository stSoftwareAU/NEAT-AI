/**
 * Integration coverage for the Deno worker entry point used by Intelligent Design.
 *
 * We deliberately trigger the worker's error path by sending an invalid request
 * (missing `score`). This exercises:
 * - `src/intelligentDesign/workers/deno/worker.ts` (try/catch wrapper)
 * - `WorkerHandler`'s callback plumbing and idle notification
 */

import { assertEquals, assertExists } from "@std/assert";
import { WorkerHandler } from "../../src/intelligentDesign/workers/WorkerHandler.ts";
import type { ResponseData } from "../../src/intelligentDesign/workers/ResponseData.ts";

Deno.test("WorkerHandler resolves error response for invalid request and becomes idle", async () => {
  const handler = new WorkerHandler();
  try {
    // Wait for initialization to complete before testing
    await (handler as unknown as { ready: Promise<ResponseData> }).ready;

    let idleCount = 0;
    handler.addIdleListener(() => idleCount++);

    // Use internal `makePromise()` so we can send a malformed message but still
    // satisfy `WorkerHandler`'s callback bookkeeping.
    const result = await (handler as unknown as {
      makePromise: (data: { taskID: number }) => Promise<ResponseData>;
    }).makePromise({ taskID: 999 });

    assertEquals(result.taskID, 999);
    assertExists(result.error);
    assertExists(result.error.message);
    assertEquals(typeof result.duration, "number");
    assertEquals(handler.isBusy(), false);
    assertEquals(idleCount, 1);
  } finally {
    handler.terminate();
  }
});
