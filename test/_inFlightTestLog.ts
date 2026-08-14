/**
 * Record which Deno.test cases are running so a SIGKILL still leaves a name.
 *
 * `deno test --parallel` only prints a file once it finishes. When the OS
 * jetsams the runner (`Killed: 9` / exit 137), the last log lines are often
 * evolution spam with no test name. quality.sh sets `NEAT_AI_IN_FLIGHT_DIR`
 * and dumps leftover files after the runner stops.
 */

const encoder = new TextEncoder();

let sequence = 0;

export type InFlightHandle = {
  path: string;
};

function inFlightDir(): string | undefined {
  try {
    const dir = Deno.env.get("NEAT_AI_IN_FLIGHT_DIR");
    if (!dir) {
      return undefined;
    }
    const trimmed = dir.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    // Tests that declare a tight permission set cannot read env.
    return undefined;
  }
}

function safeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_");
  return (cleaned.length > 0 ? cleaned : "unnamed").slice(0, 120);
}

/** Create a durable in-flight record. Returns undefined when tracking is off. */
export function beginInFlight(name: string): InFlightHandle | undefined {
  try {
    const dir = inFlightDir();
    if (!dir) {
      return undefined;
    }
    Deno.mkdirSync(dir, { recursive: true });
    sequence += 1;
    const path = `${dir}/${Deno.pid}-${sequence}-${safeName(name)}.txt`;
    const line =
      `${Temporal.Now.instant().toString()} pid=${Deno.pid} ${name}\n`;
    const file = Deno.openSync(path, {
      create: true,
      write: true,
      truncate: true,
    });
    try {
      file.writeSync(encoder.encode(line));
      file.syncSync();
    } finally {
      file.close();
    }
    return { path };
  } catch {
    // Missing write/env permissions, or the directory is not writable.
    return undefined;
  }
}

/** Remove the in-flight record once the test finishes (pass, fail, or skip). */
export function endInFlight(handle: InFlightHandle | undefined): void {
  if (!handle) {
    return;
  }
  try {
    Deno.removeSync(handle.path);
  } catch {
    // Already gone, or the directory was cleaned up.
  }
}

type TestFn = (t: Deno.TestContext) => void | Promise<void>;

function wrapTestFn(name: string, fn: TestFn): TestFn {
  return async (t) => {
    const handle = beginInFlight(name);
    try {
      await fn(t);
    } finally {
      endInFlight(handle);
    }
  };
}

function normaliseTestDefinition(
  nameOrDef: unknown,
  optsOrFn?: unknown,
  maybeFn?: unknown,
): Deno.TestDefinition | undefined {
  if (typeof nameOrDef === "object" && nameOrDef !== null) {
    const obj = nameOrDef as Deno.TestDefinition;
    if (typeof optsOrFn === "function") {
      const name = obj.name ?? "(unnamed)";
      return {
        ...obj,
        name,
        fn: optsOrFn as TestFn,
      };
    }
    if (typeof obj.fn === "function" && typeof obj.name === "string") {
      return obj;
    }
    return undefined;
  }
  if (typeof nameOrDef === "string" && typeof optsOrFn === "function") {
    return { name: nameOrDef, fn: optsOrFn as TestFn };
  }
  if (
    typeof nameOrDef === "string" &&
    typeof optsOrFn === "object" &&
    optsOrFn !== null &&
    typeof maybeFn === "function"
  ) {
    return {
      ...(optsOrFn as Omit<Deno.TestDefinition, "fn" | "name">),
      name: nameOrDef,
      fn: maybeFn as TestFn,
    };
  }
  return undefined;
}

function wrapDenoTestCallable(
  callable: typeof Deno.test,
): typeof Deno.test {
  const wrapped = ((
    nameOrDef: unknown,
    optsOrFn?: unknown,
    maybeFn?: unknown,
  ) => {
    const def = normaliseTestDefinition(nameOrDef, optsOrFn, maybeFn);
    if (!def) {
      return (callable as (...args: unknown[]) => void)(
        nameOrDef,
        optsOrFn,
        maybeFn,
      );
    }
    if (def.ignore) {
      return callable(def);
    }
    return callable({
      ...def,
      fn: wrapTestFn(def.name, def.fn),
    });
  }) as typeof Deno.test;
  return wrapped;
}

/** Patch `Deno.test` so every running case leaves a name file. */
export function installInFlightDenoTestHook(): void {
  const original = Deno.test;
  const patched = wrapDenoTestCallable(original.bind(Deno) as typeof Deno.test);
  for (const key of Object.getOwnPropertyNames(original)) {
    if (key === "length" || key === "name" || key === "prototype") {
      continue;
    }
    const desc = Object.getOwnPropertyDescriptor(original, key);
    if (desc) {
      Object.defineProperty(patched, key, desc);
    }
  }
  if (typeof original.only === "function") {
    patched.only = wrapDenoTestCallable(
      original.only.bind(original) as typeof Deno.test,
    ) as typeof Deno.test.only;
  }
  Object.defineProperty(Deno, "test", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: patched,
  });
}
