/**
 * Corner-case tests for compact operations to prevent invalid creatures
 * (synapses referencing non-existent neurons).
 *
 * Issue #2013: TDD tests covering edge cases in CompactCreature.ts
 */
import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { compactCreature } from "../../src/compact/CompactCreature.ts";
import { assertValidSynapseReferences } from "../../src/architecture/AssertValidSynapseReferences.ts";

/**
 * Helper: validate that the result creature (if compacted) has no dangling
 * synapse references and passes full validation.
 */
function assertCompactedCreatureValid(
  result: Creature | undefined,
  context: string,
): void {
  if (result === undefined) return;
  const exported = result.exportInternalJSON();
  assertValidSynapseReferences(exported, context);
  result.validate();
}

Deno.test("compactCreature integrity: COMPLEMENT bypass with cascading removal", () => {
  // COMPLEMENT neuron (comp-h) feeds a hidden IDENTITY neuron (bridge-h)
  // which feeds the output. Removing comp-h via bypass should not leave
  // any dangling references; bridge-h may become orphaned and also be removed.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "comp-h",
        squash: "COMPLEMENT",
        bias: 0.3,
      },
      {
        type: "hidden",
        uuid: "bridge-h",
        squash: "IDENTITY",
        bias: 0.1,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "comp-h", weight: 0.5 },
      { fromUUID: "comp-h", toUUID: "bridge-h", weight: 0.8 },
      { fromUUID: "bridge-h", toUUID: "output-0", weight: 0.6 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const testInput = new Float32Array([0.5, 0.25]);
  const originalOutput = creature.activate(testInput);

  const result = compactCreature(creature, false);

  assert(result !== undefined, "Should compact cascading COMPLEMENT");
  assertCompactedCreatureValid(result, "COMPLEMENT cascading removal");

  const compactedOutput = result.activate(testInput);
  assertAlmostEquals(
    compactedOutput[0],
    originalOutput[0],
    1e-6,
    "Cascading COMPLEMENT bypass should preserve behaviour",
  );
});

Deno.test("compactCreature integrity: chain compaction where fromNeuron is also a COMPLEMENT candidate", () => {
  // Two hidden neurons: comp-h (COMPLEMENT) feeds chain-h (IDENTITY) feeds
  // output. comp-h also has a direct link to output. The COMPLEMENT bypass
  // and chain compaction both interact on the same structure.
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "comp-h",
        squash: "COMPLEMENT",
        bias: 0.2,
      },
      {
        type: "hidden",
        uuid: "chain-h",
        squash: "IDENTITY",
        bias: 0.0,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "comp-h", weight: 0.4 },
      { fromUUID: "comp-h", toUUID: "chain-h", weight: 0.6 },
      { fromUUID: "chain-h", toUUID: "output-0", weight: 0.9 },
      { fromUUID: "comp-h", toUUID: "output-0", weight: 0.3 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const testInput = new Float32Array([0.7]);
  const originalOutput = creature.activate(testInput);

  // May need multiple compaction rounds (each call does one pass).
  let current: Creature = creature;
  for (let i = 0; i < 5; i++) {
    const next = compactCreature(current, false);
    if (next === undefined) break;
    assertCompactedCreatureValid(next, `COMPLEMENT+chain round ${i}`);
    current = next;
  }

  const compactedOutput = current.activate(testInput);
  assertAlmostEquals(
    compactedOutput[0],
    originalOutput[0],
    1e-5,
    "COMPLEMENT + chain interaction should preserve behaviour",
  );
});

Deno.test("compactCreature integrity: backward synapse removal creating orphans", () => {
  // Forward-only creature where a hidden neuron's only inbound synapse is
  // backward (source index > target index). Removing it should leave
  // the hidden neuron orphaned, which should then be cleaned up.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      // h1 appears first — it gets input
      { type: "hidden", uuid: "h1", squash: "LOGISTIC", bias: 0.1 },
      // h2 appears second — only inbound is from h1 (forward)
      { type: "hidden", uuid: "h2", squash: "LOGISTIC", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
      { fromUUID: "h1", toUUID: "h2", weight: 0.4 },
      { fromUUID: "h2", toUUID: "output-0", weight: 0.6 },
      // backward synapse: h2 -> h1 (h2 is at higher index than h1)
      { fromUUID: "h2", toUUID: "h1", weight: 0.3 },
      { fromUUID: "h1", toUUID: "output-0", weight: 0.7 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const result = compactCreature(creature, false);

  assert(
    result !== undefined,
    "Should compact forward-only creature with backward synapse",
  );
  assertCompactedCreatureValid(result, "backward synapse orphan cleanup");

  // The backward synapse h2->h1 should be removed — verify no dangling refs
  const exported = result.exportInternalJSON();
  assertValidSynapseReferences(exported, "backward removal final check");
});

Deno.test("compactCreature integrity: multiple compact operations in sequence", () => {
  // Creature where COMPLEMENT bypass + chain compaction + backward removal
  // all trigger in the same call or across sequential calls.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      {
        type: "hidden",
        uuid: "comp-h",
        squash: "COMPLEMENT",
        bias: 0.15,
      },
      {
        type: "hidden",
        uuid: "chain-h",
        squash: "IDENTITY",
        bias: 0.0,
      },
      {
        type: "hidden",
        uuid: "dead-h",
        squash: "LOGISTIC",
        bias: 0.3,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "comp-h", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "comp-h", weight: 0.2 },
      { fromUUID: "comp-h", toUUID: "output-0", weight: 0.8 },
      // chain-h bridges input-0 -> output-0 via IDENTITY
      { fromUUID: "input-0", toUUID: "chain-h", weight: 0.3 },
      { fromUUID: "chain-h", toUUID: "output-0", weight: 0.4 },
      // dead-h has inbound but no path to output
      { fromUUID: "input-1", toUUID: "dead-h", weight: 0.6 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const testInput = new Float32Array([0.4, 0.6]);
  const originalOutput = creature.activate(testInput);

  // Run multiple compaction rounds
  let current: Creature = creature;
  for (let i = 0; i < 10; i++) {
    const next = compactCreature(current, false);
    if (next === undefined) break;
    assertCompactedCreatureValid(next, `multi-compact round ${i}`);
    current = next;
  }

  const compactedOutput = current.activate(testInput);
  assertAlmostEquals(
    compactedOutput[0],
    originalOutput[0],
    1e-5,
    "Multiple compaction operations should preserve behaviour",
  );
});

Deno.test("compactCreature integrity: neuron with zero-weight synapses becomes bridge after pruning", () => {
  // h1 has two inbound synapses: one zero-weight and one non-zero.
  // After zero-weight pruning, h1 has exactly 1 in and 1 out, making it
  // a bridge candidate for chain compaction.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0.0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0.0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      // h1 gets two inbound: one zero-weight (will be pruned), one non-zero
      { fromUUID: "input-0", toUUID: "h1", weight: 0 },
      { fromUUID: "input-1", toUUID: "h1", weight: 0.5 },
      { fromUUID: "h1", toUUID: "h2", weight: 0.8 },
      // h2 also a bridge: 1 in, 1 out
      { fromUUID: "h2", toUUID: "output-0", weight: 0.6 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const testInput = new Float32Array([0.3, 0.7]);
  const originalOutput = creature.activate(testInput);

  // Multiple rounds to allow zero-weight pruning then chain compaction
  let current: Creature = creature;
  for (let i = 0; i < 10; i++) {
    const next = compactCreature(current, false);
    if (next === undefined) break;
    assertCompactedCreatureValid(next, `zero-weight-bridge round ${i}`);
    current = next;
  }

  const compactedOutput = current.activate(testInput);
  assertAlmostEquals(
    compactedOutput[0],
    originalOutput[0],
    1e-5,
    "Zero-weight pruning + bridge compaction should preserve behaviour",
  );
});

Deno.test("compactCreature integrity: COMPLEMENT bypass does not create dangling references", () => {
  // Regression test: COMPLEMENT neuron with multiple inbound and multiple
  // outbound connections. After bypass, all new redirect synapses must
  // reference only existing neurons.
  const json: CreatureExport = {
    input: 3,
    output: 2,
    neurons: [
      {
        type: "hidden",
        uuid: "comp-h",
        squash: "COMPLEMENT",
        bias: 0.1,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0.2 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "comp-h", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "comp-h", weight: -0.5 },
      { fromUUID: "input-2", toUUID: "comp-h", weight: 0.7 },
      { fromUUID: "comp-h", toUUID: "output-0", weight: 1.2 },
      { fromUUID: "comp-h", toUUID: "output-1", weight: -0.4 },
      // Direct connections that should have weights merged
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const testInput = new Float32Array([0.5, -0.3, 0.8]);
  const originalOutput = creature.activate(testInput);

  const result = compactCreature(creature, false);

  assert(result !== undefined, "Should compact COMPLEMENT with multi-IO");
  assertCompactedCreatureValid(result, "COMPLEMENT multi-IO bypass");

  const compactedOutput = result.activate(testInput);
  for (let i = 0; i < originalOutput.length; i++) {
    assertAlmostEquals(
      compactedOutput[i],
      originalOutput[i],
      1e-6,
      `Output ${i} should be preserved after COMPLEMENT bypass`,
    );
  }
});
