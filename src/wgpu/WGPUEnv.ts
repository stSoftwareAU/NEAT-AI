/**
 * WebGPU environment flags for optional creature activation acceleration.
 *
 * Important:
 * - By default, we run in "auto" mode: if WebGPU is available, we may use it.
 * - Users can force-disable WebGPU activation for safety/regressions.
 */

type WGPUActivationMode = "auto" | "on" | "off";

function parseWGPUActivationMode(
  value: string | undefined,
): WGPUActivationMode {
  if (!value) return "auto";
  const normalised = value.trim().toLowerCase();
  if (normalised === "0" || normalised === "false" || normalised === "no") {
    return "off";
  }
  if (normalised === "1" || normalised === "true" || normalised === "yes") {
    return "on";
  }
  return "auto";
}

/**
 * Returns true unless WebGPU activation is explicitly disabled.
 *
 * - unset: auto (enabled when available)
 * - 0/false/no: disabled
 * - 1/true/yes: enabled
 */
export function isWGPUActivationEnabled(): boolean {
  try {
    return parseWGPUActivationMode(Deno.env.get("NEAT_WGPU_ACTIVATION")) !==
      "off";
  } catch {
    // If env access is blocked, keep behaviour conservative: do not enable.
    return false;
  }
}

/**
 * When enabled, GPU activation is required; lack of WebGPU support should be
 * treated as an error (useful for CI / `quality.sh` GPU runs).
 *
 * Set via: `NEAT_WGPU_ACTIVATION_STRICT=1`
 */
export function isWGPUActivationStrict(): boolean {
  try {
    const value = Deno.env.get("NEAT_WGPU_ACTIVATION_STRICT");
    if (!value) return false;
    const normalised = value.trim().toLowerCase();
    return normalised === "1" || normalised === "true" || normalised === "yes";
  } catch {
    return false;
  }
}

export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

let cachedAdapterAvailability:
  | { checked: false }
  | { checked: true; available: boolean } = { checked: false };

/**
 * Checks (once) whether a usable WebGPU adapter is available in this runtime.
 *
 * This is intentionally cached to avoid repeated adapter probing.
 */
export async function hasUsableWebGPUAdapterOnce(): Promise<boolean> {
  if (cachedAdapterAvailability.checked) {
    return cachedAdapterAvailability.available;
  }

  let available = false;
  try {
    if (hasWebGPU()) {
      const adapter = await navigator.gpu.requestAdapter();
      available = !!adapter;
    }
  } catch {
    available = false;
  }

  cachedAdapterAvailability = { checked: true, available };
  return available;
}
