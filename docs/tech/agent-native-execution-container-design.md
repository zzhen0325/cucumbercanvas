# Agent Native Execution Container Design

Last updated: 2026-06-04 CST

This design supersedes the current execution-node presentation boundary where
Agent execution UI is assembled from ordinary canvas `frame`, `text`, and
`line` nodes. The new product boundary is:

- Canvas owns spatial placement, selection, sizing, connectors, and final
  artifact containers.
- Agent owns execution containers as first-class runtime objects, including
  streaming output, todo/tool UI, waiting state, failures, checkpoints, and
  execution details.

## Problem

Current Agent execution nodes store durable semantics in
`PenNode.meta.agentExecution`, then also generate visible card internals as
canvas children. This makes a workflow trace look spatial, but it mixes two
responsibilities:

- Canvas content fields become a UI rendering mechanism for Agent runtime
  internals.
- Stream write-back updates semantic metadata and visible text children in the
  same path.
- React-only affordances such as streaming messages, todo tools, and rich tool
  cards have to be compressed into plain canvas text.

That model blocks an Agent-first canvas: execution is not a normal design
artifact. It is the Agent's live process, and the UI inside the execution node
should be rendered by Agent components rather than by canvas document assembly.

## Goals

- Make Agent execution containers first-class Agent objects, not canvas child
  compositions.
- Preserve the canvas as the spatial context: position, size, selection,
  connection, and final output placement still live in `PenDocument.pages`.
- Use a single Agent execution container truth for streaming output, todo
  items, tool parts, failures, waiting prompts, checkpoints, and artifact refs.
- Allow agent-elements components such as `TodoTool`, tool groups, and
  streaming text to render inside the native execution container.
- Keep migration/compatibility reads at boundary layers only.
- Fail clearly when required Agent execution container state is missing; do not
  silently fall back to canvas text children.

## Non-Goals

- Do not replace `PenDocument.pages` as the durable canvas truth for spatial
  content.
- Do not redesign canvas rendering, hit testing, import/export, auth,
  persistence, or deployment.
- Do not introduce a hidden second canvas graph. The new Agent container store
  is execution runtime truth, not visual canvas truth.
- Do not keep old `frame + generated text child` execution internals as a core
  runtime fallback.

## Single Source Of Truth

### Runtime Truth

`AgentExecutionContainer` is the runtime truth for execution internals.

It should include:

- `containerId`: stable ID referenced by the canvas shell.
- `runId`, `sessionId`, optional `agentId`.
- `kind`: user goal, run, plan, task step, tool call, evidence, critique,
  ask-user-more, checkpoint, final deliverable, or branch/comparison role.
- `status`: waiting, running, done, failed, or paused.
- `title`, `summary`.
- `streamParts`: normalized message/thinking/stage/tool/artifact parts.
- `todos`: structured todo items with pending, in-progress, completed status.
- `toolParts`: normalized tool-call parts suitable for agent-elements
  renderers.
- `waitingForUser`, `failure`, `checkpoint`, `evidence`, `critique`,
  `branch`, `comparison`, and `artifactRefs` as structured fields.

### Canvas Truth

`PenDocument.pages` remains the truth for:

- The execution container shell node's position and size.
- Canvas selection and hover hit target.
- Spatial connectors between shells and final artifact containers.
- Final user-facing artifact containers and their visual children.
- Page ownership and persistence of visible canvas content.

The canvas shell should reference the Agent container by ID and expose only
spatial/editor fields plus minimal semantic indexes needed for selection,
inspection, and connector routing.

### Migration Inputs

Existing `PenNode.meta.agentExecution` and generated display children are
migration inputs only. Boundary code may read them to build an
`AgentExecutionContainer`, then core runtime/UI should consume the new
container truth.

### Diagnostics

Raw provider/tool error codes, legacy node IDs, old text child content, and
source event payloads may be preserved as diagnostics, but they must not drive
runtime decisions or be displayed directly to users.

## Data Flow

1. User prompt or Agent runtime event starts an execution run.
2. Runtime creates or updates an `AgentExecutionContainer`.
3. Canvas stores or updates a spatial shell node that references
   `containerId`.
4. Stream events normalize into `streamParts`, `todos`, and `toolParts`.
5. Web canvas overlay renders the shell internals with React Agent components.
6. Final artifacts are written to normal `PenDocument.pages` artifact
   containers and linked back by `artifactRefs`.
7. Selection/property panels read the Agent container first; canvas text
   children are not a runtime fallback.

## UI Behavior

- On canvas, an Agent execution shell behaves like a selectable/resizable
  canvas object.
- Inside the shell, Agent-native React UI renders the live execution:
  streaming text, todo progress, tool cards, waiting prompt, failure reason,
  checkpoint actions, and artifact refs.
- If the Agent container is unavailable, the UI shows a clear recoverable
  message such as "This execution container is missing its Agent runtime state"
  with diagnostic context in developer-facing surfaces only.
- Controls are only shown when their action has a real backing runtime path.
  For example, todo editing is not exposed unless todo updates are consumed by
  the Agent runtime.
- Final deliverables remain normal canvas artifact containers, not hidden
  inside the execution trace.

## Implementation Slices

1. Add typed shared contract for `AgentExecutionContainer` and normalized
   stream/todo/tool parts.
2. Add a boundary adapter from legacy `meta.agentExecution` into the new
   container model for existing data only.
3. Create Agent execution container persistence/update service used by runtime
   events and MCP write-back paths.
4. Replace stream write-back of generated display children with container
   updates.
5. Add a Web native execution container renderer that mounts inside the canvas
   overlay/shell and can use agent-elements components.
6. Update creation tools to create a shell plus container, not a fully
   assembled card made of generated canvas children.
7. Remove core runtime reads from generated execution text children after the
   adapter path is in place.
8. Update docs that currently describe `meta.agentExecution` as the durable
   execution-node truth.

## Testing

Focused tests should cover:

- Stream events update `AgentExecutionContainer.streamParts` without creating
  or rewriting canvas text children.
- Todo updates render from structured todo state and ignore legacy text child
  content.
- Existing legacy nodes normalize once into containers at the boundary.
- Old generated text children do not affect runtime behavior after
  normalization.
- Missing container state fails with a clear user-facing explanation, not raw
  codes, `null`, or `undefined`.
- Canvas shell selection, status markers, connectors, and final artifact
  placement still read spatial data from `PenDocument.pages`.

## Boundary Review Answers

1. The unique runtime truth for execution internals is
   `AgentExecutionContainer`.
2. Legacy `meta.agentExecution`, generated execution text children, and raw run
   events are migration or diagnostic inputs only.
3. Runtime write-back, Agent UI rendering, property panels, and continuation
   controls must read the same container truth.
4. UI controls must be hidden or disabled unless they write fields consumed by
   the Agent container runtime.
5. Old fields must not remain in core paths after boundary normalization.
6. When prerequisites are missing, users see an explicit explanation and the
   unavailable controls are not presented as usable.
