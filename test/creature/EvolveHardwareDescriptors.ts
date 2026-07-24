/**
 * Unit tests for {@link captureHardwareDescriptors} (Issue #3422): the machine
 * descriptors recorded on the run-level result must always be present, with
 * best-effort fields degrading to `null` rather than throwing when the
 * `--allow-sys` permission is absent (as it is in the test runner).
 */

import { assert, assertEquals } from "@std/assert";
import { captureHardwareDescriptors } from "@creature/EvolveHardwareDescriptors.ts";

Deno.test("captureHardwareDescriptors - returns the expected shape", () => {
  const hw = captureHardwareDescriptors();

  // Exactly the three descriptor keys.
  assertEquals(Object.keys(hw).sort(), [
    "cpuCores",
    "host",
    "totalMemoryBytes",
  ]);
});

Deno.test("captureHardwareDescriptors - cpuCores is a positive integer or null", () => {
  const { cpuCores } = captureHardwareDescriptors();

  if (cpuCores !== null) {
    assertEquals(typeof cpuCores, "number");
    assert(cpuCores > 0, "cpuCores must be positive when present");
  }
});

Deno.test("captureHardwareDescriptors - best-effort fields are typed value or null", () => {
  const { totalMemoryBytes, host } = captureHardwareDescriptors();

  // Without --allow-sys these degrade to null; when the permission is present
  // they carry a positive number / non-empty string. Either way, no throw.
  if (totalMemoryBytes !== null) {
    assertEquals(typeof totalMemoryBytes, "number");
    assert(
      totalMemoryBytes > 0,
      "totalMemoryBytes must be positive when present",
    );
  }
  if (host !== null) {
    assertEquals(typeof host, "string");
    assert(host.length > 0, "host must be non-empty when present");
  }
});
