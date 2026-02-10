/**
 * Benchmark for adaptive discovery timeout calculation (Issue #1298).
 *
 * Measures the overhead of computing adaptive timeouts at various
 * creature complexities to confirm it adds negligible cost to discovery
 * scheduling.
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/AdaptiveDiscoveryTimeout.ts
 */
import { calculateDiscoveryTimeout } from "../src/discovery/DiscoveryTimeout.ts";

Deno.bench(
  "calculateDiscoveryTimeout - minimal creature (3 neurons, 2 synapses)",
  () => {
    calculateDiscoveryTimeout({ neuronCount: 3, synapseCount: 2 });
  },
);

Deno.bench(
  "calculateDiscoveryTimeout - small creature (10 neurons, 20 synapses)",
  () => {
    calculateDiscoveryTimeout({ neuronCount: 10, synapseCount: 20 });
  },
);

Deno.bench(
  "calculateDiscoveryTimeout - medium creature (100 neurons, 500 synapses)",
  () => {
    calculateDiscoveryTimeout({ neuronCount: 100, synapseCount: 500 });
  },
);

Deno.bench(
  "calculateDiscoveryTimeout - large creature (1000 neurons, 10000 synapses)",
  () => {
    calculateDiscoveryTimeout({ neuronCount: 1000, synapseCount: 10000 });
  },
);

Deno.bench(
  "calculateDiscoveryTimeout - very large creature (10000 neurons, 100000 synapses)",
  () => {
    calculateDiscoveryTimeout({ neuronCount: 10000, synapseCount: 100000 });
  },
);
