/**
 * Issue #3477 - Benchmark: elastic-fallback per-link object allocation.
 *
 * The weight-based elastic fallback in `NeuronPropagation.propagate` previously
 * repacked its pre-populated typed scratch buffers into `listLength`
 * `{ activation, safeZoneFactor, weight }` objects (plus a backing array) on
 * every call, only for the WASM shim to immediately unpack them back into typed
 * arrays. `distributeElasticErrorTyped` feeds the typed buffers straight to the
 * WASM ABI with a uniform scalar `safeZoneFactor`, allocating nothing per link.
 *
 * This is a same-process head-to-head: both entry points call the identical
 * underlying WASM `distribute_elastic_error`, so the delta is purely the
 * per-link object/array allocation. The ratio is independent of machine load.
 *
 * It also measures the raw allocated-bytes delta per 10k calls using
 * `Deno.memoryUsage().heapUsed` with a forced GC, when `--v8-flags=--expose-gc`
 * is supplied.
 *
 * Run with:
 *   deno bench --allow-read --allow-env --allow-write --allow-ffi \
 *     bench/ElasticFallbackTyped.ts
 *   # allocation report:
 *   deno run --allow-read --allow-env --allow-ffi --v8-flags=--expose-gc \
 *     bench/ElasticFallbackTyped.ts --report
 */

import {
  distributeElasticError,
  distributeElasticErrorTyped,
  type ElasticLink,
} from "@propagate/ElasticDistribution.ts";
import { ensureWasmActivation } from "@wasm/EnsureWasmActivation.ts";

await ensureWasmActivation();

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) * 2 - 1;
  };
}

const random = seededRandom(3477);

// Representative inbound fan-in sizes for aggregate neurons hitting the fallback.
const FAN_INS = [8, 32, 128];

for (const count of FAN_INS) {
  const activations = new Float32Array(count);
  const weights = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    activations[i] = random() * 0.5;
    weights[i] = random() * 0.5;
  }
  const error = 1.5;

  // Old path: build a fresh ElasticLink[] object array on every call.
  Deno.bench({
    name: `Elastic fallback - object array (fan-in ${count})`,
    group: `elastic-fallback-${count}`,
    baseline: true,
  }, () => {
    const links: ElasticLink[] = new Array(count);
    for (let i = 0; i < count; i++) {
      links[i] = {
        activation: activations[i],
        safeZoneFactor: 1,
        weight: weights[i],
      };
    }
    const shares = distributeElasticError(error, links);
    if (shares.length !== count) throw new Error("unreachable");
  });

  // New path: feed the typed buffers directly — no per-link allocation.
  Deno.bench({
    name: `Elastic fallback - typed buffers (fan-in ${count})`,
    group: `elastic-fallback-${count}`,
  }, () => {
    const shares = distributeElasticErrorTyped(error, activations, weights, 1);
    if (shares.length !== count) throw new Error("unreachable");
  });
}

// ---------------------------------------------------------------------------
// Optional allocation report (requires --v8-flags=--expose-gc).
// ---------------------------------------------------------------------------
if (Deno.args.includes("--report")) {
  const gc = (globalThis as { gc?: () => void }).gc;
  const CALLS = 20_000;
  const count = 64;
  const activations = new Float32Array(count);
  const weights = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    activations[i] = random() * 0.5;
    weights[i] = random() * 0.5;
  }

  const measure = (label: string, fn: () => void) => {
    if (gc) gc();
    const before = Deno.memoryUsage().heapUsed;
    for (let i = 0; i < CALLS; i++) fn();
    const after = Deno.memoryUsage().heapUsed;
    const perCall = (after - before) / CALLS;
    console.log(
      `${label}: heapUsed +${((after - before) / 1024 / 1024).toFixed(2)} MB ` +
        `over ${CALLS} calls (~${perCall.toFixed(0)} B/call, retained)`,
    );
  };

  console.log(`\nAllocation report (fan-in ${count}, ${CALLS} calls):`);
  measure("Object array   ", () => {
    const links: ElasticLink[] = new Array(count);
    for (let i = 0; i < count; i++) {
      links[i] = {
        activation: activations[i],
        safeZoneFactor: 1,
        weight: weights[i],
      };
    }
    distributeElasticError(1.5, links);
  });
  measure("Typed buffers  ", () => {
    distributeElasticErrorTyped(1.5, activations, weights, 1);
  });
}
