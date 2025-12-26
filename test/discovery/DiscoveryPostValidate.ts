import { assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import { validateAfterDiscoveryOrThrow } from "../../src/discovery/DiscoveryPostValidate.ts";

// cspell:ignore TESTDISC

Deno.test(
  "validateAfterDiscoveryOrThrow: throws for forward-only base when discovery result has back connection",
  () => {
    const base = new Creature(2, 1, { layers: [{ count: 1 }] });
    base.forwardOnly = true;
    base.semanticVersion = "4.0.0";

    const discovered = Creature.fromJSON(base.exportJSON());
    discovered.forwardOnly = true;
    discovered.semanticVersion = "4.0.0";

    const hiddenIndex = discovered.input; // first hidden neuron
    const outputIndex = discovered.neurons.length - 1;

    // Inject a back connection: output -> hidden (illegal in forward-only).
    discovered.synapses.push(new Synapse(outputIndex, hiddenIndex, 0.123));
    discovered.synapses.sort((
      a,
      b,
    ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

    assertThrows(
      () =>
        validateAfterDiscoveryOrThrow({
          baseCreature: base,
          discoveredCreature: discovered,
          discoveryID: "TESTDISC",
          operation: "unit-test",
          feedbackLoop: false,
        }),
      Error,
      "CRITICAL",
    );
  },
);

Deno.test(
  "validateAfterDiscoveryOrThrow: pre-4.x forward-only repairs corruption and upgrades to 4.x",
  () => {
    const base = new Creature(2, 1, { layers: [{ count: 1 }] });
    base.forwardOnly = true;
    base.semanticVersion = "2.0.0";

    const discovered = Creature.fromJSON(base.exportJSON());
    discovered.forwardOnly = true;
    discovered.semanticVersion = "2.0.0";

    const hiddenIndex = discovered.input; // first hidden neuron
    const outputIndex = discovered.neurons.length - 1;

    // Inject a back connection: output -> hidden (illegal in forward-only, but fixable pre-4.x).
    discovered.synapses.push(new Synapse(outputIndex, hiddenIndex, 0.123));
    discovered.synapses.sort((
      a,
      b,
    ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

    validateAfterDiscoveryOrThrow({
      baseCreature: base,
      discoveredCreature: discovered,
      discoveryID: "TESTDISC",
      operation: "unit-test",
      feedbackLoop: false,
    });

    // Should be repaired + upgraded once forward-only is confirmed.
    discovered.validate({ forwardOnly: true });
    if (!discovered.semanticVersion.startsWith("4.")) {
      throw new Error(
        `Expected semanticVersion to be bumped to 4.x after repair, got ${discovered.semanticVersion}`,
      );
    }
  },
);

Deno.test(
  "validateAfterDiscoveryOrThrow: hard invariant bumps discovered (2.x/3.x) to 4.x when base is 4.x",
  () => {
    const base = new Creature(2, 1, { layers: [{ count: 1 }] });
    base.forwardOnly = true;
    base.semanticVersion = "4.0.0";
    base.validate({ forwardOnly: true });

    // Simulate a discovered creature that lost its semanticVersion during
    // export/import (Australian English: this happens in distributed workflows).
    const discovered = Creature.fromJSON(base.exportJSON());
    discovered.forwardOnly = true;
    discovered.semanticVersion = "2.0.0";

    validateAfterDiscoveryOrThrow({
      baseCreature: base,
      discoveredCreature: discovered,
      discoveryID: "TESTDISC",
      operation: "unit-test",
      feedbackLoop: false,
    });

    // With a 4.x base, forward-only is a hard invariant; any validated result
    // should be marked + upgraded to 4.x for consistency.
    if (!discovered.semanticVersion.startsWith("4.")) {
      throw new Error(
        `Expected semanticVersion to be bumped to 4.x, got ${discovered.semanticVersion}`,
      );
    }
  },
);

Deno.test(
  "validateAfterDiscoveryOrThrow: does not throw when feedbackLoop is enabled and base is not forward-only",
  () => {
    const base = new Creature(2, 1, { layers: [{ count: 1 }] });
    base.forwardOnly = false;
    base.semanticVersion = "2.0.0";

    const discovered = Creature.fromJSON(base.exportJSON());
    discovered.forwardOnly = false;
    discovered.semanticVersion = "2.0.0";

    const hiddenIndex = discovered.input; // first hidden neuron
    const outputIndex = discovered.neurons.length - 1;

    // Back connection is allowed in recurrent mode.
    discovered.synapses.push(new Synapse(outputIndex, hiddenIndex, 0.123));
    discovered.synapses.sort((
      a,
      b,
    ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

    validateAfterDiscoveryOrThrow({
      baseCreature: base,
      discoveredCreature: discovered,
      discoveryID: "TESTDISC",
      operation: "unit-test",
      feedbackLoop: true,
    });
  },
);
