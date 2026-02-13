# Refactor: Replace console logging with structured Logger abstraction (#1398)

Closes #1398

## Summary

Replaced ~350 scattered `console.log/info/warn/error/debug` calls across the
codebase with a configurable structured Logger abstraction. Consumers can now
inject a custom logger via `NeatOptions`, control log verbosity with `logLevel`,
or call `setLogger()` globally.

## What Changed

### New Files
- **`src/utils/Logger.ts`** -- `Logger` interface, `LogLevel` type,
  `createConsoleLogger()` factory with level filtering, `SILENT_LOGGER`,
  `getLogger()`/`setLogger()` global accessor pair.
- **`test/utils/Logger.ts`** -- 10 unit tests covering level filtering,
  silent logger, round-trip get/set, argument passthrough, console method
  mapping.
- **`test/config/LoggerConfig.ts`** -- 8 integration tests covering config
  defaults, custom logger injection, `logLevel` filtering, global logger
  propagation, config freeze.

### Config Integration
- **`NeatArguments.ts`** -- Added `logger: Logger` field.
- **`NeatOptions.ts`** -- Added `logger?: Logger` and `logLevel?: LogLevel`
  options (omitted from `NeatOptionsInput` `CoerceNumeric` coercion since
  loggers are not CLI-serialisable).
- **`NeatConfig.ts`** -- Creates default console logger from `logLevel`
  (default `"info"`) or uses the injected `logger`; calls `setLogger()` to
  propagate globally.
- **`mod.ts`** -- Exports `createConsoleLogger`, `getLogger`, `setLogger`,
  `SILENT_LOGGER`, `Logger`, `LogLevel`.

### Console Replacement (46 production files)
Every `console.log(` was mapped to `getLogger().info(`, `console.info(` to
`getLogger().info(`, `console.warn(` to `getLogger().warn(`,
`console.error(` to `getLogger().error(`, `console.debug(` to
`getLogger().debug(`. JSDoc examples containing `console.log` were
preserved unchanged.

## Evidence

- `quality.sh` passes: formatting, linting, type-checking, all **2703 tests
  pass** with 0 failures.
- Final grep confirms zero remaining production `console.*()` calls outside
  `Logger.ts` itself and JSDoc comment blocks.

## Test Plan

- [x] `test/utils/Logger.ts` -- Logger interface and level filtering
- [x] `test/config/LoggerConfig.ts` -- Config integration (custom logger,
      logLevel, global propagation, freeze)
- [x] Full test suite (2703 tests) passes with no regressions
- [x] `deno check` type-checking passes
- [x] `deno fmt --check` formatting passes
- [x] `deno lint` linting passes
