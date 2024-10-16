import { assert } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags";
import { Creature } from "../../src/Creature.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("keep", () => {
  const n = new Creature(2, 2);

  addTag(n, "hello", "world");

  assert(getTag(n, "hello") == "world", "Expecting a value.");
  const json = n.exportJSON();

  const n2 = Creature.fromJSON(json);

  assert(getTag(n2, "hello") == "world", "Expecting a value.");

  addTag(n, "hello", "mars");
  assert(getTag(n, "hello") == "mars", "Expecting change");

  assert(getTag(n2, "hello") == "world", "Expecting unchanged");
});
