import { perform } from "./ActivateAndTrace.ts";

console.info("starting");
for (let i = 0; i < 1000; i++) {
  perform();
}
console.info("end");
