import { assert } from "@std/assert";
import { parse } from "@std/yaml";

/**
 * Coverage shards do not build sibling neat_ai_backpropagation. Rust trainDir
 * defaults on in library code, so the workflow must force it off (same as
 * ./quality.sh without --next) or eligible trainDir fails loud across the
 * suite (Issue #3765).
 */

interface Job {
  env?: Record<string, string>;
}

interface Workflow {
  jobs?: Record<string, Job>;
}

const COVERAGE_WORKFLOW = ".github/workflows/coverage.yaml";

Deno.test(
  "coverage.yaml forces NEAT_AI_BACKPROP_ENABLED=0 (no sibling trainer in CI)",
  async () => {
    const wf = parse(
      await Deno.readTextFile(COVERAGE_WORKFLOW),
    ) as Workflow;
    const env = wf.jobs?.coverage?.env;
    assert(env, "coverage job must declare env");
    assert(
      env.NEAT_AI_BACKPROP_ENABLED === "0",
      "coverage must disable rust trainDir when the sibling binary/library is absent; " +
        `got NEAT_AI_BACKPROP_ENABLED=${env.NEAT_AI_BACKPROP_ENABLED}`,
    );
    assert(
      env.NEAT_AI_BACKPROP_REQUIRE_FFI === "0",
      "coverage must not require FFI trainDir; " +
        `got NEAT_AI_BACKPROP_REQUIRE_FFI=${env.NEAT_AI_BACKPROP_REQUIRE_FFI}`,
    );
  },
);
