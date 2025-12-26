import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { CRISPR, type CrisprInterface } from "../../src/reconstruct/CRISPR.ts";

/**
 * Regression test (26-Dec-2025).
 *
 * Forward-only is a hard invariant for semanticVersion 4.x creatures.
 * CRISPR injections must not be able to introduce backward/self connections
 * into a 4.x creature, otherwise breeding later crashes in `upgrade()`.
 */
Deno.test("CRISPR: rejects backward synapse injection for 4.x forward-only creatures", () => {
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

  const crispr = new CRISPR(base);
  const dna: CrisprInterface = {
    id: "test-forward-only-back-edge",
    mode: "append",
    synapses: [
      // Backward edge by index order: output -> hidden.
      { fromUUID: "output-0", toUUID: "hidden-0", weight: 0.1 },
    ],
  };

  const mutated = crispr.cleaveDNA(dna);

  // The injection must be rejected and the returned creature must remain valid
  // under forward-only validation.
  mutated.validate({ forwardOnly: true });

  const synapseKeys = mutated.exportJSON().synapses.map((s) =>
    `${s.fromUUID}->${s.toUUID}`
  );
  assertEquals(
    synapseKeys.includes("output-0->hidden-0"),
    false,
    "Backward synapse should not be present",
  );

  // Test hygiene: CRISPR writes a debug file on validation failures. Remove it
  // so the repo stays clean when running tests locally.
  const debugFile = `.CRISPR-ERROR-${dna.id}.json`;
  try {
    Deno.removeSync(debugFile);
  } catch {
    // Ignore: file may not exist if the implementation changes.
  }
});
