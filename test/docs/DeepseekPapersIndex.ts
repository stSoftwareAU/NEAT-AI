/**
 * Issue #2584: tests verifying that the implementations referenced in the
 * "Implementation Status" section of `docs/research/deepseek-papers-index.md`
 * actually exist and remain configurable.
 *
 * The catalogue in that file points readers at five landed sub-issues
 * (#2527–#2531) and lists the opt-in configuration knob for each. These
 * tests exercise those real code paths so the catalogue cannot silently
 * link-rot if a flag is renamed or a benchmark file is moved. They are
 * "what" tests in the AGENTS.md sense — they assert on observable behaviour
 * (file presence, parsed config defaults), not on documentation prose.
 */

import { assert, assertEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";

// ---------------------------------------------------------------------------
// Linked benchmarks and tests must exist on disk.
//
// The catalogue's Implementation Status section names a benchmark and a
// unit-test file for each landed sub-issue. If any of those files moves the
// catalogue is misleading, so we fail loudly here.
// ---------------------------------------------------------------------------

const REPO_ROOT = new URL("../../", import.meta.url);

const REQUIRED_ARTEFACTS = [
  // GRPO advantage signal — Issue #2527
  "bench/MCMCAdvantageConvergence.ts",
  "test/NEAT/GroupRelativeAdvantage.ts",
  // On-Policy Distillation — Issue #2528
  "bench/OnPolicyDistillationBreed.ts",
  "test/breed/OnPolicyDistillationBreed.ts",
  // Muon orthogonalised gradients — Issue #2529
  "bench/MuonVsBaseline.ts",
  "test/propagate/MuonOrthogonalisation.ts",
  // Specialist + ensemble distillation — Issue #2530
  "bench/SpecialistVsMixed.ts",
  "test/NEAT/SpecialistPipeline.ts",
  // Engram subnetwork hash index — Issue #2531
  "bench/SubnetworkHashLookup.ts",
  "test/discovery/SubnetworkHashIndex.ts",
] as const;

for (const rel of REQUIRED_ARTEFACTS) {
  Deno.test(`deepseek-papers-index — referenced artefact exists: ${rel}`, async () => {
    const url = new URL(rel, REPO_ROOT);
    const stat = await Deno.stat(url);
    assert(
      stat.isFile,
      `Expected ${rel} to be a regular file referenced by the catalogue.`,
    );
  });
}

// ---------------------------------------------------------------------------
// Documented opt-in flags must be parsed and default to the disabled path.
//
// Each entry in the Implementation Status table promises the production path
// is unchanged when defaults are in effect. These tests pin that contract.
// ---------------------------------------------------------------------------

Deno.test(
  "deepseek-papers-index — GRPO advantage mode defaults to absolute (#2527)",
  () => {
    const config = createNeatConfig({});
    assertEquals(
      config.mcmc.mcmcAdvantageMode,
      "absolute",
      "GRPO group-relative path must remain opt-in.",
    );
  },
);

Deno.test(
  "deepseek-papers-index — OPD breed rate defaults to 0 (#2528)",
  () => {
    const config = createNeatConfig({});
    assertEquals(
      config.opd.breedRate,
      0,
      "On-Policy Distillation breeding must remain opt-in.",
    );
  },
);

Deno.test(
  "deepseek-papers-index — Muon orthogonalisation defaults to none (#2529)",
  () => {
    const bpConfig = createBackPropagationConfig();
    assertEquals(
      bpConfig.gradientOrthogonalisation,
      "none",
      "Muon orthogonalisation must remain opt-in.",
    );
  },
);

Deno.test(
  "deepseek-papers-index — specialist pipeline defaults to off (#2530)",
  () => {
    const config = createNeatConfig({});
    assertEquals(
      config.specialist.mode,
      "off",
      "Specialist + ensemble distillation pipeline must remain opt-in.",
    );
  },
);

Deno.test(
  "deepseek-papers-index — subnetwork hash index size has documented default (#2531)",
  () => {
    const config = createNeatConfig({});
    assertEquals(
      config.subnetworkIndexSize,
      50_000,
      "Engram subnetwork hash index size must match the catalogue default.",
    );
  },
);
