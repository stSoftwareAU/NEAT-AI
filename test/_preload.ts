/**
 * Test preload: configure WASM cache caps for parallel test execution.
 *
 * When 699+ test files run in parallel (one worker per CPU), the default
 * WASM activation LRU cap (512) and compilation cache (100) per worker
 * can push total heap past the 8 GB V8 limit.
 *
 * This preload runs once per worker before any test module and tightens
 * the caps so that each worker keeps a bounded working set.
 */

import { resetHiddenNeuronIdCounterForTesting } from "@architecture/NeuronId.ts";
import { resetGlobalRandomNumberGeneratorForTesting } from "@utils/RandomNumberGenerator.ts";
import {
  setMaxCachedWasmCreatureActivations,
} from "../src/wasm/WasmCreatureActivationLRU.ts";
import {
  setWasmCompilationCacheSize,
} from "../src/wasm/WasmCompilationCache.ts";

// Keep at most 16 compiled WASM activations per worker (down from 512).
// Evolution runs override this via WasmCacheConfig, so production is unaffected.
setMaxCachedWasmCreatureActivations(16);

// Keep at most 8 topology templates per worker (down from 100).
setWasmCompilationCacheSize(8);

// Known baseline for globals mutated during tests (RNG, neuron id counter).
resetGlobalRandomNumberGeneratorForTesting();
resetHiddenNeuronIdCounterForTesting();
