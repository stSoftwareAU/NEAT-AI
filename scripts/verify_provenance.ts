/**
 * Issue #3333 — verify a freshly published JSR version carries a Sigstore
 * provenance attestation (a non-null `rekorLogId`).
 *
 * ## Why this exists
 *
 * `@stsoftware/neat-ai` v5.8.0 and v5.8.1 were published to JSR from
 * `.github/workflows/publish.yml` with OIDC (`id-token: write`) granted, yet
 * their `<version>_meta.json` recorded `rekorLogId: null` — JSR held no
 * transparency-log entry. The publish step ran `npx jsr publish`, whose npm
 * shim downloads its *own* pinned Deno binary and delegates to `deno publish`,
 * bypassing the job's `setup-deno` v2.x. That indirection is where attestation
 * was silently lost. The fix publishes with the job's installed Deno directly
 * (`deno publish`), which enables Sigstore provenance by default on GitHub
 * Actions.
 *
 * ## Why a gate, not just a fix
 *
 * The original failure mode was *silent* (Issue #3234): JSR accepts an
 * unattested publish and nothing downstream notices. This module polls the JSR
 * version meta endpoint after publishing and exits non-zero when `rekorLogId`
 * is null or missing, so any future regression (CLI swap, OIDC env loss,
 * `--no-provenance` creeping in) turns the publish run red on the same run that
 * produced the unattested version — it fails loud rather than green-and-broken.
 *
 * The functions here are pure and take an injectable `fetch`/`sleep` so the
 * logic is unit-tested in `test/ci/VerifyProvenance.ts`; the real Sigstore
 * attestation itself can only occur in the GitHub Actions OIDC context, so the
 * in-workflow post-publish check is the only automatable detection surface.
 */

/** Shape of the fields we read from `<name>/<version>_meta.json`. */
export interface VersionMeta {
  /** Sigstore/Rekor transparency-log entry id; null/absent means no provenance. */
  rekorLogId?: string | null;
}

export interface VerifyOptions {
  /** Injectable fetch (defaults to global `fetch`). */
  fetchImpl?: typeof fetch;
  /** Registry base URL (defaults to https://jsr.io). */
  baseUrl?: string;
  /** Total attempts before giving up (default 10). */
  retries?: number;
  /** Delay between attempts in milliseconds (default 6000). */
  delayMs?: number;
  /** Injectable sleep (defaults to a real timer); tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable logger (defaults to console.error). */
  log?: (msg: string) => void;
}

/**
 * True only when `meta` is an object carrying a non-empty string `rekorLogId`.
 * Null, undefined, empty string, or a non-string are all "no provenance".
 */
export function hasProvenance(meta: unknown): boolean {
  if (meta === null || typeof meta !== "object") return false;
  const id = (meta as VersionMeta).rekorLogId;
  return typeof id === "string" && id.trim().length > 0;
}

/** Build the JSR version meta URL for a package name and version. */
export function metaUrl(
  name: string,
  version: string,
  baseUrl = "https://jsr.io",
): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/${name}/${version}_meta.json`;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll the JSR meta endpoint until the version reports a non-null `rekorLogId`,
 * returning that id. Throws a descriptive Error if provenance is still absent
 * after all retries, or if the endpoint never returns a usable response — the
 * absence of a positive attestation is treated as failure, never as success
 * (Issue #3234).
 */
export async function verifyProvenance(
  name: string,
  version: string,
  options: VerifyOptions = {},
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? "https://jsr.io";
  const retries = options.retries ?? 10;
  const delayMs = options.delayMs ?? 6000;
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? ((m: string) => console.error(m));

  const url = metaUrl(name, version, baseUrl);

  // One poll attempt: resolve to the rekorLogId on success, or a human-readable
  // reason string on failure. Kept as a helper so the loop awaits exactly once.
  const attemptOnce = async (): Promise<
    { id: string } | { reason: string }
  > => {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) {
        // Consume the body so the connection can be reused/closed cleanly.
        await res.body?.cancel();
        return { reason: `HTTP ${res.status} from ${url}` };
      }
      const meta = (await res.json()) as VersionMeta;
      if (hasProvenance(meta)) return { id: meta.rekorLogId as string };
      return {
        reason: `rekorLogId is ${
          JSON.stringify(meta.rekorLogId ?? null)
        } (no Sigstore attestation)`,
      };
    } catch (error: unknown) {
      return { reason: error instanceof Error ? error.message : String(error) };
    }
  };

  let lastReason = "no attempt was made";
  for (let attempt = 1; attempt <= retries; attempt++) {
    // Sequential polling: each attempt must observe the previous result.
    // deno-lint-ignore no-await-in-loop -- intentional sequential poll.
    const result = await attemptOnce();
    if ("id" in result) {
      log(
        `✅ ${name}@${version} has JSR provenance (rekorLogId=${result.id}).`,
      );
      return result.id;
    }
    lastReason = result.reason;

    if (attempt < retries) {
      log(
        `⏳ attempt ${attempt}/${retries}: ${lastReason}; ` +
          `retrying in ${delayMs}ms (meta endpoint may still be propagating).`,
      );
      // deno-lint-ignore no-await-in-loop -- intentional back-off between polls.
      await sleep(delayMs);
    }
  }

  throw new Error(
    `${name}@${version} has no JSR provenance attestation after ${retries} ` +
      `attempt(s): ${lastReason}. The publish step must run \`deno publish\` ` +
      `on GitHub Actions with \`id-token: write\` so JSR records a Sigstore ` +
      `transparency-log entry (Issue #3333).`,
  );
}

interface DenoJson {
  name?: string;
  version?: string;
}

/** Read `name` and `version` from a deno.json(c) file. */
export async function readPackageIdentity(
  path = "deno.json",
): Promise<{ name: string; version: string }> {
  const text = await Deno.readTextFile(path);
  const json = JSON.parse(text) as DenoJson;
  if (!json.name || !json.version) {
    throw new Error(
      `${path} must define both \`name\` and \`version\`; got ` +
        `${JSON.stringify({ name: json.name, version: json.version })}`,
    );
  }
  return { name: json.name, version: json.version };
}

async function main(): Promise<void> {
  try {
    const { name, version } = await readPackageIdentity();
    await verifyProvenance(name, version);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ JSR provenance verification failed: ${message}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
