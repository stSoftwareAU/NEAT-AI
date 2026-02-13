import { assert, assertEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import {
  getLogger,
  type Logger,
  setLogger,
  SILENT_LOGGER,
} from "../../src/utils/Logger.ts";

Deno.test("LoggerConfig - default logger is created when not specified", () => {
  const config = createNeatConfig({});
  assert(config.logger !== undefined, "Logger should be defined");
  assert(typeof config.logger.info === "function");
  assert(typeof config.logger.warn === "function");
  assert(typeof config.logger.error === "function");
  assert(typeof config.logger.debug === "function");
});

Deno.test("LoggerConfig - custom logger is used when provided", () => {
  const messages: string[] = [];
  const custom: Logger = {
    debug(...args) {
      messages.push(`debug:${args.join(",")}`);
    },
    info(...args) {
      messages.push(`info:${args.join(",")}`);
    },
    warn(...args) {
      messages.push(`warn:${args.join(",")}`);
    },
    error(...args) {
      messages.push(`error:${args.join(",")}`);
    },
  };

  const config = createNeatConfig({ logger: custom });
  assertEquals(config.logger, custom);

  config.logger.info("test message");
  assertEquals(messages, ["info:test message"]);
});

Deno.test("LoggerConfig - logLevel controls default logger filtering", () => {
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

    const config = createNeatConfig({ logLevel: "warn" });
    config.logger.debug("d");
    config.logger.info("i");
    config.logger.warn("w");
    config.logger.error("e");

    assertEquals(captured, ["warn", "error"]);
  } finally {
    console.debug = original.debug;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  }
});

Deno.test("LoggerConfig - SILENT_LOGGER can be injected via options", () => {
  const config = createNeatConfig({ logger: SILENT_LOGGER });
  assertEquals(config.logger, SILENT_LOGGER);
  // Should not throw or produce output
  config.logger.info("silent");
  config.logger.error("silent");
});

Deno.test("LoggerConfig - createNeatConfig sets the global logger", () => {
  const originalGlobal = getLogger();
  try {
    const custom: Logger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
    };

    createNeatConfig({ logger: custom });
    assertEquals(getLogger(), custom);
  } finally {
    setLogger(originalGlobal);
  }
});

Deno.test("LoggerConfig - logLevel is ignored when custom logger is provided", () => {
  const messages: string[] = [];
  const custom: Logger = {
    debug() {
      messages.push("debug");
    },
    info() {
      messages.push("info");
    },
    warn() {
      messages.push("warn");
    },
    error() {
      messages.push("error");
    },
  };

  // Even though logLevel is "error", custom logger should receive all calls
  const config = createNeatConfig({ logger: custom, logLevel: "error" });
  config.logger.debug("d");
  config.logger.info("i");
  assertEquals(config.logger, custom);
  assertEquals(messages, ["debug", "info"]);
});

Deno.test("LoggerConfig - config is frozen with logger", () => {
  const config = createNeatConfig({});
  assert(Object.isFrozen(config), "Config should be frozen");
});

Deno.test("LoggerConfig - default logLevel is info", () => {
  const captured: string[] = [];
  const original = {
    debug: console.debug,
    info: console.info,
  };

  try {
    console.debug = () => captured.push("debug");
    console.info = () => captured.push("info");

    const config = createNeatConfig({});
    config.logger.debug("should not appear");
    config.logger.info("should appear");

    // debug should be filtered (default is info)
    assertEquals(captured, ["info"]);
  } finally {
    console.debug = original.debug;
    console.info = original.info;
  }
});
