import {
  addTag,
  addTags,
  getTag,
  removeTag,
  TagsInterface,
} from "../src/tags/TagsInterface.ts";
import { Network } from "../src/architecture/Network.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.201.0/assert/mod.ts";
((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("tag", () => {
  const taggable: TagsInterface = { tags: undefined };

  assert(getTag(taggable, "hello") == null, "should not have tags yet");

  addTag(taggable, "hello", "world");
  assert(getTag(taggable, "hello") == "world", "Expecting a value.");
  const v = removeTag(taggable, "hello");
  assert(v == "world", "should have removed world was: " + v);
  assert(getTag(taggable, "hello") == null, "should no longer have tags");
});

Deno.test("tags", () => {
  const source: TagsInterface = { tags: undefined };

  addTag(source, "hello", "world");
  addTag(source, "good", "bye");

  const target: TagsInterface = { tags: undefined };

  addTag(target, "keep", "me");

  addTags(target, source);

  assert(getTag(target, "hello") == "world", "Expecting a value.");

  assert(getTag(target, "keep") == "me", "Keep the original.");
});

Deno.test("keep", () => {
  const n = new Network(2, 2);

  addTag(n, "hello", "world");

  assert(getTag(n, "hello") == "world", "Expecting a value.");
  const json = n.exportJSON();

  const n2 = Network.fromJSON(json);

  assert(getTag(n2, "hello") == "world", "Expecting a value.");

  addTag(n, "hello", "mars");
  assert(getTag(n, "hello") == "mars", "Expecting change");

  assert(getTag(n2, "hello") == "world", "Expecting unchanged");
});

Deno.test("Remove", () => {
  const taggable: TagsInterface = {};

  for (let i = 0; i < 10; i++) {
    addTag(taggable, `t${i}`, `v${i}`);
  }
  addTag(taggable, "middle", "something");

  for (let i = 10; i < 20; i++) {
    addTag(taggable, `t${i}`, `v${i}`);
  }
  checkIt(taggable);

  removeTag(taggable, "middle");
  checkIt(taggable);
});

function checkIt(taggable: TagsInterface) {
  for (let i = 0; i < 20; i++) {
    const value = getTag(taggable, `t${i}`);
    assertEquals(`v${i}`, value);
  }
}
