"use client";

import { useMemo, useState } from "react";

import {
  type CucumberCanvasDocument,
  createEmptyCanvasDocument,
  flattenNodes,
  getActiveChildren,
} from "@cucumber/canvas-core";

import type { CanvasSceneElement } from "../../../components/canvas/canvas-api";
import { SkiaCanvas } from "../../../components/canvas/skia-canvas";

export function CanvasImportHarness() {
  const initialContent = useMemo(() => createEmptyCanvasDocument(), []);
  const [doc, setDoc] = useState<CucumberCanvasDocument>(() =>
    createEmptyCanvasDocument(),
  );
  const [selection, setSelection] = useState<CanvasSceneElement[]>([]);

  const importedSelection = selection.filter(
    (element) =>
      element.customData?.source === "figma-paste" ||
      element.customData?.source === "svg-import",
  );

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
        data-testid="canvas-import-stage"
        style={{
          background: "#0f172a",
          border: "1px solid rgba(148, 163, 184, 0.22)",
          borderRadius: 20,
          minHeight: 720,
          overflow: "hidden",
        }}
      >
        <SkiaCanvas
          initialContent={initialContent}
          onDocumentChange={setDoc}
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
          Canvas Import Harness
        </h1>
        <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>
          通过真实 paste 事件验证 Figma/SVG
          导入链路，并在右侧暴露当前选区与文档快照。
        </p>
        <div data-testid="selection-count">{selection.length}</div>
        <div data-testid="imported-selection-count">
          {importedSelection.length}
        </div>
        <pre
          data-testid="selected-meta"
          style={{
            background: "rgba(2, 6, 23, 0.55)",
            borderRadius: 12,
            fontSize: 12,
            margin: 0,
            minHeight: 180,
            overflow: "auto",
            padding: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          {JSON.stringify(importedSelection[0]?.customData ?? null, null, 2)}
        </pre>
        <pre
          data-testid="document-snapshot"
          style={{
            background: "rgba(2, 6, 23, 0.55)",
            borderRadius: 12,
            fontSize: 12,
            margin: 0,
            minHeight: 240,
            overflow: "auto",
            padding: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          {JSON.stringify(
            {
              nodeCount: flattenNodes(doc).length,
              rootNodeIds: getActiveChildren(doc).map((child) => child.id),
              selection: [],
              nodes: flattenNodes(doc).map((node) => ({
                id: node.id,
                type: node.type,
                name: node.name,
                childrenOrder:
                  "childrenOrder" in node ? node.childrenOrder : undefined,
                meta:
                  "meta" in node
                    ? (node.meta as Record<string, unknown> | undefined)
                    : undefined,
              })),
            },
            null,
            2,
          )}
        </pre>
      </aside>
    </main>
  );
}
