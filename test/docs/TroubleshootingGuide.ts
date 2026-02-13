/**
 * Issue #1403: Tests verifying behaviours documented in docs/TROUBLESHOOTING.md.
 *
 * Each test exercises real code paths that produce the error messages and
 * behaviours described in the troubleshooting guide, ensuring the guide
 * stays accurate as the codebase evolves.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import {
  initWasmActivation,
  isWasmActivationAvailable,
} from "../../src/wasm/mod.ts";

// ---------------------------------------------------------------------------
// Section: WASM Troubleshooting
// ---------------------------------------------------------------------------

Deno.test(
  "troubleshooting - WASM activation initialises and is available",
  async () => {
    // The troubleshooting guide documents that WASM initialises automatically.
    // Ensure WASM is initialised before checking availability.
    const result = await initWasmActivation();
    assert(result, "WASM module should initialise successfully");
    assert(
      isWasmActivationAvailable(),
      "WASM activation should be available after initialisation",
    );
  },
);

Deno.test(
  "troubleshooting - Creature.activate() works when WASM is loaded",
  async () => {
    // Documented behaviour: activation uses WASM and works transparently.
    await initWasmActivation();
    const creature = new Creature(2, 1, {
      layers: [{ count: 2, squash: "IDENTITY" }],
    });
    const output = creature.activate(new Float32Array([0.5, 0.3]));
    assertEquals(output.length, 1, "Should produce exactly one output");
    assertEquals(typeof output[0], "number", "Output should be a number");
  },
);

// ---------------------------------------------------------------------------
// Section: Configuration Troubleshooting
// ---------------------------------------------------------------------------

Deno.test(
  "troubleshooting - feedbackLoop without disableRandomSamples throws",
  () => {
    // Documented: feedbackLoop: true requires disableRandomSamples: true
    const error = assertThrows(
      () =>
        createNeatConfig({
          feedbackLoop: true,
          disableRandomSamples: false,
        }),
      Error,
    );
    assertStringIncludes(
      error.message,
      "Feedback Loop, Disable Random Samples must be set together",
    );
  },
);

Deno.test(
  "troubleshooting - adaptive mutation thresholds must be ordered",
  () => {
    // Documented: large threshold must exceed medium threshold
    const error = assertThrows(
      () =>
        createNeatConfig({
          adaptiveMutationThresholds: { large: 5, medium: 10 },
        }),
      Error,
    );
    assertStringIncludes(
      error.message,
      "Adaptive mutation large threshold must be greater than medium threshold",
    );
  },
);

Deno.test(
  "troubleshooting - plateau detection rates must be ordered",
  () => {
    // Documented: rapidImprovementRate must exceed minImprovementRate
    const error = assertThrows(
      () =>
        createNeatConfig({
          plateauDetection: {
            rapidImprovementRate: 0.001,
            minImprovementRate: 0.05,
          },
        }),
      Error,
    );
    assertStringIncludes(
      error.message,
      "Plateau detection rapidImprovementRate must be greater than minImprovementRate",
    );
  },
);

Deno.test(
  "troubleshooting - valid config creates without error",
  () => {
    // Documented: default configuration should always be valid
    const config = createNeatConfig({});
    assert(config, "Default config should be created successfully");
    assertEquals(typeof config.populationSize, "number");
  },
);

// ---------------------------------------------------------------------------
// Section: Forward-Only vs Recurrent Troubleshooting
// ---------------------------------------------------------------------------

Deno.test(
  "troubleshooting - forward-only mode rejects recursive synapses",
  () => {
    // Documented: forward-only creatures cannot have backward connections
    const creature = new Creature(2, 1, {
      layers: [{ count: 3, squash: "IDENTITY" }],
    });

    // Add a backward synapse (from higher index to lower index hidden neuron)
    creature.synapses.push(new Synapse(4, 3, 0.5));
    creature.synapses.sort((a, b) => {
      if (a.from === b.from) return a.to - b.to;
      return a.from - b.from;
    });

    try {
      creatureValidate(creature, { feedbackLoop: false });
      throw new Error("Expected RECURSIVE_SYNAPSE validation error");
    } catch (e) {
      const error = e as Error;
      assertEquals(
        error.name,
        "RECURSIVE_SYNAPSE",
        `Expected RECURSIVE_SYNAPSE but got: ${error.name}: ${error.message}`,
      );
    }
  },
);

Deno.test(
  "troubleshooting - forward-only mode rejects self-connections",
  () => {
    // Documented: self-loops are forbidden in forward-only mode.
    // The forwardOnly option must be explicitly set to true for self-connection
    // rejection (feedbackLoop: false only checks backward connections).
    const creature = new Creature(2, 1, {
      layers: [{ count: 2, squash: "IDENTITY" }],
    });

    // Add a self-connection on a hidden neuron
    const hiddenIndex = 2; // First hidden neuron (after 2 inputs)
    creature.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.5));
    creature.synapses.sort((a, b) => {
      if (a.from === b.from) return a.to - b.to;
      return a.from - b.from;
    });

    try {
      creatureValidate(creature, { forwardOnly: true });
      throw new Error("Expected SELF_CONNECTION validation error");
    } catch (e) {
      const error = e as Error;
      assertEquals(
        error.name,
        "SELF_CONNECTION",
        `Expected SELF_CONNECTION but got: ${error.name}: ${error.message}`,
      );
    }
  },
);

Deno.test(
  "troubleshooting - recurrent mode allows backward connections",
  () => {
    // Documented: when feedbackLoop is enabled, backward connections are allowed
    const creature = new Creature(2, 1, {
      layers: [{ count: 3, squash: "IDENTITY" }],
    });

    // Add a backward synapse
    creature.synapses.push(new Synapse(4, 3, 0.5));
    creature.synapses.sort((a, b) => {
      if (a.from === b.from) return a.to - b.to;
      return a.from - b.from;
    });

    // Should not throw with feedbackLoop enabled
    creatureValidate(creature, { feedbackLoop: true });
  },
);

// ---------------------------------------------------------------------------
// Section: Validation Error Types
// ---------------------------------------------------------------------------

Deno.test(
  "troubleshooting - hidden neuron without outward connections",
  () => {
    // Documented: hidden neurons must have outward connections
    const json: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "hidden-0", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
        // hidden-0 has no outward connection to output-0
        { fromUUID: "input-1", toUUID: "output-0", weight: 0.5 },
      ],
    };
    const creature = Creature.fromJSON(json);

    try {
      creatureValidate(creature);
      throw new Error("Expected NO_OUTWARD_CONNECTIONS validation error");
    } catch (e) {
      const error = e as Error;
      assertEquals(
        error.name,
        "NO_OUTWARD_CONNECTIONS",
        `Expected NO_OUTWARD_CONNECTIONS but got: ${error.name}: ${error.message}`,
      );
    }
  },
);

Deno.test(
  "troubleshooting - hidden neuron without inward connections",
  () => {
    // Documented: hidden neurons must have inward connections
    const json: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "hidden-0", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        // hidden-0 has no inward connection
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
      ],
    };
    const creature = Creature.fromJSON(json);

    try {
      creatureValidate(creature);
      throw new Error("Expected NO_INWARD_CONNECTIONS validation error");
    } catch (e) {
      const error = e as Error;
      assertEquals(
        error.name,
        "NO_INWARD_CONNECTIONS",
        `Expected NO_INWARD_CONNECTIONS but got: ${error.name}: ${error.message}`,
      );
    }
  },
);
