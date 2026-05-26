# OpenPencil Phase A Editor Design

## Goal

Bring OpenPencil's editor-first canvas experience into Cucumber Studio in the order approved by the product owner:

1. Phase A: multi-page UI, editor toolbar, boolean toolbar, and advanced drawing/editing details.
2. Phase B: component system, variables/theme panels, and icon library.
3. Phase C: multi-platform codegen and prompt-to-canvas concurrent design orchestration.

This spec covers Phase A only.

## Chosen Approach

Preserve Cucumber Studio's existing Next.js canvas page, project/session ownership, chat sidebar, persistence, WebSocket live-canvas RPC, and `CanvasApi` contract. Adapt OpenPencil editor capabilities into the current Skia/Pen canvas modules instead of replacing the full application shell with OpenPencil's Zustand-based `EditorLayout`.

This keeps Cucumber's AI-native workspace model intact: chat and agent runs remain the primary orchestration surface, while the canvas gains stronger direct-manipulation tools.

## Alternatives Considered

### Replace The Whole Editor Shell

Copy OpenPencil's `EditorLayout`, stores, panels, and canvas stack as a large subsystem, then reconnect Cucumber persistence and chat afterward.

Benefit: closer to upstream OpenPencil behavior.

Cost: high collision risk with Cucumber's Next.js routing, Supabase persistence, WebSocket canvas RPC, current chat/run lifecycle, and agent container metadata. This approach is not selected for Phase A.

### Thin Toolbar Copy Only

Copy only visible toolbar buttons and small UI panels without adopting the underlying document/page/editing behavior.

Benefit: quickest visual resemblance.

Cost: creates controls that look complete but are shallow or inconsistent with the canvas engine. This approach is not selected because the request asks for real OpenPencil behavior, not a decorative demo.

## Current Context

Cucumber already contains a partial OpenPencil-derived foundation:

- `packages/pen-types`: Pen document and node schema with Cucumber container/agent metadata extensions.
- `packages/pen-engine`: headless design engine with document, page, variable, history, selection, and viewport managers.
- `packages/pen-renderer`: CanvasKit renderer used by the web canvas.
- `packages/pen-core`: layout, merge, boolean ops, path anchors, variable resolution, normalization, and helper utilities.
- `packages/pen-figma`: Figma import pipeline.
- `apps/web/src/components/canvas/skia-canvas.tsx`: current live editor surface.
- `apps/web/src/components/canvas/property-panel/canvas-property-panel.tsx`: current inspector with variable hooks and Cucumber-specific agent/container metadata.
- `apps/web/src/components/canvas-editor.tsx`: persistence, thumbnail, screenshot, and live canvas RPC boundary.
- `apps/web/src/app/canvas/page.tsx`: Cucumber canvas page shell with chat, layers, files, and bottom controls.

The local `openpencil/` source includes the reference implementation for Phase A:

- `openpencil/apps/web/src/components/editor/editor-layout.tsx`
- `openpencil/apps/web/src/components/editor/toolbar.tsx`
- `openpencil/apps/web/src/components/editor/boolean-toolbar.tsx`
- `openpencil/apps/web/src/components/editor/page-tabs.tsx`
- `openpencil/apps/web/src/canvas/skia/*`
- `openpencil/apps/web/src/stores/document-store-pages.ts`
- `openpencil/packages/pen-react/src/components/page-tabs.tsx`
- `openpencil/packages/pen-react/src/components/boolean-toolbar.tsx`

## Product Behavior

Phase A should make the canvas feel like a serious vector editor while still remaining an agent-native Cucumber workspace.

Users should be able to:

- Navigate multiple pages in a document.
- Add, rename, duplicate, reorder, and delete pages.
- Use a stable editor toolbar for select, hand, frame/container, text, shape, path, image/SVG, and icon entry points.
- Use toolbar actions for undo, redo, grouping, ordering, and common edit operations.
- Use boolean operations on compatible selected vector/shape nodes.
- Draw and edit rectangles, ellipses, polygons, paths, text, frames, lines, and arrows with predictable selection behavior.
- Resize, rotate, move, group, ungroup, reorder, duplicate, delete, lock, and hide elements.
- Keep Cucumber-specific container metadata visible and editable where it already exists.
- Continue using chat and agent runs without losing live canvas sync, screenshots, persistence, or asset insertion.

## UI Design

### Canvas Page Shell

Keep the current Cucumber canvas page shell:

- Existing chat/session sidebar remains Cucumber-owned.
- Existing project loading, auth, and WebSocket connection remain Cucumber-owned.
- Existing layers/files/bottom controls can be refined, but Phase A should avoid replacing global navigation or project workflows.

### Editor Toolbar

Replace the current centered `SkiaToolbar` embedded inside `skia-canvas.tsx` with a dedicated editor toolbar component modeled after OpenPencil:

- Fixed, dense, scan-friendly controls.
- Lucide icons for commands.
- Tooltips for icon-only controls.
- Shape picker for rectangle, ellipse, polygon, line, arrow, path, image/SVG, and icon insertion.
- Clear active state for the current tool.
- Disabled states for commands that require selection or history.

The toolbar must call through a Cucumber-facing `CanvasApi` or local canvas action handlers, not directly import OpenPencil's global stores.

### Boolean Toolbar

Add a contextual boolean toolbar for compatible multi-selection:

- Union
- Subtract
- Intersect
- Exclude

The toolbar appears only when selected nodes can safely participate in boolean operations. If a selection is incompatible, do not show a broken command and do not silently downgrade behavior.

### Page Tabs

Add page navigation in the canvas editor region:

- Page list or tabs should be visible without opening a modal.
- Active page should be obvious.
- Page actions: add, rename, duplicate, reorder, delete.
- Deleting the last page is not allowed.
- Switching pages clears stale selection and fits or restores the viewport for that page.

### Property Panel

Keep the current Cucumber property panel as the ownership base because it already understands Cucumber-specific agent/container metadata.

Phase A may copy OpenPencil inspector controls when they support editor basics:

- Position and size.
- Rotation and flips.
- Fill, stroke, effects.
- Text basics.
- Layout basics.
- Visibility and locking.

Full variable/theme management and component browsing belong to Phase B.

## Data Model

Use the existing `PenDocument.pages` structure. Documents without pages must be migrated in memory to a single-page structure without losing `children`, assets, variables, or Cucumber metadata.

The active page must be tracked in the editor runtime and exposed through `CanvasApi` where needed:

- `getActivePageId()`
- `setActivePage(pageId)`
- `getPages()`
- `addPage(name?)`
- `renamePage(pageId, name)`
- `duplicatePage(pageId)`
- `deletePage(pageId)`
- `reorderPage(pageId, direction)`

If implementation finds existing equivalents in `packages/pen-engine`, prefer reusing those methods over creating duplicate page logic.

## Canvas API Boundary

The browser editor remains the live-canvas authority. `CanvasEditor` continues to register:

- `canvas.document.get`
- `canvas.document.set`
- `canvas.screenshot`

Agent tools should continue to see a complete `PenDocument`; they do not need to know about React toolbar state. When an agent writes a document, the active page should remain valid if possible, otherwise fall back to the first available page and log the transition.

## Logging And Diagnostics

Add concise structured logs around production-relevant editor transitions:

- Canvas editor ready.
- Page added, renamed, duplicated, reordered, deleted, and switched.
- Boolean operation attempted, succeeded, or rejected with a concrete reason.
- Import from SVG/image/icon entry point succeeded or failed.
- Canvas document migration from root `children` to `pages`.

Logs should include useful IDs where available: `canvasId`, `projectId`, `pageId`, `nodeIds`, `operation`, and rejection reason.

Do not surface raw error codes, `null`, `undefined`, or default placeholders in the UI. UI errors must explain what failed and why in user-facing language.

## Error Handling

Follow the project rule: do not add fallback behavior that hides broken state.

Expected handling:

- Throw or surface typed errors for invalid page operations.
- Reject incompatible boolean operations with a clear message.
- Keep the document unchanged when a page or boolean operation fails.
- Log enough context to diagnose the failed operation.

## Testing

Phase A needs focused tests before broad visual polish:

- Unit tests for page operations and migration from legacy `children`-only documents.
- Unit tests for boolean operation eligibility and command behavior.
- Component tests for toolbar active/disabled states.
- Component tests for page tab actions.
- Existing canvas clipboard/import and keyboard shortcut tests should still pass.
- Playwright or local browser verification for drawing, selection, page switching, and persistence.

## Out Of Scope

Phase A does not include:

- Full OpenPencil Zustand store migration.
- Electron/native desktop file workflows.
- Full variables/theme manager.
- UIKit/component browser.
- Theme preset import/export.
- Multi-platform codegen.
- OpenPencil MCP server replacement.
- Concurrent agent team orchestration.
- Production database migrations.
- Auth, payment, deployment, global token, or unrelated style changes.

## Documentation Updates

When Phase A implementation changes workflow or contracts, update:

- `docs/tech/canvas-design-integration.md` or a nearby canvas technical note for editor/page behavior.
- `progress.md` and `feature_list.json` if project status tracking changes.

## Acceptance Criteria

Phase A is complete when:

- Users can manage multiple pages in a Cucumber canvas document.
- Toolbar and boolean toolbar commands are functional, not decorative.
- The current chat/sidebar/project/save/live-canvas behavior still works.
- Existing Cucumber canvas metadata survives editing, page switching, import, and persistence.
- TypeScript passes for affected workspaces.
- Lint passes or unrelated existing lint failures are documented.
- Relevant unit/component tests pass.
- Browser verification confirms the editor UI is usable at desktop and narrow widths without overlapping controls.
