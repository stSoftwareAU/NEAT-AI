/**
 * Tests for the ReleasableRef helper (Issue #2398).
 *
 * The helper replaces scattered `@ts-ignore - clearing to help GC`
 * directives with a typed call that expresses the GC-hint intent at
 * the type level.
 */

import { assertEquals, assertStrictEquals } from "@std/assert";
import { clearForGc } from "../../src/utils/ReleasableRef.ts";

Deno.test("clearForGc - clears a set reference to null", () => {
  const host: { creature: { id: string } | null } = {
    creature: { id: "abc" },
  };

  clearForGc(host, "creature");

  assertStrictEquals(host.creature, null);
});

Deno.test("clearForGc - clears an already-null reference (no-op)", () => {
  const host: { creature: { id: string } | null } = { creature: null };

  clearForGc(host, "creature");

  assertStrictEquals(host.creature, null);
});

Deno.test("clearForGc - clears a required (non-nullable) field", () => {
  // The whole point of the helper is that a required field typed as
  // non-nullable can still be cleared for GC without a @ts-ignore.
  interface Payload {
    creature: { id: string };
    trace: number[];
  }

  const host: Payload = {
    creature: { id: "abc" },
    trace: [1, 2, 3],
  };

  clearForGc(host, "creature");
  clearForGc(host, "trace");

  // After clearing, access via the typed reference returns null at runtime.
  // deno-lint-ignore no-explicit-any
  const raw = host as any;
  assertStrictEquals(raw.creature, null);
  assertStrictEquals(raw.trace, null);
});

Deno.test("clearForGc - leaves sibling fields untouched", () => {
  const host: {
    creature: { id: string } | null;
    trace: number[];
  } = {
    creature: { id: "abc" },
    trace: [1, 2, 3],
  };

  clearForGc(host, "creature");

  assertStrictEquals(host.creature, null);
  assertEquals(host.trace, [1, 2, 3]);
});

Deno.test("clearForGc - happy-path round-trip (set, clear, set)", () => {
  const host: { value: string | null } = { value: "initial" };

  assertStrictEquals(host.value, "initial");

  clearForGc(host, "value");
  assertStrictEquals(host.value, null);

  host.value = "restored";
  assertStrictEquals(host.value, "restored");

  clearForGc(host, "value");
  assertStrictEquals(host.value, null);
});

Deno.test("clearForGc - works on nested objects (clears one level)", () => {
  const host: {
    outer: { inner: { data: number[] } | null };
  } = {
    outer: { inner: { data: [1, 2, 3] } },
  };

  clearForGc(host.outer, "inner");

  assertStrictEquals(host.outer.inner, null);
});

Deno.test(
  "no @ts-ignore GC-cleanup directives remain in src/",
  async () => {
    // Regression guard for Issue #2398: any reintroduction of the
    // scattered @ts-ignore GC-cleanup pattern must fail this test.
    // Match only the directive form (starts with //), not the words as
    // they appear in this file's own documentation.
    const pattern = /\/\/\s*@ts-ignore\s*-\s*clearing/;
    const hits: string[] = [];

    async function scan(dir: string) {
      for await (const entry of Deno.readDir(dir)) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory) {
          await scan(path);
        } else if (entry.isFile && path.endsWith(".ts")) {
          const body = await Deno.readTextFile(path);
          if (pattern.test(body)) hits.push(path);
        }
      }
    }

    await scan("src");

    assertEquals(
      hits,
      [],
      `Found forbidden '@ts-ignore - clearing' pattern in:\n${
        hits.join("\n")
      }\nUse clearForGc() from src/utils/ReleasableRef.ts instead.`,
    );
  },
);
