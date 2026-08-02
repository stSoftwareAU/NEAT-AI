/**
 * Post-publish provenance gate: prove that the version just published carries a
 * genuine Sigstore transparency-log entry.
 *
 * ## Why this exists (Issue #3333)
 *
 * `@stsoftware/neat-ai` v5.8.0/v5.8.1 were published to JSR with OIDC
 * (`id-token: write`) granted, yet nothing downstream checked that an
 * attestation was actually produced. JSR accepts an unattested publish and
 * stays green, so the failure was *silent* (Issue #3234). This gate makes it
 * loud: it runs on the same workflow run that produced the version and exits
 * non-zero when provenance cannot be positively confirmed.
 *
 * ## Why it verifies Rekor, not JSR (Issue #3633)
 *
 * The gate originally polled JSR's `<version>_meta.json` for a non-null
 * `rekorLogId`. Around 2–3 July 2026 JSR stopped populating that field for
 * **every** package in the registry (`@std/cli`, `@david/dax`, `@hono/hono` and
 * `@stsoftware/neat-ai` alike) — upstream bug jsr-io/jsr#1474. Publish-side
 * attestation still works: `deno publish` mints a real Sigstore entry and
 * prints it, e.g.
 *
 * ```text
 * Provenance transparency log available at https://search.sigstore.dev/?logIndex=2313255666
 * ```
 *
 * So the gate now goes to the authoritative source. It reads that logIndex out
 * of the captured `deno publish` output, looks the entry up in Rekor, and
 * confirms the entry's in-toto attestation names *this* package version
 * (`pkg:jsr/<name>@<version>`) as its subject. JSR's `rekorLogId` is still
 * reported, but informationally only — it can no longer block a release.
 *
 * The gate stays fail-loud in every direction: no transparency-log line in the
 * publish output, no entry in Rekor, or an entry attesting some other artefact
 * all exit non-zero. Absence of a positive confirmation is never success.
 *
 * ## Usage
 *
 * ```sh
 * deno publish 2>&1 | tee publish-output.log
 * deno run --allow-read=deno.json,publish-output.log \
 *   --allow-net=rekor.sigstore.dev,jsr.io \
 *   scripts/verify_provenance.ts publish-output.log
 * ```
 *
 * The functions are pure and take an injectable `fetch`/`sleep` so the logic is
 * unit-tested in `test/ci/VerifyProvenance.ts`; the attestation itself can only
 * occur in the GitHub Actions OIDC context, so the in-workflow post-publish
 * check is the only automatable detection surface.
 */

/** Default Rekor public-good instance. */
export const REKOR_BASE_URL = "https://rekor.sigstore.dev";

/** Upstream tracker for JSR's registry-wide null `rekorLogId` (Issue #3633). */
export const JSR_UPSTREAM_ISSUE = "jsr-io/jsr#1474";

/** Shape of the fields we read from `<name>/<version>_meta.json`. */
export interface VersionMeta {
  /** Sigstore/Rekor transparency-log entry id; null registry-wide since 2026-07. */
  rekorLogId?: string | null;
}

/** The fields we read from a Rekor `GET /api/v1/log/entries` entry. */
export interface RekorEntry {
  logIndex?: number;
  integratedTime?: number;
  /** Base64 in-toto statement; present for attestation (intoto) entries. */
  attestation?: { data?: string };
}

/** A confirmed transparency-log entry for a published version. */
export interface SigstoreVerification {
  /** Rekor entry UUID (the key of the lookup response). */
  uuid: string;
  logIndex: number;
  /** Seconds since epoch the entry was integrated, when Rekor reports it. */
  integratedTime?: number;
  /** The attested subject, e.g. `pkg:jsr/@scope/pkg@1.2.3`. */
  subject: string;
}

export interface VerifyOptions {
  /** Injectable fetch (defaults to global `fetch`). */
  fetchImpl?: typeof fetch;
  /** Service base URL (Rekor or JSR depending on the call). */
  baseUrl?: string;
  /** Total attempts before giving up (default 5). */
  retries?: number;
  /** Delay between attempts in milliseconds (default 4000). */
  delayMs?: number;
  /** Injectable sleep (defaults to a real timer); tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable logger (defaults to console.error). */
  log?: (msg: string) => void;
}

/** `deno publish` prints exactly this line once provenance is minted. */
const LOG_INDEX_PATTERN = /search\.sigstore\.dev\/\?logIndex=(\d+)/g;

/**
 * Read the Sigstore transparency-log index out of captured `deno publish`
 * output. Throws when the marker is absent — a publish that printed no
 * transparency log produced no provenance, which must fail the run rather than
 * pass unnoticed (Issue #3234).
 */
export function extractLogIndex(publishOutput: string): number {
  const matches = [...publishOutput.matchAll(LOG_INDEX_PATTERN)];
  const last = matches.at(-1);
  if (!last) {
    throw new Error(
      "the captured `deno publish` output contains no Sigstore " +
        "transparency-log entry (expected a line like " +
        "`Provenance transparency log available at " +
        "https://search.sigstore.dev/?logIndex=...`). The publish step must " +
        "run `deno publish` on GitHub Actions with `id-token: write` and " +
        "without `--no-provenance`, capturing its output for this gate " +
        "(Issues #3333, #3633).",
    );
  }
  return Number(last[1]);
}

/** The package URL `deno publish` records as the attestation subject. */
export function packageUrl(name: string, version: string): string {
  return `pkg:jsr/${name}@${version}`;
}

/** Build the Rekor entry-lookup URL for a transparency-log index. */
export function rekorEntryUrl(
  logIndex: number,
  baseUrl = REKOR_BASE_URL,
): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/api/v1/log/entries?logIndex=${logIndex}`;
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

/**
 * True only when `meta` is an object carrying a non-empty string `rekorLogId`.
 * Null, undefined, empty string, or a non-string are all "no provenance".
 */
export function hasProvenance(meta: unknown): boolean {
  if (meta === null || typeof meta !== "object") return false;
  const id = (meta as VersionMeta).rekorLogId;
  return typeof id === "string" && id.trim().length > 0;
}

/** Decode a base64 payload as UTF-8 JSON, or `undefined` when unusable. */
function decodeBase64Json(data: string): unknown {
  try {
    const binary = atob(data);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

/**
 * The in-toto subject names a Rekor entry attests. Returns an empty array when
 * the entry carries no decodable attestation — callers treat that as "not
 * proven", never as "fine".
 */
export function attestationSubjects(entry: unknown): string[] {
  if (entry === null || typeof entry !== "object") return [];
  const data = (entry as RekorEntry).attestation?.data;
  if (typeof data !== "string" || data.trim().length === 0) return [];
  const statement = decodeBase64Json(data);
  if (statement === null || typeof statement !== "object") return [];
  const subject = (statement as { subject?: unknown }).subject;
  if (!Array.isArray(subject)) return [];
  return subject
    .map((s) => (s as { name?: unknown })?.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Confirm that `logIndex` names a Rekor entry attesting `name@version`.
 *
 * Transient conditions (entry not queryable yet, HTTP error, transport
 * failure) are retried with a bounded back-off. A retrieved entry that does not
 * match — wrong logIndex, or an attestation naming a different artefact —
 * fails immediately: that is a real mismatch, not propagation lag.
 */
export async function verifySigstoreProvenance(
  name: string,
  version: string,
  logIndex: number,
  options: VerifyOptions = {},
): Promise<SigstoreVerification> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 5;
  const delayMs = options.delayMs ?? 4000;
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? ((m: string) => console.error(m));

  const url = rekorEntryUrl(logIndex, options.baseUrl ?? REKOR_BASE_URL);
  const subject = packageUrl(name, version);

  // One lookup: the entry on success, or a human-readable reason to retry.
  const attemptOnce = async (): Promise<
    { entry: RekorEntry; uuid: string } | { reason: string }
  > => {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) {
        // Consume the body so the connection can be reused/closed cleanly.
        await res.body?.cancel();
        return { reason: `HTTP ${res.status} from ${url}` };
      }
      const body = await res.json() as Record<string, RekorEntry>;
      const entries = Object.entries(body ?? {});
      if (entries.length === 0) {
        return {
          reason: `Rekor returned no transparency-log entry for ${url}`,
        };
      }
      const [uuid, entry] = entries[0];
      return { entry, uuid };
    } catch (error: unknown) {
      return { reason: error instanceof Error ? error.message : String(error) };
    }
  };

  let lastReason = "no attempt was made";
  for (let attempt = 1; attempt <= retries; attempt++) {
    // Sequential polling: each attempt must observe the previous result.
    // deno-lint-ignore no-await-in-loop -- intentional sequential poll.
    const result = await attemptOnce();

    if ("entry" in result) {
      const { entry, uuid } = result;
      if (entry.logIndex !== logIndex) {
        throw new Error(
          `Rekor entry ${uuid} reports logIndex ${
            JSON.stringify(entry.logIndex)
          } but \`deno publish\` printed ${logIndex}; refusing to accept a ` +
            `transparency-log entry that does not match the publish output.`,
        );
      }
      const subjects = attestationSubjects(entry);
      if (!subjects.includes(subject)) {
        throw new Error(
          `Rekor entry ${uuid} (logIndex ${logIndex}) does not attest ` +
            `${subject}; its subjects are ${JSON.stringify(subjects)}. The ` +
            `published artefact has no valid Sigstore provenance.`,
        );
      }
      log(
        `✅ ${name}@${version} has Sigstore provenance: Rekor entry ${uuid} ` +
          `(logIndex ${logIndex}) attests ${subject}.`,
      );
      return {
        uuid,
        logIndex,
        integratedTime: entry.integratedTime,
        subject,
      };
    }

    lastReason = result.reason;
    if (attempt < retries) {
      log(
        `⏳ attempt ${attempt}/${retries}: ${lastReason}; retrying in ` +
          `${delayMs}ms (Rekor may still be integrating the entry).`,
      );
      // deno-lint-ignore no-await-in-loop -- intentional back-off between polls.
      await sleep(delayMs);
    }
  }

  throw new Error(
    `could not confirm a Sigstore transparency-log entry for ${subject} at ` +
      `logIndex ${logIndex} after ${retries} attempt(s): ${lastReason}.`,
  );
}

/**
 * Report JSR's own `rekorLogId` for the version — **informational only**.
 *
 * JSR has recorded null for every package in the registry since ~2 July 2026
 * (upstream jsr-io/jsr#1474), so this can no longer gate a release; Rekor does
 * that. Never throws: a null value or a transport failure is logged and
 * returned as `null` so the release is not blocked by an upstream registry bug.
 */
export async function jsrRekorLogId(
  name: string,
  version: string,
  options: VerifyOptions = {},
): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? ((m: string) => console.error(m));
  const url = metaUrl(name, version, options.baseUrl ?? "https://jsr.io");

  try {
    const res = await fetchImpl(url);
    if (!res.ok) {
      await res.body?.cancel();
      log(
        `ℹ️  JSR meta lookup: HTTP ${res.status} from ${url} (informational).`,
      );
      return null;
    }
    const meta = await res.json() as VersionMeta;
    if (hasProvenance(meta)) {
      const id = meta.rekorLogId as string;
      log(`ℹ️  JSR also records rekorLogId=${id} for ${name}@${version}.`);
      return id;
    }
    log(
      `ℹ️  JSR reports rekorLogId=${
        JSON.stringify(meta.rekorLogId ?? null)
      } for ${name}@${version}. JSR has returned null for every package in ` +
        `the registry since ~2026-07-02 (upstream ${JSR_UPSTREAM_ISSUE}); ` +
        `this is informational and does not affect the gate, which verified ` +
        `the attestation against Rekor directly.`,
    );
    return null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log(`ℹ️  JSR meta lookup failed (${message}); informational only.`);
    return null;
  }
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
  const logPath = Deno.args[0] ?? "publish-output.log";
  try {
    const { name, version } = await readPackageIdentity();
    const publishOutput = await Deno.readTextFile(logPath);
    const logIndex = extractLogIndex(publishOutput);
    await verifySigstoreProvenance(name, version, logIndex);
    // Informational: shows when JSR's registry-wide regression is fixed.
    await jsrRekorLogId(name, version);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Sigstore provenance verification failed: ${message}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
