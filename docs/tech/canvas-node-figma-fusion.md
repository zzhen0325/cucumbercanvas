# Canvas Node And Figma-like Fusion

Last updated: 2026-06-04 CST

This note defines how Cucumber Studio should merge two canvas capabilities that can otherwise drift apart:

- Figma-like direct editing: precise visual editing, hierarchy, layout, style, assets, components, variables, and exportable design structure.
- Node-system execution: Agent plans, tool calls, evidence, branches, checkpoints, dataflow, continuation, and final deliverables.

The product direction is not two canvases and not two runtime states. The direction is one durable canvas document with two semantic lenses.

## Fusion Principle

The visual tree is reality. The semantic graph is a relationship layer over the same visible nodes.

In implementation terms:

- `PenDocument.pages` plus a valid `activePageId` remains the only durable canvas truth.
- Every visible design object, Agent output unit, execution step, evidence card, branch, checkpoint, and final deliverable is a `PenNode` under a page.
- Figma-like capability reads and writes visual/runtime fields on that `PenNode`.
- Node-system capability reads and writes semantic fields and connector relationships on that same `PenNode`.
- Connector and line nodes are also normal page nodes. Their binding metadata explains the relationship between two visible nodes; there is no hidden graph database that supersedes the page tree.

## Current Project Anchors

Use these existing project boundaries before adding new behavior:

| Concern | Current anchor |
| --- | --- |
| Durable document truth | `PenDocument.pages`, `PenDocument.activePageId`, `PenNode` fields |
| Document contracts | `packages/pen-types`, `packages/canvas-core` |
| Figma-like import and fidelity | `packages/pen-figma`, `packages/canvas-core/src/import.ts`, `packages/canvas-core/src/figma-native.ts` |
| Direct canvas editing | `apps/web/src/components/canvas/canvas-api.ts`, `apps/web/src/components/canvas/canvas-runtime-store.ts` |
| Rendering and hit testing | `packages/pen-renderer` |
| Semantic inspection | `apps/server/src/mcp/tools/inspect-canvas-semantic.ts`, `apps/server/src/mcp/tools/ai-native-canvas-context.ts` |
| Agent execution semantics | `packages/canvas-core/src/agent-execution.ts`, `PenNode.meta.agentExecution` |
| Live Agent read/write | `apps/server/src/features/canvas/live-canvas-service.ts`, `apps/server/src/mcp/tools/` |

## Layer Model

Treat a canvas object as a single node with layered responsibilities.

### Physical Layer

The physical layer decides what exists on the canvas and how it renders.

Runtime truth includes:

- node type, position, size, transform, rotation, visibility, locking, hierarchy, and page ownership
- fills, strokes, effects, opacity, blend mode, text, images, vectors, masks, and components
- auto-layout parent fields and child `layoutConstraints`
- assets, variables, themes, style definitions, and component references

This is where Figma-like editing belongs. If a property panel control writes one of these fields, the renderer, layout, import/export, or editing path must actually consume it.

### Semantic Layer

The semantic layer explains what a visible node means inside an AI-native workflow.

Runtime semantic fields include:

- `containerRole`
- `contextSlots`
- `agentBinding`
- `createdByAgentId`
- `runId`
- `sessionId`
- `ioPorts`
- `LineNode.connector`
- `PenNode.meta.agentExecution`

These fields do not replace physical fields. A node with `meta.agentExecution.kind = "final_deliverable"` is still a normal frame/image/text/container that can be selected, styled, exported, and edited.

### Interaction Layer

The interaction layer decides which controls appear for the selected object.

- Ordinary visual nodes expose Figma-like editing first.
- Nodes with Agent execution semantics expose status, upstream/downstream context, continuation, rerun, branch, evidence, critique, and recovery affordances.
- Connector-capable nodes expose endpoint handles and relationship actions only when the runtime can consume those connector bindings.
- Unsupported semantic actions should be hidden, disabled, or paired with a concrete reason. They must not create fields that no runtime path reads.

## Data Flow Discipline

All new canvas behavior should fit this flow:

User input or import data
-> boundary normalization
-> durable `PenDocument.pages`
-> live runtime read
-> UI/Agent edit through `CanvasApi` or MCP transaction
-> renderer/layout/export/Agent semantic inspection

Allowed boundary-only inputs:

- Figma/SVG/clipboard metadata
- import diagnostics and degradation warnings
- migration inputs that are immediately normalized into current runtime truth

Forbidden core behavior:

- a hidden graph store that owns execution relationships separately from page nodes
- an Agent-only canvas state that mirrors `PenDocument.pages`
- UI controls that write semantic fields not consumed by Agent, renderer, inspector, or export paths
- visual nodes generated from a separate workflow graph after the user edits the canvas
- fallback reads from deprecated fields inside render, Agent, service, or UI edit paths

## Product Interaction Rules

The user should experience one canvas, not a mode switch between two products.

- Default interaction is Figma-like: select, drag, resize, edit text, tune style, arrange layers, inspect properties.
- Semantic affordances appear progressively when a selected or hovered node has workflow meaning.
- Agent-created execution chains are visible spatial context, not chat-only logs.
- Final deliverables are editable design nodes, not frozen outputs.
- Manual user edits become current truth for the next Agent turn. The Agent must inspect live `PenDocument.pages` before continuing from a selected node or reference.
- Branches and checkpoints should behave like visible canvas nodes with relationships, not like invisible run-history entries.

## Implementation Checklist

Before implementing a feature that touches node-system or Figma-like behavior, answer:

1. What is the physical `PenNode` or connector node that owns the visible result?
2. Which fields are physical runtime truth?
3. Which fields are semantic runtime truth?
4. Which fields are import/migration input or diagnostics only?
5. Does every UI control write a field consumed by renderer, layout, Agent tools, inspector, export, or persistence?
6. Does the Agent path read the latest live `PenDocument.pages` before mutating?
7. Are connector relationships stored on visible connector nodes instead of a second graph store?
8. Does the failure path throw or show a concrete reason instead of returning `null`, `undefined`, a raw ID, or an opaque code?

## Suggested Development Order

1. Keep Figma-like physical editing stable: pages, hierarchy, selection, layout, style, import/export, renderer, persistence.
2. Make semantic roles first-class on the same nodes: execution kinds, container roles, context slots, IO ports, and connector bindings.
3. Make UI affordances progressive: normal design controls by default, semantic workflow controls only when the selected node can act on them.
4. Make Agent tools operate on semantic reads and transactional page writes: inspect, preview, apply, validate, screenshot, critique, export, and trace.
5. Make continuation and recipe behavior depend on selected live nodes plus their upstream/downstream page relationships, not on stale run trace.

## Documentation Cross-links

- Use [`cucumber-canvas-foundation.md`](./cucumber-canvas-foundation.md) for the durable canvas shape and read/write chain.
- Use [`canvas-tooling-capability-map.md`](./canvas-tooling-capability-map.md) for current UI tools, properties, runtime fields, and MCP callability.
- Use [`ai-native-canvas-agent-capability-plan.md`](./ai-native-canvas-agent-capability-plan.md) for staged Agent-callable canvas capabilities.
