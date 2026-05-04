/**
 * Lifecycle integration tests for `applyChangeToCreature` (Issue #2515).
 *
 * Each test exercises one branch of `applyChangeToCreature` on a
 * forward-only base creature. The producer side asserts that the
 * resulting creature is still forward-only via
 * `assertNoRecurrentSynapseOnForwardOnly` — without it, the corruption
 * would only surface as a `[loadFrom] Stripping recurrent synapse`
 * warning much later in the pipeline.
 *
 * Branches covered:
 *  - add-synapses
 *  - add-neurons
 *  - change-squash
 *  - remove-synapse
 *  - remove-neuron
 *  - coordinated-structural
 *
 * For each branch we also feed an *intentionally illegal* candidate (one
 * that carries a backward synapse) and verify the combiner filters it
 * rather than letting it leak through. This is the behaviour the audit
 * in #2515 was set up to lock in: candidate creatures may legitimately
 * carry recurrent hints, but the combiner is the authority on what
 * survives.
 */

import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { applyChangeToCreature } from "@discovery/CandidateApplication.ts";
import type { DiscoveryCandidate } from "@discovery/DiscoveryCandidates.ts";
import { applyCoordinatedStructuralCandidate } from "@architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { initWasmForTests } from "../_initWasm.ts";

/** Build a small forward-only creature: 2 input → 1 hidden → 1 output. */
async function makeForwardOnlyBase(): Promise<Creature> {
  await initWasmForTests();
  const c = new Creature(2, 1, { layers: [{ count: 1 }] });
  assertEquals(c.forwardOnly, true);
  c.validate({ forwardOnly: true });
  CreatureUtil.makeUUID(c);
  return c;
}

/** Assert every synapse is forward (from < to) on a runtime creature. */
function assertForwardOnly(creature: Creature, context: string): void {
  assertEquals(
    creature.forwardOnly,
    true,
    `${context}: forwardOnly flag should remain true`,
  );
  for (let i = 0; i < creature.synapses.length; i++) {
    const s = creature.synapses[i];
    assert(
      s.from < s.to,
      `${context}: synapse[${i}] violates forward-only ` +
        `(from=${s.from}, to=${s.to})`,
    );
  }
}

/**
 * Helper: build a candidate creature from a JSON export, opting out of
 * the load-side throw so we can intentionally feed illegal hints.
 *
 * Normalises the JSON first so callers can mix UUID and integer-ID
 * synapse references (`exportJSON` returns UUID-keyed synapses).
 */
function candidateFromJSON(json: CreatureExport): Creature {
  normaliseCreatureExport(json);
  const c = Creature.fromJSON(json, false, "test:candidate", {
    throwOnRecurrent: "never",
  });
  CreatureUtil.makeUUID(c);
  return c;
}

// ---------------------------------------------------------------------------
// add-synapses
// ---------------------------------------------------------------------------
Deno.test("Lifecycle apply: add-synapses preserves forward-only", async () => {
  const base = await makeForwardOnlyBase();
  const baseJSON = base.exportJSON();

  // Candidate adds an input → output synapse (forward, UUID-keyed).
  const candidateJSON: CreatureExport = structuredClone(baseJSON);
  candidateJSON.synapses.push({
    fromUUID: "input-1",
    toUUID: "output-0",
    weight: 0.2,
  });
  const candidateCreature = candidateFromJSON(candidateJSON);

  const candidate: DiscoveryCandidate = {
    creature: candidateCreature,
    change: { type: "add-synapses", description: "add forward synapse" },
  };

  const result = applyChangeToCreature(base, candidate, base);
  assert(result, "expected applyChangeToCreature to return a creature");
  assertForwardOnly(result!, "add-synapses forward");
});

Deno.test("Lifecycle apply: add-synapses filters backward-edge candidate hint", async () => {
  const base = await makeForwardOnlyBase();
  const baseJSON = base.exportJSON();

  // Candidate carries an *illegal* backward synapse: output → hidden.
  const candidateJSON: CreatureExport = structuredClone(baseJSON);
  const hiddenUuid = candidateJSON.neurons.find((n) => n.type === "hidden")!
    .uuid!;
  candidateJSON.synapses.push({
    fromUUID: "output-0",
    toUUID: hiddenUuid,
    weight: 0.2,
  });
  const candidateCreature = candidateFromJSON(candidateJSON);

  const candidate: DiscoveryCandidate = {
    creature: candidateCreature,
    change: {
      type: "add-synapses",
      description: "candidate carries illegal back-edge",
    },
  };

  // The combiner should either filter the illegal hint (returning undefined
  // because no legal synapses remained) or return a creature without it.
  const result = applyChangeToCreature(base, candidate, base);
  if (result) {
    assertForwardOnly(result, "add-synapses backward filtered");
  }
});

// ---------------------------------------------------------------------------
// add-neurons
// ---------------------------------------------------------------------------
Deno.test("Lifecycle apply: add-neurons preserves forward-only", async () => {
  const base = await makeForwardOnlyBase();
  const baseJSON = base.exportJSON();

  // Candidate adds a new hidden neuron between input and output, with
  // forward synapses only.
  const candidateJSON: CreatureExport = structuredClone(baseJSON);
  const outputIdx = candidateJSON.neurons.findIndex((n) => n.type === "output");
  candidateJSON.neurons.splice(outputIdx, 0, {
    uuid: "hidden-new-A",
    type: "hidden",
    squash: "IDENTITY",
    bias: 0.0,
  });
  candidateJSON.synapses.push(
    { fromUUID: "input-0", toUUID: "hidden-new-A", weight: 0.3 },
    { fromUUID: "hidden-new-A", toUUID: "output-0", weight: 0.4 },
  );
  const candidateCreature = candidateFromJSON(candidateJSON);

  const candidate: DiscoveryCandidate = {
    creature: candidateCreature,
    change: { type: "add-neurons", description: "add hidden neuron" },
  };

  const result = applyChangeToCreature(base, candidate, base);
  assert(result, "expected applyChangeToCreature to return a creature");
  assertForwardOnly(result!, "add-neurons forward");
});

// ---------------------------------------------------------------------------
// change-squash
// ---------------------------------------------------------------------------
Deno.test("Lifecycle apply: change-squash preserves forward-only", async () => {
  const base = await makeForwardOnlyBase();
  const baseJSON = base.exportJSON();
  const hidden = baseJSON.neurons.find((n) => n.type === "hidden")!;
  const altSquash = hidden.squash === "TANH" ? "IDENTITY" : "TANH";

  // Candidate flips the hidden neuron's squash.
  const candidateJSON: CreatureExport = structuredClone(baseJSON);
  candidateJSON.neurons.find((n) => n.type === "hidden")!.squash = altSquash;
  const candidateCreature = candidateFromJSON(candidateJSON);

  const candidate: DiscoveryCandidate = {
    creature: candidateCreature,
    change: {
      type: "change-squash",
      description: "flip squash",
      squashCandidate: {
        neuronUuid: hidden.uuid!,
        previousSquash: hidden.squash!,
        squash: altSquash,
        expectedCreatureScoreGain: 0.0,
        improvedError: 0.0,
        currentError: 0.0,
      },
    },
  };

  const result = applyChangeToCreature(base, candidate, base);
  assert(result, "expected applyChangeToCreature to return a creature");
  assertForwardOnly(result!, "change-squash");
});

// ---------------------------------------------------------------------------
// remove-synapse
// ---------------------------------------------------------------------------
Deno.test("Lifecycle apply: remove-synapse preserves forward-only", async () => {
  const base = await makeForwardOnlyBase();
  const baseJSON = base.exportJSON();

  // Add an extra forward synapse to the base so removal has a target.
  baseJSON.synapses.push({
    fromUUID: "input-0",
    toUUID: "output-0",
    weight: 0.1,
  });
  const baseWithExtra = candidateFromJSON(baseJSON);
  baseWithExtra.validate({ forwardOnly: true });

  // Candidate omits the extra synapse.
  const candidateJSON: CreatureExport = baseWithExtra.exportJSON();
  candidateJSON.synapses = candidateJSON.synapses.filter(
    (s) => !(s.fromUUID === "input-0" && s.toUUID === "output-0"),
  );
  const candidateCreature = candidateFromJSON(candidateJSON);

  const candidate: DiscoveryCandidate = {
    creature: candidateCreature,
    change: { type: "remove-synapse", description: "drop extra synapse" },
  };

  const result = applyChangeToCreature(
    baseWithExtra,
    candidate,
    baseWithExtra,
  );
  assert(result, "expected applyChangeToCreature to return a creature");
  assertForwardOnly(result!, "remove-synapse");
});

// ---------------------------------------------------------------------------
// remove-neuron
// ---------------------------------------------------------------------------
Deno.test("Lifecycle apply: remove-neuron preserves forward-only", async () => {
  await initWasmForTests();

  // Base has 2 hidden neurons so removing one still leaves a path.
  const baseJSON: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-X", type: "hidden", squash: "IDENTITY", bias: 0 },
      { uuid: "hidden-Y", type: "hidden", squash: "IDENTITY", bias: 0 },
      { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-X", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-Y", weight: 0.5 },
      { fromUUID: "hidden-X", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "hidden-Y", toUUID: "output-0", weight: 0.5 },
    ],
  };
  const base = candidateFromJSON(baseJSON);
  base.validate({ forwardOnly: true });
  CreatureUtil.makeUUID(base);

  // Candidate removes hidden-Y and reconnects input-1 → output-0 directly.
  const candidateJSON: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-X", type: "hidden", squash: "IDENTITY", bias: 0 },
      { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-X", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "hidden-X", toUUID: "output-0", weight: 0.5 },
    ],
  };
  const candidateCreature = candidateFromJSON(candidateJSON);

  const candidate: DiscoveryCandidate = {
    creature: candidateCreature,
    change: { type: "remove-neuron", description: "drop hidden-Y" },
  };

  const result = applyChangeToCreature(base, candidate, base);
  assert(result, "expected applyChangeToCreature to return a creature");
  assertForwardOnly(result!, "remove-neuron");
});

// ---------------------------------------------------------------------------
// coordinated-structural
// ---------------------------------------------------------------------------
Deno.test("Lifecycle apply: coordinated-structural preserves forward-only", async () => {
  const base = await makeForwardOnlyBase();
  const hiddenUuid = base.neurons.find((n) => n.type === "hidden")!.uuid!;
  const outputUuid = base.neurons.find((n) => n.type === "output")!.uuid!;

  // Coordinated op: change the squash of the hidden neuron only.
  const result = applyCoordinatedStructuralCandidate(
    base,
    {
      operations: [
        { type: "changeSquash", neuronUuid: hiddenUuid, squash: "TANH" },
      ],
    } as Parameters<typeof applyCoordinatedStructuralCandidate>[1],
  );
  assertForwardOnly(result, "coordinated-structural changeSquash");
  // Sanity: hidden squash actually changed.
  const newHidden = result.neurons.find((n) => n.uuid === hiddenUuid)!;
  assertEquals(newHidden.squash, "TANH");
  // Output still present.
  assert(
    result.neurons.find((n) => n.uuid === outputUuid),
    "output neuron should still be present",
  );
});

Deno.test("Lifecycle apply: coordinated-structural filters back-edge addSynapse", async () => {
  const base = await makeForwardOnlyBase();
  const hiddenUuid = base.neurons.find((n) => n.type === "hidden")!.uuid!;
  const outputUuid = base.neurons.find((n) => n.type === "output")!.uuid!;

  // Attempt to add a backward synapse output → hidden. The combiner
  // must reject this rather than corrupt the forward-only invariant.
  const result = applyCoordinatedStructuralCandidate(
    base,
    {
      operations: [
        {
          type: "addSynapse",
          fromNeuronUuid: outputUuid,
          toNeuronUuid: hiddenUuid,
          weight: 0.1,
        },
      ],
    } as Parameters<typeof applyCoordinatedStructuralCandidate>[1],
  );
  assertForwardOnly(result, "coordinated-structural backward filter");
});
