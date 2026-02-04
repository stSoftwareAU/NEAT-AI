/**
 * Tests for Streaming Creature I/O
 *
 * Issue #1296: Performance: Streaming JSON parsing for creature serialisation
 *
 * Tests streaming write and read operations for creature serialisation/deserialisation,
 * verifying correctness across various creature sizes and configurations.
 */

import { assertEquals, assertExists } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  createStreamingCreatureReader,
  createStreamingCreatureWriter,
  streamCreatureFromFile,
  streamCreatureToFile,
} from "../../src/architecture/StreamingCreatureIO.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("StreamingCreatureIO - write and read minimal creature", async () => {
  const creature = new Creature(2, 1);
  const filePath = await Deno.makeTempFile({ suffix: ".json" });

  try {
    // Write using streaming
    await streamCreatureToFile(creature, filePath);

    // Read back using streaming
    const loaded = await streamCreatureFromFile(filePath);

    // Verify creature structure matches
    assertEquals(loaded.input, creature.input);
    assertEquals(loaded.output, creature.output);
    assertEquals(loaded.neurons.length, creature.neurons.length);
    assertEquals(loaded.synapses.length, creature.synapses.length);

    // Verify activation produces same results
    const input = new Float32Array([0.5, 0.5]);
    const originalOutput = creature.activate(input);
    const loadedOutput = loaded.activate(input);
    assertEquals(loadedOutput, originalOutput);
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("StreamingCreatureIO - write and read creature with hidden layer", async () => {
  const creature = new Creature(3, 2, {
    layers: [{ count: 4, squash: "TANH" }],
  });
  const filePath = await Deno.makeTempFile({ suffix: ".json" });

  try {
    await streamCreatureToFile(creature, filePath);
    const loaded = await streamCreatureFromFile(filePath);

    assertEquals(loaded.input, creature.input);
    assertEquals(loaded.output, creature.output);
    assertEquals(loaded.neurons.length, creature.neurons.length);
    assertEquals(loaded.synapses.length, creature.synapses.length);

    // Verify neuron properties preserved
    for (let i = creature.input; i < creature.neurons.length; i++) {
      assertEquals(loaded.neurons[i].squash, creature.neurons[i].squash);
      assertEquals(loaded.neurons[i].bias, creature.neurons[i].bias);
    }
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("StreamingCreatureIO - write and read large creature", async () => {
  // Create a creature with multiple hidden layers (similar to issue's 600+ neurons scenario)
  const creature = new Creature(10, 5, {
    layers: [
      { count: 50, squash: "ReLU" },
      { count: 30, squash: "TANH" },
      { count: 20, squash: "LOGISTIC" },
    ],
  });
  const filePath = await Deno.makeTempFile({ suffix: ".json" });

  try {
    await streamCreatureToFile(creature, filePath);
    const loaded = await streamCreatureFromFile(filePath);

    assertEquals(loaded.input, creature.input);
    assertEquals(loaded.output, creature.output);
    assertEquals(loaded.neurons.length, creature.neurons.length);
    assertEquals(loaded.synapses.length, creature.synapses.length);

    // Verify activation
    const input = new Float32Array([
      0.1,
      0.2,
      0.3,
      0.4,
      0.5,
      0.6,
      0.7,
      0.8,
      0.9,
      1.0,
    ]);
    const originalOutput = creature.activate(input);
    const loadedOutput = loaded.activate(input);

    for (let i = 0; i < originalOutput.length; i++) {
      assertEquals(loadedOutput[i], originalOutput[i]);
    }
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("StreamingCreatureIO - preserve tags", async () => {
  const creature = new Creature(2, 1);
  creature.tags = [
    { name: "generation", value: "42" },
    { name: "fitness", value: "0.95" },
  ];
  const filePath = await Deno.makeTempFile({ suffix: ".json" });

  try {
    await streamCreatureToFile(creature, filePath);
    const loaded = await streamCreatureFromFile(filePath);

    assertExists(loaded.tags);
    assertEquals(loaded.tags?.length, 2);
    assertEquals(loaded.tags?.[0].name, "generation");
    assertEquals(loaded.tags?.[0].value, "42");
    assertEquals(loaded.tags?.[1].name, "fitness");
    assertEquals(loaded.tags?.[1].value, "0.95");
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("StreamingCreatureIO - preserve forwardOnly flag", async () => {
  const creature = new Creature(2, 1);
  creature.forwardOnly = true;
  const filePath = await Deno.makeTempFile({ suffix: ".json" });

  try {
    await streamCreatureToFile(creature, filePath);
    const loaded = await streamCreatureFromFile(filePath);

    assertEquals(loaded.forwardOnly, true);
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("StreamingCreatureIO - streaming writer produces valid JSON", async () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 3, squash: "TANH" }],
  });

  const chunks: string[] = [];
  const writer = createStreamingCreatureWriter(creature);

  for await (const chunk of writer) {
    chunks.push(chunk);
  }

  const fullJson = chunks.join("");

  // Should be valid JSON
  const parsed = JSON.parse(fullJson);
  assertEquals(parsed.input, creature.input);
  assertEquals(parsed.output, creature.output);
  assertExists(parsed.neurons);
  assertExists(parsed.synapses);
});

Deno.test("StreamingCreatureIO - streaming reader handles chunked input", async () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 3, squash: "TANH" }],
  });

  // Export to JSON
  const exported = creature.exportJSON();
  const jsonStr = JSON.stringify(exported);

  // Simulate chunked input (break into small chunks)
  const chunkSize = 100;
  const chunks: string[] = [];
  for (let i = 0; i < jsonStr.length; i += chunkSize) {
    chunks.push(jsonStr.slice(i, i + chunkSize));
  }

  // Create async iterator from chunks
  async function* chunkedReader(): AsyncGenerator<string> {
    for (const chunk of chunks) {
      yield chunk;
    }
  }

  const reader = createStreamingCreatureReader();
  const loaded = await reader.readFromChunks(chunkedReader());

  assertEquals(loaded.input, creature.input);
  assertEquals(loaded.output, creature.output);
  assertEquals(loaded.neurons.length, creature.neurons.length);
  assertEquals(loaded.synapses.length, creature.synapses.length);
});

Deno.test("StreamingCreatureIO - sync write and read", async () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 3, squash: "TANH" }],
  });
  const filePath = await Deno.makeTempFile({ suffix: ".json" });

  try {
    // Import sync versions
    const {
      streamCreatureToFileSync,
      streamCreatureFromFileSync,
    } = await import("../../src/architecture/StreamingCreatureIO.ts");
    streamCreatureToFileSync(creature, filePath);
    const loaded = streamCreatureFromFileSync(filePath);

    assertEquals(loaded.input, creature.input);
    assertEquals(loaded.output, creature.output);
    assertEquals(loaded.neurons.length, creature.neurons.length);
    assertEquals(loaded.synapses.length, creature.synapses.length);
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("StreamingCreatureIO - write produces same output as JSON.stringify", async () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 3, squash: "TANH" }],
  });
  const filePath = await Deno.makeTempFile({ suffix: ".json" });

  try {
    await streamCreatureToFile(creature, filePath);
    const streamedContent = await Deno.readTextFile(filePath);

    // Compare with traditional JSON.stringify approach
    const exported = creature.exportJSON();
    const traditionalContent = JSON.stringify(exported, null, 1);

    // Parse both and compare structure (whitespace may differ)
    const streamedParsed = JSON.parse(streamedContent);
    const traditionalParsed = JSON.parse(traditionalContent);

    assertEquals(streamedParsed.input, traditionalParsed.input);
    assertEquals(streamedParsed.output, traditionalParsed.output);
    assertEquals(
      streamedParsed.neurons.length,
      traditionalParsed.neurons.length,
    );
    assertEquals(
      streamedParsed.synapses.length,
      traditionalParsed.synapses.length,
    );
  } finally {
    await Deno.remove(filePath);
  }
});

Deno.test("StreamingCreatureIO - handles creature with memetic data", async () => {
  const creature = new Creature(2, 1);
  creature.memetic = {
    generation: 10,
    weights: {},
    biases: {},
    score: 0.95,
  };
  const filePath = await Deno.makeTempFile({ suffix: ".json" });

  try {
    await streamCreatureToFile(creature, filePath);
    const loaded = await streamCreatureFromFile(filePath);

    assertExists(loaded.memetic);
    assertEquals(loaded.memetic?.generation, 10);
    assertEquals(loaded.memetic?.score, 0.95);
  } finally {
    await Deno.remove(filePath);
  }
});
