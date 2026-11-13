/**
 * Hold an OS loader reference outside Deno's worker resource table.
 *
 * Deno unloads a worker's DynamicLibrary on termination even if its nonblocking
 * call is still running. This reference keeps that code mapped until the call
 * returns. If the isolate dies first, the reference lasts until process exit.
 */

const POSIX_SYMBOLS = {
  dlopen: { parameters: ["buffer", "i32"], result: "pointer" },
  dlclose: { parameters: ["pointer"], result: "i32" },
} as const;

const WINDOWS_SYMBOLS = {
  LoadLibraryW: { parameters: ["buffer"], result: "pointer" },
  FreeLibrary: { parameters: ["pointer"], result: "i32" },
} as const;

/** Acquire a loader reference; call the returned release after native completion. */
export function retainNativeLibrary(path: string): () => void {
  if (Deno.build.os === "windows") {
    const loader = Deno.dlopen("kernel32.dll", WINDOWS_SYMBOLS);
    const widePath = Uint16Array.from(
      `${path}\0`,
      (char) => char.charCodeAt(0),
    );
    const reference = loader.symbols.LoadLibraryW(widePath);
    if (reference === null) {
      loader.close();
      throw new Error(`Cannot retain native training library: ${path}`);
    }
    return () => {
      try {
        if (loader.symbols.FreeLibrary(reference) === 0) {
          throw new Error(`Cannot release native training library: ${path}`);
        }
      } finally {
        loader.close();
      }
    };
  }

  // cspell:disable-next-line
  const loaderName = Deno.build.os === "darwin"
    ? "libSystem.B.dylib"
    : "libdl.so.2";
  const loader = Deno.dlopen(loaderName, POSIX_SYMBOLS);
  const reference = loader.symbols.dlopen(
    new TextEncoder().encode(`${path}\0`),
    2,
  );
  if (reference === null) {
    loader.close();
    throw new Error(`Cannot retain native training library: ${path}`);
  }
  return () => {
    try {
      if (loader.symbols.dlclose(reference) !== 0) {
        throw new Error(`Cannot release native training library: ${path}`);
      }
    } finally {
      loader.close();
    }
  };
}
