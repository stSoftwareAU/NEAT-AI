import {
  closeNativeBackpropLibrary,
  findNativeBackpropLibrary,
  getNativeBackpropVersion,
  isNativeBackpropAvailable,
  NEAT_BACKPROP_ABI_VERSION,
} from "@architecture/training/NativeBackpropLibrary.ts";

/**
 * Fail loud when native libneat_ai_backpropagation was requested but cannot
 * be loaded (Issue #3765).
 *
 * quality.sh --next calls this after an optional sibling cargo build so
 * tests exercise the FFI path and cannot silently stay on CLI/WASM.
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
  } finally {
    closeNativeBackpropLibrary();
  }
}

main();
