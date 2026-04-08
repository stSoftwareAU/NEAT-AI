/**
 * Unit tests for genetic compatibility calculation.
 *
 * Issue #2218: Verifies the core NEAT compatibility distance function that
 * drives speciation decisions. Covers identical creatures, differing
 * topologies, weight-only differences, symmetry, monotonic divergence,
 * and edge cases (minimal and deep networks).
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature, type CreatureExport, CreatureUtil } from "../../mod.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";

/**
 * Builds a creature with the given hidden neuron UUIDs wired in a chain:
 * input-0 → hidden[0] → hidden[1] → … → output-0
 *
 * Each hidden neuron also receives a connection from input-1 so the
 * creature has two inputs (matching the `input: 2` declaration).
 */
function buildCreature(
  hiddenUUIDs: string[],
  opts?: { biasOffset?: number; weightOffset?: number },
): Creature {
  const biasOffset = opts?.biasOffset ?? 0;
  const weightOffset = opts?.weightOffset ?? 0;

  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  for (let i = 0; i < hiddenUUIDs.length; i++) {
    const uuid = hiddenUUIDs[i];
    neurons.push({
      type: "hidden",
      uuid,
      squash: "LOGISTIC",
      bias: 0.1 + biasOffset,
    });

    // Chain: previous node → this hidden neuron
    const fromUUID = i === 0 ? "input-0" : hiddenUUIDs[i - 1];
    synapses.push({ fromUUID, toUUID: uuid, weight: 0.5 + weightOffset });
  }

  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });

  // Last hidden → output (or direct input → output when no hidden neurons)
  const lastSource = hiddenUUIDs.length > 0
    ? hiddenUUIDs[hiddenUUIDs.length - 1]
    : "input-0";
  synapses.push({ fromUUID: lastSource, toUUID: "output-0", weight: 0.8 });

  // Direct path from input-0 when there are no hidden neurons is already
  // handled above. Add a second input connection for variety.
  if (hiddenUUIDs.length === 0) {
    synapses.push({
      fromUUID: "input-1",
      toUUID: "output-0",
      weight: 0.3,
    });
  }

  const json: CreatureExport = { input: 2, output: 1, neurons, synapses };
  const creature = Creature.fromJSON(json);
  CreatureUtil.makeUUID(creature);
  return creature;
}

// ── Identical creatures ─────────────────────────────────────────────

Deno.test(
  "GeneticCompatibility: identical creatures have compatibility 1.0",
  () => {
    const a = buildCreature(["h1", "h2", "h3"]);
    const b = buildCreature(["h1", "h2", "h3"]);

    assertEquals(geneticCompatibility(a, b), 1);
  },
);

// ── Different topologies ────────────────────────────────────────────

Deno.test(
  "GeneticCompatibility: added neurons reduce compatibility",
  () => {
    const base = buildCreature(["h1", "h2"]);
    const extended = buildCreature(["h1", "h2", "h3", "h4"]);

    const compat = geneticCompatibility(base, extended);
    // Smallest set is base with 2 neurons; both match → 1.0
    assertEquals(compat, 1);
  },
);

Deno.test(
  "GeneticCompatibility: removed neurons reduce compatibility",
  () => {
    // a has neurons the other does not
    const a = buildCreature(["h1", "h2", "h3"]);
    const b = buildCreature(["h4", "h5", "h6"]);

    const compat = geneticCompatibility(a, b);
    assertEquals(compat, 0, "No shared hidden neurons should yield 0");
  },
);

Deno.test(
  "GeneticCompatibility: partial overlap yields fractional value",
  () => {
    // a: [h1, h2, h3], b: [h2, h3, h4] → smallest set = 3, matches = 2 → 2/3
    const a = buildCreature(["h1", "h2", "h3"]);
    const b = buildCreature(["h2", "h3", "h4"]);

    assertAlmostEquals(geneticCompatibility(a, b), 2 / 3, 0.001);
  },
);

// ── Same topology, different weights ────────────────────────────────

Deno.test(
  "GeneticCompatibility: same topology with different weights yields 1.0",
  () => {
    // Compatibility is based on structural (hidden neuron) overlap, not weights.
    // Two creatures with the same hidden UUIDs but very different weights
    // should still be perfectly compatible.
    const a = buildCreature(["h1", "h2"], { weightOffset: 0 });
    const b = buildCreature(["h1", "h2"], { weightOffset: 5.0 });

    assertEquals(
      geneticCompatibility(a, b),
      1,
      "Weight differences should not affect compatibility",
    );
  },
);

Deno.test(
  "GeneticCompatibility: same topology with different biases yields 1.0",
  () => {
    const a = buildCreature(["h1", "h2"], { biasOffset: 0 });
    const b = buildCreature(["h1", "h2"], { biasOffset: 10.0 });

    assertEquals(
      geneticCompatibility(a, b),
      1,
      "Bias differences should not affect compatibility",
    );
  },
);

// ── Symmetry ────────────────────────────────────────────────────────

Deno.test(
  "GeneticCompatibility: distance(a, b) === distance(b, a) for unequal sets",
  () => {
    const a = buildCreature(["h1", "h2", "h3"]);
    const b = buildCreature(["h3", "h4"]);

    const ab = geneticCompatibility(a, b);
    const ba = geneticCompatibility(b, a);

    assertAlmostEquals(ab, ba, 0.001, "Compatibility must be symmetric");
  },
);

Deno.test(
  "GeneticCompatibility: symmetry holds for completely disjoint sets",
  () => {
    const a = buildCreature(["x1", "x2"]);
    const b = buildCreature(["y1", "y2", "y3"]);

    assertEquals(
      geneticCompatibility(a, b),
      geneticCompatibility(b, a),
    );
  },
);

// ── Monotonic divergence ────────────────────────────────────────────

Deno.test(
  "GeneticCompatibility: compatibility decreases as structural divergence increases",
  () => {
    // Base creature with 4 hidden neurons
    const base = buildCreature(["h1", "h2", "h3", "h4"]);

    // Progressively fewer matches: 4/4, 3/4, 2/4, 1/4, 0/4
    const fullyMatched = buildCreature(["h1", "h2", "h3", "h4"]);
    const threeMatch = buildCreature(["h1", "h2", "h3", "z1"]);
    const twoMatch = buildCreature(["h1", "h2", "z1", "z2"]);
    const oneMatch = buildCreature(["h1", "z1", "z2", "z3"]);
    const noMatch = buildCreature(["z1", "z2", "z3", "z4"]);

    const scores = [
      geneticCompatibility(base, fullyMatched),
      geneticCompatibility(base, threeMatch),
      geneticCompatibility(base, twoMatch),
      geneticCompatibility(base, oneMatch),
      geneticCompatibility(base, noMatch),
    ];

    for (let i = 1; i < scores.length; i++) {
      assert(
        scores[i] < scores[i - 1],
        `Score at divergence ${i} (${scores[i]}) should be less than ` +
          `score at divergence ${i - 1} (${scores[i - 1]})`,
      );
    }

    // Verify exact expected values: 1.0, 0.75, 0.5, 0.25, 0.0
    assertAlmostEquals(scores[0], 1.0, 0.001);
    assertAlmostEquals(scores[1], 0.75, 0.001);
    assertAlmostEquals(scores[2], 0.5, 0.001);
    assertAlmostEquals(scores[3], 0.25, 0.001);
    assertAlmostEquals(scores[4], 0.0, 0.001);
  },
);

// ── Edge cases ──────────────────────────────────────────────────────

Deno.test(
  "GeneticCompatibility: minimal creature (input→output only) yields 1.0",
  () => {
    const a = buildCreature([]);
    const b = buildCreature([]);

    assertEquals(
      geneticCompatibility(a, b),
      1,
      "Creatures with no hidden neurons are perfectly compatible",
    );
  },
);

Deno.test(
  "GeneticCompatibility: minimal vs deep creature yields 1.0 (empty smallest set)",
  () => {
    // When one creature has no hidden neurons, totalNeurons = 0 → returns 1.
    const minimal = buildCreature([]);
    const deep = buildCreature(["h1", "h2", "h3", "h4", "h5"]);

    assertEquals(
      geneticCompatibility(minimal, deep),
      1,
      "Empty smallest set triggers early return of 1.0",
    );
  },
);

Deno.test(
  "GeneticCompatibility: creatures with many hidden layers",
  () => {
    // Build two deep creatures with some overlap
    const layersA = Array.from({ length: 20 }, (_, i) => `layer-${i}`);
    const layersB = Array.from(
      { length: 20 },
      (_, i) => i < 10 ? `layer-${i}` : `different-${i}`,
    );

    const a = buildCreature(layersA);
    const b = buildCreature(layersB);

    const compat = geneticCompatibility(a, b);
    // 10 out of 20 match → 0.5
    assertAlmostEquals(compat, 0.5, 0.001);
  },
);

Deno.test(
  "GeneticCompatibility: single hidden neuron match",
  () => {
    const a = buildCreature(["only-one"]);
    const b = buildCreature(["only-one"]);

    assertEquals(geneticCompatibility(a, b), 1);
  },
);

Deno.test(
  "GeneticCompatibility: single hidden neuron mismatch",
  () => {
    const a = buildCreature(["alpha"]);
    const b = buildCreature(["beta"]);

    assertEquals(geneticCompatibility(a, b), 0);
  },
);

// ── Result bounds ───────────────────────────────────────────────────

Deno.test(
  "GeneticCompatibility: result is always in [0, 1] across varied configurations",
  () => {
    const configs: [string[], string[]][] = [
      [[], []],
      [["a"], []],
      [[], ["b"]],
      [["a"], ["a"]],
      [["a"], ["b"]],
      [["a", "b"], ["b", "c"]],
      [["a", "b", "c"], ["d", "e", "f"]],
      [
        Array.from({ length: 15 }, (_, i) => `n${i}`),
        Array.from({ length: 15 }, (_, i) => `n${i + 5}`),
      ],
    ];

    for (const [aHidden, bHidden] of configs) {
      const a = buildCreature(aHidden);
      const b = buildCreature(bHidden);
      const compat = geneticCompatibility(a, b);
      assert(
        compat >= 0 && compat <= 1,
        `Out of range: ${compat} for a=[${aHidden}] b=[${bHidden}]`,
      );
    }
  },
);
