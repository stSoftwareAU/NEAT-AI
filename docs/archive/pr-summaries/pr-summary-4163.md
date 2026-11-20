# Experiment: pin the method of arXiv 2611.06522 (Issue #4163)

## Summary

#4178 merged the admission-versus-persistence study harness and its 20-seed
negative finding. #4183 then pinned the abstract of the cited paper, but left
one part of the issue missing: "Read and pin the full method before reproducing
it". The egress proxy still blocks arxiv.org. This PR pins the full method from
a text conversion of arXiv's v1 PDF that is committed in a public GitHub
repository. The page states how the harness differs from that method. Only
documentation changes: the evidence page, the issue's CHANGELOG entry and four
new spelling words. Nothing under `src/`, `scripts/` or `test/` changed. With
this, nothing the issue asks for is left undone. Closes #4163.

## Spec

### Intent and Rationale

- The issue asks for the paper's method to be read and pinned before it is
  reproduced. The harness came first. So the page now pins the method, records
  where the text came from, and compares the harness with the paper point by
  point instead of claiming a reproduction.

### Essential Design Decisions

- The page cites the source as a third-party conversion of arXiv's PDF, not
  arXiv itself. It gives the git blob SHAs and the PDF's SHA-256, so anyone can
  check the text against arXiv later.
- The page gives no figure values, only numbers stated in the text. The
  conversion's `images/` directory is empty.
- The harness bias, `oddsCap ** (1 - r)` with r a rank scaled to [0, 1], is
  stated as a rank-softmax at τ = 1/ln 2 ≈ 1.44 in the paper's notation. The
  page says the [0, 1] rank scaling is inferred from the paper's stated ratio
  exp(1/τ).
- The study is still recorded as neither a replication of the paper nor
  evidence for it.

### Undiscoverable Facts

- arxiv.org is still unreachable from this host. On 2026-11-20, `curl -m 15` to
  `arxiv.org/abs`, `arxiv.org/pdf`, `export.arxiv.org` and
  `semanticscholar.org` returned `000`. A web fetch of
  `arxiv.org/html/2611.06522v1` returned `proxy refused the connection`.
- `gh search code "Predicting Durable Offspring"` found
  `ZhangCurosr/zhangcursor-papers-arxiv-ai-001`. Its directory
  `2026-11-05/From-Admission-to-Retention-Predicting-Durable-Offspring-in_7ae711e2/`
  holds `full.md`, `paper.pdf` and `meta.json`. The `meta.json` `source` is
  `https://arxiv.org/pdf/2611.06522v1.pdf`. In the conversion, the 1024-capacity
  fitness-sweep row of Table 3 reads "r ∈ {0.1, 0.5}". The page reads it as τ.

## Evidence

Documentation only: there are no UI files and no code. The record is the
"Question and scope" section of `docs/evidence/admission-persistence-4163.md`.
It covers provenance, "The paper's method, pinned", "The paper's findings,
pinned" and "How this harness relates to the paper". The "Nothing that confirms
the paper" bullet in "What this does not say" now reflects the read text. The
Issue #4163 entry in `CHANGELOG.md` gains one sentence, and `docs/cspell.json`
gains `Brax`, `Curosr`, `semanticscholar` and `zhangcursor`.

Docs sweep:

- I grepped the evidence page, `README.md`, `docs/README.md` and `CHANGELOG.md`
  for `2611`, `abstract`, `unread`, `not pinned` and `4163`.
- In the evidence page, the only stale sentences were the old "Not pinned"
  paragraph and the "Nothing that confirms the paper" bullet. Both are replaced.
- The `docs/README.md` index entry for the page (lines 173–176) is still true.

## Acceptance Criteria

The issue states no acceptance-criteria heading, and this PR leaves nothing it
asks for undone, so there are no `missing` entries.

## Test Plan

- No test was added or changed, because the diff is documentation only.
- `deno run --no-config --no-lock -A npm:cspell@8 lint --no-progress -c docs/cspell.json docs/evidence/admission-persistence-4163.md CHANGELOG.md`
  reported `Files checked: 2, Issues found: 0 in 0 files.`
- `deno fmt --check` on the three edited files passed.
- `./quality.sh` result: see the run noted below.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
