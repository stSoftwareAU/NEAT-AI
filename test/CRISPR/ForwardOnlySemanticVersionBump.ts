import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { CRISPR, type CrisprInterface } from "../../src/reconstruct/CRISPR.ts";

/**
 * Regression test (26-Dec-2025).
 *
 * When CRISPR is applied to a creature that is being treated as forward-only
 * (because `forwardOnly === true`), CRISPR must:
 * - validate using forward-only constraints; and
 * - bump semanticVersion from 2.x/3.x to 4.0.0 once forward-only is confirmed.
 *
 * This keeps the same invariant used across the codebase: 4.x means forward-only
 * has been confirmed (not merely requested).
 */
Deno.test(
  "CRISPR: bumps semanticVersion to 4.0.0 when forward-only is confirmed for a 3.x creature",
  () => {
    const baseJson: CreatureExport = {
      input: 1,
      output: 1,
      semanticVersion: "3.9.0",
      forwardOnly: true,
      neurons: [
        { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0 },
        { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 1 },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 1 },
      ],
    };

    const base = Creature.fromJSON(baseJson);
    base.validate({ forwardOnly: true });
    assertEquals(base.semanticVersion, "3.9.0");

    const crispr = new CRISPR(base);
    const dna: CrisprInterface = {
      id: "test-forward-only-version-bump",
      mode: "append",
      synapses: [
        // A forward-only-safe edge.
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.1 },
      ],
    };

    const mutated = crispr.cleaveDNA(dna);
    mutated.validate({ forwardOnly: true });
    assertEquals(mutated.forwardOnly, true);
    assertEquals(
      mutated.semanticVersion,
      "4.0.0",
      "semanticVersion should be bumped to 4.0.0 once forward-only is confirmed",
    );
  },
);
