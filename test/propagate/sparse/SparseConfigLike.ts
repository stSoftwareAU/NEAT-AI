import { assertEquals } from "@std/assert";
import type { SparseConfigLike } from "../../../src/propagate/sparse/SparseConfigLike.ts";

Deno.test("Duck-typed SparseConfigLike trace-all object", () => {
  // This is the pattern used by DiscoverStructure - a trace-all stub
  const traceAll: SparseConfigLike = {
    traceNeeded: (_uuid: string) => true,
    propagateNeeded: (_uuid: string) => true,
    updateNeeded: (_uuid: string) => true,
  };

  assertEquals(traceAll.traceNeeded("any-uuid"), true);
  assertEquals(traceAll.propagateNeeded("any-uuid"), true);
  assertEquals(traceAll.updateNeeded("any-uuid"), true);
});

Deno.test("SparseConfigLike with selective tracing", () => {
  const tracedUuids = new Set(["neuron-1", "neuron-3"]);

  const selective: SparseConfigLike = {
    traceNeeded: (uuid: string) => tracedUuids.has(uuid),
    propagateNeeded: (uuid: string) => tracedUuids.has(uuid),
    updateNeeded: (uuid: string) => tracedUuids.has(uuid),
  };

  assertEquals(selective.traceNeeded("neuron-1"), true);
  assertEquals(selective.traceNeeded("neuron-2"), false);
  assertEquals(selective.propagateNeeded("neuron-3"), true);
  assertEquals(selective.updateNeeded("neuron-4"), false);
});
