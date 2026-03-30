import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";

/**
 * Issue #2090: Forward-only creatures loaded from disk/worker transfer may
 * contain recurrent synapses injected by older library versions or application
 * CRISPR DNA. Rather than crashing the worker, loadFrom should strip the
 * offending synapses and log a warning.
 *
 * Reproduction: GRQ-3-sloth.log — CRISPR "Sane Output" added output
 * self-connections to a forwardOnly creature. The worker crashed on fromJSON.
 */

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

    const creature = Creature.fromJSON(json, false);

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

    const creature = Creature.fromJSON(json, false);

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

    const creature = Creature.fromJSON(json, false);

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
