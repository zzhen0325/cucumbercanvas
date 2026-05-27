"use client";

import { useMemo, useRef, useState } from "react";

import {
  type CucumberCanvasDocument,
  type PenNode,
  createEmptyCanvasDocument,
  flattenNodes,
  getActiveChildren,
  resolveActivePageId,
} from "@cucumber/canvas-core";

import type {
  CanvasApi,
  CanvasSceneElement,
} from "../../../components/canvas/canvas-api";
import { SkiaCanvas } from "../../../components/canvas/skia-canvas";

const ACTIVE_PAGE_ID = "page-default";
const PLAN_ID = "prompt_canvas_web_smoke";
const ROOT_NODE_ID = `phase-c-${PLAN_ID}-root`;
const HERO_SECTION_ID = `phase-c-${PLAN_ID}-section-1-hero`;
const FORM_SECTION_ID = `phase-c-${PLAN_ID}-section-2-form`;

function createManualNode(): PenNode {
  return {
    id: "manual-note",
    type: "text",
    name: "Manual Note",
    content: "Manual note to preserve",
    x: 64,
    y: 72,
    width: 260,
    height: 40,
    fontSize: 16,
    fill: [{ type: "solid", color: "#0f172a" }],
  };
}

function withActivePageChildren(
  base: CucumberCanvasDocument,
  children: PenNode[],
): CucumberCanvasDocument {
  return {
    ...base,
    activePageId: ACTIVE_PAGE_ID,
    children: [],
    pages: [{ id: ACTIVE_PAGE_ID, name: "Page 1", children }],
  };
}

function createManualDocument(): CucumberCanvasDocument {
  return withActivePageChildren(createEmptyCanvasDocument(), [
    createManualNode(),
  ]);
}

function createSectionNode(options: {
  id: string;
  name: string;
  prompt: string;
  x: number;
  y: number;
  fill: string;
}): PenNode {
  const titleId = `${options.id}-title`;
  return {
    id: options.id,
    type: "frame",
    name: options.name,
    x: options.x,
    y: options.y,
    width: 500,
    height: 220,
    layout: "vertical",
    gap: 12,
    padding: [20, 24],
    fill: [{ type: "solid", color: options.fill }],
    stroke: {
      fill: [{ type: "solid", color: "#cbd5e1" }],
      thickness: 1,
    },
    cornerRadius: 12,
    containerRole: ["visual"],
    explain: `Phase C section ${options.id.replace(`phase-c-${PLAN_ID}-`, "")}: ${options.prompt}`,
    agentBinding: {
      agentType: "designer",
      name: `Section Agent: ${options.name}`,
      role: "designer",
      status: "completed",
      toolName: "prompt_canvas_execute",
    },
    createdByAgentId: "phase-c-orchestrator",
    children: [
      {
        id: titleId,
        type: "text",
        name: `${options.name} Title`,
        content: options.name,
        x: options.x + 24,
        y: options.y + 20,
        width: 452,
        height: 36,
        fontSize: 24,
        fontWeight: 700,
        fill: [{ type: "solid", color: "#0f172a" }],
      },
      {
        id: `${titleId}-summary`,
        type: "text",
        name: `${options.name} Summary`,
        content: options.prompt,
        x: options.x + 24,
        y: options.y + 64,
        width: 452,
        height: 54,
        fontSize: 15,
        fill: [{ type: "solid", color: "#475569" }],
      },
    ],
  };
}

function createAgentOutputDocument(
  current: CucumberCanvasDocument,
): CucumberCanvasDocument {
  const manualNodes = getActiveChildren(current, ACTIVE_PAGE_ID).filter(
    (node) => node.id === "manual-note",
  );
  const sectionNodes = [
    createSectionNode({
      id: HERO_SECTION_ID,
      name: "Hero",
      prompt: "Create the onboarding hero section.",
      x: 428,
      y: 160,
      fill: "#eff6ff",
    }),
    createSectionNode({
      id: FORM_SECTION_ID,
      name: "Form",
      prompt: "Create the signup form section.",
      x: 428,
      y: 404,
      fill: "#f8fafc",
    }),
  ];
  const rootNode: PenNode = {
    id: ROOT_NODE_ID,
    type: "frame",
    name: "Mobile Onboarding Prompt Canvas",
    x: 396,
    y: 112,
    width: 584,
    height: 604,
    layout: "vertical",
    gap: 24,
    padding: [32, 32],
    fill: [{ type: "solid", color: "#f8fafc" }],
    stroke: {
      fill: [{ type: "solid", color: "#2563eb" }],
      thickness: 1,
    },
    cornerRadius: 16,
    children: sectionNodes,
    containerRole: ["task", "visual"],
    explain:
      "Phase C prompt canvas root for: Create a mobile onboarding screen with hero and form sections",
    agentBinding: {
      agentType: "composer",
      name: "Phase C Orchestrator",
      role: "designer",
      status: "completed",
      toolName: "prompt_canvas_execute",
    },
    createdByAgentId: "phase-c-orchestrator",
  };

  return {
    ...withActivePageChildren(current, [...manualNodes, rootNode]),
    selection: [ROOT_NODE_ID],
  } as CucumberCanvasDocument;
}

export function CanvasAgentOutputHarness() {
  const initialContent = useMemo(() => createManualDocument(), []);
  const [doc, setDoc] = useState<CucumberCanvasDocument>(initialContent);
  const [selection, setSelection] = useState<CanvasSceneElement[]>([]);
  const apiRef = useRef<CanvasApi | null>(null);

  const applyAgentOutput = () => {
    const next = createAgentOutputDocument(doc);
    console.info("[canvas-agent-output-harness] applying fixture", {
      activePageId: next.activePageId,
      nodeIds: getActiveChildren(next).map((node) => node.id),
      rootNodeId: ROOT_NODE_ID,
    });
    apiRef.current?.setDocument(next);
    apiRef.current?.setSelection([ROOT_NODE_ID]);
  };

  const activePageId = resolveActivePageId(doc);
  const flattened = flattenNodes(doc, activePageId);

  return (
    <main
      style={{
        display: "grid",
        gap: 16,
        gridTemplateColumns: "minmax(0, 1fr) 400px",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <section
        data-testid="canvas-agent-output-stage"
        style={{
          background: "#f8fafc",
          border: "1px solid rgba(148, 163, 184, 0.4)",
          borderRadius: 20,
          minHeight: 720,
          overflow: "hidden",
        }}
      >
        <SkiaCanvas
          ref={apiRef}
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
          Canvas Agent Output Harness
        </h1>
        <button
          type="button"
          onClick={applyAgentOutput}
          style={{
            background: "#38bdf8",
            border: 0,
            borderRadius: 8,
            color: "#082f49",
            cursor: "pointer",
            fontWeight: 700,
            minHeight: 40,
          }}
        >
          Apply agent output
        </button>
        <pre
          data-testid="agent-output-snapshot"
          style={{
            background: "rgba(2, 6, 23, 0.55)",
            borderRadius: 12,
            fontSize: 12,
            margin: 0,
            minHeight: 520,
            overflow: "auto",
            padding: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          {JSON.stringify(
            {
              activePageId,
              nodeCount: flattened.length,
              selectedIds: selection.map((element) => element.id),
              nodes: flattened.map((node) => ({
                agentBinding: node.agentBinding,
                childrenOrder:
                  "children" in node && Array.isArray(node.children)
                    ? node.children.map((child) => child.id)
                    : undefined,
                containerRole: node.containerRole,
                content: "content" in node ? node.content : undefined,
                explain: node.explain,
                id: node.id,
                name: node.name,
                type: node.type,
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
