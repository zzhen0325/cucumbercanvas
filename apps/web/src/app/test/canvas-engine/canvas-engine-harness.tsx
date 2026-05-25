"use client";

import { useMemo, useState } from "react";

import {
  type CucumberCanvasDocument,
  createEmptyCanvasDocument,
  flattenNodes,
} from "@cucumber/canvas-core";

import { SkiaCanvas } from "../../../components/canvas/skia-canvas";

export function CanvasEngineHarness() {
  const initialContent = useMemo(() => createEmptyCanvasDocument(), []);
  const [doc, setDoc] = useState<CucumberCanvasDocument>(() =>
    createEmptyCanvasDocument(),
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
        data-testid="skia-canvas-stage"
        style={{
          background: "#f8fafc",
          border: "1px solid rgba(148, 163, 184, 0.4)",
          borderRadius: 20,
          minHeight: 720,
          overflow: "hidden",
        }}
      >
        <SkiaCanvas initialContent={initialContent} onDocumentChange={setDoc} />
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
              nodes: flattenNodes(doc).map((node) => ({
                id: node.id,
                type: node.type,
                x: node.x,
                y: node.y,
                width: "width" in node ? node.width : undefined,
                height: "height" in node ? node.height : undefined,
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
