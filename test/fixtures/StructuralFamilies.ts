/**
 * One fixture per structural family a repair pass may be handed (Issue #3848).
 *
 * The pass that cost a champion 90.7 % of its score was written for v1.x/v2.x
 * creatures — random inbound synapses, orphan constants, self-connections — and
 * its fixtures were all of that shape. Grafted `IF` forests arrived years later
 * and were never in them, so nothing failed when the pass mangled one.
 *
 * These are the families NEAT-AI actually produces today. Every one of them is
 * valid, and the standing test in `test/repair/StructuralFamilies.ts` asserts
 * each survives a load untouched.
 *
 * @module
 */
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import {
  GRAFTED_INPUTS,
  graftedIfForest,
  pointWiseCreature,
} from "./GraftedIfForest.ts";

export { GRAFTED_INPUTS, graftedIfForest, pointWiseCreature };

/**
 * A grafted `IF` forest in which one leaf value is exactly zero.
 *
 * Nothing about that is invalid — a decision tree may perfectly well predict 0
 * on a branch — but a pass that reads a zero-weight synapse as dead wiring drops
 * it, and the branch is then re-sourced from an arbitrary neuron. This is the
 * shape #3845 was found on.
 */
export function graftedIfForestWithZeroLeaf(): CreatureExport {
  const json = graftedIfForest();
  const leaf = json.synapses.find(
    (s) => s.toUUID === "if-2-lo" && s.type === "positive",
  );
  if (!leaf) throw new Error("fixture carries a positive branch on if-2-lo");
  leaf.weight = 0;
  return json;
}

/**
 * An `IF` whose branches are relays rather than constants, feeding the output
 * through a further relay.
 *
 * The interesting part is that no role-typed edge here reads a constant, so a
 * heuristic that only protects "constants feeding an `IF`" would still walk into
 * it. Both branch sources are ordinary hidden neurons.
 */
export function ifOutputWithRelays(): CreatureExport {
  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: GRAFTED_INPUTS,
    output: 1,
    neurons: [
      { type: "constant", uuid: "constant-threshold", bias: 1 },
      { type: "hidden", uuid: "relay-lo", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "relay-hi", squash: "TANH", bias: -0.2 },
      { type: "hidden", uuid: "gate", squash: "IF", bias: 0 },
      { type: "hidden", uuid: "relay-out", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "relay-lo", weight: 0.6 },
      { fromUUID: "input-1", toUUID: "relay-hi", weight: -0.4 },
      { fromUUID: "input-2", toUUID: "gate", weight: 1, type: "condition" },
      {
        fromUUID: "constant-threshold",
        toUUID: "gate",
        weight: -0.35,
        type: "condition",
      },
      { fromUUID: "relay-hi", toUUID: "gate", weight: 1, type: "positive" },
      { fromUUID: "relay-lo", toUUID: "gate", weight: 1, type: "negative" },
      { fromUUID: "gate", toUUID: "relay-out", weight: 1 },
      { fromUUID: "relay-out", toUUID: "output-0", weight: 0.9 },
      { fromUUID: "input-3", toUUID: "output-0", weight: 0.2 },
    ],
  };
}

/**
 * Aggregate activations — `MINIMUM`, `MAXIMUM` and `HYPOTv2`.
 *
 * They read every inbound synapse as a set rather than a sum, so dropping one
 * because its weight is small changes the answer by an amount no weight
 * magnitude predicts. Another family whose semantics a generic pass cannot see.
 */
export function aggregateCreature(): CreatureExport {
  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: GRAFTED_INPUTS,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "agg-min", squash: "MINIMUM", bias: 0 },
      { type: "hidden", uuid: "agg-max", squash: "MAXIMUM", bias: 0 },
      { type: "hidden", uuid: "agg-hypot", squash: "HYPOTv2", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "agg-min", weight: 1 },
      { fromUUID: "input-1", toUUID: "agg-min", weight: 0.75 },
      { fromUUID: "input-1", toUUID: "agg-max", weight: -1 },
      { fromUUID: "input-2", toUUID: "agg-max", weight: 0.5 },
      { fromUUID: "agg-min", toUUID: "agg-hypot", weight: 1 },
      { fromUUID: "agg-max", toUUID: "agg-hypot", weight: 1 },
      { fromUUID: "input-3", toUUID: "agg-hypot", weight: 0.3 },
      { fromUUID: "agg-hypot", toUUID: "output-0", weight: 0.8 },
    ],
  };
}

/**
 * A genuine pre-4.x genome that is nonetheless structurally sound — every
 * neuron wired in and out, no self or backward edges.
 *
 * The migration is entitled to bump its version; it is not entitled to rewire
 * it. Old files really do arrive looking like this.
 */
export function legacyValidCreature(version: string): CreatureExport {
  return {
    semanticVersion: version,
    input: GRAFTED_INPUTS,
    output: 1,
    neurons: [
      { type: "constant", uuid: "legacy-constant", bias: 1 },
      { type: "hidden", uuid: "legacy-h0", squash: "LOGISTIC", bias: 0.25 },
      { type: "hidden", uuid: "legacy-h1", squash: "TANH", bias: -0.15 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "legacy-h0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "legacy-h0", weight: -0.25 },
      { fromUUID: "legacy-constant", toUUID: "legacy-h1", weight: 0.4 },
      { fromUUID: "legacy-h0", toUUID: "legacy-h1", weight: 0.7 },
      { fromUUID: "legacy-h1", toUUID: "output-0", weight: 1.1 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 0.15 },
    ],
  };
}

/** Every structural family, each one valid, for the standing round-trip test. */
export function structuralFamilies(): { name: string; json: CreatureExport }[] {
  return [
    { name: "point-wise", json: pointWiseCreature() },
    { name: "grafted IF forest", json: graftedIfForest() },
    {
      name: "grafted IF forest, zero leaf",
      json: graftedIfForestWithZeroLeaf(),
    },
    { name: "IF output with relays", json: ifOutputWithRelays() },
    { name: "aggregates (MINIMUM/MAXIMUM/HYPOTv2)", json: aggregateCreature() },
    { name: "legacy v1.x", json: legacyValidCreature("1.0.0") },
    { name: "legacy v2.x", json: legacyValidCreature("2.0.0") },
  ];
}
