# UI Page Code Sync Plan

Last updated: 2026-06-05 CST

This plan defines how Cucumber Studio should support code synchronization for
UI page results on the canvas. The scope is broad in source but narrow in
output type:

- Code sync applies to UI page or UI section results, regardless of source:
  Agent-generated UI deliverables, ordinary Figma-like canvas nodes, and
  imported Figma pages or frames.
- Code sync does not apply to non-UI outputs such as image/poster/video
  outputs, flow diagrams, generic execution nodes, or arbitrary project source
  files.
- The live canvas remains the product surface and the durable visual truth.
  Code is a synchronized projection of a specific UI page root, not a second
  canvas state.

## 1. Product Goal

The user experience should support three entry paths:

1. The Agent creates or modifies a UI page, then writes the result to a
   syncable canvas root.
2. The user manually designs a UI page with Figma-like canvas nodes, then marks
   or selects a syncable page root.
3. The user imports a Figma page/frame, then treats that imported page/frame as
   a syncable UI page root.
4. The user manually adjusts the UI page on the canvas.
5. The generated code for that same UI page root can be refreshed from the edited
   canvas.
6. If the code for that UI page is edited inside Cucumber-managed
   code surfaces, supported changes can be previewed and applied back to the
   canvas.

This is not a general "Figma clone exports all designs to production code"
feature for arbitrary canvas content. It is a focused UI page workflow:

```text
UI page source
-> Agent final deliverable, manual Figma-like root, or imported Figma root
-> syncable UI page root on PenDocument.pages
-> generated UI code projection
-> bounded sync between that UI page root and its generated code
```

## 2. Current Code Reality

The current implementation already has the correct foundation for the canvas
side:

- The durable canvas truth is `PenDocument.pages` plus a valid `activePageId`.
  Runtime code rejects unsupported legacy shapes instead of relying on root
  `children` fallback.
- Web manual edits go through `CanvasApi`, `CanvasRuntimeStore`, and
  `CanvasOperation[]`, then update the same live document consumed by renderer,
  inspector, and Agent tools.
- Agent execution nodes are ordinary `PenNode` objects, usually `FrameNode` or
  `LineNode`, with Agent semantics stored on the same node through
  `meta.agentExecution`, `containerRole`, `contextSlots`, `agentBinding`,
  `runId`, and `sessionId`.
- Live Agent tools already read and write through the live editor boundary:
  `inspect_canvas_semantic`, `get_selection_context`,
  `canvas_diff_preview`, `apply_canvas_transaction`,
  `create_agent_execution_flow`, `record_agent_final_deliverable`, and related
  MCP tools.
- `codegen_export` already exists and can export selected or explicit nodes to
  React, HTML, or Vue, but it should be treated as one-way export until a sync
  manifest, patch preview, and conflict model exist.

The missing product layer is not "another node system". The missing layer is a
typed sync contract for UI page roots.

## 3. Single Source Of Truth

### Canvas Truth

The UI page root is a normal canvas subtree:

- root: usually a `FrameNode` representing a page, screen, section, component
  group, imported Figma frame, or Agent final deliverable
- children: normal editable `PenNode` descendants
- assets: document-level `assets`
- variables/themes/style definitions: document-level design data
- optional semantic provenance: Agent run/session/node metadata, Figma import
  metadata, or manual user ownership metadata

`PenDocument.pages` remains the only runtime visual truth.

### Code Truth

Generated code is not canvas truth. Generated code is a projection owned by a
sync manifest:

- framework target
- generated files
- source root node IDs
- node-to-code mapping
- code-to-node mapping
- last synced canvas version/hash
- warnings and unsupported mappings

Code can be edited, but it becomes canvas-affecting only after the system
successfully converts a supported change into a previewed `CanvasOperation[]`
patch.

### Forbidden Truth Sources

Do not make any of these drive runtime canvas behavior:

- chat transcript
- run trace
- generated code without a manifest
- old Figma metadata
- hidden Agent graph store
- codegen chunk cache
- arbitrary project files

## 4. UI Root Classification

Add a clear classification for syncable UI roots.

Recommended semantic shape on the syncable root node:

```ts
type CanvasCodeSyncRootKind =
  | "ui_page"
  | "ui_section"
  | "ui_component"
  | "image"
  | "poster"
  | "video"
  | "flow"
  | "structured_data"
  | "other";
```

For code sync v1, only these are eligible:

- `ui_page`
- `ui_section`
- `ui_component` when the component is selected as a page-level deliverable or
  exportable UI section

Everything else must return a concrete unsupported reason:

- image/poster/video: use media generation/export flows
- flow: use `flow_spec`
- structured data: use structured export
- generic Agent execution nodes: not code-syncable
- imported Figma assets that are not UI page/frame roots: not code-syncable
- ordinary shapes/text/images not grouped under a UI root: select or create a
  page/section root first

## 5. UI Page Root Contract

The syncable root must be a normal `FrameNode`.

Required runtime traits:

- `type: "frame"`
- `containerRole` includes `"visual"`
- root kind is `ui_page`, `ui_section`, or an eligible `ui_component`
- all syncable descendants are under the same active page
- all visible UI content is represented by normal child `PenNode` objects

Allowed source traits:

- Agent final deliverable: `meta.agentExecution.kind === "final_deliverable"`
  plus UI page root kind.
- Manual Figma-like root: no Agent metadata required, but the root must be a
  clear UI page/section/component container.
- Imported Figma root: source/import metadata may be preserved for diagnostics,
  but runtime sync reads normalized `PenNode` fields.

Recommended metadata:

```ts
type UiPageCodeSyncMeta = {
  schemaVersion: 1;
  kind: "ui_page" | "ui_section" | "ui_component";
  source: "agent" | "manual" | "figma_import";
  title: string;
  frameworkTargets?: Array<"react" | "html" | "vue">;
  projectionIds?: string[];
  lastSyncedProjectionId?: string;
};
```

This metadata identifies the deliverable. It must not store the full generated
code, a hidden component tree, or a second copy of canvas state.

## 6. Editing Capability Model

The canvas should expose different editing capability profiles depending on
node role.

### `design.full`

Applies to:

- ordinary design nodes
- real child nodes inside a syncable UI page root

Allowed:

- select, move, resize, rotate
- style edits
- text edits
- image replacement
- layout edits
- layer ordering
- grouping where supported

### `agent.execution`

Applies to:

- recipe plan
- task step
- tool call
- evidence
- critique
- branch
- comparison
- checkpoint

Allowed:

- select
- move as a whole
- inspect status/details
- continue/rerun/branch actions
- collapse/expand when supported

Restricted:

- deep editing of generated display children
- arbitrary style controls that do not affect runtime semantics
- controls that appear editable but are not consumed

### `codeSync.uiRoot`

Applies to:

- syncable UI page/section/component roots from Agent output, manual
  Figma-like design, or Figma import

Allowed:

- design editing of the UI subtree
- code sync controls
- Agent continuation from the selected UI result when Agent context exists
- export to code
- preview code-to-canvas patches

### `display.locked`

Applies to:

- internal generated display children used to render Agent execution cards

Allowed:

- rendered as part of parent

Restricted:

- no independent selection by default
- no independent Property Panel editing
- clicking should select the parent execution node

This prevents Agent execution cards from being accidentally broken while still
allowing real UI page roots from any source to be edited deeply.

## 7. Code Sync Scope

### In Scope For V1

Synchronize UI page roots, not arbitrary canvas fragments:

- Agent-created landing pages, dashboards, settings pages, editor surfaces,
  forms, modals, or other UI page-like results.
- Manual Figma-like canvas page/section roots created directly by the user.
- Imported Figma pages, frames, or component sections that normalize into
  editable `PenNode` trees.
- Code is generated from the selected UI root.
- Manual canvas edits inside that root can refresh the generated code.
- Supported code edits can preview and apply back to that same root.

Supported code targets:

- React
- static HTML
- Vue

React should be the primary production target if only one target can be made
robust first.

### Out Of Scope For V1

- syncing non-UI imported Figma assets or artboards
- syncing arbitrary ungrouped leaf nodes without a UI root
- syncing image/poster/video outputs
- reverse-engineering arbitrary project source files
- inferring complex React state or business logic back into canvas
- syncing responsive breakpoint-specific code into multiple canvas variants
- syncing code changes without a manifest
- hidden runtime fallback from old codegen cache

## 8. Projection Manifest

Add a manifest as the required bridge between canvas and code.

Recommended type:

```ts
type CodeProjectionManifest = {
  schemaVersion: 1;
  projectionId: string;
  canvasId: string;
  pageId: string;
  rootNodeId: string;
  rootNodeKind: "ui_page" | "ui_section" | "ui_component";
  source: "agent" | "manual" | "figma_import";
  framework: "react" | "html" | "vue";
  generatedAt: string;
  canvasDocumentVersion: number;
  sourceNodeHash: string;
  files: Array<{
    path: string;
    role: "component" | "style" | "asset" | "manifest";
    contentHash: string;
  }>;
  nodeMappings: Array<{
    nodeId: string;
    componentName?: string;
    elementSelector?: string;
    filePath: string;
    codeRange?: {
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
    };
    styleMappings?: Array<{
      fieldPath: string;
      filePath: string;
      codeRange?: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
    }>;
  }>;
  warnings: Array<{
    code: string;
    message: string;
    nodeId?: string;
    fieldPath?: string;
  }>;
};
```

Storage should be outside runtime node fields where possible. Node metadata may
store only lightweight references such as `projectionId` and last synced hash.

## 9. Canvas To Code Flow

1. User selects a syncable UI page root.
2. System validates the selected root:
   - exists on active page
   - is a `FrameNode` or equivalent supported UI container
   - root kind is `ui_page`, `ui_section`, or eligible `ui_component`
   - source is Agent output, manual Figma-like canvas, or normalized Figma import
   - has at least one visible syncable child or meaningful root style
3. System builds a component spec from the canvas subtree.
4. System emits framework-specific code.
5. System emits a projection manifest.
6. UI shows generated files, warnings, unsupported fields, and sync status.
7. If the user manually edits the canvas later, code can be regenerated from
   the same root node and manifest lineage.

The one-way exporter can reuse current `codegen_export` logic, but the sync
version must add manifest output and stable mappings.

## 10. Code To Canvas Flow

1. User edits generated code in a Cucumber-managed code surface.
2. System loads the matching `CodeProjectionManifest`.
3. System compares current code to manifest file hashes.
4. System parses supported changes.
5. System converts supported changes into `CanvasOperation[]`.
6. System returns a preview:
   - affected node IDs
   - changed fields
   - unsupported changes
   - conflicts
   - stale canvas/version warnings
7. User or Agent applies the patch through `apply_canvas_transaction`.
8. System updates sync status and manifest lineage.

No code change should mutate canvas directly. It must become a previewed canvas
transaction first.

## 11. Supported Reverse Changes In V1

Supported with deterministic mapping:

- text content changes for mapped text nodes
- solid fill color changes
- stroke color/thickness changes when directly mapped
- width/height changes on mapped root or simple child nodes
- x/y changes only when code representation has explicit position mapping
- image URL replacement for mapped image nodes
- simple padding/gap changes for mapped frame layout
- visibility toggles where represented explicitly

Unsupported in v1 with required explicit reasons:

- arbitrary JSX structure refactor that removes node identity
- complex CSS cascade where one declaration affects multiple unmapped nodes
- media queries that cannot map to one canvas state
- runtime state, event handlers, data fetching, auth, payments, routing
- component extraction/renaming that breaks mapping
- computed styles from JavaScript expressions
- third-party component internals

## 12. UI Requirements

Add Code Sync UI only when a selected node is a syncable UI page root or a
descendant that can resolve to one.

The panel should show:

- UI root kind
- source: Agent, manual, or Figma import
- framework target
- current projection status
- generated file list
- source node count
- warnings
- last synced time
- whether canvas changed after last projection
- whether code changed after last projection

Actions:

- Generate Code
- Regenerate From Canvas
- Preview Code Patch To Canvas
- Apply Code Patch
- Open Generated Files
- Clear Projection

Do not show these controls for generic Agent execution nodes, non-UI canvas
fragments, media outputs, or unsupported deliverable types. If a user selects a
normal Figma-like child node inside a UI root, resolve the action to the
nearest syncable UI root. If no root exists, show a readable reason and offer
to create or mark a UI root.

## 13. Agent Behavior

When generating UI pages, the Agent should:

1. Create or reuse a visible execution chain.
2. Create a final deliverable root with UI root kind `ui_page` or
   `ui_section`.
3. Write all visible UI content as normal editable child `PenNode` objects.
4. Validate the canvas result.
5. Record final deliverable metadata.
6. Offer code generation for that UI root.

When the user manually designs or imports a UI page, the system should:

1. Allow the selected page/frame/section root to be marked as a syncable UI
   root.
2. Preserve Figma import/source metadata only as diagnostics and provenance.
3. Generate code from normalized `PenNode` fields, not raw import metadata.
4. Let the Agent inspect, critique, or modify the root through live canvas
   tools when requested.

When modifying an existing UI page result, the Agent should:

1. Read the live selection context.
2. Confirm the selected node is a syncable UI root or can resolve to one.
3. Inspect the latest live canvas.
4. Apply bounded canvas diffs.
5. Regenerate code projection only if requested or if the workflow explicitly
   requires code sync.

When applying code changes back to canvas, the Agent should:

1. Read the projection manifest.
2. Preview the patch.
3. Explain unsupported changes.
4. Apply only deterministic canvas operations.

## 14. Implementation Checklist

### Stage A: Document And Contracts

- Add this plan document.
- Define `CanvasCodeSyncRootKind` for syncable UI roots.
- Define `CodeProjectionManifest`.
- Define `CodeProjectionResult`.
- Define `CodeToCanvasPatchPreview`.
- Define `CanvasNodeEditCapability`.

### Stage B: UI Root Identification

- Add helper to detect Agent final-deliverable UI roots, manual UI roots, and
  imported Figma UI roots.
- Ensure `create_agent_execution_flow` and final-deliverable write-back can
  mark UI page deliverables.
- Add a user action or normalization path to mark manual/imported page frames
  as syncable UI roots.
- Ensure image/poster/video final deliverables do not become code-syncable.
- Add explicit user-readable unsupported reasons.

### Stage C: Edit Capability Gating

- Mark Agent execution display children with stable metadata.
- Normalize clicks on display children to the parent execution node.
- Keep deep editing available inside `codeSync.uiRoot` roots.
- Hide or disable irrelevant Property Panel sections for `agent.execution`.
- Surface code sync controls only for `codeSync.uiRoot`.

### Stage D: One-Way Projection With Manifest

- Wrap or extend `codegen_export` for syncable UI roots.
- Generate source mappings for each emitted component element.
- Save or return a manifest with generated files.
- Show unsupported fidelity warnings.

### Stage E: Reverse Patch Preview

- Parse generated files against the manifest.
- Produce deterministic `CanvasOperation[]` for supported changes.
- Return conflicts and unsupported changes without mutation.
- Reuse `canvas_diff_preview` analysis where possible.

### Stage F: Apply And Refresh

- Apply previewed patches through `apply_canvas_transaction`.
- Regenerate projection after canvas edits.
- Update manifest lineage.
- Log projection/apply events with canvas, page, root node, projection, file,
  and affected node context.

### Stage G: Tests And Hardening

- Add unit tests for classification and capability helpers.
- Add MCP tests for syncable UI root code sync eligibility.
- Add code projection tests for stable mapping.
- Add reverse patch tests for text/color/size changes.
- Add rejection tests for unsupported code changes.
- Add Web tests for panel visibility and selection gating.

## 15. Acceptance Criteria

The first complete slice is acceptable when:

1. Agent can generate a UI page final deliverable on the canvas.
2. A manually created Figma-like UI page root can be marked syncable.
3. An imported Figma page/frame root can be marked syncable after normalization.
4. The syncable UI root is deeply editable as canvas nodes.
5. Generic Agent execution cards remain protected from accidental deep editing.
6. Code sync controls appear only for syncable UI roots or descendants that
   resolve to one.
7. React code can be generated with a manifest.
8. Manual text/color edits on the canvas can regenerate updated React code.
9. Simple generated-code text/color edits can preview a canvas patch.
10. Applying that patch updates the live canvas through `apply_canvas_transaction`.
11. Unsupported code edits return clear user-readable reasons.
12. No hidden Agent-only canvas state is introduced.

## 16. Risks

- Current `canvas-property-panel.tsx` and `canvas-overlays.tsx` are already
  large; capability gating should be extracted into focused helpers instead of
  adding more inline branching.
- Existing `codegen_export` may not have enough stable mapping data for reverse
  sync; do not treat it as bidirectional until manifest support exists.
- If Agent execution display children are identified by localized names, future
  copy changes can break selection/editing behavior. Use metadata instead.
- Without version/hash checks, code-to-canvas patches can overwrite newer
  manual canvas edits. Stale projections must fail with clear reasons.
- LLM-generated reverse patches are unsafe without deterministic mapping. The
  manifest must be the authority.

## 17. Non-Goals

- Do not sync arbitrary non-UI Figma-like nodes outside a syncable UI root.
- Do not sync imported Figma files as raw import metadata; sync only normalized
  UI page/frame roots and their `PenNode` descendants.
- Do not reverse-engineer arbitrary user project source files.
- Do not support full responsive code-to-canvas reverse mapping in v1.
- Do not store generated code as runtime canvas truth.
- Do not use run trace, chat logs, or codegen cache as canvas truth.
- Do not change auth, payments, production migrations, deployment config, or
  global design tokens for this feature.

## 18. Recommended First Slice

Build the smallest production-shaped path:

1. Mark Agent final deliverables, manual page roots, and imported Figma
   page/frame roots with `codeSyncRoot.kind: "ui_page"`.
2. Add capability helper and Web gating for Agent execution vs syncable UI
   roots.
3. Add `codegen_export` wrapper that only accepts syncable UI roots and emits a
   manifest.
4. Support React output first.
5. Support reverse patch preview for text content and solid fill color only.
6. Apply patches through the existing live canvas transaction path.
7. Add tests for unsupported nodes and unsupported code changes.

This slice validates the real product loop without pretending to solve
arbitrary non-UI design-code synchronization.
