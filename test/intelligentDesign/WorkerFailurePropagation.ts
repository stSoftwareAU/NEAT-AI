import { assertEquals } from "@std/assert";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { scanForSquashImprovements } from "../../src/intelligentDesign/ImproveSquash.ts";

/**
 * Regression coverage: Worker failures (or missing responses) must never cause
 * Intelligent Design scans to hang forever.
 *
 * Historically, `scanForSquashImprovements()` only checked `timeoutMs` at the top
 * of the main loop. If a worker task never settled (eg. the worker threw before
 * posting a message), the final `await Promise.all(workerTasksSet)` could block
 * indefinitely.
 */
Deno.test(
  "scanForSquashImprovements: does not hang when a worker never responds (final await is timeout-protected)",
  async () => {
    const testCreatureJson: CreatureInternal = {
      neurons: [
        { type: "input", squash: "LOGISTIC", index: 0 },
        { type: "input", squash: "LOGISTIC", index: 1 },
        {
          type: "hidden",
          squash: "TANH",
          index: 2,
          bias: 0,
          uuid: "neuron-hidden-1",
        },
        { type: "output", squash: "LOGISTIC", index: 3, bias: 0 },
      ],
      synapses: [
        { from: 0, to: 2, weight: 0.5 },
        { from: 1, to: 2, weight: 0.5 },
        { from: 2, to: 3, weight: 0.5 },
      ],
      input: 2,
      output: 1,
    };

    const never = new Promise<never>(() => {});

    const result = await scanForSquashImprovements({
      creature: Creature.fromJSON(testCreatureJson).exportJSON(),
      targetSquash: "GELU",
      outputDir: ".test-intelligent-design-output",
      dataDir: ".test-intelligent-design-data",
      bestScore: 0,
      cpuCount: 1,
      maxPending: 1,
      timeoutMs: 150,
      createWorker: () => ({
        score: () => never,
        terminate: () => {},
      }),
    });

    assertEquals(result.timedOut, true);
    assertEquals(result.improvements.size, 0);
  },
);
