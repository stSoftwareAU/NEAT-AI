/**
 * Issue #3685: the episode adapter URL reaches `await import()` inside the
 * worker. An adapter description sourced from a remote manifest must not be
 * able to execute remote code, so anything but a local specifier is rejected
 * before the import runs.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { EpisodeWorkerProcessor } from "@creature/EpisodeWorkerProcessor.ts";

async function initWith(url: string) {
  const processor = new EpisodeWorkerProcessor();
  const response = await processor.process({
    taskID: 1,
    initialize: { adapter: { url } },
  });
  assertEquals("initialize" in response, true);
  return (response as { initialize: { status: string; error?: string } })
    .initialize;
}

Deno.test("EpisodeWorkerProcessor: rejects remote adapter URLs", async () => {
  const results = await Promise.all([
    "https://evil.example/adapter.ts",
    "http://evil.example/adapter.ts",
    "data:text/javascript,export default class {}",
    "npm:evil-adapter",
  ].map(initWith));

  for (const result of results) {
    assertEquals(result.status, "ERROR");
    assertStringIncludes(result.error ?? "", "episode adapter");
  }
});

Deno.test("EpisodeWorkerProcessor: a local adapter URL passes the guard", async () => {
  // The module does not exist, so init still fails — but with a module
  // resolution error rather than the scheme guard, proving `file:` is allowed.
  const result = await initWith("file:///definitely/not/a/real/module.ts");
  assertEquals(result.status, "ERROR");
  assertEquals((result.error ?? "").includes("episode adapter"), false);
});
