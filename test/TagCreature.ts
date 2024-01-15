import {
    addTag,
    addTags,
    getTag,
    removeTag,
    TagsInterface,
  } from "../src/TagsInterface.ts";

  import {
    assert,
    assertEquals,
  } from "https://deno.land/std@0.212.0/assert/mod.ts";
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
  