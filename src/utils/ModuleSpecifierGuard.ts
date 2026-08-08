/**
 * Dynamic-import specifier guard (Issue #3685).
 *
 * Two worker entry points hand a caller-supplied specifier straight to
 * `await import()`: the custom cost function
 * (`WorkerProcessor.loadCustomCostFromFile`) and the episode adapter
 * (`EpisodeWorkerProcessor.handleInit`). Both are developer configuration
 * today, but nothing in the type system stops a value sourced from a remote
 * manifest — a downloaded experiment description, a shared job spec — from
 * reaching them, at which point an `https:` or `data:` specifier would execute
 * attacker-supplied code inside the worker.
 *
 * The guard closes that off: only local module specifiers load. Anything
 * carrying a remote or inline-code scheme is rejected before `import()` runs.
 *
 * @module ModuleSpecifierGuard
 */

import { ValidationError } from "@errors/ValidationError.ts";

/**
 * Leading URL scheme, e.g. `https:` in `https://example/a.ts`.
 *
 * The scheme must be at least two characters so a Windows drive letter
 * (`C:\adapters\A.ts`) is read as a filesystem path rather than a `c:` scheme.
 */
const SCHEME_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]+):/;

/** The only scheme permitted on an absolute module URL. */
const ALLOWED_SCHEME = "file:";

/**
 * Assert that `specifier` is a local module specifier — a relative or absolute
 * filesystem path, or a `file:` URL — and is therefore safe to pass to
 * `await import()`.
 *
 * @param specifier The module specifier about to be imported.
 * @param context Short description of the call site, included in the error.
 * @throws {ValidationError} When the specifier is blank, not a string, or
 *   carries any scheme other than `file:`.
 */
export function assertLocalModuleSpecifier(
  specifier: string,
  context: string,
): void {
  if (typeof specifier !== "string" || specifier.trim().length === 0) {
    throw new ValidationError(
      `${context}: module specifier must be a non-empty string.`,
      "OTHER",
    );
  }

  const trimmed = specifier.trim();
  const scheme = SCHEME_PATTERN.exec(trimmed)?.[1].toLowerCase();
  if (scheme !== undefined && `${scheme}:` !== ALLOWED_SCHEME) {
    throw new ValidationError(
      `${context}: module specifier "${trimmed}" uses the "${scheme}:" ` +
        `scheme; only relative/absolute paths and "${ALLOWED_SCHEME}" URLs ` +
        `may be imported.`,
      "OTHER",
    );
  }
}
