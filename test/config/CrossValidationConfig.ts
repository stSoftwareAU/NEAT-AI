import { assertEquals, assertThrows } from "@std/assert";
import { DEFAULT_CROSS_VALIDATION_CONFIG } from "@config/CrossValidationConfig.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";

Deno.test("CrossValidationConfig - defaults are applied", () => {
  const config = createNeatConfig({});
  assertEquals(
    config.crossValidation.enabled,
    DEFAULT_CROSS_VALIDATION_CONFIG.enabled,
  );
  assertEquals(
    config.crossValidation.folds,
    DEFAULT_CROSS_VALIDATION_CONFIG.folds,
  );
  assertEquals(
    config.crossValidation.validationEarlyStopping,
    DEFAULT_CROSS_VALIDATION_CONFIG.validationEarlyStopping,
  );
});

Deno.test("CrossValidationConfig - disabled by default", () => {
  const config = createNeatConfig({});
  assertEquals(config.crossValidation.enabled, false);
});

Deno.test("CrossValidationConfig - custom values override defaults", () => {
  const config = createNeatConfig({
    crossValidation: {
      enabled: true,
      folds: 10,
      validationEarlyStopping: false,
    },
  });
  assertEquals(config.crossValidation.enabled, true);
  assertEquals(config.crossValidation.folds, 10);
  assertEquals(config.crossValidation.validationEarlyStopping, false);
});

Deno.test("CrossValidationConfig - string coercion for CLI", () => {
  const config = createNeatConfig({
    crossValidation: {
      folds: "3" as unknown as number,
    },
  });
  assertEquals(config.crossValidation.folds, 3);
});

Deno.test("CrossValidationConfig - folds must be >= 1", () => {
  assertThrows(
    () => {
      createNeatConfig({
        crossValidation: {
          folds: 0,
        },
      });
    },
    Error,
  );
});

Deno.test("CrossValidationConfig - folds must be <= 20", () => {
  assertThrows(
    () => {
      createNeatConfig({
        crossValidation: {
          folds: 21,
        },
      });
    },
    Error,
  );
});

Deno.test("CrossValidationConfig - partial overrides preserve defaults", () => {
  const config = createNeatConfig({
    crossValidation: {
      enabled: true,
    },
  });
  assertEquals(config.crossValidation.enabled, true);
  assertEquals(config.crossValidation.folds, 5);
  assertEquals(config.crossValidation.validationEarlyStopping, true);
});
