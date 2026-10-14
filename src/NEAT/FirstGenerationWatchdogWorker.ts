/**
 * Worker entry for the off-thread first-generation watchdog (Issue #4060).
 * See `FirstGenerationWatchdog.ts`. Receives one request, then polls its own
 * clock and SIGKILLs the process once the bound plus slack has passed.
 */

import { getLogger } from "@utils/Logger.ts";
import {
  fireFirstGenerationWatchdog,
  type FirstGenerationWatchdogRequest,
  isFirstGenerationWatchdogDue,
} from "./FirstGenerationWatchdog.ts";

const workerSelf = self as unknown as {
  onmessage: ((e: MessageEvent<FirstGenerationWatchdogRequest>) => void) | null;
};

workerSelf.onmessage = (e) => {
  const request = e.data;
  const pollId = setInterval(() => {
    const now = Date.now();
    if (isFirstGenerationWatchdogDue(now, request)) {
      clearInterval(pollId);
      fireFirstGenerationWatchdog(now, request, {
        log: (line) => getLogger().error(line),
        kill: () => Deno.kill(Deno.pid, "SIGKILL"),
      });
    }
  }, request.pollIntervalMS);
};
