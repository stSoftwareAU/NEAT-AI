import { assertEquals } from "@std/assert";
import { join } from "@std/path/join";
import {
  getSuccessfulRemovalDetails,
  type SuccessfulRemovalDetail,
} from "../../src/discovery/SuccessCache.ts";

Deno.test("getSuccessfulRemovalDetails returns empty array for non-existent directory", () => {
  const result = getSuccessfulRemovalDetails("/tmp/does-not-exist-neat-ai");
  assertEquals(result, []);
});

Deno.test("getSuccessfulRemovalDetails returns empty array for empty directory", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-removal-details-empty-",
  });
  try {
    const result = getSuccessfulRemovalDetails(cacheDir);
    assertEquals(result, []);
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("getSuccessfulRemovalDetails returns structured data from removal entries", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-removal-details-populated-",
  });
  try {
    const removeLowImpactDir = join(cacheDir, "remove-low-impact");
    await Deno.mkdir(removeLowImpactDir, { recursive: true });
    await Deno.writeTextFile(
      join(removeLowImpactDir, "entry1.json"),
      JSON.stringify({
        key: "entry1",
        changeType: "remove-low-impact",
        originalScore: 1.0,
        candidateScore: 1.5,
        scoreDelta: 0.5,
        error: 0.5,
        timestamp: "2025-01-15T10:00:00.000Z",
        rustRequest: {
          removalCandidate: { neuronUUID: "neuron-aaa-111" },
        },
      }),
    );

    const removeNeuronDir = join(cacheDir, "remove-neuron");
    await Deno.mkdir(removeNeuronDir, { recursive: true });
    await Deno.writeTextFile(
      join(removeNeuronDir, "entry2.json"),
      JSON.stringify({
        key: "entry2",
        changeType: "remove-neuron",
        originalScore: 2.0,
        candidateScore: 2.3,
        scoreDelta: 0.3,
        error: 0.7,
        timestamp: "2025-01-16T12:00:00.000Z",
        rustRequest: {
          harmfulNeuronCandidate: { neuronUUID: "neuron-bbb-222" },
        },
      }),
    );

    const result = getSuccessfulRemovalDetails(cacheDir);
    assertEquals(result.length, 2);

    // Sort by neuronUUID for deterministic assertion
    result.sort((a, b) => a.neuronUUID.localeCompare(b.neuronUUID));

    const first: SuccessfulRemovalDetail = result[0];
    assertEquals(first.neuronUUID, "neuron-aaa-111");
    assertEquals(first.scoreDelta, 0.5);
    assertEquals(first.candidateScore, 1.5);
    assertEquals(first.originalScore, 1.0);
    assertEquals(first.timestamp, "2025-01-15T10:00:00.000Z");

    const second: SuccessfulRemovalDetail = result[1];
    assertEquals(second.neuronUUID, "neuron-bbb-222");
    assertEquals(second.scoreDelta, 0.3);
    assertEquals(second.candidateScore, 2.3);
    assertEquals(second.originalScore, 2.0);
    assertEquals(second.timestamp, "2025-01-16T12:00:00.000Z");
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("getSuccessfulRemovalDetails ignores non-removal entries", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-removal-details-ignore-",
  });
  try {
    // Create add-synapses entry (should be ignored)
    const addSynapsesDir = join(cacheDir, "add-synapses");
    await Deno.mkdir(addSynapsesDir, { recursive: true });
    await Deno.writeTextFile(
      join(addSynapsesDir, "entry1.json"),
      JSON.stringify({
        key: "entry1",
        changeType: "add-synapses",
        originalScore: 1.0,
        candidateScore: 1.5,
        scoreDelta: 0.5,
        error: 0.5,
        rustRequest: { synapseCandidate: {} },
      }),
    );

    // Create remove-low-impact entry (should be included)
    const removeLowImpactDir = join(cacheDir, "remove-low-impact");
    await Deno.mkdir(removeLowImpactDir, { recursive: true });
    await Deno.writeTextFile(
      join(removeLowImpactDir, "entry1.json"),
      JSON.stringify({
        key: "entry1",
        changeType: "remove-low-impact",
        originalScore: 1.0,
        candidateScore: 1.2,
        scoreDelta: 0.2,
        error: 0.8,
        timestamp: "2025-01-10T08:00:00.000Z",
        rustRequest: {
          removalCandidate: { neuronUUID: "neuron-ccc-333" },
        },
      }),
    );

    const result = getSuccessfulRemovalDetails(cacheDir);
    assertEquals(result.length, 1);
    assertEquals(result[0].neuronUUID, "neuron-ccc-333");
    assertEquals(result[0].scoreDelta, 0.2);
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("getSuccessfulRemovalDetails deduplicates same neuron, keeping best score delta", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-removal-details-dedup-",
  });
  try {
    // Lower scoreDelta entry in remove-low-impact
    const removeLowImpactDir = join(cacheDir, "remove-low-impact");
    await Deno.mkdir(removeLowImpactDir, { recursive: true });
    await Deno.writeTextFile(
      join(removeLowImpactDir, "entry1.json"),
      JSON.stringify({
        key: "entry1",
        changeType: "remove-low-impact",
        originalScore: 1.0,
        candidateScore: 1.1,
        scoreDelta: 0.1,
        error: 0.9,
        timestamp: "2025-01-10T08:00:00.000Z",
        rustRequest: {
          removalCandidate: { neuronUUID: "neuron-same-uuid" },
        },
      }),
    );

    // Higher scoreDelta entry in remove-neuron
    const removeNeuronDir = join(cacheDir, "remove-neuron");
    await Deno.mkdir(removeNeuronDir, { recursive: true });
    await Deno.writeTextFile(
      join(removeNeuronDir, "entry2.json"),
      JSON.stringify({
        key: "entry2",
        changeType: "remove-neuron",
        originalScore: 1.0,
        candidateScore: 1.5,
        scoreDelta: 0.5,
        error: 0.5,
        timestamp: "2025-01-12T10:00:00.000Z",
        rustRequest: {
          harmfulNeuronCandidate: { neuronUUID: "neuron-same-uuid" },
        },
      }),
    );

    const result = getSuccessfulRemovalDetails(cacheDir);
    assertEquals(result.length, 1);
    assertEquals(result[0].neuronUUID, "neuron-same-uuid");
    assertEquals(result[0].scoreDelta, 0.5);
    assertEquals(result[0].candidateScore, 1.5);
    assertEquals(result[0].timestamp, "2025-01-12T10:00:00.000Z");
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("getSuccessfulRemovalDetails skips corrupt entries gracefully", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-removal-details-corrupt-",
  });
  try {
    const removeLowImpactDir = join(cacheDir, "remove-low-impact");
    await Deno.mkdir(removeLowImpactDir, { recursive: true });

    // Corrupt entry
    await Deno.writeTextFile(
      join(removeLowImpactDir, "corrupt.json"),
      "{ this is not valid json",
    );

    // Valid entry
    await Deno.writeTextFile(
      join(removeLowImpactDir, "valid.json"),
      JSON.stringify({
        key: "valid",
        changeType: "remove-low-impact",
        originalScore: 1.0,
        candidateScore: 1.3,
        scoreDelta: 0.3,
        error: 0.7,
        timestamp: "2025-01-20T14:00:00.000Z",
        rustRequest: {
          removalCandidate: { neuronUUID: "neuron-ddd-444" },
        },
      }),
    );

    const result = getSuccessfulRemovalDetails(cacheDir);
    assertEquals(result.length, 1);
    assertEquals(result[0].neuronUUID, "neuron-ddd-444");
    assertEquals(result[0].scoreDelta, 0.3);
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("getSuccessfulRemovalDetails handles missing metadata fields gracefully", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-removal-details-missing-",
  });
  try {
    const removeLowImpactDir = join(cacheDir, "remove-low-impact");
    await Deno.mkdir(removeLowImpactDir, { recursive: true });

    // Entry with no scoreDelta, candidateScore, originalScore, or timestamp
    await Deno.writeTextFile(
      join(removeLowImpactDir, "minimal.json"),
      JSON.stringify({
        key: "minimal",
        changeType: "remove-low-impact",
        error: 0.9,
        rustRequest: {
          removalCandidate: { neuronUUID: "neuron-minimal" },
        },
      }),
    );

    const result = getSuccessfulRemovalDetails(cacheDir);
    assertEquals(result.length, 1);
    assertEquals(result[0].neuronUUID, "neuron-minimal");
    assertEquals(result[0].scoreDelta, 0);
    assertEquals(result[0].candidateScore, 0);
    assertEquals(result[0].originalScore, 0);
    assertEquals(result[0].timestamp, "");
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("getSuccessfulRemovalDetails skips entries without neuron UUID", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-removal-details-no-uuid-",
  });
  try {
    const removeLowImpactDir = join(cacheDir, "remove-low-impact");
    await Deno.mkdir(removeLowImpactDir, { recursive: true });

    // Entry with no neuronUUID in rustRequest
    await Deno.writeTextFile(
      join(removeLowImpactDir, "no-uuid.json"),
      JSON.stringify({
        key: "no-uuid",
        changeType: "remove-low-impact",
        scoreDelta: 0.1,
        error: 0.9,
        rustRequest: {
          removalCandidate: {},
        },
      }),
    );

    // Entry with empty neuronUUID
    await Deno.writeTextFile(
      join(removeLowImpactDir, "empty-uuid.json"),
      JSON.stringify({
        key: "empty-uuid",
        changeType: "remove-low-impact",
        scoreDelta: 0.1,
        error: 0.9,
        rustRequest: {
          removalCandidate: { neuronUUID: "" },
        },
      }),
    );

    // Valid entry
    await Deno.writeTextFile(
      join(removeLowImpactDir, "valid.json"),
      JSON.stringify({
        key: "valid",
        changeType: "remove-low-impact",
        originalScore: 1.0,
        candidateScore: 1.1,
        scoreDelta: 0.1,
        error: 0.9,
        timestamp: "2025-01-20T14:00:00.000Z",
        rustRequest: {
          removalCandidate: { neuronUUID: "neuron-valid" },
        },
      }),
    );

    const result = getSuccessfulRemovalDetails(cacheDir);
    assertEquals(result.length, 1);
    assertEquals(result[0].neuronUUID, "neuron-valid");
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});
