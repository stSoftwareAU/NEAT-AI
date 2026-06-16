# 🔒 Security Policy

## 📌 Summary

This document describes how to **report a vulnerability** in
[NEAT-AI](./AGENTS.md#-terminology) (NeuroEvolution of Augmenting Topologies —
Artificial Intelligence) and what response you can expect. Routine code-review
hygiene (input validation, parameterised queries, secret handling) is enforced
via the **`/security-review` Claude Code skill** that contributors run before
opening a PR (see the secure-coding principles section of
[`AGENTS.md`](./AGENTS.md)) and the in-repo automation listed below:

- **Dependency review** — every PR is scanned by
  [`actions/dependency-review-action`](https://github.com/actions/dependency-review-action)
  via `.github/workflows/dependency-review.yml`. This is PR-diff scoped: it only
  flags dependencies that change within a pull request.
- **Scheduled vulnerability scan** — a weekly OSV scan
  (`.github/workflows/osv-scan.yml`) re-checks the _whole_ resolved dependency
  tree against the [OSV](https://osv.dev/) advisory database, catching CVEs
  disclosed against an already-merged, exact-pinned dependency between bumps. It
  resolves the full dependency tree into a lockfile for the scan. The committed
  `deno.lock` (Issue #2865) pins the exact transitive-dependency versions
  consumed at build time, so a CVE disclosed against any pinned dependency is
  caught even between bumps.
- **Static analysis (SAST)** — Semgrep runs on each PR via
  `.github/workflows/semgrep.yml`.
- **Secret scanning** — `gitleaks` patterns live in `.gitleaks.toml` at the
  repository root.
- **Dependency bumps** — the weekly `deno outdated` job in
  `.github/workflows/deno-outdated.yml` raises automated bump PRs.

For everything else, see the sibling docs: [`README.md`](./README.md),
[`AGENTS.md`](./AGENTS.md), [`CONTRIBUTING.md`](./CONTRIBUTING.md),
[`CHANGELOG.md`](./CHANGELOG.md), and [`docs/README.md`](./docs/README.md).

## 🛡️ Supported Versions

Current version only.

> [!NOTE]
> Only the current published version of `@stsoftware/neat-ai` on JSR receives
> security updates. If you are pinned to an older release, please upgrade to the
> latest version to benefit from the most recent security fixes.

## ⚠️ Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it
responsibly by following these steps:

> [!WARNING]
> Do **not** create a public GitHub issue for security vulnerabilities.
> Responsible disclosure helps protect all users of this project while a fix is
> developed and coordinated.

### 📋 Reporting Process

1. **Do not** create a public GitHub issue for security vulnerabilities.
2. Use GitHub's **private vulnerability reporting** for this repository
   ([Security → Report a vulnerability](https://github.com/stSoftwareAU/NEAT-AI/security/advisories/new)),
   or email the maintainers at
   [security@stsoftware.com.au](mailto:security@stsoftware.com.au) if a
   GitHub-side report is not possible.
3. Include the following information in your report:
   - Description of the vulnerability
   - Steps to reproduce the issue
   - Potential impact assessment
   - Suggested fix (if available)

### ⏱️ Response Timeline

- **Initial Response**: You can expect an acknowledgment within 48 hours
- **Status Updates**: We will provide updates on our investigation every 7 days
- **Resolution**: We aim to resolve critical vulnerabilities within 30 days

> [!TIP]
> If you have not received an acknowledgment within 48 hours, please follow up
> to ensure your report was received.

### 📬 What to Expect

- **If accepted**: We will work with you to understand the issue, develop a fix,
  and coordinate disclosure
- **If declined**: We will provide a clear explanation of why the report does
  not qualify as a security vulnerability

### 🤝 Responsible Disclosure

We request that you:

- Allow us reasonable time to investigate and fix the issue before public
  disclosure
- Avoid accessing or modifying data that doesn't belong to you
- Act in good faith and avoid privacy violations or service disruption

Thank you for helping keep this project secure!

## 🔗 Sibling docs

- **[README.md](./README.md)** — project overview.
- **[AGENTS.md](./AGENTS.md)** — coding conventions (includes secure-coding
  principles).
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — first-time contributor guide.
- **[CHANGELOG.md](./CHANGELOG.md)** — release notes.
- **[docs/README.md](./docs/README.md)** — topic-by-topic documentation index.
