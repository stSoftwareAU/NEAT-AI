/**
 * Issue #3583 — per-spec diagnostic dump directories.
 *
 * Several specs force a producer-gate compile failure and then resolve "their"
 * dump by file-name prefix. Those prefixes are shared across specs, so when
 * two specs run in parallel against the shared `.diagnostics/` directory one
 * can read the other's dump. Each spec takes its own temporary directory
 * instead, so dump resolution cannot cross spec boundaries.
 */

import { setDiagnosticsDir } from "@utils/Diagnostics.ts";

export interface IsolatedDiagnosticsDir {
  /** The temporary directory diagnostic dumps are written to. */
  dir: string;
  /** Restore the default directory and delete the temporary one. */
  dispose(): void;
}

/**
 * Redirect diagnostic dumps to a fresh temporary directory.
 *
 * @param label - Short spec name, used in the temporary directory name.
 */
export function useIsolatedDiagnosticsDir(
  label: string,
): IsolatedDiagnosticsDir {
  const dir = Deno.makeTempDirSync({ prefix: `neat-diagnostics-${label}-` });
  setDiagnosticsDir(dir);
  return {
    dir,
    dispose() {
      setDiagnosticsDir();
      Deno.removeSync(dir, { recursive: true });
    },
  };
}
