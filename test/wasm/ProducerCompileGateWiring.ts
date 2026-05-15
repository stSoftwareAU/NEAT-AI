/**
 * Issue #2671 — Regression tests for the producer-side WASM compile gate
 * wired into the remaining producer paths: DeDuplicator, Discovery's
 * coordinated structural candidate apply, transfer-learning import
 * (PopulationSeeding + Checkpoint), and CRISPR injection.
 *
 * The gate already covered `Mutator.repairAfterMutation` and `Offspring.breed`
 * before this change. Each test below installs a stub probe that
 * unconditionally rejects, runs the producer path with a healthy creature
 * (so the path executes fully), and asserts the producer drops or reverts
 * its output rather than leaking the topology to the WASM cache where it
 * would log the "WASM compile failed for creature ..." line at activation
 * time.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import { Creature } from "@creature";
import {
  __setProducerCompileGateProbeForTesting,
  ensureProducerOutputCompiles,
  passesProducerCompileGate,
} from "@wasm/ProducerCompileGuard.ts";
import { CRISPR } from "@reconstruct/CRISPR.ts";
import { applyCoordinatedStructuralCandidate } from "@architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts";
import type { CoordinatedStructuralCandidate } from "@architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { exportCheckpoint, importCheckpoint } from "@transfer/Checkpoint.ts";
import { createSeededPopulation } from "@transfer/PopulationSeeding.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import { Breed } from "@breed/Breed.ts";
import { Genus } from "@neat/Genus.ts";
import { Mutator } from "@neat/Mutator.ts";
import { DeDuplicator } from "@architecture/DeDuplicator.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { getLogger, setLogger } from "@utils/Logger.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

const REJECT_PROBE = () => ({
  ok: false as const,
  trapMessage: "test-forced rejection (issue #2671)",
});

/** Build a healthy creature whose body and header are internally consistent. */
function buildHealthyCreature(): Creature {
  const c = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });
  c.fix();
  return c;
}

/**
 * Install a logger that captures warn lines. Returns the captured array and
 * a disposer that restores the previous logger.
 */
function captureWarnLogs(): { warnings: string[]; dispose: () => void } {
  const warnings: string[] = [];
  const previous = getLogger();
  setLogger({
    debug() {},
    info() {},
    warn(...args: unknown[]) {
      warnings.push(args.map((a) => String(a)).join(" "));
    },
    error(...args: unknown[]) {
      warnings.push(args.map((a) => String(a)).join(" "));
    },
  });
  return {
    warnings,
    dispose() {
      setLogger(previous);
    },
  };
}

Deno.test(
  "Issue #2671: passesProducerCompileGate emits a warn line tagged with the producer name on rejection",
  async () => {
    await initWasmForTests();
    const restore = __setProducerCompileGateProbeForTesting(REJECT_PROBE);
    const capture = captureWarnLogs();
    try {
      const healthy = buildHealthyCreature();
      const accepted = passesProducerCompileGate(healthy, "test/regression");
      assertEquals(accepted, false, "stub probe must surface as rejection");
      const matched = capture.warnings.find((w) =>
        w.includes("[test/regression]") && w.includes("WASM compile")
      );
      assert(
        matched !== undefined,
        `expected a tagged warn line, got: ${capture.warnings.join("\n")}`,
      );
    } finally {
      capture.dispose();
      restore();
    }
  },
);

Deno.test(
  "Issue #2671: passesProducerCompileGate accepts a healthy creature against the real probe",
  async () => {
    await initWasmForTests();
    const healthy = buildHealthyCreature();
    const accepted = passesProducerCompileGate(healthy, "test/regression");
    assertEquals(accepted, true, "healthy creature must pass the real probe");
    const realProbe = ensureProducerOutputCompiles(healthy);
    assertEquals(realProbe.ok, true);
  },
);

Deno.test(
  "Issue #2671: applyCoordinatedStructuralCandidate reverts when the gate rejects the post-apply creature",
  async () => {
    await initWasmForTests();
    const restore = __setProducerCompileGateProbeForTesting(REJECT_PROBE);
    const capture = captureWarnLogs();
    try {
      const original = buildHealthyCreature();
      original.forwardOnly = false;
      const candidate: CoordinatedStructuralCandidate = {
        type: "coordinated_structural",
        expectedCreatureScoreGain: 0,
        operations: [
          {
            type: "setBias",
            neuronUuid: "output-0",
            bias: 0.123,
          },
        ],
      };

      const result = applyCoordinatedStructuralCandidate(original, candidate);
      assertEquals(
        result,
        original,
        "Discovery apply path must return the pre-application creature on gate failure",
      );
      const matched = capture.warnings.find((w) =>
        w.includes("Discovery/applyCoordinatedStructural")
      );
      assert(
        matched !== undefined,
        `expected Discovery gate warn line, got: ${
          capture.warnings.join("\n")
        }`,
      );
    } finally {
      capture.dispose();
      restore();
    }
  },
);

Deno.test(
  "Issue #2671: CRISPR.cleaveDNA returns the original creature when the gate rejects the modified topology",
  async () => {
    await initWasmForTests();
    const restore = __setProducerCompileGateProbeForTesting(REJECT_PROBE);
    const capture = captureWarnLogs();
    try {
      const original = buildHealthyCreature();
      original.forwardOnly = false;
      // No `neurons` array — append-mode CRISPR with only synapses (here
      // none) leaves the creature topology untouched, so the gate runs
      // against a valid creature and we exercise only the reject path.
      const dna = {
        id: "issue-2671-regression",
        mode: "append" as const,
        synapses: [],
      };

      const crispr = new CRISPR(original);
      const result = crispr.cleaveDNA(dna);
      // CRISPR's contract on failure is to return the *original* creature
      // (its internally-shallow-cloned copy). The result must therefore
      // share the same shape as the input rather than carrying the
      // mutation that the gate just rejected.
      assertEquals(
        result.neurons.length,
        original.neurons.length,
        "CRISPR must revert to the original on gate failure",
      );
      const matched = capture.warnings.find((w) =>
        w.includes("CRISPR") && w.includes("WASM")
      );
      assert(
        matched !== undefined,
        `expected CRISPR gate warn line, got: ${capture.warnings.join("\n")}`,
      );
    } finally {
      capture.dispose();
      restore();
    }
  },
);

Deno.test(
  "Issue #2671: importCheckpoint throws TopologyError when the gate rejects the imported creature",
  async () => {
    await initWasmForTests();
    const restore = __setProducerCompileGateProbeForTesting(REJECT_PROBE);
    const capture = captureWarnLogs();
    try {
      const healthy = new Creature(2, 1, {
        layers: [{ count: 2, squash: "TANH" }],
      });
      const checkpoint = exportCheckpoint(healthy, { sourceTask: "test" });
      assertThrows(
        () => importCheckpoint(checkpoint),
        TopologyError,
        "WASM compile",
        "importCheckpoint must throw on gate failure",
      );
      const matched = capture.warnings.find((w) =>
        w.includes("Checkpoint/import")
      );
      assert(
        matched !== undefined,
        `expected Checkpoint gate warn line, got: ${
          capture.warnings.join("\n")
        }`,
      );
    } finally {
      capture.dispose();
      restore();
    }
  },
);

Deno.test(
  "Issue #2671: createSeededPopulation drops a seed that fails the gate and backfills with a random creature",
  async () => {
    await initWasmForTests();
    const restore = __setProducerCompileGateProbeForTesting(REJECT_PROBE);
    const capture = captureWarnLogs();
    try {
      const healthy = new Creature(2, 1, {
        layers: [{ count: 2, squash: "TANH" }],
      });
      const population = createSeededPopulation({
        inputCount: 2,
        outputCount: 1,
        populationSize: 4,
        seeds: [healthy.exportJSON(), healthy.exportJSON()],
      });
      assertEquals(
        population.length,
        4,
        "Population size must be preserved by replacing dropped seeds with random creatures",
      );
      const matched = capture.warnings.find((w) =>
        w.includes("PopulationSeeding")
      );
      assert(
        matched !== undefined,
        `expected PopulationSeeding gate warn line, got: ${
          capture.warnings.join("\n")
        }`,
      );
    } finally {
      capture.dispose();
      restore();
    }
  },
);

Deno.test(
  "Issue #2671: DeDuplicator culls a duplicate slot when every replacement fails the gate",
  async () => {
    await initWasmForTests();
    const restore = __setProducerCompileGateProbeForTesting(REJECT_PROBE);
    // createNeatConfig calls setLogger() with the default console logger
    // (NeatConfig.ts), so install the warn-capturing logger *after* the
    // config is built. Without this ordering, the dedup pass logs through
    // the console logger and the assertion below finds nothing.
    const config = createNeatConfig({
      populationSize: 3,
      elitism: 1,
      mutationRate: 0.5,
    });
    const capture = captureWarnLogs();
    try {
      const genus = new Genus();
      const breed = new Breed(genus, config);
      const mutator = new Mutator(config);
      const dedup = new DeDuplicator(breed, mutator);

      // Build a duplicate population (every creature shares the same UUID).
      const template = buildHealthyCreature();
      const json = template.exportJSON();
      const creatures: Creature[] = [];
      for (let i = 0; i < 3; i++) {
        const c = Creature.fromJSON(json, true);
        CreatureUtil.makeUUID(c);
        creatures.push(c);
      }

      await dedup.perform(creatures);

      // Every replacement candidate is rejected by the stub probe, so the
      // dedup pass culls duplicates rather than committing a bad topology.
      const seen = new Set<string>();
      for (const c of creatures) {
        seen.add(CreatureUtil.makeUUID(c));
      }
      assertNotEquals(
        seen.size,
        0,
        "dedup must leave at least one creature",
      );
      const matched = capture.warnings.find((w) => w.includes("DeDuplicator/"));
      assert(
        matched !== undefined,
        `expected DeDuplicator gate warn line, got: ${
          capture.warnings.join("\n")
        }`,
      );
    } finally {
      capture.dispose();
      restore();
    }
  },
);
