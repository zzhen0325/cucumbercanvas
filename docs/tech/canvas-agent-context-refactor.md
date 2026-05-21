# Canvas Agent Context Refactor

## Goal

Upgrade the canvas from a presentation-only surface into a true agent context surface.

This refactor is split into incremental phases so we can ship the highest-value changes
first without blocking on the larger UI and trace-system work.

## Problems To Solve

- Selected canvas content is not modeled as first-class agent context today.
- Only selected images are merged into `attachments`; selected text, video, and shapes
  are invisible to the runtime.
- Media rendering is inconsistent across image, video, and generator containers.
- Tooling UI is split between a bottom-center creation bar and a bottom-left utility bar.
- Agent tool executions are visible in chat, but not projected back onto the canvas.

## Phase Plan

### Phase 1: True Canvas Context

Ship structured `canvasContextRefs` from the web app to the runtime and inject the
selection into the user message as explicit XML context.

Scope:

- Add `canvasContextRefs` to `RunCreateRequest`.
- Extend selected canvas element serialization to include text, image, video, and
  generic shape metadata.
- Keep selected images in `attachments`, but also include them in `canvasContextRefs`.
- Inject `<selected_canvas_context>` into the runtime prompt builder.
- Replace the chat input's selection counter with context chips/rows.

### Phase 1.5: Viewport-Aware Canvas Agent Context

Ship `canvasAgentContext` alongside the existing selected refs so the agent can
resolve user intent against the current working area instead of the whole
infinite canvas.

Scope:

- Add a structured `canvasAgentContext` to `RunCreateRequest`.
- Capture viewport geometry (`x`, `y`, `zoom`, visible width/height) at send time.
- Reuse selected refs as `selectedCards`.
- Compute `nearbyCards` from the current viewport or selected-card neighborhood.
- Include a compact `canvasSummary` that prioritizes selected and nearby cards.
- Include first-pass `cardRelations` for arrows, bound text, groups, and Cucumber
  canvas containers.
- Inject the context as `<canvas_agent_context format="json">` while keeping
  `<selected_canvas_context>` for compatibility.

Files:

- `packages/shared/src/contracts.ts`
- `packages/shared/src/contracts.test.ts`
- `apps/web/src/components/canvas-editor.tsx`
- `apps/web/src/components/chat-sidebar.tsx`
- `apps/web/src/components/chat-input.tsx`
- `apps/web/src/lib/canvas-context.ts`
- `apps/server/src/http/runs.ts`
- `apps/server/src/agent/runtime.ts`
- `apps/server/src/agent/runtime.test.ts`

### Phase 2: Media Container Consistency

Scope:

- Preserve real image aspect ratios across all insert/render paths.
- Remove the separate floating video playback panel as the primary playback path.
- Make video playback happen directly inside the canvas container.
- Add a contextual floating toolbar for the currently selected element.

Files:

- `apps/web/src/lib/canvas-elements.ts`
- `apps/web/src/components/canvas/video-canvas-element.tsx`
- `apps/web/src/components/canvas/video-player-panel.tsx`
- `apps/web/src/components/canvas-tool-menu.tsx`
- `apps/web/src/components/canvas/canvas-element-floating-toolbar.tsx`

### Phase 3: Tooling Layout Refactor

Scope:

- Move the primary creation toolbar to the left side, vertically centered.
- Slim the bottom utility bar to global actions only.
- Ensure left-side panels and selection overlays do not collide.

Files:

- `apps/web/src/components/canvas-tool-menu.tsx`
- `apps/web/src/components/canvas-bottom-bar.tsx`
- `apps/web/src/app/canvas/page.tsx`

### Phase 4: Agent Trace On Canvas

Scope:

- Project tool lifecycle events onto the canvas as trace nodes.
- Group each run into a dedicated lane/frame.
- Keep nodes collapsed by default and support explicit cleanup/toggling.
- For planned runs, prefer the dedicated Cucumber `agent_flow` canvas container
  over ordinary rectangle/text trace-node composition.

Files:

- `apps/web/src/lib/agent-trace-projector.ts`
- `apps/web/src/lib/agent-flow-container-projector.ts`
- `apps/web/src/components/canvas/agent-flow-container-renderer.tsx`
- `apps/web/src/components/canvas/canvas-trace-lane.tsx`
- `apps/web/src/components/chat-sidebar.tsx`
- `packages/shared/src/events.ts`

## Agent Flow Container Contract

Agent Flow is a Cucumber-owned application-layer canvas container. The
Excalidraw scene stores one selectable/movable/resizable embeddable host
element with `customData.cucumberContainer.kind = "agent_flow"`. Cucumber code
renders the internal plan graph through `renderEmbeddable`; Excalidraw does not
need a new native element type.

Runtime behavior:

- `publish_task_plan` emits a typed `AgentTaskPlan` instead of relying on
  natural-language parsing.
- `stream-adapter.ts` converts that tool output into `task.plan.created` and
  `agent.flow.container.created` SSE events.
- Tool lifecycle events may carry `planId`, `stepId`, `subAgentName`, and
  `parentToolCallId`; the web projector uses those fields to attach execution
  state to the matching container step.
- The legacy trace projector remains as the fallback for runs without an Agent
  Flow container.

## Phase 1 Contract

`canvasContextRefs` is an explicit, structured list of the currently selected canvas
elements that the user wants the agent to reason about.

Supported variants in the first implementation:

- `text`
- `image`
- `video`
- `shape`

Each ref includes:

- stable `elementId`
- canvas geometry (`x`, `y`, `width`, `height`)
- type-specific content such as `text`, `storageUrl`, `mimeType`, `title`, or `link`

## Prompt Injection

The runtime should inject selected canvas context as a dedicated XML block:

```xml
<selected_canvas_context count="3">
  <text element_id="text_1" x="80" y="120" width="320" height="96">
    Hero headline for the campaign
  </text>
  <image
    element_id="image_1"
    asset_id="canvas-image-1"
    mime_type="image/png"
    title="Reference storefront photo"
    x="480"
    y="120"
    width="640"
    height="360"
  />
  <video
    element_id="video_1"
    url="https://cdn.example.com/demo.mp4"
    mime_type="video/mp4"
    title="Motion reference"
    duration_seconds="5"
    x="80"
    y="320"
    width="640"
    height="360"
  />
</selected_canvas_context>
```

This block is additive to existing runtime context:

- `<canvas_state>`
- `<input_images>`
- generation preferences
- mention-derived XML blocks

## UX Notes For Phase 1

- Selected images still become attachments so the model can consume them as image input.
- The chat input should make selected canvas context visible before send.
- Removing a context chip in the input should remove it from the outgoing request only;
  it should not mutate the actual canvas selection yet.

## Risks

- Request/response contracts now span shared, web, server, and replay paths.
- Large text selections can bloat prompts if we do not trim them carefully.
- Videos are represented as metadata in Phase 1; deeper visual understanding of video
  still requires a later frame-extraction strategy.

## Success Criteria

- Selecting text on canvas lets the agent use that text as structured context.
- Selecting images keeps visual attachments working while adding geometry-aware context.
- Selecting videos exposes their metadata to the runtime.
- The user can see what canvas context will be sent before pressing submit.
