/**
 * Issue #3767 — the README's "🌐 Related Repositories" section is the family
 * inventory, and its three surfaces (the table, the Mermaid dependency graph,
 * and the Family previews image grid) must agree.
 *
 * These are behavioural ("what") tests: they read the committed README and
 * assert observable facts about the inventory it publishes — a sibling with a
 * preview image but no table row, a table row missing from the graph, or a
 * graph node with no edges all fail here rather than being noticed by a reader
 * months later.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const README = `${REPO_ROOT}/README.md`;

/** The "🌐 Related Repositories" section, up to the next level-2 heading. */
function relatedRepositoriesSection(readme: string): string {
  const start = readme.indexOf("## 🌐 Related Repositories");
  assertEquals(
    start >= 0,
    true,
    "README.md has no Related Repositories section",
  );
  const rest = readme.slice(start + 1);
  const end = rest.indexOf("\n## ");
  return end >= 0 ? rest.slice(0, end) : rest;
}

/** Repository slugs linked from the section's table rows, lower-cased. */
function tableRepositories(section: string): string[] {
  const slugs = new Set<string>();
  for (const line of section.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    for (
      const match of line.matchAll(
        /https:\/\/github\.com\/stSoftwareAU\/(NEAT-AI[\w-]*)/g,
      )
    ) {
      slugs.add(match[1].toLowerCase());
    }
  }
  return [...slugs].sort();
}

/** The Mermaid dependency-graph block inside the section. */
function dependencyGraph(section: string): string {
  const open = section.indexOf("```mermaid");
  assertEquals(open >= 0, true, "Related Repositories has no Mermaid graph");
  const body = section.slice(open + "```mermaid".length);
  const close = body.indexOf("```");
  assertEquals(close >= 0, true, "Mermaid graph block is unterminated");
  return body.slice(0, close);
}

/** Node id → repository slug (lower-cased) for every graph node declaration. */
function graphNodes(graph: string): Map<string, string> {
  const nodes = new Map<string, string>();
  for (const match of graph.matchAll(/(\w+)\["([^"<\]]+)/g)) {
    nodes.set(match[1], match[2].trim().toLowerCase());
  }
  return nodes;
}

/** Preview image basenames in the Family previews grid, lower-cased. */
function previewRepositories(section: string): string[] {
  const slugs = new Set<string>();
  for (
    const match of section.matchAll(
      /docs\/brand\/social-previews\/([\w-]+)\.png/g,
    )
  ) {
    slugs.add(match[1].toLowerCase());
  }
  return [...slugs].sort();
}

Deno.test("every family preview has a Related Repositories table row", async () => {
  const section = relatedRepositoriesSection(await Deno.readTextFile(README));
  const listed = new Set(tableRepositories(section));

  const missing = previewRepositories(section).filter((s) => !listed.has(s));
  assertEquals(
    missing,
    [],
    "README Related Repositories table omits sibling(s) shown in Family previews",
  );
});

Deno.test("table and dependency graph list the same repositories", async () => {
  const section = relatedRepositoriesSection(await Deno.readTextFile(README));
  const inTable = tableRepositories(section);
  const inGraph = [...new Set(graphNodes(dependencyGraph(section)).values())]
    .sort();

  assertEquals(
    inTable.filter((s) => !inGraph.includes(s)),
    [],
    "dependency graph omits repositories listed in the table",
  );
  assertEquals(
    inGraph.filter((s) => !inTable.includes(s)),
    [],
    "dependency graph names repositories missing from the table",
  );
});

Deno.test("every dependency-graph node is wired by at least one edge", async () => {
  const section = relatedRepositoriesSection(await Deno.readTextFile(README));
  const graph = dependencyGraph(section);
  const edges = graph
    .split("\n")
    .filter((line) => line.includes("-->"))
    .join("\n");

  const unwired = [...graphNodes(graph).keys()].filter((id) =>
    !new RegExp(`\\b${id}\\b`).test(edges)
  );
  assertEquals(unwired, [], "dependency graph has node(s) with no edges");
});
