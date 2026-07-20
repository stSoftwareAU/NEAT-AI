import {
  assertAlmostEquals,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import { Creature } from "@creature";
import { buildWireToRuntimeIdMap } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryWireIdentity.ts";
import {
  analyzeSelectedNeuronsForHarmfulRemoval,
  calculateSquashError,
  calculateSquashErrorFromRaw,
  findCandidateSquash,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverSquashAnalysis.ts";
import type { CandidateHarmfulNeuron } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import { Activations } from "@methods/activations/Activations.ts";
import type { ActivationInterface } from "@methods/activations/ActivationInterface.ts";
import { TopologyError } from "@errors/TopologyError.ts";

/**
 * Reproduces the retired Issue #2483 placeholder remove-neuron gain
 * (`0.1 + (log10(err) − 10)/10 × 0.4`, clamped to `[0.1, 0.5]`). A gain that
 * still matches this for any error magnitude means the synthetic sink has been
 * reintroduced (Issue #1520 regression guard).
 */
function placeholderGain(errorMagnitude: number): number {
  const excessMagnitude = Math.log10(errorMagnitude) - Math.log10(1e10);
  return Math.min(0.5, Math.max(0.1, 0.1 + (excessMagnitude / 10) * 0.4));
}

/** Over-threshold hidden neuron (IDENTITY squash) that trips the removal sink. */
function overThresholdCreature(): Creature {
  return Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-target", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-target", weight: 0.5 },
      { fromUUID: "hidden-target", toUUID: "output-0", weight: 0.5 },
    ],
  });
}

Deno.test("calculateSquashError - returns zero for identical arrays", () => {
  const ideal = [1.0, 2.0, 3.0];
  const actual = [1.0, 2.0, 3.0];
  const error = calculateSquashError(ideal, actual);
  assertEquals(error, 0);
});

Deno.test("calculateSquashError - returns correct MSE for differing arrays", () => {
  const ideal = [1.0, 2.0, 3.0];
  const actual = [1.1, 2.2, 2.8];
  const error = calculateSquashError(ideal, actual);
  // Each element MSE: (0.1^2)/1=0.01, (0.2^2)/1=0.04, (0.2^2)/1=0.04
  // Average: (0.01 + 0.04 + 0.04) / 3 = 0.03
  assertAlmostEquals(error, 0.03, 1e-4);
});

Deno.test("calculateSquashError - handles single element", () => {
  const ideal = [5.0];
  const actual = [3.0];
  const error = calculateSquashError(ideal, actual);
  // MSE of single element: (5-3)^2 / 1 = 4.0
  assertAlmostEquals(error, 4.0, 1e-4);
});

Deno.test("calculateSquashError - throws on undefined activation", () => {
  const ideal = [1.0, 2.0];
  const actual = [1.0]; // shorter array, second element is undefined
  assertThrows(
    () => calculateSquashError(ideal, actual),
    TopologyError,
    "Activation is undefined",
  );
});

Deno.test("calculateSquashError - consistent results across multiple calls", () => {
  const ideal = [0.5, -0.3, 1.2, 0.0];
  const actual = [0.4, -0.1, 1.0, 0.1];
  const error1 = calculateSquashError(ideal, actual);
  const error2 = calculateSquashError(ideal, actual);
  assertEquals(error1, error2);
});

Deno.test("calculateSquashError - handles large arrays", () => {
  const size = 10000;
  const ideal = Array.from({ length: size }, (_, i) => Math.sin(i));
  const actual = Array.from({ length: size }, (_, i) => Math.sin(i) + 0.01);
  const error = calculateSquashError(ideal, actual);
  // Each element: (0.01)^2 = 0.0001, average should be ~0.0001
  assertAlmostEquals(error, 0.0001, 1e-4);
});

Deno.test("calculateSquashErrorFromRaw - matches the mapped calculateSquashError", () => {
  const squash = Activations.find("LOGISTIC") as ActivationInterface;
  const rawValues = [-2.0, -0.5, 0.0, 0.5, 2.0, 5.0, -3.3];
  const idealActivations = rawValues.map((v) => squash.squash(v) + 0.01 * v);

  const fused = calculateSquashErrorFromRaw(
    squash,
    rawValues,
    idealActivations,
  );
  // The legacy path materialised a temp array of squashed values first.
  const tempActivations = rawValues.map((v) => squash.squash(v));
  const reference = calculateSquashError(idealActivations, tempActivations);

  // Math.fround parity means the two agree to the bit.
  assertEquals(fused, reference);
});

Deno.test("calculateSquashErrorFromRaw - zero when squash hits the ideals exactly", () => {
  const squash = Activations.find("IDENTITY") as ActivationInterface;
  const rawValues = [0.1, -0.2, 3.0];
  const idealActivations = rawValues.map((v) => squash.squash(v));
  const error = calculateSquashErrorFromRaw(
    squash,
    rawValues,
    idealActivations,
  );
  assertEquals(error, 0);
});

Deno.test("calculateSquashErrorFromRaw - picks the same best candidate as the legacy loop", () => {
  const truth = Activations.find("TANH") as ActivationInterface;
  const rawValues = Array.from({ length: 200 }, (_, i) => Math.sin(i) * 3);
  const idealActivations = rawValues.map((v) => truth.squash(v));

  const candidates = Activations.list().filter(
    (a) => (a as ActivationInterface).squash !== undefined,
  ) as ActivationInterface[];

  const pick = (
    score: (fn: ActivationInterface) => number,
  ): string => {
    let best = candidates[0];
    let bestError = score(best);
    for (const fn of candidates) {
      const e = score(fn);
      if (e < bestError) {
        bestError = e;
        best = fn;
      }
    }
    return best.getName();
  };

  const fusedBest = pick((fn) =>
    calculateSquashErrorFromRaw(fn, rawValues, idealActivations)
  );
  const legacyBest = pick((fn) =>
    calculateSquashError(idealActivations, rawValues.map((v) => fn.squash(v)))
  );

  assertEquals(fusedBest, legacyBest);
});

Deno.test(
  "analyzeSelectedNeuronsForHarmfulRemoval loads records via wire uuid path",
  async () => {
    const creature = Creature.fromJSON({
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "hidden-target", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-target", weight: 0.5 },
        { fromUUID: "hidden-target", toUUID: "output-0", weight: 0.5 },
      ],
    });
    const hiddenId = buildWireToRuntimeIdMap(creature).get("hidden-target");
    assertEquals(typeof hiddenId, "number");

    let loadedPath: string | undefined;
    const result = await analyzeSelectedNeuronsForHarmfulRemoval(
      creature,
      [hiddenId!],
      (neuronIdentifier: string) => {
        loadedPath = neuronIdentifier;
        return Promise.resolve([{
          value: 1,
          activation: 1,
          errors: [1e11],
        }]);
      },
      "/tmp/discovery",
      false,
      () => {},
    );

    assertEquals(loadedPath, "/tmp/discovery/hidden-target");
    assertEquals(result?.[0]?.neuronUuid, "hidden-target");
  },
);

Deno.test(
  "DiscoverSquashAnalysis - remove-neuron gain is not synthesised locally (findCandidateSquash)",
  () => {
    // Issue #1520: over-threshold neurons still route to the harmful sink,
    // but the gain must come from the injected Discovery estimate, never the
    // retired placeholder formula.
    const creature = overThresholdCreature();
    const hiddenId = buildWireToRuntimeIdMap(creature).get("hidden-target")!;

    const records = [{ value: 1, activation: 1, errors: [1e11] }];
    const harmfulSink: CandidateHarmfulNeuron[] = [];

    // Honest propagation-aware estimate from the 247b83ab failure example.
    const discoveryEstimate = -0.000194;
    let requestedUuid: string | undefined;

    const candidate = findCandidateSquash(
      creature,
      hiddenId,
      records,
      () => 1,
      false,
      () => {},
      harmfulSink,
      (neuronUuid: string) => {
        requestedUuid = neuronUuid;
        return discoveryEstimate;
      },
    );

    // No squash change is returned for an over-threshold neuron.
    assertEquals(candidate, undefined);
    // The neuron is still promoted for removal (#2483 WASM hygiene preserved).
    assertEquals(harmfulSink.length, 1);
    assertEquals(harmfulSink[0].neuronUuid, "hidden-target");
    assertEquals(requestedUuid, "hidden-target");

    // The surfaced gain is the injected Discovery estimate...
    assertEquals(harmfulSink[0].expectedCreatureScoreGain, discoveryEstimate);
    // ...and does NOT match the retired placeholder formula.
    const synthetic = placeholderGain(harmfulSink[0].errorMagnitude);
    assertNotEquals(harmfulSink[0].expectedCreatureScoreGain, synthetic);
  },
);

Deno.test(
  "DiscoverSquashAnalysis - remove-neuron gain defaults to non-fabricated zero (findCandidateSquash)",
  () => {
    // Without an injected estimate the Deno side emits a neutral 0, never the
    // synthetic placeholder (Issue #1520). Removal identification is retained.
    const creature = overThresholdCreature();
    const hiddenId = buildWireToRuntimeIdMap(creature).get("hidden-target")!;

    const records = [{ value: 1, activation: 1, errors: [1e11] }];
    const harmfulSink: CandidateHarmfulNeuron[] = [];

    findCandidateSquash(
      creature,
      hiddenId,
      records,
      () => 1,
      false,
      () => {},
      harmfulSink,
    );

    assertEquals(harmfulSink.length, 1);
    assertEquals(harmfulSink[0].expectedCreatureScoreGain, 0);
    const synthetic = placeholderGain(harmfulSink[0].errorMagnitude);
    assertNotEquals(harmfulSink[0].expectedCreatureScoreGain, synthetic);
  },
);

Deno.test(
  "DiscoverSquashAnalysis - remove-neuron gain is consumed from Discovery (analyzeSelectedNeuronsForHarmfulRemoval)",
  async () => {
    const creature = overThresholdCreature();
    const hiddenId = buildWireToRuntimeIdMap(creature).get("hidden-target")!;

    const discoveryEstimate = -0.000194;
    let requestedUuid: string | undefined;

    const result = await analyzeSelectedNeuronsForHarmfulRemoval(
      creature,
      [hiddenId],
      () => Promise.resolve([{ value: 1, activation: 1, errors: [1e11] }]),
      "/tmp/discovery",
      false,
      () => {},
      (neuronUuid: string) => {
        requestedUuid = neuronUuid;
        return discoveryEstimate;
      },
    );

    assertEquals(requestedUuid, "hidden-target");
    assertEquals(result?.[0]?.neuronUuid, "hidden-target");
    assertEquals(result?.[0]?.expectedCreatureScoreGain, discoveryEstimate);
    const synthetic = placeholderGain(result![0].errorMagnitude);
    assertNotEquals(result?.[0]?.expectedCreatureScoreGain, synthetic);
  },
);

Deno.test(
  "DiscoverSquashAnalysis - harmful removal emits non-fabricated zero without an estimate",
  async () => {
    const creature = overThresholdCreature();
    const hiddenId = buildWireToRuntimeIdMap(creature).get("hidden-target")!;

    const result = await analyzeSelectedNeuronsForHarmfulRemoval(
      creature,
      [hiddenId],
      () => Promise.resolve([{ value: 1, activation: 1, errors: [1e11] }]),
      "/tmp/discovery",
      false,
      () => {},
    );

    assertEquals(result?.[0]?.neuronUuid, "hidden-target");
    assertEquals(result?.[0]?.expectedCreatureScoreGain, 0);
    const synthetic = placeholderGain(result![0].errorMagnitude);
    assertNotEquals(result?.[0]?.expectedCreatureScoreGain, synthetic);
  },
);

/**
 * Focus neuron using an aggregate squash (`MAXIMUM`/`MINIMUM`) fed by two
 * inputs. Issue #3389 began recording these neurons' value/error, so they now
 * reach the squash analysis; Issue #3419 keeps that analysis from crashing.
 */
function aggregateFocusCreature(squash: string): Creature {
  return Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "agg", squash, bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "agg", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "agg", weight: 0.5 },
      { fromUUID: "agg", toUUID: "output-0", weight: 1 },
    ],
  });
}

/** IF focus neuron with the typed condition/positive/negative connections. */
function ifFocusCreature(): Creature {
  return Creature.fromJSON({
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "if-h", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "if-h", weight: 0.2, type: "condition" },
      { fromUUID: "input-1", toUUID: "if-h", weight: 0.3, type: "positive" },
      { fromUUID: "input-2", toUUID: "if-h", weight: -0.4, type: "negative" },
      { fromUUID: "if-h", toUUID: "output-0", weight: 0.5 },
    ],
  });
}

// Issue #3419: MAXIMUM/MINIMUM aggregate neurons expose no scalar squash(x).
// Pre-fix `findCandidateSquash` cast the aggregate to ActivationInterface and
// called `.squash(idealValue)`, throwing `squash is not a function` and
// aborting the whole discovery run. It must now score simple-squash
// replacements against the IDENTITY pass-through instead of throwing.
for (const squash of ["MAXIMUM", "MINIMUM"]) {
  Deno.test(
    `DiscoverSquashAnalysis - findCandidateSquash scores ${squash} focus neuron without throwing (#3419)`,
    () => {
      const creature = aggregateFocusCreature(squash);
      const aggId = buildWireToRuntimeIdMap(creature).get("agg")!;

      const records = [
        { value: 0.3, activation: 0.3, errors: [0.05] },
        { value: 0.6, activation: 0.6, errors: [-0.05] },
        { value: -0.2, activation: -0.2, errors: [0.1] },
      ];

      // The bug reproduced here: pre-fix this call threw a TypeError.
      const candidate = findCandidateSquash(
        creature,
        aggId,
        records,
        () => 1,
        false,
        () => {},
      );

      // A swap candidate is optional (low score is a valid state); when one is
      // returned it must describe swapping away from the aggregate squash.
      if (candidate !== undefined) {
        assertEquals(candidate.previousSquash, squash);
        assertNotEquals(candidate.squash, squash);
      }
    },
  );
}

Deno.test(
  "DiscoverSquashAnalysis - findCandidateSquash excludes IF focus neuron without throwing (#3419)",
  () => {
    const creature = ifFocusCreature();
    const ifId = buildWireToRuntimeIdMap(creature).get("if-h")!;

    const records = [
      { value: 0.4, activation: 0.4, errors: [0.05] },
      { value: -0.1, activation: -0.1, errors: [-0.05] },
    ];

    // IF routes typed connections a scalar squash would reinterpret, so it is
    // excluded from swap scoring — no candidate, and crucially no throw.
    const candidate = findCandidateSquash(
      creature,
      ifId,
      records,
      () => 1,
      false,
      () => {},
    );

    assertEquals(candidate, undefined);
  },
);

Deno.test(
  "DiscoverSquashAnalysis - harmful removal analysis tolerates aggregate focus neuron (#3419)",
  async () => {
    const creature = aggregateFocusCreature("MAXIMUM");
    const aggId = buildWireToRuntimeIdMap(creature).get("agg")!;

    // Pre-fix this path threw `squash is not a function` per neuron (logged);
    // now it completes and, for reasonable errors, promotes nothing.
    const result = await analyzeSelectedNeuronsForHarmfulRemoval(
      creature,
      [aggId],
      () =>
        Promise.resolve([
          { value: 0.3, activation: 0.3, errors: [0.05] },
          { value: 0.6, activation: 0.6, errors: [-0.05] },
        ]),
      "/tmp/discovery",
      false,
      () => {},
    );

    assertEquals(result, undefined);
  },
);
