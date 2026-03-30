import { assertEquals, assertInstanceOf } from "@std/assert";
import { toError, toErrorMessage } from "@utils/ErrorSerialisation.ts";

Deno.test("toErrorMessage extracts message from Error instance", () => {
  const error = new Error("something went wrong");
  assertEquals(toErrorMessage(error), "something went wrong");
});

Deno.test("toErrorMessage converts string to string", () => {
  assertEquals(toErrorMessage("plain string error"), "plain string error");
});

Deno.test("toErrorMessage converts number to string", () => {
  assertEquals(toErrorMessage(42), "42");
});

Deno.test("toErrorMessage converts null to string", () => {
  assertEquals(toErrorMessage(null), "null");
});

Deno.test("toErrorMessage converts undefined to string", () => {
  assertEquals(toErrorMessage(undefined), "undefined");
});

Deno.test("toErrorMessage converts object to string", () => {
  const result = toErrorMessage({ key: "value" });
  assertEquals(typeof result, "string");
});

Deno.test("toErrorMessage handles Error subclass", () => {
  const error = new TypeError("type mismatch");
  assertEquals(toErrorMessage(error), "type mismatch");
});

Deno.test("toError returns Error instance unchanged", () => {
  const original = new Error("original error");
  const result = toError(original);
  assertEquals(result, original);
  assertInstanceOf(result, Error);
});

Deno.test("toError wraps string in Error", () => {
  const result = toError("string error");
  assertInstanceOf(result, Error);
  assertEquals(result.message, "string error");
});

Deno.test("toError wraps number in Error", () => {
  const result = toError(42);
  assertInstanceOf(result, Error);
  assertEquals(result.message, "42");
});

Deno.test("toError wraps null in Error", () => {
  const result = toError(null);
  assertInstanceOf(result, Error);
  assertEquals(result.message, "null");
});

Deno.test("toError wraps undefined in Error", () => {
  const result = toError(undefined);
  assertInstanceOf(result, Error);
  assertEquals(result.message, "undefined");
});

Deno.test("toError preserves Error subclass", () => {
  const original = new RangeError("out of range");
  const result = toError(original);
  assertInstanceOf(result, RangeError);
  assertEquals(result.message, "out of range");
});
