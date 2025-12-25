import { assert, assertEquals } from "@std/assert";
import { writeDiagnostics } from "../../src/utils/Diagnostics.ts";

const TEST_DIR = ".diagnostics";

/**
 * Clean up test files after each test.
 */
function cleanupDiagnostics() {
  try {
    for (const entry of Deno.readDirSync(TEST_DIR)) {
      if (entry.name.startsWith("test-")) {
        Deno.removeSync(`${TEST_DIR}/${entry.name}`);
      }
    }
  } catch {
    // Directory may not exist; ignore.
  }
}

Deno.test("writeDiagnostics: writes error file with Error object", () => {
  const error = new Error("Test error message");
  error.name = "TestError";

  writeDiagnostics({
    error,
    prefix: "test-error",
  });

  // Verify error file was created
  const files = Array.from(Deno.readDirSync(TEST_DIR))
    .filter((f) => f.name.startsWith("test-error-error-"));
  assertEquals(files.length, 1, "Should create one error file");

  const content = Deno.readTextFileSync(`${TEST_DIR}/${files[0].name}`);
  assert(content.includes("TestError"), "Should contain error name");
  assert(
    content.includes("Test error message"),
    "Should contain error message",
  );

  cleanupDiagnostics();
});

Deno.test("writeDiagnostics: writes error file with non-Error object", () => {
  writeDiagnostics({
    error: "Simple string error",
    prefix: "test-string",
  });

  const files = Array.from(Deno.readDirSync(TEST_DIR))
    .filter((f) => f.name.startsWith("test-string-error-"));
  assertEquals(files.length, 1);

  const content = Deno.readTextFileSync(`${TEST_DIR}/${files[0].name}`);
  assert(content.includes("Simple string error"));

  cleanupDiagnostics();
});

Deno.test("writeDiagnostics: writes creature JSON from object", () => {
  const creature = {
    input: 2,
    output: 1,
    neurons: [],
    synapses: [],
  };

  writeDiagnostics({
    error: new Error("test"),
    prefix: "test-creature-obj",
    creature,
  });

  const files = Array.from(Deno.readDirSync(TEST_DIR))
    .filter((f) => f.name.startsWith("test-creature-obj-creature-"));
  assertEquals(files.length, 1);

  const content = Deno.readTextFileSync(`${TEST_DIR}/${files[0].name}`);
  const parsed = JSON.parse(content);
  assertEquals(parsed.input, 2);
  assertEquals(parsed.output, 1);

  cleanupDiagnostics();
});

Deno.test("writeDiagnostics: writes creature JSON from string", () => {
  const creatureStr = '{"input":3,"output":2}';

  writeDiagnostics({
    error: new Error("test"),
    prefix: "test-creature-str",
    creature: creatureStr,
  });

  const files = Array.from(Deno.readDirSync(TEST_DIR))
    .filter((f) => f.name.startsWith("test-creature-str-creature-"));
  assertEquals(files.length, 1);

  const content = Deno.readTextFileSync(`${TEST_DIR}/${files[0].name}`);
  assertEquals(content, creatureStr);

  cleanupDiagnostics();
});

Deno.test("writeDiagnostics: writes mother, father, offspring files", () => {
  const mother = { input: 1, output: 1, neurons: [], synapses: [] };
  const father = { input: 1, output: 1, neurons: [], synapses: [] };
  const offspring = { input: 1, output: 1, neurons: [], synapses: [] };

  writeDiagnostics({
    error: new Error("test"),
    prefix: "test-breed",
    mother,
    father,
    offspring,
  });

  const motherFiles = Array.from(Deno.readDirSync(TEST_DIR))
    .filter((f) => f.name.startsWith("test-breed-mother-"));
  const fatherFiles = Array.from(Deno.readDirSync(TEST_DIR))
    .filter((f) => f.name.startsWith("test-breed-father-"));
  const offspringFiles = Array.from(Deno.readDirSync(TEST_DIR))
    .filter((f) => f.name.startsWith("test-breed-offspring-"));

  assertEquals(motherFiles.length, 1);
  assertEquals(fatherFiles.length, 1);
  assertEquals(offspringFiles.length, 1);

  cleanupDiagnostics();
});

Deno.test("writeDiagnostics: writes context file", () => {
  const context = { taskID: "test-123", extra: { nested: true } };

  writeDiagnostics({
    error: new Error("test"),
    prefix: "test-context",
    context,
  });

  const files = Array.from(Deno.readDirSync(TEST_DIR))
    .filter((f) => f.name.startsWith("test-context-context-"));
  assertEquals(files.length, 1);

  const content = Deno.readTextFileSync(`${TEST_DIR}/${files[0].name}`);
  const parsed = JSON.parse(content);
  assertEquals(parsed.taskID, "test-123");
  assertEquals(parsed.extra.nested, true);

  cleanupDiagnostics();
});

Deno.test("writeDiagnostics: works without prefix", () => {
  writeDiagnostics({
    error: new Error("no prefix test"),
  });

  // Files should exist without prefix (just timestamp)
  const files = Array.from(Deno.readDirSync(TEST_DIR))
    .filter((f) => f.name.startsWith("error-") && !f.name.startsWith("test-"));
  assert(files.length >= 1, "Should create error file without prefix");

  // Clean up
  for (const file of files) {
    Deno.removeSync(`${TEST_DIR}/${file.name}`);
  }
});
