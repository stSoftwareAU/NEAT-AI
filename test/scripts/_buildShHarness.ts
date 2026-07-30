import { assert } from "@std/assert";

/**
 * Shared harness for the `test/scripts/BuildScript*.ts` suites: source named
 * top-level functions out of `build.sh` into a sub-shell and drive them with
 * test data, so the real bash logic is exercised without a network fetch.
 */

export interface ShellResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Source the named build.sh functions into a sub-shell and run an invocation
 * against them.
 *
 * @param fnNames Top-level function names to extract, in definition order.
 * @param invocation Bash to run once the functions are defined.
 */
export async function runSourcedFns(
  fnNames: string[],
  invocation: string,
): Promise<ShellResult> {
  // A temp file (rather than process substitution) is used because
  // `source <(...)` does not reliably define functions across all bash
  // builds (e.g. macOS bash 3.2).
  const fnTmp = await Deno.makeTempFile({ prefix: "neat-fn-", suffix: ".sh" });
  try {
    const extracted = await Promise.all(
      fnNames.map((fnName) =>
        new Deno.Command("awk", {
          args: [`/^${fnName}\\(\\)/,/^}$/`, "./build.sh"],
          stdout: "piped",
          cwd: Deno.cwd(),
        }).output()
      ),
    );
    const parts: Uint8Array[] = extracted.map((ex, i) => {
      assert(
        ex.stdout.length > 0,
        `build.sh must define a top-level ${fnNames[i]}() function`,
      );
      return ex.stdout;
    });
    const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      joined.set(p, offset);
      offset += p.length;
    }
    await Deno.writeFile(fnTmp, joined);

    const cmd = new Deno.Command("bash", {
      args: ["-c", `set -uo pipefail\nsource '${fnTmp}'\n${invocation}\n`],
      stdout: "piped",
      stderr: "piped",
      stdin: "null",
      cwd: Deno.cwd(),
    });
    const out = await cmd.output();
    return {
      stdout: new TextDecoder().decode(out.stdout),
      stderr: new TextDecoder().decode(out.stderr),
      code: out.code,
    };
  } finally {
    await Deno.remove(fnTmp);
  }
}
