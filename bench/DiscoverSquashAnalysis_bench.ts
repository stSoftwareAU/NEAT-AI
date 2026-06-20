import {
  calculateSquashError,
  calculateSquashErrorFromRaw,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverSquashAnalysis.ts";
import { Activations } from "@methods/activations/Activations.ts";
import type { ActivationInterface } from "@methods/activations/ActivationInterface.ts";

const sizes = [100, 1000, 10000];

const squashFunctions = Activations.list().filter(
  (a) => (a as ActivationInterface).squash !== undefined,
) as ActivationInterface[];

for (const size of sizes) {
  const ideal = Array.from({ length: size }, (_, i) => Math.sin(i));
  const actual = Array.from(
    { length: size },
    (_, i) => Math.sin(i) + 0.01 * Math.cos(i),
  );
  const rawValues = Array.from({ length: size }, (_, i) => Math.sin(i) * 3);

  Deno.bench({
    name: `calculateSquashError (n=${size})`,
    fn: () => {
      calculateSquashError(ideal, actual);
    },
  });

  // Issue #3092: the discovery hot path evaluates ~39 candidate squash
  // functions per focus neuron. The legacy form allocated a temp array per
  // candidate then called calculateSquashError; the fused form does neither.
  Deno.bench({
    name: `legacy candidate loop — map + calculateSquashError (n=${size})`,
    group: `candidate-loop-${size}`,
    baseline: true,
    fn: () => {
      for (const squashFunction of squashFunctions) {
        const tempActivations = rawValues.map((v) => squashFunction.squash(v));
        calculateSquashError(ideal, tempActivations);
      }
    },
  });

  Deno.bench({
    name: `fused candidate loop — calculateSquashErrorFromRaw (n=${size})`,
    group: `candidate-loop-${size}`,
    fn: () => {
      for (const squashFunction of squashFunctions) {
        calculateSquashErrorFromRaw(squashFunction, rawValues, ideal);
      }
    },
  });
}
