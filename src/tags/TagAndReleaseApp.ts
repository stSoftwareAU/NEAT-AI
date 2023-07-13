import { parse as parseArgs } from "https://deno.land/std@0.194.0/flags/mod.ts";
import { addTag } from "./TagsInterface.ts";

interface TagAndReleaseOptions {
  directory: string;
  tagList: string;
}
export class TagAndRelease {
  process(options: TagAndReleaseOptions) {
    for (const dirEntry of Deno.readDirSync(options.directory)) {
      if (dirEntry.name.endsWith(".json")) {
        const json = JSON.parse(
          Deno.readTextFileSync(options.directory + "/" + dirEntry.name),
        );
        options.tagList.split(",").forEach((pair) => {
          const item = pair.split("=");

          addTag(json, item[0], item[1]);

          Deno.writeTextFileSync(
            options.directory + "/" + dirEntry.name,
            JSON.stringify(json, null, 2),
          );
        });
      }
    }
  }
}

const args = parseArgs(Deno.args);

if (args.directory) {
  const tagAndRelease = new TagAndRelease();

  tagAndRelease.process({
    directory: args.directory,
    tagList: args.tagList,
  });
}
