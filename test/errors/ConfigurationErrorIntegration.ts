import { assertIsError, assertThrows } from "@std/assert";
import { ConfigurationError } from "../../src/errors/ConfigurationError.ts";
import { parseDiscoverySampleRate, parseNumber } from "../../src/config/ParseOptions.ts";

Deno.test("parseNumber throws ConfigurationError for non-numeric string", () => {
  const error = assertThrows(
    () => parseNumber("Threads", "abc", 1),
    ConfigurationError,
  );
  assertIsError(error, ConfigurationError);
});

Deno.test("parseNumber throws ConfigurationError for non-finite number", () => {
  const error = assertThrows(
    () => parseNumber("Threads", Infinity, 1),
    ConfigurationError,
  );
  assertIsError(error, ConfigurationError);
});

Deno.test("parseNumber throws ConfigurationError for wrong type", () => {
  const error = assertThrows(
    () => parseNumber("Threads", true, 1),
    ConfigurationError,
  );
  assertIsError(error, ConfigurationError);
});

Deno.test("parseNumber throws ConfigurationError for non-integer", () => {
  const error = assertThrows(
    () => parseNumber("Threads", 3.5, 1, { integer: true }),
    ConfigurationError,
  );
  assertIsError(error, ConfigurationError);
});

Deno.test("parseNumber throws ConfigurationError for out of range", () => {
  const error = assertThrows(
    () => parseNumber("Population Size", 0, 50, { min: 2 }),
    ConfigurationError,
  );
  assertIsError(error, ConfigurationError);
});

Deno.test("parseDiscoverySampleRate throws ConfigurationError for invalid value", () => {
  const error = assertThrows(
    () => parseDiscoverySampleRate(-0.5, 0.2),
    ConfigurationError,
  );
  assertIsError(error, ConfigurationError);
});
