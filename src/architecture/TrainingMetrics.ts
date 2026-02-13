/**
 * Training Metrics System
 *
 * Tracks performance improvements across different optimization strategies:
 * - Back propagation (training)
 * - Fine-tuning
 * - Memetic algorithms
 * - NEAT evolution
 * - Error-Guided Structural Evolution (EGSE)
 */

import { getLogger } from "../utils/Logger.ts";

export interface TrainingMetrics {
  /** Unique identifier for this training session */
  sessionId: string;

  /** Timestamp when metrics collection started */
  startTime: number;

  /** Current best fitness/error */
  currentFitness: number;

  /** Best fitness achieved so far */
  bestFitness: number;

  /** Breakdown of improvements by strategy */
  improvements: {
    backpropagation: ImprovementRecord[];
    fineTuning: ImprovementRecord[];
    memetic: ImprovementRecord[];
    neatEvolution: ImprovementRecord[];
    egse: ImprovementRecord[];
  };

  /** Summary statistics */
  summary: {
    totalImprovements: number;
    bestStrategy: string;
    totalTimeMs: number;
    improvementsPerMinute: number;
  };
}

export interface ImprovementRecord {
  /** Timestamp of improvement */
  timestamp: number;

  /** Fitness before improvement */
  fitnessBefore: number;

  /** Fitness after improvement */
  fitnessAfter: number;

  /** Improvement amount */
  improvement: number;

  /** Percentage improvement */
  improvementPercent: number;

  /** Strategy that caused the improvement */
  strategy: string;

  /** Additional context (e.g., iteration number, generation) */
  context?: Record<string, unknown>;
}

export class TrainingMetricsCollector {
  private metrics: TrainingMetrics;
  private lastFitness: number;

  constructor(sessionId: string, initialFitness: number) {
    this.metrics = {
      sessionId,
      startTime: Date.now(),
      currentFitness: initialFitness,
      bestFitness: initialFitness,
      improvements: {
        backpropagation: [],
        fineTuning: [],
        memetic: [],
        neatEvolution: [],
        egse: [],
      },
      summary: {
        totalImprovements: 0,
        bestStrategy: "none",
        totalTimeMs: 0,
        improvementsPerMinute: 0,
      },
    };
    this.lastFitness = initialFitness;
  }

  /**
   * Record an improvement from a specific strategy
   */
  recordImprovement(
    newFitness: number,
    strategy: keyof TrainingMetrics["improvements"],
    context?: Record<string, unknown>,
  ): boolean {
    if (newFitness <= this.lastFitness) {
      return false; // No improvement
    }

    const improvement = newFitness - this.lastFitness;
    const improvementPercent = (improvement / this.lastFitness) * 100;

    const record: ImprovementRecord = {
      timestamp: Date.now(),
      fitnessBefore: this.lastFitness,
      fitnessAfter: newFitness,
      improvement,
      improvementPercent,
      strategy,
      context,
    };

    this.metrics.improvements[strategy].push(record);
    this.metrics.currentFitness = newFitness;
    this.metrics.bestFitness = Math.max(this.metrics.bestFitness, newFitness);
    this.metrics.summary.totalImprovements++;
    this.lastFitness = newFitness;

    this.updateSummary();
    return true;
  }

  /**
   * Get current metrics
   */
  getMetrics(): TrainingMetrics {
    this.updateSummary();
    return { ...this.metrics };
  }

  /**
   * Get improvement summary by strategy
   */
  getStrategySummary(): Record<string, {
    count: number;
    totalImprovement: number;
    avgImprovement: number;
    bestImprovement: number;
    improvementPercent: number;
  }> {
    const summary: Record<string, {
      count: number;
      totalImprovement: number;
      avgImprovement: number;
      bestImprovement: number;
      improvementPercent: number;
    }> = {};

    for (
      const [strategy, improvements] of Object.entries(
        this.metrics.improvements,
      )
    ) {
      if (improvements.length === 0) {
        summary[strategy] = {
          count: 0,
          totalImprovement: 0,
          avgImprovement: 0,
          bestImprovement: 0,
          improvementPercent: 0,
        };
        continue;
      }

      const totalImprovement = improvements.reduce(
        (sum, imp) => sum + imp.improvement,
        0,
      );
      const bestImprovement = Math.max(
        ...improvements.map((imp) => imp.improvement),
      );
      const avgImprovement = totalImprovement / improvements.length;
      const improvementPercent = (totalImprovement / this.metrics.bestFitness) *
        100;

      summary[strategy] = {
        count: improvements.length,
        totalImprovement,
        avgImprovement,
        bestImprovement,
        improvementPercent,
      };
    }

    return summary;
  }

  /**
   * Print a formatted report
   */
  printReport(): void {
    const summary = this.getStrategySummary();
    const totalTime = Date.now() - this.metrics.startTime;
    const minutes = totalTime / (1000 * 60);

    getLogger().info(
      `\n📊 Training Metrics Report - Session: ${this.metrics.sessionId}`,
    );
    getLogger().info(`⏱️  Total Time: ${minutes.toFixed(1)} minutes`);
    getLogger().info(
      `🎯 Best Fitness: ${this.metrics.bestFitness.toFixed(6)}`,
    );
    getLogger().info(
      `📈 Total Improvements: ${this.metrics.summary.totalImprovements}`,
    );
    getLogger().info(
      `⚡ Improvements/Min: ${
        (this.metrics.summary.totalImprovements / minutes).toFixed(2)
      }`,
    );

    getLogger().info(`\n🔍 Strategy Breakdown:`);
    for (const [strategy, stats] of Object.entries(summary)) {
      if (stats.count > 0) {
        getLogger().info(`  ${strategy}:`);
        getLogger().info(`    Count: ${stats.count}`);
        getLogger().info(
          `    Total Improvement: ${stats.totalImprovement.toFixed(6)}`,
        );
        getLogger().info(
          `    Avg Improvement: ${stats.avgImprovement.toFixed(6)}`,
        );
        getLogger().info(
          `    Best Improvement: ${stats.bestImprovement.toFixed(6)}`,
        );
        getLogger().info(
          `    % of Total: ${stats.improvementPercent.toFixed(1)}%`,
        );
      }
    }

    // Find best strategy
    const bestStrategy = Object.entries(summary)
      .filter(([_, stats]) => stats.count > 0)
      .sort((a, b) => b[1].totalImprovement - a[1].totalImprovement)[0];

    if (bestStrategy) {
      getLogger().info(
        `\n🏆 Best Strategy: ${bestStrategy[0]} (${
          bestStrategy[1].totalImprovement.toFixed(6)
        } total improvement)`,
      );
    }
  }

  private updateSummary(): void {
    const totalTime = Date.now() - this.metrics.startTime;
    const minutes = totalTime / (1000 * 60);

    this.metrics.summary.totalTimeMs = totalTime;
    this.metrics.summary.improvementsPerMinute =
      this.metrics.summary.totalImprovements / minutes;

    // Find best strategy by total improvement
    const strategySummary = this.getStrategySummary();
    const bestStrategy = Object.entries(strategySummary)
      .filter(([_, stats]) => stats.count > 0)
      .sort((a, b) => b[1].totalImprovement - a[1].totalImprovement)[0];

    this.metrics.summary.bestStrategy = bestStrategy ? bestStrategy[0] : "none";
  }
}
