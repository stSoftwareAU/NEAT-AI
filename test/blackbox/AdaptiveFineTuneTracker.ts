import {
  assertEquals,
  assertGreater,
  assertGreaterOrEqual,
  assertLessOrEqual,
} from "@std/assert";
import { AdaptiveFineTuneTracker } from "../../src/blackbox/AdaptiveFineTuneTracker.ts";
import { DEFAULT_FINE_TUNE_POPULATION_CONFIG } from "../../src/config/FineTunePopulationConfig.ts";

Deno.test(
  "AdaptiveFineTuneTracker - success rate is NaN with no outcomes",
  () => {
    const tracker = new AdaptiveFineTuneTracker(
      DEFAULT_FINE_TUNE_POPULATION_CONFIG,
    );
    assertEquals(Number.isNaN(tracker.getSuccessRate()), true);
  },
);

Deno.test("AdaptiveFineTuneTracker - success rate tracks correctly", () => {
  const tracker = new AdaptiveFineTuneTracker(
    DEFAULT_FINE_TUNE_POPULATION_CONFIG,
  );
  tracker.recordOutcome(true);
  tracker.recordOutcome(false);
  tracker.recordOutcome(true);
  assertEquals(tracker.getSuccessRate(), 2 / 3);
});

Deno.test("AdaptiveFineTuneTracker - all successes gives rate 1.0", () => {
  const tracker = new AdaptiveFineTuneTracker(
    DEFAULT_FINE_TUNE_POPULATION_CONFIG,
  );
  for (let i = 0; i < 5; i++) {
    tracker.recordOutcome(true);
  }
  assertEquals(tracker.getSuccessRate(), 1.0);
});

Deno.test("AdaptiveFineTuneTracker - all failures gives rate 0.0", () => {
  const tracker = new AdaptiveFineTuneTracker(
    DEFAULT_FINE_TUNE_POPULATION_CONFIG,
  );
  for (let i = 0; i < 5; i++) {
    tracker.recordOutcome(false);
  }
  assertEquals(tracker.getSuccessRate(), 0.0);
});

Deno.test("AdaptiveFineTuneTracker - rolling window evicts old outcomes", () => {
  const tracker = new AdaptiveFineTuneTracker({
    ...DEFAULT_FINE_TUNE_POPULATION_CONFIG,
    successRateWindow: 3,
  });

  // Fill window with successes
  tracker.recordOutcome(true);
  tracker.recordOutcome(true);
  tracker.recordOutcome(true);
  assertEquals(tracker.getSuccessRate(), 1.0);

  // New failures should evict old successes
  tracker.recordOutcome(false);
  tracker.recordOutcome(false);
  tracker.recordOutcome(false);
  assertEquals(tracker.getSuccessRate(), 0.0);
});

Deno.test(
  "AdaptiveFineTuneTracker - outcome count respects window size",
  () => {
    const tracker = new AdaptiveFineTuneTracker({
      ...DEFAULT_FINE_TUNE_POPULATION_CONFIG,
      successRateWindow: 5,
    });
    for (let i = 0; i < 10; i++) {
      tracker.recordOutcome(true);
    }
    assertEquals(tracker.getOutcomeCount(), 5);
  },
);

Deno.test(
  "AdaptiveFineTuneTracker - calculatePopSize uses base fraction when no data",
  () => {
    const tracker = new AdaptiveFineTuneTracker(
      DEFAULT_FINE_TUNE_POPULATION_CONFIG,
    );
    // populationSize=100, currentPop=80, elitism=1, training=0
    // base fraction = 0.2, so ceil(100*0.2) = 20
    // dead slots = 100-80-1-0 = 19
    // max(20, 19) = 20
    const popSize = tracker.calculatePopSize(100, 80, 1, 0);
    assertEquals(popSize, 20);
  },
);

Deno.test(
  "AdaptiveFineTuneTracker - calculatePopSize increases with high success rate",
  () => {
    const tracker = new AdaptiveFineTuneTracker(
      DEFAULT_FINE_TUNE_POPULATION_CONFIG,
    );

    // Record all successes
    for (let i = 0; i < 10; i++) {
      tracker.recordOutcome(true);
    }

    // success rate = 1.0
    // fraction = 0.1 + 1.0 * (0.4 - 0.1) = 0.4
    // adaptive size = ceil(100 * 0.4) = 40
    const popSize = tracker.calculatePopSize(100, 80, 1, 0);
    assertEquals(popSize, 40);
  },
);

Deno.test(
  "AdaptiveFineTuneTracker - calculatePopSize decreases with low success rate",
  () => {
    const tracker = new AdaptiveFineTuneTracker(
      DEFAULT_FINE_TUNE_POPULATION_CONFIG,
    );

    // Record all failures
    for (let i = 0; i < 10; i++) {
      tracker.recordOutcome(false);
    }

    // success rate = 0.0
    // fraction = 0.1 + 0.0 * (0.4 - 0.1) = 0.1
    // adaptive size = ceil(100 * 0.1) = 10
    // dead slots = 100-80-1-0 = 19
    // max(10, 19) = 19
    const popSize = tracker.calculatePopSize(100, 80, 1, 0);
    assertEquals(popSize, 19);
  },
);

Deno.test(
  "AdaptiveFineTuneTracker - dead slots floor ensures minimum population",
  () => {
    const tracker = new AdaptiveFineTuneTracker({
      ...DEFAULT_FINE_TUNE_POPULATION_CONFIG,
      minPopulationFraction: 0.05,
    });

    // Record all failures - fraction will be 0.05
    for (let i = 0; i < 5; i++) {
      tracker.recordOutcome(false);
    }

    // adaptive size = ceil(100 * 0.05) = 5
    // dead slots = 100-50-1-0 = 49
    // max(5, 49) = 49 (dead slots dominate)
    const popSize = tracker.calculatePopSize(100, 50, 1, 0);
    assertEquals(popSize, 49);
  },
);

Deno.test(
  "AdaptiveFineTuneTracker - calculatePopSize bounded between min and max fractions",
  () => {
    const config = {
      minPopulationFraction: 0.1,
      maxPopulationFraction: 0.4,
      basePopulationFraction: 0.2,
      successRateWindow: 10,
    };

    const populationSize = 100;
    const currentPop = 90;
    const elitism = 1;
    const training = 0;

    // Test with various success rates
    for (let successes = 0; successes <= 10; successes++) {
      const tracker = new AdaptiveFineTuneTracker(config);
      for (let i = 0; i < 10; i++) {
        tracker.recordOutcome(i < successes);
      }
      const popSize = tracker.calculatePopSize(
        populationSize,
        currentPop,
        elitism,
        training,
      );
      // Should always be at least min fraction
      assertGreaterOrEqual(
        popSize,
        Math.ceil(populationSize * config.minPopulationFraction),
      );
      // When dead slots are small, should be at most max fraction
      assertLessOrEqual(
        popSize,
        Math.max(
          Math.ceil(populationSize * config.maxPopulationFraction),
          populationSize - currentPop - elitism - training,
        ),
      );
      assertGreater(popSize, 0);
    }
  },
);

Deno.test(
  "AdaptiveFineTuneTracker - mixed outcomes produce intermediate size",
  () => {
    const tracker = new AdaptiveFineTuneTracker(
      DEFAULT_FINE_TUNE_POPULATION_CONFIG,
    );

    // 50% success rate
    for (let i = 0; i < 10; i++) {
      tracker.recordOutcome(i % 2 === 0);
    }

    // success rate = 0.5
    // fraction = 0.1 + 0.5 * (0.4 - 0.1) = 0.25
    // adaptive size = ceil(100 * 0.25) = 25
    // dead slots = 100-90-1-0 = 9
    // max(25, 9) = 25
    const popSize = tracker.calculatePopSize(100, 90, 1, 0);
    assertEquals(popSize, 25);
  },
);
