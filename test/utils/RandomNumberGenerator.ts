import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import {
  createSeededRng,
  createUnseededRng,
  getRandomNumberGenerator,
  type RandomNumberGenerator,
  setRandomNumberGenerator,
} from "../../src/utils/RandomNumberGenerator.ts";

Deno.test("SeededRng: same seed produces same sequence", () => {
  const rng1 = createSeededRng(42);
  const rng2 = createSeededRng(42);

  const seq1 = Array.from({ length: 100 }, () => rng1.random());
  const seq2 = Array.from({ length: 100 }, () => rng2.random());

  assertEquals(seq1, seq2);
});

Deno.test("SeededRng: different seeds produce different sequences", () => {
  const rng1 = createSeededRng(42);
  const rng2 = createSeededRng(123);

  const seq1 = Array.from({ length: 10 }, () => rng1.random());
  const seq2 = Array.from({ length: 10 }, () => rng2.random());

  assertNotEquals(seq1, seq2);
});

Deno.test("SeededRng: random() returns values in [0, 1)", () => {
  const rng = createSeededRng(7);
  for (let i = 0; i < 10000; i++) {
    const v = rng.random();
    assert(v >= 0, `Expected >= 0, got ${v}`);
    assert(v < 1, `Expected < 1, got ${v}`);
  }
});

Deno.test("SeededRng: randomInt returns values in range", () => {
  const rng = createSeededRng(99);
  for (let i = 0; i < 1000; i++) {
    const v = rng.randomInt(3, 7);
    assert(v >= 3, `Expected >= 3, got ${v}`);
    assert(v <= 7, `Expected <= 7, got ${v}`);
    assertEquals(v, Math.floor(v), "Expected integer");
  }
});

Deno.test("SeededRng: randomInt covers all values in range", () => {
  const rng = createSeededRng(55);
  const seen = new Set<number>();
  for (let i = 0; i < 1000; i++) {
    seen.add(rng.randomInt(0, 4));
  }
  assertEquals(seen.size, 5, "Expected all values 0-4 to be covered");
});

Deno.test("SeededRng: choice returns elements from array", () => {
  const rng = createSeededRng(123);
  const items = ["apple", "banana", "cherry"];
  for (let i = 0; i < 100; i++) {
    const picked = rng.choice(items);
    assert(items.includes(picked), `Unexpected choice: ${picked}`);
  }
});

Deno.test("SeededRng: choice throws on empty array", () => {
  const rng = createSeededRng(1);
  assertThrows(
    () => rng.choice([]),
    Error,
    "Cannot choose from an empty array",
  );
});

Deno.test("SeededRng: seeded property is true", () => {
  const rng = createSeededRng(42);
  assertEquals(rng.seeded, true);
});

Deno.test("UnseededRng: seeded property is false", () => {
  const rng = createUnseededRng();
  assertEquals(rng.seeded, false);
});

Deno.test("UnseededRng: random() returns values in [0, 1)", () => {
  const rng = createUnseededRng();
  for (let i = 0; i < 1000; i++) {
    const v = rng.random();
    assert(v >= 0, `Expected >= 0, got ${v}`);
    assert(v < 1, `Expected < 1, got ${v}`);
  }
});

Deno.test("UnseededRng: randomInt returns values in range", () => {
  const rng = createUnseededRng();
  for (let i = 0; i < 1000; i++) {
    const v = rng.randomInt(0, 9);
    assert(v >= 0 && v <= 9, `Out of range: ${v}`);
    assertEquals(v, Math.floor(v), "Expected integer");
  }
});

Deno.test("Global RNG: get/set round-trip", () => {
  const original = getRandomNumberGenerator();
  const custom = createSeededRng(42);
  setRandomNumberGenerator(custom);

  assertEquals(getRandomNumberGenerator(), custom);

  // Restore original
  setRandomNumberGenerator(original);
});

Deno.test("SeededRng: reproducible choice sequence", () => {
  const items = [10, 20, 30, 40, 50];
  const rng1 = createSeededRng(777);
  const rng2 = createSeededRng(777);

  const seq1 = Array.from({ length: 50 }, () => rng1.choice(items));
  const seq2 = Array.from({ length: 50 }, () => rng2.choice(items));

  assertEquals(seq1, seq2);
});

Deno.test("SeededRng: seed 0 treated as valid", () => {
  const rng = createSeededRng(0);
  // Should not throw; seed 0 is handled gracefully
  const v = rng.random();
  assert(v >= 0 && v < 1, `Expected [0, 1), got ${v}`);
});

Deno.test("SeededRng: large seed value", () => {
  const rng = createSeededRng(Number.MAX_SAFE_INTEGER);
  const v = rng.random();
  assert(v >= 0 && v < 1, `Expected [0, 1), got ${v}`);
});

Deno.test("SeededRng: generates diverse values (not stuck)", () => {
  const rng = createSeededRng(42);
  const values = new Set<number>();
  for (let i = 0; i < 100; i++) {
    values.add(rng.random());
  }
  assert(
    values.size > 90,
    `Expected diversity, got ${values.size} unique values`,
  );
});

Deno.test("SeededRng: uniform distribution (chi-squared)", () => {
  const rng = createSeededRng(42);
  const buckets = 10;
  const counts = new Array(buckets).fill(0);
  const n = 10000;

  for (let i = 0; i < n; i++) {
    const bucket = Math.min(Math.floor(rng.random() * buckets), buckets - 1);
    counts[bucket]++;
  }

  // Chi-squared test: expected count per bucket = n / buckets
  const expected = n / buckets;
  let chiSquared = 0;
  for (let i = 0; i < buckets; i++) {
    chiSquared += (counts[i] - expected) ** 2 / expected;
  }

  // Critical value for 9 degrees of freedom at p=0.01 is ~21.67
  assert(
    chiSquared < 25,
    `Chi-squared ${chiSquared} too high (distribution not uniform)`,
  );
});

Deno.test("SeededRng: randomInt min equals max", () => {
  const rng = createSeededRng(1);
  for (let i = 0; i < 10; i++) {
    assertEquals(rng.randomInt(5, 5), 5);
  }
});

Deno.test("SeededRng: choice with single element", () => {
  const rng = createSeededRng(1);
  assertEquals(rng.choice(["only"]), "only");
});

Deno.test("Global RNG: default is unseeded", () => {
  // Reset to default
  const rng = createUnseededRng();
  setRandomNumberGenerator(rng);
  assertEquals(getRandomNumberGenerator().seeded, false);
});

Deno.test("SeededRng: interleaved operations are reproducible", () => {
  const items = ["a", "b", "c", "d"];

  function runSequence(rng: RandomNumberGenerator): string[] {
    const results: string[] = [];
    results.push(String(rng.random()));
    results.push(String(rng.randomInt(0, 100)));
    results.push(rng.choice(items));
    results.push(String(rng.random()));
    results.push(String(rng.randomInt(-10, 10)));
    results.push(rng.choice(items));
    return results;
  }

  const seq1 = runSequence(createSeededRng(42));
  const seq2 = runSequence(createSeededRng(42));
  assertEquals(seq1, seq2);
});
