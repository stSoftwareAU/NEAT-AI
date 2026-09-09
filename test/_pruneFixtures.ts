/**
 * @module
 *
 * Shared creature fixtures for the pruning tests (Issue #3976).
 *
 * The synapse-removal adapter (`test/wasm/PruneSynapse.ts`) and the mutation
 * operator over it (`test/mutate/SubConnectionCoreRewrite.ts`) need the same
 * two shapes — a hidden neuron on a single path, and an `IF` with one edge per
 * role. Defining them once is what stops the two suites drifting into asserting
 * different things about "the same" creature.
 *
 * Each builder returns a fresh export, so a caller may edit it before use.
 */

import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";

/** `h-1` sits on the only path from `input-0` to the output. */
export function hiddenChainExport(): CreatureExport {
  return {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "h-1", type: "hidden", squash: "LOGISTIC", bias: 0.5 },
      { uuid: "output-0", type: "output", squash: "LOGISTIC", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h-1", weight: 1 },
      { fromUUID: "h-1", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.9 },
    ],
  };
}

/** An `IF` with one edge per role, plus the output it feeds. */
export function ifRolesExport(): CreatureExport {
  return {
    input: 3,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "if-1", type: "hidden", squash: "IF", bias: 0 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "if-1", weight: 0.5, type: "condition" },
      { fromUUID: "input-1", toUUID: "if-1", weight: 0.6, type: "positive" },
      { fromUUID: "input-2", toUUID: "if-1", weight: 0.7, type: "negative" },
      { fromUUID: "if-1", toUUID: "output-0", weight: 1 },
    ],
  };
}

/**
 * A constant the creature fixes at 0.5 feeding the output, so cutting its edge
 * folds exactly; `input-0` keeps the output wired once it goes.
 */
export function fixedSourceExport(): CreatureExport {
  return {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "c-1", type: "constant", bias: 0.5 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0.25 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "c-1", toUUID: "output-0", weight: 0.2 },
    ],
  };
}
