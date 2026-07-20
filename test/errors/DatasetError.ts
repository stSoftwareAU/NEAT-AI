import { assert, assertEquals, assertIsError, assertThrows } from "@std/assert";
import { DatasetError, type DatasetErrorReason } from "@errors/DatasetError.ts";

Deno.test("DatasetError - DIRECTORY_MISSING reason", () => {
  const error = new DatasetError(
    "training data directory /tmp/foo disappeared mid-run",
    "DIRECTORY_MISSING",
    "/tmp/foo",
  );
  assertIsError(error, DatasetError);
  assertEquals(
    error.message,
    "training data directory /tmp/foo disappeared mid-run",
  );
  assertEquals(error.reason, "DIRECTORY_MISSING");
  assertEquals(error.path, "/tmp/foo");
  assertEquals(error.name, "DatasetError");
});

Deno.test("DatasetError - FILE_MISSING reason names the file", () => {
  const error = new DatasetError(
    "training data file /tmp/foo/B-2026.bin disappeared mid-run",
    "FILE_MISSING",
    "/tmp/foo/B-2026.bin",
  );
  assertIsError(error, DatasetError);
  assertEquals(error.reason, "FILE_MISSING");
  assertEquals(error.path, "/tmp/foo/B-2026.bin");
});

Deno.test("DatasetError - NO_DATA_FILES reason", () => {
  const error = new DatasetError(
    "no .bin training data files found in /tmp/foo (dataset vanished?)",
    "NO_DATA_FILES",
    "/tmp/foo",
  );
  assertEquals(error.reason, "NO_DATA_FILES");
  assertEquals(error.path, "/tmp/foo");
});

Deno.test("DatasetError - is instanceof Error", () => {
  const error = new DatasetError("test", "FILE_MISSING", "/tmp/x.bin");
  assert(error instanceof Error);
  assert(error instanceof DatasetError);
});

Deno.test("DatasetError - can be caught selectively", () => {
  const fn = () => {
    throw new DatasetError("gone", "DIRECTORY_MISSING", "/tmp/gone");
  };
  assertThrows(fn, DatasetError);
});

Deno.test("DatasetError - reason is typed", () => {
  const reasons: DatasetErrorReason[] = [
    "DIRECTORY_MISSING",
    "FILE_MISSING",
    "NO_DATA_FILES",
  ];
  for (const reason of reasons) {
    const error = new DatasetError(`test: ${reason}`, reason, "/tmp/x");
    assertEquals(error.reason, reason);
  }
});
