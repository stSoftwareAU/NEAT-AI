import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { SubNeuron } from "../../src/mutate/SubNeuron.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Topology that exposes the cascade cleanup bug:
 *
 *   input-0 → C → A ⟶ X → output
 *   input-1 → D → B ⟶ X
 *   input-0 → output  (direct path keeps output valid)
 *
 * When SubNeuron removes X, both A and B lose outward connections and
 * enter `toRemove`. The inner loop processes them descending. If only
 * the last removal's neighbour tracking is preserved, D (B's only
 * source) is never cascade-checked and is left as an orphan hidden
 * neuron with no outward connections — a validation error.
 */
Deno.test(
  "SubNeuron - cascade cleanup handles multiple orphaned branches",
  () => {
    const json = {
      input: 2,
      output: 1,
      neurons: [
        { type: "hidden" as const, squash: "LOGISTIC", bias: 0.1, index: 2 }, // C
        { type: "hidden" as const, squash: "LOGISTIC", bias: 0.2, index: 3 }, // D
        { type: "hidden" as const, squash: "LOGISTIC", bias: 0.3, index: 4 }, // A
        { type: "hidden" as const, squash: "LOGISTIC", bias: 0.4, index: 5 }, // B
        { type: "hidden" as const, squash: "LOGISTIC", bias: 0.5, index: 6 }, // X
        { type: "output" as const, squash: "LOGISTIC", bias: 0.6, index: 7 },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 }, // input-0 → C
        { from: 1, to: 3, weight: 1.0 }, // input-1 → D
        { from: 2, to: 4, weight: 1.0 }, // C → A
        { from: 3, to: 5, weight: 1.0 }, // D → B
        { from: 4, to: 6, weight: 1.0 }, // A → X
        { from: 5, to: 6, weight: 1.0 }, // B → X
        { from: 6, to: 7, weight: 1.0 }, // X → output
        { from: 0, to: 7, weight: 0.5 }, // input-0 → output (direct)
      ],
    };

    let bugTriggered = false;

    for (let attempt = 0; attempt < 200; attempt++) {
      const creature = Creature.fromJSON(json);
      creatureValidate(creature);

      const hiddenBefore = creature.neurons.filter((n) =>
        n.type === "hidden" || n.type === "constant"
      ).length;

      const mutator = new SubNeuron(creature);
      const changed = mutator.mutate();

      creatureValidate(creature);

      if (
        changed && hiddenBefore - creature.neurons.filter((n) =>
                n.type === "hidden" || n.type === "constant"
              ).length >= 3
      ) {
        bugTriggered = true;
      }
    }

    assert(
      bugTriggered,
      "Should have triggered multi-branch cascade removal at least once in 200 attempts",
    );
  },
);

Deno.test(
  "SubNeuron - all hidden/constant neurons have outward connections after mutation",
  () => {
    const json = {
      input: 2,
      output: 1,
      neurons: [
        { type: "hidden" as const, squash: "LOGISTIC", bias: 0.1, index: 2 },
        { type: "hidden" as const, squash: "LOGISTIC", bias: 0.2, index: 3 },
        { type: "hidden" as const, squash: "LOGISTIC", bias: 0.3, index: 4 },
        { type: "hidden" as const, squash: "LOGISTIC", bias: 0.4, index: 5 },
        { type: "hidden" as const, squash: "LOGISTIC", bias: 0.5, index: 6 },
        { type: "output" as const, squash: "LOGISTIC", bias: 0.6, index: 7 },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 3, weight: 1.0 },
        { from: 2, to: 4, weight: 1.0 },
        { from: 3, to: 5, weight: 1.0 },
        { from: 4, to: 6, weight: 1.0 },
        { from: 5, to: 6, weight: 1.0 },
        { from: 6, to: 7, weight: 1.0 },
        { from: 0, to: 7, weight: 0.5 },
      ],
    };

    for (let attempt = 0; attempt < 100; attempt++) {
      const creature = Creature.fromJSON(json);
      const mutator = new SubNeuron(creature);
      mutator.mutate();

      for (let i = creature.input; i < creature.neurons.length; i++) {
        const n = creature.neurons[i];
        if (n.type === "hidden" || n.type === "constant") {
          const outward = creature.outwardConnections(i);
          assert(
            outward.length > 0,
            `Orphan found: neuron at index ${i} (type=${n.type}) has no outward connections after SubNeuron mutation`,
          );
        }
      }

      creatureValidate(creature);
    }
  },
);

Deno.test(
  "SubNeuron - deep cascade chain cleaned up correctly",
  () => {
    const json = {
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden" as const, squash: "LOGISTIC", bias: 0.1, index: 1 }, // A
        { type: "hidden" as const, squash: "LOGISTIC", bias: 0.2, index: 2 }, // B
        { type: "hidden" as const, squash: "LOGISTIC", bias: 0.3, index: 3 }, // C
        { type: "output" as const, squash: "LOGISTIC", bias: 0.4, index: 4 },
      ],
      synapses: [
        { from: 0, to: 1, weight: 1.0 }, // input → A
        { from: 1, to: 2, weight: 1.0 }, // A → B
        { from: 2, to: 3, weight: 1.0 }, // B → C
        { from: 3, to: 4, weight: 1.0 }, // C → output
        { from: 0, to: 4, weight: 0.5 }, // input → output (direct)
      ],
    };

    for (let attempt = 0; attempt < 100; attempt++) {
      const creature = Creature.fromJSON(json);
      const mutator = new SubNeuron(creature);
      mutator.mutate();

      const remainingHidden = creature.neurons.filter((n) =>
        n.type === "hidden" || n.type === "constant"
      );

      for (const n of creature.neurons) {
        if (n.type === "hidden" || n.type === "constant") {
          const idx = creature.neurons.indexOf(n);
          assert(
            creature.outwardConnections(idx).length > 0,
            `Orphan: neuron at ${idx} (type=${n.type}) has no outward`,
          );
        }
      }

      const hiddenCount = remainingHidden.length;
      assertEquals(
        hiddenCount === 0 || hiddenCount === 1 || hiddenCount === 2 ||
          hiddenCount === 3,
        true,
        `Unexpected hidden count: ${hiddenCount}`,
      );

      creatureValidate(creature);
    }
  },
);
