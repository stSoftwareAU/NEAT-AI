import { assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { Creature } from "../../src/Creature.ts";
import { CRISPR } from "../../src/reconstruct/CRISPR.ts";
import { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("CRISPR/Append", async () => {
  const networkTXT = Deno.readTextFileSync("test/data/CRISPR/network.json");
  const network = Creature.fromJSON(JSON.parse(networkTXT));
  network.validate();

  const crispr = new CRISPR(network);
  const dnaTXT = Deno.readTextFileSync("test/data/CRISPR/DNA-RANGE.json");

  const networkIF = await crispr.cleaveDNA(JSON.parse(dnaTXT));
  (networkIF as Creature).validate();
  const expectedJSON = JSON.parse(
    Deno.readTextFileSync("test/data/CRISPR/expected-range.json"),
  );

  const expectedTXT = JSON.stringify(
    clean(Creature.fromJSON(expectedJSON).internalJSON()),
    null,
    2,
  );
  Deno.writeTextFileSync("test/data/CRISPR/.expected-range.txt", expectedTXT);

  const actualJSON = clean((networkIF as Creature).internalJSON());

  const actualTXT = JSON.stringify(
    actualJSON,
    null,
    2,
  );

  Deno.writeTextFileSync(
    "test/data/CRISPR/.actual-range.json",
    JSON.stringify((networkIF as Creature).exportJSON(), null, 2),
  );
  Deno.writeTextFileSync("test/data/CRISPR/.actual-range.txt", actualTXT);
  assertEquals(actualTXT, expectedTXT, "should have converted");
});

function clean(creature: CreatureInternal): { uuid: string | undefined } {
  const cleanCreature = JSON.parse(JSON.stringify(creature));
  delete cleanCreature.tags;
  delete cleanCreature.uuid;
  cleanCreature.neurons.forEach((neuron: { uuid: string | undefined }) => {
    delete neuron.uuid;
  });

  cleanCreature.synapses.forEach((synapse: { tags: string | undefined }) => {
    delete synapse.tags;
  });
  return cleanCreature;
}
