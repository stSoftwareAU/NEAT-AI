import { perform } from "./Activate.ts";
console.info("starting");
for (let i = 0; i < 10; i++) {
  perform();
}
console.info("end");
