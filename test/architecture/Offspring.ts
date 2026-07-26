/**
 * Unit tests for Offspring breeding.
 *
 * Issue #1407: Targeted unit tests for architecture core - offspring creation
 * from parent creatures, including compatible/incompatible breeding, topology
 * sorting, and forward-only enforcement.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "../../mod.ts";
import type { ConnectionRef } from "@architecture/Offspring.ts";
import {
  __setPreFixOffspringExporterForTesting,
  Offspring,
} from "@architecture/Offspring.ts";
import type { SynapseInternal } from "@architecture/SynapseInterfaces.ts";
import { exportJSONUnchecked } from "@creature/CreatureSerialization.ts";
import { __setProducerCompileGateProbeForTesting } from "@wasm/ProducerCompileGuard.ts";
import { getGlobalDebug, setGlobalDebug } from "@globalAccessors";
import { initWasmForTests } from "../_initWasm.ts";

// --- Offspring.breed tests ---

Deno.test("Offspring.breed - produces offspring from compatible parents", () => {
  const mum = new Creature(3, 2, {
    layers: [
      { count: 2, squash: "IDENTITY" },
      { count: 2, squash: "LOGISTIC" },
    ],
  });
  const dad = new Creature(3, 2, {
    layers: [
      { count: 2, squash: "LOGISTIC" },
      { count: 2, squash: "IDENTITY" },
    ],
  });

  // Try many times since breeding involves randomness.
  // With 2 output neurons each having ~50% chance of coming from either parent,
  // each trial has ~50% chance of producing a distinct (non-clone) offspring.
  // 100 tries gives P(all clones) ≈ 0.5^100 ≈ 10^-30, making this practically certain.
  let offspring: Creature | undefined;
  for (let i = 0; i < 100; i++) {
    offspring = Offspring.breed(mum, dad);
    if (offspring) break;
  }

  // At least one attempt should succeed with compatible parents
  assert(
    offspring !== undefined,
    "Should produce offspring from compatible parents",
  );
  assertEquals(offspring.input, 3);
  assertEquals(offspring.output, 2);
});

Deno.test("Offspring.breed - parents must have same input/output counts", () => {
  const mum = new Creature(2, 1);
  const dad = new Creature(3, 1);

  assertThrows(
    () => Offspring.breed(mum, dad),
    Error,
    "same species",
  );
});

Deno.test("Offspring.breed - parents must have matching output count", () => {
  const mum = new Creature(2, 1);
  const dad = new Creature(2, 2);

  assertThrows(
    () => Offspring.breed(mum, dad),
    Error,
    "same species",
  );
});

Deno.test("Offspring.breed - returns undefined when offspring clones parent", () => {
  // Minimal creatures are likely to produce clones
  const mum = new Creature(1, 1);
  const dad = new Creature(1, 1);

  // With minimal structure, offspring often equals a parent
  let cloneCount = 0;
  for (let i = 0; i < 10; i++) {
    const offspring = Offspring.breed(mum, dad);
    if (offspring === undefined) {
      cloneCount++;
    }
  }

  // With minimal creatures, some attempts should return undefined (clones)
  assert(
    cloneCount > 0,
    "Minimal creatures should sometimes produce clones (returning undefined)",
  );
});

Deno.test("Offspring.breed - offspring has valid synapses with finite weights", () => {
  const mum = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });
  const dad = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });

  let offspring: Creature | undefined;
  for (let i = 0; i < 5; i++) {
    offspring = Offspring.breed(mum, dad);
    if (offspring) break;
  }

  if (offspring) {
    assert(offspring.synapses.length > 0, "Offspring should have synapses");
    // All synapse indices should be in bounds with finite weights
    for (const s of offspring.synapses) {
      assert(
        s.from >= 0 && s.from < offspring.neurons.length,
        `from index ${s.from} should be in bounds [0, ${offspring.neurons.length})`,
      );
      assert(
        s.to >= 0 && s.to < offspring.neurons.length,
        `to index ${s.to} should be in bounds [0, ${offspring.neurons.length})`,
      );
      assert(s.from <= s.to, "Forward-only: from <= to");
      assert(
        Number.isFinite(s.weight),
        `Synapse weight should be finite, got ${s.weight}`,
      );
    }
  }
});

Deno.test("Offspring.breed - offspring gets a valid UUID", () => {
  const mum = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });
  const dad = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });

  let offspring: Creature | undefined;
  for (let i = 0; i < 5; i++) {
    offspring = Offspring.breed(mum, dad);
    if (offspring) break;
  }

  if (offspring) {
    assert(offspring.uuid !== undefined, "Offspring should have a UUID");
    assert(offspring.uuid.length > 0, "UUID should be non-empty");
    // UUID should contain only valid characters (hex, hyphens)
    assert(
      /^[a-f0-9-]+$/i.test(offspring.uuid),
      `UUID should contain valid characters: ${offspring.uuid}`,
    );
  }
});

Deno.test("Offspring.breed - with forwardOnly option", () => {
  const mum = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });
  const dad = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });

  let offspring: Creature | undefined;
  for (let i = 0; i < 5; i++) {
    offspring = Offspring.breed(mum, dad, { forwardOnly: true });
    if (offspring) break;
  }

  if (offspring) {
    // Forward-only offspring should not have backward connections
    for (const s of offspring.synapses) {
      assert(s.from <= s.to, "Forward-only: from must be <= to");
    }
  }
});

// --- Issue #3473: deferred pre-fix genome export ---

Deno.test(
  "Offspring.breed - skips the pre-fix genome export on the happy path when diagnostics are off (Issue #3473)",
  async () => {
    await initWasmForTests();
    const prevDebug = getGlobalDebug();
    setGlobalDebug(false);

    let exportCalls = 0;
    const restoreExporter = __setPreFixOffspringExporterForTesting((c) => {
      exportCalls++;
      return exportJSONUnchecked(c);
    });

    try {
      const mum = new Creature(3, 2, {
        layers: [
          { count: 2, squash: "IDENTITY" },
          { count: 2, squash: "LOGISTIC" },
        ],
      });
      const dad = new Creature(3, 2, {
        layers: [
          { count: 2, squash: "LOGISTIC" },
          { count: 2, squash: "IDENTITY" },
        ],
      });

      // Breeding is random; a non-clone offspring is practically certain within
      // 100 tries (see the "compatible parents" test above for the maths).
      let offspring: Creature | undefined;
      for (let i = 0; i < 100; i++) {
        offspring = Offspring.breed(mum, dad);
        if (offspring) break;
      }

      assert(
        offspring,
        "expected a non-clone offspring from compatible parents",
      );
      // The core regression guard: with diagnostics off the full-genome export
      // that only the rare compile-failure dump consumes must never run.
      assertEquals(
        exportCalls,
        0,
        "pre-fix genome export must not run on the happy breeding path when diagnostics are off",
      );
    } finally {
      restoreExporter();
      setGlobalDebug(prevDebug);
    }
  },
);

Deno.test(
  "Offspring.breed - captures the pre-fix genome once when diagnostics are on (Issue #3473)",
  async () => {
    await initWasmForTests();
    const prevDebug = getGlobalDebug();
    setGlobalDebug(true);

    let exportCalls = 0;
    let capturedNeurons = -1;
    let capturedSynapses = -1;
    const restoreExporter = __setPreFixOffspringExporterForTesting((c) => {
      exportCalls++;
      // Snapshot the genome size at capture time so we can prove a real
      // pre-fix genome was serialised, not a placeholder.
      capturedNeurons = c.neurons.length;
      capturedSynapses = c.synapses.length;
      return exportJSONUnchecked(c);
    });
    // Force the WASM compile gate to reject so the deferred dump path fires.
    const restoreProbe = __setProducerCompileGateProbeForTesting(() => ({
      ok: false as const,
      trapMessage: "test-forced trap (issue #3473)",
    }));

    try {
      const mum = new Creature(3, 2, {
        layers: [
          { count: 2, squash: "IDENTITY" },
          { count: 2, squash: "LOGISTIC" },
        ],
      });
      const dad = new Creature(3, 2, {
        layers: [
          { count: 2, squash: "LOGISTIC" },
          { count: 2, squash: "IDENTITY" },
        ],
      });

      const result = Offspring.breed(mum, dad);
      assertEquals(
        result,
        undefined,
        "the forced compile-gate rejection must drop the offspring",
      );
      assertEquals(
        exportCalls,
        1,
        "the pre-fix genome must be captured exactly once when diagnostics are on",
      );
      assert(
        capturedNeurons > 0 && capturedSynapses > 0,
        "the captured pre-fix snapshot must reflect a real genome",
      );
    } finally {
      restoreProbe();
      restoreExporter();
      setGlobalDebug(prevDebug);
    }
  },
);

// --- Offspring.cloneConnections tests ---

Deno.test("Offspring.cloneConnections - converts internal to export format", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 1, squash: "IDENTITY" }],
  });

  const internalConns: SynapseInternal[] = creature.synapses.map((s) => ({
    from: s.from,
    to: s.to,
    weight: s.weight,
    type: s.type,
    tags: s.tags,
  }));

  const exported = Offspring.cloneConnections(creature, internalConns);

  assertEquals(exported.length, internalConns.length);
  for (let i = 0; i < exported.length; i++) {
    assertEquals(
      exported[i].fromId,
      creature.neurons[internalConns[i].from].id,
    );
    assertEquals(
      exported[i].toId,
      creature.neurons[internalConns[i].to].id,
    );
    assertEquals(exported[i].weight, internalConns[i].weight);
  }
});

Deno.test("Offspring.cloneConnections - empty connections list", () => {
  const creature = new Creature(2, 1);
  const exported = Offspring.cloneConnections(creature, []);

  assertEquals(exported.length, 0);
});

// --- Offspring.sortNeurons tests ---

Deno.test("Offspring.sortNeurons - keeps input before hidden before output", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 1, squash: "IDENTITY" }],
  });

  // Create a child array replicating the mother's structure
  const child = [...creature.neurons];
  const connectionsMap = new Map<number, ConnectionRef>();

  for (const neuron of creature.neurons) {
    if (neuron.type !== "input") {
      const conns = creature.inwardConnections(neuron.index);
      connectionsMap.set(
        neuron.id,
        { parent: creature, synapses: conns },
      );
    }
  }

  Offspring.sortNeurons(
    child,
    creature.neurons,
    creature.neurons,
    connectionsMap,
  );

  // Verify ordering: inputs first, then hidden, then output
  let foundHidden = false;
  let foundOutput = false;
  for (const neuron of child) {
    if (neuron.type === "hidden" || neuron.type === "constant") {
      assert(!foundOutput, "Hidden neurons must come before output neurons");
      foundHidden = true;
    }
    if (neuron.type === "output") {
      foundOutput = true;
    }
    if (neuron.type === "input") {
      assert(!foundHidden && !foundOutput, "Input neurons must come first");
    }
  }
});
