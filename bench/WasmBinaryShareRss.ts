/**
 * Issue #3478: Peak-RSS-at-startup evidence for sharing the WASM binary across
 * worker init messages via `SharedArrayBuffer`.
 *
 * Each `WorkerHandler` embeds the multi-MB WASM binary in its init message.
 * `postMessage` structured-clones the bytes, so an N-worker pool retains N full
 * copies of the binary at startup. Backing the bytes with a `SharedArrayBuffer`
 * makes structured-clone *share* one copy instead.
 *
 * This is a memory (RSS) measurement, not a wall-clock benchmark, so it runs as
 * a plain script rather than `Deno.bench`. It reproduces the per-worker
 * structured-clone retention (copy path) and the SAB-backed retention (shared
 * path) for a large pool and reports the peak-RSS delta of each.
 *
 * Run with:
 *   deno run --allow-read bench/WasmBinaryShareRss.ts [workerCount]
 */
import { loadWasmActivationInitPayload } from "@workers/WasmActivationPayload.ts";

function rssMb(): number {
  return Deno.memoryUsage().rss / (1024 * 1024);
}

function measure(label: string, fn: () => unknown[]): void {
  // Retain the produced clones so the RSS reading reflects live retention,
  // mirroring a running pool that holds every worker's init payload.
  const before = rssMb();
  const retained = fn();
  const after = rssMb();
  // Touch the retained set so the optimiser cannot elide it before we read RSS.
  let checksum = 0;
  for (const item of retained) {
    if (item instanceof Uint8Array) checksum += item.byteLength & 0xff;
  }
  console.log(
    `${label.padEnd(28)} ΔRSS = ${(after - before).toFixed(1)} MB ` +
      `(retained ${retained.length} refs, checksum ${checksum})`,
  );
}

function main(): void {
  const workerCount = Number(Deno.args[0] ?? "16");
  const payload = loadWasmActivationInitPayload();
  if (!payload) {
    console.error(
      "WASM payload unavailable from this checkout; run ./build.sh first.",
    );
    Deno.exit(1);
  }

  const sizeMb = payload.wasmBinary.byteLength / (1024 * 1024);
  console.log(
    `WASM binary: ${
      sizeMb.toFixed(2)
    } MB, simulated pool: ${workerCount} workers\n`,
  );

  // Copy path (before): each worker receives its own structured-clone copy.
  const plain = new Uint8Array(payload.wasmBinary.byteLength);
  plain.set(payload.wasmBinary);
  measure("copy-per-worker (before)", () =>
    Array.from(
      { length: workerCount },
      () => structuredClone(plain),
    ));

  // Shared path (after): all workers share one SharedArrayBuffer.
  const shared = new Uint8Array(
    new SharedArrayBuffer(payload.wasmBinary.byteLength),
  );
  shared.set(payload.wasmBinary);
  measure("shared SAB (after)", () =>
    Array.from(
      { length: workerCount },
      () => structuredClone(shared),
    ));

  console.log(
    `\nExpected: copy path retains ~${
      (sizeMb * workerCount).toFixed(1)
    } MB, shared path retains ~${sizeMb.toFixed(2)} MB.`,
  );
}

main();
