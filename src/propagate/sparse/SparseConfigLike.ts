/**
 * Structural interface for objects that behave like a SparseConfig.
 *
 * This allows duck-typed objects (e.g. a "trace-all" stub) to be passed
 * where a full SparseConfig instance is not needed, removing the need for
 * unsafe `as unknown` casts.
 *
 * @module
 */

export interface SparseConfigLike {
  traceNeeded(uuid: string): boolean;
  propagateNeeded(uuid: string): boolean;
  updateNeeded(uuid: string): boolean;
}
