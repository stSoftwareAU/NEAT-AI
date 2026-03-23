import { assertEquals } from "@std/assert";
import type { SparseConfigLike } from "../../../src/propagate/sparse/SparseConfigLike.ts";

Deno.test("Duck-typed SparseConfigLike trace-all object", () => {
  // This is the pattern used by DiscoverStructure - a trace-all stub
  const traceAll: SparseConfigLike = {
    traceNeeded: (_id: number) => true,
    propagateNeeded: (_id: number) => true,
    updateNeeded: (_id: number) => true,
  };

  assertEquals(traceAll.traceNeeded(7001), true);
  assertEquals(traceAll.propagateNeeded(7001), true);
  assertEquals(traceAll.updateNeeded(7001), true);
});

Deno.test("SparseConfigLike with selective tracing", () => {
  const tracedIds = new Set([7001, 7003]);

  const selective: SparseConfigLike = {
    traceNeeded: (id: number) => tracedIds.has(id),
    propagateNeeded: (id: number) => tracedIds.has(id),
    updateNeeded: (id: number) => tracedIds.has(id),
  };

  assertEquals(selective.traceNeeded(7001), true);
  assertEquals(selective.traceNeeded(7002), false);
  assertEquals(selective.propagateNeeded(7003), true);
  assertEquals(selective.updateNeeded(7004), false);
});
