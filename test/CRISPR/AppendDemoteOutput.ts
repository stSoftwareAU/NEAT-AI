// Tests for the append+demote CRISPR pattern documented in Issue #2509.
//
// The pattern: append-mode CRISPR DNA defines a new `output-0` and wires
// the previously-existing `output-0` (which is demoted to hidden at append
// time) into the new output via a relative synapse. The convention uses
// `firstDnaOutputIndex = CRISPR_DEFAULT_FIRST_DNA_OUTPUT_INDEX` (100000) so
// that `fromRelative: FROM_RELATIVE_DEMOTED_OUTPUT` (99999) reaches the
// demoted previous output.

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import {
  CRISPR,
  CRISPR_DEFAULT_FIRST_DNA_OUTPUT_INDEX,
  type CrisprInterface,
  FROM_RELATIVE_DEMOTED_OUTPUT,
} from "@reconstruct/CRISPR.ts";

Deno.test("CRISPR constants - FROM_RELATIVE_DEMOTED_OUTPUT is one less than the default first DNA output index", () => {
  assertEquals(CRISPR_DEFAULT_FIRST_DNA_OUTPUT_INDEX, 100_000);
  assertEquals(FROM_RELATIVE_DEMOTED_OUTPUT, 99_999);
  assertEquals(
    FROM_RELATIVE_DEMOTED_OUTPUT,
    CRISPR_DEFAULT_FIRST_DNA_OUTPUT_INDEX - 1,
  );
});

Deno.test("CRISPR append+demote - fromRelative: FROM_RELATIVE_DEMOTED_OUTPUT wires the demoted previous output into the new output (Issue #2509)", () => {
  // Network: 2 inputs, 1 hidden, 1 output. After append the previous output
  // becomes hidden and a new tanh output is appended on top of it.
  const json: CreatureInternal = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0, index: 2, uuid: "h1" },
      {
        type: "output",
        squash: "IDENTITY",
        bias: 0,
        index: 3,
        uuid: "old-output-0",
      },
    ],
    synapses: [
      { from: 0, to: 2, weight: 0.5 },
      { from: 2, to: 3, weight: 0.6 },
    ],
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  const dna: CrisprInterface = {
    id: "append-demote-tanh",
    mode: "append",
    neurons: [
      {
        type: "output",
        squash: "TANH",
        bias: 0,
        index: CRISPR_DEFAULT_FIRST_DNA_OUTPUT_INDEX,
      },
    ],
    synapses: [
      // Demoted previous output → new output
      {
        fromRelative: FROM_RELATIVE_DEMOTED_OUTPUT,
        toRelative: CRISPR_DEFAULT_FIRST_DNA_OUTPUT_INDEX,
        weight: 1,
      },
    ],
  };

  const modified = new CRISPR(creature).cleaveDNA(dna) as Creature;
  modified.validate();

  // The original output is now hidden; a single new TANH output exists.
  assertEquals(modified.output, 1, "Should still have exactly 1 output");
  const outputs = modified.neurons.filter((n) => n.type === "output");
  assertEquals(outputs.length, 1);
  assertEquals(outputs[0].squash, "TANH");

  // The demoted previous output keeps its position and has been wired into
  // the new TANH output.
  const demoted = modified.neurons.find((n) => n.uuid === "old-output-0");
  assert(demoted, "Demoted previous output must be retained");
  assertEquals(
    demoted!.type,
    "hidden",
    "Previous output must be demoted to hidden",
  );

  const wiring = modified.synapses.find((s) =>
    s.from === demoted!.index && s.to === outputs[0].index
  );
  assert(
    wiring,
    `Expected synapse from demoted previous output (${
      demoted!.index
    }) to new TANH output (${outputs[0].index})`,
  );
  assertEquals(wiring!.weight, 1);
});

Deno.test("CRISPR append+demote - DNA-SANE.json reproduces the multi-output demote pattern with relative anchors", () => {
  // DNA-SANE.json uses `firstDnaOutputIndex = 1000` and references the three
  // demoted previous outputs via `fromRelative: 997, 998, 999`. This test
  // exercises the same arithmetic used by the GRQ DNA files but with the
  // smaller anchor — confirming that `fromRelative = firstDnaOutputIndex - K`
  // resolves to "K-th-last demoted previous output" regardless of which
  // anchor convention the DNA chooses.
  const json: CreatureInternal = {
    input: 3,
    output: 3,
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0, index: 3, uuid: "h1" },
      { type: "output", squash: "IDENTITY", bias: 0, index: 4, uuid: "o1" },
      { type: "output", squash: "IDENTITY", bias: 0, index: 5, uuid: "o2" },
      { type: "output", squash: "LOGISTIC", bias: 0, index: 6, uuid: "o3" },
    ],
    synapses: [
      { from: 0, to: 3, weight: 0.1 },
      { from: 3, to: 4, weight: 0.2 },
      { from: 1, to: 5, weight: 0.3 },
      { from: 2, to: 6, weight: 0.4 },
    ],
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  const dnaTXT = Deno.readTextFileSync("test/data/CRISPR/DNA-SANE.json");
  const modified = new CRISPR(creature).cleaveDNA(
    JSON.parse(dnaTXT),
  ) as Creature;
  modified.validate();

  // Three demoted previous outputs are now hidden; three new outputs exist.
  const demoted = ["o1", "o2", "o3"].map((u) =>
    modified.neurons.find((n) => n.uuid === u)
  );
  for (const d of demoted) {
    assert(d, "Each previous output must survive demotion");
    assertEquals(d!.type, "hidden");
  }
  const outputs = modified.neurons.filter((n) => n.type === "output");
  assertEquals(outputs.length, 3);

  // Each new output must be wired to all three demoted previous outputs —
  // i.e. the `fromRelative: 997/998/999` anchors all resolved correctly.
  for (const out of outputs) {
    for (const d of demoted) {
      const wiring = modified.synapses.find((s) =>
        s.from === d!.index && s.to === out.index
      );
      assert(
        wiring,
        `Expected synapse from demoted output ${d!.uuid} (index ${
          d!.index
        }) to new output (index ${out.index})`,
      );
    }
  }
});
