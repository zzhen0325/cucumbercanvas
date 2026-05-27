"use client";

import { useMemo, useState } from "react";

import {
  type CucumberCanvasDocument,
  type PenNode,
  createEmptyDocument,
  flattenNodes,
} from "@cucumber/canvas-core";

import { CanvasLayersPanel } from "../../../components/canvas-layers-panel";
import type {
  CanvasApi,
  CanvasSceneElement,
} from "../../../components/canvas/canvas-api";
import {
  analyzeDocumentExportWarnings,
  calculateDocumentBounds,
} from "../../../components/canvas/canvas-export";
import { CanvasPropertyPanel } from "../../../components/canvas/property-panel/canvas-property-panel";
import { SkiaCanvas } from "../../../components/canvas/skia-canvas";

export function CanvasEngineHarness() {
  const emptyDocument = useMemo(() => createEmptyDocument(), []);
  const [canvasKey, setCanvasKey] = useState(0);
  const [persistedDoc, setPersistedDoc] =
    useState<CucumberCanvasDocument>(emptyDocument);
  const [api, setApi] = useState<CanvasApi | null>(null);
  const [selection, setSelection] = useState<CanvasSceneElement[]>([]);
  const [exportResult, setExportResult] = useState<Record<string, unknown>>({});
  const [showLayers, setShowLayers] = useState(false);
  const [doc, setDoc] = useState<CucumberCanvasDocument>(() =>
    createEmptyDocument(),
  );
  const selectedIds = selection.map((element) => element.id);
  const selectedNode =
    flattenNodes(doc).find((node) => node.id === selectedIds[0]) ?? null;

  const seedMainPathDocument = () => {
    if (!api) return;
    const seeded = createMainPathDocument();
    api.setDocument(seeded);
    api.setSelection(["smoke-rect"]);
    setPersistedDoc(seeded);
    setDoc(seeded);
  };

  const exportSmokeImage = async () => {
    if (!api) return;
    const currentDoc = api.getDocument();
    const blob = await api.exportImage({
      bounds: calculateDocumentBounds(currentDoc),
      maxWidthOrHeight: 512,
      mimeType: "image/svg+xml",
    });
    const svg = await blob.text();
    setExportResult({
      mimeType: blob.type,
      size: blob.size,
      includesTitle: svg.includes("Smoke title"),
      warnings: analyzeDocumentExportWarnings(currentDoc),
    });
  };

  const remountFromCurrentDocument = () => {
    if (!api) return;
    setCanvasKey((value) => value + 1);
  };

  const handleDocumentChange = (nextDoc: CucumberCanvasDocument) => {
    setPersistedDoc(nextDoc);
    setDoc(nextDoc);
  };

  return (
    <main
      style={{
        display: "grid",
        gap: 16,
        gridTemplateColumns: "minmax(0, 1fr) 360px",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <section
        data-testid="skia-canvas-stage"
        style={{
          background: "#f8fafc",
          border: "1px solid rgba(148, 163, 184, 0.4)",
          borderRadius: 20,
          minHeight: 720,
          overflow: "hidden",
        }}
      >
        <SkiaCanvas
          key={canvasKey}
          initialContent={persistedDoc}
          onApiReady={setApi}
          onDocumentChange={handleDocumentChange}
          onSelectionChange={setSelection}
        />
      </section>

      <aside
        style={{
          background: "rgba(15, 23, 42, 0.96)",
          border: "1px solid rgba(148, 163, 184, 0.22)",
          borderRadius: 20,
          color: "#e2e8f0",
          display: "grid",
          gap: 12,
          padding: 16,
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
          Skia Canvas Harness
        </h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            data-testid="seed-main-path-document"
            disabled={!api}
            onClick={seedMainPathDocument}
            type="button"
          >
            Seed main path
          </button>
          <button
            data-testid="export-main-path-document"
            disabled={!api}
            onClick={() => void exportSmokeImage()}
            type="button"
          >
            Export
          </button>
          <button
            data-testid="remount-main-path-document"
            disabled={!api}
            onClick={remountFromCurrentDocument}
            type="button"
          >
            Remount
          </button>
          <button
            data-testid="open-main-path-layers"
            disabled={!api}
            onClick={() => setShowLayers(true)}
            type="button"
          >
            Layers
          </button>
        </div>
        <CanvasLayersPanel
          canvasApi={api}
          onClose={() => setShowLayers(false)}
          open={showLayers}
        />
        <div
          data-testid="property-panel-host"
          style={{
            minHeight: 420,
            position: "relative",
          }}
        >
          {selectedNode ? (
            <CanvasPropertyPanel
              node={selectedNode}
              onBindAgent={(binding) =>
                api?.bindAgentToContainer(selectedNode.id, binding)
              }
              onUpdate={(updates) => api?.updateNode(selectedNode.id, updates)}
            />
          ) : null}
        </div>
        <pre
          data-testid="skia-document-snapshot"
          style={{
            background: "rgba(2, 6, 23, 0.55)",
            borderRadius: 12,
            fontSize: 12,
            margin: 0,
            minHeight: 420,
            overflow: "auto",
            padding: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          {JSON.stringify(
            {
              nodeCount: flattenNodes(doc).length,
              selectedIds,
              nodes: flattenNodes(doc).map((node) => ({
                connectorType:
                  "_connectorType" in node ? node._connectorType : undefined,
                content: "content" in node ? node.content : undefined,
                d: "d" in node ? node.d : undefined,
                fill: "fill" in node ? node.fill : undefined,
                id: node.id,
                locked: "locked" in node ? node.locked : undefined,
                path: "path" in node ? node.path : undefined,
                rotation: "rotation" in node ? node.rotation : undefined,
                type: node.type,
                visible: "visible" in node ? node.visible : undefined,
                x: node.x,
                x2: "x2" in node ? node.x2 : undefined,
                y: node.y,
                y2: "y2" in node ? node.y2 : undefined,
                width: "width" in node ? node.width : undefined,
                height: "height" in node ? node.height : undefined,
              })),
            },
            null,
            2,
          )}
        </pre>
        <pre
          data-testid="main-path-export-result"
          style={{
            background: "rgba(2, 6, 23, 0.55)",
            borderRadius: 12,
            fontSize: 12,
            margin: 0,
            minHeight: 120,
            overflow: "auto",
            padding: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          {JSON.stringify(exportResult, null, 2)}
        </pre>
      </aside>
    </main>
  );
}

function createMainPathDocument(): CucumberCanvasDocument {
  const doc = createEmptyDocument();
  const nodes: PenNode[] = [
    {
      children: [],
      fill: [
        {
          type: "linear_gradient",
          stops: [
            { color: "#0f172a", offset: 0 },
            { color: "#d3f256", offset: 1 },
          ],
        },
      ],
      height: 120,
      id: "smoke-rect",
      name: "Smoke rect",
      type: "rectangle",
      width: 180,
      x: 40,
      y: 56,
    } as PenNode,
    {
      content: "Smoke title",
      fill: [{ type: "solid", color: "#111827" }],
      fontSize: 24,
      height: 48,
      id: "smoke-title",
      name: "Smoke title",
      type: "text",
      width: 220,
      x: 280,
      y: 72,
    } as PenNode,
  ];
  doc.children = nodes;
  if (doc.pages?.[0]) doc.pages[0].children = nodes;
  return doc;
}
