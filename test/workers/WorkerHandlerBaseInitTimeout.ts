/**
 * Tests for the getInitTimeoutMs function from WorkerHandlerBase.
 *
 * Issue #1698: Validates environment-based timeout configuration.
 */
import { assertEquals } from "@std/assert";
import { getInitTimeoutMs } from "../../src/workers/WorkerHandlerBase.ts";

Deno.test("getInitTimeoutMs: returns default 60000 when env not set", () => {
  const original = Deno.env.get("NEAT_AI_WORKER_INIT_TIMEOUT_MS");
  try {
    Deno.env.delete("NEAT_AI_WORKER_INIT_TIMEOUT_MS");
    const result = getInitTimeoutMs();
    assertEquals(result, 60_000);
  } finally {
    if (original !== undefined) {
      Deno.env.set("NEAT_AI_WORKER_INIT_TIMEOUT_MS", original);
    }
  }
});

Deno.test("getInitTimeoutMs: returns custom value from env", () => {
  const original = Deno.env.get("NEAT_AI_WORKER_INIT_TIMEOUT_MS");
  try {
    Deno.env.set("NEAT_AI_WORKER_INIT_TIMEOUT_MS", "30000");
    const result = getInitTimeoutMs();
    assertEquals(result, 30_000);
  } finally {
    if (original !== undefined) {
      Deno.env.set("NEAT_AI_WORKER_INIT_TIMEOUT_MS", original);
    } else {
      Deno.env.delete("NEAT_AI_WORKER_INIT_TIMEOUT_MS");
    }
  }
});

Deno.test("getInitTimeoutMs: returns default for values below 1000", () => {
  const original = Deno.env.get("NEAT_AI_WORKER_INIT_TIMEOUT_MS");
  try {
    Deno.env.set("NEAT_AI_WORKER_INIT_TIMEOUT_MS", "500");
    const result = getInitTimeoutMs();
    assertEquals(result, 60_000);
  } finally {
    if (original !== undefined) {
      Deno.env.set("NEAT_AI_WORKER_INIT_TIMEOUT_MS", original);
    } else {
      Deno.env.delete("NEAT_AI_WORKER_INIT_TIMEOUT_MS");
    }
  }
});

Deno.test("getInitTimeoutMs: returns default for non-numeric env value", () => {
  const original = Deno.env.get("NEAT_AI_WORKER_INIT_TIMEOUT_MS");
  try {
    Deno.env.set("NEAT_AI_WORKER_INIT_TIMEOUT_MS", "not-a-number");
    const result = getInitTimeoutMs();
    assertEquals(result, 60_000);
  } finally {
    if (original !== undefined) {
      Deno.env.set("NEAT_AI_WORKER_INIT_TIMEOUT_MS", original);
    } else {
      Deno.env.delete("NEAT_AI_WORKER_INIT_TIMEOUT_MS");
    }
  }
});

Deno.test("getInitTimeoutMs: returns default for empty string", () => {
  const original = Deno.env.get("NEAT_AI_WORKER_INIT_TIMEOUT_MS");
  try {
    Deno.env.set("NEAT_AI_WORKER_INIT_TIMEOUT_MS", "");
    const result = getInitTimeoutMs();
    assertEquals(result, 60_000);
  } finally {
    if (original !== undefined) {
      Deno.env.set("NEAT_AI_WORKER_INIT_TIMEOUT_MS", original);
    } else {
      Deno.env.delete("NEAT_AI_WORKER_INIT_TIMEOUT_MS");
    }
  }
});
