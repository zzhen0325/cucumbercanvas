#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${1:-quick}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() {
  printf '[codex-check] %s\n' "$*"
}

run_step() {
  local label="$1"
  shift
  log "start: ${label}"
  "$@"
  log "done: ${label}"
}

cd "$ROOT_DIR"

case "$MODE" in
  quick)
    run_step "lint" pnpm lint
    run_step "typecheck" pnpm typecheck
    ;;
  full)
    run_step "lint" pnpm lint
    run_step "typecheck" pnpm typecheck
    run_step "test" pnpm test
    run_step "build" pnpm build
    ;;
  *)
    printf 'Usage: bash scripts/codex-check.sh [quick|full]\n' >&2
    exit 2
    ;;
esac

# TODO(harness): add browser/e2e verification here once the project has a stable
# local seed dataset and a deterministic canvas smoke test.
log "${MODE} check complete"
