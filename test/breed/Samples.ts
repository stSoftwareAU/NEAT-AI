import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { createCompatibleFather } from "../../src/breed/Father.ts";
import { Creature } from "../../mod.ts";

function loadCreature(name: string): CreatureExport {
  const creature = Creature.fromJSON(
    JSON.parse(Deno.readTextFileSync(`./test/breed/samples/${name}.json`)),
  );

  creature.validate();

  return creature.exportJSON();
}
function loadExpected(sample: number): CreatureExport {
  const creature = loadCreature(`expected-${sample}`);
  delete creature.tags;

  return creature;
}
function loadFather(sample: number): CreatureExport {
  return loadCreature(`father-${sample}`);
}

function loadMother(sample: number): CreatureExport {
  return loadCreature(`mother-${sample}`);
}

Deno.test("CompatibleFather-1", () => {
  const father = loadFather(1);
  const mother = loadMother(1);
  const fatherExpected = loadExpected(1);

  const fatherActual = createCompatibleFather(mother, father);
  Deno.writeTextFileSync(
    `./test/breed/samples/.actual.json`,
    JSON.stringify(fatherActual, null, 2),
  );

  Creature.fromJSON(fatherActual).validate();

  delete fatherActual.tags;
  assertEquals(fatherActual, fatherExpected);
});

Deno.test("CompatibleFather-2", () => {
  const father = loadFather(2);
  const mother = loadMother(2);
  const fatherExpected = loadExpected(2);

  const fatherActual = createCompatibleFather(mother, father);

  Creature.fromJSON(fatherActual).validate();

  delete fatherActual.tags;

  assertEquals(fatherActual, fatherExpected);
});
