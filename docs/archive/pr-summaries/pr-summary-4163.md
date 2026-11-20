# Experiment: pin what can be read of arXiv 2611.06522 (Issue #4163)

## Summary

This is a follow-up to #4178, which merged the admission-versus-persistence
study harness and its 20-seed negative finding. It changes documentation only.
The evidence page `docs/evidence/admission-persistence-4163.md` now records what
can be verified about the cited paper, arXiv 2611.06522. Facts pinned from
arXiv's own announcement are kept apart from facts that come only from search
excerpts, and the page lists what is still unread. `docs/cspell.json` gains the
author and repository names the page quotes. The worker's handover note for the
interrupted earlier run, `docs/archive/handover/issue-4163.md`, is on this
branch too. Nothing under `src/`, `scripts/` or `test/` changed.

The paper's full method still cannot be read from this host, so this is Part of
#4163.

## Spec

### Intent and Rationale

- The issue says "Read and pin the full method before reproducing it". #4178 had
  only a search engine's summary of the paper. This PR pins the parts that arXiv
  itself published (title, authors, version, categories and the abstract's
  findings), labels the rest as unverified, and names what is not pinned.

### Essential Design Decisions

- Pinned facts come only from arXiv's own announcement text. Search-engine
  excerpts sit under a separate "unverified" heading, and the page notes that
  one excerpt cited #4178 itself, so those excerpts are not independent
  evidence.
- The page still says the harness is **not** a reproduction of the paper. The
  study's `no-benefit` verdict for the 2:1-capped bias points the same way as
  the abstract's "moderate bias matches uniform sampling", but it is recorded as
  neither a replication nor evidence for the paper.

### Undiscoverable Facts

- The egress proxy refuses arXiv and its mirrors. In the earlier run, `curl` to
  `arxiv.org` (abstract, HTML, PDF), `export.arxiv.org`, `web.archive.org` and
  the Semantic Scholar API all failed with
  `CONNECT tunnel failed, response
  403`. In this run, `curl -m 15` to
  `arxiv.org/abs`, `arxiv.org/pdf`, `export.arxiv.org`, a third-party arXiv
  mirror, `huggingface.co/papers` and the Semantic Scholar API each returned no
  HTTP status (`000`).
- The pinned text is arXiv's cs.NE RSS item for 5 November 2026, as committed in
  the public repository `ehijano/rss_fetch`
  (`rss_data/cs.NE/2026-11-05_cs.NE.xml`). Re-read in this run with
  `gh api repos/ehijano/rss_fetch/contents/rss_data/cs.NE/2026-11-05_cs.NE.xml`:
  the item reads `2611.06522v1 Announce Type: new`, and it carries the authors
  "Corrado Calamita, Matteo Mendicini, Luca Ferrari, Riccardo Bertamini" and the
  phrase "moderate bias matches uniform sampling, and strong bias reduces
  QD-score".

## Evidence

Documentation only; no UI files and no code. The record is the "Question and
scope" section and the "What this study does not show" list in
`docs/evidence/admission-persistence-4163.md`. The harness, its tests and the
artefacts (`docs/evidence/admission-persistence-4163.json`,
`docs/evidence/admission-persistence-4163-species.csv`) are unchanged from
#4178.

## Acceptance Criteria

- **missing** — "Read and pin the full method before reproducing it" — reason:
  only arXiv's announcement of the paper could be read, because the egress proxy
  refuses arXiv and its mirrors. Title, authors, version, categories and the
  abstract's findings are pinned. The archive capacities, the persistence
  definition, the candidate signals, the bias rule and its settings, the seeds
  and the statistics are not. The harness is not a reproduction of the paper.

## Test Plan

- No test was added or changed; the diff is documentation only.
- `./quality.sh --rust-scorer-bin=<rust_scorer built from stSoftwareAU/NEAT-AI-scorer 742c5df>`
  ran once, in the foreground, on head `464414b3` (the last commit before this
  summary). It exited 0: 10,577 passed, 0 failed, 50 ignored. The tree was clean
  afterwards, so the format and lint steps changed nothing. The gate does not
  run without a native scorer, and the cached binary had been evicted, so it was
  rebuilt with `cargo build --release -p rust_scorer`.
- Not checked: the paper's full text. See the `missing` entry above.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
