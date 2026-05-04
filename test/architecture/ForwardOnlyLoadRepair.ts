import { assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";

/**
 * Issue #2090: Forward-only creatures loaded from disk/worker transfer may
 * contain recurrent synapses injected by older library versions or application
 * CRISPR DNA. Rather than crashing the worker, loadFrom should strip the
 * offending synapses and log a warning.
 *
 * Reproduction: GRQ-3-sloth.log — CRISPR "Sane Output" added output
 * self-connections to a forwardOnly creature. The worker crashed on fromJSON.
 *
 * GRQ-12-nigel.log class: stripping the only inbound path to a hidden neuron
 * (via a backward edge) must not leave an invalid graph — orphan cleanup runs
 * after strip so validate passes and memetic can remain when structure allows.
 *
 * GRQ-24 / GRQ-25-sloth.log class: duplicate (from,to) rows plus NO_INWARD are
 * repaired via merge + orphan cleanup in `loadFrom` (see test/fix/Grq25*.ts).
 * NO_INWARD-only repair runs when `validate` is true on load so discovery
 * replay can still use `fromJSON(..., false)` for intermediate topologies.
 *
 * Issue #2514: the load-side throw is now the default for forward-only
 * recurrent edges. These tests intentionally exercise the legacy
 * strip+repair path that keeps loading historic on-disk JSON safely, so
 * they opt back into `throwOnRecurrent: "never"`. Coverage of the new
 * throw default lives in `test/creature/LoadFromForwardOnlyThrow.ts`.
 */
const REPAIR_LOAD: { throwOnRecurrent: "never" } = {
  throwOnRecurrent: "never",
};

Deno.test(
  "forward-only: fromJSON strips self-connections instead of crashing",
  () => {
    const json: CreatureExport = {
      forwardOnly: true,
      input: 2,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "h0", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h0", weight: 0.1 },
        { fromUUID: "input-1", toUUID: "h0", weight: 0.2 },
        { fromUUID: "h0", toUUID: "output-0", weight: 0.3 },
        { fromUUID: "output-0", toUUID: "output-0", weight: 1.0 },
      ],
    };

    const creature = Creature.fromJSON(json, false, "fromJSON", REPAIR_LOAD);

    assertEquals(creature.forwardOnly, true);
    assertEquals(
      creature.synapses.length,
      3,
      "Self-connection should be stripped",
    );
    creature.validate({ forwardOnly: true });
  },
);

Deno.test(
  "forward-only: fromJSON repairs hidden neuron stranded after backward synapse strip (GRQ-12)",
  () => {
    const json: CreatureExport = {
      forwardOnly: true,
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "h0", squash: "IDENTITY", bias: 0 },
        { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h0", weight: 0.1 },
        { fromUUID: "h0", toUUID: "output-0", weight: 0.2 },
        { fromUUID: "h1", toUUID: "output-0", weight: 0.3 },
        { fromUUID: "h1", toUUID: "h0", weight: 0.5 },
      ],
      memetic: {
        generation: 1,
        score: 0,
        biases: {},
        weights: {},
      },
    };

    const creature = Creature.fromJSON(json, true, "fromJSON", REPAIR_LOAD);

    assertEquals(creature.forwardOnly, true);
    assertEquals(
      creature.synapses.length,
      3,
      "Backward synapse h1→h0 should be stripped",
    );
    assertEquals(
      creature.memetic !== undefined,
      true,
      "Memetic should survive when cleanup only converts stranded hidden to constant",
    );
    const constants = creature.neurons.filter((n) => n.type === "constant");
    assertEquals(
      constants.length,
      1,
      "h1 had no inbound after strip; orphan cleanup converts it to constant (uuid not preserved on constant export)",
    );
    creature.validate({ forwardOnly: true });
  },
);

Deno.test(
  "forward-only: fromJSON strips backward connections instead of crashing",
  () => {
    const json: CreatureExport = {
      forwardOnly: true,
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "h0", squash: "IDENTITY", bias: 0 },
        { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h0", weight: 0.1 },
        { fromUUID: "h0", toUUID: "h1", weight: 0.2 },
        { fromUUID: "h1", toUUID: "output-0", weight: 0.3 },
        { fromUUID: "h1", toUUID: "h0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json, false, "fromJSON", REPAIR_LOAD);

    assertEquals(creature.forwardOnly, true);
    assertEquals(
      creature.synapses.length,
      3,
      "Backward connection should be stripped",
    );
    creature.validate({ forwardOnly: true });
  },
);

Deno.test(
  "forward-only: fromJSON strips multiple output self-connections (production case)",
  () => {
    const json: CreatureExport = {
      forwardOnly: true,
      input: 3,
      output: 3,
      neurons: [
        { type: "hidden", uuid: "h0", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-2", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h0", weight: 0.1 },
        { fromUUID: "input-1", toUUID: "h0", weight: 0.2 },
        { fromUUID: "input-2", toUUID: "h0", weight: 0.3 },
        { fromUUID: "h0", toUUID: "output-0", weight: 0.4 },
        { fromUUID: "h0", toUUID: "output-1", weight: 0.5 },
        { fromUUID: "h0", toUUID: "output-2", weight: 0.6 },
        { fromUUID: "output-0", toUUID: "output-0", weight: 1.0 },
        { fromUUID: "output-1", toUUID: "output-1", weight: 1.0 },
        { fromUUID: "output-2", toUUID: "output-2", weight: 1.0 },
        { fromUUID: "output-2", toUUID: "output-1", weight: 0.7 },
      ],
    };

    const creature = Creature.fromJSON(json, false, "fromJSON", REPAIR_LOAD);

    assertEquals(creature.forwardOnly, true);
    assertEquals(
      creature.synapses.length,
      6,
      "All 4 recurrent synapses should be stripped",
    );
    creature.validate({ forwardOnly: true });
  },
);

Deno.test(
  "feedback creature: fromJSON preserves self-connections",
  () => {
    const json: CreatureExport = {
      forwardOnly: false,
      input: 2,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "h0", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h0", weight: 0.1 },
        { fromUUID: "h0", toUUID: "output-0", weight: 0.3 },
        { fromUUID: "h0", toUUID: "h0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json, false);

    assertEquals(creature.forwardOnly, false);
    assertEquals(
      creature.synapses.length,
      3,
      "Self-connection should be kept for feedback creature",
    );
  },
);
