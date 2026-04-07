import { assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { Synapse } from "@architecture/Synapse.ts";
import { TopologyError } from "@errors/TopologyError.ts";

/**
 * Validates that forward-only topology assertion fires unconditionally
 * after creature initialisation — not gated by DEBUG.
 *
 * Issue #2190: Production builds must verify that all synapses satisfy
 * `from < to` in forward-only creatures immediately after initialisation.
 */

Deno.test(
  "forward-only: initialisation assertion catches backward synapse",
  () => {
    // Create a valid forward-only creature, then tamper with a synapse
    // to simulate a backward connection that slipped through initialisation.
    const creature = new Creature(2, 1, { layers: [{ count: 2 }] });

    // Creature should be forward-only by default
    if (!creature.forwardOnly) {
      throw new Error("Expected creature to be forward-only by default");
    }

    // Directly inject a backward synapse to simulate a bug in initialisation.
    // We bypass connect() (which has its own guard) and push directly into
    // the synapses array, then call the validation method.
    const backwardSynapse = new Synapse(
      creature.input + 1, // from: second hidden neuron
      creature.input, // to: first hidden neuron (backward!)
      0.5,
    );

    creature.synapses.push(backwardSynapse);

    assertThrows(
      () => creature.assertForwardOnlyTopology(),
      TopologyError,
      "from < to",
    );
  },
);

Deno.test(
  "forward-only: initialisation assertion catches self-connection",
  () => {
    const creature = new Creature(2, 1, { layers: [{ count: 2 }] });

    const selfSynapse = new Synapse(
      creature.input, // from: first hidden neuron
      creature.input, // to: same neuron (self-connection!)
      0.5,
    );

    creature.synapses.push(selfSynapse);

    assertThrows(
      () => creature.assertForwardOnlyTopology(),
      TopologyError,
      "from < to",
    );
  },
);

Deno.test(
  "forward-only: valid creature passes initialisation assertion",
  () => {
    // A normally constructed creature should not throw
    const creature = new Creature(3, 2, { layers: [{ count: 3 }] });
    creature.assertForwardOnlyTopology(); // should not throw
  },
);

Deno.test(
  "feedback creature: initialisation assertion is a no-op",
  () => {
    const creature = new Creature(2, 1, {
      layers: [{ count: 1 }],
      feedbackEnabled: true,
    });

    // For non-forward-only creatures, the assertion should not throw
    // even if backward synapses exist
    creature.assertForwardOnlyTopology(); // should be a no-op
  },
);
