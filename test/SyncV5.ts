import { generate as generateV5 } from "@std/uuid/v5";
import { generate as generateV5Sync } from "../src/architecture/SyncV5.ts";
import { assertEquals } from "@std/assert";

Deno.test("SyncV5", async () => {
  const tmp = {
    neurons: [
      { uuid: "a" },
      { uuid: "b" },
      { uuid: "c" },
    ],
    synapses: [
      { fromUUID: "a", toUUID: "b" },
      { fromUUID: "b", toUUID: "c" },
      { fromUUID: "c", toUUID: "a" },
    ],
  };
  const ns = "843dc7df-f60b-47f6-823d-2992e0a4295d";

  const te = new TextEncoder();
  const txt = JSON.stringify(tmp);
  const utf8 = te.encode(txt);
  const uuid: string = await generateV5(ns, utf8);

  assertEquals(uuid, "8e773d10-e553-5115-9814-22c0b788d800");

  const uuidSync: string = generateV5Sync(ns, utf8);

  assertEquals(uuidSync, uuid);
});
