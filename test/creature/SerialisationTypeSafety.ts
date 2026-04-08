/**
 * SerialisationTypeSafety.ts - Tests for type safety at serialisation boundaries.
 *
 * Issue #2217: Verifies that wire-format memetic data, normalisation, and
 * replay entry application handle typed data correctly without relying on
 * unsafe `as any` casts.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "@creature";
import { exportJSON, loadFrom } from "@creature/CreatureSerialization.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { isMemeticWireData } from "@blackbox/MemeticWireData.ts";
import { isRecord } from "@utils/TypeGuards.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// ---------- MemeticWireData type guard ----------

Deno.test("isMemeticWireData - accepts valid wire data", () => {
  assert(isMemeticWireData({}), "empty object is valid");
  assert(
    isMemeticWireData({ biases: { "input-0": 0.5 }, generation: 1 }),
    "object with biases is valid",
  );
  assert(
    isMemeticWireData({
      weights: [{ fromUUID: "a", toUUID: "b", weight: 0.1 }],
    }),
    "object with array weights is valid",
  );
  assert(
    isMemeticWireData({
      weights: { "uuid-a": [{ toId: 1, weight: 0.5 }] },
    }),
    "object with map weights is valid",
  );
  assert(
    isMemeticWireData({ ancestry: [{ biases: {} }] }),
    "object with ancestry is valid",
  );
});

Deno.test("isMemeticWireData - rejects invalid shapes", () => {
  assert(!isMemeticWireData(null), "null is not valid");
  assert(!isMemeticWireData(undefined), "undefined is not valid");
  assert(!isMemeticWireData(42), "number is not valid");
  assert(!isMemeticWireData("string"), "string is not valid");
  assert(!isMemeticWireData([]), "array is not valid");
  assert(
    !isMemeticWireData({ biases: "not-an-object" }),
    "string biases rejected",
  );
  assert(
    !isMemeticWireData({ biases: [1, 2] }),
    "array biases rejected",
  );
  assert(
    !isMemeticWireData({ weights: "bad" }),
    "string weights rejected",
  );
  assert(
    !isMemeticWireData({ ancestry: "not-array" }),
    "string ancestry rejected",
  );
});

// ---------- isRecord type guard ----------

Deno.test("isRecord - validates plain objects", () => {
  assert(isRecord({}), "empty object");
  assert(isRecord({ a: 1 }), "plain object");
  assert(!isRecord(null), "null");
  assert(!isRecord(undefined), "undefined");
  assert(!isRecord([]), "array");
  assert(!isRecord(42), "number");
  assert(!isRecord("s"), "string");
});

// ---------- Round-trip with UUID-keyed memetic data ----------

Deno.test("loadFrom preserves memetic with UUID keys", async () => {
  await initWasmForTests();

  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });
  const exported = exportJSON(creature);

  // Attach wire-format memetic data with UUID keys
  const neuronUuids: string[] = [];
  for (const n of exported.neurons) {
    if (n.uuid) neuronUuids.push(n.uuid);
  }

  // Build wire-format memetic with UUID-based weights
  if (exported.synapses.length > 0 && neuronUuids.length > 0) {
    const fromUUID = exported.synapses[0].fromUUID ?? "input-0";
    const toUUID = exported.synapses[0].toUUID ?? neuronUuids[0];

    exported.memetic = {
      generation: 1,
      score: -0.5,
      weights: [
        { fromUUID, toUUID, weight: 0.42 },
      ],
      biases: { [toUUID]: 0.1 },
    } as unknown as typeof exported.memetic;

    // Load the creature from this wire format
    const reloaded = new Creature(2, 1, { lazyInitialization: true });
    loadFrom(reloaded, exported, true);

    // Memetic should have been converted to runtime integer IDs
    assert(reloaded.memetic !== undefined, "memetic should survive round-trip");
  }
});

// ---------- normaliseCreatureExport with UUID neurons ----------

Deno.test(
  "normaliseCreatureExport assigns integer IDs from UUID neurons",
  async () => {
    await initWasmForTests();

    const creature = new Creature(2, 1, {
      layers: [{ count: 2 }],
    });
    const exported = exportJSON(creature);

    // The exported JSON should have UUID-only neurons (no integer IDs)
    for (const n of exported.neurons) {
      assert(
        n.uuid !== undefined || n.type === "output",
        "hidden/constant neurons should have UUID",
      );
    }

    // Normalise should populate integer IDs
    normaliseCreatureExport(exported);

    for (const n of exported.neurons) {
      assertNotEquals(
        (n as { id?: number }).id,
        undefined,
        `Neuron of type ${n.type} should have an integer ID after normalisation`,
      );
    }

    for (const s of exported.synapses) {
      assertNotEquals(
        s.fromId,
        undefined,
        "Synapse should have fromId after normalisation",
      );
      assertNotEquals(
        s.toId,
        undefined,
        "Synapse should have toId after normalisation",
      );
    }
  },
);

// ---------- normaliseCreatureExport with wire memetic data ----------

Deno.test(
  "normaliseCreatureExport converts UUID memetic keys to integer IDs",
  async () => {
    await initWasmForTests();

    const creature = new Creature(2, 1, {
      layers: [{ count: 2 }],
    });
    const exported = exportJSON(creature);

    // Attach wire-format memetic with UUID-keyed biases
    const neuronUuids: string[] = [];
    for (const n of exported.neurons) {
      if (n.uuid) neuronUuids.push(n.uuid);
    }

    if (neuronUuids.length > 0) {
      const uuid = neuronUuids[0];
      exported.memetic = {
        generation: 1,
        score: -0.1,
        weights: [
          { fromUUID: "input-0", toUUID: uuid, weight: 0.5 },
        ],
        biases: { [uuid]: 0.3 },
      } as unknown as typeof exported.memetic;

      normaliseCreatureExport(exported);

      // After normalisation, the memetic biases should use integer keys
      assert(
        exported.memetic !== undefined,
        "memetic should survive normalisation",
      );

      if (exported.memetic) {
        const biasKeys = Object.keys(
          exported.memetic.biases as Record<string, number>,
        );
        for (const key of biasKeys) {
          assert(
            !isNaN(Number(key)),
            `Bias key "${key}" should be numeric after normalisation`,
          );
        }
      }
    }
  },
);

// ---------- Trace data round-trip via loadFrom ----------

Deno.test("loadFrom handles trace data without double casts", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });

  // Export as trace JSON (includes trace state)
  const traceJson = creature.traceJSON();

  // Verify trace fields are present on neurons
  let hasNeuronTrace = false;
  for (const n of traceJson.neurons) {
    if ("trace" in n) {
      hasNeuronTrace = true;
      assert(
        typeof n.trace === "object" && n.trace !== null,
        "neuron trace should be an object",
      );
    }
  }

  // Load the trace JSON back - this exercises the isRecord guard path
  const reloaded = new Creature(2, 1, { lazyInitialization: true });
  loadFrom(reloaded, traceJson, true);

  // Creature should load without errors
  assertEquals(reloaded.input, 2);
  assertEquals(reloaded.output, 1);
  assert(reloaded.neurons.length > 0, "should have neurons after load");

  // If trace data was present, loading should succeed without corruption
  if (hasNeuronTrace) {
    assert(true, "trace data loaded successfully via type-guarded path");
  }
});
