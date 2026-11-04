import {
  closeNativeBackpropLibrary,
  findNativeBackpropLibrary,
  getNativeBackpropVersion,
  isNativeBackpropAvailable,
  nativeBackpropDeadlineCapability,
  NEAT_BACKPROP_ABI_VERSION,
} from "@architecture/training/NativeBackpropLibrary.ts";

/**
 * Fail loud when native libneat_ai_backpropagation was requested but cannot
 * be loaded (Issue #3765).
 *
 * quality.sh --next calls this after an optional sibling cargo build so
 * tests exercise the FFI path and cannot silently stay on CLI/WASM.
 *
 * It also reports the per-task deadline capability (Issue #4119). A legacy
 * library is a warning; a library that advertises a malformed capability fails.
 */
function main(): void {
  const libPath = findNativeBackpropLibrary();
  if (libPath === null) {
    console.error(
      "❌ Native libneat_ai_backpropagation was requested but was not found.",
    );
    console.error(
      "   Clone ../NEAT-AI-Backpropagation and cargo build --release -p neat_ai_backpropagation,",
    );
    console.error(
      "   or set NEAT_AI_BACKPROP_LIB_PATH. Silent CLI/WASM fallback is not allowed for --next.",
    );
    Deno.exit(1);
  }

  try {
    if (!isNativeBackpropAvailable()) {
      console.error(
        `❌ Native libneat_ai_backpropagation exists at ${libPath} but failed to load ` +
          `(expected ABI ${NEAT_BACKPROP_ABI_VERSION}).`,
      );
      Deno.exit(1);
    }
    const version = getNativeBackpropVersion() ?? "(unknown)";
    console.log(
      `✅ native libneat_ai_backpropagation loaded from ${libPath} (v${version}, ABI ${NEAT_BACKPROP_ABI_VERSION})`,
    );

    let deadline;
    try {
      deadline = nativeBackpropDeadlineCapability();
    } catch (error) {
      console.error(
        `❌ libneat_ai_backpropagation advertises a malformed capability: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      Deno.exit(1);
    }
    if (deadline === undefined) {
      console.log(
        "⚠️ no deadline capability — the per-task deadline is not enforced natively",
      );
    } else {
      console.log(
        `✅ libneat_ai_backpropagation advertises the deadline capability v${deadline.version}`,
      );
    }
  } finally {
    closeNativeBackpropLibrary();
  }
}

main();
