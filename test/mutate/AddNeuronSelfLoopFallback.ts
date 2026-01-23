import { assert, assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { Creature } from "../../src/Creature.ts";
import { Neuron } from "../../src/architecture/Neuron.ts";
import { AddNeuron } from "../../src/mutate/AddNeuron.ts";

/**
 * Regression coverage:
 *
 * In recurrent-capable mode (ie `forwardOnly` is unset), `AddNeuron` may fall back
 * to a self-loop as the *last resort* outward connection if all forward targets
 * are exhausted/unavailable.
 *
 * This is defensive: the normal path should always find a forward target, but we
 * must not throw in recurrent mode when a self-connection is valid.
 */
Deno.test("AddNeuron: recurrent mode can fall back to a self-loop as last resort", () => {
  // No hidden layers: the newly added neuron is the only hidden neuron, which
  // makes it easy to identify during the mutation.
  const creature = new Creature(2, 1, { layers: [] });

  // Recurrent-capable mode.
  assertEquals(creature.forwardOnly, undefined);

  const originalGetSynapse = creature.getSynapse.bind(creature);
  const originalNeuronFix = Neuron.prototype.fix;
  let insertedHiddenIndex: number | undefined;

  // Make the mutation deterministic:
  // - Ensure `toIndex` is a forward target (not the new neuron's own index),
  //   so we don't "accidentally" pick a self-loop via the primary path.
  // Use stub for proper mock isolation in parallel test environments.
  const randomSeq = [
    0.5, // Neuron bias
    0.2, // Hidden neuron's squash selection
    0.1, // New neuron index (range is 1, so this is stable)
    0.1, // fromIndex selection (pos 0)
    0.6, // toIndex selection (pos > neuron.index)
  ];
  let randomIdx = 0;
  const randomStub = stub(Math, "random", () => randomSeq[randomIdx++] ?? 0.1);

  try {
    // For this regression we intentionally disable `Neuron.fix()` so we can
    // prove `AddNeuron` itself handles the last-resort outward-connection
    // behaviour (rather than relying on neuron-level repairs).
    Neuron.prototype.fix = function () {
      // no-op
    };

    // Simulate an edge case where forward targets are "exhausted" from the new
    // neuron by making `getSynapse()` *pretend* every forward target already has
    // a connection, while still allowing a self-loop.
    //
    // This reproduces the real-world effect of stale caches / corrupted state
    // where AddNeuron's forward-only fallback search cannot find a usable target.
    creature.getSynapse = ((from: number, to: number) => {
      if (insertedHiddenIndex === undefined) {
        insertedHiddenIndex = creature.neurons.find((n) => n.type === "hidden")
          ?.index;
      }

      if (insertedHiddenIndex !== undefined && from === insertedHiddenIndex) {
        // Allow self-loop to be created as a last resort.
        if (to === insertedHiddenIndex) return null;
        // Block all forward targets by pretending they already exist.
        return {} as unknown as ReturnType<typeof originalGetSynapse>;
      }

      return originalGetSynapse(from, to);
    }) as typeof creature.getSynapse;

    const addNeuron = new AddNeuron(creature);
    const changed = addNeuron.mutate();

    assertEquals(changed, true);

    const hidden = creature.neurons.find((n) => n.type === "hidden");
    assert(hidden, "Expected a hidden neuron to be added");
    assert(
      creature.synapses.some((s) =>
        s.from === hidden.index && s.to === hidden.index
      ),
      "Expected a self-loop synapse as the last resort outward connection",
    );

    // Default validation allows recurrent connections.
    creature.validate();
  } finally {
    Neuron.prototype.fix = originalNeuronFix;
    randomStub.restore();
    creature.getSynapse = originalGetSynapse as typeof creature.getSynapse;
  }
});
