/**
 * ExternalInterfaceContract.ts - Explicit contract tests for the external
 * interface fields of exportJSON().
 *
 * Issue #2053: These tests serve as a tripwire — if anyone modifies the export
 * to drop or rename a field, the test name and assertion message make it
 * immediately obvious that an external interface contract is being broken.
 *
 * Issue #2054: exportJSON() no longer includes runtime integer IDs (`id`,
 * `fromId`, `toId`). External consumers must use UUID fields only.
 *
 * Each external interface field has a named assertion test so that breakage
 * is caught by the test suite before it reaches consumers.
 */

import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Creature with hidden, constant, and output neurons for comprehensive tests. */
function makeContractCreature(): CreatureExport {
  return {
    input: 2,
    output: 2,
    neurons: [
      {
        type: "hidden",
        uuid: "contract-hidden-a",
        bias: 0.3,
        squash: "LOGISTIC",
      },
      {
        type: "constant",
        uuid: "contract-const-b",
        bias: 1.0,
      },
      { type: "output", uuid: "output-0", bias: 0.1, squash: "IDENTITY" },
      { type: "output", uuid: "output-1", bias: -0.2, squash: "TANH" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "contract-hidden-a", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "contract-hidden-a", weight: -0.3 },
      {
        fromUUID: "contract-const-b",
        toUUID: "contract-hidden-a",
        weight: 0.2,
      },
      { fromUUID: "contract-hidden-a", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "contract-hidden-a", toUUID: "output-1", weight: 0.4 },
    ],
  };
}

/** Helper to create a creature and export it. */
function exportContractCreature(): CreatureExport {
  const creature = Creature.fromJSON(makeContractCreature());
  return creature.exportJSON();
}

// ---------------------------------------------------------------------------
// Neuron export contract
// ---------------------------------------------------------------------------

Deno.test(
  "Neuron export must include uuid field as a string",
  () => {
    const exported = exportContractCreature();
    for (const neuron of exported.neurons) {
      assertEquals(
        typeof neuron.uuid,
        "string",
        `Neuron contract violated: neuron of type '${neuron.type}' is missing uuid string field`,
      );
      assert(
        neuron.uuid!.length > 0,
        `Neuron contract violated: neuron uuid must not be empty (type '${neuron.type}')`,
      );
    }
  },
);

Deno.test(
  "Neuron export must NOT include integer id field (Issue #2054)",
  () => {
    const exported = exportContractCreature();
    for (const neuron of exported.neurons) {
      assertEquals(
        neuron.id,
        undefined,
        `Neuron contract violated: neuron of type '${neuron.type}' must not include runtime integer id (Issue #2054)`,
      );
    }
  },
);

Deno.test(
  "Neuron export must include type field as one of hidden, output, constant",
  () => {
    const exported = exportContractCreature();
    const validTypes = new Set(["hidden", "output", "constant"]);
    for (const neuron of exported.neurons) {
      assert(
        validTypes.has(neuron.type),
        `Neuron contract violated: type '${neuron.type}' is not one of hidden, output, constant`,
      );
    }
  },
);

Deno.test(
  "Neuron export must include bias field as a number",
  () => {
    const exported = exportContractCreature();
    for (const neuron of exported.neurons) {
      assertEquals(
        typeof neuron.bias,
        "number",
        `Neuron contract violated: neuron '${neuron.uuid}' is missing bias number field`,
      );
    }
  },
);

Deno.test(
  "Output neuron uuid must match output-N pattern",
  () => {
    const exported = exportContractCreature();
    const outputNeurons = exported.neurons.filter((n) => n.type === "output");
    assert(
      outputNeurons.length > 0,
      "Contract requires at least one output neuron in test fixture",
    );
    for (let i = 0; i < outputNeurons.length; i++) {
      assertEquals(
        outputNeurons[i].uuid,
        `output-${i}`,
        `Output neuron contract violated: output neuron ${i} uuid should be 'output-${i}', got '${
          outputNeurons[i].uuid
        }'`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Synapse export contract
// ---------------------------------------------------------------------------

Deno.test(
  "Synapse export must include fromUUID field as a string",
  () => {
    const exported = exportContractCreature();
    for (const synapse of exported.synapses) {
      assertEquals(
        typeof synapse.fromUUID,
        "string",
        `Synapse contract violated: synapse is missing fromUUID string field`,
      );
      assert(
        synapse.fromUUID!.length > 0,
        "Synapse contract violated: fromUUID must not be empty",
      );
    }
  },
);

Deno.test(
  "Synapse export must include toUUID field as a string",
  () => {
    const exported = exportContractCreature();
    for (const synapse of exported.synapses) {
      assertEquals(
        typeof synapse.toUUID,
        "string",
        `Synapse contract violated: synapse is missing toUUID string field`,
      );
      assert(
        synapse.toUUID!.length > 0,
        "Synapse contract violated: toUUID must not be empty",
      );
    }
  },
);

Deno.test(
  "Synapse export must NOT include fromId field (Issue #2054)",
  () => {
    const exported = exportContractCreature();
    for (const synapse of exported.synapses) {
      assertEquals(
        synapse.fromId,
        undefined,
        `Synapse contract violated: synapse from '${synapse.fromUUID}' must not include runtime fromId (Issue #2054)`,
      );
    }
  },
);

Deno.test(
  "Synapse export must NOT include toId field (Issue #2054)",
  () => {
    const exported = exportContractCreature();
    for (const synapse of exported.synapses) {
      assertEquals(
        synapse.toId,
        undefined,
        `Synapse contract violated: synapse to '${synapse.toUUID}' must not include runtime toId (Issue #2054)`,
      );
    }
  },
);

Deno.test(
  "Synapse export must include weight field as a number",
  () => {
    const exported = exportContractCreature();
    for (const synapse of exported.synapses) {
      assertEquals(
        typeof synapse.weight,
        "number",
        `Synapse contract violated: synapse '${synapse.fromUUID}->${synapse.toUUID}' is missing weight number field`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Cross-system round-trip test
// ---------------------------------------------------------------------------

Deno.test(
  "Legacy consumer using only UUID fields can consume exportJSON output",
  () => {
    const exported = exportContractCreature();

    // Simulate a legacy consumer that only uses UUID-based fields
    const neuronUuids = new Set<string>();
    for (const neuron of exported.neurons) {
      assert(
        typeof neuron.uuid === "string",
        "Legacy consumer contract: neuron must have uuid",
      );
      neuronUuids.add(neuron.uuid!);
    }

    // Add implicit input UUIDs
    for (let i = 0; i < exported.input; i++) {
      neuronUuids.add(`input-${i}`);
    }

    // Legacy consumer uses fromUUID/toUUID to reconstruct the graph
    for (const synapse of exported.synapses) {
      assert(
        typeof synapse.fromUUID === "string",
        "Legacy consumer contract: synapse must have fromUUID",
      );
      assert(
        typeof synapse.toUUID === "string",
        "Legacy consumer contract: synapse must have toUUID",
      );
      assert(
        neuronUuids.has(synapse.fromUUID!),
        `Legacy consumer contract: fromUUID '${synapse.fromUUID}' must reference a known neuron`,
      );
      assert(
        neuronUuids.has(synapse.toUUID!),
        `Legacy consumer contract: toUUID '${synapse.toUUID}' must reference a known neuron`,
      );
    }
  },
);

Deno.test(
  "External consumer cannot rely on integer IDs in exportJSON (Issue #2054)",
  () => {
    const exported = exportContractCreature();

    // External consumers must use UUID-based fields, not integer IDs
    for (const neuron of exported.neurons) {
      assertEquals(
        neuron.id,
        undefined,
        "External consumer contract: neuron must NOT have integer id",
      );
    }

    for (const synapse of exported.synapses) {
      assertEquals(
        synapse.fromId,
        undefined,
        "External consumer contract: synapse must NOT have fromId",
      );
      assertEquals(
        synapse.toId,
        undefined,
        "External consumer contract: synapse must NOT have toId",
      );
    }
  },
);

Deno.test(
  "Export then import then export produces identical external interface fields",
  () => {
    const original = makeContractCreature();
    const creature1 = Creature.fromJSON(original);
    const exported1 = creature1.exportJSON();

    // Re-import and re-export
    const creature2 = Creature.fromJSON(exported1);
    const exported2 = creature2.exportJSON();

    // Verify neuron external interface fields are identical
    assertEquals(
      exported1.neurons.length,
      exported2.neurons.length,
      "Round-trip contract: neuron count must be preserved",
    );
    for (let i = 0; i < exported1.neurons.length; i++) {
      const n1 = exported1.neurons[i];
      const n2 = exported2.neurons[i];
      assertEquals(
        n1.uuid,
        n2.uuid,
        `Round-trip contract: neuron ${i} uuid must be preserved`,
      );
      assertEquals(
        n1.type,
        n2.type,
        `Round-trip contract: neuron ${i} type must be preserved`,
      );
      assertEquals(
        n1.bias,
        n2.bias,
        `Round-trip contract: neuron ${i} bias must be preserved`,
      );
      assertEquals(
        n1.squash,
        n2.squash,
        `Round-trip contract: neuron ${i} squash must be preserved`,
      );
    }

    // Verify synapse external interface fields are identical
    assertEquals(
      exported1.synapses.length,
      exported2.synapses.length,
      "Round-trip contract: synapse count must be preserved",
    );
    for (let i = 0; i < exported1.synapses.length; i++) {
      const s1 = exported1.synapses[i];
      const s2 = exported2.synapses[i];
      assertEquals(
        s1.fromUUID,
        s2.fromUUID,
        `Round-trip contract: synapse ${i} fromUUID must be preserved`,
      );
      assertEquals(
        s1.toUUID,
        s2.toUUID,
        `Round-trip contract: synapse ${i} toUUID must be preserved`,
      );
      assertEquals(
        s1.weight,
        s2.weight,
        `Round-trip contract: synapse ${i} weight must be preserved`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Distributed identity test
// ---------------------------------------------------------------------------

Deno.test(
  "Same JSON imported on different machines produces identical UUIDs",
  () => {
    const json = makeContractCreature();

    // Simulate "machine A" — first independent import
    const creatureA = Creature.fromJSON(JSON.parse(JSON.stringify(json)));
    const exportedA = creatureA.exportJSON();

    // Simulate "machine B" — second independent import from same JSON
    const creatureB = Creature.fromJSON(JSON.parse(JSON.stringify(json)));
    const exportedB = creatureB.exportJSON();

    // Neuron UUIDs must be identical regardless of runtime context
    assertEquals(
      exportedA.neurons.length,
      exportedB.neurons.length,
      "Distributed identity contract: neuron count must match",
    );
    for (let i = 0; i < exportedA.neurons.length; i++) {
      assertEquals(
        exportedA.neurons[i].uuid,
        exportedB.neurons[i].uuid,
        `Distributed identity contract: neuron ${i} uuid must be deterministic across machines`,
      );
    }

    // Synapse UUIDs must be identical regardless of runtime context
    assertEquals(
      exportedA.synapses.length,
      exportedB.synapses.length,
      "Distributed identity contract: synapse count must match",
    );
    for (let i = 0; i < exportedA.synapses.length; i++) {
      assertEquals(
        exportedA.synapses[i].fromUUID,
        exportedB.synapses[i].fromUUID,
        `Distributed identity contract: synapse ${i} fromUUID must be deterministic across machines`,
      );
      assertEquals(
        exportedA.synapses[i].toUUID,
        exportedB.synapses[i].toUUID,
        `Distributed identity contract: synapse ${i} toUUID must be deterministic across machines`,
      );
    }
  },
);

Deno.test(
  "Programmatically constructed creature preserves contract after round-trip across machines",
  () => {
    // Build a creature programmatically (simulates machine A creating a new creature)
    const creatureA = new Creature(3, 2, {
      layers: [{ count: 4, squash: "LOGISTIC" }],
    });
    const exportedA = creatureA.exportJSON();

    // Simulate machine B importing the JSON exported by machine A
    const creatureB = Creature.fromJSON(
      JSON.parse(JSON.stringify(exportedA)),
    );
    const exportedB = creatureB.exportJSON();

    // All external interface fields must match
    assertEquals(
      exportedA.neurons.length,
      exportedB.neurons.length,
      "Cross-machine round-trip: neuron count must match",
    );
    for (let i = 0; i < exportedA.neurons.length; i++) {
      assertEquals(
        exportedA.neurons[i].uuid,
        exportedB.neurons[i].uuid,
        `Cross-machine round-trip: neuron ${i} uuid must match`,
      );
      assertEquals(
        exportedA.neurons[i].type,
        exportedB.neurons[i].type,
        `Cross-machine round-trip: neuron ${i} type must match`,
      );
      assertEquals(
        exportedA.neurons[i].bias,
        exportedB.neurons[i].bias,
        `Cross-machine round-trip: neuron ${i} bias must match`,
      );
    }

    for (let i = 0; i < exportedA.synapses.length; i++) {
      assertEquals(
        exportedA.synapses[i].fromUUID,
        exportedB.synapses[i].fromUUID,
        `Cross-machine round-trip: synapse ${i} fromUUID must match`,
      );
      assertEquals(
        exportedA.synapses[i].toUUID,
        exportedB.synapses[i].toUUID,
        `Cross-machine round-trip: synapse ${i} toUUID must match`,
      );
      assertEquals(
        exportedA.synapses[i].weight,
        exportedB.synapses[i].weight,
        `Cross-machine round-trip: synapse ${i} weight must match`,
      );
    }
  },
);
