/**
 * `NEAT_AI_RUST_SCORER_STRICT=0` is a retired opt-out and fails loud
 * (Issues #3864, #3871).
 *
 * Strict mode was opt-in from Issue #3815, so production defaulted to the
 * degrading path: a genuine scorer exec/parse failure logged a warning, fell
 * back to WASM, and reconciled to a green run — exactly what hid Issue #3810.
 * Issue #3864 flipped the default; Issue #3871 deleted the degrading path
 * altogether, so there is nothing left for the variable to select.
 *
 * Ignoring the stale setting would be the same class of masked fault: an
 * operator who asked for a degraded run instead of a failed one would get
 * failed runs with no explanation. So a false-like value raises a
 * `ConfigurationError` naming the removal, while every other value — including
 * `1`, an empty string and an unparseable one — resolves unchanged.
 *
 * The resolver reads the real process environment, and `deno test --parallel`
 * shares one environment across every test file, so these cases resolve the
 * config in a child process with a cleared environment (Issue #3234). That also
 * makes the "unset" case genuinely unset whatever the parent lane exported.
 */
import { assert, assertEquals } from "@std/assert";

/** `null` means the variable is absent; a string is its literal value. */
type StrictEnvCase = string | null;

/** Per-case outcome: the config resolved, or the error message it raised. */
type StrictOutcome = { ok: true } | { ok: false; message: string };

/**
 * Resolve `getEnvRustScorerConfig()` once per case in a single child process
 * whose environment starts cleared. Mutating the environment is safe there
 * precisely because the process is disposable and single-threaded.
 *
 * @param cases - Values to export for `NEAT_AI_RUST_SCORER_STRICT`, in order.
 * @returns One outcome per case, in the same order.
 */
async function resolveForCases(
  cases: StrictEnvCase[],
): Promise<StrictOutcome[]> {
  const code = `import {
  __resetRustScorerBridgeForTests,
  getEnvRustScorerConfig,
} from "./src/score/RustScorerBridge.ts";
const resolved = [];
for (const raw of ${JSON.stringify(cases)}) {
  if (raw === null) Deno.env.delete("NEAT_AI_RUST_SCORER_STRICT");
  else Deno.env.set("NEAT_AI_RUST_SCORER_STRICT", raw);
  __resetRustScorerBridgeForTests();
  try {
    getEnvRustScorerConfig();
    resolved.push({ ok: true });
  } catch (error) {
    resolved.push({
      ok: false,
      message: error instanceof Error
        ? \`\${error.name}: \${error.message}\`
        : String(error),
    });
  }
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

Deno.test("getEnvRustScorerConfig: unset resolves, STRICT=0 is rejected", async () => {
  const [unset, explicitOff] = await resolveForCases([null, "0"]);
  assertEquals(unset, { ok: true }, "an operator who sets nothing is fine");
  assert(!explicitOff.ok, "NEAT_AI_RUST_SCORER_STRICT=0 must not be ignored");
  assert(
    explicitOff.message.includes("ConfigurationError") &&
      explicitOff.message.includes("#3871"),
    `the refusal must name the removal; got: ${explicitOff.message}`,
  );
});

Deno.test("getEnvRustScorerConfig: only a false-like value is refused", async () => {
  const offCases = ["0", "false", "FALSE", "no", " No "];
  // Unparseable and empty values were never an opt-out, so they must keep
  // resolving rather than becoming a new startup failure.
  const okCases = ["1", "true", "yes", "", "   ", "maybe"];
  const resolved = await resolveForCases([...offCases, ...okCases]);

  assertEquals(
    resolved.slice(0, offCases.length).map((r) => r.ok),
    offCases.map(() => false),
    `each of ${JSON.stringify(offCases)} must be refused`,
  );
  assertEquals(
    resolved.slice(offCases.length),
    okCases.map(() => ({ ok: true })),
    `each of ${JSON.stringify(okCases)} must still resolve`,
  );
});
