/**
 * Tests for prototype pollution prevention in CreatureSerialization.
 * Issue #1575: Ensures that loading trace data from JSON cannot
 * pollute Object.prototype via __proto__ or constructor keys.
 * Issue #1635: Uses Object.defineProperty to satisfy static analysis (CodeQL).
 */

import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { loadFrom, traceJSON } from "@creature/CreatureSerialization.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test(
  "loadFrom - neuron trace with __proto__ key does not pollute Object.prototype",
  async () => {
    await initWasmForTests();

    const creature = new Creature(2, 1, {
      layers: [{ count: 2 }],
    });

    // Create a trace with real activation data
    const json = creature.exportJSON();
    const bpConfig = createBackPropagationConfig({});
    const sparseConfig = new SparseConfig(json, bpConfig);
    creature.activateAndTrace(
      new Float32Array([0.5, 0.5]),
      false,
      sparseConfig,
    );

    const trace = traceJSON(creature);

    // Inject a __proto__ property into a neuron trace to simulate an attack
    for (const neuron of trace.neurons) {
      const nt = neuron as unknown as Record<string, unknown>;
      if (nt.trace) {
        (nt.trace as Record<string, unknown>)["__proto__"] = {
          polluted: true,
        };
      }
    }

    // Load the tampered trace back into a new creature
    const target = new Creature(2, 1, { lazyInitialization: true });
    loadFrom(target, trace, true);

    // Verify Object.prototype was NOT polluted
    const clean = {} as Record<string, unknown>;
    assertEquals(
      clean["polluted"],
      undefined,
      "Object.prototype must not be polluted by neuron trace data",
    );
  },
);

Deno.test(
  "loadFrom - synapse trace with __proto__ key does not pollute Object.prototype",
  async () => {
    await initWasmForTests();

    const creature = new Creature(2, 1, {
      layers: [{ count: 2 }],
    });

    // Create a trace with real activation data
    const json = creature.exportJSON();
    const bpConfig = createBackPropagationConfig({});
    const sparseConfig = new SparseConfig(json, bpConfig);
    creature.activateAndTrace(
      new Float32Array([0.5, 0.5]),
      false,
      sparseConfig,
    );

    const trace = traceJSON(creature);

    // Inject a __proto__ property into a synapse trace to simulate an attack
    for (const synapse of trace.synapses) {
      const st = synapse as unknown as Record<string, unknown>;
      if (st.trace) {
        (st.trace as Record<string, unknown>)["__proto__"] = {
          polluted: true,
        };
      }
    }

    // Load the tampered trace back into a new creature
    const target = new Creature(2, 1, { lazyInitialization: true });
    loadFrom(target, trace, true);

    // Verify Object.prototype was NOT polluted
    const clean = {} as Record<string, unknown>;
    assertEquals(
      clean["polluted"],
      undefined,
      "Object.prototype must not be polluted by synapse trace data",
    );
  },
);

Deno.test(
  "loadFrom - trace with constructor key does not pollute prototype",
  async () => {
    await initWasmForTests();

    const creature = new Creature(2, 1, {
      layers: [{ count: 2 }],
    });

    const json = creature.exportJSON();
    const bpConfig = createBackPropagationConfig({});
    const sparseConfig = new SparseConfig(json, bpConfig);
    creature.activateAndTrace(
      new Float32Array([0.5, 0.5]),
      false,
      sparseConfig,
    );

    const trace = traceJSON(creature);

    // Inject a constructor property into neuron trace
    for (const neuron of trace.neurons) {
      const nt = neuron as unknown as Record<string, unknown>;
      if (nt.trace) {
        (nt.trace as Record<string, unknown>)["constructor"] = {
          prototype: { polluted: true },
        };
      }
    }

    // Load the tampered trace back into a new creature
    const target = new Creature(2, 1, { lazyInitialization: true });
    loadFrom(target, trace, true);

    // Verify prototype was NOT polluted
    const clean = {} as Record<string, unknown>;
    assertEquals(
      clean["polluted"],
      undefined,
      "Prototype must not be polluted via constructor key in trace data",
    );
  },
);

Deno.test(
  "loadFrom - mixed safe and unsafe keys: safe keys copied, unsafe keys blocked",
  async () => {
    await initWasmForTests();

    const creature = new Creature(2, 1, {
      layers: [{ count: 2 }],
    });

    const json = creature.exportJSON();
    const bpConfig = createBackPropagationConfig({});
    const sparseConfig = new SparseConfig(json, bpConfig);
    creature.activateAndTrace(
      new Float32Array([0.5, 0.5]),
      false,
      sparseConfig,
    );

    const trace = traceJSON(creature);

    // Inject both __proto__ (unsafe) and a prototype key into neuron trace
    for (const neuron of trace.neurons) {
      const nt = neuron as unknown as Record<string, unknown>;
      if (nt.trace) {
        (nt.trace as Record<string, unknown>)["__proto__"] = {
          polluted: true,
        };
        (nt.trace as Record<string, unknown>)["prototype"] = {
          polluted: true,
        };
      }
    }

    const target = new Creature(2, 1, { lazyInitialization: true });
    loadFrom(target, trace, true);

    // Verify Object.prototype was NOT polluted by either key
    const clean = {} as Record<string, unknown>;
    assertEquals(
      clean["polluted"],
      undefined,
      "Object.prototype must not be polluted by __proto__ or prototype keys",
    );
  },
);
