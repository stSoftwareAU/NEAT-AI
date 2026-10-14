/**
 * Worker entry for the off-thread first-generation watchdog (Issue #4060).
 * See `FirstGenerationWatchdog.ts`. Receives one request, then polls its own
 * clock and SIGKILLs the process once the bound plus slack has passed.
 */

import { getLogger } from "@utils/Logger.ts";
import {
  type FirstGenerationWatchdogRequest,
  pollFirstGenerationWatchdog,
} from "./FirstGenerationWatchdog.ts";

const workerSelf = self as unknown as {
  onmessage: ((e: MessageEvent<FirstGenerationWatchdogRequest>) => void) | null;
};

workerSelf.onmessage = (e) => {
  pollFirstGenerationWatchdog(e.data, {
    log: (line) => getLogger().error(line),
  });
};
