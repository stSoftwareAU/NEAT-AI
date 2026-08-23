import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs";

/**
 * Tests for quality.sh flag parsing and behaviour.
 *
 * These tests invoke quality.sh with --dry-run to verify flag parsing
 * without actually running the quality steps.
 */

/**
 * Copy quality.sh into a fresh directory and return that directory.
 *
 * A full quality.sh run (no --dry-run, no --lint-only) reaches the
 * type-check step, which runs `rm -rf .trace .test .coverage`. Executed with
 * the repository as its working directory that deletes the shared scratch
 * trees other test files are writing to in parallel, so those files fail with
 * `NotFound: writefile '.trace/...'`. Spawning the script from its own
 * directory keeps the deletion inside the temporary tree.
 */
async function isolatedQualityDir(prefix: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix });
  await Deno.copyFile("./quality.sh", `${dir}/quality.sh`);
  await Deno.chmod(`${dir}/quality.sh`, 0o755);
  return dir;
}

/** Helper to run quality.sh with given args and return stdout + exit code. */
async function runQuality(
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  const command = new Deno.Command("bash", {
    args: ["./quality.sh", ...args],
    stdout: "piped",
    stderr: "piped",
    cwd: Deno.cwd(),
  });
  const output = await command.output();
  return {
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
    code: output.code,
  };
}

Deno.test(
  {
    name: "quality.sh --help prints usage and exits 0",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--help"]);
      assertEquals(result.code, 0, "Expected exit code 0 for --help");
      assert(
        result.stdout.includes("Usage:"),
        "Expected help output to contain 'Usage:'",
      );
      assert(
        result.stdout.includes("--help"),
        "Expected help output to mention --help flag",
      );
      assert(
        result.stdout.includes("--skip-tests"),
        "Expected help output to mention --skip-tests flag",
      );
      assert(
        result.stdout.includes("--skip-discovery"),
        "Expected help output to mention --skip-discovery flag",
      );
      assert(
        result.stdout.includes("--lint-only"),
        "Expected help output to mention --lint-only flag",
      );
      assert(
        result.stdout.includes("--native-core-backprop"),
        "Expected help output to mention --native-core-backprop flag",
      );
      assert(
        result.stdout.includes("--check-only"),
        "Expected help output to mention --check-only flag",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh -h prints usage and exits 0",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["-h"]);
      assertEquals(result.code, 0, "Expected exit code 0 for -h");
      assert(
        result.stdout.includes("Usage:"),
        "Expected help output to contain 'Usage:'",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --dry-run shows steps without executing them",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--dry-run"]);
      assertEquals(result.code, 0, "Expected exit code 0 for --dry-run");
      assert(
        result.stdout.includes("[1/"),
        "Expected step numbering in output",
      );
      assert(
        result.stdout.includes("DRY RUN"),
        "Expected dry run indicator in output",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --dry-run --skip-tests omits test step",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--dry-run", "--skip-tests"]);
      assertEquals(result.code, 0);
      assert(
        !result.stdout.includes("Running tests"),
        "Expected test step to be skipped",
      );
      assert(
        result.stdout.includes("Formatting"),
        "Expected format step to be present",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --dry-run --skip-discovery omits discovery steps",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--dry-run", "--skip-discovery"]);
      assertEquals(result.code, 0);
      assert(
        !result.stdout.includes("Building discovery"),
        "Expected discovery build step to be skipped",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --dry-run --lint-only only shows fmt and lint steps",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--dry-run", "--lint-only"]);
      assertEquals(result.code, 0);
      assert(
        result.stdout.includes("Formatting"),
        "Expected format step",
      );
      assert(
        result.stdout.includes("Linting"),
        "Expected lint step",
      );
      assert(
        !result.stdout.includes("Type-checking"),
        "Expected type-check to be excluded in lint-only mode",
      );
      assert(
        !result.stdout.includes("Running tests"),
        "Expected tests to be excluded in lint-only mode",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --dry-run --check-only only shows type-check step",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--dry-run", "--check-only"]);
      assertEquals(result.code, 0);
      assert(
        result.stdout.includes("Type-checking"),
        "Expected type-check step",
      );
      assert(
        !result.stdout.includes("Formatting"),
        "Expected format to be excluded in check-only mode",
      );
      assert(
        !result.stdout.includes("Running tests"),
        "Expected tests to be excluded in check-only mode",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh rejects unknown flags",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--unknown-flag"]);
      assert(result.code !== 0, "Expected non-zero exit code for unknown flag");
      assert(
        result.stderr.includes("Unknown option"),
        "Expected error message about unknown option",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --dry-run --skip-tests --skip-discovery combines skips",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality([
        "--dry-run",
        "--skip-tests",
        "--skip-discovery",
      ]);
      assertEquals(result.code, 0);
      assert(
        !result.stdout.includes("Running tests"),
        "Expected tests to be skipped",
      );
      assert(
        !result.stdout.includes("Building discovery"),
        "Expected discovery to be skipped",
      );
      assert(
        result.stdout.includes("Formatting"),
        "Expected format step to remain",
      );
      assert(
        result.stdout.includes("Type-checking"),
        "Expected type-check step to remain",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --help output documents exit codes",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--help"]);
      assert(
        result.stdout.includes("Exit codes"),
        "Expected help to document exit codes",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --help documents DENO_JOBS RAM sizing",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--help"]);
      assertEquals(result.code, 0);
      assert(
        result.stdout.includes("DENO_JOBS"),
        "Expected help to document DENO_JOBS",
      );
      assert(
        result.stdout.includes("NEAT_AI_TEST_HEAP_MB"),
        "Expected help to document NEAT_AI_TEST_HEAP_MB",
      );
      assert(
        result.stdout.includes("QUALITY_TRACE_LEAKS"),
        "Expected help to document QUALITY_TRACE_LEAKS",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --dry-run prints the V8 heap and DENO_JOBS product",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--dry-run"]);
      assertEquals(result.code, 0);
      assert(
        /V8 heap \d+ MB × DENO_JOBS=\d+/.test(result.stdout),
        `Expected dry-run to print heap × jobs; stdout=${result.stdout}`,
      );
      assert(
        /leak tracing: (on|off)/.test(result.stdout),
        "Expected dry-run to print leak-tracing state",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --dry-run shows progress numbering",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--dry-run"]);
      assertEquals(result.code, 0);
      const stepPattern = /\[\d+\/\d+\]/;
      assert(
        stepPattern.test(result.stdout),
        "Expected [N/M] step numbering format in output",
      );
    },
  },
);

Deno.test(
  {
    name:
      "quality.sh --help documents fail-loud native scorer and backprop gates",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--help"]);
      assertEquals(result.code, 0);
      assert(
        result.stdout.includes("Native gates"),
        "Expected help to document native gates",
      );
      assert(
        result.stdout.includes("no silent WASM fallback"),
        `Expected fail-loud wording in help; got: ${result.stdout}`,
      );
      assert(
        result.stdout.includes("rust_scorer is required"),
        "Expected help to say rust_scorer is required by default",
      );
      assert(
        result.stdout.includes("NEAT_SCORER_GPU=off"),
        "Expected help to document GPU-off for rust_scorer test runs",
      );
      assert(
        result.stdout.includes("NEAT_AI_TEST_HEAP_MB"),
        "Expected help to document the V8 heap override",
      );
      assert(
        result.stdout.includes("DENO_JOBS"),
        "Expected help to document host-sized DENO_JOBS",
      );
      assert(
        result.stdout.includes("8192"),
        "Expected help to document the 8192 MB heap the suite needs",
      );
      assert(
        result.stdout.includes("NEAT_AI_IN_FLIGHT_DIR"),
        "Expected help to document in-flight test name files",
      );
      assert(
        result.stdout.includes(".quality-in-flight"),
        "Expected help to name the default in-flight directory",
      );
      assert(
        result.stdout.includes("--native-core-backprop"),
        "Expected help to document the libneat_core CLI opt-in",
      );
    },
  },
);

Deno.test(
  {
    name: "quality.sh --dry-run --wasm-scorer does not build rust_scorer",
    permissions: { run: true, read: true },
    fn: async () => {
      const result = await runQuality(["--dry-run", "--wasm-scorer"]);
      assertEquals(result.code, 0);
      assert(
        result.stdout.includes("WASM scorer mode"),
        "Expected WASM scorer test step",
      );
      assert(
        !result.stdout.includes("Building rust_scorer"),
        "WASM comparison run must not require rust_scorer",
      );
    },
  },
);

Deno.test(
  {
    name:
      "quality.sh fails loud when rust_scorer is missing (no WASM fallback)",
    permissions: { run: true, read: true, write: true, env: true },
    fn: async () => {
      const tmp = await Deno.makeTempDir({ prefix: "neat-quality-scorer-" });
      try {
        await Deno.copyFile("./quality.sh", `${tmp}/quality.sh`);
        await Deno.chmod(`${tmp}/quality.sh`, 0o755);
        const command = new Deno.Command("bash", {
          args: ["./quality.sh"],
          stdout: "piped",
          stderr: "piped",
          cwd: tmp,
          env: {
            PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
            HOME: tmp,
            NEAT_AI_RUST_SCORER_BINARY_PATH: "/nonexistent/rust_scorer",
          },
        });
        const output = await command.output();
        assert(
          output.code !== 0,
          "quality.sh must fail when rust_scorer cannot be resolved",
        );
        const stderr = new TextDecoder().decode(output.stderr);
        assert(
          stderr.includes("rust_scorer is required") &&
            stderr.includes("will not silently fall back"),
          `Expected fail-loud rust_scorer error; got: ${stderr}`,
        );
      } finally {
        await Deno.remove(tmp, { recursive: true });
      }
    },
  },
);

Deno.test(
  {
    name:
      "quality.sh --next fails loud when libneat_ai_backpropagation is missing (no CLI/WASM fallback)",
    permissions: { run: true, read: true, write: true, env: true },
    fn: async () => {
      const tmp = await Deno.makeTempDir({ prefix: "neat-quality-backprop-" });
      try {
        await Deno.copyFile("./quality.sh", `${tmp}/quality.sh`);
        await Deno.chmod(`${tmp}/quality.sh`, 0o755);
        const command = new Deno.Command("bash", {
          args: ["./quality.sh", "--next", "--wasm-scorer"],
          stdout: "piped",
          stderr: "piped",
          cwd: tmp,
          env: {
            PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
            HOME: tmp,
            NEAT_AI_BACKPROP_LIB_PATH:
              "/nonexistent/libneat_ai_backpropagation.dylib",
            NEAT_AI_BACKPROP_BINARY_PATH:
              "/nonexistent/neat_ai_backpropagation",
          },
        });
        const output = await command.output();
        assert(
          output.code !== 0,
          "quality.sh --next must fail when libneat_ai_backpropagation cannot be resolved",
        );
        const stderr = new TextDecoder().decode(output.stderr);
        assert(
          stderr.includes("libneat_ai_backpropagation was requested") &&
            stderr.includes("will not silently fall back"),
          `Expected fail-loud FFI trainDir error; got: ${stderr}`,
        );
      } finally {
        await Deno.remove(tmp, { recursive: true });
      }
    },
  },
);

Deno.test({
  name: "quality.sh rust-scorer tests set NEAT_SCORER_GPU=off (no Metal OOM)",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const home = await Deno.makeTempDir({ prefix: "neat-quality-gpu-off-" });
    const workDir = await isolatedQualityDir("neat-quality-gpu-off-work-");
    try {
      const binDir = `${home}/.deno/bin`;
      await Deno.mkdir(binDir, { recursive: true });
      const callLog = `${home}/deno-calls.log`;
      await Deno.writeTextFile(
        `${binDir}/deno`,
        `#!/usr/bin/env bash\nprintf 'NEAT_SCORER_GPU=%s argv:%s\\n' "\${NEAT_SCORER_GPU-<unset>}" "$*" >> "${callLog}"\nexit 0\n`,
      );
      await Deno.chmod(`${binDir}/deno`, 0o755);

      const fakeScorer = `${home}/rust_scorer`;
      await Deno.writeTextFile(
        fakeScorer,
        "#!/usr/bin/env bash\nexit 0\n",
      );
      await Deno.chmod(fakeScorer, 0o755);

      const command = new Deno.Command("bash", {
        args: [
          "./quality.sh",
          `--rust-scorer-bin=${fakeScorer}`,
          "--skip-discovery",
          "--skip-wasm",
        ],
        stdout: "piped",
        stderr: "piped",
        cwd: workDir,
        env: {
          PATH: Deno.env.get("PATH") ?? "",
          HOME: home,
        },
      });
      const output = await command.output();
      assertEquals(
        output.code,
        0,
        `quality.sh must succeed with the shim; stderr=${
          new TextDecoder().decode(output.stderr)
        }`,
      );

      const calls = (await Deno.readTextFile(callLog))
        .split("\n")
        .filter((l) => l.trim().length > 0);
      const testCall = calls.find((l) => l.includes("argv:test "));
      assert(
        testCall !== undefined,
        `expected a 'deno test' invocation; got: ${JSON.stringify(calls)}`,
      );
      assert(
        testCall.startsWith("NEAT_SCORER_GPU=off"),
        `rust_scorer test runs must force GPU off; got: ${testCall}`,
      );
    } finally {
      await Deno.remove(home, { recursive: true });
      await Deno.remove(workDir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "quality.sh --dry-run --wasm-scorer ignores leftover native backprop env",
  permissions: { run: true, read: true, env: true },
  fn: async () => {
    const command = new Deno.Command("bash", {
      args: ["./quality.sh", "--dry-run", "--wasm-scorer"],
      stdout: "piped",
      stderr: "piped",
      cwd: Deno.cwd(),
      env: {
        ...Deno.env.toObject(),
        NEAT_AI_NATIVE_CORE_BACKPROP: "1",
        NEAT_AI_BACKPROP_ENABLED: "1",
      },
    });
    const output = await command.output();
    const stdout = new TextDecoder().decode(output.stdout);
    assertEquals(
      output.code,
      0,
      `stderr=${new TextDecoder().decode(output.stderr)}`,
    );
    assert(
      stdout.includes("WASM scorer mode"),
      "Expected WASM scorer test step",
    );
    assert(
      !stdout.includes("Building native neat-core") &&
        !stdout.includes("Verifying native neat-core") &&
        !stdout.includes("Building native neat_ai_backpropagation") &&
        !stdout.includes("Verifying native neat_ai_backpropagation"),
      `WASM comparison run must not load leftover native backprop; got: ${stdout}`,
    );
  },
});

Deno.test({
  name:
    "quality.sh --wasm-scorer forces native backprop off and honours NEAT_AI_TEST_HEAP_MB",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const home = await Deno.makeTempDir({ prefix: "neat-quality-wasm-heap-" });
    const workDir = await isolatedQualityDir("neat-quality-wasm-heap-work-");
    try {
      const binDir = `${home}/.deno/bin`;
      await Deno.mkdir(binDir, { recursive: true });
      const callLog = `${home}/deno-calls.log`;
      await Deno.writeTextFile(
        `${binDir}/deno`,
        `#!/usr/bin/env bash
printf 'NEAT_AI_NATIVE_CORE_BACKPROP=%s NEAT_AI_BACKPROP_ENABLED=%s argv:%s\\n' \\
  "\${NEAT_AI_NATIVE_CORE_BACKPROP-<unset>}" \\
  "\${NEAT_AI_BACKPROP_ENABLED-<unset>}" \\
  "$*" >> "${callLog}"
exit 0
`,
      );
      await Deno.chmod(`${binDir}/deno`, 0o755);

      const command = new Deno.Command("bash", {
        args: [
          "./quality.sh",
          "--wasm-scorer",
          "--skip-discovery",
          "--skip-wasm",
        ],
        stdout: "piped",
        stderr: "piped",
        cwd: workDir,
        env: {
          PATH: Deno.env.get("PATH") ?? "",
          HOME: home,
          DENO_JOBS: "2",
          NEAT_AI_TEST_HEAP_MB: "2048",
          NEAT_AI_NATIVE_CORE_BACKPROP: "1",
          NEAT_AI_BACKPROP_ENABLED: "1",
        },
      });
      const output = await command.output();
      assertEquals(
        output.code,
        0,
        `quality.sh must succeed with the shim; stderr=${
          new TextDecoder().decode(output.stderr)
        }`,
      );

      const calls = (await Deno.readTextFile(callLog))
        .split("\n")
        .filter((l) => l.trim().length > 0);
      const testCall = calls.find((l) => l.includes("argv:test "));
      assert(
        testCall !== undefined,
        `expected a 'deno test' invocation; got: ${JSON.stringify(calls)}`,
      );
      assert(
        testCall.includes("NEAT_AI_NATIVE_CORE_BACKPROP=0"),
        `--wasm-scorer must force native backprop off; got: ${testCall}`,
      );
      assert(
        testCall.includes("NEAT_AI_BACKPROP_ENABLED=0"),
        `--wasm-scorer must force trainDir native backprop off; got: ${testCall}`,
      );
      assert(
        testCall.includes("--max-old-space-size=2048"),
        `NEAT_AI_TEST_HEAP_MB must reach deno test; got: ${testCall}`,
      );
    } finally {
      await Deno.remove(home, { recursive: true });
      await Deno.remove(workDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "quality.sh scratch cleanup cannot escape its working directory",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    // PR #3833 — the type-check step runs `rm -rf .trace .test .coverage`.
    // Spawned with the repository as its cwd it deleted the scratch trees
    // that other test files write to in parallel, so those files failed with
    // `NotFound: writefile '.trace/...'`. The deletion must stay inside the
    // directory the script runs from.
    const home = await Deno.makeTempDir({ prefix: "neat-quality-scratch-" });
    const workDir = await isolatedQualityDir("neat-quality-scratch-work-");
    const neighbour = await Deno.makeTempDir({
      prefix: "neat-quality-scratch-neighbour-",
    });
    try {
      const binDir = `${home}/.deno/bin`;
      await Deno.mkdir(binDir, { recursive: true });
      await Deno.writeTextFile(
        `${binDir}/deno`,
        "#!/usr/bin/env bash\nexit 0\n",
      );
      await Deno.chmod(`${binDir}/deno`, 0o755);

      await Deno.mkdir(`${workDir}/.trace`, { recursive: true });
      await Deno.writeTextFile(`${workDir}/.trace/sentinel.json`, "{}");
      await Deno.mkdir(`${neighbour}/.trace`, { recursive: true });
      await Deno.writeTextFile(`${neighbour}/.trace/sentinel.json`, "{}");

      const command = new Deno.Command("bash", {
        args: ["./quality.sh", "--check-only"],
        stdout: "piped",
        stderr: "piped",
        cwd: workDir,
        env: { PATH: Deno.env.get("PATH") ?? "", HOME: home },
      });
      const output = await command.output();
      assertEquals(
        output.code,
        0,
        `quality.sh --check-only must succeed with the shim; stderr=${
          new TextDecoder().decode(output.stderr)
        }`,
      );

      assertEquals(
        await exists(`${workDir}/.trace/sentinel.json`),
        false,
        "the type-check step must clear its own scratch directory",
      );
      assertEquals(
        await exists(`${neighbour}/.trace/sentinel.json`),
        true,
        "scratch cleanup must not reach outside the script's working directory",
      );
    } finally {
      await Deno.remove(home, { recursive: true });
      await Deno.remove(workDir, { recursive: true });
      await Deno.remove(neighbour, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "quality.sh --dry-run ignores leftover native backprop env without CLI flags",
  permissions: { run: true, read: true, env: true },
  fn: async () => {
    const command = new Deno.Command("bash", {
      args: ["./quality.sh", "--dry-run"],
      stdout: "piped",
      stderr: "piped",
      cwd: Deno.cwd(),
      env: {
        ...Deno.env.toObject(),
        NEAT_AI_NATIVE_CORE_BACKPROP: "1",
        NEAT_AI_BACKPROP_ENABLED: "1",
      },
    });
    const output = await command.output();
    const stdout = new TextDecoder().decode(output.stdout);
    assertEquals(
      output.code,
      0,
      `stderr=${new TextDecoder().decode(output.stderr)}`,
    );
    assert(
      !stdout.includes("Building native neat-core") &&
        !stdout.includes("Verifying native neat-core") &&
        !stdout.includes("Building native neat_ai_backpropagation") &&
        !stdout.includes("Verifying native neat_ai_backpropagation"),
      `leftover env must not opt in native backprop; got: ${stdout}`,
    );
  },
});

Deno.test({
  name:
    "quality.sh --dry-run --native-core-backprop plans the libneat_core gate",
  permissions: { run: true, read: true },
  fn: async () => {
    const result = await runQuality(["--dry-run", "--native-core-backprop"]);
    assertEquals(result.code, 0, result.stderr);
    assert(
      result.stdout.includes("Building native neat-core") ||
        result.stdout.includes("Verifying native neat-core"),
      `Expected native neat-core step; got: ${result.stdout}`,
    );
  },
});

Deno.test({
  name:
    "quality.sh --native-core-backprop fails loud when libneat_core is missing",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const tmp = await Deno.makeTempDir({ prefix: "neat-quality-core-ffi-" });
    try {
      await Deno.copyFile("./quality.sh", `${tmp}/quality.sh`);
      await Deno.chmod(`${tmp}/quality.sh`, 0o755);
      const command = new Deno.Command("bash", {
        args: ["./quality.sh", "--native-core-backprop", "--wasm-scorer"],
        stdout: "piped",
        stderr: "piped",
        cwd: tmp,
        env: {
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          HOME: tmp,
          NEAT_AI_CORE_LIB_PATH: "/nonexistent/libneat_core.dylib",
        },
      });
      const output = await command.output();
      assert(
        output.code !== 0,
        "quality.sh --native-core-backprop must fail when libneat_core cannot be resolved",
      );
      const stderr = new TextDecoder().decode(output.stderr);
      assert(
        stderr.includes("libneat_core backprop was requested") &&
          stderr.includes("--native-core-backprop") &&
          stderr.includes("will not silently fall back"),
        `Expected fail-loud native-core-backprop error; got: ${stderr}`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "quality.sh --native-core-backprop passes NEAT_AI_NATIVE_CORE_BACKPROP=1 to deno test",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const home = await Deno.makeTempDir({ prefix: "neat-quality-core-env-" });
    try {
      const binDir = `${home}/.deno/bin`;
      await Deno.mkdir(binDir, { recursive: true });
      const callLog = `${home}/deno-calls.log`;
      await Deno.writeTextFile(
        `${binDir}/deno`,
        `#!/usr/bin/env bash
printf 'NEAT_AI_NATIVE_CORE_BACKPROP=%s NEAT_AI_BACKPROP_ENABLED=%s argv:%s\\n' \\
  "\${NEAT_AI_NATIVE_CORE_BACKPROP-<unset>}" \\
  "\${NEAT_AI_BACKPROP_ENABLED-<unset>}" \\
  "$*" >> "${callLog}"
exit 0
`,
      );
      await Deno.chmod(`${binDir}/deno`, 0o755);

      const fakeLib = `${home}/libneat_core.dylib`;
      await Deno.writeTextFile(fakeLib, "");

      await Deno.copyFile("./quality.sh", `${home}/quality.sh`);
      await Deno.chmod(`${home}/quality.sh`, 0o755);

      const command = new Deno.Command("bash", {
        args: [
          "./quality.sh",
          "--native-core-backprop",
          "--wasm-scorer",
          "--skip-discovery",
          "--skip-wasm",
        ],
        stdout: "piped",
        stderr: "piped",
        cwd: home,
        env: {
          PATH: Deno.env.get("PATH") ?? "",
          HOME: home,
          NEAT_AI_CORE_LIB_PATH: fakeLib,
        },
      });
      const output = await command.output();
      assertEquals(
        output.code,
        0,
        `quality.sh must succeed with the shim; stderr=${
          new TextDecoder().decode(output.stderr)
        }`,
      );

      const calls = (await Deno.readTextFile(callLog))
        .split("\n")
        .filter((l) => l.trim().length > 0);
      const testCall = calls.find((l) => l.includes("argv:test "));
      assert(
        testCall !== undefined,
        `expected a 'deno test' invocation; got: ${JSON.stringify(calls)}`,
      );
      assert(
        testCall.includes("NEAT_AI_NATIVE_CORE_BACKPROP=1"),
        `--native-core-backprop must enable the FFI loop for tests; got: ${testCall}`,
      );
      assert(
        testCall.includes("NEAT_AI_BACKPROP_ENABLED=0"),
        `--native-core-backprop must not imply --next; got: ${testCall}`,
      );
    } finally {
      await Deno.remove(home, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "quality.sh --next passes NEAT_AI_BACKPROP_ENABLED=1 and REQUIRE_FFI=1 to deno test",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const home = await Deno.makeTempDir({ prefix: "neat-quality-next-env-" });
    try {
      const binDir = `${home}/.deno/bin`;
      await Deno.mkdir(binDir, { recursive: true });
      const callLog = `${home}/deno-calls.log`;
      await Deno.writeTextFile(
        `${binDir}/deno`,
        `#!/usr/bin/env bash
printf 'NEAT_AI_NATIVE_CORE_BACKPROP=%s NEAT_AI_BACKPROP_ENABLED=%s NEAT_AI_BACKPROP_REQUIRE_FFI=%s argv:%s\\n' \\
  "\${NEAT_AI_NATIVE_CORE_BACKPROP-<unset>}" \\
  "\${NEAT_AI_BACKPROP_ENABLED-<unset>}" \\
  "\${NEAT_AI_BACKPROP_REQUIRE_FFI-<unset>}" \\
  "$*" >> "${callLog}"
exit 0
`,
      );
      await Deno.chmod(`${binDir}/deno`, 0o755);

      const fakeLib = `${home}/libneat_ai_backpropagation.dylib`;
      await Deno.writeTextFile(fakeLib, "");

      await Deno.copyFile("./quality.sh", `${home}/quality.sh`);
      await Deno.chmod(`${home}/quality.sh`, 0o755);

      const command = new Deno.Command("bash", {
        args: [
          "./quality.sh",
          "--next",
          "--wasm-scorer",
          "--skip-discovery",
          "--skip-wasm",
        ],
        stdout: "piped",
        stderr: "piped",
        cwd: home,
        env: {
          PATH: Deno.env.get("PATH") ?? "",
          HOME: home,
          NEAT_AI_BACKPROP_LIB_PATH: fakeLib,
        },
      });
      const output = await command.output();
      assertEquals(
        output.code,
        0,
        `quality.sh must succeed with the shim; stderr=${
          new TextDecoder().decode(output.stderr)
        }`,
      );

      const calls = (await Deno.readTextFile(callLog))
        .split("\n")
        .filter((l) => l.trim().length > 0);
      const testCall = calls.find((l) => l.includes("argv:test "));
      assert(
        testCall !== undefined,
        `expected a 'deno test' invocation; got: ${JSON.stringify(calls)}`,
      );
      assert(
        testCall.includes("NEAT_AI_BACKPROP_ENABLED=1"),
        `--next must enable rust trainDir for tests; got: ${testCall}`,
      );
      assert(
        testCall.includes("NEAT_AI_BACKPROP_REQUIRE_FFI=1"),
        `--next must require FFI for tests; got: ${testCall}`,
      );
      assert(
        testCall.includes("NEAT_AI_NATIVE_CORE_BACKPROP=0"),
        `--next must not imply --native-core-backprop; got: ${testCall}`,
      );
    } finally {
      await Deno.remove(home, { recursive: true });
    }
  },
});

/**
 * Issue #2742 — quality.sh must enforce the same supply-chain quarantine
 * window as bump-deps.sh / docs/CORE_DEPENDENCY_POLICY.md. Without
 * `--minimum-dependency-age`, any developer running `./quality.sh` with the
 * deps step enabled silently bypasses the VIBE_BUMP_QUARANTINE_HOURS gate
 * and may pull in a too-recent (potentially malicious) registry version.
 *
 * Issue #2997 — this was previously a source-text grep over quality.sh (a
 * HOW-test that passed if the string appeared anywhere, even in a comment).
 * It is now a WHAT-test: a fake `deno` is placed on PATH that records its
 * argv, quality.sh runs its deps step (via --lint-only, which keeps RUN_DEPS
 * on), and we assert on the command line actually emitted to `deno outdated`,
 * including the hours → minutes conversion.
 */
Deno.test({
  name:
    "quality.sh dep update invokes `deno outdated` with --minimum-dependency-age (Issue #2742 quarantine)",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    // quality.sh prepends "$HOME/.deno/bin" to PATH, so the shim must live
    // there. Point HOME at a temp dir whose .deno/bin holds the fake `deno`.
    const home = await Deno.makeTempDir({ prefix: "neat-quality-home-" });
    try {
      const binDir = `${home}/.deno/bin`;
      await Deno.mkdir(binDir, { recursive: true });
      const callLog = `${home}/deno-calls.log`;
      const shim = `${binDir}/deno`;
      // Records each invocation's argv (one line) and always succeeds, so
      // fmt/lint/the deps update all "pass" without touching the real toolchain.
      await Deno.writeTextFile(
        shim,
        `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${callLog}"\nexit 0\n`,
      );
      await Deno.chmod(shim, 0o755);

      const command = new Deno.Command("bash", {
        args: ["./quality.sh", "--lint-only"],
        stdout: "piped",
        stderr: "piped",
        cwd: Deno.cwd(),
        env: {
          PATH: Deno.env.get("PATH") ?? "",
          HOME: home,
          VIBE_BUMP_QUARANTINE_HOURS: "3",
        },
      });
      const output = await command.output();
      assertEquals(
        output.code,
        0,
        `quality.sh --lint-only must succeed with the shim; stderr=${
          new TextDecoder().decode(output.stderr)
        }`,
      );

      const calls = (await Deno.readTextFile(callLog))
        .split("\n")
        .filter((l) => l.trim().length > 0);
      const outdated = calls.find((l) => l.startsWith("outdated"));
      assert(
        outdated !== undefined,
        `expected a 'deno outdated' invocation; got calls: ${
          JSON.stringify(calls)
        }`,
      );
      assert(
        outdated.includes("--update") && outdated.includes("--latest"),
        `deno outdated must update to latest; got: ${outdated}`,
      );
      // 3 hours → 180 minutes proves the conversion, not just the literal flag.
      assert(
        outdated.includes("--minimum-dependency-age=180"),
        `deno outdated must carry the quarantine window in minutes; got: ${outdated}`,
      );
    } finally {
      await Deno.remove(home, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "quality.sh rejects non-integer VIBE_BUMP_QUARANTINE_HOURS (Issue #2742)",
  permissions: { run: true, read: true, env: true },
  fn: async () => {
    const command = new Deno.Command("bash", {
      args: ["./quality.sh", "--lint-only"],
      stdout: "piped",
      stderr: "piped",
      cwd: Deno.cwd(),
      env: {
        PATH: Deno.env.get("PATH") ?? "",
        VIBE_BUMP_QUARANTINE_HOURS: "not-a-number",
      },
    });
    const output = await command.output();
    // --lint-only sets RUN_DEPS=true (only RUN_TYPE_CHECK/RUN_DISCOVERY/
    // RUN_WASM/RUN_TESTS are cleared), so the validation guard must fire.
    assert(
      output.code !== 0,
      "quality.sh must reject non-integer VIBE_BUMP_QUARANTINE_HOURS",
    );
    const stderr = new TextDecoder().decode(output.stderr);
    assert(
      stderr.includes("VIBE_BUMP_QUARANTINE_HOURS") &&
        stderr.includes("non-negative integer"),
      `Expected validation error in stderr; got: ${stderr}`,
    );
  },
});
