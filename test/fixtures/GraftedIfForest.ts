/**
 * Fixtures for Issue #3840 — the grafted `IF` forest shape whose compaction and
 * simplification the fleet found to be lossy, plus a point-wise control with no
 * `IF` anywhere.
 *
 * @module
 */
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

/** Inputs carried by both fixtures. */
export const GRAFTED_INPUTS = 4;

/** Grafted decision-tree patches on the forest fixture. */
export const GRAFTED_PATCHES = 3;

/**
 * A creature carrying {@link GRAFTED_PATCHES} grafted decision-tree patches plus
 * a plain point-wise portion, so it is not purely `IF`.
 *
 * Per grafted node (the emitted decision-tree shape):
 * - hidden neuron, `squash: "IF"`, bias 0;
 * - `condition` edges: a feature input with weight 1 **plus** a bias-1 constant
 *   carrying `−threshold`;
 * - `positive` edge: the child `IF` node (weight 1) at an internal node, or a
 *   bias-1 constant carrying the leaf value at a leaf;
 * - `negative` edge: the same, from a *different* bias-1 constant.
 *
 * The three constants (`constant-0` condition, `constant-1` positive,
 * `constant-2` negative) are shared by every patch, exactly as the fleet emits
 * them — one constant backs nine outbound synapses here, and hundreds in the
 * field.
 *
 * Two relay neurons sit between the point-wise portion and two of the patch
 * roots' `condition` edges. They are the bait: the single-in/single-out IDENTITY
 * and the sign-known ABSOLUTE that the compaction chain fold and
 * `Simplify.removeKnownSign` splice out — rewriting a `condition` edge into a
 * plain additive one.
 */
export function graftedIfForest(): CreatureExport {
  const neurons: CreatureExport["neurons"] = [
    { type: "constant", uuid: "constant-0", bias: 1 },
    { type: "constant", uuid: "constant-1", bias: 1 },
    { type: "constant", uuid: "constant-2", bias: 1 },
  ];
  const synapses: CreatureExport["synapses"] = [];

  // Plain point-wise portion — no IF anywhere near it.
  neurons.push({
    type: "hidden",
    uuid: "plain-0",
    squash: "LOGISTIC",
    bias: 0.15,
  });
  neurons.push({
    type: "hidden",
    uuid: "plain-1",
    squash: "IDENTITY",
    bias: -0.1,
  });
  synapses.push({ fromUUID: "input-0", toUUID: "plain-0", weight: 0.8 });
  synapses.push({ fromUUID: "input-3", toUUID: "plain-0", weight: -0.6 });
  synapses.push({ fromUUID: "input-1", toUUID: "plain-1", weight: 0.45 });
  synapses.push({ fromUUID: "plain-0", toUUID: "plain-1", weight: 0.3 });

  // Relays feeding IF condition roles.
  neurons.push({
    type: "hidden",
    uuid: "relay-ident",
    squash: "IDENTITY",
    bias: 0,
  });
  synapses.push({ fromUUID: "plain-1", toUUID: "relay-ident", weight: 1.2 });
  neurons.push({
    type: "hidden",
    uuid: "relay-abs",
    squash: "ABSOLUTE",
    bias: 0,
  });
  synapses.push({ fromUUID: "plain-0", toUUID: "relay-abs", weight: 0.9 });

  for (let p = 0; p < GRAFTED_PATCHES; p++) {
    for (const side of ["lo", "hi"]) {
      const leaf = `if-${p}-${side}`;
      neurons.push({ type: "hidden", uuid: leaf, squash: "IF", bias: 0 });
      const feature = (p + (side === "lo" ? 1 : 2)) % GRAFTED_INPUTS;
      synapses.push({
        fromUUID: `input-${feature}`,
        toUUID: leaf,
        weight: 1,
        type: "condition",
      });
      synapses.push({
        fromUUID: "constant-0",
        toUUID: leaf,
        weight: -(0.1 * (p + 1) + (side === "lo" ? 0 : 0.3)),
        type: "condition",
      });
      synapses.push({
        fromUUID: "constant-1",
        toUUID: leaf,
        weight: 0.4 + 0.1 * p + (side === "lo" ? 0 : 0.25),
        type: "positive",
      });
      synapses.push({
        fromUUID: "constant-2",
        toUUID: leaf,
        weight: -0.3 - 0.1 * p - (side === "lo" ? 0 : 0.15),
        type: "negative",
      });
    }

    const root = `if-${p}-root`;
    neurons.push({ type: "hidden", uuid: root, squash: "IF", bias: 0 });
    const conditionSource = p === 0
      ? "relay-ident"
      : p === 1
      ? "relay-abs"
      : `input-${p % GRAFTED_INPUTS}`;
    synapses.push({
      fromUUID: conditionSource,
      toUUID: root,
      weight: 1,
      type: "condition",
    });
    synapses.push({
      fromUUID: "constant-0",
      toUUID: root,
      weight: -0.05 * (p + 1),
      type: "condition",
    });
    synapses.push({
      fromUUID: `if-${p}-hi`,
      toUUID: root,
      weight: 1,
      type: "positive",
    });
    synapses.push({
      fromUUID: `if-${p}-lo`,
      toUUID: root,
      weight: 1,
      type: "negative",
    });
  }

  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });
  for (let p = 0; p < GRAFTED_PATCHES; p++) {
    synapses.push({
      fromUUID: `if-${p}-root`,
      toUUID: "output-0",
      weight: 1 / GRAFTED_PATCHES,
    });
  }
  synapses.push({ fromUUID: "plain-1", toUUID: "output-0", weight: 0.5 });

  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: GRAFTED_INPUTS,
    output: 1,
    neurons,
    synapses,
  };
}

/**
 * A creature with no `IF` anywhere — the shape the Issue #3840 routing guard
 * must never touch, carrying an IDENTITY chain that folds exactly.
 */
export function pointWiseCreature(): CreatureExport {
  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: GRAFTED_INPUTS,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h-0", squash: "IDENTITY", bias: 0.2 },
      { type: "hidden", uuid: "h-1", squash: "IDENTITY", bias: -0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h-0", weight: 0.7 },
      { fromUUID: "h-0", toUUID: "h-1", weight: 0.5 },
      { fromUUID: "h-1", toUUID: "output-0", weight: 1.1 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 0.3 },
    ],
  };
}
