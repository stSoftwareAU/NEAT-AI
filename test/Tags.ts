import {
  addTag,
  addTags,
  getTag,
  removeTag,
  TagsInterface,
} from "../src/tags/TagsInterface.ts";
import { Network } from "../src/architecture/network.js";
import { assert } from "https://deno.land/std@0.160.0/testing/asserts.ts";
import { NetworkUtil } from "../src/architecture/NetworkUtil.ts";

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

  assert(getTag(target, "keep") == "me", "Keep the orginal.");
});

Deno.test("keep", () => {
  const n = new Network(2, 2);

  addTag(n, "hello", "world");

  assert(getTag(n, "hello") == "world", "Expecting a value.");
  const json = n.toJSON();

  const n2 = NetworkUtil.fromJSON(json);

  assert(getTag(n2, "hello") == "world", "Expecting a value.");

  addTag(n, "hello", "mars");
  assert(getTag(n, "hello") == "mars", "Expecting change");

  assert(getTag(n2, "hello") == "world", "Expecting unchanged");
});
