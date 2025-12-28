import { assert } from "@std/assert";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { Creature } from "../../src/Creature.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";

function makeDiscoverStructure(): DiscoverStructure {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [{ fromUUID: "input-0", toUUID: "output-0", weight: 1 }],
  });
  creature.validate({ forwardOnly: true });
  CreatureUtil.makeUUID(creature);

  return new DiscoverStructure(
    creature,
    10,
    undefined,
    {},
    {
      // Avoid clearing shared directories during concurrent tests.
      skipRecordPhase: true,
      baseDirectory: `.discovery/test-split-synapse-logging-${Deno.pid}`,
    },
  );
}

function withCapturedWarns(fn: () => void): string[] {
  const messages: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    messages.push(args.map((a) => String(a)).join(" "));
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return messages;
}

Deno.test(
  "tryRustSplitSynapseInsertNeuronCandidates: logs no-improvement when Rust returns no structural candidates",
  () => {
    const ds = makeDiscoverStructure();

    // Stub combined analysis payload.
    (ds as unknown as { readRustCombinedAnalysis: () => unknown })
      .readRustCombinedAnalysis = () => ({
        neuron: {
          structuralCandidates: [],
          diagnostics: [],
        },
      });

    const warns = withCapturedWarns(() => {
      (ds as unknown as { tryRustSplitSynapseInsertNeuronCandidates: (f: string[]) => unknown })
        .tryRustSplitSynapseInsertNeuronCandidates(["output-0"]);
    });

    assert(
      warns.some((m) => m.includes("Rust neuron analysis evaluated") &&
        m.includes("found no improvements")),
      `Expected a no-improvement warning, got:\n${warns.join("\n")}`,
    );
  },
);

Deno.test(
  "tryRustSplitSynapseInsertNeuronCandidates: logs no-improvement when all structural candidates are rejected",
  () => {
    const ds = makeDiscoverStructure();

    (ds as unknown as { readRustCombinedAnalysis: () => unknown })
      .readRustCombinedAnalysis = () => ({
        neuron: {
          structuralCandidates: [
            { type: "unknown_variant" },
            { type: "split_synapse_insert_neuron", newSynapses: [] },
          ],
          diagnostics: [],
        },
      });

    const warns = withCapturedWarns(() => {
      (ds as unknown as { tryRustSplitSynapseInsertNeuronCandidates: (f: string[]) => unknown })
        .tryRustSplitSynapseInsertNeuronCandidates(["output-0"]);
    });

    assert(
      warns.some((m) => m.includes("Rust neuron analysis evaluated") &&
        m.includes("found no improvements")),
      `Expected a no-improvement warning, got:\n${warns.join("\n")}`,
    );
  },
);


