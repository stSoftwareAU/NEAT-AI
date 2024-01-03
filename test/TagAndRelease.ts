import { assertEquals } from "https://deno.land/std@0.210.0/assert/mod.ts";
import { TagAndRelease } from "../src/tags/TagAndReleaseApp.ts";
import { getTag } from "../src/tags/TagsInterface.ts";

Deno.test("TagDirectory", async () => {
  const tempDirPath = await Deno.makeTempDir({ prefix: "test_tags" });
  console.log("Temp dir path:", tempDirPath);

  Deno.writeTextFileSync(
    tempDirPath + "/1.json",
    JSON.stringify({ hello: "world" }),
  );
  Deno.writeTextFileSync(
    tempDirPath + "/2.json",
    JSON.stringify({ good: "bye" }),
  );

  const tar = new TagAndRelease();
  tar.process({ directory: tempDirPath, tagList: "ABC=123,XYZ=456" });
  const tagged = JSON.parse(Deno.readTextFileSync(tempDirPath + "/2.json"));

  await Deno.remove(tempDirPath, { recursive: true });

  const abc = getTag(tagged, "ABC");
  const xyz = getTag(tagged, "XYZ");

  assertEquals(abc, "123", "Check ABC: " + abc);
  assertEquals(xyz, "456", "Check XYZ: " + xyz);
});
