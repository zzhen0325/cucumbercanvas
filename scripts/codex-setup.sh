#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() {
  printf '[codex-setup] %s\n' "$*"
}

fail() {
  printf '[codex-setup] ERROR: %s\n' "$*" >&2
  exit 1
}

cd "$ROOT_DIR"

log "workspace: $ROOT_DIR"

command -v node >/dev/null 2>&1 || fail "node is required"
command -v pnpm >/dev/null 2>&1 || fail "pnpm is required"

log "node: $(node --version)"
log "pnpm: $(pnpm --version)"

if [[ ! -f .env.local ]]; then
  log ".env.local is missing; create it from .env.example before running dev services"
fi

log "installing workspace dependencies"
pnpm install

log "setup complete"
