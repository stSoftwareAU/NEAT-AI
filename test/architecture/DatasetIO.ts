/**
 * Tests for DatasetIO fail-loud helpers (Issue #3412).
 *
 * A vanished dataset directory or `.bin` file must surface as a DatasetError
 * naming the missing path, not a bare Deno.errors.NotFound (which downstream
 * code previously masked as `Error is not finite: Infinity`).
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  assertDatasetFilesExist,
  openDatasetFileSync,
  readDatasetDirEntriesSync,
  readDatasetFileSync,
} from "@architecture/DatasetIO.ts";
import { DatasetError } from "@errors/DatasetError.ts";

Deno.test("openDatasetFileSync - missing file throws DatasetError naming it", () => {
  const missing = `${Deno.makeTempDirSync()}/B-2026.bin`;
  const error = assertThrows(
    () => openDatasetFileSync(missing),
    DatasetError,
  ) as DatasetError;
  assertEquals(error.reason, "FILE_MISSING");
  assertEquals(error.path, missing);
  // The message must name the file so the operator debugs the real fault.
  assertEquals(error.message.includes(missing), true);
});

Deno.test("openDatasetFileSync - existing file opens and reads back", () => {
  const dir = Deno.makeTempDirSync();
  const filePath = `${dir}/0.bin`;
  const payload = new Uint8Array([1, 2, 3, 4]);
  Deno.writeFileSync(filePath, payload);
  const file = openDatasetFileSync(filePath);
  try {
    const buffer = new Uint8Array(4);
    const bytesRead = file.readSync(buffer);
    assertEquals(bytesRead, 4);
    assertEquals(buffer, payload);
  } finally {
    file.close();
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("readDatasetFileSync - missing file throws DatasetError", () => {
  const missing = `${Deno.makeTempDirSync()}/gone.bin`;
  const error = assertThrows(
    () => readDatasetFileSync(missing),
    DatasetError,
  ) as DatasetError;
  assertEquals(error.reason, "FILE_MISSING");
  assertEquals(error.path, missing);
});

Deno.test("assertDatasetFilesExist - missing file throws DatasetError naming it", () => {
  const dir = Deno.makeTempDirSync();
  const present = `${dir}/0.bin`;
  const missing = `${dir}/does-not-exist.bin`;
  Deno.writeFileSync(present, new Uint8Array([1, 2, 3, 4]));
  try {
    const error = assertThrows(
      () => assertDatasetFilesExist([present, missing]),
      DatasetError,
    ) as DatasetError;
    assertEquals(error.reason, "FILE_MISSING");
    assertEquals(error.path, missing);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("assertDatasetFilesExist - existing files pass", () => {
  const dir = Deno.makeTempDirSync();
  const filePath = `${dir}/0.bin`;
  Deno.writeFileSync(filePath, new Uint8Array([1, 2, 3, 4]));
  try {
    assertDatasetFilesExist([filePath]);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("readDatasetDirEntriesSync - vanished directory throws DatasetError", () => {
  const dir = Deno.makeTempDirSync();
  Deno.removeSync(dir, { recursive: true }); // rm -rf the dataset dir
  const error = assertThrows(
    () => readDatasetDirEntriesSync(dir),
    DatasetError,
  ) as DatasetError;
  assertEquals(error.reason, "DIRECTORY_MISSING");
  assertEquals(error.path, dir);
  assertEquals(error.message.includes(dir), true);
});

Deno.test("readDatasetDirEntriesSync - existing directory lists entries", () => {
  const dir = Deno.makeTempDirSync();
  Deno.writeFileSync(`${dir}/0.bin`, new Uint8Array([0]));
  Deno.writeFileSync(`${dir}/1.bin`, new Uint8Array([1]));
  try {
    const names = readDatasetDirEntriesSync(dir).map((e) => e.name).sort();
    assertEquals(names, ["0.bin", "1.bin"]);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
