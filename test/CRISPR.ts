import { assertEquals } from "https://deno.land/std@0.156.0/testing/asserts.ts";

import { NetworkUtil } from "../src/architecture/NetworkUtil.ts";

import { CRISPR } from "../src/reconstruct/CRISPR.ts";
import { Network } from "../src/architecture/network.js";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("CRISPR", () => {
  const networkTXT = Deno.readTextFileSync("test/data/CRISPR/network.json");
  const network = NetworkUtil.fromJSON(JSON.parse(networkTXT));

  const crispr = new CRISPR(network);
  const dnaTXT = Deno.readTextFileSync("test/data/CRISPR/DNA-IF.json");

  const networkIF = crispr.apply(JSON.parse(dnaTXT));

  const expectedJSON = JSON.parse(
    Deno.readTextFileSync("test/data/CRISPR/expected-IF.json"),
  );
  const rawExpectedTXT = JSON.stringify(expectedJSON, null, 2);
  const expectedTXT = JSON.stringify(
    Network.fromJSON(JSON.parse(rawExpectedTXT)),
    null,
    2,
  );
  // Deno.writeTextFileSync("test/data/CRISPR/expected-IF.json", expectedTXT);
  const actualTXT = JSON.stringify((networkIF as Network).toJSON(), null, 2);

  Deno.writeTextFileSync("test/data/CRISPR/.actual-IF.json", actualTXT);
  assertEquals(actualTXT, expectedTXT, "should have converted");
});

Deno.test("CRISPR_twice", () => {
  const networkTXT = Deno.readTextFileSync("test/data/CRISPR/network.json");
  const network = NetworkUtil.fromJSON(JSON.parse(networkTXT));

  const crispr = new CRISPR(network);
  const dnaTXT = Deno.readTextFileSync("test/data/CRISPR/DNA-IF.json");

  const networkIF1 = crispr.apply(JSON.parse(dnaTXT));
  const crispr2 = new CRISPR(networkIF1);
  const networkIF2 = crispr2.apply(JSON.parse(dnaTXT));

  const expectedJSON = JSON.parse(
    Deno.readTextFileSync("test/data/CRISPR/expected-IF.json"),
  );
  const expectedTXT = JSON.stringify(expectedJSON, null, 2);
  const actualTXT = JSON.stringify((networkIF2 as Network).toJSON(), null, 2);

  Deno.writeTextFileSync("test/data/CRISPR/.actual-IF.json", actualTXT);
  assertEquals(actualTXT, expectedTXT, "should have converted");
});

Deno.test("CRISPR-Volume", () => {
  const networkTXT = Deno.readTextFileSync("test/data/CRISPR/network.json");
  const network = NetworkUtil.fromJSON(JSON.parse(networkTXT));

  const crispr = new CRISPR(network);
  const dnaTXT = Deno.readTextFileSync("test/data/CRISPR/DNA-VOLUME.json");

  const networkIF = crispr.apply(JSON.parse(dnaTXT));

  const expectedJSON = JSON.parse(
    Deno.readTextFileSync("test/data/CRISPR/expected-VOLUME.json"),
  );
  const rawExpectedTXT = JSON.stringify(expectedJSON, null, 2);
  const expectedTXT = JSON.stringify(
    Network.fromJSON(JSON.parse(rawExpectedTXT)),
    null,
    2,
  );
  // Deno.writeTextFileSync("test/data/CRISPR/expected-VOLUME.json", expectedTXT);
  const actualTXT = JSON.stringify((networkIF as Network).toJSON(), null, 2);

  Deno.writeTextFileSync("test/data/CRISPR/.actual-VOLUME.json", actualTXT);
  assertEquals(actualTXT, expectedTXT, "should have converted");
});
