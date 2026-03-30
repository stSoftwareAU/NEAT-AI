import { assert, assertEquals, fail } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { Neuron } from "../../src/architecture/Neuron.ts";
import {
  inputNeuronId,
  nextNeuronId,
  outputNeuronId,
} from "../../src/architecture/NeuronId.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import type { ValidationError } from "../../src/errors/ValidationError.ts";

Deno.test("validate rejects mismatched neuron count", () => {
  const creature = new Creature(10, 2);
  creatureValidate(creature);
  try {
    creatureValidate(creature, { neurons: 9 });
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "OTHER",
      `Unexpected reason: ${error.reason}`,
    );
  }
});

Deno.test("validate rejects negative input count", () => {
  const creature = new Creature(10, 2);
  creature.input = -1;
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "OTHER",
      `Unexpected reason: ${error.reason}`,
    );
  }
});

Deno.test("validate rejects negative output count", () => {
  const creature = new Creature(10, 2);
  creature.output = -1;
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "OTHER",
      `Unexpected reason: ${error.reason}`,
    );
  }
});

Deno.test(
  "validate rejects constant after hidden (required: input, constant, hidden, output)",
  () => {
    // `loadFrom` always canonicalises order; build in-memory to exercise
    // creatureValidate in isolation.
    const creature = new Creature(1, 1, {
      lazyInitialization: true,
      feedbackEnabled: true,
    });
    creature.forwardOnly = false;

    const in0 = new Neuron(inputNeuronId(0), "input", 0, creature);
    in0.index = 0;
    const hiddenN = new Neuron(
      nextNeuronId(),
      "hidden",
      0,
      creature,
      "IDENTITY",
    );
    hiddenN.uuid = "h1";
    hiddenN.index = 1;
    const constN = new Neuron(nextNeuronId(), "constant", 1, creature);
    constN.uuid = "c1";
    constN.index = 2;
    const outN = new Neuron(
      outputNeuronId(0),
      "output",
      0,
      creature,
      "IDENTITY",
    );
    outN.uuid = "output-0";
    outN.index = 3;

    creature.neurons = [in0, hiddenN, constN, outN];
    creature.synapses = [
      new Synapse(0, 1, 1),
      new Synapse(1, 3, 1),
      new Synapse(2, 3, 0.5),
    ];
    creature.synapses.sort((a, b) =>
      a.from !== b.from ? a.from - b.from : a.to - b.to
    );
    creature.clearCache();

    try {
      creatureValidate(creature);
      fail("Expected error");
    } catch (e) {
      const error = e as ValidationError;
      assertEquals(error.reason, "NEURON_ORDER");
      assert(
        error.message.includes("constant after hidden"),
        `message: ${error.message}`,
      );
    }
  },
);

Deno.test(
  "validate accepts computational order: constants then hiddens then outputs",
  () => {
    const tmp: CreatureExport = {
      neurons: [
        { type: "constant", uuid: "c1", bias: 1 },
        { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
        {
          type: "output",
          squash: "IDENTITY",
          uuid: "output-0",
          bias: 0,
        },
      ],
      synapses: [
        { fromUUID: "c1", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "input-0", toUUID: "h1", weight: 1 },
        { fromUUID: "h1", toUUID: "output-0", weight: 1 },
      ],
      input: 1,
      output: 1,
    };

    creatureValidate(Creature.fromJSON(tmp));
  },
);

Deno.test("validate rejects hidden neuron after output neuron", () => {
  const tmp: CreatureExport = {
    neurons: [
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
        type: "output",
      },
      {
        squash: "Mish",
        uuid: "wrong-1",
        bias: 0,
        type: "hidden",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "wrong-1", weight: -0.3 },
      { fromUUID: "wrong-1", toUUID: "output-0", weight: 0.8 },
    ],
    input: 3,
    output: 1,
  };

  const creature = Creature.fromJSON(tmp);

  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "OTHER",
      `Unexpected reason: ${error.reason}`,
    );
  }
});

Deno.test("validate rejects IF neuron without required condition synapses", () => {
  const tmp: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IF", bias: 2 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
        type: "output",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: -0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 3,
    output: 1,
  };

  const creature = Creature.fromJSON(tmp);

  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "IF_CONDITIONS",
      `Unexpected reason: ${error.reason}`,
    );
  }
});

Deno.test("validate rejects IF neuron with invalid synapse type combinations", () => {
  const tmp: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IF", bias: 2 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: -0.3,
        type: "positive",
      },
      {
        fromUUID: "input-1",
        toUUID: "hidden-0",
        weight: -0.3,
        type: "condition",
      },
      {
        fromUUID: "input-2",
        toUUID: "hidden-0",
        weight: -0.3,
        type: "negative",
      },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 3,
    output: 1,
  };

  Creature.fromJSON(tmp).validate();

  try {
    tmp.synapses[0].type = "negative";
    Creature.fromJSON(tmp).validate();
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "IF_CONDITIONS",
      `Unexpected reason: ${error.reason}`,
    );
  }

  try {
    tmp.synapses[0].type = "positive";
    tmp.synapses[1].type = "positive";
    Creature.fromJSON(tmp).validate();
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "IF_CONDITIONS",
      `Unexpected reason: ${error.reason}`,
    );
  }

  try {
    tmp.synapses[1].type = "condition";
    tmp.synapses[2].type = "positive";
    Creature.fromJSON(tmp).validate();
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "IF_CONDITIONS",
      `Unexpected reason: ${error.reason}`,
    );
  }
});

Deno.test("validate rejects neuron with empty UUID", () => {
  const creature = new Creature(10, 2);
  creature.neurons[0].id = "" as unknown as number;
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "OTHER",
      `Unexpected reason: ${error.reason}`,
    );
  }
});

Deno.test("validate rejects duplicate UUIDs", () => {
  const creature = new Creature(10, 2, { layers: [{ count: 10 }] });
  creature.DEBUG = true;
  creature.neurons[10].id = "A" as unknown as number;
  creature.neurons[11].id = "A" as unknown as number;
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "OTHER",
      `Unexpected reason: ${error.reason}`,
    );
  }
});

Deno.test("UUID too long", () => {
  const creature = new Creature(10, 2, { layers: [{ count: 10 }] });
  creature.DEBUG = true;
  const hiddenIndex = creature.input;
  const longSuffix = "x".repeat(300);
  // @ts-ignore: test with legacy string neuron IDs
  creature.neurons[hiddenIndex].id = `hidden-${longSuffix}`;
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "OTHER",
      `Unexpected reason: ${error.reason}`,
    );
  }
});

Deno.test("UUID invalid characters", () => {
  const creature = new Creature(10, 2, { layers: [{ count: 10 }] });
  creature.DEBUG = true;
  const hiddenIndex = creature.input;
  creature.neurons[hiddenIndex].id = "hidden uuid" as unknown as number;
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "OTHER",
      `Unexpected reason: ${error.reason}`,
    );
  }
});

Deno.test("invalid input UUID", () => {
  const creature = new Creature(10, 2, { layers: [{ count: 10 }] });
  creature.DEBUG = true;
  creature.neurons[0].id = "input-1000" as unknown as number;

  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "OTHER",
      `Unexpected reason: ${error.reason}`,
    );
  }
});

Deno.test("validate rejects infinite bias", () => {
  const creature = new Creature(10, 2, { layers: [{ count: 10 }] });
  creature.DEBUG = true;
  creature.neurons[10].bias = Infinity;
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "OTHER",
      `Unexpected reason: ${error.reason}`,
    );
  }
});

Deno.test("validate rejects output neuron with out-of-range index in UUID", () => {
  const creature = new Creature(10, 2);
  creature.DEBUG = true;
  creature.neurons[11].id = "output-10" as unknown as number;
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "OTHER",
      `Unexpected reason: ${error.reason}`,
    );
  }
});

Deno.test("validate rejects mismatched connection count", () => {
  const creature = new Creature(10, 2);
  creatureValidate(creature);
  try {
    creatureValidate(creature, { connections: 9 });
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "OTHER",
      `Unexpected reason: ${error.reason}`,
    );
  }
});

Deno.test("validate rejects neuron with incorrect index", () => {
  const creature = new Creature(10, 2);
  creature.DEBUG = true;
  creatureValidate(creature);
  creature.neurons[0].index = 10;
  try {
    creatureValidate(creature, { connections: 9 });
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "OTHER",
      `Unexpected reason: ${error.reason}`,
    );
  }
});

Deno.test("validate rejects recursive synapse when feedbackLoop is false", () => {
  const creature = new Creature(10, 2, { layers: [{ count: 5 }] });
  creature.DEBUG = true;
  creature.synapses.push(new Synapse(12, 11, 0.5));
  creature.synapses.sort((a, b) => {
    if (a.from === b.from) {
      return a.to - b.to;
    } else return a.from - b.from;
  });
  try {
    creatureValidate(creature, { feedbackLoop: false });

    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "RECURSIVE_SYNAPSE",
      `Unexpected reason: ${error.reason}`,
    );
  }
});

Deno.test("Forward-only: default validate allows back + self connections", () => {
  const creature = new Creature(10, 2, { layers: [{ count: 5 }] });
  creature.DEBUG = true;

  // Add one back connection and one self connection.
  creature.synapses.push(new Synapse(12, 11, 0.5));
  creature.synapses.push(new Synapse(11, 11, 0.25));
  creature.synapses.sort((a, b) => {
    if (a.from === b.from) return a.to - b.to;
    return a.from - b.from;
  });

  // By default we allow back connections (memory) and self connections.
  creature.validate();
});

Deno.test("Forward-only: validate() rejects back connections when enabled", () => {
  const creature = new Creature(10, 2, { layers: [{ count: 5 }] });
  creature.DEBUG = true;
  creature.synapses.push(new Synapse(12, 11, 0.5));
  creature.synapses.sort((a, b) => {
    if (a.from === b.from) return a.to - b.to;
    return a.from - b.from;
  });

  try {
    creature.validate({ forwardOnly: true });
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "RECURSIVE_SYNAPSE",
      `Unexpected reason: ${error.reason}`,
    );
  }
});

Deno.test("Forward-only: validate() rejects self connections when enabled", () => {
  const creature = new Creature(10, 2, { layers: [{ count: 5 }] });
  creature.DEBUG = true;
  creature.synapses.push(new Synapse(11, 11, 0.5));
  creature.synapses.sort((a, b) => {
    if (a.from === b.from) return a.to - b.to;
    return a.from - b.from;
  });

  try {
    creature.validate({ forwardOnly: true });
    fail("Expected error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "SELF_CONNECTION",
      `Unexpected reason: ${error.reason}`,
    );
  }
});
