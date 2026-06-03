import {
  type PenDocument,
  type PenNode,
  getActivePage,
} from "@cucumber/canvas-core";
import { z } from "zod";

import type { CucumberMcpTool } from "../types.js";
import { schemaToJsonSchema } from "../utils.js";
import {
  type AiNativeCanvasToolDeps,
  compactRecord,
  errorResult,
  jsonResult,
  readAiNativeCanvasLiveContext,
} from "./ai-native-canvas-context.js";
import {
  type IndexedCanvasNode,
  indexCanvasNodes,
  shouldIncludeCanvasNode,
} from "./ai-native-canvas-semantic-model.js";

const TOOL_NAME = "canvas_memory_index";

const canvasMemoryIndexSchema = z.object({
  query: z.string().optional(),
  nodeIds: z.array(z.string()).optional(),
  pageId: z.string().optional(),
  includeHidden: z.boolean().default(false),
  includeLocked: z.boolean().default(true),
  includeTextNodes: z.boolean().default(true),
  maxEntries: z.number().int().min(1).max(200).default(50),
});

type MemoryIndexEntry = {
  id: string;
  nodeId: string;
  nodeType: string;
  title: string;
  kind: "agent_output" | "context" | "text" | "node";
  score: number;
  sourceNodeIds: string[];
  searchableText: string;
  metadata: Record<string, unknown>;
};

export function createCanvasMemoryIndexMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof canvasMemoryIndexSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Build a read-only searchable memory index from durable live canvas nodes, context slots, Agent bindings, run/session metadata, and text content. This tool returns an index view only and does not persist memory or mutate the canvas.",
    schema: canvasMemoryIndexSchema,
    inputSchema: schemaToJsonSchema(canvasMemoryIndexSchema),
    execute: async (args, context) => {
      try {
        const input = canvasMemoryIndexSchema.parse(args);
        const live = await readAiNativeCanvasLiveContext(
          deps,
          context,
          TOOL_NAME,
        );
        const result = buildCanvasMemoryIndex({
          doc: live.doc,
          includeHidden: input.includeHidden,
          includeLocked: input.includeLocked,
          includeTextNodes: input.includeTextNodes,
          maxEntries: input.maxEntries,
          nodeIds: input.nodeIds,
          pageId: input.pageId,
          query: input.query,
        });
        console.info("[ai-native-canvas] memory_index.read", {
          canvasId: live.canvasId,
          entryCount: result.entries.length,
          pageId: input.pageId ?? live.doc.activePageId,
          query: input.query,
          userId: live.user.id,
        });
        return jsonResult({
          canvasId: live.canvasId,
          summary: `Built ${result.entries.length} live canvas memory index entries.`,
          ...result,
        });
      } catch (error) {
        const payload = {
          error:
            error instanceof Error && "code" in error
              ? String((error as { code: unknown }).code)
              : "canvas_memory_index_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to build the canvas memory index.",
        };
        console.warn("[ai-native-canvas] memory_index.read failed", payload);
        return errorResult(payload);
      }
    },
  };
}

function buildCanvasMemoryIndex(args: {
  doc: PenDocument;
  includeHidden: boolean;
  includeLocked: boolean;
  includeTextNodes: boolean;
  maxEntries: number;
  nodeIds?: string[];
  pageId?: string;
  query?: string;
}) {
  const page = getActivePage(args.doc, args.pageId);
  const indexed = indexCanvasNodes(page.children);
  const byId = new Map(indexed.map((entry) => [entry.node.id, entry]));
  const explicitIds = args.nodeIds?.length ? new Set(args.nodeIds) : null;
  if (explicitIds) {
    for (const nodeId of explicitIds) {
      if (!byId.has(nodeId)) {
        throw new Error(`canvas_memory_index node ${nodeId} does not exist.`);
      }
    }
  }
  const queryTerms = tokenize(args.query);
  const warnings: Record<string, unknown>[] = [];
  const entries = indexed
    .filter((entry) => {
      if (explicitIds && !explicitIds.has(entry.node.id)) return false;
      if (
        !shouldIncludeCanvasNode(entry.node, {
          includeHidden: args.includeHidden,
          includeLocked: args.includeLocked,
        })
      ) {
        warnings.push({
          code:
            entry.node.visible === false
              ? "hidden_node_omitted"
              : "locked_node_omitted",
          nodeId: entry.node.id,
        });
        return false;
      }
      if (!args.includeTextNodes && entry.node.type === "text") return false;
      return true;
    })
    .map((entry) => createMemoryEntry(entry))
    .filter((entry): entry is MemoryIndexEntry => Boolean(entry))
    .map((entry) => ({
      ...entry,
      score: scoreEntry(entry, queryTerms),
    }))
    .filter((entry) => queryTerms.length === 0 || entry.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, args.maxEntries);

  return {
    query: args.query,
    source: {
      durableTruth: "PenDocument.pages",
      liveCanvasDocument: true,
      persistedMemory: false,
    },
    entryCount: entries.length,
    entries,
    warnings,
  };
}

function createMemoryEntry(entry: IndexedCanvasNode): MemoryIndexEntry | null {
  const node = entry.node;
  const contextSlots = isRecord(node.contextSlots) ? node.contextSlots : {};
  const searchableParts = [
    node.name,
    node.type,
    node.role,
    node.containerRole,
    node.explain,
    node.createdByAgentId,
    node.runId,
    node.sessionId,
    node.agentBinding,
    contextSlots,
    node.type === "text" ? node.content : undefined,
  ];
  const searchableText = normalizeSearchText(searchableParts);
  if (!searchableText) return null;

  return {
    id: `memory:${node.id}`,
    nodeId: node.id,
    nodeType: node.type,
    title: node.name ?? node.id,
    kind: classifyMemoryKind(node),
    score: 0,
    sourceNodeIds: [node.id],
    searchableText,
    metadata: compactRecord({
      agentBinding: node.agentBinding,
      containerRole: node.containerRole,
      contextSlots,
      createdByAgentId: node.createdByAgentId,
      parentId: entry.parentId,
      parentPath: entry.parentPath,
      runId: node.runId,
      sessionId: node.sessionId,
    }),
  };
}

function classifyMemoryKind(node: PenNode): MemoryIndexEntry["kind"] {
  if (node.agentBinding || node.createdByAgentId || node.runId) {
    return "agent_output";
  }
  if (node.contextSlots || node.containerRole) return "context";
  if (node.type === "text") return "text";
  return "node";
}

function scoreEntry(entry: MemoryIndexEntry, queryTerms: string[]) {
  if (queryTerms.length === 0) {
    if (entry.kind === "agent_output") return 4;
    if (entry.kind === "context") return 3;
    if (entry.kind === "text") return 2;
    return 1;
  }
  const haystack = entry.searchableText.toLowerCase();
  return queryTerms.reduce(
    (score, term) => score + (haystack.includes(term) ? 1 : 0),
    0,
  );
}

function tokenize(query?: string) {
  return Array.from(
    new Set(
      (query ?? "")
        .toLowerCase()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeSearchText(values: unknown[]) {
  const parts: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string" || typeof value === "number") {
      parts.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (isRecord(value)) {
      for (const item of Object.values(value)) visit(item);
    }
  };
  for (const value of values) visit(value);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
