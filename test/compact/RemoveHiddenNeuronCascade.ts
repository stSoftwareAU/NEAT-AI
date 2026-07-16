import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { removeHiddenNeuron } from "@compact/CompactUtils.ts";
import { LOGISTIC } from "@methods/activations/types/LOGISTIC.ts";

/**
 * Regression for the PR #3382 / Issue #3359 CI `XOR-evolve` failure:
 * `ValidationError: constants neuron ... has no outward connections`.
 *
 * `removeHiddenNeuron` dropped every synapse touching the removed neuron but
 * did not cascade, so a constant neuron whose ONLY outward connection fed the
 * removed neuron was left orphaned — invalid, and only detected on the next
 * serialize/deserialize round-trip during evolution.
 */
Deno.test("removeHiddenNeuron - cascades to a constant orphaned by the removal", () => {
  // constant C feeds ONLY into hidden H. Removing H drops C→H, orphaning C.
  const exportJSON: CreatureExport = {
    neurons: [
      { type: "constant", bias: 0.5, uuid: "C" },
      { type: "hidden", squash: LOGISTIC.NAME, bias: 0.1, uuid: "H" },
      { type: "output", squash: LOGISTIC.NAME, bias: 0.0, uuid: "output-0" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "H", weight: 1.0 },
      { fromUUID: "C", toUUID: "H", weight: 1.0 },
      { fromUUID: "H", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(exportJSON);
  creatureValidate(creature); // valid to start

  const hIndx = creature.neurons.findIndex((n) => n.type === "hidden");
  const outputIndx = creature.neurons.findIndex((n) => n.type === "output");
  assert(hIndx >= 0 && outputIndx >= 0);

  // Make H removable (no outward), mirroring an evolution-time disconnect.
  creature.disconnect(hIndx, outputIndx);

  removeHiddenNeuron(creature, hIndx);

  // The orphaned constant must have cascaded away.
  assertEquals(
    creature.neurons.some((n) => n.type === "constant"),
    false,
    "orphaned constant should be cascade-removed",
  );

  // The exact path that failed in CI: round-trip through export/import.
  const roundTrip = Creature.fromJSON(creature.exportJSON());
  creatureValidate(roundTrip);
});

Deno.test("removeHiddenNeuron - keeps a constant that still has other outward connections", () => {
  // constant C feeds BOTH hidden H and the output. Removing H must NOT remove
  // C, because C still drives the output.
  const exportJSON: CreatureExport = {
    neurons: [
      { type: "constant", bias: 0.5, uuid: "C" },
      { type: "hidden", squash: LOGISTIC.NAME, bias: 0.1, uuid: "H" },
      { type: "output", squash: LOGISTIC.NAME, bias: 0.0, uuid: "output-0" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "H", weight: 1.0 },
      { fromUUID: "C", toUUID: "H", weight: 1.0 },
      { fromUUID: "C", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "H", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(exportJSON);
  const hIndx = creature.neurons.findIndex((n) => n.type === "hidden");
  const outputIndx = creature.neurons.findIndex((n) => n.type === "output");
  creature.disconnect(hIndx, outputIndx);

  removeHiddenNeuron(creature, hIndx);

  assertEquals(
    creature.neurons.some((n) => n.type === "constant"),
    true,
    "constant with remaining outward connections must be preserved",
  );
  const roundTrip = Creature.fromJSON(creature.exportJSON());
  creatureValidate(roundTrip);
});
