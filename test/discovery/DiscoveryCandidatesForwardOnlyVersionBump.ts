import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { buildCombinedFromSuccessful } from "@discovery/DiscoveryCandidates.ts";
import type { DiscoveryCandidate } from "@discovery/DiscoveryCandidates.ts";

// cspell:ignore TESTDISC

Deno.test(
  "buildCombinedFromSuccessful: forward-only preserved through discovery",
  () => {
    const base = new Creature(2, 1, { layers: [{ count: 1 }] });
    assertEquals(base.forwardOnly, true);
    base.validate({ forwardOnly: true });

    const baseJSON = base.exportJSON();

    const hidden = baseJSON.neurons.find((n) => n.type === "hidden");
    const output = baseJSON.neurons.find((n) => n.type === "output");
    assert(hidden, "Expected a hidden neuron in the base creature");
    assert(output, "Expected an output neuron in the base creature");

    const hiddenAltSquash = hidden.squash === "TANH" ? "IDENTITY" : "TANH";
    const outputAltSquash = output.squash === "TANH" ? "IDENTITY" : "TANH";

    const candidateAJSON = structuredClone(baseJSON);
    const candidateAHidden = candidateAJSON.neurons.find((n) =>
      n.type === "hidden"
    );
    assert(candidateAHidden);
    candidateAHidden.squash = hiddenAltSquash;
    const candidateACreature = Creature.fromJSON(candidateAJSON);

    const candidateA: DiscoveryCandidate = {
      creature: candidateACreature,
      change: {
        type: "change-squash",
        description: "Change hidden squash",
      },
    };

    const candidateBJSON = structuredClone(baseJSON);
    const candidateBHidden = candidateBJSON.neurons.find((n) =>
      n.type === "hidden"
    );
    const candidateBOutput = candidateBJSON.neurons.find((n) =>
      n.type === "output"
    );
    assert(candidateBHidden);
    assert(candidateBOutput);
    candidateBHidden.squash = hiddenAltSquash;
    candidateBOutput.squash = outputAltSquash;
    const candidateBCreature = Creature.fromJSON(candidateBJSON);

    const candidateB: DiscoveryCandidate = {
      creature: candidateBCreature,
      change: {
        type: "change-squash",
        description: "Change output squash",
      },
    };

    const combined = buildCombinedFromSuccessful(base, "TESTDISC", [
      candidateA,
      candidateB,
    ]);

    assert(combined.length > 0, "Expected at least one combined candidate");
    for (const c of combined) {
      c.creature.validate({ forwardOnly: true });
      assertEquals(
        c.creature.forwardOnly,
        true,
        "Expected forwardOnly to remain true after combining candidates",
      );
    }
  },
);
