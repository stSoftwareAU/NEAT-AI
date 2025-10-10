import { assert } from "@std/assert";
import { TrainingMetricsCollector } from "../../src/architecture/TrainingMetrics.ts";

Deno.test("optimization/TrainingMetrics - should track improvements by strategy", () => {
  const collector = new TrainingMetricsCollector("test-session", 0.5);

  // Simulate improvements from different strategies
  const improved1 = collector.recordImprovement(0.6, "backpropagation", {
    iteration: 1,
  });
  const improved2 = collector.recordImprovement(0.7, "fineTuning", {
    generation: 1,
  });
  const improved3 = collector.recordImprovement(0.8, "memetic", {
    mutation: "weight",
  });
  const improved4 = collector.recordImprovement(0.75, "neatEvolution", {
    generation: 2,
  }); // No improvement
  const improved5 = collector.recordImprovement(0.9, "egse", {
    structure: "neuron",
  });

  assert(improved1, "Should record back propagation improvement");
  assert(improved2, "Should record fine-tuning improvement");
  assert(improved3, "Should record memetic improvement");
  assert(!improved4, "Should not record non-improvement");
  assert(improved5, "Should record EGSE improvement");

  const metrics = collector.getMetrics();
  assert(
    metrics.summary.totalImprovements === 4,
    "Should have 4 total improvements",
  );
  assert(metrics.bestFitness === 0.9, "Should track best fitness");

  console.log("✅ Training metrics tracking works correctly");
});

Deno.test("optimization/TrainingMetrics - should provide strategy summary", () => {
  const collector = new TrainingMetricsCollector("test-session", 0.5);

  // Add multiple improvements from same strategy
  collector.recordImprovement(0.6, "backpropagation", { iteration: 1 });
  collector.recordImprovement(0.7, "backpropagation", { iteration: 2 });
  collector.recordImprovement(0.8, "fineTuning", { generation: 1 });

  const summary = collector.getStrategySummary();

  assert(
    summary.backpropagation.count === 2,
    "Should count backpropagation improvements",
  );
  assert(
    Math.abs(summary.backpropagation.totalImprovement - 0.2) < 0.001,
    "Should sum backpropagation improvements",
  );
  assert(
    summary.fineTuning.count === 1,
    "Should count fine-tuning improvements",
  );
  assert(
    Math.abs(summary.fineTuning.totalImprovement - 0.1) < 0.001,
    "Should sum fine-tuning improvements",
  );

  console.log("✅ Strategy summary works correctly");
});

Deno.test("optimization/TrainingMetrics - should identify best strategy", () => {
  const collector = new TrainingMetricsCollector("test-session", 0.5);

  // Add improvements with different magnitudes
  collector.recordImprovement(0.6, "backpropagation", { iteration: 1 }); // +0.1
  collector.recordImprovement(0.8, "memetic", { mutation: "weight" }); // +0.2
  collector.recordImprovement(0.85, "fineTuning", { generation: 1 }); // +0.05

  const metrics = collector.getMetrics();
  assert(
    metrics.summary.bestStrategy === "memetic",
    "Should identify memetic as best strategy",
  );

  console.log("✅ Best strategy identification works correctly");
});
