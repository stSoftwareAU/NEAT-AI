import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { CRISPR, type CrisprInterface } from "../../src/reconstruct/CRISPR.ts";

/**
 * Verifies that CRISPR preserves semanticVersion through mutations.
 *
 * Upgrade is a one-time load-from-disk operation. CRISPR must not modify
 * the semanticVersion of any creature — the version set at load time
 * persists for the creature's lifetime.
 */
Deno.test(
  "CRISPR: preserves semanticVersion through forward-only mutation",
  () => {
    const baseJson: CreatureExport = {
      input: 1,
      output: 1,
      semanticVersion: "4.0.0",
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
    assertEquals(base.semanticVersion, "4.0.0");

    const crispr = new CRISPR(base);
    const dna: CrisprInterface = {
      id: "test-forward-only-version-preserved",
      mode: "append",
      synapses: [
        { fromId: 0, toId: -1, weight: 0.1 },
      ],
    };

    const mutated = crispr.cleaveDNA(dna);
    mutated.validate({ forwardOnly: true });
    assertEquals(mutated.forwardOnly, true);
    assertEquals(
      mutated.semanticVersion,
      "4.0.0",
      "semanticVersion must be preserved through CRISPR — upgrade is load-time only",
    );
  },
);
