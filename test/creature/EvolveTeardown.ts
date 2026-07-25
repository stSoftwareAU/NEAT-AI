/**
 * Tests for the run-level `evolve*` lifecycle teardown helpers (Issue #3434).
 *
 * These are pure "what" tests — they call the real helpers with real creatures
 * and caches and assert on the observable outcome (disposed topology arrays,
 * emptied caches, preserved caller creature). No timing APIs are used, so they
 * are deterministic under the parallel test runner. Each cache test body is
 * synchronous (no `await`) so it runs atomically with respect to any
 * cross-file test that shares these process-global singletons.
 */

import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import {
  adoptChampionClone,
  disposeEvolvePopulation,
  releaseEvolveCaches,
} from "@creature/EvolveTeardown.ts";
import {
  clearDistanceCache,
  getCachedDistance,
  setCachedDistance,
} from "@breed/DistanceCache.ts";
import {
  ensureWasmTemplate,
  hasWasmTemplate,
} from "@wasm/WasmCompilationCache.ts";
import { getSharedSubnetworkIndex } from "@discovery/SubnetworkHashIndex.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

function makeCreature(uuid: string): Creature {
  const c = new Creature(3, 2, { layers: [{ count: 4, squash: "LOGISTIC" }] });
  c.uuid = uuid;
  c.score = 0.5;
  return c;
}

Deno.test(
  "adoptChampionClone disposes the previous champion and returns a fresh clone",
  () => {
    const previous = makeCreature("teardown-previous");
    const fittest = makeCreature("teardown-fittest");
    const fittestNeuronCount = fittest.neurons.length;

    const next = adoptChampionClone(previous, fittest, 0.9);

    // Previous champion disposed: topology arrays released.
    assertEquals(previous.neurons.length, 0, "previous neurons not released");
    assertEquals(previous.synapses.length, 0, "previous synapses not released");

    // The returned clone is a distinct, valid champion carrying the new score.
    assertEquals(next === fittest, false, "clone must not alias fittest");
    assertEquals(next === previous, false, "clone must not alias previous");
    assertEquals(next.score, 0.9, "score not stamped on clone");
    assertEquals(
      next.neurons.length,
      fittestNeuronCount,
      "clone topology should match the fittest it was cloned from",
    );

    // The source fittest is untouched by disposing the previous champion.
    assertEquals(
      fittest.neurons.length,
      fittestNeuronCount,
      "fittest must not be disposed",
    );
  },
);

Deno.test(
  "adoptChampionClone with no previous champion returns the clone (first win)",
  () => {
    const fittest = makeCreature("teardown-first-win");
    const next = adoptChampionClone(undefined, fittest, 0.42);

    assertEquals(next === fittest, false, "clone must not alias fittest");
    assertEquals(next.score, 0.42, "score not stamped on clone");
    assertEquals(
      next.neurons.length,
      fittest.neurons.length,
      "clone topology should match the fittest",
    );
  },
);

Deno.test(
  "disposeEvolvePopulation disposes every member except the caller creature",
  () => {
    const keep = makeCreature("teardown-keep");
    const a = makeCreature("teardown-a");
    const b = makeCreature("teardown-b");
    const keepNeuronCount = keep.neurons.length;

    // Mirror the real population ordering: the caller creature is member 0.
    const population = [keep, a, b];

    const disposed = disposeEvolvePopulation(population, keep);

    assertEquals(disposed, 2, "should report two disposed members");
    assertEquals(a.neurons.length, 0, "member a not disposed");
    assertEquals(b.neurons.length, 0, "member b not disposed");
    assertEquals(
      keep.neurons.length,
      keepNeuronCount,
      "caller creature must remain valid",
    );
    assertEquals(
      keep.synapses.length > 0,
      true,
      "caller creature synapses must remain",
    );
  },
);

Deno.test(
  "disposeEvolvePopulation returns 0 when only the caller creature is present",
  () => {
    const keep = makeCreature("teardown-solo");
    const keepNeuronCount = keep.neurons.length;

    const disposed = disposeEvolvePopulation([keep], keep);

    assertEquals(disposed, 0, "no members should be disposed");
    assertEquals(
      keep.neurons.length,
      keepNeuronCount,
      "caller creature must remain valid",
    );
  },
);

Deno.test(
  "releaseEvolveCaches clears a DistanceCache entry",
  () => {
    // Unique UUIDs so the assertion is robust under parallel cross-file tests
    // that share the process-global DistanceCache.
    const a = "teardown-distance-a-3434";
    const b = "teardown-distance-b-3434";
    clearDistanceCache();
    setCachedDistance(a, b, 0.375);
    assertEquals(getCachedDistance(a, b), 0.375, "entry not seeded");

    releaseEvolveCaches();

    assertEquals(
      getCachedDistance(a, b),
      undefined,
      "DistanceCache entry should be cleared",
    );
  },
);

Deno.test(
  "releaseEvolveCaches clears the shared subnetwork index",
  () => {
    const hash = "teardown-subnetwork-hash-3434";
    const index = getSharedSubnetworkIndex();
    index.insert(hash, {
      source: "success",
      changeType: "teardown-test",
      cacheKey: "teardown-key",
    });
    assertEquals(
      getSharedSubnetworkIndex().lookup(hash).length,
      1,
      "subnetwork entry not seeded",
    );

    releaseEvolveCaches();

    assertEquals(
      getSharedSubnetworkIndex().lookup(hash).length,
      0,
      "shared subnetwork index should be cleared",
    );
  },
);

Deno.test(
  "releaseEvolveCaches clears the WASM compilation cache",
  () => {
    // A distinctive topology so the hash is unlikely to collide with any
    // template a concurrent test compiles.
    const creature = new Creature(7, 3, {
      layers: [{ count: 11, squash: "TANH" }],
    });
    const hash = CreatureUtil.getTopologyHash(creature);
    ensureWasmTemplate(creature);
    assertEquals(hasWasmTemplate(hash), true, "WASM template not seeded");

    releaseEvolveCaches();

    assertEquals(
      hasWasmTemplate(hash),
      false,
      "WASM compilation cache should be cleared",
    );
  },
);
