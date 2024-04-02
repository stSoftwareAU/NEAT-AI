import { assert } from "https://deno.land/std@0.221.0/assert/mod.ts";
import { Creature } from "../src/Creature.ts";
import { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { makeElitists } from "../src/architecture/ElitismUtils.ts";
import { addTag } from "https://deno.land/x/tags@v1.0.2/mod.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function make(population: CreatureInternal[]) {
  const networks: Creature[] = [];

  population.forEach((ni) => {
    if (ni.neurons.length == 0) {
      ni.neurons.push({
        index: 1,
        type: "output",
        squash: "identity",
      });
      ni.synapses.push({
        from: 0,
        to: 1,
        weight: 1,
      });
    }
    const network = Creature.fromJSON(ni);
    network.score = ni.score;
    networks.push(network);
  });
  return networks;
}
Deno.test("1make", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: 1, neurons: [], synapses: [] },
    { input: 1, output: 1, score: -1, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 3, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 1, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 2, neurons: [], synapses: [] },
  ];

  const elitists = makeElitists(make(population));

  for (let i = 0; i < elitists.length; i++) {
    const e = elitists[i];
    assert(e, "Undefined " + e);
  }

  assert(
    elitists.length == 1,
    "Should always find one " + JSON.stringify(elitists[0]?.exportJSON()),
  );
  assert(elitists[0].score == 3, `Wrong elitism score ${elitists[0].score}`);
});

Deno.test("3make", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: 1, neurons: [], synapses: [] },
    { input: 1, output: 1, score: -1, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 3, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 1, neurons: [], synapses: [] },
    { input: 1, output: 1, score: 2, neurons: [], synapses: [] },
  ];

  const elitists = makeElitists(make(population), 3);

  for (let i = 0; i < elitists.length; i++) {
    const e = elitists[i];
    assert(e, i + ") " + e);
  }

  assert(elitists.length == 3, `Wrong number ${elitists.length}`);
  assert(elitists[0].score == 3, `Wrong score ${elitists[0].score}`);
  assert(elitists[1].score == 2, `Wrong score ${elitists[1].score}`);
  assert(elitists[2].score == 1, `Wrong score ${elitists[2].score}`);
});

Deno.test("3make2", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: -3, neurons: [], synapses: [] },
    { input: 1, output: 1, score: -2, neurons: [], synapses: [] },
    { input: 1, output: 1, score: -1, neurons: [], synapses: [] },
  ];

  const elitists = makeElitists(make(population), 3);

  for (let i = 0; i < elitists.length; i++) {
    const e = elitists[i];
    assert(e, "Undefined " + e);
  }

  assert(elitists.length == 3, `Wrong number ${elitists.length}`);
  assert(elitists[0].score == -1, `Wrong score ${elitists[0].score}`);
  assert(elitists[1].score == -2, `Wrong score ${elitists[1].score}`);
  assert(elitists[2].score == -3, `Wrong score ${elitists[2].score}`);
});

Deno.test("short", () => {
  const population: CreatureInternal[] = [
    { input: 1, output: 1, score: -2, neurons: [], synapses: [] },
    { input: 1, output: 1, score: -1, neurons: [], synapses: [] },
  ];

  population.forEach((c, i) => {
    addTag(c, "trainID", "ID" + i);
    addTag(c, "approach", "A" + i);
  });

  const elitists = makeElitists(make(population), 3, true);

  for (let i = 0; i < elitists.length; i++) {
    const e = elitists[i];
    assert(e, i + ") " + e);
  }

  assert(elitists.length == 2, `Wrong count ${elitists.length}`);
  assert(elitists[0].score == -1, `Wrong score ${elitists[0].score}`);
  assert(elitists[1].score == -2, `Wrong score ${elitists[1].score}`);
});

Deno.test("backwards", () => {
  const population: CreatureInternal[] = [];
  for (let i = 0; i < 1000; i++) {
    population.push({
      input: 1,
      output: 1,
      score: i,
      neurons: [],
      synapses: [],
    });
  }

  const elitists = makeElitists(make(population), 3);

  for (let i = 0; i < elitists.length; i++) {
    const e = elitists[i];
    assert(e, i + ") " + e);
  }

  assert(elitists.length == 3, `Wrong count ${elitists.length}`);
  assert(elitists[0].score == 999, `Wrong score ${elitists[0].score}`);
  assert(elitists[1].score == 998, `Wrong score ${elitists[1].score}`);
  assert(elitists[2].score == 997, `Wrong score ${elitists[2].score}`);
});

Deno.test("forward", () => {
  const population: CreatureInternal[] = [];
  for (let i = 0; i < 1000; i++) {
    population.push({
      input: 1,
      output: 1,
      score: 1000 - i,
      neurons: [],
      synapses: [],
    });
  }

  const elitists = makeElitists(make(population), 3);

  for (let i = 0; i < elitists.length; i++) {
    const e = elitists[i];
    assert(e, 1 + ") " + e);
  }

  assert(elitists.length == 3, `Wrong count ${elitists.length}`);
  assert(
    elitists[0].score == 1000,
    `Wrong score ${elitists[0].score}`,
  );
  assert(elitists[1].score == 999, `Wrong score ${elitists[1].score}`);
  assert(elitists[2].score == 998, `Wrong score ${elitists[2].score}`);
});

Deno.test("performance", () => {
  const population: CreatureInternal[] = [];
  for (let i = 0; i < 100000; i++) {
    population.push({
      input: 1,
      output: 1,
      score: Math.random(),
      neurons: [],
      synapses: [],
    });
  }
  let totalMS = 0;
  let minMS = Infinity;
  for (let j = 10; j--;) {
    performance.mark("start");
    const elitists = makeElitists(make(population), 3);

    performance.mark("end");
    const ms = performance.measure("start", "end").duration;
    console.log("Duration: " + ms);
    totalMS += ms;
    if (ms < minMS) minMS = ms;
    for (let i = 0; i < elitists.length; i++) {
      const e = elitists[i];
      assert(e, i + ") " + e);
    }

    assert(
      elitists.length == 3,
      `Wrong count ${elitists.length}`,
    );
  }

  console.log("Average", totalMS / 10, " Minimum", minMS);
});

Deno.test("order", () => {
  const population: CreatureInternal[] = [];
  for (let i = 0; i < 1000; i++) {
    const v = Math.random();
    if (i % 11 == 0) {
      population.push({
        input: 1,
        output: 1,
        score: v,
        neurons: [],
        synapses: [],
      });
    }
    const c: CreatureInternal = {
      input: 1,
      output: 1,
      score: v,
      neurons: [],
      synapses: [],
    };

    population.push(c);
  }

  const elitists = makeElitists(make(population), 100);

  const sortedPopulation = population.slice().sort(function (a, b) {
    if (b.score == a.score) return 0;
    if (b.score == undefined) return 1;
    if (a.score == undefined) return -1;

    return b.score - a.score;
  });
  let last = 1;
  for (let i = 0; i < elitists.length; i++) {
    const e = elitists[i];
    assert(e, i + ") " + e);

    assert(e.score ? e.score : 1 <= last, i + ") " + e.score + " > " + last);
    last = e.score ? e.score : 0;

    assert(e.score == sortedPopulation[i].score, "not sorted");
  }

  assert(
    elitists.length == 100,
    `Wrong count ${elitists.length}`,
  );
});

Deno.test("NaN", () => {
  const population: CreatureInternal[] = [];

  population.push({
    input: 1,
    output: 1,
    score: NaN,
    neurons: [],
    synapses: [],
  });

  population.push({
    input: 1,
    output: 1,
    score: undefined,
    neurons: [],
    synapses: [],
  });

  population.push({
    input: 1,
    output: 1,
    score: -1,
    neurons: [],
    synapses: [],
  });

  population.push({
    input: 1,
    output: 1,
    score: NaN,
    neurons: [],
    synapses: [],
  });

  population.push({
    input: 1,
    output: 1,
    score: -Infinity,
    neurons: [],
    synapses: [],
  });

  population.push({
    input: 1,
    output: 1,
    score: NaN,
    neurons: [],
    synapses: [],
  });

  population.push({
    input: 1,
    output: 1,
    score: Infinity,
    neurons: [],
    synapses: [],
  });

  population.push({
    input: 1,
    output: 1,
    score: NaN,
    neurons: [],
    synapses: [],
  });

  population.push({
    input: 1,
    output: 1,
    score: 0,
    neurons: [],
    synapses: [],
  });

  population.push({
    input: 1,
    output: 1,
    score: NaN,
    neurons: [],
    synapses: [],
  });

  population.push({
    input: 1,
    output: 1,
    score: 1,
    neurons: [],
    synapses: [],
  });

  population.push({
    input: 1,
    output: 1,
    score: NaN,
    neurons: [],
    synapses: [],
  });

  const elitists = makeElitists(make(population), 3);

  assert(
    elitists.length == 3,
    `Wrong count ${elitists.length}`,
  );

  assert(
    elitists[0].score == 1,
    "Highest score first " + elitists[0].score,
  );

  assert(
    elitists[1].score == 0,
    "Zero next " + elitists[1].score,
  );

  assert(
    elitists[2].score == -1,
    "Then negative 1 " + elitists[2].score,
  );
});
