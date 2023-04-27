import { makeElitists } from "../src/architecture/elitism.ts";
import { assert } from "https://deno.land/std@0.184.0/testing/asserts.ts";
import { NetworkInternal } from "../src/architecture/NetworkInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("1make", () => {
  const population: NetworkInternal[] = [
    { input: 0, output: 0, score: 1, nodes: [], connections: [] },
    { input: 0, output: 0, score: -1, nodes: [], connections: [] },
    { input: 0, output: 0, score: 3, nodes: [], connections: [] },
    { input: 0, output: 0, score: 1, nodes: [], connections: [] },
    { input: 0, output: 0, score: 2, nodes: [], connections: [] },
  ];

  const elitists = makeElitists(population);

  for (let i = 0; i < elitists.length; i++) {
    const e = elitists[i];
    assert(e, "Undefined " + e);
  }

  assert(
    elitists.length == 1,
    "Should always find one " + JSON.stringify(elitists),
  );
  assert(elitists[0].score == 3, "Wrong elitism " + JSON.stringify(elitists));
});

Deno.test("3make", () => {
  const population: NetworkInternal[] = [
    { input: 0, output: 0, score: 1, nodes: [], connections: [] },
    { input: 0, output: 0, score: -1, nodes: [], connections: [] },
    { input: 0, output: 0, score: 3, nodes: [], connections: [] },
    { input: 0, output: 0, score: 1, nodes: [], connections: [] },
    { input: 0, output: 0, score: 2, nodes: [], connections: [] },
  ];

  const elitists = makeElitists(population, 3);

  for (let i = 0; i < elitists.length; i++) {
    const e = elitists[i];
    assert(e, i + ") " + e);
  }

  assert(elitists.length == 3, "Should find three " + JSON.stringify(elitists));
  assert(elitists[0].score == 3, "Wrong elitism " + JSON.stringify(elitists));
  assert(elitists[1].score == 2, "Wrong elitism " + JSON.stringify(elitists));
  assert(elitists[2].score == 1, "Wrong elitism " + JSON.stringify(elitists));
});

Deno.test("3make2", () => {
  const population: NetworkInternal[] = [
    { input: 0, output: 0, score: -3, nodes: [], connections: [] },
    { input: 0, output: 0, score: -2, nodes: [], connections: [] },
    { input: 0, output: 0, score: -1, nodes: [], connections: [] },
  ];

  const elitists = makeElitists(population, 3);

  for (let i = 0; i < elitists.length; i++) {
    const e = elitists[i];
    assert(e, "Undefined " + e);
  }

  assert(elitists.length == 3, "Should find three " + JSON.stringify(elitists));
  assert(elitists[0].score == -1, "Wrong elitism " + JSON.stringify(elitists));
  assert(elitists[1].score == -2, "Wrong elitism " + JSON.stringify(elitists));
  assert(elitists[2].score == -3, "Wrong elitism " + JSON.stringify(elitists));
});

Deno.test("short", () => {
  const population: NetworkInternal[] = [
    { input: 0, output: 0, score: -2, nodes: [], connections: [] },
    { input: 0, output: 0, score: -1, nodes: [], connections: [] },
  ];

  const elitists = makeElitists(population, 3);

  for (let i = 0; i < elitists.length; i++) {
    const e = elitists[i];
    assert(e, i + ") " + e);
  }

  assert(elitists.length == 2, "Should find three " + JSON.stringify(elitists));
  assert(elitists[0].score == -1, "Wrong elitism " + JSON.stringify(elitists));
  assert(elitists[1].score == -2, "Wrong elitism " + JSON.stringify(elitists));
});

Deno.test("backwards", () => {
  const population: NetworkInternal[] = [];
  for (let i = 0; i < 1000; i++) {
    population.push({
      input: 0,
      output: 0,
      score: i,
      nodes: [],
      connections: [],
    });
  }

  const elitists = makeElitists(population, 3);

  for (let i = 0; i < elitists.length; i++) {
    const e = elitists[i];
    assert(e, i + ") " + e);
  }

  assert(elitists.length == 3, "Should find three " + JSON.stringify(elitists));
  assert(elitists[0].score == 999, "Wrong elitism " + JSON.stringify(elitists));
  assert(elitists[1].score == 998, "Wrong elitism " + JSON.stringify(elitists));
  assert(elitists[2].score == 997, "Wrong elitism " + JSON.stringify(elitists));
});

Deno.test("forward", () => {
  const population: NetworkInternal[] = [];
  for (let i = 0; i < 1000; i++) {
    population.push({
      input: 0,
      output: 0,
      score: 1000 - i,
      nodes: [],
      connections: [],
    });
  }

  const elitists = makeElitists(population, 3);

  for (let i = 0; i < elitists.length; i++) {
    const e = elitists[i];
    assert(e, 1 + ") " + e);
  }

  assert(elitists.length == 3, "Should find three " + JSON.stringify(elitists));
  assert(
    elitists[0].score == 1000,
    "Wrong elitism " + JSON.stringify(elitists),
  );
  assert(elitists[1].score == 999, "Wrong elitism " + JSON.stringify(elitists));
  assert(elitists[2].score == 998, "Wrong elitism " + JSON.stringify(elitists));
});

Deno.test("performance", () => {
  const population: NetworkInternal[] = [];
  for (let i = 0; i < 100000; i++) {
    population.push({
      input: 0,
      output: 0,
      score: Math.random(),
      nodes: [],
      connections: [],
    });
  }
  let totalMS = 0;
  let minMS = Infinity;
  for (let j = 10; j--;) {
    performance.mark("start");
    const elitists = makeElitists(population, 3);

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
      "Should find three " + JSON.stringify(elitists),
    );
  }

  console.log("Average", totalMS / 10, " Minimum", minMS);
});

Deno.test("order", () => {
  const population: NetworkInternal[] = [];
  for (let i = 0; i < 1000; i++) {
    const v = Math.random();
    if (i % 11 == 0) {
      population.push({
        input: 0,
        output: 0,
        score: v,
        nodes: [],
        connections: [],
      });
    }
    population.push({
      input: 0,
      output: 0,
      score: v,
      nodes: [],
      connections: [],
    });
  }

  const elitists = makeElitists(population, 100);

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
    "Should find three " + JSON.stringify(elitists),
  );
});

Deno.test("NaN", () => {
  const population: NetworkInternal[] = [];

  population.push({
    input: 0,
    output: 0,
    score: NaN,
    nodes: [],
    connections: [],
  });

  population.push({
    input: 0,
    output: 0,
    score: undefined,
    nodes: [],
    connections: [],
  });

  population.push({
    input: 0,
    output: 0,
    score: -1,
    nodes: [],
    connections: [],
  });

  population.push({
    input: 0,
    output: 0,
    score: NaN,
    nodes: [],
    connections: [],
  });

  population.push({
    input: 0,
    output: 0,
    score: -Infinity,
    nodes: [],
    connections: [],
  });

  population.push({
    input: 0,
    output: 0,
    score: NaN,
    nodes: [],
    connections: [],
  });

  population.push({
    input: 0,
    output: 0,
    score: Infinity,
    nodes: [],
    connections: [],
  });

  population.push({
    input: 0,
    output: 0,
    score: NaN,
    nodes: [],
    connections: [],
  });

  population.push({
    input: 0,
    output: 0,
    score: 0,
    nodes: [],
    connections: [],
  });

  population.push({
    input: 0,
    output: 0,
    score: NaN,
    nodes: [],
    connections: [],
  });

  population.push({
    input: 0,
    output: 0,
    score: 1,
    nodes: [],
    connections: [],
  });

  population.push({
    input: 0,
    output: 0,
    score: NaN,
    nodes: [],
    connections: [],
  });

  const elitists = makeElitists(population, 3);

  assert(
    elitists.length == 3,
    "Should find three " + JSON.stringify(elitists),
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
