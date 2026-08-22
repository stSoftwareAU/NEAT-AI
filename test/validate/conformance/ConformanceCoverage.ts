/**
 * @module
 *
 * Parser for `test/fixtures/validate/coverage.json` — the manifest that names
 * every throw site (and happy path) in `src/architecture/CreatureValidate.ts`
 * and records how the corpus pins it (Issue #3801).
 *
 * Statuses:
 * - `covered` — at least one case reaches the site and asserts its error.
 * - `shadowed` — an earlier check always fires first, so the site is
 *   unreachable; the case records what actually happens instead.
 * - `not-expressible` — the check tests a TypeScript object identity that no
 *   language-neutral fixture can describe.
 */

export type CoverageStatus = "covered" | "shadowed" | "not-expressible";

/** One validation site and how the corpus accounts for it. */
export interface CoverageSite {
  readonly id: string;
  readonly kind: "throw" | "ok";
  readonly status: CoverageStatus;
  readonly error?: "ValidationError" | "TopologyError";
  readonly reason?: string;
  readonly note?: string;
}

export interface CoverageManifest {
  readonly sites: CoverageSite[];
}

const SITE_KEYS = new Set(["id", "kind", "status", "error", "reason", "note"]);
const STATUSES = new Set<string>([
  "covered",
  "shadowed",
  "not-expressible",
]);

function coverageFail(where: string, message: string): never {
  throw new Error(`Coverage manifest ${where}: ${message}`);
}

function stringField(
  record: Record<string, unknown>,
  key: string,
  where: string,
  required: boolean,
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    if (required) coverageFail(where, `'${key}' is required`);
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    coverageFail(where, `'${key}' must be a non-empty string`);
  }
  return value;
}

function parseSite(value: unknown, where: string): CoverageSite {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    coverageFail(where, "expected an object");
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!SITE_KEYS.has(key)) coverageFail(where, `unknown key '${key}'`);
  }
  const id = stringField(record, "id", where, true) as string;
  const at = `${where} '${id}'`;
  const kind = stringField(record, "kind", at, true) as string;
  if (kind !== "throw" && kind !== "ok") {
    coverageFail(at, "'kind' must be 'throw' or 'ok'");
  }
  const status = stringField(record, "status", at, true) as string;
  if (!STATUSES.has(status)) {
    coverageFail(at, `unknown status '${status}'`);
  }
  const note = stringField(record, "note", at, false);
  if (status !== "covered" && note === undefined) {
    coverageFail(at, `status '${status}' requires a 'note'`);
  }
  const error = stringField(record, "error", at, false);
  if (
    error !== undefined && error !== "ValidationError" &&
    error !== "TopologyError"
  ) {
    coverageFail(at, "'error' must be ValidationError or TopologyError");
  }
  if (kind === "throw" && status === "covered" && error === undefined) {
    coverageFail(at, "a covered throw site must declare its 'error'");
  }
  return {
    id,
    kind,
    status: status as CoverageStatus,
    error: error as CoverageSite["error"],
    reason: stringField(record, "reason", at, false),
    note,
  };
}

/** Parses the manifest, failing loudly on any malformed entry. */
export function parseCoverageManifest(
  text: string,
  fileName: string,
): CoverageManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    coverageFail(fileName, `is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    coverageFail(fileName, "expected an object");
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "sites" && key !== "description") {
      coverageFail(fileName, `unknown key '${key}'`);
    }
  }
  if (!Array.isArray(record.sites)) {
    coverageFail(fileName, "'sites' must be an array");
  }
  const sites = record.sites.map((s, i) =>
    parseSite(s, `${fileName} site[${i}]`)
  );
  const seen = new Set<string>();
  for (const site of sites) {
    if (seen.has(site.id)) {
      coverageFail(fileName, `duplicate site '${site.id}'`);
    }
    seen.add(site.id);
  }
  return { sites };
}
