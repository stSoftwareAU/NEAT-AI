import { assertEquals } from "@std/assert";
import {
  createConsoleLogger,
  getLogger,
  type Logger,
  setLogger,
  SILENT_LOGGER,
} from "../../src/utils/Logger.ts";

Deno.test("createConsoleLogger: default level filters debug", () => {
  const captured: { level: string; args: unknown[] }[] = [];
  const original = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  try {
    console.debug = (...args: unknown[]) =>
      captured.push({ level: "debug", args });
    console.info = (...args: unknown[]) =>
      captured.push({ level: "info", args });
    console.warn = (...args: unknown[]) =>
      captured.push({ level: "warn", args });
    console.error = (...args: unknown[]) =>
      captured.push({ level: "error", args });

    const logger = createConsoleLogger(); // default = "info"
    logger.debug("should not appear");
    logger.info("info message");
    logger.warn("warn message");
    logger.error("error message");

    assertEquals(captured.length, 3);
    assertEquals(captured[0].level, "info");
    assertEquals(captured[1].level, "warn");
    assertEquals(captured[2].level, "error");
  } finally {
    console.debug = original.debug;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  }
});

Deno.test("createConsoleLogger: debug level emits all", () => {
  const captured: string[] = [];
  const original = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  try {
    console.debug = () => captured.push("debug");
    console.info = () => captured.push("info");
    console.warn = () => captured.push("warn");
    console.error = () => captured.push("error");

    const logger = createConsoleLogger("debug");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    assertEquals(captured, ["debug", "info", "warn", "error"]);
  } finally {
    console.debug = original.debug;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  }
});

Deno.test("createConsoleLogger: error level filters info and warn", () => {
  const captured: string[] = [];
  const original = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  try {
    console.debug = () => captured.push("debug");
    console.info = () => captured.push("info");
    console.warn = () => captured.push("warn");
    console.error = () => captured.push("error");

    const logger = createConsoleLogger("error");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    assertEquals(captured, ["error"]);
  } finally {
    console.debug = original.debug;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  }
});

Deno.test("createConsoleLogger: none level silences everything", () => {
  const captured: string[] = [];
  const original = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  try {
    console.debug = () => captured.push("debug");
    console.info = () => captured.push("info");
    console.warn = () => captured.push("warn");
    console.error = () => captured.push("error");

    const logger = createConsoleLogger("none");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    assertEquals(captured.length, 0);
  } finally {
    console.debug = original.debug;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  }
});

Deno.test("createConsoleLogger: warn level filters debug and info", () => {
  const captured: string[] = [];
  const original = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  try {
    console.debug = () => captured.push("debug");
    console.info = () => captured.push("info");
    console.warn = () => captured.push("warn");
    console.error = () => captured.push("error");

    const logger = createConsoleLogger("warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    assertEquals(captured, ["warn", "error"]);
  } finally {
    console.debug = original.debug;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  }
});

Deno.test("SILENT_LOGGER: emits nothing", () => {
  // SILENT_LOGGER should not throw and should not produce output
  SILENT_LOGGER.debug("noop");
  SILENT_LOGGER.info("noop");
  SILENT_LOGGER.warn("noop");
  SILENT_LOGGER.error("noop");
});

Deno.test("getLogger/setLogger: round-trip", () => {
  const original = getLogger();
  try {
    const custom: Logger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
    };
    setLogger(custom);
    assertEquals(getLogger(), custom);
  } finally {
    setLogger(original);
  }
});

Deno.test("setLogger: custom logger receives messages", () => {
  const original = getLogger();
  try {
    const messages: { level: string; args: unknown[] }[] = [];
    const custom: Logger = {
      debug(...args) {
        messages.push({ level: "debug", args });
      },
      info(...args) {
        messages.push({ level: "info", args });
      },
      warn(...args) {
        messages.push({ level: "warn", args });
      },
      error(...args) {
        messages.push({ level: "error", args });
      },
    };

    setLogger(custom);
    const logger = getLogger();
    logger.info("hello", 42);
    logger.error("bad");

    assertEquals(messages.length, 2);
    assertEquals(messages[0].level, "info");
    assertEquals(messages[0].args, ["hello", 42]);
    assertEquals(messages[1].level, "error");
    assertEquals(messages[1].args, ["bad"]);
  } finally {
    setLogger(original);
  }
});

Deno.test("createConsoleLogger: passes arguments through", () => {
  const captured: unknown[][] = [];
  const original = console.info;

  try {
    console.info = (...args: unknown[]) => captured.push(args);

    const logger = createConsoleLogger("info");
    logger.info("message", { key: "value" }, 123);

    assertEquals(captured.length, 1);
    assertEquals(captured[0], ["message", { key: "value" }, 123]);
  } finally {
    console.info = original;
  }
});

Deno.test("createConsoleLogger: each level maps to correct console method", () => {
  const levels: (keyof Logger)[] = ["debug", "info", "warn", "error"];

  for (const level of levels) {
    const captured: string[] = [];
    const original = {
      debug: console.debug,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };

    try {
      console.debug = () => captured.push("debug");
      console.info = () => captured.push("info");
      console.warn = () => captured.push("warn");
      console.error = () => captured.push("error");

      const logger = createConsoleLogger(level);
      logger[level]("test");

      assertEquals(
        captured,
        [level],
        `Level ${level} should map to console.${level}`,
      );
    } finally {
      console.debug = original.debug;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
    }
  }
});
