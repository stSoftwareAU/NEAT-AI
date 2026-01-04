/**
 * Tests for safe file writing utilities.
 */

import { assertEquals } from "@std/assert";
import { existsSync } from "@std/fs";
import { join } from "@std/path";
import {
  safeWriteJson,
  safeWriteJsonSync,
  safeWriteText,
  safeWriteTextSync,
} from "../../src/intelligentDesign/SafeWrite.ts";

const TEST_DIR = ".test-safe-write";

// Clean up test directory before and after tests
function cleanup() {
  try {
    Deno.removeSync(TEST_DIR, { recursive: true });
  } catch {
    // Directory may not exist
  }
}

Deno.test({
  name: "safeWriteTextSync writes file atomically",
  fn() {
    cleanup();
    try {
      const filePath = join(TEST_DIR, "test.txt");
      const content = "Hello, World!";

      safeWriteTextSync(filePath, content);

      const read = Deno.readTextFileSync(filePath);
      assertEquals(read, content);

      // Verify no temp files left behind
      const files = [...Deno.readDirSync(TEST_DIR)];
      assertEquals(files.length, 1);
      assertEquals(files[0].name, "test.txt");
    } finally {
      cleanup();
    }
  },
});

Deno.test({
  name: "safeWriteJsonSync writes JSON file atomically",
  fn() {
    cleanup();
    try {
      const filePath = join(TEST_DIR, "test.json");
      const content = { name: "test", value: 42 };

      safeWriteJsonSync(filePath, content);

      const read = JSON.parse(Deno.readTextFileSync(filePath));
      assertEquals(read.name, "test");
      assertEquals(read.value, 42);
    } finally {
      cleanup();
    }
  },
});

Deno.test({
  name: "safeWriteText writes file atomically (async)",
  async fn() {
    cleanup();
    try {
      const filePath = join(TEST_DIR, "async-test.txt");
      const content = "Async Hello!";

      await safeWriteText(filePath, content);

      const read = await Deno.readTextFile(filePath);
      assertEquals(read, content);
    } finally {
      cleanup();
    }
  },
});

Deno.test({
  name: "safeWriteJson writes JSON file atomically (async)",
  async fn() {
    cleanup();
    try {
      const filePath = join(TEST_DIR, "async-test.json");
      const content = { async: true, count: 123 };

      await safeWriteJson(filePath, content);

      const read = JSON.parse(await Deno.readTextFile(filePath));
      assertEquals(read.async, true);
      assertEquals(read.count, 123);
    } finally {
      cleanup();
    }
  },
});

Deno.test({
  name: "safeWriteJsonSync creates nested directories",
  fn() {
    cleanup();
    try {
      const filePath = join(TEST_DIR, "nested", "deep", "test.json");
      const content = { nested: true };

      safeWriteJsonSync(filePath, content);

      assertEquals(existsSync(filePath), true);
      const read = JSON.parse(Deno.readTextFileSync(filePath));
      assertEquals(read.nested, true);
    } finally {
      cleanup();
    }
  },
});

Deno.test({
  name: "safeWriteJsonSync overwrites existing file",
  fn() {
    cleanup();
    try {
      const filePath = join(TEST_DIR, "overwrite.json");

      safeWriteJsonSync(filePath, { version: 1 });
      safeWriteJsonSync(filePath, { version: 2 });

      const read = JSON.parse(Deno.readTextFileSync(filePath));
      assertEquals(read.version, 2);
    } finally {
      cleanup();
    }
  },
});
