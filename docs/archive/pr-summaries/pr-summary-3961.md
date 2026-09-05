# PR Summary — Mermaid sequenceDiagram semicolons (Issue #3961)

## Summary

The baseline-carryover tracker reported one pre-existing Mermaid failure in this
repo: the deadline-propagation `sequenceDiagram` in `docs/TIMEOUTS.md` carried a
bare `;` inside message text. Mermaid parses `;` as a statement separator
regardless of surrounding parentheses or `<br/>` tags, so the block fails to
parse and the diagram vanishes from the published page.

Two message lines were affected — the tracker named the first, and the second
surfaced once it was fixed (the validator reports one failure per block):

- `docs/TIMEOUTS.md:213` — `... GRQ #4470;<br/>no-op until 1 generation ...`
- `docs/TIMEOUTS.md:235` —
  `2. terminate() — budgeted; detach what will not stop`

Both semicolons became commas; no wording or diagram structure changed.

A repo-owned regression gate was added so the fault cannot return: this repo now
enforces the rule in its own test suite rather than relying on the fleet
validator to notice it again.

Closes #3961.

## Evidence

Backend/docs change — no web interface to screenshot.

The fleet Mermaid validator (`validateMermaidFile`) was run over every Markdown
file in the repo before and after the edit:

- before —
  `docs/TIMEOUTS.md:199 (sequenceDiagram): Line 14: message text
  contains unescaped ';' which Mermaid parses as a statement separator.`
- after — `OK` (no failures in any Markdown file)

The new repo-owned test reproduces the same finding independently. Against the
unfixed `docs/TIMEOUTS.md` it failed with both offending lines:

```text
Found 2 sequenceDiagram message(s) containing a bare ';' ...
  docs/TIMEOUTS.md:213: evolveDir->>Neat: abandonInFlightPastHardDeadline(...)
  docs/TIMEOUTS.md:235: evolveDir->>Worker: 2. terminate() — budgeted; detach ...
```

After the fix: `ok | 6 passed | 0 failed`.

Full gate:
`./quality.sh --rust-scorer-bin=../NEAT-AI-scorer/target/release/rust_scorer` →
`ok | 8989 passed (5 steps) | 0 failed | 41 ignored (6m16s)`.

## Test Plan

- Added `test/docs/MermaidSequenceDiagramSemicolons.ts`:
  - `Markdown sequenceDiagram messages contain no bare ';' (#3961)` — walks
    every Markdown file under `docs/` plus the root-level `*.md` files and
    reports `file:line` for each offending message.
  - `findSequenceSemicolonOffences flags a ';' inside message text` — the exact
    shape that broke `docs/TIMEOUTS.md`.
  - `findSequenceSemicolonOffences flags a ';' in a Note line`.
  - `findSequenceSemicolonOffences accepts a comma-separated message` — the fix
    shape passes.
  - `findSequenceSemicolonOffences ignores non-sequence diagrams and prose` — a
    `;` in prose, in a flowchart node label, or in a non-Mermaid fence is not
    flagged.
  - `findSequenceSemicolonOffences scans a block behind an init directive` — a
    leading `%%{init ...}%%` directive does not hide the diagram type.
- No existing tests were modified or removed.
