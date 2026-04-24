/**
 * Optional Rust native scorer configuration.
 *
 * When enabled, NEAT-AI may delegate dataset scoring to the external
 * `rust_scorer` binary for improved throughput on large production datasets.
 */
export interface RustScorerConfig {
  /**
   * Enable the external Rust scorer integration.
   *
   * Default: false
   */
  enabled?: boolean;
  /**
   * Path to the scorer executable.
   *
   * Default: "rust_scorer" (resolved via PATH)
   */
  binaryPath?: string;
  /**
   * Optional execution timeout in milliseconds for scorer calls.
   *
   * Default: 0 (no timeout)
   */
  timeoutMs?: number;
  /**
   * Optional environment variables to inject into scorer process.
   */
  env?: Record<string, string>;
  /**
   * Issue #2422: Use directory/batch mode — invoke `rust_scorer` once per
   * generation with a creatures directory rather than once per creature.
   *
   * Default: true (when `enabled` is true).
   */
  batch?: boolean;
}

/**
 * Fully resolved scorer configuration used internally.
 */
export interface RequiredRustScorerConfig {
  enabled: boolean;
  binaryPath: string;
  timeoutMs: number;
  env: Record<string, string>;
  batch: boolean;
}
