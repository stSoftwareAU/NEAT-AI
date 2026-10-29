import { assertEquals } from "@std/assert";
import type {
  EventLoopWatchdog,
  EventLoopWatchdogOptions,
  EventLoopWatchdogPhase,
} from "@neat/EventLoopWatchdog.ts";
import { armRunWatchdog } from "../../src/creature/EvolveRunWatchdog.ts";

// Issue #4067: unit tests of the run-level watchdog controller. A recording
// stub stands in for `armEventLoopWatchdog`, so no Worker is spawned, and the
// clocks are injected, so the tests read no real time.

const START_MS = 1_000_000;
const FIRST_GENERATION_DEADLINE_MS = 2_800_000;
const HARD_DEADLINE_MS = 1_900_000;
const REAL_NOW_MS = 50_000_000;
const MARGIN_MS = 300_000;

interface ArmedRecord {
  options: EventLoopWatchdogOptions;
  disarms: number;
  generations: number[];
  phases: EventLoopWatchdogPhase[];
}

function recordingArm(): {
  armed: ArmedRecord[];
  armWatchdog: (options: EventLoopWatchdogOptions) => EventLoopWatchdog;
} {
  const armed: ArmedRecord[] = [];
  const armWatchdog = (
    options: EventLoopWatchdogOptions,
  ): EventLoopWatchdog => {
    const record: ArmedRecord = {
      options,
      disarms: 0,
      generations: [],
      phases: [],
    };
    armed.push(record);
    return {
      disarm(): void {
        record.disarms++;
      },
      setGeneration(generation: number): void {
        record.generations.push(generation);
      },
      setPhase(phase: EventLoopWatchdogPhase): void {
        record.phases.push(phase);
      },
    };
  };
  return { armed, armWatchdog };
}

function params(
  armWatchdog: (options: EventLoopWatchdogOptions) => EventLoopWatchdog,
  injectedNowMS: { value: number },
  timeoutMinutes: number | undefined,
) {
  return {
    timeoutMinutes,
    startMS: START_MS,
    firstGenerationDeadlineMS: FIRST_GENERATION_DEADLINE_MS,
    hardDeadlineMS: HARD_DEADLINE_MS,
    now: () => injectedNowMS.value,
    armWatchdog,
    marginMS: MARGIN_MS,
    realNow: () => REAL_NOW_MS,
  };
}

const FIRST_LINE =
  "[Neat] First generation wedged after 2100s (event loop blocked past the first-generation bound; watchdog killing the process) — first-generation-wedged";
const RUN_LINE =
  "[Neat] Run wedged after 1200s at generation {generation} (event loop blocked past the hard cap; watchdog killing the process)";

Deno.test("armRunWatchdog: no timeout returns a no-op handle and never arms", () => {
  for (const timeoutMinutes of [0, undefined]) {
    const { armed, armWatchdog } = recordingArm();
    const clock = { value: START_MS };
    const handle = armRunWatchdog(params(armWatchdog, clock, timeoutMinutes));
    handle.generationCompleted(1);
    handle.generationCompleted(2);
    handle.disarm();
    assertEquals(armed.length, 0, `timeoutMinutes=${timeoutMinutes}`);
  }
});

Deno.test("armRunWatchdog: arms generation 1 with the first-generation deadline and breach line", () => {
  const { armed, armWatchdog } = recordingArm();
  const clock = { value: 1_000_000 };
  armRunWatchdog(params(armWatchdog, clock, 5));

  assertEquals(armed.length, 1);
  // 50_000_000 + (2_800_000 - 1_000_000) + 300_000
  assertEquals(armed[0].options.deadlineEpochMS, 52_100_000);
  assertEquals(armed[0].options.breachLine, FIRST_LINE);
  assertEquals(armed[0].generations, [0]);
  assertEquals(armed[0].disarms, 0);
});

Deno.test("armRunWatchdog: a run already past the first-generation bound arms at real now plus margin", () => {
  const { armed, armWatchdog } = recordingArm();
  const clock = { value: 3_000_000 };
  armRunWatchdog(params(armWatchdog, clock, 5));

  assertEquals(armed.length, 1);
  // Remaining injected budget is clamped to 0: 50_000_000 + 0 + 300_000.
  assertEquals(armed[0].options.deadlineEpochMS, 50_300_000);
  // The breach time uses now(): (3_000_000 + 300_000 - 1_000_000) / 1000.
  assertEquals(
    armed[0].options.breachLine,
    "[Neat] First generation wedged after 2300s (event loop blocked past the first-generation bound; watchdog killing the process) — first-generation-wedged",
  );
});

Deno.test("armRunWatchdog: completing generation 1 re-arms the hard cap and moves the generation", () => {
  const { armed, armWatchdog } = recordingArm();
  const clock = { value: 1_000_000 };
  const handle = armRunWatchdog(params(armWatchdog, clock, 5));

  handle.generationCompleted(1);

  assertEquals(armed.length, 2);
  assertEquals(
    armed[0].disarms,
    1,
    "the first-generation watchdog is disarmed",
  );
  // 50_000_000 + (1_900_000 - 1_000_000) + 300_000
  assertEquals(armed[1].options.deadlineEpochMS, 51_200_000);
  assertEquals(armed[1].options.breachLine, RUN_LINE);
  assertEquals(armed[1].generations, [1]);
  assertEquals(armed[1].disarms, 0);
});

Deno.test("armRunWatchdog: a completed generation 2 updates the generation without re-arming", () => {
  const { armed, armWatchdog } = recordingArm();
  const clock = { value: 1_000_000 };
  const handle = armRunWatchdog(params(armWatchdog, clock, 5));

  handle.generationCompleted(1);
  handle.generationCompleted(2);

  assertEquals(armed.length, 2, "no third arm");
  assertEquals(armed[1].generations, [1, 2]);
  assertEquals(armed[1].disarms, 0);
});

Deno.test("armRunWatchdog: disarm releases the watchdog and generationCompleted then never re-arms", () => {
  const { armed, armWatchdog } = recordingArm();
  const clock = { value: 1_000_000 };
  const handle = armRunWatchdog(params(armWatchdog, clock, 5));

  handle.disarm();
  handle.disarm();
  handle.generationCompleted(1);

  assertEquals(armed.length, 1, "no re-arm after disarm");
  assertEquals(armed[0].disarms, 1, "disarm is idempotent");
  assertEquals(armed[0].generations, [0], "no generation update after disarm");
});

Deno.test("armRunWatchdog: the run breach line leaves the generation token for the Worker", () => {
  const { armed, armWatchdog } = recordingArm();
  const clock = { value: 1_000_000 };
  const handle = armRunWatchdog(params(armWatchdog, clock, 5));
  handle.generationCompleted(1);

  assertEquals(armed[1].options.breachLine, RUN_LINE);
});

// Issue #4096: the run's in-flight phase is forwarded to the armed handle. The
// two phases differ, so reading the wrong one fails the assertion.

Deno.test("armRunWatchdog: setPhase is forwarded to the armed generation-1 handle", () => {
  const { armed, armWatchdog } = recordingArm();
  const clock = { value: 1_000_000 };
  const handle = armRunWatchdog(params(armWatchdog, clock, 5));

  handle.setPhase("mutation");

  assertEquals(armed.length, 1);
  assertEquals(
    armed[0].phases,
    ["untracked", "mutation"],
    "the initial phase is then the remembered one",
  );
});

Deno.test("armRunWatchdog: re-arming for the hard cap gives the new handle the remembered phase only", () => {
  const { armed, armWatchdog } = recordingArm();
  const clock = { value: 1_000_000 };
  const handle = armRunWatchdog(params(armWatchdog, clock, 5));

  handle.setPhase("mutation");
  handle.generationCompleted(1);

  assertEquals(armed.length, 2);
  assertEquals(
    armed[1].phases,
    ["mutation"],
    "the re-armed handle is given the remembered phase",
  );

  handle.setPhase("breeding");

  assertEquals(
    armed[1].phases,
    ["mutation", "breeding"],
    "later phases go to the new handle",
  );
  assertEquals(
    armed[0].phases,
    ["untracked", "mutation"],
    "the disarmed generation-1 handle gets no later phase",
  );
});

Deno.test("armRunWatchdog: setPhase after disarm forwards nothing", () => {
  const { armed, armWatchdog } = recordingArm();
  const clock = { value: 1_000_000 };
  const handle = armRunWatchdog(params(armWatchdog, clock, 5));

  handle.setPhase("mutation");
  handle.disarm();
  handle.setPhase("breeding");

  assertEquals(armed.length, 1, "no re-arm after disarm");
  assertEquals(
    armed[0].phases,
    ["untracked", "mutation"],
    "no phase forwarded after disarm",
  );
});

Deno.test("armRunWatchdog: with no timeout the no-op handle's setPhase never arms", () => {
  const { armed, armWatchdog } = recordingArm();
  const clock = { value: START_MS };
  const handle = armRunWatchdog(params(armWatchdog, clock, undefined));

  handle.setPhase("mutation");
  handle.generationCompleted(1);
  handle.setPhase("breeding");

  assertEquals(armed.length, 0, "setPhase does not call armWatchdog");
});
