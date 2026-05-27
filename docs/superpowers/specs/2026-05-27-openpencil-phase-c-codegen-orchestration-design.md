# OpenPencil Phase C Codegen And Orchestration Design

## Goal

Deliver the first end-to-end Phase C slice for Cucumber Studio:

1. A visual prompt can be planned into a structured, multi-container canvas result.
2. Independent sections can be materialized with bounded concurrency.
3. The generated root container can be exported to design-as-code files for React, HTML, and one additional practical target.

This is intentionally a thin slice. It should prove the product loop before expanding into a full multi-agent runtime or a full native-platform codegen matrix.

## Chosen Approach

Add a small OpenPencil Phase C MCP tool slice around the existing live-canvas boundary. The browser editor remains the document authority through `LiveCanvasService`, and all generated content is written as ordinary `PenDocument` nodes that the current Skia canvas can render, edit, persist, inspect, and export.

The first slice should live near the existing OpenPencil-compatible tools in `apps/server/src/mcp/tools/open-pencil-canvas.ts` unless implementation shows a cleaner adjacent module split, such as `prompt-canvas-orchestration.ts`. Keep registration in `apps/server/src/mcp/server.ts` aligned with the existing MCP registry pattern.

## Alternatives Considered

### Agent Prompt Only

Rely only on system-prompt instructions that tell the main Agent to use `batch_design`, `find_empty_space`, and `codegen_*` in a disciplined sequence.

Benefit: very small code change.

Cost: no true concurrency, weak determinism, and little testable orchestration state. This is not selected because Phase C needs a reliable product loop, not only better prompting.

### Full Orchestrator Runtime

Port OpenPencil's web orchestrator/sub-agent runtime directly into Cucumber's server agent stack.

Benefit: closest to a long-term concurrent design system.

Cost: high blast radius in `apps/server/src/agent/`, stream events, Deep Agents configuration, retries, and UI progress semantics. This should come after the thin slice validates the contract.

### MCP Tool Slice

Expose deterministic planning, bounded concurrent execution, and export through MCP tools that operate on the current live canvas.

Benefit: uses the current Agent runtime, WebSocket live-canvas RPC, Skia editor, and OpenPencil-compatible codegen tools without replacing framework-level orchestration.

Cost: the first iteration has simpler section builders than a full specialist-agent team. This is acceptable for Phase C because the goal is a real end-to-end loop.

## Current Context

Existing foundations:

- `apps/server/src/mcp/tools/open-pencil-canvas.ts` already provides `batch_design`, `batch_get`, `snapshot_layout`, `find_empty_space`, Figma import, style/variable tools, and `read_nodes` / `codegen_plan` / `codegen_submit_chunk` / `codegen_assemble` / `codegen_export`.
- `codegen_export` currently supports direct React and HTML file output from the live canvas selection or explicit node IDs.
- `codegen_assemble` already accepts framework names such as React, Vue, Svelte, HTML, Flutter, SwiftUI, Compose, and React Native, but concrete output quality is strongest for React/HTML today.
- `apps/server/src/features/canvas/live-canvas-service.ts` is the live editor bridge. Canvas tools require the relevant browser canvas to be open and do not silently write stale database state.
- `apps/server/src/agent/prompts/cucumber-main.ts` already positions the canvas as the visual artifact of Agent execution and prefers containerized results for visual or structured work.
- OpenPencil reference code exists under `openpencil/apps/web/src/services/ai/orchestrator*.ts` and `openpencil/packages/pen-mcp/src/tools/codegen-*`, but Phase C should adapt the patterns, not copy the full client-side orchestration stack.

## Product Behavior

Users should be able to ask for a structured visual product, such as a dashboard, landing page, app screen, workflow map, or creative brief, and receive a canvas result that shows how the Agent decomposed and executed the request.

The generated canvas should:

- Create a root container/frame for the full prompt result.
- Create child containers for meaningful sections, screens, or workflow blocks.
- Use spatial position, size, nesting, and connections to express the Agent's plan and data flow.
- Preserve generated nodes as normal editable Pen nodes.
- Attach trace metadata that makes each section's prompt, status, and source plan diagnosable.
- Return enough inserted node IDs for follow-up editing or export.

The same generated root should be exportable to code through the existing design-as-code path.

## Phase C Tool Contract

### `prompt_canvas_plan`

Purpose: turn one visual prompt into a deterministic section plan without writing the canvas.

Inputs:

- `prompt`: user goal.
- `surface`: `desktop`, `mobile`, `dashboard`, `flow`, or `auto`.
- `maxSections`: bounded integer, default 4.
- `exportTargets`: array including `react`, `html`, and optionally one extra target for the slice.
- `pageId`: optional page target.

Output:

- `planId`
- `rootFrame`: name, dimensions, layout intent, and placement intent.
- `sections`: stable `sectionId`, title, role, prompt, region, dependencies, and expected node budget.
- `warnings`: human-readable planning warnings.

The planner must reject empty prompts, impossible section counts, circular dependencies, and unknown export targets with concrete messages.

### `prompt_canvas_execute`

Purpose: materialize a stored plan into the live canvas.

Inputs:

- `planId`
- `concurrency`: bounded integer, default 2.
- `commitMode`: `section` or `final`, default `section`.
- `pageId`: optional page target.

Behavior:

- Re-read the live document before execution starts.
- Find safe empty space or use the plan's placement.
- Insert a root frame/container first.
- Execute dependency-ready sections with bounded concurrency.
- Namespace generated IDs by plan and section.
- Merge each completed section into the latest live document to reduce user-edit stomps.
- Log each section start, success, skip, and failure with `canvasId`, `planId`, `sectionId`, `rootNodeId`, and inserted node IDs.

Output:

- `success`
- `rootNodeId`
- `insertedNodeIds`
- `sectionResults`: `sectionId`, status, inserted IDs, warnings, and error message when failed.
- `exportableNodeIds`: usually the root node ID.

Failures must be explicit. A failed independent section can leave successful sibling sections in place, but dependent sections must be marked skipped with a dependency reason.

### `codegen_export`

Extend direct export from React/HTML to one extra concrete target in this slice. Prefer Vue first because it can reuse the current DOM/CSS mapping and proves multi-platform behavior without solving native layout semantics.

Supported targets for Phase C thin slice:

- `react`
- `html`
- `vue`

Vue output should include:

- `App.vue` or `<ComponentName>.vue`
- scoped or ordinary CSS consistent with the existing CSS emitter
- clear unsupported-node warnings rather than silent placeholder output

Native targets such as Flutter, SwiftUI, Compose, and React Native remain out of scope for this first slice unless they are returned as explicit unsupported-target errors.

## Data Model

No durable schema migration is required.

Generated nodes use existing `PenNode` fields plus metadata on `meta` or the closest existing extension point available in the current schema. Metadata should include:

- `phase: "openpencil-phase-c"`
- `planId`
- `sectionId` when applicable
- `sourcePrompt`
- `orchestrationStatus`
- `generatedAt`

If the current `PenNode` type has no suitable typed metadata field, implementation should add a narrow typed extension in `packages/pen-types` or the local server-side node typing rather than scattering `any`.

## Concurrency And Merge Rules

Concurrency is section-level, not document-write-level.

- Section generation may run in parallel when dependencies are satisfied.
- Live document writes must be serialized.
- Before every write, read the latest live document and verify the root container still exists.
- If the root container was deleted by the user during execution, stop and return a clear error.
- If a section target region is occupied by user-created nodes, place the section in the next safe region and report a placement warning.
- Do not silently overwrite manual user edits.

This keeps the Agent-first canvas model intact while respecting the user's manual canvas changes as context.

## Logging And Diagnostics

Add structured logs with the prefix `[phase-c-orchestration]` for planning, execution, section lifecycle, merge decisions, and export.

Include:

- `canvasId`
- `userId`
- `planId`
- `sectionId`
- `pageId`
- `rootNodeId`
- `concurrency`
- `commitMode`
- inserted node counts
- concrete failure reason

Tool outputs should use readable messages. Do not return raw error codes, `null`, `undefined`, or opaque placeholders in user-facing summaries.

## Error Handling

Expected failures:

- Missing live canvas context.
- Invalid plan ID.
- Unsupported export target.
- Circular or unsatisfied section dependency.
- Root container deleted during execution.
- Section generator produced invalid nodes.
- Codegen cannot map a node type.

Each failure should leave the document in a valid state. Partial success is allowed only when it is accurately reported through `sectionResults`.

## Testing

Add focused tests near the existing MCP coverage:

- Plan validation rejects empty prompt, unknown target, and circular dependencies.
- Plan creation returns stable section IDs and bounded regions.
- Execution honors dependency ordering and bounded concurrency.
- Section failures mark dependents skipped without deleting successful sections.
- Live document writes preserve existing user nodes and insert a root plus child section containers.
- Vue export returns `App.vue` or `<ComponentName>.vue` and CSS files for a simple generated root.
- Existing React/HTML export tests continue passing.

Narrow verification should include:

- `./node_modules/.bin/tsc -p apps/server/tsconfig.json --noEmit`
- Targeted Vitest for `apps/server/src/mcp/tools/open-pencil-canvas.test.ts` or a new adjacent test file.
- Targeted Biome check for touched server files, docs, `progress.md`, and `feature_list.json`.

Run broader web/server checks if implementation touches shared contracts, UI rendering, or runtime event flow.

## Out Of Scope

This first Phase C slice does not include:

- Full Deep Agents framework-level orchestration changes.
- New production database migrations.
- Auth, payment, deployment, or global design token changes.
- Full native codegen for Flutter, SwiftUI, Compose, or React Native.
- Replacing the current chat sidebar or live-canvas RPC model.
- A separate background queue for orchestration plans.
- Browser UI for editing plans before execution.

## Documentation Updates

When implementing this design, update:

- `docs/tech/canvas-design-integration.md` with Phase C behavior.
- `docs/tech/agent-runtime-workflow.md` if the tool inventory or runtime sequence changes.
- `progress.md`.
- `feature_list.json`.

## Acceptance Criteria

Phase C thin slice is complete when:

- A prompt can be converted into a validated section plan.
- The plan can be executed against an open live canvas and creates durable containerized Pen nodes.
- Independent sections execute with bounded concurrency while writes remain serialized and diagnosable.
- Partial failures are reported with section-level status and do not corrupt the document.
- The generated root can be exported to React, HTML, and Vue files.
- TypeScript passes for affected workspaces.
- Relevant tests pass.
- Lint passes for touched files, or unrelated existing diagnostics are called out with paths.
- `progress.md` and `feature_list.json` reflect the implemented Phase C status.
