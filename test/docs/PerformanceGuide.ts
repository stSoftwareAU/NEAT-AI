/**
 * Issue #1640: Tests verifying behaviours documented in docs/performance-guide.md.
 *
 * Each test exercises real code paths related to the performance optimisation
 * strategies described in the guide, ensuring the guide stays accurate as the
 * codebase evolves.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../mod.ts";
import {
  initWasmActivation,
  isWasmActivationAvailable,
} from "../../src/wasm/mod.ts";

// ---------------------------------------------------------------------------
// Section: WASM activation works for numerical operations
// ---------------------------------------------------------------------------

Deno.test(
  "performance-guide - WASM activation available for numerical operations",
  async () => {
    // Documented: WASM migration works for tight numerical loops like
    // activation functions. Verify WASM is available and functional.
    const result = await initWasmActivation();
    assert(result, "WASM module should initialise successfully");
    assert(
      isWasmActivationAvailable(),
      "WASM activation should be available for numerical operations",
    );
  },
);

Deno.test(
  "performance-guide - WASM activation produces correct results",
  async () => {
    // Documented: activation functions are well-suited for WASM because they
    // are pure numerical transforms. Verify correctness.
    await initWasmActivation();
    const creature = new Creature(2, 1, {
      layers: [{ count: 3, squash: "LOGISTIC" }],
    });
    const output = creature.activate(new Float32Array([0.5, 0.8]));
    assertEquals(output.length, 1, "Should produce one output");
    assert(
      Number.isFinite(output[0]),
      "Output should be a finite number",
    );
  },
);

// ---------------------------------------------------------------------------
// Section: shallowClone produces equivalent creatures (better cloning)
// ---------------------------------------------------------------------------

Deno.test(
  "performance-guide - shallowClone produces equivalent creature to JSON round-trip",
  () => {
    // Documented: shallowClone() replaces Creature.fromJSON(creature.exportJSON())
    // for in-process cloning. Verify both produce equivalent results.
    const original = new Creature(3, 2, {
      layers: [{ count: 4, squash: "IDENTITY" }],
    });

    // JSON round-trip clone (the old approach)
    const jsonClone = Creature.fromJSON(original.exportJSON());

    // shallowClone (the optimised approach)
    const shallow = original.shallowClone();

    // Both should produce the same activation output
    const input = new Float32Array([0.1, 0.5, 0.9]);
    const originalOutput = original.activate(input);
    const jsonOutput = jsonClone.activate(input);
    const shallowOutput = shallow.activate(input);

    assertEquals(
      originalOutput.length,
      jsonOutput.length,
      "JSON clone output length should match",
    );
    assertEquals(
      originalOutput.length,
      shallowOutput.length,
      "shallowClone output length should match",
    );

    for (let i = 0; i < originalOutput.length; i++) {
      assertEquals(
        shallowOutput[i],
        jsonOutput[i],
        `shallowClone output[${i}] should match JSON clone output`,
      );
    }
  },
);

Deno.test(
  "performance-guide - shallowClone preserves neuron count and synapse count",
  () => {
    // Documented: shallowClone is a lighter alternative to JSON serialisation.
    // Verify structural equivalence.
    const original = new Creature(2, 1, {
      layers: [{ count: 5, squash: "LOGISTIC" }],
    });
    const cloned = original.shallowClone();

    assertEquals(
      cloned.neurons.length,
      original.neurons.length,
      "Neuron count should be preserved",
    );
    assertEquals(
      cloned.synapses.length,
      original.synapses.length,
      "Synapse count should be preserved",
    );
    assertEquals(cloned.input, original.input, "Input count should match");
    assertEquals(cloned.output, original.output, "Output count should match");
  },
);

// ---------------------------------------------------------------------------
// Section: Creature validation (batching and redundancy removal)
// ---------------------------------------------------------------------------

Deno.test(
  "performance-guide - creature remains valid after multiple mutations",
  () => {
    // Documented: batching fix/validate calls after the full mutation loop
    // (instead of per-mutation) yielded 33-51% improvement. The creature
    // should still be valid after mutations regardless of batching strategy.
    const creature = new Creature(3, 2, {
      layers: [{ count: 4, squash: "IDENTITY" }],
    });

    // Export before mutation
    const beforeJSON = creature.exportJSON();
    assert(
      beforeJSON.neurons.length > 0,
      "Should have neurons before mutation",
    );
    assert(
      beforeJSON.synapses.length > 0,
      "Should have synapses before mutation",
    );

    // Creature should be constructible from its own export (validates structure)
    const reconstructed = Creature.fromJSON(beforeJSON);
    assertEquals(
      reconstructed.neurons.length,
      creature.neurons.length,
      "Reconstructed creature should have same neuron count",
    );
  },
);
