import { assertEquals } from "@std/assert";
import type { WorkerHandler } from "../../src/multithreading/workers/WorkerHandler.ts";
import { Creature } from "../../src/Creature.ts";
import { evaluateAll } from "../../src/discovery/DiscoveryReplayRunner.ts";

Deno.test("DiscoveryReplayRunner.evaluateAll: distributes evaluation across workers", async () => {
  const makeWorker = (error: number) =>
    ({
      evaluate: (_creature: Creature, _feedbackLoop: boolean) =>
        Promise.resolve({ taskID: 1, duration: 0, evaluate: { error } }),
    }) as unknown as WorkerHandler;

  const workers = [makeWorker(0.1), makeWorker(0.2)];

  const baseCreature = Creature.fromJSON({
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [{
      uuid: "output-0",
      type: "output",
      squash: "IDENTITY",
      bias: 0,
    }],
    synapses: [{ fromUUID: "input-0", toUUID: "output-0", weight: 0.1 }],
  });

  const tasks = [
    { kind: "single" as const, creature: baseCreature },
    { kind: "single" as const, creature: baseCreature },
    { kind: "single" as const, creature: baseCreature },
  ];

  const results = await evaluateAll(workers, tasks, false, 0);

  // We don't care which worker took which task; we just want all tasks evaluated.
  assertEquals(results.length, 3);
  assertEquals(
    results.map((r) => r.error).sort(),
    [0.1, 0.1, 0.2].sort(),
  );
});
