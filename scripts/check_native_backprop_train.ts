import {
  closeNativeBackpropLibrary,
  findNativeBackpropLibrary,
  getNativeBackpropVersion,
  isNativeBackpropAvailable,
  nativeBackpropDeadlineCapability,
  NEAT_BACKPROP_ABI_VERSION,
} from "@architecture/training/NativeBackpropLibrary.ts";

/** What {@link checkNativeBackprop} reads and reports through; injected so it is testable. */
export interface NativeBackpropCheckDeps {
  findLibrary(): string | null;
  isAvailable(): boolean;
  version(): string | null | undefined;
  deadlineCapability(): { version: number } | undefined;
  close(): void;
  log(message: string): void;
  error(message: string): void;
}

const LIVE_DEPS: NativeBackpropCheckDeps = {
  findLibrary: findNativeBackpropLibrary,
  isAvailable: isNativeBackpropAvailable,
  version: getNativeBackpropVersion,
  deadlineCapability: nativeBackpropDeadlineCapability,
  close: closeNativeBackpropLibrary,
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

/**
 * Fail loud when native libneat_ai_backpropagation was requested but cannot
 * be loaded (Issue #3765).
 *
 * quality.sh --next calls this after an optional sibling cargo build so
 * tests exercise the FFI path and cannot silently stay on CLI/WASM.
 *
 * It also reports the per-task deadline capability (Issue #4119). A legacy
 * library is a warning; a library that advertises a malformed capability fails.
 *
 * @returns The process exit code: 0 when the library loads, 1 otherwise.
 */
export function checkNativeBackprop(
  deps: NativeBackpropCheckDeps = LIVE_DEPS,
): number {
  const libPath = deps.findLibrary();
  if (libPath === null) {
    deps.error(
      "❌ Native libneat_ai_backpropagation was requested but was not found.",
    );
    deps.error(
      "   Clone ../NEAT-AI-Backpropagation and cargo build --release -p neat_ai_backpropagation,",
    );
    deps.error(
      "   or set NEAT_AI_BACKPROP_LIB_PATH. Silent CLI/WASM fallback is not allowed for --next.",
    );
    return 1;
  }

  try {
    if (!deps.isAvailable()) {
      deps.error(
        `❌ Native libneat_ai_backpropagation exists at ${libPath} but failed to load ` +
          `(expected ABI ${NEAT_BACKPROP_ABI_VERSION}).`,
      );
      return 1;
    }
    const version = deps.version() ?? "(unknown)";
    deps.log(
      `✅ native libneat_ai_backpropagation loaded from ${libPath} (v${version}, ABI ${NEAT_BACKPROP_ABI_VERSION})`,
    );

    let deadline;
    try {
      deadline = deps.deadlineCapability();
    } catch (error) {
      deps.error(
        `❌ libneat_ai_backpropagation advertises a malformed capability: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 1;
    }
    if (deadline === undefined) {
      deps.log(
        "⚠️ no deadline capability — the per-task deadline is not enforced natively",
      );
    } else {
      deps.log(
        `✅ libneat_ai_backpropagation advertises the deadline capability v${deadline.version}`,
      );
    }
    return 0;
  } finally {
    deps.close();
  }
}

if (import.meta.main) {
  const code = checkNativeBackprop();
  if (code !== 0) Deno.exit(code);
}
