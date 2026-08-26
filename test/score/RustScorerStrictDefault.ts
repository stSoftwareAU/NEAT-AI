/**
 * `NEAT_AI_RUST_SCORER_STRICT` defaults to on (Issue #3864).
 *
 * Strict mode was opt-in from Issue #3815, so production defaulted to the
 * degrading path: a genuine scorer exec/parse failure logged a warning, fell
 * back to WASM, and reconciled to a green run — exactly what hid Issue #3810.
 * The default is now `true`, and `NEAT_AI_RUST_SCORER_STRICT=0` is the explicit
 * escape hatch for an operator who prefers a degraded run to a failed one.
 *
 * The resolver reads the real process environment, and `deno test --parallel`
 * shares one environment across every test file, so these cases resolve the
 * config in a child process with a cleared environment (Issue #3234). That also
 * makes the "unset" case genuinely unset whatever the parent lane exported —
 * `quality.sh` exports `1` on the native lane and `0` on the WASM lane.
 */
import { assertEquals } from "@std/assert";

/** `null` means the variable is absent; a string is its literal value. */
type StrictEnvCase = string | null;

/**
 * Resolve `getEnvRustScorerConfig().strict` once per case in a single child
 * process whose environment starts cleared. Mutating the environment is safe
 * there precisely because the process is disposable and single-threaded.
 *
 * @returns the resolved `strict` flag for each case, in order.
 */
async function strictForCases(cases: StrictEnvCase[]): Promise<boolean[]> {
  const code = `import {
  __resetRustScorerBridgeForTests,
  getEnvRustScorerConfig,
} from "./src/score/RustScorerBridge.ts";
const resolved = [];
for (const raw of ${JSON.stringify(cases)}) {
  if (raw === null) Deno.env.delete("NEAT_AI_RUST_SCORER_STRICT");
  else Deno.env.set("NEAT_AI_RUST_SCORER_STRICT", raw);
  __resetRustScorerBridgeForTests();
  resolved.push(getEnvRustScorerConfig().strict);
}
console.log(JSON.stringify(resolved));`;
  const passThrough: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "DENO_DIR", "TMPDIR"]) {
    const value = Deno.env.get(key);
    if (value !== undefined) passThrough[key] = value;
  }
  const command = new Deno.Command(Deno.execPath(), {
    args: ["eval", "--config", "./deno.json", code],
    env: passThrough,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  });
  const { code: status, stdout, stderr } = await command.output();
  const out = new TextDecoder().decode(stdout).trim();
  assertEquals(status, 0, `child failed: ${new TextDecoder().decode(stderr)}`);
  return JSON.parse(out.split("\n").at(-1)!);
}

Deno.test("getEnvRustScorerConfig: strict defaults on, and 0 opts back out", async () => {
  const [unset, explicitOff] = await strictForCases([null, "0"]);
  assertEquals(unset, true, "an operator who sets nothing gets loud failures");
  assertEquals(
    explicitOff,
    false,
    "NEAT_AI_RUST_SCORER_STRICT=0 still degrades to WASM",
  );
});

Deno.test("getEnvRustScorerConfig: only a false-like value opts out of strict", async () => {
  const offCases = ["0", "false", "FALSE", "no", " No "];
  // Unparseable and empty values are not an opt-out: they fall through to the
  // default rather than silently disabling the gate.
  const onCases = ["1", "true", "yes", "", "   ", "maybe"];
  const resolved = await strictForCases([...offCases, ...onCases]);

  assertEquals(
    resolved.slice(0, offCases.length),
    offCases.map(() => false),
    `each of ${JSON.stringify(offCases)} must turn strict off`,
  );
  assertEquals(
    resolved.slice(offCases.length),
    onCases.map(() => true),
    `each of ${JSON.stringify(onCases)} must leave strict on`,
  );
});
