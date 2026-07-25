/**
 * Issue #2670 — Regression test for the WASM compilation cache stale-template
 * trap caused by position-independent topology hashing.
 *
 * Background:
 *
 *   `WasmCompilationCache` keys cached binary templates by
 *   `CreatureUtil.getTopologyHash`. Before this fix the hash sorted neuron
 *   keys before hashing, so two creatures with the same UUID-set + same
 *   UUID→UUID synapse-set but different neuron positional orderings would
 *   share a hash. The template buffer, however, encodes synapse
 *   `from_index` and per-neuron `squash` by INTEGER POSITION in
 *   `creature.neurons`. Serving a cached template built for one ordering
 *   to a creature with a different ordering tripped a
 *   `RuntimeError: unreachable` inside `CompiledNetwork::new`.
 *
 *   The fix preserves neuron position order inside the topology hash.
 *   This test pins that invariant by:
 *
 *     1. Constructing two creatures with the same UUID-set + same
 *        UUID→UUID synapse-set, but with the hidden neurons in different
 *        positional orders (both orderings are valid topological orders).
 *     2. Asserting that their `getTopologyHash` values differ.
 *     3. Compiling both via `getOrCompileWasmModule` from a freshly cleared
 *        cache and confirming both compile cleanly — the second creature
 *        must NOT hit a stale template from the first.
 *
 * Coverage lineage (Issue #3461):
 *
 *   This synthetic test is the go/no-go coverage anchor for the removal of
 *   the private-repo-derived WASM compile-trap replay test
 *   (#2683/#2681, deleted under #3451). That replay loaded nine large
 *   production creature snapshots to confirm PR #2678 also resolved the
 *   `unreachable` `CompiledNetwork::new` trap. The *failure mode* it pinned
 *   — a position-blind topology-hash collision serving a stale WASM
 *   template across two valid orderings of the same UUID set — is exactly
 *   the invariant asserted here, reproduced synthetically with no private
 *   data. Do not weaken these assertions without re-checking #3451.
 */

import { assert, assertNotEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  clearWasmCompilationCache,
  getOrCompileWasmModule,
} from "@wasm/WasmCompilationCache.ts";
import { isWasmActivationAvailable } from "@wasm/WasmModuleLoader.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Two valid topological orderings of the same DAG. Both creatures have:
 *
 *   inputs 0,1 → hidden-a (TANH)
 *   inputs 0,1 → hidden-b (LOGISTIC)
 *   hidden-a, hidden-b → output-0 (IDENTITY)
 *
 * `creatureWithOrder` lists hidden-a before hidden-b; `creatureWithSwap`
 * swaps them. Both are valid topological orders — the only edges among
 * hidden neurons go from {input-0,input-1} to {hidden-a, hidden-b}, so
 * either ordering satisfies forward-only constraints.
 */
function creatureWithOrder(): CreatureExport {
  return {
    neurons: [
      { type: "hidden", uuid: "hidden-a", squash: "TANH", bias: 0.1 },
      { type: "hidden", uuid: "hidden-b", squash: "LOGISTIC", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.3 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.11 },
      { fromUUID: "input-1", toUUID: "hidden-a", weight: 0.12 },
      { fromUUID: "input-0", toUUID: "hidden-b", weight: 0.21 },
      { fromUUID: "input-1", toUUID: "hidden-b", weight: 0.22 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.31 },
      { fromUUID: "hidden-b", toUUID: "output-0", weight: 0.32 },
    ],
    input: 2,
    output: 1,
  };
}

function creatureWithSwap(): CreatureExport {
  return {
    neurons: [
      // Swap hidden-a and hidden-b. Same UUID-set; different positions.
      { type: "hidden", uuid: "hidden-b", squash: "LOGISTIC", bias: 0.2 },
      { type: "hidden", uuid: "hidden-a", squash: "TANH", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.3 },
    ],
    // Same UUID→UUID synapse set (order in the array does not matter to
    // the WASM template — `inwardConnections` sorts internally).
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.11 },
      { fromUUID: "input-1", toUUID: "hidden-a", weight: 0.12 },
      { fromUUID: "input-0", toUUID: "hidden-b", weight: 0.21 },
      { fromUUID: "input-1", toUUID: "hidden-b", weight: 0.22 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.31 },
      { fromUUID: "hidden-b", toUUID: "output-0", weight: 0.32 },
    ],
    input: 2,
    output: 1,
  };
}

Deno.test(
  "Issue #2670: topology hash distinguishes valid topological orderings of the same UUID set",
  () => {
    const c1 = Creature.fromJSON(creatureWithOrder());
    const c2 = Creature.fromJSON(creatureWithSwap());

    const hash1 = CreatureUtil.getTopologyHash(c1);
    const hash2 = CreatureUtil.getTopologyHash(c2);

    assertNotEquals(
      hash1,
      hash2,
      "Two creatures with the same UUID-set but different neuron position " +
        "orderings must produce different topology hashes so the WASM " +
        "compilation cache cannot serve a stale template across orderings.",
    );
  },
);

Deno.test(
  "Issue #2670: WASM compile gate succeeds for both orderings sharing a UUID-set",
  async () => {
    await initWasmForTests();
    if (!isWasmActivationAvailable()) {
      // The compile gate is a no-op without WASM; the hash check above
      // is the load-bearing assertion in that environment.
      return;
    }

    // Clear cache so the first creature populates a fresh entry; the
    // second creature must NOT collide on that entry.
    clearWasmCompilationCache();

    const c1 = Creature.fromJSON(creatureWithOrder());
    const a1 = getOrCompileWasmModule(c1);
    assert(
      a1 !== null,
      "creatureWithOrder must compile cleanly from an empty cache",
    );
    a1?.free();

    const c2 = Creature.fromJSON(creatureWithSwap());
    const a2 = getOrCompileWasmModule(c2);
    assert(
      a2 !== null,
      "creatureWithSwap must compile cleanly — pre-fix it would have hit " +
        "the cached template for creatureWithOrder and trapped with " +
        "`RuntimeError: unreachable`.",
    );
    a2?.free();
  },
);
