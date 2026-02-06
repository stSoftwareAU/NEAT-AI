import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  coordinateBiasWeightAdjustments,
  type NeuronAdjustmentPlan,
} from "../../src/blackbox/BiasWeightCoordination.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test(
  "coordinateBiasWeightAdjustments - returns empty when no changes",
  () => {
    const plan: NeuronAdjustmentPlan = {
      neuronUUID: "hidden-1",
      originalBias: 0.5,
      candidateBias: 0.5, // No change
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "hidden-1",
          originalWeight: 0.3,
          candidateWeight: 0.3, // No change
        },
      ],
    };

    const result = coordinateBiasWeightAdjustments(plan);
    assertEquals(result.adjustedBias, 0.5, "Bias should remain unchanged");
    assertEquals(result.changed, false, "Should report no changes");
  },
);

Deno.test(
  "coordinateBiasWeightAdjustments - passes through bias-only change",
  () => {
    const plan: NeuronAdjustmentPlan = {
      neuronUUID: "hidden-1",
      originalBias: 0.5,
      candidateBias: 0.6,
      synapses: [],
    };

    const result = coordinateBiasWeightAdjustments(plan);
    assertEquals(result.adjustedBias, 0.6, "Bias change should pass through");
    assertEquals(result.changed, true, "Should report changes");
  },
);

Deno.test(
  "coordinateBiasWeightAdjustments - passes through weight-only change",
  () => {
    const plan: NeuronAdjustmentPlan = {
      neuronUUID: "hidden-1",
      originalBias: 0.5,
      candidateBias: 0.5, // No bias change
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "hidden-1",
          originalWeight: 0.3,
          candidateWeight: 0.4, // Weight changed
        },
      ],
    };

    const result = coordinateBiasWeightAdjustments(plan);
    assertEquals(result.adjustedBias, 0.5, "Bias should remain unchanged");
    assertEquals(
      result.adjustedWeights.length,
      1,
      "Should have one weight adjustment",
    );
    assertEquals(
      result.adjustedWeights[0].weight,
      0.4,
      "Weight change should pass through",
    );
    assertEquals(result.changed, true, "Should report changes");
  },
);

Deno.test(
  "coordinateBiasWeightAdjustments - ensures net effect when bias and weights both change",
  () => {
    // When both bias and weights change, coordination should ensure a meaningful
    // net effect rather than allowing changes to cancel out
    const plan: NeuronAdjustmentPlan = {
      neuronUUID: "hidden-1",
      originalBias: 1.0,
      candidateBias: 1.1, // Bias increased by 0.1
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "hidden-1",
          originalWeight: 0.5,
          candidateWeight: 0.6, // Weight also changed
        },
        {
          fromUUID: "input-1",
          toUUID: "hidden-1",
          originalWeight: -0.3,
          candidateWeight: -0.2, // Another weight changed
        },
      ],
    };

    const result = coordinateBiasWeightAdjustments(plan);
    assertEquals(result.changed, true, "Should report changes");

    // The coordinated result should produce adjusted values
    const biasChanged = result.adjustedBias !== plan.originalBias;
    const anyWeightChanged = result.adjustedWeights.some(
      (w, i) => w.weight !== plan.synapses[i].originalWeight,
    );
    assert(
      biasChanged || anyWeightChanged,
      "At least bias or weights should be adjusted",
    );
  },
);

Deno.test(
  "coordinateBiasWeightAdjustments - distributes change across bias and weights",
  () => {
    // The coordinated adjustments should use both bias and weights
    // to distribute the desired effect
    const plan: NeuronAdjustmentPlan = {
      neuronUUID: "hidden-1",
      originalBias: 0.0,
      candidateBias: 0.2, // Significant bias change
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "hidden-1",
          originalWeight: 1.0,
          candidateWeight: 1.05,
        },
      ],
    };

    const result = coordinateBiasWeightAdjustments(plan);
    assertEquals(result.changed, true, "Should have changes");

    // The result should have a bias adjustment
    assertNotEquals(
      result.adjustedBias,
      plan.originalBias,
      "Bias should be adjusted",
    );
  },
);

Deno.test(
  "coordinateBiasWeightAdjustments - preserves all synapse metadata",
  () => {
    const plan: NeuronAdjustmentPlan = {
      neuronUUID: "hidden-1",
      originalBias: 0.5,
      candidateBias: 0.6,
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "hidden-1",
          originalWeight: 0.3,
          candidateWeight: 0.4,
        },
        {
          fromUUID: "input-1",
          toUUID: "hidden-1",
          originalWeight: -0.5,
          candidateWeight: -0.4,
        },
      ],
    };

    const result = coordinateBiasWeightAdjustments(plan);
    assertEquals(
      result.adjustedWeights.length,
      2,
      "Should return all synapses",
    );
    assertEquals(
      result.adjustedWeights[0].fromUUID,
      "input-0",
      "Should preserve fromUUID",
    );
    assertEquals(
      result.adjustedWeights[0].toUUID,
      "hidden-1",
      "Should preserve toUUID",
    );
    assertEquals(
      result.adjustedWeights[1].fromUUID,
      "input-1",
      "Should preserve second fromUUID",
    );
  },
);

Deno.test(
  "coordinateBiasWeightAdjustments - handles single synapse coordination",
  () => {
    const plan: NeuronAdjustmentPlan = {
      neuronUUID: "output-0",
      originalBias: 1.0,
      candidateBias: 1.5, // Large bias change
      synapses: [
        {
          fromUUID: "hidden-1",
          toUUID: "output-0",
          originalWeight: 2.0,
          candidateWeight: 2.3, // Weight also changing
        },
      ],
    };

    const result = coordinateBiasWeightAdjustments(plan);
    assertEquals(result.changed, true, "Should report changes");

    // Both bias and weight should have meaningful adjustments
    const biasDelta = Math.abs(result.adjustedBias - plan.originalBias);
    assert(biasDelta > 0, "Bias should be adjusted");
  },
);

Deno.test(
  "coordinateBiasWeightAdjustments - results are finite numbers",
  () => {
    const plan: NeuronAdjustmentPlan = {
      neuronUUID: "hidden-1",
      originalBias: 0.5,
      candidateBias: 0.7,
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "hidden-1",
          originalWeight: 0.0,
          candidateWeight: 0.1,
        },
        {
          fromUUID: "input-1",
          toUUID: "hidden-1",
          originalWeight: 0.0,
          candidateWeight: -0.05,
        },
      ],
    };

    const result = coordinateBiasWeightAdjustments(plan);
    assert(Number.isFinite(result.adjustedBias), "Bias should be finite");
    for (const w of result.adjustedWeights) {
      assert(Number.isFinite(w.weight), `Weight should be finite: ${w.weight}`);
    }
  },
);

Deno.test(
  "coordinateBiasWeightAdjustments - no synapses with changed bias works",
  () => {
    const plan: NeuronAdjustmentPlan = {
      neuronUUID: "output-0",
      originalBias: 0.0,
      candidateBias: 0.1,
      synapses: [],
    };

    const result = coordinateBiasWeightAdjustments(plan);
    assertEquals(result.adjustedBias, 0.1, "Bias change should pass through");
    assertEquals(
      result.adjustedWeights.length,
      0,
      "No weight adjustments expected",
    );
    assertEquals(result.changed, true, "Should report changes");
  },
);

Deno.test(
  "coordinateBiasWeightAdjustments - unchanged synapses not forced to change",
  () => {
    // When a synapse has no candidate change, coordination should not
    // force it to change unless redistribution is needed
    const plan: NeuronAdjustmentPlan = {
      neuronUUID: "hidden-1",
      originalBias: 0.5,
      candidateBias: 0.6, // Only bias changes
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "hidden-1",
          originalWeight: 0.3,
          candidateWeight: 0.3, // No change
        },
        {
          fromUUID: "input-1",
          toUUID: "hidden-1",
          originalWeight: -0.5,
          candidateWeight: -0.4, // Changed
        },
      ],
    };

    const result = coordinateBiasWeightAdjustments(plan);
    assertEquals(result.changed, true, "Should report changes");
    // The unchanged synapse should remain unchanged
    assertEquals(
      result.adjustedWeights[0].weight,
      0.3,
      "Unchanged synapse should remain unchanged",
    );
  },
);

Deno.test(
  "coordinateBiasWeightAdjustments - reduces opposing changes to prevent cancellation",
  () => {
    // Bias increases (+0.5) while net weight change is negative (-0.6)
    // These oppose each other. Coordination should reduce the smaller force.
    const plan: NeuronAdjustmentPlan = {
      neuronUUID: "hidden-1",
      originalBias: 1.0,
      candidateBias: 1.5, // Bias increases by +0.5 (smaller opposing force)
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "hidden-1",
          originalWeight: 0.8,
          candidateWeight: 0.5, // Weight decreases by -0.3
        },
        {
          fromUUID: "input-1",
          toUUID: "hidden-1",
          originalWeight: 0.5,
          candidateWeight: 0.2, // Weight decreases by -0.3
        },
      ],
    };

    const result = coordinateBiasWeightAdjustments(plan);
    assertEquals(result.changed, true, "Should report changes");

    // The bias (smaller opposing force) should be reduced
    const biasDelta = result.adjustedBias - plan.originalBias;
    const candidateBiasDelta = plan.candidateBias - plan.originalBias;
    assert(
      Math.abs(biasDelta) < Math.abs(candidateBiasDelta),
      `Opposing bias delta ${biasDelta} should be reduced from candidate ${candidateBiasDelta}`,
    );

    // Weights (larger opposing force) should be preserved
    assertEquals(
      result.adjustedWeights[0].weight,
      0.5,
      "Larger opposing weight changes should be preserved",
    );
    assertEquals(
      result.adjustedWeights[1].weight,
      0.2,
      "Larger opposing weight changes should be preserved",
    );
  },
);

Deno.test(
  "coordinateBiasWeightAdjustments - aligned changes pass through unchanged",
  () => {
    // Bias increases (+0.3) and net weight change is also positive (+0.5)
    // These are aligned and should reinforce each other - pass through
    const plan: NeuronAdjustmentPlan = {
      neuronUUID: "hidden-1",
      originalBias: 1.0,
      candidateBias: 1.3, // Bias increases by +0.3
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "hidden-1",
          originalWeight: 0.5,
          candidateWeight: 0.8, // Weight increases by +0.3
        },
        {
          fromUUID: "input-1",
          toUUID: "hidden-1",
          originalWeight: 0.2,
          candidateWeight: 0.4, // Weight increases by +0.2
        },
      ],
    };

    const result = coordinateBiasWeightAdjustments(plan);
    assertEquals(result.changed, true, "Should report changes");

    // All changes should pass through (aligned)
    assertEquals(
      result.adjustedBias,
      1.3,
      "Aligned bias should pass through",
    );
    assertEquals(
      result.adjustedWeights[0].weight,
      0.8,
      "Aligned weight should pass through",
    );
    assertEquals(
      result.adjustedWeights[1].weight,
      0.4,
      "Aligned weight should pass through",
    );
  },
);

Deno.test(
  "coordinateBiasWeightAdjustments - reduces opposing weights when bias is larger",
  () => {
    // Bias decreases by -0.8 (larger) while net weight increases by +0.3 (smaller)
    // Weights are the smaller opposing force and should be reduced
    const plan: NeuronAdjustmentPlan = {
      neuronUUID: "hidden-1",
      originalBias: 2.0,
      candidateBias: 1.2, // Bias decreases by -0.8 (larger opposing force)
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "hidden-1",
          originalWeight: 0.5,
          candidateWeight: 0.8, // Weight increases by +0.3 (smaller opposing force)
        },
      ],
    };

    const result = coordinateBiasWeightAdjustments(plan);
    assertEquals(result.changed, true, "Should report changes");

    // Bias (larger force) should be preserved
    assertEquals(
      result.adjustedBias,
      1.2,
      "Larger opposing bias should be preserved",
    );

    // Weight (smaller opposing force) should be reduced
    const weightDelta = result.adjustedWeights[0].weight -
      plan.synapses[0].originalWeight;
    const candidateWeightDelta = plan.synapses[0].candidateWeight -
      plan.synapses[0].originalWeight;
    assert(
      Math.abs(weightDelta) < Math.abs(candidateWeightDelta),
      `Opposing weight delta ${weightDelta} should be reduced from candidate ${candidateWeightDelta}`,
    );
  },
);
