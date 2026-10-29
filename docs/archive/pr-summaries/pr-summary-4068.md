## Summary

`docs/TIMEOUTS.md` explains the main event-loop limit of in-process deadlines,
how to recognise the Worker watchdog’s SIGKILL/137 breach, and a caller-side
per-loop hard kill. The formula includes generation 1’s allowance and the
watchdog margin; T = 6 with a five-minute margin gives 41 minutes. Closes #4068.

The coverage workflow runs all required shard checks for milestone targets,
including documentation PRs. Develop PRs retain the path filter.
`test/ci/CoveragePathScoping.ts` now validates that output expression rather
than requiring the previous filter-only expression.

## Evidence

- Documentation adds the event-loop explanation, breach-line interpretation,
  caller deadline formula and references to the existing watchdog tests.
- CI’s Test Results annotation identified `test/ci/CoveragePathScoping.ts`: the
  validator expected `${{ steps.filter.outputs.code }}` after the workflow
  gained its milestone override. The single-file test reproduced this failure
  locally.
- No runtime code or dependency changes are included.

## Acceptance Criteria

- Met: explain why in-process bounds cannot fire on a blocked main loop and how
  the Worker watchdog and caller-side kill cover that case.
- Met: document exit 137, breach lines and the 41-minute worked example.
- Met: reference `test/NEAT/EventLoopWatchdog_test.ts` and
  `test/creature/EvolveFirstGenerationBusyLoop_test.ts`.
- Partial: the original run recorded a downstream caller issue draft on #4060,
  comment 6226875027; its creation was refused by the cross-repository write
  guard. This CI fix does not change that external outcome.

## Test Plan

- `deno test --allow-read test/ci/CoveragePathScoping.ts < /dev/null`: before
  this fix, 6 passed and 1 failed with the output-expression mismatch; after
  this fix, all 7 pass.
- The edited expression assertion goes red independently when the milestone
  override is removed, its prefix check is inverted, or its filter fallback is
  replaced with unconditional true. Each workflow mutation was restored.
- `deno test --allow-all test/ci/Coverage*.ts < /dev/null`: 55 passed.
- `deno fmt` and `deno lint` on the changed files passed.
- `deno test --allow-all test/ci/*.ts < /dev/null`: 303 passed, 1 failed. The
  unrelated `test/ci/PackageVersionNoDowngrade.ts` reports this milestone’s
  version 7.0.63 behind origin/Develop 7.0.64; left unchanged in this scoped
  fix.
- Twinned rules: no second filter-output assertion was found by the graph search
  for `steps.filter.outputs.code` and `startsWith(github.base_ref` in tests.
  Existing path-filter and merge-guard assertions remain in place.
- Full `./quality.sh < /dev/null` was attempted but exits before running checks
  because the native `rust_scorer` binary is absent. Full runtime and scorer
  suites are therefore unchecked in this CI-fix run.

## Risks and omissions

No production behaviour changes in this CI fix. The full quality gate remains
unverified because its native scorer prerequisite is absent. Dependency bumps
were skipped for this milestone child branch.
