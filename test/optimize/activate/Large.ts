import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";

Deno.test("large network activation produces finite deterministic output", () => {
  const creature = Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync("test/propagate/large/creature.json"),
    ),
  );
  creature.fix();

  const input = new Float32Array(creature.input);
  for (let i = 0; i < creature.input; i++) {
    input[i] = Math.random() * 2 - 1;
  }

  const output1 = creature.activate(input, false);
  assertEquals(
    output1.length,
    creature.output,
    "Output length should match creature output count",
  );
  assert(
    output1.every(Number.isFinite),
    "All output values should be finite",
  );

  // Same input should produce identical output (deterministic)
  const output2 = creature.activate(input, false);
  assertEquals(
    output1.length,
    output2.length,
    "Repeated activation should produce same length output",
  );
  for (let i = 0; i < output1.length; i++) {
    assertEquals(
      output1[i],
      output2[i],
      `Output[${i}] should be deterministic across activations`,
    );
  }
});
