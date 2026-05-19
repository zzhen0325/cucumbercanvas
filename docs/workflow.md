# Engineering Workflow

## Harness Overview

The harness gives every Codex session the same starting contract:

- `AGENTS.md`: operating manual for agents and maintainers.
- `.codex/config.toml`: project-level Codex defaults.
- `.codex/rules/default.rules`: command guardrails for destructive or high-risk operations.
- `scripts/codex-setup.sh`: setup entry point.
- `scripts/codex-check.sh`: quick/full verification entry point.
- `progress.md`: current state, next targets, and handoff notes.
- `feature_list.json`: feature registry with unique IDs, status, and priority.
- `docs/architecture.md`: system map.
- `docs/design-system.md`: UI rules.
- `docs/workflow.md`: this workflow.

## Standard Session Flow

1. Read `AGENTS.md`, `progress.md`, and `feature_list.json`.
2. Check `git status --short` and identify changes that predate the session.
3. Read relevant code, docs, tests, and contracts before editing.
4. Make a short plan for complex tasks.
5. Implement in small, reviewable diffs.
6. Add logs or TODOs only when they improve production diagnosis or handoff clarity.
7. Run focused verification, then `pnpm check:quick` or `pnpm check:full` depending on risk.
8. Update `progress.md` and `feature_list.json` if project status changed.
9. Summarize changed files, checks, and remaining risks.

## Verification Policy

Use the smallest useful check first:

- Documentation/config/script-only changes: syntax checks for TOML, JSON, shell scripts, then `pnpm lint` if Markdown/JSON/package formatting may be touched by Biome.
- Shared contracts or package code: `pnpm typecheck` and relevant package tests.
- Agent/tool changes: relevant unit tests plus `pnpm --filter @cucumber/server test` when possible.
- Frontend UI changes: `pnpm --filter @cucumber/web typecheck`; use browser verification for rendered UI changes.
- Runtime or deployment-affecting changes: `pnpm check:full`.

Root commands:

- `pnpm check:quick`: lint and typecheck.
- `pnpm check:full`: lint, typecheck, tests, and build.

## Feature Registry

Every tracked feature in `feature_list.json` must have:

- `id`: stable unique ID, e.g. `CORE-001`, `HARNESS-001`, `QUALITY-001`.
- `name`: concise feature name.
- `status`: `todo`, `active`, `blocked`, `done`, or `deprecated`.
- `priority`: `P0`, `P1`, `P2`, or `P3`.
- `owner`: owning area or team.
- `summary`: one-sentence scope.
- `artifacts`: key files or docs.

Update the registry when a feature changes state, priority, scope, or ownership.

## Progress Log

Use `progress.md` for handoff, not for exhaustive commit history. It should answer:

- What was this session trying to accomplish?
- What is done?
- What is next?
- What existing changes should not be overwritten?
- Which checks passed or failed?
- What risk remains?

## Command Guardrails

Project rules prompt or block commands that can destroy work, rewrite history, mutate dependencies, deploy, or change databases. If a blocked command is genuinely required, ask the user explicitly and document why in the final summary.

Never work around a guardrail by using a different shell trick for the same operation.

## Documentation Rules

- Keep architecture-level decisions in `docs/architecture.md`.
- Keep UI/product surface rules in `docs/design-system.md`.
- Keep process and handoff rules in `docs/workflow.md`.
- Keep integration-specific runbooks in `docs/tech/`.
- Keep comments in code short and tied to non-obvious behavior.

## Local Setup

Run:

```bash
pnpm codex:setup
```

This verifies Node/pnpm, warns if `.env.local` is missing, and installs workspace dependencies. It does not create or edit secrets.
