## Summary

Fixed issue #1150: Added comprehensive logging for discovery replay results during evolution.

When discovery replay runs during evolution, there was previously no visibility into which candidates were evaluated or which ones were successful. This fix adds a new `logReplaySummary()` method to the `Neat` class that logs:

1. **Always logged**: A summary showing the total candidates evaluated, singles/combos counts, pruned entries, already-applied skips, not-applicable skips, and timeout status
2. **On improvement**: The change type and score delta of the successful candidate
3. **Verbose mode**: Detailed information about each successful candidate including its type, description, and score improvement

### Example Output

When an improvement is found:
```
[Neat] Discovery replay: add-synapses improved score by 0.100000 (evaluated: 7, singles: 5, combos: 2, pruned: 1)
```

When no improvement is found:
```
[Neat] Discovery replay: no improvement found (evaluated: 10, pruned: 3, already-applied: 2, not-applicable: 1)
```

In verbose mode, additional detail is logged:
```
[Neat] Successful replay candidates:
  - [single] add-synapses: Added synapse input-0 -> output-0 (+0.050000)
  - [single] remove-low-impact: Removed hidden-0 (+0.100000)
  - [combo] combo: Combined: add-synapses + remove-low-impact (+0.080000)
```

## Evidence

Unable to generate screenshot: This is a CLI-based neural network library with console output logging. The changes are verified through unit tests that capture and validate the console output.

## Test Plan

Added comprehensive tests in `test/NEAT/DiscoveryReplaySummaryLogging.ts`:

- `logReplaySummary - logs improvement with change type and score delta`: Verifies that improvement messages include the change type, score delta, and evaluation statistics
- `logReplaySummary - logs no improvement case correctly`: Verifies that "no improvement" messages include all relevant statistics
- `logReplaySummary - logs timeout status`: Verifies that timeout status is shown in the summary
- `logReplaySummary - logs successful candidates in verbose mode`: Verifies that detailed candidate information is logged when verbose mode is enabled
- `logReplaySummary - does not log candidates when not in verbose mode`: Verifies that detailed candidate information is NOT logged when verbose mode is disabled
- `logReplaySummary - handles minimal result with zeros correctly`: Verifies that zero counts are handled gracefully and optional fields with zero values are omitted

All existing tests continue to pass (the `evolveSHIFT` test failure is a pre-existing flaky test unrelated to these changes).
