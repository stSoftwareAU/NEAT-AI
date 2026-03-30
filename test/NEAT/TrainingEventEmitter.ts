import { assertEquals } from "@std/assert";
import { emitTrainingEvent } from "@neat/TrainingEventEmitter.ts";
import type {
  SpeciesAdjustedEvent,
  TrainingEvent,
  TrainingEventCallback,
} from "../../src/config/TrainingEvent.ts";

/**
 * Unit tests for TrainingEventEmitter.ts — safe event emission.
 *
 * Issue #1749: Verify that emitTrainingEvent correctly delivers events
 * to callbacks, handles undefined callbacks as no-ops, and silently
 * catches callback exceptions.
 */

// ============================================================================
// Event Delivery
// ============================================================================

Deno.test("TrainingEventEmitter: delivers event to callback", () => {
  const received: TrainingEvent[] = [];
  const callback: TrainingEventCallback = (event) => {
    received.push(event);
  };

  const event: SpeciesAdjustedEvent = {
    kind: "species_adjusted",
    timestamp: new Date().toISOString(),
    speciesCount: 5,
    compatibilityThreshold: 0.3,
  };

  emitTrainingEvent(callback, event);

  assertEquals(received.length, 1, "Callback should receive exactly one event");
  assertEquals(received[0].kind, "species_adjusted");
  assertEquals(
    (received[0] as SpeciesAdjustedEvent).speciesCount,
    5,
  );
});

Deno.test("TrainingEventEmitter: delivers multiple events in sequence", () => {
  const received: TrainingEvent[] = [];
  const callback: TrainingEventCallback = (event) => {
    received.push(event);
  };

  const event1: SpeciesAdjustedEvent = {
    kind: "species_adjusted",
    timestamp: new Date().toISOString(),
    speciesCount: 3,
    compatibilityThreshold: 0.3,
  };

  const event2: SpeciesAdjustedEvent = {
    kind: "species_adjusted",
    timestamp: new Date().toISOString(),
    speciesCount: 7,
    compatibilityThreshold: 0.4,
  };

  emitTrainingEvent(callback, event1);
  emitTrainingEvent(callback, event2);

  assertEquals(received.length, 2, "Callback should receive both events");
  assertEquals((received[0] as SpeciesAdjustedEvent).speciesCount, 3);
  assertEquals((received[1] as SpeciesAdjustedEvent).speciesCount, 7);
});

// ============================================================================
// No-op When Undefined
// ============================================================================

Deno.test("TrainingEventEmitter: no-op when callback is undefined", () => {
  const event: SpeciesAdjustedEvent = {
    kind: "species_adjusted",
    timestamp: new Date().toISOString(),
    speciesCount: 5,
    compatibilityThreshold: 0.3,
  };

  // Should not throw when callback is undefined
  emitTrainingEvent(undefined, event);
});

// ============================================================================
// Error Handling
// ============================================================================

Deno.test("TrainingEventEmitter: silently catches callback exceptions", () => {
  const throwingCallback: TrainingEventCallback = () => {
    throw new Error("Callback exploded!");
  };

  const event: SpeciesAdjustedEvent = {
    kind: "species_adjusted",
    timestamp: new Date().toISOString(),
    speciesCount: 5,
    compatibilityThreshold: 0.3,
  };

  // Should not throw — exception is caught internally
  emitTrainingEvent(throwingCallback, event);
});

Deno.test("TrainingEventEmitter: continues working after callback error", () => {
  let callCount = 0;
  const callback: TrainingEventCallback = (event) => {
    callCount++;
    if (callCount === 1) {
      throw new Error("First call fails");
    }
    // Second call succeeds
    assertEquals(
      (event as SpeciesAdjustedEvent).speciesCount,
      10,
    );
  };

  const event1: SpeciesAdjustedEvent = {
    kind: "species_adjusted",
    timestamp: new Date().toISOString(),
    speciesCount: 5,
    compatibilityThreshold: 0.3,
  };

  const event2: SpeciesAdjustedEvent = {
    kind: "species_adjusted",
    timestamp: new Date().toISOString(),
    speciesCount: 10,
    compatibilityThreshold: 0.3,
  };

  emitTrainingEvent(callback, event1); // Throws internally, caught
  emitTrainingEvent(callback, event2); // Should still work

  assertEquals(callCount, 2, "Callback should be invoked for both events");
});

// ============================================================================
// Different Event Types
// ============================================================================

Deno.test("TrainingEventEmitter: handles discovery_complete event", () => {
  const received: TrainingEvent[] = [];
  const callback: TrainingEventCallback = (event) => {
    received.push(event);
  };

  emitTrainingEvent(callback, {
    kind: "discovery_complete",
    timestamp: new Date().toISOString(),
    outcome: "improved",
    candidateCount: 3,
    elapsedMs: 1500,
  });

  assertEquals(received.length, 1);
  assertEquals(received[0].kind, "discovery_complete");
});

Deno.test("TrainingEventEmitter: handles memory_pressure event", () => {
  const received: TrainingEvent[] = [];
  const callback: TrainingEventCallback = (event) => {
    received.push(event);
  };

  emitTrainingEvent(callback, {
    kind: "memory_pressure",
    timestamp: new Date().toISOString(),
    heapUsed: 500_000_000,
    heapLimit: 1_000_000_000,
    evicted: true,
    pressureLevel: "warning",
  });

  assertEquals(received.length, 1);
  assertEquals(received[0].kind, "memory_pressure");
});
