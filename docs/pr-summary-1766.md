## Summary

Remove the "how" test `backpropBuffers field initialised on first propagate`
from `BackpropBufferIntegration.ts`. This test checked internal implementation
details (`creature.state.backpropBuffers === undefined`) rather than observable
behaviour. The remaining two tests in the same file already verify that
buffer-based training produces correct results, making this
implementation-detail check redundant.

This is the final cleanup pass for the propagation module test audit. Addresses
#1766.

## Evidence

The removed test asserted on an internal field
(`creature.state.backpropBuffers`) before and after training. This is a "how"
test — it verifies initialisation mechanics rather than training outcomes. If
the buffer allocation strategy changes, this test would break even though
behaviour is identical.

The two remaining tests in BackpropBufferIntegration.ts verify:

- Multi-level training produces correct results (error < 0.1)
- Wider network training with buffer reuse converges correctly

## Test Plan

- Removed 1 implementation-detail test from
  `test/propagate/BackpropBufferIntegration.ts`
- All 4773 existing tests pass
- `./quality.sh` passes cleanly
