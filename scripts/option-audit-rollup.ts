#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * Roll-up reconciliation for the #3505 option-removal audit (Issue #3525).
 *
 * Re-runs the #3518 key enumeration and diffs it against the merged
 * classification table, then prints (or writes) the consolidated markdown.
 *
 *     deno run --allow-read scripts/option-audit-rollup.ts
 *     deno run --allow-read --allow-write scripts/option-audit-rollup.ts \
 *       --out docs/OPTION_AUDIT_CONSOLIDATED.md
 *
 * Exit codes: 0 every key classified, 1 a coverage gap was found, 2 bad usage.
 * A gap exits non-zero deliberately — an unclassified key must never read as a
 * clean audit.
 */

import { enumerateOptionKeys } from "./lib/optionInventory.ts";
import { OPTION_AUDIT_ROLLUP } from "./lib/optionAuditRollup.ts";
import {
  reconcile,
  toConsolidatedMarkdown,
} from "./lib/optionAuditReconcile.ts";

const USAGE = `Usage: deno run --allow-read [--allow-write] \\
  scripts/option-audit-rollup.ts [options]

  --repo-root DIR  NEAT-AI checkout to enumerate keys from (default: .)
  --out FILE       Write the merged table here instead of stdout
  --help           Show this message`;

async function main(): Promise<number> {
  let repoRoot = ".";
  let out = "";

  for (let i = 0; i < Deno.args.length; i++) {
    const arg = Deno.args[i];
    const value = () => {
      const next = Deno.args[++i];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      return next;
    };
    switch (arg) {
      case "--repo-root":
        repoRoot = value();
        break;
      case "--out":
        out = value();
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        return 0;
      default:
        console.error(`❌ unknown option: ${arg}\n\n${USAGE}`);
        return 2;
    }
  }

  const rows = await enumerateOptionKeys(repoRoot);
  const result = reconcile(rows, OPTION_AUDIT_ROLLUP);
  const markdown = toConsolidatedMarkdown(result);

  if (out) {
    await Deno.writeTextFile(out, `${markdown}\n`);
    console.log(`📝 wrote ${out}`);
  } else {
    console.log(markdown);
  }

  const topLevel = rows.filter((r) => r.slice === "top-level").length;
  console.error(
    `\n🔎 ${rows.length} enumerated rows (${topLevel} top-level, ${
      rows.length - topLevel
    } nested) · ${result.classified.length} classified`,
  );

  if (result.orphans.length > 0) {
    console.error(
      `⚠️  ${result.orphans.length} roll-up entr${
        result.orphans.length === 1 ? "y describes a key" : "ies describe keys"
      } the source no longer has: ${result.orphans.join(", ")}`,
    );
  }

  if (result.gaps.length > 0) {
    console.error(`\n❌ ${result.gaps.length} coverage gap(s):`);
    for (const gap of result.gaps) {
      console.error(`   ${gap.reason}: ${gap.detail}`);
    }
    console.error("\nFile each gap as a follow-up before closing #3505.");
    return 1;
  }

  console.error("✅ zero coverage gaps — every option key is classified");
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
