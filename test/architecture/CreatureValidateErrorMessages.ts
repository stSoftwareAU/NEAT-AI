/**
 * Issue #1365: Tests for CreatureValidate error message formatting.
 *
 * Verifies that validation error messages for output UUID mismatches,
 * neuron ordering issues, and input neuron positioning produce clean,
 * readable messages without leftover string concatenation fragments
 * (e.g. ' + "' from a broken template literal migration).
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import { TopologyError } from "../../src/errors/TopologyError.ts";
import type { ValidationError } from "../../src/errors/ValidationError.ts";

Deno.test("creatureValidate - output UUID mismatch produces clean message", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 1, squash: "IDENTITY" }],
  });

  // Corrupt the output neuron UUID to trigger the invalid output UUID error
  const outputNeuron = creature.neurons[creature.neurons.length - 1];
  // deno-lint-ignore no-explicit-any
  (outputNeuron as any).id = "wrong-uuid";

  let caught: Error | undefined;
  try {
    creatureValidate(creature);
  } catch (e) {
    caught = e as Error;
  }

  if (!caught) {
    throw new Error("Expected a ValidationError to be thrown");
  }

  // Must NOT contain leftover concatenation fragments
  assertEquals(
    caught.message.includes(' + "'),
    false,
    `Message should not contain ' + "': ${caught.message}`,
  );

  // The message should follow the format: "${id}) invalid neuron id: ${id}"
  assertStringIncludes(caught.message, "wrong-uuid) invalid neuron id:");
});

Deno.test("creatureValidate - non-output after output produces clean message", () => {
  // Build a creature JSON with a hidden neuron placed after an output neuron
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", bias: 0, squash: "IDENTITY" },
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      // This hidden neuron after the output triggers the ordering error
      { type: "hidden", uuid: "after-output", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "after-output", weight: 0.5 },
      { fromUUID: "after-output", toUUID: "output-0", weight: 0.3 },
    ],
  };

  const creature = Creature.fromJSON(json);

  let caught: Error | undefined;
  try {
    creatureValidate(creature);
  } catch (e) {
    caught = e as Error;
  }

  if (!caught) {
    throw new Error("Expected a ValidationError to be thrown");
  }

  // Must NOT contain leftover concatenation fragments
  assertEquals(
    caught.message.includes(' + "'),
    false,
    `Message should not contain ' + "': ${caught.message}`,
  );

  // The message should follow the format: "${uuid}) type ${type} after output neuron"
  assertStringIncludes(caught.message, ") type hidden after output neuron");
});

Deno.test("creatureValidate - input after max inputs produces clean message", () => {
  // Create a creature then corrupt a later neuron to type "input" with a
  // matching index so validation passes the id check and reaches the
  // "input neuron after the maximum input neurons" error.
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });

  // The hidden neuron at index creature.input is after the input range.
  // Set both type and id to match the index so the id check passes and
  // the "after max inputs" check fires.
  const hiddenIndex = creature.input + 1;
  const neuron = creature.neurons[hiddenIndex];
  neuron.type = "input";
  // deno-lint-ignore no-explicit-any
  (neuron as any).id = hiddenIndex;

  let caught: Error | undefined;
  try {
    creatureValidate(creature);
  } catch (e) {
    caught = e as Error;
  }

  if (!caught) {
    throw new Error("Expected a ValidationError to be thrown");
  }

  // Must NOT contain leftover concatenation fragments
  assertEquals(
    caught.message.includes(' + "'),
    false,
    `Message should not contain ' + "': ${caught.message}`,
  );

  // The message should follow the format: "${id}) input neuron after the maximum input neurons"
  assertStringIncludes(
    caught.message,
    `) input neuron after the maximum input neurons`,
  );
});

Deno.test(
  "creatureValidate - duplicate synapse message uses wire labels (GRQ-3 / Issue #1958)",
  () => {
    const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
    const hiddenIndex = creature.input;
    const hidden = creature.neurons[hiddenIndex];
    assertExists(hidden.uuid);

    creature.synapses.push(new Synapse(0, hiddenIndex, 0.11));
    creature.synapses.sort((a, b) =>
      a.from === b.from ? a.to - b.to : a.from - b.from
    );

    let caught: Error | undefined;
    try {
      creatureValidate(creature);
    } catch (e) {
      caught = e as Error;
    }
    assertExists(caught);
    assertEquals(caught instanceof TopologyError, true);
    assertStringIncludes(caught.message, "duplicate synapse");
    assertStringIncludes(caught.message, "input-0");
    assertStringIncludes(caught.message, hidden.uuid);
    assertEquals(
      caught.message.includes(String(hidden.id)),
      false,
      `message must not leak runtime neuron id: ${caught.message}`,
    );
  },
);

Deno.test(
  "creatureValidate - self-connection (forwardOnly) message uses wire labels only",
  () => {
    const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
    const hiddenIndex = creature.input;
    const hidden = creature.neurons[hiddenIndex];
    assertExists(hidden.uuid);

    creature.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.5));
    creature.synapses.sort((a, b) =>
      a.from === b.from ? a.to - b.to : a.from - b.from
    );

    let caught: ValidationError | undefined;
    try {
      creatureValidate(creature, { forwardOnly: true });
    } catch (e) {
      caught = e as ValidationError;
    }
    assertExists(caught);
    assertEquals(caught.reason, "SELF_CONNECTION");
    assertStringIncludes(caught.message, hidden.uuid);
    assertEquals(
      caught.message.includes(String(hidden.id)),
      false,
      `message must not leak runtime neuron id: ${caught.message}`,
    );
  },
);

Deno.test(
  "creatureValidate - recursive synapse message uses wire labels (forwardOnly)",
  () => {
    const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
    const h0 = creature.input;
    const h1 = creature.input + 1;
    const n0 = creature.neurons[h0];
    const n1 = creature.neurons[h1];
    assertExists(n0.uuid);
    assertExists(n1.uuid);

    creature.synapses.push(new Synapse(h1, h0, 0.25));
    creature.synapses.sort((a, b) =>
      a.from === b.from ? a.to - b.to : a.from - b.from
    );

    let caught: ValidationError | undefined;
    try {
      creatureValidate(creature, { forwardOnly: true });
    } catch (e) {
      caught = e as ValidationError;
    }
    assertExists(caught);
    assertEquals(caught.reason, "RECURSIVE_SYNAPSE");
    assertStringIncludes(caught.message, n1.uuid);
    assertStringIncludes(caught.message, n0.uuid);
    assertEquals(
      caught.message.includes(String(n0.id)),
      false,
      `message must not leak runtime neuron id: ${caught.message}`,
    );
    assertEquals(
      caught.message.includes(String(n1.id)),
      false,
      `message must not leak runtime neuron id: ${caught.message}`,
    );
  },
);

Deno.test(
  "creatureValidate - NO_INWARD hidden message uses wire uuid (GRQ-3)",
  () => {
    const json: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "orphan-hidden-grq3",
          bias: 0,
          squash: "IDENTITY",
        },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "orphan-hidden-grq3", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
      ],
    };
    const creature = Creature.fromJSON(json);
    const hidden = creature.neurons.find((n) =>
      n.uuid === "orphan-hidden-grq3"
    );
    assertExists(hidden);

    let caught: Error | undefined;
    try {
      creatureValidate(creature);
    } catch (e) {
      caught = e as Error;
    }
    assertExists(caught);
    assertStringIncludes(caught.message, "orphan-hidden-grq3");
    assertStringIncludes(caught.message, "no inward connections");
    assertEquals(
      caught.message.includes(String(hidden.id)),
      false,
      `message must not leak runtime neuron id: ${caught.message}`,
    );
  },
);
