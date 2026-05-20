# Cucumber Studio Progress

Last updated: 2026-05-20 12:22 CST

## Current Session

Goal: polish canvas presentation and remove Excalidraw hand-drawn defaults from canvas output.

Status:

- Canvas shell styling is now scoped under the canvas editor and gives Excalidraw panels a cleaner product-surface treatment.
- Loaded, synced, pasted/imported, and converted video elements are normalized to sans-serif text, solid fill, solid connector strokes, and `roughness: 0`.
- Excalidraw current-item defaults now prefer solid fill/strokes, sharp arrows, sans-serif text, and a theme-aware canvas background.
- Focused web tests cover the normalization path for legacy Virgil/hachure/dashed content.
- Seedance 3.0 Pro is now available as a Volcengine video model (`bytedance/seedance-3.0-pro`) with 5s/10s frame mapping, first-frame image-to-video support, provider logs, and model-limit metadata for UI/tool selection.

Previous session:

- Agent image jobs now create a grouped canvas structure immediately: original user request, optimized tool prompt, and a generating image placeholder.
- The three containers and their arrows share a group id so users can move/copy/delete the creative workflow as one unit.
- Worker success replaces the placeholder in place and rewires arrow bindings to the final image element.
- Runtime polling still handles synchronous completion and pushes `canvas.sync`; worker-side replacement preserves results after agent wait timeouts.
- Failure paths mark the image placeholder with a concrete error message instead of leaving a silent or code-only state.
- Seedream image prompts are normalized before provider calls: max 800 characters, symbol characters such as `$`/emoji removed, whitespace collapsed, and normalization metadata logged.
- Focused tests cover group creation, placeholder replacement, and failure marking.

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

- Passed: `pnpm --filter @cucumber/web test -- canvas-normalize.test.ts` (the package script ran the web test suite: 14 files, 46 tests).
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/web build`.
- Passed: `pnpm exec biome check apps/web/src/lib/canvas-normalize.ts apps/web/test/canvas-normalize.test.ts apps/web/src/app/globals.css apps/server/src/agent/tools/canvas-element-helpers.ts`.
- Blocked: Browser visual validation could not reach a usable canvas. The Browser plugin timed out on navigation after the first dev compile, the authenticated `/canvas` route redirected to login without dev auth, and local dev project creation against the skip-auth server returned `project_create_failed`.
- Passed: `pnpm --filter @cucumber/server test src/generation/providers/seedance-video.test.ts`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Passed: `pnpm exec biome check apps/server/src/generation/providers/seedream.ts apps/server/src/generation/providers/seedance-video.test.ts apps/server/src/generation/providers/registry.ts apps/server/src/http/video-models.ts apps/server/src/http/generate.ts apps/server/src/agent/tools/video-generate.ts`.
- Passed: `pnpm --filter @cucumber/server build`.
- Passed: `pnpm --filter @cucumber/web build`.
- Failed: `pnpm exec biome check apps/web/src/lib/server-api.ts apps/web/src/lib/canvas-video-generator.ts apps/web/src/components/canvas/video-generator-panel.tsx` still reports existing `any`, import ordering, and SVG accessibility lint debt in those files.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/server test src/features/canvas/canvas-element-writer.test.ts src/generation/providers/seedream-prompt.test.ts src/agent/tools/image-generate.test.ts`.
- Passed: `pnpm exec biome check apps/server/src/generation/providers/seedream-prompt.ts apps/server/src/generation/providers/seedream-prompt.test.ts apps/server/src/generation/providers/seedream.ts apps/server/src/agent/tools/image-generate.ts apps/server/src/features/jobs/executors/image-generation.ts apps/server/src/features/canvas/canvas-element-writer.ts apps/server/src/features/canvas/canvas-element-writer.test.ts apps/server/src/agent/runtime.ts apps/server/src/agent/tools/video-generate.ts feature_list.json`.
- Passed: `pnpm --filter @cucumber/server build`.
- Failed: full `pnpm lint` still reports existing repository-wide Biome issues outside this change, including `apps/server/src/agent/backends/dev.ts`, `apps/server/src/agent/persistence/supabase-checkpointer.ts`, `apps/server/src/agent/deep-agent.ts`, `apps/server/src/agent/tools/brand-kit.ts`, and `vercel.json`.
