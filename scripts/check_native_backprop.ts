import {
  closeNativeCoreLibrary,
  findNativeCoreLibrary,
  isNativeCoreAvailable,
} from "@wasm/NativeCoreLibrary.ts";

/**
 * Fail loud when native libneat_core was requested but cannot be loaded.
 *
 * quality.sh --next / NEAT_AI_NATIVE_CORE_BACKPROP=1 calls this after an
 * optional sibling cargo build so tests cannot silently stay on WASM.
 */
function main(): void {
  const libPath = findNativeCoreLibrary();
  if (libPath === null) {
    console.error(
      "❌ Native libneat_core was requested but was not found.",
    );
    console.error(
      "   Clone ../NEAT-AI-core and cargo build --release -p neat-core,",
    );
    console.error(
      "   or set NEAT_AI_CORE_LIB_PATH. Silent WASM fallback is not allowed.",
    );
    Deno.exit(1);
  }

  try {
    if (!isNativeCoreAvailable()) {
      console.error(
        `❌ Native libneat_core exists at ${libPath} but failed to load.`,
      );
      Deno.exit(1);
    }
    console.log(`✅ native libneat_core loaded from ${libPath}`);
  } finally {
    closeNativeCoreLibrary();
  }
}

main();
