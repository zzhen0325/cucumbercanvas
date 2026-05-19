# Cucumber Studio Progress

Last updated: 2026-05-19 12:16 CST

## Current Session

Goal: initialize a Codex harness framework for the repository.

Status:

- `AGENTS.md` expanded into the project agent operating manual.
- `.codex/config.toml` added for project-level Codex defaults.
- `.codex/rules/default.rules` added to guard destructive or high-risk commands.
- `scripts/codex-setup.sh` and `scripts/codex-check.sh` added as stable harness entry points.
- `package.json` now exposes `pnpm check:quick`, `pnpm check:full`, and `pnpm codex:setup`.
- `docs/architecture.md`, `docs/design-system.md`, and `docs/workflow.md` are the canonical docs for architecture, UI rules, and agent workflow.
- `feature_list.json` tracks feature IDs, status, and priorities.

## Next Targets

1. Keep `feature_list.json` updated whenever a feature moves status or priority.
2. Add deterministic browser/e2e smoke coverage for the canvas flow once seed data is stable.
3. Split provider-specific generation runbooks into `docs/tech/` if image/video provider failures become frequent.
4. Add CI wiring for `pnpm check:quick` and `pnpm check:full` after the local checks are consistently green.

## Handoff Notes

- Existing worktree changes under `apps/server/src/agent/tools/image-generate.ts`, `apps/server/src/worker.ts`, and `apps/server/src/agent/tools/image-generate.test.ts` predate this harness session. Do not revert them unless the user explicitly asks.
- `.env.local` exists locally and must not be edited by default.
- `pnpm-lock.yaml` should remain untouched unless dependency changes are explicitly approved.
- The project is already marked trusted in the user-level Codex config, so `.codex/config.toml` and `.codex/rules/default.rules` should load in future Codex sessions.

## Verification Log

- Passed: `bash -n scripts/codex-setup.sh scripts/codex-check.sh`.
- Passed: `python3 -m json.tool feature_list.json`.
- Passed: Python `tomllib` parse for `.codex/config.toml`.
- Passed: `git diff --check` on harness files.
- Passed: `codex debug prompt-input 'config validation smoke'`.
- Passed: `pnpm exec biome check package.json feature_list.json`.
- Failed: `pnpm check:quick` stops at `pnpm lint` because the repository has existing Biome failures outside the harness files. First examples: `vercel.json`, `apps/server/src/agent/persistence/supabase-checkpointer.ts`, `apps/server/src/agent/backends/dev.ts`, `apps/server/src/agent/deep-agent.ts`, `apps/server/src/agent/tools/brand-kit.ts`.
- Failed: standalone `pnpm typecheck` fails in existing frontend code at `apps/web/src/lib/auth-context.tsx:26` because `expires_at: undefined` is not assignable to Supabase `Session` under `exactOptionalPropertyTypes`.
