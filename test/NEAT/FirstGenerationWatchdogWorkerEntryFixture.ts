/**
 * Child-process fixture for `FirstGenerationWatchdogWorkerEntry_test.ts`
 * (Issue #4060). Installs a custom log sink, loads the watchdog worker entry
 * in this isolate, and hands its `onmessage` a request that is already
 * overdue. The entry must log through `getLogger()` and then SIGKILL this
 * process.
 */
import { setLogger } from "@utils/Logger.ts";
import { firstGenerationWatchdogRequest } from "../../src/NEAT/FirstGenerationWatchdog.ts";
import "../../src/NEAT/FirstGenerationWatchdogWorker.ts";

setLogger({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: (...a) => console.log("CUSTOM-SINK: " + a.join(" ")),
});

const now = Date.now();
const onmessage = (self as unknown as {
  onmessage: ((e: { data: unknown }) => void) | null;
}).onmessage;
if (!onmessage) throw new Error("worker entry did not install onmessage");
onmessage({ data: firstGenerationWatchdogRequest(now - 100_000, now - 1, 0) });
// Keep the event loop alive until the watchdog's poll fires and kills us.
setInterval(() => {}, 1_000);
