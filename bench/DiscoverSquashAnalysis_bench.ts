import { calculateSquashError } from "../src/architecture/ErrorGuidedStructuralEvolution/DiscoverSquashAnalysis.ts";

const sizes = [100, 1000, 10000];

for (const size of sizes) {
  const ideal = Array.from({ length: size }, (_, i) => Math.sin(i));
  const actual = Array.from(
    { length: size },
    (_, i) => Math.sin(i) + 0.01 * Math.cos(i),
  );

  Deno.bench({
    name: `calculateSquashError (n=${size})`,
    fn: () => {
      calculateSquashError(ideal, actual);
    },
  });
}
