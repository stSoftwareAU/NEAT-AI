/**
 * Tracks sequential and concurrent discovery phases for diagnostic reporting.
 */
export class PhaseDiagnostics {
  #currentPhase: string;
  readonly #activeParallelPhases = new Set<string>();

  constructor(initialPhase: string) {
    this.#currentPhase = initialPhase;
  }

  /**
   * Enter a new sequential phase. Any lingering parallel state is cleared.
   */
  enterPhase(phase: string): void {
    this.#currentPhase = phase;
    this.#activeParallelPhases.clear();
  }

  /**
   * Marks the beginning of a concurrent analysis phase and returns a guard
   * that must be called to record completion. Idempotent to simplify finally blocks.
   */
  startParallelPhase(phase: string): () => void {
    this.#activeParallelPhases.add(phase);
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.#activeParallelPhases.delete(phase);
    };
  }

  getCurrentPhase(): string {
    return this.#currentPhase;
  }

  getActiveParallelPhases(): string[] {
    return Array.from(this.#activeParallelPhases).sort();
  }

  snapshot(): {
    currentPhase: string;
    parallelPhases: string[];
  } {
    return {
      currentPhase: this.getCurrentPhase(),
      parallelPhases: this.getActiveParallelPhases(),
    };
  }
}
