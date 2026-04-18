#!/usr/bin/env bash
# Configure Cargo on GitHub Actions so it can fetch git dependencies
# (e.g. the external NEAT-AI-core crate) without requiring any secret
# beyond what org policy already allows.
#
# Issue #2344 — git dependency authentication on CI.
#
# Strategy
# ========
# 1. Set `CARGO_NET_GIT_FETCH_WITH_CLI=true`. This makes cargo shell out
#    to the system `git` binary to fetch git deps, which in turn picks up
#    any `extraheader` credential installed by `actions/checkout@v4`
#    (the `GITHUB_TOKEN`). For a public NEAT-AI-core crate this is
#    enough — no extra secret is required.
#
# 2. If `CARGO_GIT_TOKEN` (preferred) or `GITHUB_TOKEN` is set, install a
#    `url.*.insteadOf` rewrite in `$HOME/.gitconfig` so any
#    `https://github.com/...` URL is fetched with the token. This is
#    used when the core crate is private and the `GITHUB_TOKEN` granted
#    to a workflow does not cover it — you can then wire a deploy key
#    or fine-grained PAT in via repo secrets.
#
# Usage:
#   source scripts/rust-ci-git-auth.sh
#   configure_cargo_git_auth
#
# Safe no-op when invoked without a token: the function only toggles the
# env var and exits, so running it outside CI does not rewrite git URLs
# or touch `~/.gitconfig`.

# Only set strict mode when executed, not when sourced under an existing
# lax shell — `set -u` on an existing shell would break a caller who has
# unset vars in scope.
if [[ "${BASH_SOURCE[0]:-}" == "$0" ]]; then
  set -euo pipefail
fi

configure_cargo_git_auth() {
  # Always prefer the git CLI so extraheader tokens attached by
  # actions/checkout work with cargo's git fetcher.
  export CARGO_NET_GIT_FETCH_WITH_CLI=true

  local token="${CARGO_GIT_TOKEN:-${GITHUB_TOKEN:-}}"
  if [[ -z "$token" ]]; then
    # No secret to install — leave ~/.gitconfig untouched.
    echo "configure_cargo_git_auth: CARGO_NET_GIT_FETCH_WITH_CLI=true (no token — public crate mode)"
    return 0
  fi

  # Validate token shape before embedding into git config. Accept the
  # character class used by all GitHub token formats (ghp_, github_pat_,
  # ghs_, etc.) plus the generic PAT/deploy-key alphabet.
  if [[ ! "$token" =~ ^[A-Za-z0-9_\.-]+$ ]]; then
    echo "configure_cargo_git_auth: refusing to install token with unexpected characters" >&2
    return 1
  fi

  # Install a rewrite that forces token auth for github.com.
  # `x-access-token` is the username convention GitHub documents for PAT
  # usage over HTTPS; it works for fine-grained PATs and GITHUB_TOKEN.
  git config --global \
    "url.https://x-access-token:${token}@github.com/.insteadOf" \
    "https://github.com/"

  echo "configure_cargo_git_auth: git insteadOf installed for github.com"
}

# Allow the script to be executed directly for ad-hoc use:
#   bash scripts/rust-ci-git-auth.sh
if [[ "${BASH_SOURCE[0]:-}" == "$0" ]]; then
  configure_cargo_git_auth
fi
