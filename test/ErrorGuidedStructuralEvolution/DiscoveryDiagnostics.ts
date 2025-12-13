import { assert } from "@std/assert";
import { stub } from "@std/testing/mock";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import {
  DEFAULT_RUST_FLUSH_RECORDS,
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";

Deno.test("logs diagnostics when Rust finds no improvements", () => {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [{
      type: "output",
      uuid: "output-0",
      squash: "IDENTITY",
      bias: 0,
    }],
    synapses: [],
  });
  CreatureUtil.makeUUID(creature);

  const structure = new DiscoverStructure(
    creature,
    60,
    DEFAULT_RUST_FLUSH_RECORDS,
  );
  structure.configureLogging({ discoveryID: "diag-test", verbose: false });

  const focusList = ["output-0"];
  const internals = structure as unknown as Record<string, unknown>;
  internals["lastFocusSelection"] = {
    key: focusList.join("|"),
    mode: "weighted",
    reason: "error x impact weighting",
    neurons: [{ uuid: "output-0", weight: 1.23 }],
    totalWeight: 1.23,
  };

  const warnings: string[] = [];
  const warnStub = stub(console, "warn", (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(" "));
  });
  try {
    const logNoImprovement = internals["logRustNoImprovement"] as (
      this: DiscoverStructure,
      scope: "synapse" | "neuron",
      targets: string[],
      diagnostics?: unknown[],
    ) => void;
    assert(logNoImprovement, "Expected logRustNoImprovement to exist");

    logNoImprovement.call(structure, "synapse", focusList, [{
      targetNeuronUuid: "output-0",
      reason: "no_samples",
      evaluatedCandidates: 4,
      candidatesWithSamples: 0,
      targetRecordCount: 128,
      detail: {
        sourceNeuronUuid: "hidden-1",
        sampleCount: 0,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: 0,
      },
    }]);
  } finally {
    warnStub.restore();
  }

  const lowerWarnings = warnings.map((line) => line.toLowerCase());
  assert(
    lowerWarnings.some((line) => line.includes("no improvements")),
    `Expected at least one warning mentioning "no improvements", received ${
      warnings.join(" | ")
    }`,
  );
  assert(
    lowerWarnings.some((line) => line.includes("no aligned samples")),
    `Expected at least one warning mentioning "no aligned samples", received ${
      warnings.join(" | ")
    }`,
  );
});
