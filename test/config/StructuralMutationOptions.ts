/**
 * Issue #3970: configuration of identity-initialised structural mutation.
 *
 * `structuralWeightScale` and `structuralNewbornGraceRounds` default to the
 * historical behaviour, are coerced from CLI strings like every other numeric
 * option, and reject values that would make `Synapse.randomWeight()` assert
 * mid-run.
 */
import { assertEquals, assertThrows } from "@std/assert";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { resolveStructuralMutationOptions } from "@mutate/StructuralMutationOptions.ts";
import { ConfigurationError } from "@errors/ConfigurationError.ts";

Deno.test("structural mutation options - defaults reproduce current behaviour", () => {
  const config = createNeatConfig({});
  assertEquals(config.structuralWeightScale, 1);
  assertEquals(config.structuralNewbornGraceRounds, 0);
});

Deno.test("structural mutation options - accept overrides, including CLI strings", () => {
  const config = createNeatConfig({
    structuralWeightScale: "0.01" as unknown as number,
    structuralNewbornGraceRounds: "3" as unknown as number,
  });
  assertEquals(config.structuralWeightScale, 0.01);
  assertEquals(config.structuralNewbornGraceRounds, 3);
});

Deno.test("structural mutation options - reject values that cannot produce a weight", () => {
  assertThrows(
    () => createNeatConfig({ structuralWeightScale: 0 }),
    Error,
    "structuralWeightScale",
  );
  assertThrows(
    () => createNeatConfig({ structuralWeightScale: -1 }),
    Error,
  );
  assertThrows(
    () => createNeatConfig({ structuralNewbornGraceRounds: 1.5 }),
    Error,
  );
  assertThrows(
    () => createNeatConfig({ structuralNewbornGraceRounds: -1 }),
    Error,
  );
});

Deno.test("resolveStructuralMutationOptions - fills defaults and validates input", () => {
  assertEquals(resolveStructuralMutationOptions(undefined), {
    structuralWeightScale: 1,
    structuralNewbornGraceRounds: 0,
  });
  assertEquals(resolveStructuralMutationOptions({}), {
    structuralWeightScale: 1,
    structuralNewbornGraceRounds: 0,
  });
  assertEquals(
    resolveStructuralMutationOptions({ structuralWeightScale: 0.5 }),
    { structuralWeightScale: 0.5, structuralNewbornGraceRounds: 0 },
  );

  assertThrows(
    () =>
      resolveStructuralMutationOptions({
        structuralWeightScale: Number.NaN,
      }),
    ConfigurationError,
  );
  assertThrows(
    () =>
      resolveStructuralMutationOptions({
        structuralNewbornGraceRounds: -2,
      }),
    ConfigurationError,
  );
});

Deno.test("structural mutation options - a scale wider than the default is accepted", () => {
  const config = createNeatConfig({ structuralWeightScale: 4 });
  assertEquals(
    config.structuralWeightScale,
    4,
    "A wider-than-default scale is a legitimate sweep point",
  );
});
