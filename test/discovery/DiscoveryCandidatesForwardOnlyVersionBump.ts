import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { buildCombinedFromSuccessful } from "../../src/discovery/DiscoveryCandidates.ts";
import type { DiscoveryCandidate } from "../../src/discovery/DiscoveryCandidates.ts";

// cspell:ignore TESTDISC

Deno.test(
  "buildCombinedFromSuccessful: forward-only pre-4.x should be bumped to 4.x even when validation succeeds (no fix path)",
  () => {
    // Arrange: a forward-only creature that is already valid but still marked as 2.x.
    const base = new Creature(2, 1, { layers: [{ count: 1 }] });
    base.forwardOnly = true;
    base.semanticVersion = "2.0.0";
    base.validate({ forwardOnly: true });

    const baseJSON = base.exportJSON();

    const hidden = baseJSON.neurons.find((n) => n.type === "hidden");
    const output = baseJSON.neurons.find((n) => n.type === "output");
    assert(hidden, "Expected a hidden neuron in the base creature");
    assert(output, "Expected an output neuron in the base creature");

    // Pick alternate squashes so we guarantee a change regardless of defaults.
    const hiddenAltSquash = hidden.squash === "TANH" ? "IDENTITY" : "TANH";
    const outputAltSquash = output.squash === "TANH" ? "IDENTITY" : "TANH";

    // Candidate A: change the hidden squash only.
    const candidateAJSON = structuredClone(baseJSON);
    const candidateAHidden = candidateAJSON.neurons.find((n) =>
      n.type === "hidden"
    );
    assert(candidateAHidden);
    candidateAHidden.squash = hiddenAltSquash;
    const candidateACreature = Creature.fromJSON(candidateAJSON);
    candidateACreature.forwardOnly = true;
    candidateACreature.semanticVersion = "2.0.0";

    const candidateA: DiscoveryCandidate = {
      creature: candidateACreature,
      change: {
        type: "change-squash",
        description: "Change hidden squash",
      },
    };

    // Candidate B: change output squash, but also include the hidden change so a
    // combination doesn't accidentally revert the earlier change.
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
    candidateBCreature.forwardOnly = true;
    candidateBCreature.semanticVersion = "2.0.0";

    const candidateB: DiscoveryCandidate = {
      creature: candidateBCreature,
      change: {
        type: "change-squash",
        description: "Change output squash",
      },
    };

    // Act: build combinations, which applies changes and runs validateAndFixCreatureSync().
    const combined = buildCombinedFromSuccessful(base, "TESTDISC", [
      candidateA,
      candidateB,
    ]);

    // Assert: a combination is produced, remains forward-only valid, and is bumped to 4.x.
    assert(combined.length > 0, "Expected at least one combined candidate");
    for (const c of combined) {
      c.creature.validate({ forwardOnly: true });
      assertEquals(
        c.creature.forwardOnly,
        true,
        "Expected forwardOnly to remain true after combining candidates",
      );
      assert(
        c.creature.semanticVersion.startsWith("4."),
        `Expected semanticVersion to be bumped to 4.x, got ${c.creature.semanticVersion}`,
      );
    }
  },
);
