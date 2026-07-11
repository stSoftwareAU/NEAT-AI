/**
 * Issue #3263 - Benchmark: squash-budget mutation selection cost.
 *
 * The squash budget restricts `Activations.pickRandomSquash` to an allow-list.
 * This benchmark measures the per-draw cost of the free 34-type mix against a
 * small GPU-hostable allow-list, isolating the *selection* overhead (the
 * evolutionary prior), not the activation kernel itself.
 *
 * It is a proxy for the intended production effect: a smaller, cheaper squash
 * mix flows through mutation into every generation's networks. The full GRQ
 * A/B (evolve wall-clock / `fitnessMs`) requires the production creature seed
 * and `../GRQ/.trainData-binary_115`, which are not available in this repo's
 * CI — see docs/PERFORMANCE_RESEARCH.md.
 *
 * Run with:
 *   deno bench --allow-all bench/SquashBudgetSelection.ts
 */

import { Activations } from "@methods/activations/Activations.ts";
import {
  createSeededRng,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";

// A small allow-list mirroring a GPU-hostable / SIMD-friendly set.
const GPU_HOSTABLE = ["ReLU", "TANH", "LOGISTIC", "IDENTITY"];

Deno.bench("pickRandomSquash - free 34-type mix", () => {
  setRandomNumberGenerator(createSeededRng(1));
  Activations.resetAllowedSquashesForTesting();
  let acc = 0;
  for (let i = 0; i < 1000; i++) {
    acc += Activations.pickRandomSquash().length;
  }
  if (acc < 0) throw new Error("unreachable");
});

Deno.bench("pickRandomSquash - GPU-hostable budget (4 types)", () => {
  setRandomNumberGenerator(createSeededRng(1));
  Activations.setAllowedSquashes(GPU_HOSTABLE);
  let acc = 0;
  for (let i = 0; i < 1000; i++) {
    acc += Activations.pickRandomSquash().length;
  }
  Activations.resetAllowedSquashesForTesting();
  if (acc < 0) throw new Error("unreachable");
});
