/**
 * Tests for diversity-aware MCMC temperature curriculum (Issue #2456).
 *
 * Couples the MCMC cooling schedule to the live diversity signal: when
 * species count collapses or mean within-species compatibility crosses
 * the crowding threshold, the cooling step reheats temperature instead
 * of cooling it.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { MCMCState } from "@neat/MCMCState.ts";
import {
  DEFAULT_DIVERSITY_AWARE_MCMC_CONFIG,
  DEFAULT_MCMC_CONFIG,
  type RequiredMCMCConfig,
} from "@config/MCMCConfig.ts";

/**
 * Build a deterministic MCMC config with diversity-aware reheating ON.
 *
 * `enabled` (top-level MCMC) is left as `false` so that `MCMCDiagnostics`
 * adaptive tuning is a no-op: in production the evolution loop only calls
 * `cool()` when MCMC is enabled, but the unit tests here exercise the cool
 * step directly and we want to isolate the diversity-aware logic from the
 * acceptance-rate feedback loop.
 */
function makeConfig(
  overrides: Partial<RequiredMCMCConfig> = {},
): RequiredMCMCConfig {
  return {
    ...DEFAULT_MCMC_CONFIG,
    enabled: false,
    initialTemperature: 1.0,
    minTemperature: 0.01,
    coolingRate: 0.9,
    diversityAwareMCMC: {
      enabled: true,
      minSpecies: 4,
      crowdingThreshold: 0.85,
      reheatFactor: 1.5,
    },
    ...overrides,
  };
}

Deno.test("Diversity-aware MCMC: healthy population follows exponential decay", () => {
  const config = makeConfig();
  const state = new MCMCState(config);

  // Healthy: species count well above threshold, compatibility well below.
  for (let i = 0; i < 5; i++) {
    state.cool(false, {
      speciesCount: 10,
      meanWithinSpeciesCompatibility: 0.3,
    });
  }

  // After 5 generations of cooling at 0.9: 1.0 * 0.9^5 = 0.59049
  assertAlmostEquals(state.getTemperature(), Math.pow(0.9, 5), 1e-10);
  assertEquals(state.didReheatLastGeneration(), false);
});

Deno.test("Diversity-aware MCMC: species collapse triggers reheat", () => {
  // Start with a high initialTemperature so that reheating from a
  // partially-cooled state stays below the cap (testing the multiplier,
  // not the clamp — the clamp is exercised separately).
  const config = makeConfig({ initialTemperature: 10.0 });
  const state = new MCMCState(config);

  // Cool down enough generations that reheat does not hit the cap:
  // 10 * 0.9^5 = 5.9049 → reheat 5.9049 * 1.5 = 8.857 < 10
  for (let i = 0; i < 5; i++) {
    state.cool(false, {
      speciesCount: 10,
      meanWithinSpeciesCompatibility: 0.3,
    });
  }
  const beforeReheat = state.getTemperature();
  assertAlmostEquals(beforeReheat, 10.0 * Math.pow(0.9, 5), 1e-10);

  // Species count drops below minSpecies (4) — reheat triggers.
  state.cool(false, { speciesCount: 2, meanWithinSpeciesCompatibility: 0.3 });
  assertEquals(state.didReheatLastGeneration(), true);
  // Reheated by factor 1.5
  assertAlmostEquals(state.getTemperature(), beforeReheat * 1.5, 1e-10);
});

Deno.test("Diversity-aware MCMC: crowding triggers reheat (compatibility above threshold)", () => {
  const config = makeConfig({ initialTemperature: 10.0 });
  const state = new MCMCState(config);

  // Cool enough generations so that reheat does not hit the cap.
  for (let i = 0; i < 5; i++) {
    state.cool(false, {
      speciesCount: 10,
      meanWithinSpeciesCompatibility: 0.3,
    });
  }
  const beforeReheat = state.getTemperature();

  // Compatibility now exceeds crowdingThreshold (0.85).
  state.cool(false, { speciesCount: 10, meanWithinSpeciesCompatibility: 0.95 });
  assertEquals(state.didReheatLastGeneration(), true);
  assertAlmostEquals(state.getTemperature(), beforeReheat * 1.5, 1e-10);
});

Deno.test("Diversity-aware MCMC: reheat is capped at initialTemperature", () => {
  const config = makeConfig({ initialTemperature: 1.0 });
  const state = new MCMCState(config);

  // Set temperature high so reheat would otherwise exceed initial.
  state.setTemperature(0.9);
  state.cool(false, { speciesCount: 1, meanWithinSpeciesCompatibility: 0.0 });
  // 0.9 * 1.5 = 1.35, but capped at initialTemperature = 1.0
  assertEquals(state.getTemperature(), 1.0);
  assertEquals(state.didReheatLastGeneration(), true);

  // Repeated reheats also stay capped.
  state.cool(false, { speciesCount: 0, meanWithinSpeciesCompatibility: 0.99 });
  assertEquals(state.getTemperature(), 1.0);
});

Deno.test("Diversity-aware MCMC: disabled flag preserves exponential schedule exactly", () => {
  // Disabled: even if diversity is collapsing, cooling proceeds normally.
  const config = makeConfig({
    diversityAwareMCMC: {
      ...DEFAULT_DIVERSITY_AWARE_MCMC_CONFIG,
      enabled: false,
    },
  });
  const state = new MCMCState(config);

  for (let i = 0; i < 10; i++) {
    state.cool(false, {
      speciesCount: 1,
      meanWithinSpeciesCompatibility: 0.99,
    });
  }

  // Pure exponential decay: 1.0 * 0.9^10
  assertAlmostEquals(state.getTemperature(), Math.pow(0.9, 10), 1e-10);
  assertEquals(state.didReheatLastGeneration(), false);
});

Deno.test("Diversity-aware MCMC: omitted snapshot leaves exponential schedule untouched", () => {
  const config = makeConfig();
  const state = new MCMCState(config);

  // No diversity snapshot passed at all.
  for (let i = 0; i < 5; i++) {
    state.cool();
  }
  assertAlmostEquals(state.getTemperature(), Math.pow(0.9, 5), 1e-10);
  assertEquals(state.didReheatLastGeneration(), false);
});

Deno.test("Diversity-aware MCMC: only one branch needs to fire to trigger reheat", () => {
  const config = makeConfig();
  const state = new MCMCState(config);

  // Healthy species count (10), but high crowding (0.9 > 0.85) → reheat.
  state.cool(false, { speciesCount: 10, meanWithinSpeciesCompatibility: 0.9 });
  assertEquals(state.didReheatLastGeneration(), true);

  state.reset();

  // Healthy crowding (0.3), but species count below threshold (3 < 4) → reheat.
  state.cool(false, { speciesCount: 3, meanWithinSpeciesCompatibility: 0.3 });
  assertEquals(state.didReheatLastGeneration(), true);
});

Deno.test("Diversity-aware MCMC: reheat after long cooling never exceeds initialTemperature", () => {
  const config = makeConfig({ initialTemperature: 2.0 });
  const state = new MCMCState(config);

  // Cool many generations.
  for (let i = 0; i < 50; i++) {
    state.cool(false, {
      speciesCount: 10,
      meanWithinSpeciesCompatibility: 0.3,
    });
  }

  // Now repeatedly trigger reheat — temperature should approach but never
  // exceed initialTemperature.
  for (let i = 0; i < 20; i++) {
    state.cool(false, {
      speciesCount: 1,
      meanWithinSpeciesCompatibility: 0.99,
    });
    assert(state.getTemperature() <= 2.0 + 1e-10);
  }
  assertEquals(state.getTemperature(), 2.0);
});

Deno.test("Diversity-aware MCMC: getLastDiversitySnapshot exposes the last fed snapshot", () => {
  const config = makeConfig();
  const state = new MCMCState(config);

  state.cool(false, { speciesCount: 7, meanWithinSpeciesCompatibility: 0.4 });
  const snap = state.getLastDiversitySnapshot();
  assertEquals(snap?.speciesCount, 7);
  assertEquals(snap?.meanWithinSpeciesCompatibility, 0.4);

  state.reset();
  assertEquals(state.getLastDiversitySnapshot(), undefined);
});

Deno.test("Diversity-aware MCMC: reheated temperature still respects minTemperature floor when adaptive tuning runs", () => {
  // Sanity: even after reheat, a subsequent normal-cool sequence converges
  // back toward the floor.
  const config = makeConfig({ minTemperature: 0.05 });
  const state = new MCMCState(config);

  // One reheat to set a high temperature.
  state.setTemperature(0.5);
  state.cool(false, { speciesCount: 1, meanWithinSpeciesCompatibility: 0.0 });
  // 0.5 * 1.5 = 0.75 (below initial 1.0, so no clamp).
  assertAlmostEquals(state.getTemperature(), 0.75, 1e-10);

  // Then many normal cools: should bottom out at minTemperature.
  for (let i = 0; i < 200; i++) {
    state.cool(false, {
      speciesCount: 10,
      meanWithinSpeciesCompatibility: 0.3,
    });
  }
  assertEquals(state.getTemperature(), 0.05);
});
