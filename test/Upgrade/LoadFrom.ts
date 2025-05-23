import { assertEquals } from "@std/assert/equals";
import { Creature } from "../../mod.ts";

Deno.test("LoadFrom", () => {
  const current = new Creature(100, 3, {
    layers: [
      { count: 10 },
    ],
    semanticVersion: "1.0.0",
  });

  const v2 = new Creature(100, 3, {
    layers: [
      { count: 10 },
    ],
    semanticVersion: "2.0.1",
  });

  current.loadFrom(v2, true);

  assertEquals(
    current.semanticVersion,
    v2.semanticVersion,
    "Semantic version should be the same",
  );
});
