/**
 * Issue #4126 — parsing of the `exitOnUnreclaimableWorkers` option.
 *
 * A plain boolean: it defaults to `false` and an explicit value is passed
 * through unchanged. These are "what" tests against the public factory.
 */

import { assertEquals } from "@std/assert";
import { createNeatConfig } from "@config/NeatConfig.ts";

Deno.test("exitOnUnreclaimableWorkers defaults to false", () => {
  const config = createNeatConfig({});
  assertEquals(config.exitOnUnreclaimableWorkers, false);
});

Deno.test("exitOnUnreclaimableWorkers: true is passed through", () => {
  const config = createNeatConfig({ exitOnUnreclaimableWorkers: true });
  assertEquals(config.exitOnUnreclaimableWorkers, true);
});

Deno.test("exitOnUnreclaimableWorkers: explicit false is passed through", () => {
  const config = createNeatConfig({ exitOnUnreclaimableWorkers: false });
  assertEquals(config.exitOnUnreclaimableWorkers, false);
});
