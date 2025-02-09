import { perform } from "./ExportJson.ts";
console.info("starting");
for (let i = 0; i < 1000; i++) {
  perform();
}
console.info("end");
