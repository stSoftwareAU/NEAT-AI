// Child process for the worker relay wiring test (Issue #4146).
//
// Runs one real training task through a real `WorkerHandler` (the production
// `deno/worker.ts` isolate) and prints, as JSON on stdout, every line the
// PARENT's logger received. The parent test starts this with
// `NEAT_AI_BACKPROP_ENABLED=0` so the task takes the TypeScript loop and needs
// no native library; the worker inherits that environment.
import { Creature } from "@creature";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { type Logger, setLogger } from "@utils/Logger.ts";

/** Write XOR-shaped records (2 inputs, 1 output, Float32) to a binary file. */
function writeXorDataset(path: string, samples: number): void {
  const buffer = new Uint8Array(3 * 4 * samples);
  const view = new Float32Array(buffer.buffer);
  for (let i = 0; i < samples; i++) {
    const a = i & 1;
    const b = (i >> 1) & 1;
    view[i * 3] = a;
    view[i * 3 + 1] = b;
    view[i * 3 + 2] = a ^ b;
  }
  Deno.writeFileSync(path, buffer);
}

if (import.meta.main) {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };
  const capture: Logger = {
    debug: () => {},
    info: record,
    warn: record,
    error: record,
  };
  setLogger(capture);

  const dir = Deno.makeTempDirSync({ prefix: "train-relay-wiring-" });
  let handler: WorkerHandler | undefined;
  try {
    writeXorDataset(`${dir}/xor.bin`, 8);
    // `direct = false`: the real `deno/worker.ts` isolate, not the in-process
    // mock, so the relay install in the worker entry is what is exercised.
    handler = new WorkerHandler(dir, "MSE", false);
    const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
    await handler.train(creature, {
      iterations: 2,
      targetError: 0.01,
      disableRandomSamples: true,
    });
  } finally {
    handler?.terminate();
    Deno.removeSync(dir, { recursive: true });
  }
  console.log(`PARENT_LOG_LINES=${JSON.stringify(lines)}`);
  Deno.exit(0);
}
