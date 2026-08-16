/**
 * Tests for WorkerProcessor utility functions.
 *
 * Issue #1698: Validates buildDiscoverResponsePayload and
 * clearDiscoverResultForGC helper functions.
 */
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { Creature } from "@creature";
import { ValidationError } from "@errors/ValidationError.ts";
import {
  buildDiscoverResponsePayload,
  clearDiscoverResultForGC,
  persistDiscoverResultCheckpoint,
  selectRemovalCandidatesForWire,
  WorkerProcessor,
} from "@multithreading/workers/WorkerProcessor.ts";
import { useIsolatedDiagnosticsDir } from "../_diagnosticsDir.ts";
import type { DiscoverResult } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { join } from "@std/path";

function makeMinimalDiscoverResult(): DiscoverResult {
  return {
    ID: "test-discovery-123",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };
}

Deno.test("buildDiscoverResponsePayload: maps ID from result", () => {
  const result = makeMinimalDiscoverResult();
  const payload = buildDiscoverResponsePayload(result);
  assertEquals(payload.ID, "test-discovery-123");
});

Deno.test("buildDiscoverResponsePayload: omits undefined candidate arrays", () => {
  const result = makeMinimalDiscoverResult();
  const payload = buildDiscoverResponsePayload(result);

  assertEquals(payload.addHelpfulSynapses, undefined);
  assertEquals(payload.addHelpfulNeurons, undefined);
  assertEquals(payload.coordinatedStructuralCandidates, undefined);
  assertEquals(payload.removeHarmfulSynapse, undefined);
  assertEquals(payload.removeHarmfulNeurons, undefined);
  assertEquals(payload.removalCandidates, undefined);
  assertEquals(payload.candidateSquashes, undefined);
});

Deno.test("buildDiscoverResponsePayload: copies arrays to break reference sharing", () => {
  const result = makeMinimalDiscoverResult();
  const removalCandidates = [{
    neuronUuid: "hidden-1001",
    totalError: 0.5,
    impact: 0.001,
    reason: "low-impact",
  }];
  result.removalCandidates = removalCandidates;

  const payload = buildDiscoverResponsePayload(result);
  assertExists(payload.removalCandidates);
  assertEquals(payload.removalCandidates!.length, 1);
  assertEquals(payload.removalCandidates![0].neuronUuid, "hidden-1001");

  // Should be a new array (spread copy), not the same reference
  assertEquals(
    payload.removalCandidates !== removalCandidates,
    true,
    "should create a copy, not share reference",
  );
});

Deno.test(
  "buildDiscoverResponsePayload: caps removal candidates to lowest-impact wire budget (#3774)",
  () => {
    const result = makeMinimalDiscoverResult();
    result.removalCandidates = Array.from({ length: 200 }, (_, i) => ({
      neuronUuid: `hidden-${i}`,
      totalError: 1,
      impact: 1 - i / 1000, // higher index → lower impact
      reason: "low-impact",
    }));

    const payload = buildDiscoverResponsePayload(result, {
      removalCandidateCap: 10,
      resultCheckpointPath: ".discovery/test/worker-result-checkpoint.json",
    });

    assertExists(payload.removalCandidates);
    assertEquals(payload.removalCandidates!.length, 10);
    assertEquals(payload.removalCandidatesTotal, 200);
    assertEquals(
      payload.resultCheckpointPath,
      ".discovery/test/worker-result-checkpoint.json",
    );
    // Lowest-impact first: last of the synthetic series.
    assertEquals(payload.removalCandidates![0].neuronUuid, "hidden-199");
    assertEquals(payload.removalCandidates![9].neuronUuid, "hidden-190");
  },
);

Deno.test(
  "selectRemovalCandidatesForWire: keeps all when under the cap (#3774)",
  () => {
    const candidates = [
      { neuronUuid: "a", totalError: 1, impact: 0.2, reason: "x" },
      { neuronUuid: "b", totalError: 1, impact: 0.1, reason: "x" },
    ];
    const { selected, total } = selectRemovalCandidatesForWire(candidates, 10);
    assertEquals(total, 2);
    assertEquals(selected.length, 2);
    assertEquals(selected[0].neuronUuid, "a");
  },
);

Deno.test(
  "persistDiscoverResultCheckpoint: writes recoverable JSON before wire return (#3774)",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "neat-discover-checkpoint-" });
    try {
      const result = makeMinimalDiscoverResult();
      result.removalCandidates = Array.from({ length: 5 }, (_, i) => ({
        neuronUuid: `n-${i}`,
        totalError: 1,
        impact: i,
        reason: "low-impact",
      }));
      const path = join(dir, result.ID, "worker-result-checkpoint.json");
      await persistDiscoverResultCheckpoint(result, path);
      const roundTrip = JSON.parse(await Deno.readTextFile(path));
      assertEquals(roundTrip.ID, result.ID);
      assertEquals(roundTrip.removalCandidates.length, 5);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);
Deno.test("clearDiscoverResultForGC: nullifies populated arrays", () => {
  const result: DiscoverResult = {
    ID: "test",
    addHelpfulSynapses: [],
    addHelpfulNeurons: [],
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: [],
    removalCandidates: [],
    candidateSquashes: [],
  };

  clearDiscoverResultForGC(result);

  // After clearing, the arrays should be nullified (not undefined)
  // deno-lint-ignore no-explicit-any
  const r = result as any;
  assertEquals(r.addHelpfulSynapses, null);
  assertEquals(r.addHelpfulNeurons, null);
  assertEquals(r.removeHarmfulNeurons, null);
  assertEquals(r.removalCandidates, null);
  assertEquals(r.candidateSquashes, null);
});

Deno.test("clearDiscoverResultForGC: skips undefined arrays safely", () => {
  const result = makeMinimalDiscoverResult();
  // Should not throw when arrays are undefined
  clearDiscoverResultForGC(result);
  assertEquals(result.ID, "test-discovery-123");
});

// ============================================================================
// Issue #2737: heapAbortedAtExtensionBoundary signalling
// ============================================================================

Deno.test(
  "buildDiscoverResponsePayload: propagates heapAbortedAtExtensionBoundary=true",
  () => {
    const result = makeMinimalDiscoverResult();
    result.heapAbortedAtExtensionBoundary = true;

    const payload = buildDiscoverResponsePayload(result);
    assertEquals(payload.heapAbortedAtExtensionBoundary, true);
  },
);

Deno.test(
  "buildDiscoverResponsePayload: leaves heapAbortedAtExtensionBoundary undefined for happy-path results",
  () => {
    const result = makeMinimalDiscoverResult();
    const payload = buildDiscoverResponsePayload(result);
    assertEquals(payload.heapAbortedAtExtensionBoundary, undefined);
  },
);

Deno.test(
  "buildDiscoverResponsePayload: propagates heapAbortedAtExtensionBoundary=false",
  () => {
    const result = makeMinimalDiscoverResult();
    result.heapAbortedAtExtensionBoundary = false;

    const payload = buildDiscoverResponsePayload(result);
    assertEquals(payload.heapAbortedAtExtensionBoundary, false);
  },
);

/**
 * Issue #3685: the custom-cost specifier reaches `await import()`, so a
 * config value sourced from a remote manifest must not be able to execute
 * remote code inside the worker.
 */
Deno.test("WorkerProcessor: rejects a remote custom cost specifier before import", async () => {
  const processor = new WorkerProcessor();

  const attempts = [
    "https://evil.example/cost.ts",
    "http://evil.example/cost.ts",
    "data:text/javascript,export default class {}",
  ].map((filePath, index) =>
    assertRejects(
      () =>
        processor.process({
          taskID: index + 1,
          initialize: {
            dataSetDir: ".test/does-not-matter",
            costName: "MSE",
            customCostData: JSON.stringify({ filePath }),
          },
        }),
      ValidationError,
    )
  );

  for (const error of await Promise.all(attempts)) {
    assertStringIncludes(error.message, "custom cost function");
  }
});

Deno.test("WorkerProcessor: a relative custom cost specifier passes the guard", async () => {
  const processor = new WorkerProcessor();

  // The path does not exist, so `import()` fails — but the failure is the
  // load error, not the scheme guard, proving a local specifier is accepted.
  const error = await assertRejects(
    () =>
      processor.process({
        taskID: 2,
        initialize: {
          dataSetDir: ".test/does-not-matter",
          costName: "MSE",
          customCostData: JSON.stringify({
            filePath: "./no/such/CustomCost.ts",
          }),
        },
      }),
    Error,
  );
  assertEquals(error instanceof ValidationError, false);
  assertStringIncludes(error.message, "Failed to load custom cost function");
});

Deno.test("WorkerProcessor: evaluate errors do not dump diagnostics", async () => {
  const diagnostics = useIsolatedDiagnosticsDir("evaluate-no-dump");
  const dataSetDir = await Deno.makeTempDir({
    prefix: "neat-evaluate-no-dump-",
  });
  try {
    const processor = new WorkerProcessor();
    await processor.process({
      taskID: 1,
      initialize: {
        dataSetDir,
        costName: "MSE",
      },
    });

    await assertRejects(() =>
      processor.process({
        taskID: 2,
        evaluate: {
          creature: new Creature(1, 1).exportJSON(),
          feedbackLoop: false,
        },
      })
    );

    const dumped = (await Array.fromAsync(Deno.readDir(diagnostics.dir))).map(
      (entry) => entry.name,
    );
    assertEquals(
      dumped.filter((name) => name.startsWith("evaluate-")),
      [],
      "evaluate failures must not write diagnostic dumps",
    );
  } finally {
    diagnostics.dispose();
    await Deno.remove(dataSetDir, { recursive: true });
  }
});
