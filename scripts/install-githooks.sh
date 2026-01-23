#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"

git config core.hooksPath "${repo_root}/.githooks"
echo "Installed git hooks to ${repo_root}/.githooks"
