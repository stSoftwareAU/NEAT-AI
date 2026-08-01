/**
 * Issue #3613 — the option-usage audit harness must be runnable by a public
 * user.
 *
 * The harness used to hard-code the private `stSoftwareAU/GRQ` repository as a
 * default consumer, so every public run probed a repository the caller cannot
 * see: the `gh search code --repo` probe 404s and the `--clone-root` sibling
 * grep finds no checkout. That silently split the tooling into "works
 * internally" and "fails publicly".
 *
 * These guards exercise the real exported harness values and the real consumer
 * resolution, so the private default cannot come back through either the
 * default list, the controls, the sibling-clone lookup, or the roll-up notes.
 * Consumers beyond the public default are supplied by org discovery or CLI
 * arguments under the caller's own credentials.
 */

import { assert, assertEquals } from "@std/assert";
import {
  CONTROLS,
  DEFAULT_CONSUMERS,
  resolveConsumers,
} from "../../scripts/audit-option-usage.ts";
import { OPTION_AUDIT_ROLLUP } from "../../scripts/lib/optionAuditRollup.ts";

/** Private `stSoftwareAU` repositories no public clone can reach. */
const PRIVATE_REPOS = [
  "stSoftwareAU/GRQ",
  "stSoftwareAU/GRQ-cluster",
  "stSoftwareAU/GRQ-logs",
  "stSoftwareAU/VibeCoding",
];

/** Bare private-repo mnemonics that must not appear in shipped verdict notes. */
const PRIVATE_NAME = /\b(?:GRQ|VibeCoding)\b/;

Deno.test("audit harness defaults name no private consumer (#3613)", () => {
  assertEquals(
    DEFAULT_CONSUMERS.filter((repo) => PRIVATE_REPOS.includes(repo)),
    [],
    "a hard-coded private consumer makes the harness unrunnable for the public",
  );
  assert(
    DEFAULT_CONSUMERS.length > 0,
    "the harness still needs a public consumer to probe by default",
  );
});

Deno.test("audit harness controls probe only the public defaults (#3613)", () => {
  assertEquals(
    CONTROLS.repos.filter((repo) => !DEFAULT_CONSUMERS.includes(repo)),
    [],
    "controls must run against the default consumer set, not a private extra",
  );
});

Deno.test("resolveConsumers never greps a private sibling checkout (#3613)", async () => {
  const cloneRoot = await Deno.makeTempDir();
  try {
    // An internal machine has both checked out side by side; the harness must
    // only ever reach for the public one.
    await Deno.mkdir(`${cloneRoot}/GRQ`);
    await Deno.mkdir(`${cloneRoot}/NEAT-AI-Examples`);

    const consumers = await resolveConsumers(DEFAULT_CONSUMERS, cloneRoot);

    assertEquals(
      consumers.filter((c) => PRIVATE_REPOS.includes(c.repo)),
      [],
      "no default consumer may resolve to a private repository",
    );
    assertEquals(
      consumers.filter((c) => c.clonePath?.endsWith("/GRQ")),
      [],
      "the sibling-clone grep must not target the private checkout",
    );
    assert(
      consumers.some((c) => c.clonePath === `${cloneRoot}/NEAT-AI-Examples`),
      "the public consumer's local clone must still be picked up",
    );
  } finally {
    await Deno.remove(cloneRoot, { recursive: true });
  }
});

Deno.test("roll-up verdict notes stay concept level (#3613)", () => {
  const offenders = OPTION_AUDIT_ROLLUP
    .filter((entry) => PRIVATE_NAME.test(entry.note ?? ""))
    .map((entry) => `${entry.key}: ${entry.note}`);
  assertEquals(
    offenders,
    [],
    "verdict notes ship to public readers — describe the downstream consumer " +
      "at concept level rather than naming a private repository",
  );
});
