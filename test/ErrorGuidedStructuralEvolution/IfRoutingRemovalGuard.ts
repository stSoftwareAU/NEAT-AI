/**
 * GRQ issue #4303: discovery's low-impact neuron removal destroys
 * Forests-grafted creatures.
 *
 * The impact metric measures a neuron's magnitude of contribution to downstream
 * activation sums. An `IF` node's inputs matter by *presence*, not magnitude —
 * and the thresholds/leaf values of a grafted decision tree ride as weights on
 * shared bias-1 constants — so such a neuron scores ~0.00% impact while its
 * removal flips or breaks the routing of every node hanging off it. One live
 * removal advertised at `impact: 0.00%` cost 0.118 of score.
 *
 * These tests pin the guard: a neuron that feeds an `IF` node is never removed
 * as low impact, while ordinary low-impact removal still works.
 */

import { assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { removeLowImpactNeuron } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryNeuronRemoval.ts";
import { feedsIfNeuron } from "@architecture/ErrorGuidedStructuralEvolution/IfRoutingGuard.ts";
import type { RemovalCandidate } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * A Forests-shaped graft: an `IF` node whose condition threshold rides on a
 * shared constant, plus an unrelated hidden neuron that feeds only the output.
 */
function forestsGraft(): CreatureExport {
  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 2,
    output: 1,
    neurons: [
      { type: "constant", uuid: "const-threshold", bias: 0.5 },
      { type: "constant", uuid: "const-leaf-pos", bias: -0.25 },
      { type: "constant", uuid: "const-leaf-neg", bias: 2 },
      { type: "hidden", uuid: "if-node", squash: "IF", bias: 0 },
      { type: "hidden", uuid: "plain-hidden", squash: "IDENTITY", bias: 0.01 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "if-node", weight: 1, type: "condition" },
      {
        fromUUID: "const-threshold",
        toUUID: "if-node",
        weight: 0.4,
        type: "condition",
      },
      { fromUUID: "input-1", toUUID: "if-node", weight: 0.7, type: "positive" },
      {
        fromUUID: "const-leaf-pos",
        toUUID: "if-node",
        weight: 0.6,
        type: "positive",
      },
      {
        fromUUID: "const-leaf-neg",
        toUUID: "if-node",
        weight: 0.3,
        type: "negative",
      },
      { fromUUID: "if-node", toUUID: "output-0", weight: 0.9 },
      { fromUUID: "input-1", toUUID: "plain-hidden", weight: 0.001 },
      { fromUUID: "plain-hidden", toUUID: "output-0", weight: 0.002 },
    ],
  } as CreatureExport;
}

/** A creature with no `IF` node at all — ordinary low-impact removal applies. */
function plainNetwork(): CreatureExport {
  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "low-impact", squash: "IDENTITY", bias: 0.01 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "low-impact", weight: 0.001 },
      { fromUUID: "low-impact", toUUID: "output-0", weight: 0.002 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.5 },
    ],
  } as CreatureExport;
}

function candidateFor(neuronUuid: string): RemovalCandidate {
  return {
    neuronUuid,
    totalError: 0,
    // The exact value the live regression reported: 0.00% impact.
    impact: 0,
    reason: "low_impact",
    meanActivation: 0,
  } as RemovalCandidate;
}

Deno.test("feedsIfNeuron spots a constant backing an IF condition", async () => {
  await initWasmForTests();
  const exported = Creature.fromJSON(forestsGraft()).exportJSON();

  assertEquals(
    feedsIfNeuron(exported.neurons, exported.synapses, "const-threshold"),
    true,
  );
  assertEquals(
    feedsIfNeuron(exported.neurons, exported.synapses, "plain-hidden"),
    false,
  );
});

Deno.test("feedsIfNeuron is false when the creature has no IF node", async () => {
  await initWasmForTests();
  const exported = Creature.fromJSON(plainNetwork()).exportJSON();

  assertEquals(
    feedsIfNeuron(exported.neurons, exported.synapses, "low-impact"),
    false,
  );
});

Deno.test("removeLowImpactNeuron refuses a constant that routes an IF node", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(forestsGraft());

  const result = removeLowImpactNeuron(
    "issue-4303",
    creature,
    candidateFor("const-threshold"),
  );

  assertEquals(
    result,
    undefined,
    "a 0.00%-impact constant backing an IF condition must not be removed",
  );
});

Deno.test("removeLowImpactNeuron still removes an ordinary low-impact neuron", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(plainNetwork());

  const result = removeLowImpactNeuron(
    "issue-4303-control",
    creature,
    candidateFor("low-impact"),
  );

  assertEquals(
    result !== undefined,
    true,
    "the guard must not disable low-impact removal outside IF structure",
  );
  const remaining = result!.exportJSON().neurons.map((n) => n.uuid);
  assertEquals(remaining.includes("low-impact"), false);
});
