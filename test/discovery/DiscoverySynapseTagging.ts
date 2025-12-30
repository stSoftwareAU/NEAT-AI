import { assert, assertEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import {
  type CandidateSynapse,
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { Creature } from "../../src/Creature.ts";

Deno.test("Discovery addHelpfulSynapses tags new synapses and tags survive export/import", () => {
  const base: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.1 },
    ],
  };

  const creature = Creature.fromJSON(base, true);

  const discoveryID = "abcd1234";
  const candidate: CandidateSynapse = {
    fromNeuronUUID: "input-1",
    toNeuronUUID: "output-0",
    weight: 0.25,
    targetNeuronImpact: 1,
    expectedCreatureErrorReduction: 0,
    expectedCreatureScoreGain: 0,
    improvedCount: 0,
    totalCount: 1,
    comment: "test-candidate",
  };

  const updated = DiscoverStructure.addHelpfulSynapses(
    discoveryID,
    creature,
    [candidate],
  );
  assert(updated);

  const exported = updated.exportJSON();
  const added = exported.synapses.find((s) =>
    s.fromUUID === "input-1" && s.toUUID === "output-0"
  );
  assert(added, "Expected the helpful synapse to be added");

  // Tag names are strings and values are persisted via JSON.
  assertEquals(getTag(added, "discovered"), "synapse");
  assertEquals(getTag(added, "discovery"), "beneficial");
  assertEquals(getTag(added, "discoveryID"), discoveryID);
  assertEquals(getTag(added, "discovery-comment"), "test-candidate");

  // Round-trip import/export preserves tags.
  const roundTripped = Creature.fromJSON(exported, true).exportJSON();
  const added2 = roundTripped.synapses.find((s) =>
    s.fromUUID === "input-1" && s.toUUID === "output-0"
  );
  assert(added2);
  assertEquals(getTag(added2, "discovered"), "synapse");
  assertEquals(getTag(added2, "discoveryID"), discoveryID);
});
