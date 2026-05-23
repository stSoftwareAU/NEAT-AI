/**
 * Tests for `chooseDiscoveryCompleteOutcome` (Issue #2737).
 *
 * The mapping picks the `discovery_complete` event's `outcome` label from a
 * minimal projection of `DiscoverResult`. The critical guarantee is that a
 * heap-driven analysis-extension abort surfaces as `"heap_critical_skip"`,
 * not the catch-all `"no_change"` — otherwise callers cannot tell a
 * memory-pressure skip apart from a clean "found nothing" run.
 */
import { assertEquals } from "@std/assert";
import { chooseDiscoveryCompleteOutcome } from "@neat/DiscoveryOutcome.ts";

Deno.test("chooseDiscoveryCompleteOutcome: no inputs → no_change", () => {
  assertEquals(chooseDiscoveryCompleteOutcome({}), "no_change");
});

Deno.test(
  "chooseDiscoveryCompleteOutcome: improvedCreature present → improved",
  () => {
    assertEquals(
      chooseDiscoveryCompleteOutcome({ improvedCreature: { foo: "bar" } }),
      "improved",
    );
  },
);

Deno.test(
  "chooseDiscoveryCompleteOutcome: heap abort wins over no improvement → heap_critical_skip",
  () => {
    assertEquals(
      chooseDiscoveryCompleteOutcome({
        heapAbortedAtExtensionBoundary: true,
      }),
      "heap_critical_skip",
    );
  },
);

Deno.test(
  "chooseDiscoveryCompleteOutcome: heap abort wins over improvedCreature → heap_critical_skip",
  () => {
    // In practice DataRecorder will not set both fields, but the helper
    // must defend the precedence so a stale `improvedCreature` from a
    // previous run cannot mask a memory-pressure skip.
    assertEquals(
      chooseDiscoveryCompleteOutcome({
        heapAbortedAtExtensionBoundary: true,
        improvedCreature: { foo: "bar" },
      }),
      "heap_critical_skip",
    );
  },
);

Deno.test(
  "chooseDiscoveryCompleteOutcome: heapAbortedAtExtensionBoundary=false preserves the regular precedence",
  () => {
    assertEquals(
      chooseDiscoveryCompleteOutcome({
        heapAbortedAtExtensionBoundary: false,
        improvedCreature: { foo: "bar" },
      }),
      "improved",
    );
    assertEquals(
      chooseDiscoveryCompleteOutcome({
        heapAbortedAtExtensionBoundary: false,
      }),
      "no_change",
    );
  },
);
