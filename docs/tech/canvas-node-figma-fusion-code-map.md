# Canvas Node And Figma-like Fusion Code Map

Last audited: 2026-06-04 CST

This document organizes the current canvas code around the fusion boundary
defined in [`canvas-node-figma-fusion.md`](./canvas-node-figma-fusion.md).
It is a code ownership map, not a second contract. Runtime truth still lives in
code and type definitions.

## One Truth, Two Lenses

The single durable canvas truth is `PenDocument.pages` plus a valid
`activePageId`.

- Figma-like code owns physical editing: geometry, hierarchy, layout, visual
  style, import/export, rendering, hit testing, and direct property editing.
- Execution-node code owns workflow semantics: Agent run status, step kind,
  evidence, branches, checkpoints, failure recovery, continuation, tool
  write-back, and semantic connector relationships.
- Fusion boundary code is allowed to touch both layers, but must write both
  physical fields and semantic fields through one `PenNode` on the active page.

Do not add an Agent-only canvas store, hidden workflow graph, or fallback reader
that treats stale run trace as canvas truth.

## Core Ownership Table

| Layer | Current code | Owns | Must not own |
| --- | --- | --- | --- |
| Durable document model | `packages/pen-types`, `packages/canvas-core/src/document.ts`, `packages/canvas-core/src/pages.ts`, `packages/canvas-core/src/operations.ts` | `PenDocument`, `PenNode`, page ownership, document operations | UI-only state, Agent run orchestration |
| Figma-like import/fidelity | `packages/pen-figma/src/`, `packages/canvas-core/src/import.ts`, `packages/canvas-core/src/figma-native.ts`, `apps/web/src/components/canvas/use-canvas-clipboard-import.ts` | Boundary normalization from Figma/SVG/clipboard into runtime node fields and import diagnostics | Runtime fallback from deprecated import fields |
| Figma-like editor runtime | `apps/web/src/components/canvas/canvas-runtime-store.ts`, `apps/web/src/components/canvas/canvas-api.ts`, `apps/web/src/components/canvas/use-skia-canvas-api.ts` | Local document state, history, selection, edit commands, public editor API | MCP tool protocol or server persistence policy |
| Figma-like rendering | `packages/pen-renderer/src/`, `apps/web/src/components/canvas/skia-canvas.tsx`, `apps/web/src/components/canvas/use-skia-pointer-interactions.ts` | Flattening, viewport, hit testing, drawing, pointer interaction, text editing | Agent workflow meaning beyond reading node fields |
| Figma-like inspector | `apps/web/src/components/canvas/property-panel/canvas-property-panel.tsx` and nearby property-panel sections | Editable physical fields that renderer/layout/import/export consumes | Controls that write semantic fields without runtime consumers |
| Execution metadata contract | `packages/canvas-core/src/agent-execution.ts` | `meta.agentExecution`, execution kinds/status labels, semantic write/update helpers | Canvas visual layout or MCP tool IO |
| Execution visual layout | `packages/canvas-core/src/agent-execution-layout.ts` | Execution-card sizes, body formatting, generated card presentation, layout normalization | Agent run decisions or property-panel action policy |
| Execution node creation | `apps/server/src/mcp/tools/create-agent-execution-flow.ts`, `create-agent-ask-user-more.ts`, `create-agent-evidence.ts`, `create-agent-variant-branches.ts` | Creating visible execution nodes and connectors on the live page | Parallel run graph persistence |
| Execution write-back | `apps/server/src/mcp/tools/record-agent-tool-call.ts`, `record-agent-critique.ts`, `record-agent-final-deliverable.ts`, web write-back hooks | Updating existing durable execution nodes after runtime events | Reading chat transcript as execution-node truth |
| Execution UI affordances | `apps/web/src/components/canvas/agent-execution-status-overlays.tsx`, `canvas-overlays.tsx`, `property-panel/agent-execution-*.tsx` | Status badges, checkpoint status details, branch cards, supported recovery affordances | Mutating hover/overlay state into document truth |
| Live Agent read/write | `apps/server/src/features/canvas/live-canvas-service.ts`, `apps/server/src/mcp/tools/inspect-canvas-semantic.ts`, `apply-canvas-transaction.ts`, `validate-canvas.ts` | Reading and mutating the current editor document through live RPC | Replacing `PenDocument.pages` with another canvas model |
| Agent prompt/tool routing | `apps/server/src/agent/prompts/cucumber-main.ts`, `apps/server/src/mcp/server.ts`, `apps/server/src/mcp/deepagents-bridge.ts` | Telling Agent which canvas tools to call and registering MCP tools | Canvas document normalization |

## Execution Node Code Flow

New execution-chain creation should follow this path:

1. Agent prompt requests a visible chain, not chat-only output.
2. MCP tool such as `create_agent_execution_flow` reads live page context.
3. Tool creates ordinary `frame` / `text` / `line` nodes.
4. Tool calls `withAgentExecutionNodeSemantics` so the same node receives
   durable `meta.agentExecution`, `runId`, `sessionId`, `agentBinding`,
   `containerRole`, and `contextSlots`.
5. Tool commits nodes and connector lines through `LiveCanvasService`.
6. Web overlays and property panel read the same active-page nodes for status,
   branch, checkpoint, evidence, critique, and continuation actions.

Existing execution-node updates should follow this path:

1. Runtime event or MCP write-back identifies an existing execution node ID.
2. Code validates that the node is the expected `meta.agentExecution.kind`.
3. Code builds the next metadata object.
4. Code calls `getAgentExecutionNodeSemanticUpdates`.
5. Code writes the returned node patch through the current canvas API or live
   transaction path.

## Figma-like Code Flow

Direct visual editing should follow this path:

1. User input, file import, paste, or Agent transaction enters a boundary.
2. Boundary normalizes data into current `PenNode` physical fields.
3. The document is persisted as `PenDocument.pages`.
4. UI edits go through `CanvasApi`; Agent edits go through MCP transactions.
5. Renderer, layout, inspector, export, and semantic inspection read the same
   node fields.

Import diagnostics may preserve source information, but renderer/editor/runtime
decisions should consume normalized physical fields rather than old import
metadata.

## Fusion Hotspots

These files legitimately touch both lenses and should stay especially strict
about single-truth writes:

- `packages/canvas-core/src/agent-execution.ts`: shared semantic boundary for
  execution node metadata plus top-level semantic indexes.
- `packages/canvas-core/src/agent-execution-layout.ts`: execution-node visual
  presentation and load-time layout normalization.
- `apps/web/src/components/canvas/canvas-document-boundary.ts`: document
  normalization boundary before the editor consumes canvas state.
- `apps/web/src/components/canvas/use-canvas-agent-execution-stream-writeback.ts`:
  streaming runtime state written back to durable execution nodes.
- `apps/web/src/components/canvas/use-canvas-prompt-draft-node.ts`: user-goal
  draft nodes that begin an execution chain from the canvas surface.
- `apps/server/src/features/canvas/canvas-element-writer.ts`: generated
  artifacts and final-deliverable updates on existing canvas nodes.
- `apps/server/src/mcp/tools/generate-image.ts` and generation job contracts:
  image jobs may carry `agentExecutionNodeId` for correlation, but the durable
  execution truth remains the target `PenNode`.

## Current Growth Risks

These are organization risks observed during this audit. They are not behavior
bugs by themselves.

| File | Size at audit | Risk | Suggested next extraction |
| --- | ---: | --- | --- |
| `apps/web/src/components/canvas/canvas-overlays.tsx` | 1698 lines | Mixed selection toolbar, checkpoint actions, branch/follow-up UI, and overlay policy in one file | Extract Agent execution overlay policy/state builders from generic selection overlay rendering |
| `packages/canvas-core/src/agent-execution-layout.ts` | 933 lines | Constants, measurement, card creation, connectors, and layout normalization share one module | Split presentation measurement, execution-card node factory, and load-time normalization into named modules |
| `apps/web/src/components/canvas/property-panel/agent-execution-section.tsx` | 511 lines | Section orchestration still holds continuation/action conditions and waiting response UI | Extract action eligibility/continue-target builders and waiting-response form state |
| `apps/server/src/mcp/tools/create-agent-execution-flow.ts` | 598 lines | Schema, MCP handler, flow planning, card creation, and connector creation are bundled | Extract flow plan builder and execution-card/connector factories behind the same tool API |

Because related files are currently dirty in the worktree, source-level
extractions should be done as separate reviewable slices after the active
changes are settled.

## Routing New Work

Use this routing before editing:

| If the change is about... | Start in | Verification bias |
| --- | --- | --- |
| Visual node fields, sizing, transform, style, masks, text, image, vector | Figma-like physical layer | Renderer/layout/property-panel tests |
| Importing Figma/SVG/clipboard data | Import/fidelity layer | Import adapter tests and diagnostics checks |
| Agent step/status/branch/checkpoint semantics | Execution metadata contract | `canvas-core` agent-execution tests |
| Creating visible Agent chains | Execution node creation tools | MCP tool tests plus live canvas smoke if UI-visible |
| Recording tool/critique/final output | Execution write-back tools | MCP write-back tests and property-panel read path |
| Continue/rerun/branch UI | Execution UI affordances | Web component tests and manual canvas action check |
| Agent reads/mutates live canvas | Live Agent read/write | MCP transaction/semantic/validation tests |

## Boundary Checklist For Edits

Before changing fusion code, answer:

1. Which `PenNode` or connector node owns the visible result?
2. Which fields are physical runtime truth?
3. Which fields are semantic runtime truth?
4. Which fields are import/migration input or diagnostics only?
5. Does every UI control write a field consumed by renderer, layout, Agent
   tools, inspector, export, or persistence?
6. Does the Agent path inspect the latest live `PenDocument.pages` before
   mutating?
7. Are connector relationships represented on visible line/connector nodes?
8. Does the failure path show a concrete reason instead of leaking raw IDs,
   `null`, `undefined`, default values, or opaque codes?
