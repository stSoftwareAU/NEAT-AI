/**
 * Shared constants for Newton-Raphson iteration used by activation functions.
 *
 * Multiple activation functions (GELU, Mish, Swish, BENT_IDENTITY) use
 * Newton-Raphson for their unSquash implementations. This module provides
 * the shared defaults to avoid redundant definitions.
 *
 * Activation functions may override TOLERANCE if they need different
 * convergence precision (e.g. Mish uses 1e-4).
 */

/** Maximum number of Newton-Raphson iterations before giving up. */
export const NR_MAX_ITERATIONS = 100;

/** Default convergence tolerance for Newton-Raphson iteration. */
export const NR_TOLERANCE = 1e-6;
