/**
 * Issue #2685 — Producer-step attribution for the WASM compile gate.
 *
 * The producer-side compile gate now threads a `producerStep` label so the
 * rejection diagnostic dump, the single-line warning, and the periodic
 * histogram all attribute a bad topology to the specific mutate operator
 * or breed sub-step that emitted it.
 *
 * These tests engineer a deterministic gate rejection via the existing
 * `__setProducerCompileGateProbeForTesting` seam and assert that:
 *
 *  - `runProducerCompileProbe` surfaces `producerStep` when a producer set
 *    one before invoking the gate.
 *  - `passesProducerCompileGate` includes `step=...` in its warning line
 *    and records the rejection in the histogram.
 *  - `Offspring.breed` and `Mutator.repairAfterMutation` include
 *    `producerStep` in their diagnostic dumps written to `.diagnostics/`.
 *  - The histogram is flushed as a sorted summary log line.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Creature } from "@creature";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import { Mutator } from "@neat/Mutator.ts";
import { Offspring } from "@architecture/Offspring.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import {
  createSeededRng,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import {
  __getProducerStepHistogramSnapshotForTesting,
  __resetProducerStepHistogramForTesting,
  __setProducerCompileGateProbeForTesting,
  __setProducerStepLogIntervalMsForTesting,
  flushProducerStepHistogram,
  getProducerStep,
  passesProducerCompileGate,
  type ProducerCompileResult,
  runProducerCompileProbe,
  setProducerStep,
  withProducerStep,
} from "@wasm/ProducerCompileGuard.ts";
import { getLogger, setLogger } from "@utils/Logger.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

const REJECT_PROBE = (): ProducerCompileResult => ({
  ok: false,
  trapMessage: "test-forced rejection (issue #2685)",
});

function captureLogs(): {
  warnings: string[];
  infos: string[];
  dispose: () => void;
} {
  const warnings: string[] = [];
  const infos: string[] = [];
  const previous = getLogger();
  setLogger({
    debug() {},
    info(...args: unknown[]) {
      infos.push(args.map((a) => String(a)).join(" "));
    },
    warn(...args: unknown[]) {
      warnings.push(args.map((a) => String(a)).join(" "));
    },
    error(...args: unknown[]) {
      warnings.push(args.map((a) => String(a)).join(" "));
    },
  });
  return {
    warnings,
    infos,
    dispose() {
      setLogger(previous);
    },
  };
}

function buildHealthyCreature(): Creature {
  const c = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });
  c.fix();
  return c;
}

/**
 * Mirrors `buildBreedingParent` from ProducerGateDiagnosticDumps.ts — two
 * differently-seeded parents combine via Offspring.breed to produce a child
 * whose UUID differs from both parents, so the breed reaches the gate.
 */
function buildBreedingParent(seed: number): Creature {
  setRandomNumberGenerator(createSeededRng(seed));
  const c = new Creature(4, 2);
  c.fix();
  const op = new AddNeuron(c);
  for (let i = 0; i < 5; i++) op.mutate();
  c.fix();
  delete c.uuid;
  CreatureUtil.makeUUID(c);
  return c;
}

/**
 * Read the latest `context-` file emitted by `writeDiagnostics`. The
 * diagnostic dump for a producer-gate rejection always includes a
 * `context-*.json` file. We just return its parsed JSON.
 */
function readLatestDiagnosticContext(
  prefix: string,
): Record<string, unknown> | undefined {
  let latest: { name: string; mtime: number } | undefined;
  try {
    for (const entry of Deno.readDirSync(".diagnostics")) {
      if (!entry.isFile) continue;
      if (!entry.name.startsWith(prefix)) continue;
      if (!entry.name.includes("context-")) continue;
      const stat = Deno.statSync(`.diagnostics/${entry.name}`);
      const mtime = stat.mtime?.getTime() ?? 0;
      if (latest === undefined || mtime > latest.mtime) {
        latest = { name: entry.name, mtime };
      }
    }
  } catch {
    return undefined;
  }
  if (!latest) return undefined;
  try {
    return JSON.parse(
      Deno.readTextFileSync(`.diagnostics/${latest.name}`),
    ) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

Deno.test(
  "Issue #2685: setProducerStep / getProducerStep round-trip and withProducerStep restores the previous label",
  () => {
    setProducerStep(undefined);
    assertEquals(getProducerStep(), undefined);
    setProducerStep("Outer");
    assertEquals(getProducerStep(), "Outer");
    const result = withProducerStep("Inner", () => {
      assertEquals(getProducerStep(), "Inner");
      return 42;
    });
    assertEquals(result, 42);
    assertEquals(getProducerStep(), "Outer");
    setProducerStep(undefined);
  },
);

Deno.test(
  "Issue #2685: runProducerCompileProbe surfaces the active producerStep on rejection",
  async () => {
    await initWasmForTests();
    const restore = __setProducerCompileGateProbeForTesting(REJECT_PROBE);
    setProducerStep("AddNeuron.split");
    try {
      const healthy = buildHealthyCreature();
      const result = runProducerCompileProbe(healthy);
      assertEquals(result.ok, false);
      assertEquals(
        result.producerStep,
        "AddNeuron.split",
        "probe must surface the active producer step",
      );
    } finally {
      setProducerStep(undefined);
      restore();
    }
  },
);

Deno.test(
  "Issue #2685: passesProducerCompileGate warns with step=... and records a histogram entry",
  async () => {
    await initWasmForTests();
    __resetProducerStepHistogramForTesting();
    const restore = __setProducerCompileGateProbeForTesting(REJECT_PROBE);
    const capture = captureLogs();
    try {
      const healthy = buildHealthyCreature();
      const accepted = withProducerStep(
        "crisprInsertSubgraph",
        () => passesProducerCompileGate(healthy, "CRISPR"),
      );
      assertEquals(accepted, false);
      const warn = capture.warnings.find((w) =>
        w.includes("[CRISPR]") && w.includes("step=crisprInsertSubgraph")
      );
      assert(
        warn !== undefined,
        `expected warn line tagged with step, got: ${
          capture.warnings.join("\n")
        }`,
      );
      const hist = __getProducerStepHistogramSnapshotForTesting();
      assertEquals(hist.get("crisprInsertSubgraph"), 1);
    } finally {
      capture.dispose();
      restore();
      __resetProducerStepHistogramForTesting();
    }
  },
);

Deno.test(
  "Issue #2685: passesProducerCompileGate falls back to producer name in the histogram when no step is set",
  async () => {
    await initWasmForTests();
    __resetProducerStepHistogramForTesting();
    const restore = __setProducerCompileGateProbeForTesting(REJECT_PROBE);
    const capture = captureLogs();
    try {
      const healthy = buildHealthyCreature();
      setProducerStep(undefined);
      const accepted = passesProducerCompileGate(healthy, "Discovery/legacy");
      assertEquals(accepted, false);
      const hist = __getProducerStepHistogramSnapshotForTesting();
      assertEquals(hist.get("Discovery/legacy"), 1);
    } finally {
      capture.dispose();
      restore();
      __resetProducerStepHistogramForTesting();
    }
  },
);

Deno.test(
  "Issue #2685: flushProducerStepHistogram emits a single sorted info line then clears the histogram",
  async () => {
    await initWasmForTests();
    __resetProducerStepHistogramForTesting();
    const restore = __setProducerCompileGateProbeForTesting(REJECT_PROBE);
    // Set a very long interval so auto-flush never fires during the test;
    // we trigger the flush explicitly below to assert the sorted shape.
    const restoreInterval = __setProducerStepLogIntervalMsForTesting(
      60 * 60 * 1000,
    );
    const capture = captureLogs();
    try {
      const healthy = buildHealthyCreature();
      withProducerStep(
        "AddNeuron",
        () => passesProducerCompileGate(healthy, "Mutator"),
      );
      withProducerStep(
        "AddNeuron",
        () => passesProducerCompileGate(healthy, "Mutator"),
      );
      withProducerStep(
        "ModWeight",
        () => passesProducerCompileGate(healthy, "Mutator"),
      );
      flushProducerStepHistogram();
      const summary = capture.infos.find((i) =>
        i.includes("[ProducerCompileGate]") && i.includes("step rejects")
      );
      assert(
        summary !== undefined,
        `expected a summary info line, got: ${capture.infos.join("\n")}`,
      );
      assertStringIncludes(summary, "AddNeuron=2");
      assertStringIncludes(summary, "ModWeight=1");
      // Ensure AddNeuron appears before ModWeight (sorted by frequency).
      const idxAdd = summary.indexOf("AddNeuron=2");
      const idxMod = summary.indexOf("ModWeight=1");
      assert(idxAdd >= 0 && idxMod >= 0 && idxAdd < idxMod);
      const histAfter = __getProducerStepHistogramSnapshotForTesting();
      assertEquals(histAfter.size, 0, "flush must clear the histogram");
    } finally {
      capture.dispose();
      restoreInterval();
      restore();
      __resetProducerStepHistogramForTesting();
    }
  },
);

Deno.test(
  "Issue #2685: Offspring.breed diagnostic dump includes producerStep in the context block",
  async () => {
    await initWasmForTests();
    __resetProducerStepHistogramForTesting();
    const restore = __setProducerCompileGateProbeForTesting(REJECT_PROBE);
    const capture = captureLogs();
    try {
      // Use the same parent-building pattern as the diagnostic-dump test so
      // breed reaches the producer gate rather than short-circuiting at the
      // "child is a clone of a parent" guard.
      setRandomNumberGenerator(createSeededRng(20260601));
      const mum = buildBreedingParent(100);
      const dad = buildBreedingParent(999);
      setRandomNumberGenerator(createSeededRng(2));
      const child = Offspring.breed(mum, dad, { forwardOnly: true });
      assertEquals(
        child,
        undefined,
        "stub probe must surface as a drop in Offspring.breed",
      );
      const warn = capture.warnings.find((w) =>
        w.includes("[Offspring/breed]") && w.includes("step=")
      );
      assert(
        warn !== undefined,
        `expected Offspring/breed warn line with step=, got: ${
          capture.warnings.join("\n")
        }`,
      );
      const ctx = readLatestDiagnosticContext("offspring-wasm-compile-trap-");
      assert(
        ctx !== undefined,
        "expected a context-*.json diagnostic dump to exist",
      );
      assert(
        typeof ctx.producerStep === "string" && ctx.producerStep.length > 0,
        `expected producerStep in dump context, got: ${JSON.stringify(ctx)}`,
      );
    } finally {
      capture.dispose();
      restore();
      __resetProducerStepHistogramForTesting();
    }
  },
);

Deno.test(
  "Issue #2685: Mutator.repairAfterMutation diagnostic dump includes producerStep in the context block",
  async () => {
    await initWasmForTests();
    __resetProducerStepHistogramForTesting();
    const restore = __setProducerCompileGateProbeForTesting(REJECT_PROBE);
    // createNeatConfig() calls setLogger() with the default console logger,
    // so build the config first and install the capture logger after.
    const mutator = new Mutator(createNeatConfig({ populationSize: 10 }));
    const capture = captureLogs();
    try {
      const healthy = buildHealthyCreature();
      const ok = mutator.repairAfterMutation(healthy, {
        mutationName: "ADD_NODE",
      });
      assertEquals(ok, false, "stub probe must surface as a Mutator revert");
      const warn = capture.warnings.find((w) =>
        w.includes("[Mutator]") && w.includes("step=Mutator.ADD_NODE") &&
        w.includes("mutation=ADD_NODE")
      );
      assert(
        warn !== undefined,
        `expected Mutator warn line with step=Mutator.ADD_NODE, got: ${
          capture.warnings.join("\n")
        }`,
      );
      // Scope the read to this operator's dump prefix. Deno runs test files
      // concurrently, and the sibling ProducerGateDiagnosticDumps.ts test
      // writes `mutator-wasm-compile-trap-MOD_WEIGHT-*` dumps to the same
      // `.diagnostics/` directory. A broad `mutator-wasm-compile-trap-`
      // "latest by mtime" read could pick up that sibling dump and observe
      // its `Mutator.MOD_WEIGHT` step instead of ours — a cross-file race.
      const ctx = readLatestDiagnosticContext(
        "mutator-wasm-compile-trap-ADD_NODE-",
      );
      assert(
        ctx !== undefined,
        "expected a context-*.json diagnostic dump to exist",
      );
      assertEquals(ctx.producerStep, "Mutator.ADD_NODE");
    } finally {
      capture.dispose();
      restore();
      __resetProducerStepHistogramForTesting();
    }
  },
);
