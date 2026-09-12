/**
 * The `--race-stdio` streaming client (Issue #3928).
 *
 * The one-shot scorer runner cannot drive racing: the scorer blocks after each
 * chunk waiting for a verdict, so stdout must be consumed as it arrives. These
 * tests exercise the real subprocess path against a stand-in scorer written to
 * a temp file, so the conversation — chunk in, verdict out, result map at the
 * end — is proven against an actual process rather than a stub.
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  encodeVerdict,
  getRacingSessionRunner,
  parseRacingLine,
  type RacingChunkEvent,
} from "../../src/score/RacingScorerSession.ts";
import type { RacingVerdict } from "../../src/score/RacingPolicy.ts";

/**
 * A stand-in scorer speaking the protocol: publishes `chunks` chunk events,
 * drops any creature a verdict abandons, then prints the result map.
 *
 * Written to a temp file rather than committed under `test/` so the test
 * runner never imports it (it blocks on stdin by design).
 */
const FAKE_SCORER = `
const keys = ["alpha", "beta", "gamma"];
const active = new Set(keys);
const records = new Map(keys.map((k) => [k, 0]));
const errors = new Map([["alpha", 0.1], ["beta", 0.5], ["gamma", 0.9]]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const reader = Deno.stdin.readable.getReader();
let buffered = "";

async function readVerdict() {
  while (!buffered.includes("\\n")) {
    const { value, done } = await reader.read();
    if (done) {
      console.error("verdict stream closed");
      Deno.exit(3);
    }
    buffered += decoder.decode(value);
  }
  const newline = buffered.indexOf("\\n");
  const line = buffered.slice(0, newline);
  buffered = buffered.slice(newline + 1);
  return JSON.parse(line);
}

for (let chunk = 1; chunk <= 4 && active.size > 0; chunk++) {
  for (const key of active) records.set(key, chunk * 250);
  const partials = keys
    .filter((k) => active.has(k))
    .map((k) => ({
      index: keys.indexOf(k),
      key: k,
      partialError: errors.get(k),
      recordsScored: records.get(k),
    }));
  await Deno.stdout.write(encoder.encode(
    JSON.stringify({ racing: "chunk", chunk, partials }) + "\\n",
  ));
  const verdict = await readVerdict();
  if (verdict.verdict === "abortAll") break;
  if (verdict.verdict === "abort") {
    for (const index of verdict.creatures) active.delete(keys[index]);
  }
}

const results = {};
for (const key of keys) {
  results[key] = {
    score: 1 - errors.get(key),
    error: errors.get(key),
    recordCount: records.get(key),
  };
}
console.log(JSON.stringify(results, null, 2));
`;

/** A stand-in scorer that dies before publishing anything. */
const FAILING_SCORER = `
console.error("Error: corpus is not a directory");
Deno.exit(1);
`;

async function withFakeScorer(
  source: string,
  run: (path: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "racing-session-" });
  const path = `${dir}/fake_scorer.ts`;
  await Deno.writeTextFile(path, source);
  try {
    await run(path);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("RacingScorerSession - parses chunk events and passes result lines through", () => {
  const event = parseRacingLine(
    '{"racing":"chunk","chunk":2,"partials":[{"index":1,"key":"b","partialError":0.5,"recordsScored":10}]}',
  );
  assert(event !== undefined);
  assertEquals(event.chunk, 2);
  assertEquals(event.partials[0].key, "b");
  assertEquals(event.partials[0].recordsScored, 10);
  assertEquals(
    parseRacingLine('{"creature-1":{"score":0.9,"error":0.1}}'),
    undefined,
    "result JSON is not a chunk event",
  );
  assertEquals(parseRacingLine("   "), undefined);
});

Deno.test("RacingScorerSession - a corrupt chunk event is a fault, not result data", () => {
  assertThrows(
    () => parseRacingLine('{"racing":"chunk", oops'),
    Error,
    "unparseable chunk event",
  );
  assertThrows(
    () => parseRacingLine('{"racing":"other"}'),
    Error,
    "unexpected shape",
  );
});

Deno.test("RacingScorerSession - encodes one verdict per line", () => {
  const verdicts: RacingVerdict[] = [
    { verdict: "continue" },
    { verdict: "abort", creatures: [1, 2] },
    { verdict: "abortAll" },
  ];
  const encoded = verdicts.map(encodeVerdict);
  assertEquals(encoded[0], '{"verdict":"continue"}\n');
  assertEquals(encoded[1], '{"verdict":"abort","creatures":[1,2]}\n');
  assertEquals(encoded[2], '{"verdict":"abortAll"}\n');
});

Deno.test("RacingScorerSession - drives a real subprocess conversation", async () => {
  await withFakeScorer(FAKE_SCORER, async (path) => {
    const seen: RacingChunkEvent[] = [];
    const result = await getRacingSessionRunner()({
      binaryPath: Deno.execPath(),
      args: ["run", "--allow-all", path],
      timeoutMs: 30_000,
      onChunk: (event) => {
        seen.push(event);
        // Abandon "gamma" on the first chunk, then let the rest run.
        if (event.chunk === 1) return { verdict: "abort", creatures: [2] };
        return { verdict: "continue" };
      },
    });

    assert(result.success, `session failed: ${result.stderr}`);
    assertEquals(result.chunks, 4);
    assertEquals(seen[0].partials.length, 3);
    assertEquals(
      seen[1].partials.length,
      2,
      "an abandoned creature must not reappear in later chunks",
    );
    // Everything that was not a chunk event is the scorer's result map, and it
    // must survive verbatim for the existing reconciler to parse.
    const parsed = JSON.parse(result.stdout) as Record<
      string,
      { recordCount: number }
    >;
    assertEquals(parsed["alpha"].recordCount, 1000);
    assertEquals(parsed["beta"].recordCount, 1000);
    assertEquals(
      parsed["gamma"].recordCount,
      250,
      "the abandoned creature freezes at its partial record count",
    );
  });
});

Deno.test("RacingScorerSession - abortAll stops the conversation after one chunk", async () => {
  await withFakeScorer(FAKE_SCORER, async (path) => {
    const result = await getRacingSessionRunner()({
      binaryPath: Deno.execPath(),
      args: ["run", "--allow-all", path],
      timeoutMs: 30_000,
      onChunk: () => ({ verdict: "abortAll" }),
    });
    assert(result.success, `session failed: ${result.stderr}`);
    assertEquals(result.chunks, 1);
    const parsed = JSON.parse(result.stdout) as Record<
      string,
      { recordCount: number }
    >;
    assertEquals(parsed["alpha"].recordCount, 250);
  });
});

Deno.test("RacingScorerSession - a failing scorer surfaces its exit code and stderr", async () => {
  await withFakeScorer(FAILING_SCORER, async (path) => {
    const result = await getRacingSessionRunner()({
      binaryPath: Deno.execPath(),
      args: ["run", "--allow-all", path],
      timeoutMs: 30_000,
      onChunk: () => ({ verdict: "continue" }),
    });
    assertEquals(result.success, false);
    assertEquals(result.code, 1);
    assert(
      result.stderr.includes("corpus is not a directory"),
      `stderr must be carried verbatim, got: ${result.stderr}`,
    );
  });
});

Deno.test("RacingScorerSession - a hung scorer is killed at the timeout", async () => {
  await withFakeScorer(
    "await new Promise((resolve) => setTimeout(resolve, 60_000));\n",
    async (path) => {
      await assertRejects(
        () =>
          getRacingSessionRunner()({
            binaryPath: Deno.execPath(),
            args: ["run", "--allow-all", path],
            timeoutMs: 250,
            onChunk: () => ({ verdict: "continue" }),
          }),
        Error,
        "timeout",
      );
    },
  );
});
