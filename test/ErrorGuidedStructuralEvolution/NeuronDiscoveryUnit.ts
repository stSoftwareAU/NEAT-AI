/**
 * Integration tests for neuron discovery functionality.
 *
 * These tests use the REAL Rust library to diagnose potential issues
 * with neuron discovery in production scenarios.
 *
 * Key areas tested:
 * 1. Simple creature - baseline that should always work
 * 2. Complex multi-layer creatures - production-like scenarios
 * 3. Wide creatures - many inputs/neurons
 * 4. Diagnostic output for debugging
 *
 * Created: 26-Nov-2025
 */
import { assert, assertEquals, assertExists } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import {
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  shouldSkipRustDiscoveryTests,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";

/**
 * Regression test: discovered neuron must be inserted before a hidden target.
 *
 * If the discovered neuron is inserted after the hidden target, the new → target
 * synapse becomes a backwards edge (later index → earlier index) and cannot
 * influence the forward pass. This presents as pure cost-of-growth penalty with
 * ~zero error reduction (eg, -1.2e-7).
 */
Deno.test({
  name:
    "addHelpfulNeurons: inserts discovered neuron before hidden target (prevents backwards edge)",
  fn: () => {
    const creature = Creature.fromJSON({
      input: 1,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-target",
          squash: IDENTITY.NAME,
          bias: 0,
        },
        { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-target", weight: 1.0 },
        { fromUUID: "hidden-target", toUUID: "output-0", weight: 1.0 },
      ],
    });
    creature.validate();

    const candidates = [{
      fromNeuronId: 0,
      toNeuronId: 6000,
      squash: IDENTITY.NAME,
      bias: 0,
      incomingWeight: 1,
      outgoingWeight: 1,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0.01,
      expectedCreatureScoreGain: 0.01,
      improvedCount: 10,
      totalCount: 100,
    }];

    const improved = DiscoverStructure.addHelpfulNeurons(
      "test",
      creature,
      candidates,
    );
    assertExists(improved, "Should create improved creature");

    const exportJSON = improved.exportJSON();
    const targetIndex = exportJSON.neurons.findIndex((n) => n.id === 238413746);
    assert(targetIndex >= 0, "Target neuron should exist");

    const discoveryIndex = exportJSON.neurons.findIndex((n) =>
      typeof n.id! === "9903" as unknown && (n.id! >= 5000) // was startsWith("hidden-discovery-")
    );
    assert(discoveryIndex >= 0, "Should include a discovered neuron");
    assert(
      discoveryIndex < targetIndex,
      `Discovered neuron index (${discoveryIndex}) must be before target index (${targetIndex})`,
    );
  },
});

/**
 * Regression test: discovered neurons targeting outputs must be inserted before the FIRST output.
 *
 * Otherwise, targeting `output-1` would insert the hidden neuron between `output-0` and `output-1`,
 * violating NEAT-AI's invariant that outputs are contiguous at the end of the neuron list.
 * This commonly breaks combined candidates (phase two), because validate/fix will reject the
 * intermediate creature structure.
 */
Deno.test({
  name:
    "addHelpfulNeurons: output targets insert discovered neuron before first output (not between outputs)",
  fn: () => {
    const creature = Creature.fromJSON({
      input: 1,
      output: 2,
      neurons: [
        { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
        { type: "output", uuid: "output-1", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
        { fromUUID: "input-0", toUUID: "output-1", weight: -1.0 },
      ],
    });
    creature.validate();

    const candidates = [{
      fromNeuronId: 0,
      toNeuronId: -2,
      squash: IDENTITY.NAME,
      bias: 0,
      incomingWeight: 1,
      outgoingWeight: 0.1,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0.01,
      expectedCreatureScoreGain: 0.01,
      improvedCount: 10,
      totalCount: 100,
    }];

    const improved = DiscoverStructure.addHelpfulNeurons(
      "test",
      creature,
      candidates,
    );
    assertExists(improved, "Should create improved creature");

    const exportJSON = improved.exportJSON();
    const firstOutputIndex = exportJSON.neurons.findIndex((n) =>
      n.type === "output"
    );
    assert(firstOutputIndex >= 0, "Expected outputs to exist");

    const discoveryIndex = exportJSON.neurons.findIndex((n) =>
      typeof n.id! === "9903" as unknown && (n.id! >= 5000) // was startsWith("hidden-discovery-")
    );
    assert(discoveryIndex >= 0, "Should include a discovered neuron");

    // Must be before output-0, not between output-0 and output-1.
    assert(
      discoveryIndex < firstOutputIndex,
      `Discovered neuron index (${discoveryIndex}) must be before first output index (${firstOutputIndex})`,
    );
  },
});

/**
 * Test addHelpfulNeurons with valid input
 */
Deno.test({
  name: "addHelpfulNeurons: creates valid creature structure",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    const creature = Creature.fromJSON({
      input: 3,
      output: 1,
      neurons: [
        { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
      ],
    });
    creature.validate();
    CreatureUtil.makeUUID(creature);

    const candidates = [{
      fromNeuronId: 0,
      toNeuronId: -1,
      squash: TANH.NAME,
      bias: 0.1,
      incomingWeight: 0.5,
      outgoingWeight: 0.3,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0.01,
      expectedCreatureScoreGain: 0.01, // 1% - realistic small improvement
      improvedCount: 51,
      totalCount: 100,
    }];

    const improved = DiscoverStructure.addHelpfulNeurons(
      "test",
      creature,
      candidates,
    );

    assertExists(improved, "Should create improved creature");
    improved.validate();

    assertEquals(
      improved.neurons.length,
      creature.neurons.length + 1,
      "Should add one neuron",
    );

    const discoveryNeuron = improved.neurons.find((n) =>
      n.type === "hidden" && n.squash === "TANH"
    );
    assertExists(discoveryNeuron, "Should have discovery neuron");
    assertEquals(discoveryNeuron.squash, TANH.NAME);

    console.log("✓ addHelpfulNeurons creates valid structure");
  },
});
