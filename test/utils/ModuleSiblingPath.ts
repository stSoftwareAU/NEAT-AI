/**
 * WHAT-tests for {@link pathFromModuleUrl} (Issue #3782).
 *
 * Assert outcomes for file vs HTTPS bases — not which path APIs are used.
 */

import { assertEquals } from "@std/assert";
import { pathFromModuleUrl } from "../../src/utils/ModuleSiblingPath.ts";

Deno.test("pathFromModuleUrl - HTTPS (JSR) base returns null", () => {
  assertEquals(
    pathFromModuleUrl(
      "../../../../NEAT-AI-Backpropagation/target/release/neat_ai_backpropagation",
      "https://jsr.io/@stsoftware/neat-ai/6.6.3/src/architecture/training/RustTrainDirBridge.ts",
    ),
    null,
  );
});

Deno.test("pathFromModuleUrl - file base returns a filesystem path", () => {
  const path = pathFromModuleUrl(
    "./ModuleSiblingPath.ts",
    import.meta.url,
  );
  assertEquals(typeof path, "string");
  assertEquals(path!.endsWith("ModuleSiblingPath.ts"), true);
});
