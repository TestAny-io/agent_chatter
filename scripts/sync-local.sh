#!/usr/bin/env bash
set -euo pipefail

mode="run"
base_override=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      mode="check"
      shift
      ;;
    --auto)
      mode="auto"
      shift
      ;;
    --base)
      base_override="${2:-}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: sync-local.sh [--check] [--auto] [--base <branch>]"
      exit 0
      ;;
    *)
      echo "Unknown аргумент: $1"
      exit 1
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" == "HEAD" ]]; then
  echo "Detached HEAD; skip sync."
  exit 0
fi

base="$base_override"
if [[ -z "$base" ]]; then
  base="$(git config --get "branch.${branch}.base" || true)"
fi
if [[ -z "$base" ]]; then
  if [[ "$branch" == "main" || "$branch" == "dev" ]]; then
    base="$branch"
  else
    base="dev"
  fi
fi

if [[ "$mode" == "auto" && "$branch" != "dev" && "$branch" != "main" ]]; then
  exit 0
fi

git fetch origin "$base" --quiet

read -r ahead behind <<<"$(git rev-list --left-right --count HEAD...origin/${base})"

if [[ "$mode" == "check" ]]; then
  if [[ "$behind" -gt 0 ]]; then
    echo "当前分支落后于 origin/${base}（behind=${behind}）。"
    echo "请先执行: scripts/sync-local.sh"
    exit 1
  fi
  exit 0
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "工作区非干净，无法自动同步。请先 commit/stash。"
  exit 1
fi

if [[ "$branch" == "$base" ]]; then
  if [[ "$behind" -gt 0 ]]; then
    git merge --ff-only "origin/${base}"
    echo "已 fast-forward 到 origin/${base}。"
  else
    echo "已是最新 (${branch})。"
  fi
  exit 0
fi

if [[ "$behind" -gt 0 ]]; then
  git rebase "origin/${base}"
  echo "已 rebase 到 origin/${base}。"
else
  echo "已是最新（基线 ${base}）。"
fi
