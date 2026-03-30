/**
 * Shared test creature factories.
 *
 * These factory functions provide commonly-used creature topologies
 * for unit tests, eliminating duplication across test files.
 *
 * Keep test-specific fixtures local where they test unique topologies.
 */
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";

/**
 * Creates a simple 2-input, 1-hidden, 1-output IDENTITY creature.
 *
 * All neurons use IDENTITY activation with zero bias.
 * Synapses: input-0 → hidden-1 (0.5), hidden-1 → output-0 (0.5).
 * The creature is validated and assigned a UUID.
 */
export function makeSimpleCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-1",
        id: 5001,
        squash: "IDENTITY",
        bias: 0,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

/**
 * Creates a 2-input, 1-hidden, 1-output IDENTITY creature with an
 * additional direct input-1 → output-0 connection (weight -0.25).
 *
 * All neurons use IDENTITY activation with zero bias.
 * The creature is validated and assigned a UUID.
 */
export function makeBaseCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-1",
        id: 5001,
        squash: "IDENTITY",
        bias: 0,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "output-0", weight: -0.25 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

/**
 * Creates a minimal 1-input, 1-output forward-only IDENTITY creature.
 *
 * Hidden neuron has bias 0.1.
 * Synapses: input-0 → hidden-0 (0.2), hidden-0 → output-0 (0.25).
 * No explicit validate() or makeUUID() call — matches the original
 * pattern used by DiscoveryReplayRunner and related tests.
 */
export function makeForwardOnlyCreature(): Creature {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
    ],
  };
  return Creature.fromJSON(base);
}
