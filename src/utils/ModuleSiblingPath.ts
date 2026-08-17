/**
 * Resolve a filesystem path relative to a module URL.
 *
 * Local `file:` loads (repo checkouts) can look beside this package for sibling
 * Rust crates. JSR / HTTPS module URLs have no local sibling tree — callers
 * must treat `null` as "skip this candidate" rather than throwing
 * (Issue #3782).
 */

import { fromFileUrl } from "@std/path/from-file-url";

/**
 * Return a filesystem path for `relativePath` resolved against `baseUrl`, or
 * `null` when `baseUrl` is not a `file:` URL (e.g. `https://jsr.io/...`).
 */
export function pathFromModuleUrl(
  relativePath: string,
  baseUrl: string | URL = import.meta.url,
): string | null {
  try {
    const url = new URL(relativePath, baseUrl);
    if (url.protocol !== "file:") return null;
    return fromFileUrl(url);
  } catch {
    return null;
  }
}
