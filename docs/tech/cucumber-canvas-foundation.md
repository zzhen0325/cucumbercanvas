# Cucumber Canvas Foundation

This note replaces the old parity-oriented canvas notes. Cucumber's canvas is now treated as its own product substrate: the canvas is the durable visual result of Agent execution, and containers are the primary output units for generated work.

## Runtime Shape

- `PenDocument.pages` is the only supported durable canvas structure.
- `activePageId` must be present and must point to an existing page.
- Root `children` and old flat-map document shapes are not migrated, reset, or silently normalized in runtime paths.
- If unsupported canvas content is encountered, the caller should receive a clear fail-fast error. Any real historical production data repair belongs in a separate data-fix task.

## Primary Read/Write Chain

Agent canvas operations must use the live editor state:

1. Frontend binds an open editor with `canvas.bind`.
2. `CanvasEditor` exposes `canvas.document.get`, `canvas.document.set`, and screenshot RPC.
3. `LiveCanvasService` reads and writes the current editor document.
4. Agent tools call `inspect_canvas`, `manipulate_canvas`, or the Cucumber structured canvas MCP tools.

## Development Order

1. Stabilize the base canvas: pages, selection, rendering, persistence, import/export, and performance.
2. Make canvas tools and container types easier to extend.
3. Ensure Agent can fully read and call the live canvas state before editing.
4. Tune the Agent runtime workflow after the canvas substrate is reliable.
