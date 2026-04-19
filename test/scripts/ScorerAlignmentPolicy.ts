import { assert } from "@std/assert";

/**
 * Tests that the NEAT-AI-core dependency policy and external dependency
 * documentation explicitly address scorer alignment — ensuring that
 * NEAT-AI-scorer (or equivalent downstream consumers) must pin the same
 * neat-core rev as NEAT-AI.
 *
 * Issue #2348 — avoid version skew between NEAT-AI and NEAT-AI-scorer.
 */

const POLICY_DOC = "docs/CORE_DEPENDENCY_POLICY.md";
const EXTERNAL_DOC = "docs/EXTERNAL_NEAT_AI_CORE.md";

Deno.test(
  "core dependency policy documents scorer alignment requirement",
  async () => {
    const content = await Deno.readTextFile(POLICY_DOC);
    const lower = content.toLowerCase();

    assert(
      lower.includes("scorer") || lower.includes("neat-ai-scorer"),
      "CORE_DEPENDENCY_POLICY.md must mention the scorer alignment requirement",
    );

    assert(
      lower.includes("downstream") || lower.includes("consumer"),
      "CORE_DEPENDENCY_POLICY.md must address downstream consumer alignment",
    );
  },
);

Deno.test(
  "external core doc covers scorer workspace alignment",
  async () => {
    const content = await Deno.readTextFile(EXTERNAL_DOC);
    const lower = content.toLowerCase();

    assert(
      lower.includes("scorer"),
      "EXTERNAL_NEAT_AI_CORE.md must reference the scorer",
    );

    assert(
      lower.includes("neat-ai-scorer"),
      "EXTERNAL_NEAT_AI_CORE.md must reference NEAT-AI-scorer by name",
    );
  },
);

Deno.test(
  "policy documents the same-rev requirement for scorer",
  async () => {
    const content = await Deno.readTextFile(POLICY_DOC);
    const lower = content.toLowerCase();

    // The policy must explicitly state that downstream consumers pin the same rev.
    assert(
      lower.includes("same") && lower.includes("rev"),
      "CORE_DEPENDENCY_POLICY.md must state the same-rev pinning requirement",
    );
  },
);

Deno.test(
  "external core doc explains how to verify scorer alignment",
  async () => {
    const content = await Deno.readTextFile(EXTERNAL_DOC);
    const lower = content.toLowerCase();

    // Must explain the verification step for downstream alignment.
    assert(
      lower.includes("verify") || lower.includes("confirm") ||
        lower.includes("check"),
      "EXTERNAL_NEAT_AI_CORE.md must explain how to verify scorer alignment",
    );
  },
);
