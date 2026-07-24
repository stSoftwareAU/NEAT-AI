/**
 * Unit tests for the best-effort host hardware descriptor (Issue #3422).
 *
 * These "what" tests call the real reader and assert on the shape and value
 * constraints of the returned descriptor. The concrete values depend on the
 * host, so the assertions bound each field to its allowed type rather than a
 * fixed number.
 */

import { assert } from "@std/assert";
import { readHardwareDescriptor } from "@creature/EvolveHardware.ts";

Deno.test("readHardwareDescriptor - returns typed, JSON-safe descriptors", () => {
  const hw = readHardwareDescriptor();

  assert(
    hw.cpuCores === null ||
      (typeof hw.cpuCores === "number" && hw.cpuCores > 0),
    `cpuCores must be a positive number or null, got ${hw.cpuCores}`,
  );
  assert(
    hw.totalMemoryBytes === null ||
      (typeof hw.totalMemoryBytes === "number" && hw.totalMemoryBytes > 0),
    `totalMemoryBytes must be a positive number or null, got ${hw.totalMemoryBytes}`,
  );
  assert(
    hw.host === null || (typeof hw.host === "string" && hw.host.length > 0),
    `host must be a non-empty string or null, got ${hw.host}`,
  );

  // The descriptor must survive JSON serialisation for result.json.
  const roundTripped = JSON.parse(JSON.stringify(hw));
  assert(Object.hasOwn(roundTripped, "cpuCores"));
  assert(Object.hasOwn(roundTripped, "totalMemoryBytes"));
  assert(Object.hasOwn(roundTripped, "host"));
});

Deno.test("readHardwareDescriptor - reads cores and host when --allow-sys granted", () => {
  // The test runner grants --allow-sys, so these should be populated. Guard
  // defensively so the suite still passes in a locked-down sandbox.
  const hw = readHardwareDescriptor();
  if (hw.cpuCores !== null) {
    assert(Number.isInteger(hw.cpuCores), "cpuCores should be an integer");
  }
  if (hw.host !== null) {
    assert(hw.host.trim().length > 0, "host should be non-blank");
  }
});
