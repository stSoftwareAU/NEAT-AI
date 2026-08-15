/**
 * Issue #2584: tests verifying that the implementations referenced in the
 * "Implementation Status" section of
 * `docs/archive/research/deepseek-papers-index.md` (archived under #2575)
 * actually exist and remain configurable.
 *
 * OPD / specialist distillation were removed as unused default-off experiments;
 * remaining catalogue entries must still resolve on disk.
 */

import { assert, assertEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";

const REPO_ROOT = new URL("../../", import.meta.url);

const REQUIRED_ARTEFACTS = [
  // GRPO advantage signal — Issue #2527
  "bench/MCMCAdvantageConvergence.ts",
  "test/NEAT/GroupRelativeAdvantage.ts",
  // Muon orthogonalised gradients — Issue #2529
  "bench/MuonVsBaseline.ts",
  "test/propagate/MuonOrthogonalisation.ts",
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
