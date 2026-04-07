import { assertAlmostEquals, assertEquals } from "@std/assert";
import { MCMCState } from "@neat/MCMCState.ts";
import { DEFAULT_MCMC_CONFIG } from "@config/MCMCConfig.ts";
import type { RequiredMCMCConfig } from "@config/MCMCConfig.ts";

Deno.test("MCMCState: initial temperature matches config", () => {
  const state = new MCMCState(DEFAULT_MCMC_CONFIG);
  assertEquals(state.getTemperature(), DEFAULT_MCMC_CONFIG.initialTemperature);
});

Deno.test("MCMCState: cool reduces temperature by coolingRate", () => {
  const config: RequiredMCMCConfig = {
    ...DEFAULT_MCMC_CONFIG,
    initialTemperature: 1.0,
    coolingRate: 0.9,
    minTemperature: 0.001,
  };
  const state = new MCMCState(config);

  state.cool();
  assertAlmostEquals(state.getTemperature(), 0.9, 1e-10);

  state.cool();
  assertAlmostEquals(state.getTemperature(), 0.81, 1e-10);
});

Deno.test("MCMCState: temperature never goes below minTemperature", () => {
  const config: RequiredMCMCConfig = {
    ...DEFAULT_MCMC_CONFIG,
    initialTemperature: 0.02,
    coolingRate: 0.5,
    minTemperature: 0.01,
  };
  const state = new MCMCState(config);

  state.cool(); // 0.02 * 0.5 = 0.01 (at floor)
  assertEquals(state.getTemperature(), 0.01);

  state.cool(); // stays at floor
  assertEquals(state.getTemperature(), 0.01);
});

Deno.test("MCMCState: reset restores initial temperature", () => {
  const config: RequiredMCMCConfig = {
    ...DEFAULT_MCMC_CONFIG,
    initialTemperature: 5.0,
    coolingRate: 0.5,
    minTemperature: 0.01,
  };
  const state = new MCMCState(config);

  state.cool();
  state.cool();
  assertEquals(state.getTemperature() < 5.0, true);

  state.reset();
  assertEquals(state.getTemperature(), 5.0);
});

Deno.test("MCMCState: setTemperature updates temperature directly", () => {
  const config: RequiredMCMCConfig = {
    ...DEFAULT_MCMC_CONFIG,
    initialTemperature: 1.0,
    coolingRate: 0.995,
    minTemperature: 0.01,
  };
  const state = new MCMCState(config);

  state.setTemperature(0.75);
  assertEquals(state.getTemperature(), 0.75);

  // Cooling should apply from the new temperature
  state.cool();
  assertAlmostEquals(state.getTemperature(), 0.75 * 0.995, 1e-6);
});

Deno.test("MCMCState: multiple generations of cooling follow schedule", () => {
  const config: RequiredMCMCConfig = {
    ...DEFAULT_MCMC_CONFIG,
    initialTemperature: 1.0,
    coolingRate: 0.995,
    minTemperature: 0.01,
  };
  const state = new MCMCState(config);

  // After 100 generations: 1.0 * 0.995^100 ≈ 0.6058
  for (let i = 0; i < 100; i++) {
    state.cool();
  }
  const expected = 1.0 * Math.pow(0.995, 100);
  assertAlmostEquals(state.getTemperature(), expected, 1e-10);
});
