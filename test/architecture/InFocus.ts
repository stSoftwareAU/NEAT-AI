import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("inFocus: hidden neurons have mixed focus for a single output", () => {
  const json = JSON.parse(Deno.readTextFileSync("./test/data/inFocus.json"));
  const network = Creature.fromJSON(json);

  let positiveCount = 0;
  let negativeCount = 0;

  const startPos = network.input;
  const endPos = network.neurons.length - network.output;

  for (let pos = startPos; pos < endPos; pos++) {
    const n = network.neurons[pos];

    if (network.inFocus(n.index ? n.index : 0, [1])) {
      positiveCount++;
    } else {
      negativeCount++;
    }
  }

  const totalHidden = endPos - startPos;
  assert(totalHidden > 0, "Fixture should have hidden neurons");
  assert(
    positiveCount > 0,
    `Some hidden neurons should be in focus, got ${positiveCount}/${totalHidden}`,
  );
  assert(
    negativeCount > 0,
    `Some hidden neurons should be out of focus, got ${negativeCount}/${totalHidden}`,
  );
  assertEquals(
    positiveCount + negativeCount,
    totalHidden,
    "Every hidden neuron should be classified as in or out of focus",
  );
});

Deno.test("inFocus: input neurons have mixed focus for a single output", () => {
  const json = JSON.parse(Deno.readTextFileSync("./test/data/inFocus.json"));
  const network = Creature.fromJSON(json);

  let positiveCount = 0;
  let negativeCount = 0;

  const startPos = 0;
  const endPos = network.input;

  for (let pos = startPos; pos < endPos; pos++) {
    const n = network.neurons[pos];

    if (network.inFocus(n.index ? n.index : 0, [1])) {
      positiveCount++;
    } else {
      negativeCount++;
    }
  }

  const totalInput = endPos;
  assert(totalInput > 0, "Fixture should have input neurons");
  assert(
    positiveCount > 0,
    `Some input neurons should be in focus, got ${positiveCount}/${totalInput}`,
  );
  assert(
    negativeCount > 0,
    `Some input neurons should be out of focus, got ${negativeCount}/${totalInput}`,
  );
  assertEquals(
    positiveCount + negativeCount,
    totalInput,
    "Every input neuron should be classified as in or out of focus",
  );
});
