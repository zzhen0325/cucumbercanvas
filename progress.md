# Cucumber Studio Progress

Last updated: 2026-05-20 14:16 CST

## Current Session

Goal: turn canvas selections into true agent context while documenting the broader canvas refactor plan.

Status:

- Added `docs/tech/canvas-agent-context-refactor.md` to define the phased canvas refactor plan covering true context, media container consistency, tooling layout, and agent trace projection.
- Added structured `canvasContextRefs` to the shared run-create contract and threaded the new field through the web client, HTTP run route, and agent runtime.
- Selected canvas text, images, videos, and generic shapes are now serialized into explicit runtime XML via `<selected_canvas_context>` instead of relying on UI-only selection state.
- Chat input now surfaces selected canvas content as visible context chips so users can see what will be sent before submitting a run.
- Completed the first visible Phase 2 media interaction step: finished video elements now play directly inside the canvas container, and the old detached `VideoPlayerPanel` path has been removed.
- Added a first-cut selected-element floating toolbar for image, video, text, and shape containers, with inline `问 Agent`, download, and delete actions anchored above the active element.
- Fixed the main image ratio regression path: generated or agent-inserted images now preserve their real aspect ratio when inserted into a placement box or when replacing an image-generator placeholder.
- Entered Phase 3: the primary canvas creation toolbar now sits on the left edge in a vertically centered rail, while the bottom bar remains a separate utility strip for global actions.
- Refined the Phase 3 utility layout: the global background/layers/files/zoom controls now live in a compact left-side secondary rail near the bottom, creating a clearer separation between creation tools and canvas-wide controls.
- Started Phase 4 with a minimum viable agent trace projector: run lifecycle and tool lifecycle stream events now create/update right-side canvas trace frames and tool nodes so agent execution becomes visible on the canvas itself.
- Enhanced Phase 4 trace projection: tool-complete events now create sidecar artifact summary nodes, runs are lightly connected with arrows, and the left utility rail now exposes trace recording toggle and trace clearing controls.
- Extended Phase 4 again with visual artifact previews and click-to-expand trace details: image artifacts now render as Excalidraw image previews, video artifacts render as inline embeddables, and selecting a trace node or preview opens a detail panel with input/output/artifact context.
- Added trace-to-chat linking: selecting a canvas trace node now opens the chat sidebar and scrolls to the matching tool block, while clicking a tool block can jump back to the corresponding trace node on the canvas.
- Refined trace navigation further: the detail panel now exposes an explicit jump-to-chat action, and the canvas applies a weak same-run highlight so related trace nodes remain legible while the active tool stays primary.
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
2. Continue Phase 2 of the canvas refactor: media container consistency, inline video playback, and element-level floating toolbars.
3. Add deterministic browser/e2e smoke coverage for the canvas flow once seed data is stable.
4. Split provider-specific generation runbooks into `docs/tech/` if image/video provider failures become frequent.
5. Add CI wiring for `pnpm check:quick` and `pnpm check:full` after the local checks are consistently green.

## Handoff Notes

- Existing worktree changes under `apps/server/src/agent/tools/image-generate.ts`, `apps/server/src/worker.ts`, and `apps/server/src/agent/tools/image-generate.test.ts` predate this harness session. Do not revert them unless the user explicitly asks.
- `.env.local` exists locally and must not be edited by default.
- `pnpm-lock.yaml` should remain untouched unless dependency changes are explicitly approved.
- The project is already marked trusted in the user-level Codex config, so `.codex/config.toml` and `.codex/rules/default.rules` should load in future Codex sessions.
- The current shipped slices of the canvas refactor are Phase 1 plus Phase 2 media changes, a Phase 3 layout pass, and a richer Phase 4 trace projection: structured selection context for agent runs, inline video playback, a first-cut selected-element floating toolbar, image aspect-ratio preservation for generated/inserted images, a left-side vertically centered creation toolbar, a left-side secondary utility rail for global controls, right-side agent trace frames/tool nodes, visual artifact previews, light trace connectors, trace toggle/clear controls, click-to-expand trace detail panels, trace-to-chat linking, and same-run weak highlighting. Richer toolbar actions and more advanced trace filtering/collapse behaviors are still pending.

## Verification Log

- Passed: `pnpm --filter @cucumber/web test -- canvas-normalize.test.ts` (the package script ran the web test suite: 14 files, 46 tests).
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/web build`.
- Passed: `pnpm --filter @cucumber/shared test`.
- Passed: `pnpm --filter @cucumber/shared build`.
- Passed: `pnpm --filter @cucumber/server typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck`.
- Passed: `pnpm --filter @cucumber/web typecheck` after adding the selected-element floating toolbar to `canvas-tool-menu.tsx`.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/canvas-elements.test.ts test/canvas-normalize.test.ts`.
- Passed: `pnpm --filter @cucumber/web typecheck` after fitting image insert/replace flows to the real media aspect ratio.
- Passed: `pnpm --filter @cucumber/web typecheck` after moving the primary canvas toolbar into a left-side vertical rail.
- Passed: `pnpm --filter @cucumber/web typecheck` after converting the utility controls into a left-side secondary rail.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/agent-trace-projector.test.ts test/canvas-elements.test.ts test/canvas-normalize.test.ts`.
- Passed: `pnpm --filter @cucumber/web typecheck` after wiring stream events into the minimum viable agent trace projector.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/agent-trace-projector.test.ts test/canvas-elements.test.ts test/canvas-normalize.test.ts` after adding artifact sidecars and trace controls.
- Passed: `pnpm --filter @cucumber/web typecheck` after adding artifact sidecars, light trace connectors, and trace toggle/clear controls.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/agent-trace-projector.test.ts test/canvas-elements.test.ts test/canvas-normalize.test.ts` after adding visual artifact previews and trace detail panels.
- Passed: `pnpm --filter @cucumber/web typecheck` after wiring visual artifact previews and click-to-expand trace detail panels.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/agent-trace-projector.test.ts test/canvas-elements.test.ts test/canvas-normalize.test.ts` while keeping existing trace/media tests green after trace-to-chat linking.
- Passed: `pnpm --filter @cucumber/web typecheck` after wiring trace node <-> chat tool block linking.
- Passed: `pnpm --filter @cucumber/web exec vitest run test/agent-trace-projector.test.ts test/canvas-elements.test.ts test/canvas-normalize.test.ts` after adding detail-panel jump-to-chat and same-run weak highlighting.
- Passed: `pnpm --filter @cucumber/web typecheck` after adding detail-panel jump-to-chat and same-run weak highlighting.
- Passed: `apps/server/src/agent/runtime.test.ts` inside the server test run.
- Passed: `pnpm --filter @cucumber/web typecheck` after removing `VideoPlayerPanel` and switching video playback to the inline canvas player.
- Failed: `pnpm --filter @cucumber/server test -- src/agent/runtime.test.ts` still triggers existing unrelated integration-suite failures in `src/agent/real-image-generation-chain.integration.test.ts` (missing Supabase/Volcengine env) and `src/queue/task-manager.integration.test.ts` (`initdb` missing on host), even though the new runtime test itself passes.
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
