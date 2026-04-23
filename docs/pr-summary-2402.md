## Summary

Added a `## 🌐 Related Repositories` section to `README.md` that lists all seven
public NEAT-AI-* repositories with one-line descriptions and includes a Mermaid
dependency diagram framed from NEAT-AI's perspective. The block follows the
canonical structure described in stSoftwareAU/NEAT-AI-core#18 (all 7 repos,
brief role descriptions, dependency-direction notes, and a Mermaid graph).
Closes #2402.

## Evidence

This is a documentation-only change. No code, types, or tests are affected.

- `./quality.sh --lint-only < /dev/null` — passes (formatting + linting + bash
  check). The new section was reformatted by `deno fmt` to align table columns;
  structure and content are unchanged.
- README rendered correctly: section placed between `## 📚 Documentation` and
  `## 🤝 Contributions`, consistent with the existing top-level structure.

## Test Plan

- [x] `deno fmt` clean.
- [x] `deno lint` clean.
- [x] `bash` syntax check clean.
- [x] All 7 repo links use the canonical `stSoftwareAU/<repo>` URLs.
- [x] Mermaid block uses `flowchart LR` and renders the dependency arrows
      described in NEAT-AI-core#18.
- [x] No code changes — type-check and unit tests are unaffected by this PR.

## Acceptance Criteria

- [x] README gains a `## Related Repositories` section listing all 7 public
      NEAT-AI-* repos with one-line descriptions and links.
- [x] Section includes a Mermaid dependency diagram.
- [x] Quality gate (lint/format/bash check) still passes.
