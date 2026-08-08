import { assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { Synapse } from "@architecture/Synapse.ts";
import { validateAfterDiscoveryOrThrow } from "@discovery/DiscoveryPostValidate.ts";

// cspell:ignore TESTDISC

Deno.test(
  "validateAfterDiscoveryOrThrow: throws for forward-only base when discovery result has back connection",
  () => {
    const base = new Creature(2, 1, { layers: [{ count: 1 }] });

    const discovered = Creature.fromJSON(base.exportJSON());

    const hiddenIndex = discovered.input;
    const outputIndex = discovered.neurons.length - 1;

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
  "validateAfterDiscoveryOrThrow: valid forward-only creature passes",
  () => {
    const base = new Creature(2, 1, { layers: [{ count: 1 }] });
    base.validate({ forwardOnly: true });

    const discovered = Creature.fromJSON(base.exportJSON());

    validateAfterDiscoveryOrThrow({
      baseCreature: base,
      discoveredCreature: discovered,
      discoveryID: "TESTDISC",
      operation: "unit-test",
      feedbackLoop: false,
    });
  },
);

Deno.test(
  "validateAfterDiscoveryOrThrow: does not throw when feedbackLoop is enabled and base is not forward-only",
  () => {
    const base = new Creature(2, 1, {
      layers: [{ count: 1 }],
      feedbackEnabled: true,
    });

    const discovered = Creature.fromJSON(base.exportJSON());

    const hiddenIndex = discovered.input;
    const outputIndex = discovered.neurons.length - 1;

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

Deno.test(
  "DiscoveryPostValidate exports only the live post-validation helper (Issue #3687)",
  async () => {
    const surface: Record<string, unknown> = await import(
      "@discovery/DiscoveryPostValidate.ts"
    );

    assertEquals(
      Object.hasOwn(surface, "validateDiscoveryCandidatesBatch"),
      false,
      "The unused batch wrapper must not be exported; callers use BatchDiscoveryValidator directly",
    );
    assertEquals(
      Object.hasOwn(surface, "BatchDiscoveryValidator"),
      false,
      "The convenience re-export must not be exported; callers import @discovery/BatchDiscoveryValidator.ts directly",
    );

    // The live surface stays intact.
    assertEquals(
      typeof surface.validateAfterDiscoveryOrThrow,
      "function",
      "validateAfterDiscoveryOrThrow must remain exported",
    );
  },
);
