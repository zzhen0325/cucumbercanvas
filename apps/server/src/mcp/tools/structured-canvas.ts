import { randomUUID } from "node:crypto";
import {
  type CanvasBounds,
  type PenDocument,
  type PenNode,
  addCanvasPage,
  createNodeId,
  deleteCanvasPage,
  duplicateCanvasPage,
  findNode,
  getActiveChildren,
  getNodeBounds,
  insertCanvasImportResult,
  isCucumberCanvasDocument,
  normalizeCanvasPages,
  parseClipboardImport,
  renameCanvasPage,
  resolveActivePageId,
} from "@cucumber/canvas-core";
import { z } from "zod";

import type { LiveCanvasService } from "../../features/canvas/live-canvas-service.js";
import type {
  CucumberMcpTool,
  McpToolCallResult,
  McpToolContext,
} from "../types.js";
import { schemaToJsonSchema } from "../utils.js";

const batchDesignSchema = z.object({
  canvasWidth: z.number().positive().optional(),
  filePath: z.string().optional(),
  operations: z
    .string()
    .min(1)
    .describe(
      "Cucumber structured canvas DSL. One operation per line: binding=I(parent,{...}), binding=C(source,parent,{...}), U(path,{...}), binding=R(path,{...}), M(node,parent,index?), D(node).",
    ),
  pageId: z.string().optional().describe("Optional page id to edit."),
  postProcess: z.boolean().optional(),
});

const batchGetSchema = z.object({
  filePath: z.string().optional(),
  patterns: z
    .array(
      z.object({
        type: z.string().optional(),
        name: z.string().optional(),
        reusable: z.boolean().optional(),
      }),
    )
    .optional(),
  nodeIds: z.array(z.string()).optional(),
  parentId: z.string().optional(),
  readDepth: z.number().int().min(0).max(8).default(1),
  resolve_refs: z.boolean().optional(),
  resolveRefs: z.boolean().optional(),
  searchDepth: z.number().int().min(0).max(20).default(20),
  pageId: z.string().optional(),
});

const snapshotLayoutSchema = z.object({
  parentId: z.string().optional(),
  maxDepth: z.number().int().min(0).max(12).default(2),
  problemsOnly: z.boolean().default(false),
  pageId: z.string().optional(),
});

const findEmptySpaceSchema = z.object({
  direction: z.enum(["top", "right", "bottom", "left"]),
  width: z.number().positive(),
  height: z.number().positive(),
  padding: z.number().min(0).default(50),
  nodeId: z.string().optional(),
  pageId: z.string().optional(),
});

const pageNodeSchema = z.record(z.string(), z.unknown());

const addPageSchema = z.object({
  children: z.array(pageNodeSchema).optional(),
  filePath: z.string().optional(),
  name: z.string().trim().min(1).optional(),
});

const removePageSchema = z.object({
  filePath: z.string().optional(),
  pageId: z.string().min(1),
});

const renamePageSchema = z.object({
  filePath: z.string().optional(),
  name: z.string().trim().min(1),
  pageId: z.string().min(1),
});

const reorderPageSchema = z.object({
  filePath: z.string().optional(),
  index: z.number().int().min(0),
  pageId: z.string().min(1),
});

const duplicatePageSchema = z.object({
  filePath: z.string().optional(),
  name: z.string().trim().min(1).optional(),
  pageId: z.string().min(1),
});

const designSkeletonSchema = z.object({
  canvasWidth: z.number().positive().optional(),
  filePath: z.string().optional(),
  pageId: z.string().optional(),
  rootFrame: z.object({
    fill: z.array(z.record(z.string(), z.unknown())).optional(),
    gap: z.number().optional(),
    height: z.number().positive(),
    layout: z.enum(["vertical", "horizontal"]).optional(),
    name: z.string().trim().min(1).optional(),
    padding: z.unknown().optional(),
    width: z.number().positive(),
  }),
  sections: z
    .array(
      z.object({
        alignItems: z.string().optional(),
        fill: z.array(z.record(z.string(), z.unknown())).optional(),
        gap: z.number().optional(),
        height: z.union([z.number().positive(), z.string()]).optional(),
        justifyContent: z.string().optional(),
        layout: z.enum(["vertical", "horizontal"]).optional(),
        name: z.string().trim().min(1),
        padding: z.unknown().optional(),
        role: z.string().optional(),
      }),
    )
    .min(1),
  styleGuide: z.record(z.string(), z.unknown()).optional(),
});

const designContentSchema = z.object({
  canvasWidth: z.number().positive().optional(),
  children: z.array(pageNodeSchema).min(1),
  filePath: z.string().optional(),
  pageId: z.string().optional(),
  postProcess: z.boolean().default(true),
  sectionId: z.string().min(1),
});

const designRefineSchema = z.object({
  canvasWidth: z.number().positive().optional(),
  filePath: z.string().optional(),
  pageId: z.string().optional(),
  rootId: z.string().min(1),
});

const importFigmaClipboardSchema = z.object({
  html: z
    .string()
    .min(1)
    .describe("Figma clipboard HTML containing fig-kiwi data."),
  parentId: z.string().optional(),
  offsetX: z.number().default(0),
  offsetY: z.number().default(0),
});

const readNodesSchema = z.object({
  nodeIds: z.array(z.string()).optional(),
  depth: z.number().int().min(-1).max(12).default(-1),
  pageId: z.string().optional(),
  includeVariables: z.boolean().default(false),
});

const propertyNameSchema = z.enum([
  "fillColor",
  "textColor",
  "strokeColor",
  "strokeThickness",
  "cornerRadius",
  "padding",
  "gap",
  "fontSize",
  "fontFamily",
  "fontWeight",
]);

const searchUniquePropertiesSchema = z.object({
  parents: z.array(z.string()).min(1),
  properties: z.array(propertyNameSchema).min(1),
  pageId: z.string().optional(),
});

const replacementRuleSchema = z.object({
  from: z.unknown(),
  to: z.unknown(),
});

const replaceMatchingPropertiesSchema = z.object({
  parents: z.array(z.string()).min(1),
  properties: z.record(z.string(), z.array(replacementRuleSchema)),
  pageId: z.string().optional(),
});

const variableDefinitionSchema = z.object({
  type: z.enum(["color", "number", "string", "boolean"]),
  value: z.unknown(),
});

const setVariablesSchema = z.object({
  variables: z.record(z.string(), variableDefinitionSchema),
  replace: z.boolean().default(false),
});

const setThemesSchema = z.object({
  themes: z.record(z.string(), z.array(z.string())),
  replace: z.boolean().default(false),
});

const phaseCExportTargetSchema = z.enum(["react", "html", "vue"]);

const promptCanvasPlanSchema = z.object({
  prompt: z.string().trim().min(1),
  surface: z
    .enum(["desktop", "mobile", "dashboard", "flow", "auto"])
    .default("auto"),
  maxSections: z.number().int().min(1).max(6).default(4),
  exportTargets: z.array(z.string()).min(1).default(["react", "html", "vue"]),
  pageId: z.string().optional(),
});

const promptCanvasExecuteSchema = z.object({
  planId: z.string().min(1),
  concurrency: z.number().int().min(1).max(4).default(2),
  commitMode: z.enum(["section", "final"]).default("section"),
  pageId: z.string().optional(),
});

const codegenPlanSchema = z.object({
  plan: z.record(z.string(), z.unknown()),
  pageId: z.string().optional(),
});

const codegenSubmitSchema = z.object({
  planId: z.string().min(1),
  result: z.record(z.string(), z.unknown()),
  status: z.enum(["failed", "skipped"]).optional(),
});

const codegenAssembleSchema = z.object({
  planId: z.string().min(1),
  framework: z.enum([
    "react",
    "vue",
    "svelte",
    "html",
    "flutter",
    "swiftui",
    "compose",
    "react-native",
  ]),
});

const codegenCleanSchema = z.object({
  planId: z.string().min(1),
});

const codegenExportSchema = z.object({
  framework: z.enum(["react", "html", "vue"]),
  nodeIds: z.array(z.string()).optional(),
  componentName: z.string().default("CucumberExport"),
});

type BatchDesignInput = z.infer<typeof batchDesignSchema>;
type BatchGetInput = z.infer<typeof batchGetSchema>;
type SnapshotLayoutInput = z.infer<typeof snapshotLayoutSchema>;
type FindEmptySpaceInput = z.infer<typeof findEmptySpaceSchema>;
type DesignSkeletonInput = z.infer<typeof designSkeletonSchema>;
type DesignContentInput = z.infer<typeof designContentSchema>;
type DesignRefineInput = z.infer<typeof designRefineSchema>;
type PropertyName = z.infer<typeof propertyNameSchema>;
type ReplacementRule = z.infer<typeof replacementRuleSchema>;
type CodegenExportInput = z.infer<typeof codegenExportSchema>;
type PromptCanvasSurface = z.infer<typeof promptCanvasPlanSchema>["surface"];
type PhaseCExportTarget = z.infer<typeof phaseCExportTargetSchema>;
type PromptCanvasSectionStatus = "completed" | "failed" | "skipped";

type CodegenChunk = {
  chunkId: string;
  nodeIds?: string[];
  dependsOn?: string[];
};

type CodegenPlanRecord = {
  executionPlan: CodegenChunk[];
  pageId?: string;
  plan: Record<string, unknown>;
  results: Map<string, Record<string, unknown>>;
  submittedAt: number;
};

const codegenPlans = new Map<string, CodegenPlanRecord>();

type PromptCanvasSectionPlan = {
  sectionId: string;
  title: string;
  role: string;
  prompt: string;
  region: CanvasBounds;
  dependencies: string[];
  expectedNodeBudget: number;
};

type PromptCanvasPlanRecord = {
  planId: string;
  prompt: string;
  surface: PromptCanvasSurface;
  exportTargets: PhaseCExportTarget[];
  pageId?: string;
  rootFrame: CanvasBounds & {
    name: string;
    layout: "vertical" | "horizontal" | "none";
  };
  sections: PromptCanvasSectionPlan[];
  warnings: string[];
  createdAt: number;
};

const promptCanvasPlans = new Map<string, PromptCanvasPlanRecord>();

type ToolDeps = {
  liveCanvasService?: LiveCanvasService;
};

type LiveContext = {
  canvasId: string;
  doc: PenDocument;
  user: {
    accessToken: string;
    email: string;
    id: string;
    userMetadata: Record<string, unknown>;
  };
};

type RuntimeDocument = PenDocument & {
  selection?: string[];
};

type OpResult = {
  binding: string;
  nodeId: string;
};

type LayeredSectionResult = {
  contentWidth: number;
  guidelines: string;
  id: string;
  name: string;
  suggestedRoles: string[];
};

const CODEGEN_RENDERED_NODE_TYPES = new Set([
  "frame",
  "rectangle",
  "text",
  "image",
  "line",
  "ellipse",
  "polygon",
  "path",
  "icon_font",
  "videoEmbed",
]);

export function createStructuredCanvasMcpTools(
  deps: ToolDeps,
): CucumberMcpTool[] {
  return [
    createNativeMcpTool({
      name: "batch_design",
      description:
        "Cucumber structured canvas batch canvas editor for the live Cucumber canvas. Use it for complex structured design edits when manipulate_canvas is too restrictive. Supports I/C/U/R/M/D operations with same-batch bindings.",
      schema: batchDesignSchema,
      execute: async (args, context) => {
        const input = batchDesignSchema.parse(args);
        ensureLiveCanvasOnly(input.filePath, "batch_design");
        const live = await readLiveContext(deps, context);
        const result = applyBatchDesign(live.doc, input);
        const liveCanvasService = deps.liveCanvasService;
        if (!liveCanvasService) {
          throw new Error(
            "Cucumber structured canvas tools require a live canvas service.",
          );
        }
        await liveCanvasService.setDocument(
          live.user,
          live.canvasId,
          result.doc,
        );
        console.info("[structured-canvas] batch_design applied", {
          canvasId: live.canvasId,
          nodeCount: countNodes(getDocChildren(result.doc, input.pageId)),
          operations: splitOperations(input.operations).length,
          userId: live.user.id,
        });
        return jsonResult({
          success: true,
          summary: `Applied ${result.results.length} Cucumber structured canvas operations.`,
          results: result.results,
          nodeCount: countNodes(getDocChildren(result.doc, input.pageId)),
        });
      },
    }),
    createNativeMcpTool({
      name: "batch_get",
      description:
        "Cucumber structured canvas canvas reader. Search live canvas nodes by type/name/reusable flag or read specific node ids with bounded child depth.",
      schema: batchGetSchema,
      execute: async (args, context) => {
        const input = batchGetSchema.parse(args);
        ensureLiveCanvasOnly(input.filePath, "batch_get");
        const live = await readLiveContext(deps, context);
        const nodes = applyBatchGet(live.doc, input);
        console.info("[structured-canvas] batch_get read", {
          canvasId: live.canvasId,
          matched: nodes.length,
          userId: live.user.id,
        });
        return jsonResult({
          summary: `Read ${nodes.length} canvas node(s).`,
          nodes,
        });
      },
    }),
    createNativeMcpTool({
      name: "snapshot_layout",
      description:
        "Cucumber structured canvas layout snapshot for the live Cucumber canvas. Returns bounding boxes, hierarchy, and optional layout problems.",
      schema: snapshotLayoutSchema,
      execute: async (args, context) => {
        const input = snapshotLayoutSchema.parse(args);
        const live = await readLiveContext(deps, context);
        const snapshot = buildLayoutSnapshot(live.doc, input);
        return jsonResult({
          summary: `Snapshot contains ${snapshot.length} layout node(s).`,
          nodes: snapshot,
        });
      },
    }),
    createNativeMcpTool({
      name: "find_empty_space",
      description:
        "Cucumber structured canvas canvas placement helper. Finds an empty rectangle around a node or around all canvas content.",
      schema: findEmptySpaceSchema,
      execute: async (args, context) => {
        const input = findEmptySpaceSchema.parse(args);
        const live = await readLiveContext(deps, context);
        const region = findEmptySpace(live.doc, input);
        return jsonResult({
          summary: `Found empty ${input.width}x${input.height} region at (${region.x}, ${region.y}).`,
          region,
        });
      },
    }),
    createNativeMcpTool({
      name: "add_page",
      description:
        "Cucumber structured canvas page operation. Add a page to the live Cucumber canvas.",
      schema: addPageSchema,
      execute: async (args, context) => {
        const input = addPageSchema.parse(args);
        ensureLiveCanvasOnly(input.filePath, "add_page");
        const live = await readLiveContext(deps, context);
        const children = input.children
          ? input.children.map((child) => coerceInputNode(child, "add_page"))
          : [createDefaultPageFrame()];
        const result = addCanvasPage(live.doc, {
          children,
          name: input.name,
        });
        await requireLiveCanvasService(deps).setDocument(
          live.user,
          live.canvasId,
          result.document,
        );
        console.info("[structured-canvas] page added", {
          canvasId: live.canvasId,
          pageCount: result.document.pages?.length ?? 1,
          pageId: result.page.id,
          userId: live.user.id,
        });
        return jsonResult({
          success: true,
          summary: `Added page ${result.page.name}.`,
          pageId: result.page.id,
          page: result.page,
          pageCount: result.document.pages?.length ?? 1,
        });
      },
    }),
    createNativeMcpTool({
      name: "remove_page",
      description:
        "Cucumber structured canvas page operation. Remove a page from the live Cucumber canvas.",
      schema: removePageSchema,
      execute: async (args, context) => {
        const input = removePageSchema.parse(args);
        ensureLiveCanvasOnly(input.filePath, "remove_page");
        const live = await readLiveContext(deps, context);
        const result = deleteCanvasPage(live.doc, input.pageId);
        await requireLiveCanvasService(deps).setDocument(
          live.user,
          live.canvasId,
          result.document,
        );
        console.info("[structured-canvas] page removed", {
          canvasId: live.canvasId,
          pageCount: result.document.pages?.length ?? 1,
          pageId: input.pageId,
          userId: live.user.id,
        });
        return jsonResult({
          success: true,
          summary: `Removed page ${input.pageId}.`,
          pageCount: result.document.pages?.length ?? 1,
          activePageId: result.document.activePageId,
        });
      },
    }),
    createNativeMcpTool({
      name: "rename_page",
      description:
        "Cucumber structured canvas page operation. Rename a live Cucumber canvas page.",
      schema: renamePageSchema,
      execute: async (args, context) => {
        const input = renamePageSchema.parse(args);
        ensureLiveCanvasOnly(input.filePath, "rename_page");
        const live = await readLiveContext(deps, context);
        const result = renameCanvasPage(live.doc, input.pageId, input.name);
        await requireLiveCanvasService(deps).setDocument(
          live.user,
          live.canvasId,
          result.document,
        );
        console.info("[structured-canvas] page renamed", {
          canvasId: live.canvasId,
          pageId: input.pageId,
          userId: live.user.id,
        });
        return jsonResult({
          success: true,
          summary: `Renamed page ${input.pageId} to ${result.page.name}.`,
          pageId: result.page.id,
          page: result.page,
          pageCount: result.document.pages?.length ?? 1,
        });
      },
    }),
    createNativeMcpTool({
      name: "reorder_page",
      description:
        "Cucumber structured canvas page operation. Move a live Cucumber canvas page to a zero-based index.",
      schema: reorderPageSchema,
      execute: async (args, context) => {
        const input = reorderPageSchema.parse(args);
        ensureLiveCanvasOnly(input.filePath, "reorder_page");
        const live = await readLiveContext(deps, context);
        const result = reorderCanvasPageToIndex(
          live.doc,
          input.pageId,
          input.index,
        );
        await requireLiveCanvasService(deps).setDocument(
          live.user,
          live.canvasId,
          result.document,
        );
        console.info("[structured-canvas] page reordered", {
          canvasId: live.canvasId,
          index: input.index,
          pageId: input.pageId,
          userId: live.user.id,
        });
        return jsonResult({
          success: true,
          summary: `Moved page ${input.pageId}.`,
          pageId: result.page.id,
          page: result.page,
          pageCount: result.document.pages?.length ?? 1,
        });
      },
    }),
    createNativeMcpTool({
      name: "duplicate_page",
      description:
        "Cucumber structured canvas page operation. Duplicate a live Cucumber canvas page with fresh node IDs.",
      schema: duplicatePageSchema,
      execute: async (args, context) => {
        const input = duplicatePageSchema.parse(args);
        ensureLiveCanvasOnly(input.filePath, "duplicate_page");
        const live = await readLiveContext(deps, context);
        const duplicated = duplicateCanvasPage(live.doc, input.pageId);
        const result = input.name
          ? renameCanvasPage(
              duplicated.document,
              duplicated.page.id,
              input.name,
            )
          : duplicated;
        await requireLiveCanvasService(deps).setDocument(
          live.user,
          live.canvasId,
          result.document,
        );
        console.info("[structured-canvas] page duplicated", {
          canvasId: live.canvasId,
          pageCount: result.document.pages?.length ?? 1,
          pageId: result.page.id,
          sourcePageId: input.pageId,
          userId: live.user.id,
        });
        return jsonResult({
          success: true,
          summary: `Duplicated page ${input.pageId}.`,
          pageId: result.page.id,
          page: result.page,
          pageCount: result.document.pages?.length ?? 1,
        });
      },
    }),
    createNativeMcpTool({
      name: "design_skeleton",
      description:
        "Cucumber layered canvas design operation. Create a root frame plus section frames in the live canvas.",
      schema: designSkeletonSchema,
      execute: async (args, context) => {
        const input = designSkeletonSchema.parse(args);
        ensureLiveCanvasOnly(input.filePath, "design_skeleton");
        const live = await readLiveContext(deps, context);
        const result = applyDesignSkeleton(live.doc, input);
        await requireLiveCanvasService(deps).setDocument(
          live.user,
          live.canvasId,
          result.doc,
        );
        console.info("[structured-canvas] design skeleton created", {
          canvasId: live.canvasId,
          pageId: input.pageId,
          rootId: result.rootId,
          sectionCount: result.sections.length,
          userId: live.user.id,
        });
        return jsonResult({
          success: true,
          summary: `Created layered design skeleton with ${result.sections.length} section(s).`,
          rootId: result.rootId,
          sections: result.sections,
          nextSteps: result.nextSteps,
        });
      },
    }),
    createNativeMcpTool({
      name: "design_content",
      description:
        "Cucumber layered canvas design operation. Insert content nodes into a section frame in the live canvas.",
      schema: designContentSchema,
      execute: async (args, context) => {
        const input = designContentSchema.parse(args);
        ensureLiveCanvasOnly(input.filePath, "design_content");
        const live = await readLiveContext(deps, context);
        const result = applyDesignContent(live.doc, input);
        await requireLiveCanvasService(deps).setDocument(
          live.user,
          live.canvasId,
          result.doc,
        );
        console.info("[structured-canvas] design content inserted", {
          canvasId: live.canvasId,
          insertedCount: result.insertedCount,
          pageId: input.pageId,
          sectionId: input.sectionId,
          userId: live.user.id,
        });
        return jsonResult({
          success: true,
          summary: `Inserted ${result.insertedCount} layered design node(s).`,
          sectionId: input.sectionId,
          insertedCount: result.insertedCount,
          totalNodeCount: result.totalNodeCount,
          warnings: result.warnings,
          snapshot: result.snapshot,
          postProcessed: result.postProcessed,
        });
      },
    }),
    createNativeMcpTool({
      name: "design_refine",
      description:
        "Cucumber layered canvas design operation. Validate and snapshot a layered design tree in the live canvas.",
      schema: designRefineSchema,
      execute: async (args, context) => {
        const input = designRefineSchema.parse(args);
        ensureLiveCanvasOnly(input.filePath, "design_refine");
        const live = await readLiveContext(deps, context);
        const result = applyDesignRefine(live.doc, input);
        await requireLiveCanvasService(deps).setDocument(
          live.user,
          live.canvasId,
          result.doc,
        );
        console.info("[structured-canvas] design refined", {
          canvasId: live.canvasId,
          fixCount: result.fixes.length,
          pageId: input.pageId,
          rootId: input.rootId,
          userId: live.user.id,
        });
        return jsonResult({
          success: true,
          summary: `Refined layered design ${input.rootId}.`,
          rootId: input.rootId,
          totalNodeCount: result.totalNodeCount,
          fixes: result.fixes,
          layoutSnapshot: result.layoutSnapshot,
        });
      },
    }),
    createNativeMcpTool({
      name: "import_figma_clipboard",
      description:
        "Import Figma clipboard HTML into the live Cucumber canvas using the native-first pen-figma-compatible parser path. Requires the HTML payload copied from Figma.",
      schema: importFigmaClipboardSchema,
      execute: async (args, context) => {
        const input = importFigmaClipboardSchema.parse(args);
        const live = await readLiveContext(deps, context);
        const parsed = parseClipboardImport({ html: input.html });
        if (!parsed || parsed.source !== "figma") {
          throw new Error(
            "No valid Figma clipboard payload was found. Copy from Figma again and pass the clipboard HTML.",
          );
        }
        const imported = insertCanvasImportResult(live.doc, parsed, {
          parentId: input.parentId ?? null,
          offsetX: input.offsetX,
          offsetY: input.offsetY,
        });
        await requireLiveCanvasService(deps).setDocument(
          live.user,
          live.canvasId,
          imported.doc,
        );
        console.info("[structured-canvas] figma clipboard imported", {
          assetCount: parsed.assets.length,
          canvasId: live.canvasId,
          insertedCount: imported.insertedIds.length,
          warningCount: parsed.warnings.length,
          userId: live.user.id,
        });
        return jsonResult({
          success: true,
          summary: `Imported ${imported.insertedIds.length} Figma root node(s).`,
          insertedIds: imported.insertedIds,
          assetCount: parsed.assets.length,
          warnings: parsed.warnings,
        });
      },
    }),
    createNativeMcpTool({
      name: "read_nodes",
      description:
        "Cucumber codegen node reader. Omit nodeIds for top-level page nodes. depth=0 returns node only, depth=1 direct children, depth=-1 full subtree.",
      schema: readNodesSchema,
      execute: async (args, context) => {
        const input = readNodesSchema.parse(args);
        const live = await readLiveContext(deps, context);
        const nodes = readNodes(live.doc, input);
        return jsonResult({
          summary: `Read ${nodes.length} node(s) for codegen.`,
          nodes,
          ...(input.includeVariables
            ? {
                variables: live.doc.variables ?? {},
                themes: live.doc.themes ?? {},
              }
            : {}),
        });
      },
    }),
    createNativeMcpTool({
      name: "search_all_unique_properties",
      description:
        "Cucumber style operation. Recursively collect unique style property values under parent nodes.",
      schema: searchUniquePropertiesSchema,
      execute: async (args, context) => {
        const input = searchUniquePropertiesSchema.parse(args);
        const live = await readLiveContext(deps, context);
        const values = searchUniqueProperties(live.doc, input);
        return jsonResult({
          summary: "Collected unique style property values.",
          properties: values,
        });
      },
    }),
    createNativeMcpTool({
      name: "replace_all_matching_properties",
      description:
        "Cucumber style operation. Recursively replace matching property values under parent nodes.",
      schema: replaceMatchingPropertiesSchema,
      execute: async (args, context) => {
        const input = replaceMatchingPropertiesSchema.parse(args);
        const live = await readLiveContext(deps, context);
        const result = replaceMatchingProperties(live.doc, input);
        await requireLiveCanvasService(deps).setDocument(
          live.user,
          live.canvasId,
          result.doc,
        );
        console.info("[structured-canvas] style properties replaced", {
          canvasId: live.canvasId,
          replacedCount: result.replacedCount,
          userId: live.user.id,
        });
        return jsonResult({
          success: true,
          summary: `Replaced ${result.replacedCount} style property value(s).`,
          replacedCount: result.replacedCount,
        });
      },
    }),
    createNativeMcpTool({
      name: "get_variables",
      description:
        "Cucumber variable operation. Read all design variables and theme axes from the live canvas document.",
      schema: z.object({}),
      execute: async (_args, context) => {
        const live = await readLiveContext(deps, context);
        return jsonResult({
          summary: `Read ${Object.keys(live.doc.variables ?? {}).length} variable(s).`,
          variables: live.doc.variables ?? {},
          themes: live.doc.themes ?? {},
        });
      },
    }),
    createNativeMcpTool({
      name: "set_variables",
      description:
        "Cucumber variable operation. Merge or replace design variables on the live canvas document.",
      schema: setVariablesSchema,
      execute: async (args, context) => {
        const input = setVariablesSchema.parse(args);
        const live = await readLiveContext(deps, context);
        const nextDoc: PenDocument = {
          ...live.doc,
          variables: (input.replace
            ? input.variables
            : {
                ...(live.doc.variables ?? {}),
                ...input.variables,
              }) as PenDocument["variables"],
        };
        await requireLiveCanvasService(deps).setDocument(
          live.user,
          live.canvasId,
          nextDoc,
        );
        return jsonResult({
          success: true,
          summary: `Saved ${Object.keys(input.variables).length} variable(s).`,
          variables: nextDoc.variables ?? {},
        });
      },
    }),
    createNativeMcpTool({
      name: "set_themes",
      description:
        "Cucumber variable operation. Merge or replace theme axes and variants on the live canvas document.",
      schema: setThemesSchema,
      execute: async (args, context) => {
        const input = setThemesSchema.parse(args);
        const live = await readLiveContext(deps, context);
        const nextDoc: PenDocument = {
          ...live.doc,
          themes: input.replace
            ? input.themes
            : { ...(live.doc.themes ?? {}), ...input.themes },
        };
        await requireLiveCanvasService(deps).setDocument(
          live.user,
          live.canvasId,
          nextDoc,
        );
        return jsonResult({
          success: true,
          summary: `Saved ${Object.keys(input.themes).length} theme axis/axes.`,
          themes: nextDoc.themes ?? {},
        });
      },
    }),
    createNativeMcpTool({
      name: "prompt_canvas_plan",
      description:
        "Phase C prompt-to-canvas planner. Decomposes a visual prompt into a bounded, deterministic container plan without writing the canvas.",
      schema: promptCanvasPlanSchema,
      execute: async (args) => {
        const input = promptCanvasPlanSchema.parse(args);
        const plan = createPromptCanvasPlan(input);
        console.info("[phase-c-orchestration] plan.created", {
          exportTargets: plan.exportTargets,
          planId: plan.planId,
          sectionCount: plan.sections.length,
          surface: plan.surface,
        });
        return jsonResult({
          success: true,
          summary: `Created prompt canvas plan ${plan.planId} with ${plan.sections.length} section(s).`,
          ...plan,
        });
      },
    }),
    createNativeMcpTool({
      name: "prompt_canvas_execute",
      description:
        "Phase C prompt-to-canvas executor. Materializes a stored plan into the open live canvas as root and section containers with bounded concurrency.",
      schema: promptCanvasExecuteSchema,
      execute: async (args, context) => {
        const input = promptCanvasExecuteSchema.parse(args);
        const live = await readLiveContext(deps, context);
        const result = await executePromptCanvasPlan(deps, live, input);
        return jsonResult(result);
      },
    }),
    createNativeMcpTool({
      name: "codegen_plan",
      description:
        "Cucumber codegen route. Validate and store a code generation plan, returning a topologically sorted executionPlan.",
      schema: codegenPlanSchema,
      execute: async (args) => {
        const input = codegenPlanSchema.parse(args);
        const planned = createCodegenPlan(input.plan, input.pageId);
        return jsonResult({
          success: true,
          summary: `Created codegen plan ${planned.planId} with ${planned.executionPlan.length} chunk(s).`,
          ...planned,
        });
      },
    }),
    createNativeMcpTool({
      name: "codegen_submit_chunk",
      description:
        "Cucumber codegen route. Submit generated code for one chunk and receive progress plus next ready chunk.",
      schema: codegenSubmitSchema,
      execute: async (args) => {
        const input = codegenSubmitSchema.parse(args);
        return jsonResult(submitCodegenChunk(input));
      },
    }),
    createNativeMcpTool({
      name: "codegen_assemble",
      description:
        "Cucumber codegen route. Return submitted chunk results in execution order and clear the plan.",
      schema: codegenAssembleSchema,
      execute: async (args) => {
        const input = codegenAssembleSchema.parse(args);
        return jsonResult(assembleCodegen(input.planId, input.framework));
      },
    }),
    createNativeMcpTool({
      name: "codegen_export",
      description:
        "Export the current live canvas selection directly to design-as-code files. Defaults to current selection, or pass nodeIds explicitly. Supports React, HTML, and Vue.",
      schema: codegenExportSchema,
      execute: async (args, context) => {
        const input = codegenExportSchema.parse(args);
        const live = await readLiveContext(deps, context);
        const result = exportSelectedNodes(live.doc, input);
        console.info("[structured-canvas] codegen_export completed", {
          canvasId: live.canvasId,
          fileCount: result.files.length,
          framework: input.framework,
          nodeCount: result.nodeIds.length,
          userId: live.user.id,
        });
        return jsonResult({
          success: true,
          summary: `Exported ${result.nodeIds.length} selected node(s) to ${input.framework}.`,
          ...result,
        });
      },
    }),
    createNativeMcpTool({
      name: "codegen_clean",
      description:
        "Cucumber codegen route. Clean up an abandoned codegen plan.",
      schema: codegenCleanSchema,
      execute: async (args) => {
        const input = codegenCleanSchema.parse(args);
        const deleted = codegenPlans.delete(input.planId);
        return jsonResult({
          success: true,
          summary: deleted
            ? `Deleted codegen plan ${input.planId}.`
            : `Codegen plan ${input.planId} was already absent.`,
          deleted,
        });
      },
    }),
  ];
}

function createNativeMcpTool<TSchema extends z.ZodTypeAny>(options: {
  name: string;
  description: string;
  schema: TSchema;
  execute: (
    args: unknown,
    context: McpToolContext,
  ) => Promise<McpToolCallResult>;
}): CucumberMcpTool<TSchema> {
  return {
    name: options.name,
    description: options.description,
    schema: options.schema,
    inputSchema: schemaToJsonSchema(options.schema),
    execute: options.execute,
  };
}

async function readLiveContext(
  deps: ToolDeps,
  context: McpToolContext,
): Promise<LiveContext> {
  const canvasId = context.configurable?.canvas_id;
  const accessToken = context.configurable?.access_token;
  const userId = context.configurable?.user_id;

  if (
    typeof canvasId !== "string" ||
    typeof accessToken !== "string" ||
    typeof userId !== "string" ||
    !canvasId ||
    !accessToken ||
    !userId
  ) {
    throw new Error(
      "Canvas context is missing. Open a canvas conversation before using Cucumber structured canvas tools.",
    );
  }

  if (!deps.liveCanvasService) {
    throw new Error(
      "Cucumber structured canvas tools require an open live editor. Open the canvas page and retry.",
    );
  }

  const user = {
    accessToken,
    email: "",
    id: userId,
    userMetadata: {},
  };
  const doc = await deps.liveCanvasService.getDocument(user, canvasId);
  if (!isCucumberCanvasDocument(doc)) {
    throw new Error(
      "Live editor returned an invalid Cucumber canvas document.",
    );
  }
  return { canvasId, doc, user };
}

function requireLiveCanvasService(deps: ToolDeps): LiveCanvasService {
  if (!deps.liveCanvasService) {
    throw new Error(
      "Cucumber structured canvas tools require an open live editor. Open the canvas page and retry.",
    );
  }
  return deps.liveCanvasService;
}

function jsonResult(payload: Record<string, unknown>): McpToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: payload.success === false,
  };
}

function ensureLiveCanvasOnly(filePath: string | undefined, toolName: string) {
  if (!filePath) return;
  throw new Error(
    `${toolName} in Cucumber MCP works against the open live editor; filePath is not supported.`,
  );
}

function createDefaultPageFrame(): PenNode {
  return {
    id: createNodeId("frame"),
    type: "frame",
    name: "Frame",
    x: 0,
    y: 0,
    width: 1200,
    height: 800,
    fill: [{ type: "solid", color: "#FFFFFF" }],
    children: [],
  } as PenNode;
}

function coerceInputNode(
  input: Record<string, unknown>,
  toolName: string,
  options: {
    usedIds?: Set<string>;
    warnings?: string[];
  } = {},
): PenNode {
  const type = input.type;
  if (typeof type !== "string" || !type.trim()) {
    throw new Error(`${toolName} node is missing a concrete type.`);
  }
  const suppliedId =
    typeof input.id === "string" && input.id.trim() ? input.id : undefined;
  const idConflict = suppliedId ? options.usedIds?.has(suppliedId) : false;
  const id = suppliedId && !idConflict ? suppliedId : createNodeId(type);
  if (suppliedId && idConflict) {
    options.warnings?.push(
      `Replaced conflicting node id "${suppliedId}" with "${id}".`,
    );
  }
  options.usedIds?.add(id);
  const next: Record<string, unknown> = { ...input, id, type };
  if ("children" in input) {
    if (!Array.isArray(input.children)) {
      throw new Error(
        `${toolName} node ${id} has invalid children; expected an array.`,
      );
    }
    next.children = input.children.map((child) => {
      if (!isRecord(child)) {
        throw new Error(
          `${toolName} node ${id} contains a non-object child node.`,
        );
      }
      return coerceInputNode(child, toolName, options);
    });
  }
  return next as unknown as PenNode;
}

function reorderCanvasPageToIndex(
  doc: PenDocument,
  pageId: string,
  index: number,
): { document: PenDocument; page: NonNullable<PenDocument["pages"]>[number] } {
  const normalized = normalizeCanvasPages(doc);
  const pages = [...(normalized.pages ?? [])];
  const fromIndex = pages.findIndex((page) => page.id === pageId);
  if (fromIndex === -1) {
    throw new Error(`Page ${pageId} does not exist.`);
  }
  const [page] = pages.splice(fromIndex, 1);
  if (!page) {
    throw new Error(`Page ${pageId} does not exist.`);
  }
  const toIndex = Math.min(index, pages.length);
  pages.splice(toIndex, 0, page);
  return {
    document: {
      ...normalized,
      activePageId: resolveActivePageId(normalized),
      children: [],
      pages,
    },
    page,
  };
}

function applyDesignSkeleton(
  sourceDoc: PenDocument,
  input: DesignSkeletonInput,
): {
  doc: PenDocument;
  nextSteps: string;
  rootId: string;
  sections: LayeredSectionResult[];
} {
  const doc = structuredClone(sourceDoc);
  const canvasWidth = input.canvasWidth ?? input.rootFrame.width;
  const rootId = createNodeId("skeleton");
  const sectionNodes: PenNode[] = [];
  const sections: LayeredSectionResult[] = [];

  for (const section of input.sections) {
    const sectionId = createNodeId("section");
    const sectionNode = {
      id: sectionId,
      type: "frame",
      name: section.name,
      width: "fill_container",
      height: section.height ?? "fit_content",
      layout: section.layout ?? "vertical",
      children: [],
      ...(section.alignItems ? { alignItems: section.alignItems } : {}),
      ...(section.fill ? { fill: section.fill } : {}),
      ...(section.gap !== undefined ? { gap: section.gap } : {}),
      ...(section.justifyContent
        ? { justifyContent: section.justifyContent }
        : {}),
      ...(section.padding !== undefined ? { padding: section.padding } : {}),
      ...(section.role ? { role: section.role } : {}),
    } as unknown as PenNode;
    sectionNodes.push(sectionNode);
    sections.push({
      id: sectionId,
      name: section.name,
      contentWidth: computeLayeredContentWidth(section.padding, canvasWidth),
      guidelines: createLayeredSectionGuidelines(section.name, section.role),
      suggestedRoles: suggestLayeredRoles(section.name, section.role),
    });
  }

  const rootNode = {
    id: rootId,
    type: "frame",
    name: input.rootFrame.name ?? "Page",
    x: 0,
    y: 0,
    width: input.rootFrame.width,
    height: input.rootFrame.height,
    layout: input.rootFrame.layout ?? "vertical",
    children: sectionNodes,
    ...(input.rootFrame.fill ? { fill: input.rootFrame.fill } : {}),
    ...(input.rootFrame.gap !== undefined ? { gap: input.rootFrame.gap } : {}),
    ...(input.rootFrame.padding !== undefined
      ? { padding: input.rootFrame.padding }
      : {}),
  } as unknown as PenNode;

  const children = getDocChildren(doc, input.pageId);
  const emptyFrameIndex = children.findIndex(isDefaultPagePlaceholderFrame);
  const nextChildren =
    emptyFrameIndex === -1
      ? [...children, rootNode]
      : children.map((child, index) =>
          index === emptyFrameIndex ? rootNode : child,
        );
  setDocChildren(doc, nextChildren, input.pageId);

  return {
    doc,
    rootId,
    sections,
    nextSteps: `Skeleton created with ${sections.length} sections. Call design_content for each section, then design_refine for validation.`,
  };
}

function applyDesignContent(
  sourceDoc: PenDocument,
  input: DesignContentInput,
): {
  doc: PenDocument;
  insertedCount: number;
  postProcessed: boolean;
  snapshot: Record<string, unknown>;
  totalNodeCount: number;
  warnings: string[];
} {
  const doc = structuredClone(sourceDoc);
  const children = getDocChildren(doc, input.pageId);
  const section = findNodeInTree(children, input.sectionId);
  if (!section) {
    throw new Error(`Section not found on requested page: ${input.sectionId}`);
  }
  if (section.type !== "frame") {
    throw new Error(`Section ${input.sectionId} must be a frame node.`);
  }
  const warnings: string[] = [];
  const usedIds = new Set(flattenNodes(children).map((node) => node.id));
  const inserted = input.children.map((child) =>
    coerceInputNode(child, "design_content", { usedIds, warnings }),
  );
  const sectionWithChildren = section as PenNode & { children?: PenNode[] };
  sectionWithChildren.children = [
    ...getNodeChildren(sectionWithChildren),
    ...inserted,
  ];
  setDocChildren(doc, children, input.pageId);
  return {
    doc,
    insertedCount: countNodes(inserted),
    totalNodeCount: countNodes(getNodeChildren(sectionWithChildren)),
    warnings,
    snapshot: readNodeWithDepth(sectionWithChildren, 2),
    postProcessed: input.postProcess,
  };
}

function applyDesignRefine(
  sourceDoc: PenDocument,
  input: DesignRefineInput,
): {
  doc: PenDocument;
  fixes: Array<{ fix: string; nodeId: string; nodeName?: string }>;
  layoutSnapshot: Record<string, unknown>[];
  totalNodeCount: number;
} {
  const doc = structuredClone(sourceDoc);
  const children = getDocChildren(doc, input.pageId);
  const root = findNodeInTree(children, input.rootId);
  if (!root) {
    throw new Error(`Root node not found on requested page: ${input.rootId}`);
  }
  setDocChildren(doc, children, input.pageId);
  return {
    doc,
    totalNodeCount: countNodes([root]),
    fixes: [],
    layoutSnapshot: [
      {
        id: root.id,
        name: root.name,
        type: root.type,
        childCount: getNodeChildren(root).length,
        ...getNodeBounds(root),
      },
      ...buildLayoutSnapshot(doc, {
        maxDepth: 3,
        pageId: input.pageId,
        parentId: input.rootId,
        problemsOnly: false,
      }),
    ],
  };
}

function computeLayeredContentWidth(
  padding: unknown,
  canvasWidth: number,
): number {
  const parsed = parseLayeredPadding(padding);
  return Math.max(0, canvasWidth - parsed.left - parsed.right);
}

function parseLayeredPadding(padding: unknown): {
  left: number;
  right: number;
} {
  if (typeof padding === "number") {
    return { left: padding, right: padding };
  }
  if (
    Array.isArray(padding) &&
    padding.every((value) => typeof value === "number")
  ) {
    const values = padding as number[];
    if (values.length === 2) {
      const horizontal = values[1] ?? 0;
      return { left: horizontal, right: horizontal };
    }
    if (values.length === 4) {
      return { left: values[3] ?? 0, right: values[1] ?? 0 };
    }
  }
  return { left: 0, right: 0 };
}

function createLayeredSectionGuidelines(name: string, role?: string): string {
  const normalized = `${name} ${role ?? ""}`.toLowerCase();
  if (normalized.includes("hero")) {
    return "Use one clear heading group, one supporting copy group, and one primary visual or action group.";
  }
  if (normalized.includes("nav")) {
    return "Use logo, navigation links, and primary action groups with stable horizontal spacing.";
  }
  if (normalized.includes("feature") || normalized.includes("proof")) {
    return "Use repeated content groups with consistent sizing and scan-friendly hierarchy.";
  }
  return "Insert bounded content groups that match the section role and preserve layout hierarchy.";
}

function suggestLayeredRoles(name: string, role?: string): string[] {
  const normalized = `${name} ${role ?? ""}`.toLowerCase();
  if (normalized.includes("hero")) return ["heading", "body", "button"];
  if (normalized.includes("nav")) return ["logo", "nav-link", "button"];
  if (normalized.includes("feature") || normalized.includes("proof")) {
    return ["card", "heading", "body"];
  }
  return ["frame", "heading", "body"];
}

function isDefaultPagePlaceholderFrame(node: PenNode): boolean {
  const fill = (node as unknown as { fill?: Array<{ color?: string }> }).fill;
  return (
    node.type === "frame" &&
    node.name === "Frame" &&
    node.x === 0 &&
    node.y === 0 &&
    node.width === 1200 &&
    node.height === 800 &&
    fill?.[0]?.color === "#FFFFFF" &&
    getNodeChildren(node).length === 0
  );
}

function applyBatchDesign(
  sourceDoc: PenDocument,
  input: BatchDesignInput,
): {
  doc: PenDocument;
  results: OpResult[];
} {
  const doc = structuredClone(sourceDoc);
  const bindings = new Map<string, string>();
  const results: OpResult[] = [];

  for (const line of splitOperations(input.operations)) {
    try {
      executeDesignLine(line, doc, bindings, results, input.pageId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const displayLine = line.length > 200 ? `${line.slice(0, 200)}...` : line;
      if (message.startsWith("Cannot parse operation")) {
        throw new Error(
          `Unsupported batch_design operation at line "${displayLine}": ${message}`,
        );
      }
      throw new Error(
        `batch_design failed at line "${displayLine}": ${message}`,
      );
    }
  }

  return { doc, results };
}

function applyBatchGet(
  doc: PenDocument,
  input: BatchGetInput,
): Record<string, unknown>[] {
  const readDepth = input.readDepth ?? 1;
  const searchDepth = input.searchDepth ?? 20;
  const pageChildren = getDocChildren(doc, input.pageId);

  if (!input.patterns?.length && !input.nodeIds?.length) {
    const rootNodes = input.parentId
      ? getNodeChildren(
          requireNodeOnPage(pageChildren, input.parentId, input.pageId, doc, {
            label: "Parent",
          }),
        )
      : pageChildren;
    return rootNodes.map((node) => readNodeWithDepth(node, readDepth));
  }

  const results: PenNode[] = [];
  const seen = new Set<string>();
  const searchRoot = input.parentId
    ? getNodeChildren(
        requireNodeOnPage(pageChildren, input.parentId, input.pageId, doc, {
          label: "Parent",
        }),
      )
    : pageChildren;

  for (const pattern of input.patterns ?? []) {
    for (const node of searchNodes(searchRoot, pattern, searchDepth)) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      results.push(node);
    }
  }

  for (const id of input.nodeIds ?? []) {
    if (seen.has(id)) continue;
    const node = requireNodeOnPage(pageChildren, id, input.pageId, doc, {
      label: "Node",
    });
    seen.add(id);
    results.push(node);
  }

  return results.map((node) => readNodeWithDepth(node, readDepth));
}

function readNodes(
  doc: PenDocument,
  input: z.infer<typeof readNodesSchema>,
): Record<string, unknown>[] {
  const depth = input.depth ?? -1;
  const pageChildren = getDocChildren(doc, input.pageId);
  const nodes =
    input.nodeIds && input.nodeIds.length > 0
      ? input.nodeIds
          .map((id) => findNodeInTree(pageChildren, id))
          .filter((node): node is PenNode => Boolean(node))
      : pageChildren;
  return nodes.map((node) =>
    depth === -1
      ? (structuredClone(node) as unknown as Record<string, unknown>)
      : readNodeWithDepth(node, depth),
  );
}

function collectDescendants(
  doc: PenDocument,
  parentIds: string[],
  pageId?: string,
): PenNode[] {
  const result: PenNode[] = [];
  const children = getDocChildren(doc, pageId);
  for (const parentId of parentIds) {
    const parent = findNodeInTree(children, parentId);
    if (!parent) continue;
    result.push(...flattenNodes([parent]));
  }
  return result;
}

function searchUniqueProperties(
  doc: PenDocument,
  input: z.infer<typeof searchUniquePropertiesSchema>,
): Record<string, unknown[]> {
  const nodes = collectDescendants(doc, input.parents, input.pageId);
  const result: Record<string, unknown[]> = {};
  for (const property of input.properties) {
    const seen = new Set<string>();
    const values: unknown[] = [];
    for (const node of nodes) {
      const value = getStylePropertyValue(node, property);
      if (value === undefined || value === null) continue;
      const key = serializeValue(value);
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(value);
    }
    result[property] = values;
  }
  return result;
}

function replaceMatchingProperties(
  doc: PenDocument,
  input: z.infer<typeof replaceMatchingPropertiesSchema>,
): { doc: PenDocument; replacedCount: number } {
  const nextDoc = structuredClone(doc);
  const nodes = collectDescendants(nextDoc, input.parents, input.pageId);
  let replacedCount = 0;
  for (const node of nodes) {
    for (const [property, rules] of Object.entries(input.properties)) {
      if (!propertyNameSchema.safeParse(property).success) continue;
      for (const rule of rules) {
        if (applyStyleReplacement(node, property as PropertyName, rule)) {
          replacedCount++;
        }
      }
    }
  }
  return { doc: nextDoc, replacedCount };
}

function getStylePropertyValue(node: PenNode, property: PropertyName): unknown {
  const record = node as unknown as Record<string, unknown>;
  switch (property) {
    case "fillColor":
      if (node.type === "text") return undefined;
      return extractFillColor(record.fill);
    case "textColor":
      if (node.type !== "text") return undefined;
      return extractFillColor(record.fill);
    case "strokeColor":
      return extractStrokeColor(record.stroke);
    case "strokeThickness":
      return isRecord(record.stroke) ? record.stroke.thickness : undefined;
    case "cornerRadius":
      return record.cornerRadius;
    case "padding":
      return record.padding;
    case "gap":
      return record.gap;
    case "fontSize":
      return record.fontSize;
    case "fontFamily":
      return record.fontFamily;
    case "fontWeight":
      return record.fontWeight;
  }
}

function applyStyleReplacement(
  node: PenNode,
  property: PropertyName,
  rule: ReplacementRule,
): boolean {
  const record = node as unknown as Record<string, unknown>;
  switch (property) {
    case "fillColor":
      return node.type !== "text" && replaceFillColor(record, "fill", rule);
    case "textColor":
      return node.type === "text" && replaceFillColor(record, "fill", rule);
    case "strokeColor":
      return replaceStrokeColor(record, rule);
    case "strokeThickness":
      return replaceDirectProperty(record, "stroke", "thickness", rule);
    case "cornerRadius":
    case "padding":
    case "gap":
    case "fontSize":
    case "fontFamily":
    case "fontWeight":
      return replaceTopLevelProperty(record, property, rule);
  }
}

function extractFillColor(fill: unknown): string | undefined {
  if (typeof fill === "string") return fill;
  if (!Array.isArray(fill)) return undefined;
  for (const entry of fill) {
    if (
      isRecord(entry) &&
      entry.type === "solid" &&
      typeof entry.color === "string"
    ) {
      return entry.color;
    }
  }
  return undefined;
}

function extractStrokeColor(stroke: unknown): string | undefined {
  if (!isRecord(stroke)) return undefined;
  return extractFillColor(stroke.fill);
}

function replaceFillColor(
  record: Record<string, unknown>,
  fieldName: string,
  rule: ReplacementRule,
): boolean {
  const fill = record[fieldName];
  if (typeof fill === "string") {
    if (valuesEqual(fill, rule.from)) {
      record[fieldName] = rule.to;
      return true;
    }
    return false;
  }
  if (!Array.isArray(fill)) return false;
  let replaced = false;
  for (const entry of fill) {
    if (
      isRecord(entry) &&
      entry.type === "solid" &&
      valuesEqual(entry.color, rule.from)
    ) {
      entry.color = rule.to;
      replaced = true;
    }
  }
  return replaced;
}

function replaceStrokeColor(
  record: Record<string, unknown>,
  rule: ReplacementRule,
): boolean {
  if (!isRecord(record.stroke)) return false;
  return replaceFillColor(record.stroke, "fill", rule);
}

function replaceDirectProperty(
  record: Record<string, unknown>,
  parentKey: string,
  childKey: string,
  rule: ReplacementRule,
): boolean {
  const parent = record[parentKey];
  if (!isRecord(parent)) return false;
  if (!valuesEqual(parent[childKey], rule.from)) return false;
  parent[childKey] = rule.to;
  return true;
}

function replaceTopLevelProperty(
  record: Record<string, unknown>,
  property: string,
  rule: ReplacementRule,
): boolean {
  if (!valuesEqual(record[property], rule.from)) return false;
  record[property] = rule.to;
  return true;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((value, index) => value === b[index])
    );
  }
  return false;
}

function serializeValue(value: unknown): string {
  return Array.isArray(value) ? JSON.stringify(value) : String(value);
}

function buildLayoutSnapshot(
  doc: PenDocument,
  input: SnapshotLayoutInput,
): Record<string, unknown>[] {
  const pageChildren = getDocChildren(doc, input.pageId);
  const roots = input.parentId
    ? getNodeChildren(
        requireNodeOnPage(pageChildren, input.parentId, input.pageId, doc, {
          label: "Parent",
        }),
      )
    : pageChildren;
  const nodes = flattenToDepth(roots, input.maxDepth ?? 2);
  const snapshot = nodes.map((node) => {
    const bounds = getNodeBounds(node);
    const children = getNodeChildren(node);
    const problems = detectLayoutProblems(node, bounds, children);
    return {
      id: node.id,
      type: node.type,
      name: node.name,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      childCount: children.length,
      ...(problems.length > 0 ? { problems } : {}),
    };
  });
  return input.problemsOnly
    ? snapshot.filter((node) => Array.isArray(node.problems))
    : snapshot;
}

function findEmptySpace(
  doc: PenDocument,
  input: FindEmptySpaceInput,
): CanvasBounds {
  const nodes = getDocChildren(doc, input.pageId);
  const anchorNode = input.nodeId
    ? findNodeInTree(nodes, input.nodeId)
    : undefined;
  if (input.nodeId && !anchorNode) {
    throw new Error(
      `Node ${input.nodeId} was not found on page ${resolveActivePageId(doc, input.pageId)}.`,
    );
  }
  const anchor = anchorNode
    ? getNodeBounds(anchorNode)
    : unionBounds(flattenNodes(nodes).map(getNodeBounds));

  const padding = input.padding ?? 80;
  switch (input.direction) {
    case "top":
      return {
        x: anchor.x,
        y: anchor.y - input.height - padding,
        width: input.width,
        height: input.height,
      };
    case "right":
      return {
        x: anchor.x + anchor.width + padding,
        y: anchor.y,
        width: input.width,
        height: input.height,
      };
    case "bottom":
      return {
        x: anchor.x,
        y: anchor.y + anchor.height + padding,
        width: input.width,
        height: input.height,
      };
    case "left":
      return {
        x: anchor.x - input.width - padding,
        y: anchor.y,
        width: input.width,
        height: input.height,
      };
  }
}

function requireNodeOnPage(
  pageChildren: PenNode[],
  nodeId: string,
  pageId: string | undefined,
  doc: PenDocument,
  options: { label: "Node" | "Parent" },
): PenNode {
  const node = findNodeInTree(pageChildren, nodeId);
  if (!node) {
    throw new Error(
      `${options.label} ${nodeId} was not found on page ${resolveActivePageId(doc, pageId)}.`,
    );
  }
  return node;
}

function ensureInsertParentExists(
  pageChildren: PenNode[],
  parentId: string | null,
  pageId: string | undefined,
  doc: PenDocument,
): void {
  if (parentId === null) return;
  requireNodeOnPage(pageChildren, parentId, pageId, doc, { label: "Parent" });
}

function createPromptCanvasPlan(
  input: z.infer<typeof promptCanvasPlanSchema>,
): PromptCanvasPlanRecord {
  const exportTargets = input.exportTargets.map((target) => {
    const parsed = phaseCExportTargetSchema.safeParse(target);
    if (!parsed.success) {
      throw new Error(`Unsupported Phase C export target: ${target}`);
    }
    return parsed.data;
  });
  const surface = inferPromptCanvasSurface(input.prompt, input.surface);
  const rootFrame = buildPromptCanvasRootFrame(input.prompt, surface);
  const sections = buildPromptCanvasSections(
    input.prompt,
    surface,
    input.maxSections,
    rootFrame,
  );
  const planId = `prompt_canvas_${randomUUID()}`;
  const plan: PromptCanvasPlanRecord = {
    createdAt: Date.now(),
    exportTargets,
    pageId: input.pageId,
    planId,
    prompt: input.prompt,
    rootFrame,
    sections,
    surface,
    warnings: [],
  };
  promptCanvasPlans.set(planId, plan);
  return plan;
}

function inferPromptCanvasSurface(
  prompt: string,
  requested: PromptCanvasSurface,
): PromptCanvasSurface {
  if (requested !== "auto") return requested;
  const normalized = prompt.toLowerCase();
  if (/dashboard|analytics|metrics|admin/.test(normalized)) return "dashboard";
  if (/mobile|app|onboarding|login|settings/.test(normalized)) return "mobile";
  if (/flow|workflow|journey|pipeline|data/.test(normalized)) return "flow";
  return "desktop";
}

function buildPromptCanvasRootFrame(
  prompt: string,
  surface: PromptCanvasSurface,
): PromptCanvasPlanRecord["rootFrame"] {
  const rootName = createPromptCanvasRootName(prompt, surface);
  if (surface === "mobile") {
    return {
      height: 812,
      layout: "vertical",
      name: rootName,
      width: 375,
      x: 0,
      y: 0,
    };
  }
  if (surface === "flow") {
    return {
      height: 720,
      layout: "horizontal",
      name: rootName,
      width: 1280,
      x: 0,
      y: 0,
    };
  }
  return {
    height: surface === "dashboard" ? 860 : 960,
    layout: "vertical",
    name: rootName,
    width: 1200,
    x: 0,
    y: 0,
  };
}

function createPromptCanvasRootName(
  prompt: string,
  surface: PromptCanvasSurface,
): string {
  const normalized = prompt.toLowerCase();
  if (normalized.includes("saas") && normalized.includes("dashboard")) {
    return "SaaS Dashboard Canvas";
  }
  if (surface === "dashboard") return "Dashboard Canvas";
  if (surface === "mobile") return "Mobile App Canvas";
  if (surface === "flow") return "Workflow Canvas";
  return `${titleCase(prompt.split(/\s+/).slice(0, 4).join(" "))} Canvas`;
}

function buildPromptCanvasSections(
  prompt: string,
  surface: PromptCanvasSurface,
  maxSections: number,
  rootFrame: PromptCanvasPlanRecord["rootFrame"],
): PromptCanvasSectionPlan[] {
  const roles = inferSectionRoles(prompt, surface).slice(0, maxSections);
  const innerX = surface === "mobile" ? 20 : 40;
  const innerWidth = Math.max(1, rootFrame.width - innerX * 2);
  const gap = surface === "mobile" ? 16 : 24;
  const defaultHeight =
    surface === "mobile"
      ? 220
      : Math.max(160, Math.floor(rootFrame.height / 4));

  let currentY = surface === "mobile" ? 24 : 40;
  return roles.map((role, index) => {
    const height = sectionHeightForRole(role, surface, defaultHeight);
    const sectionId = `section-${index + 1}-${slugifySectionId(role)}`;
    const section: PromptCanvasSectionPlan = {
      dependencies:
        index === 0
          ? []
          : [`section-${index}-${slugifySectionId(roles[index - 1] ?? role)}`],
      expectedNodeBudget: role === "metrics" ? 8 : 5,
      prompt: `${prompt}\n\nCreate the ${role} section as editable Cucumber canvas nodes.`,
      region: {
        height,
        width: innerWidth,
        x: innerX,
        y: currentY,
      },
      role,
      sectionId,
      title: titleCase(role),
    };
    currentY += height + gap;
    return section;
  });
}

function inferSectionRoles(
  prompt: string,
  surface: PromptCanvasSurface,
): string[] {
  const normalized = prompt.toLowerCase();
  if (surface === "dashboard") {
    const roles = ["navigation", "metrics"];
    if (/activity|detail|feed|table/.test(normalized)) roles.push("activity");
    else roles.push("details");
    return roles;
  }
  if (surface === "mobile") {
    const roles = ["hero"];
    if (/form|login|onboarding|input|settings/.test(normalized))
      roles.push("form");
    else roles.push("content");
    roles.push("actions");
    return roles;
  }
  if (surface === "flow") return ["input", "process", "output", "review"];
  return ["navigation", "hero", "content", "cta"];
}

function sectionHeightForRole(
  role: string,
  surface: PromptCanvasSurface,
  defaultHeight: number,
): number {
  if (surface === "mobile") {
    if (role === "hero") return 280;
    if (role === "form") return 300;
    return 140;
  }
  if (role === "navigation") return 96;
  if (role === "metrics") return 220;
  if (role === "activity" || role === "details") return 320;
  return defaultHeight;
}

async function executePromptCanvasPlan(
  deps: ToolDeps,
  live: LiveContext,
  input: z.infer<typeof promptCanvasExecuteSchema>,
): Promise<Record<string, unknown>> {
  const plan = promptCanvasPlans.get(input.planId);
  if (!plan) throw new Error(`Prompt canvas plan not found: ${input.planId}`);

  const liveCanvasService = requireLiveCanvasService(deps);
  const pageId = input.pageId ?? plan.pageId;
  let doc = structuredClone(live.doc);
  const placement = findEmptySpace(doc, {
    direction: "bottom",
    height: plan.rootFrame.height,
    padding: 96,
    width: plan.rootFrame.width,
    ...(pageId ? { pageId } : {}),
  });
  const root = createPromptRootNode(plan, placement);
  setDocChildren(
    doc,
    insertNodeInTree(getDocChildren(doc, pageId), null, root),
    pageId,
  );
  await liveCanvasService.setDocument(live.user, live.canvasId, doc);

  console.info("[phase-c-orchestration] execute.started", {
    canvasId: live.canvasId,
    commitMode: input.commitMode,
    concurrency: input.concurrency,
    pageId,
    planId: plan.planId,
    rootNodeId: root.id,
    userId: live.user.id,
  });

  const sectionResults: Array<{
    insertedNodeIds: string[];
    sectionId: string;
    status: PromptCanvasSectionStatus;
    warnings: string[];
  }> = [];

  const generatedSections = await generatePromptSectionsWithConcurrency(
    plan,
    root,
    input.concurrency,
  );

  for (const generated of generatedSections) {
    const section = generated.section;
    doc = await liveCanvasService.getDocument(live.user, live.canvasId);
    if (!findNode(doc, root.id)) {
      throw new Error(
        `Prompt canvas root container was removed before section ${section.sectionId} could be written.`,
      );
    }

    setDocChildren(
      doc,
      insertNodeInTree(getDocChildren(doc, pageId), root.id, generated.node),
      pageId,
    );
    await liveCanvasService.setDocument(live.user, live.canvasId, doc);
    sectionResults.push({
      insertedNodeIds: [generated.node.id],
      sectionId: section.sectionId,
      status: "completed",
      warnings: [],
    });
    console.info("[phase-c-orchestration] section.completed", {
      canvasId: live.canvasId,
      insertedNodeIds: [generated.node.id],
      pageId,
      planId: plan.planId,
      rootNodeId: root.id,
      sectionId: section.sectionId,
      userId: live.user.id,
    });
  }

  promptCanvasPlans.delete(input.planId);
  return {
    success: true,
    summary: `Executed prompt canvas plan ${input.planId} into ${sectionResults.length} section container(s).`,
    rootNodeId: root.id,
    insertedNodeIds: [
      root.id,
      ...sectionResults.flatMap((result) => result.insertedNodeIds),
    ],
    sectionResults,
    exportableNodeIds: [root.id],
  };
}

async function generatePromptSectionsWithConcurrency(
  plan: PromptCanvasPlanRecord,
  root: PenNode,
  concurrency: number,
): Promise<
  Array<{ index: number; node: PenNode; section: PromptCanvasSectionPlan }>
> {
  const results: Array<{
    index: number;
    node: PenNode;
    section: PromptCanvasSectionPlan;
  }> = [];
  const pending = plan.sections.map((section, index) => ({ index, section }));
  const completed = new Set<string>();
  const running = new Set<string>();

  while (pending.length > 0 || running.size > 0) {
    const ready = pending.filter((entry) =>
      entry.section.dependencies.every((dependency) =>
        completed.has(dependency),
      ),
    );
    if (ready.length === 0 && running.size === 0) {
      const blocked = pending
        .map((entry) => entry.section.sectionId)
        .join(", ");
      throw new Error(
        `Prompt canvas plan has unsatisfied section dependencies: ${blocked}`,
      );
    }

    const batch = ready.slice(0, Math.max(1, concurrency - running.size));
    for (const entry of batch) {
      pending.splice(pending.indexOf(entry), 1);
      running.add(entry.section.sectionId);
    }

    const generated = await Promise.all(
      batch.map(async (entry) => ({
        index: entry.index,
        node: createPromptSectionNode(plan, entry.section, root),
        section: entry.section,
      })),
    );

    for (const entry of generated) {
      running.delete(entry.section.sectionId);
      completed.add(entry.section.sectionId);
      results.push(entry);
    }
  }

  return results.sort((a, b) => a.index - b.index);
}

function createPromptRootNode(
  plan: PromptCanvasPlanRecord,
  placement: CanvasBounds,
): PenNode {
  return {
    id: `phase-c-${plan.planId}-root`,
    type: "frame",
    name: plan.rootFrame.name,
    x: placement.x,
    y: placement.y,
    width: plan.rootFrame.width,
    height: plan.rootFrame.height,
    layout: plan.rootFrame.layout,
    gap: 24,
    padding: [32, 32],
    fill: [{ type: "solid", color: "#f8fafc" }],
    stroke: {
      fill: [{ type: "solid", color: "#2563eb" }],
      thickness: 1,
    },
    cornerRadius: 16,
    children: [],
    containerRole: ["task", "visual"],
    explain: `Phase C prompt canvas root for: ${plan.prompt}`,
    agentBinding: {
      agentType: "composer",
      name: "Phase C Orchestrator",
      role: "designer",
      status: "completed",
      toolName: "prompt_canvas_execute",
    },
    createdByAgentId: "phase-c-orchestrator",
  };
}

function createPromptSectionNode(
  plan: PromptCanvasPlanRecord,
  section: PromptCanvasSectionPlan,
  root: PenNode,
): PenNode {
  const rootBounds = getNodeBounds(root);
  const x = rootBounds.x + section.region.x;
  const y = rootBounds.y + section.region.y;
  const titleId = `phase-c-${plan.planId}-${section.sectionId}-title`;
  return {
    id: `phase-c-${plan.planId}-${section.sectionId}`,
    type: "frame",
    name: section.title,
    x,
    y,
    width: section.region.width,
    height: section.region.height,
    layout: "vertical",
    gap: 12,
    padding: [20, 24],
    fill: [{ type: "solid", color: fillForSectionRole(section.role) }],
    stroke: {
      fill: [{ type: "solid", color: "#cbd5e1" }],
      thickness: 1,
    },
    cornerRadius: 12,
    containerRole: ["visual"],
    explain: `Phase C section ${section.sectionId}: ${section.prompt}`,
    agentBinding: {
      agentType: "designer",
      name: `Section Agent: ${section.title}`,
      role: "designer",
      status: "completed",
      toolName: "prompt_canvas_execute",
    },
    createdByAgentId: "phase-c-orchestrator",
    children: [
      {
        id: titleId,
        type: "text",
        name: `${section.title} Title`,
        content: section.title,
        x: x + 24,
        y: y + 20,
        width: Math.max(120, section.region.width - 48),
        height: 36,
        fontSize: 24,
        fontWeight: 700,
        fill: [{ type: "solid", color: "#0f172a" }],
      },
      {
        id: `${titleId}-summary`,
        type: "text",
        name: `${section.title} Summary`,
        content: section.prompt.split("\n")[0] ?? section.title,
        x: x + 24,
        y: y + 64,
        width: Math.max(120, section.region.width - 48),
        height: 48,
        fontSize: 15,
        fill: [{ type: "solid", color: "#475569" }],
      },
    ],
  };
}

function fillForSectionRole(role: string): string {
  switch (role) {
    case "navigation":
      return "#e0f2fe";
    case "metrics":
      return "#dcfce7";
    case "activity":
    case "details":
      return "#fef3c7";
    case "form":
      return "#ede9fe";
    case "hero":
      return "#ffe4e6";
    default:
      return "#ffffff";
  }
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function slugifySectionId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

function createCodegenPlan(
  plan: Record<string, unknown>,
  pageId?: string,
): {
  executionPlan: CodegenChunk[];
  planId: string;
  warnings: string[];
} {
  const chunks = readCodegenChunks(plan);
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (seen.has(chunk.chunkId)) {
      throw new Error(`Duplicate codegen chunkId: ${chunk.chunkId}`);
    }
    seen.add(chunk.chunkId);
    if (!chunk.nodeIds || chunk.nodeIds.length === 0) {
      throw new Error(`Codegen chunk ${chunk.chunkId} must include nodeIds.`);
    }
  }

  const nodeOwners = new Map<string, string>();
  for (const chunk of chunks) {
    for (const nodeId of chunk.nodeIds ?? []) {
      const owner = nodeOwners.get(nodeId);
      if (owner) {
        warnings.push(
          `Node ${nodeId} is shared by chunks ${owner} and ${chunk.chunkId}.`,
        );
      } else {
        nodeOwners.set(nodeId, chunk.chunkId);
      }
    }
  }

  const sorted = sortCodegenChunks(chunks);
  const planId = `codegen_${randomUUID()}`;
  codegenPlans.set(planId, {
    executionPlan: sorted,
    pageId,
    plan,
    results: new Map(),
    submittedAt: Date.now(),
  });
  return { executionPlan: sorted, planId, warnings };
}

function readCodegenChunks(plan: Record<string, unknown>): CodegenChunk[] {
  const chunks = plan.chunks;
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error(
      "codegen_plan requires plan.chunks with at least one chunk.",
    );
  }
  return chunks.map((chunk, index) => {
    if (!isRecord(chunk)) {
      throw new Error(`Codegen chunk at index ${index} must be an object.`);
    }
    const chunkId = chunk.chunkId;
    if (typeof chunkId !== "string" || chunkId.length === 0) {
      throw new Error(`Codegen chunk at index ${index} is missing chunkId.`);
    }
    const nodeIds = Array.isArray(chunk.nodeIds)
      ? chunk.nodeIds.filter(
          (nodeId): nodeId is string => typeof nodeId === "string",
        )
      : [];
    const dependsOn = Array.isArray(chunk.dependsOn)
      ? chunk.dependsOn.filter((dep): dep is string => typeof dep === "string")
      : [];
    return { chunkId, nodeIds, dependsOn };
  });
}

function sortCodegenChunks(chunks: CodegenChunk[]): CodegenChunk[] {
  const byId = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  for (const chunk of chunks) {
    for (const dependency of chunk.dependsOn ?? []) {
      if (!byId.has(dependency)) {
        throw new Error(
          `Codegen chunk ${chunk.chunkId} depends on unknown chunk ${dependency}.`,
        );
      }
    }
  }

  const sorted: CodegenChunk[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(chunk: CodegenChunk): void {
    if (visited.has(chunk.chunkId)) return;
    if (visiting.has(chunk.chunkId)) {
      throw new Error(`Circular codegen dependency at chunk ${chunk.chunkId}.`);
    }
    visiting.add(chunk.chunkId);
    for (const dependency of chunk.dependsOn ?? []) {
      const dependencyChunk = byId.get(dependency);
      if (dependencyChunk) visit(dependencyChunk);
    }
    visiting.delete(chunk.chunkId);
    visited.add(chunk.chunkId);
    sorted.push(chunk);
  }

  for (const chunk of chunks) visit(chunk);
  return sorted;
}

function submitCodegenChunk(
  input: z.infer<typeof codegenSubmitSchema>,
): Record<string, unknown> {
  const plan = codegenPlans.get(input.planId);
  if (!plan) {
    throw new Error(`Codegen plan not found: ${input.planId}`);
  }
  const chunkId = input.result.chunkId;
  if (typeof chunkId !== "string" || chunkId.length === 0) {
    throw new Error("codegen_submit_chunk result must include chunkId.");
  }
  if (!plan.executionPlan.some((chunk) => chunk.chunkId === chunkId)) {
    throw new Error(`Chunk ${chunkId} is not part of plan ${input.planId}.`);
  }
  plan.results.set(chunkId, {
    ...input.result,
    status: input.status ?? input.result.status ?? "done",
    submittedAt: Date.now(),
  });

  const done = plan.executionPlan.filter((chunk) =>
    plan.results.has(chunk.chunkId),
  );
  const nextChunk = plan.executionPlan.find((chunk) => {
    if (plan.results.has(chunk.chunkId)) return false;
    return (chunk.dependsOn ?? []).every((dep) => plan.results.has(dep));
  });

  return {
    success: true,
    summary: `Submitted chunk ${chunkId}.`,
    progress: {
      done: done.length,
      total: plan.executionPlan.length,
      chunks: plan.executionPlan.map((chunk) => ({
        chunkId: chunk.chunkId,
        status: plan.results.get(chunk.chunkId)?.status ?? "pending",
      })),
    },
    nextChunk: nextChunk ?? null,
  };
}

function assembleCodegen(
  planId: string,
  framework: string,
): Record<string, unknown> {
  const plan = codegenPlans.get(planId);
  if (!plan) {
    throw new Error(`Codegen plan not found: ${planId}`);
  }
  const chunks = plan.executionPlan.map((chunk) => ({
    ...chunk,
    result: plan.results.get(chunk.chunkId) ?? null,
  }));
  const degraded = chunks.some((chunk) => !chunk.result);
  const files = buildCodegenFiles(framework, chunks);
  codegenPlans.delete(planId);
  return {
    success: true,
    summary: degraded
      ? `Assembled degraded ${framework} codegen plan ${planId}.`
      : `Assembled ${framework} codegen plan ${planId}.`,
    degraded,
    framework,
    chunks,
    files,
    plan: plan.plan,
  };
}

function exportSelectedNodes(
  doc: PenDocument,
  input: CodegenExportInput,
): {
  files: Array<{ path: string; content: string }>;
  framework: string;
  nodeIds: string[];
  warnings: Array<{ code: string; message: string; nodeId: string }>;
} {
  const runtimeDoc = doc as RuntimeDocument;
  const selectedIds = input.nodeIds?.length
    ? input.nodeIds
    : (runtimeDoc.selection ?? []);
  if (selectedIds.length === 0) {
    throw new Error(
      "codegen_export requires a current canvas selection or explicit nodeIds.",
    );
  }

  const nodes = selectedIds
    .map((id) => findNode(doc, id))
    .filter((node): node is PenNode => Boolean(node));
  if (nodes.length === 0) {
    throw new Error("codegen_export could not find any selected nodes.");
  }

  const componentName = toPascalCase(input.componentName);
  const files =
    input.framework === "react"
      ? exportNodesToReactFiles(nodes, componentName)
      : input.framework === "vue"
        ? exportNodesToVueFiles(nodes, componentName)
        : exportNodesToHtmlFiles(nodes, componentName);
  return {
    files,
    framework: input.framework,
    nodeIds: nodes.map((node) => node.id),
    warnings: collectCodegenExportWarnings(nodes),
  };
}

function collectCodegenExportWarnings(
  nodes: PenNode[],
): Array<{ code: string; message: string; nodeId: string }> {
  return flattenNodes(nodes).flatMap((node) => {
    const warnings: Array<{ code: string; message: string; nodeId: string }> =
      [];
    const record = node as unknown as Record<string, unknown>;
    if (!CODEGEN_RENDERED_NODE_TYPES.has(node.type)) {
      warnings.push({
        code: "unsupported-node-type",
        nodeId: node.id,
        message: `Node "${node.id}" uses unsupported type "${node.type}" and will be exported as a generic element.`,
      });
    }
    if (
      node.type === "image" &&
      (typeof record.src !== "string" || record.src.trim().length === 0)
    ) {
      warnings.push({
        code: "missing-image-source",
        nodeId: node.id,
        message: `Image node "${node.id}" is missing a usable source and may not appear in codegen export.`,
      });
    }
    if (Array.isArray(record.fill)) {
      const fills = record.fill.filter(isRecord);
      if (fills.some((fill) => fill.type === "image")) {
        warnings.push({
          code: "unsupported-image-fill",
          nodeId: node.id,
          message: `Node "${node.id}" uses an image fill that is not preserved by design-as-code export and will use a CSS fallback.`,
        });
      }
      if (
        fills.some(
          (fill) =>
            fill.type === "linear_gradient" || fill.type === "radial_gradient",
        )
      ) {
        warnings.push({
          code: "unsupported-gradient-fill",
          nodeId: node.id,
          message: `Node "${node.id}" uses a gradient fill that is not preserved by design-as-code export and will use a CSS fallback.`,
        });
      }
    }
    if (node.type === "text" && Array.isArray(record.content)) {
      warnings.push({
        code: "unsupported-rich-text",
        nodeId: node.id,
        message: `Text node "${node.id}" uses rich text segments that are flattened in design-as-code export.`,
      });
    }
    return warnings;
  });
}

function exportNodesToReactFiles(
  nodes: PenNode[],
  componentName: string,
): Array<{ path: string; content: string }> {
  const bounds = unionBounds(nodes.map(getNodeBounds));
  const markup = nodes.map((node) => renderReactNode(node, bounds)).join("\n");
  return [
    {
      path: `${componentName}.tsx`,
      content: `import "./${componentName}.css";\n\nexport function ${componentName}() {\n  return (\n    <div className="${componentName}Root">\n${indent(markup, 6)}\n    </div>\n  );\n}\n\nexport default ${componentName};\n`,
    },
    {
      path: `${componentName}.css`,
      content: buildExportCss(componentName, bounds),
    },
  ];
}

function exportNodesToHtmlFiles(
  nodes: PenNode[],
  componentName: string,
): Array<{ path: string; content: string }> {
  const bounds = unionBounds(nodes.map(getNodeBounds));
  const markup = nodes.map((node) => renderHtmlNode(node, bounds)).join("\n");
  return [
    {
      path: "index.html",
      content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>${escapeHtml(componentName)}</title>\n    <link rel="stylesheet" href="./styles.css" />\n  </head>\n  <body>\n    <main class="${componentName}Root">\n${indent(markup, 6)}\n    </main>\n  </body>\n</html>\n`,
    },
    {
      path: "styles.css",
      content: buildExportCss(componentName, bounds),
    },
  ];
}

function exportNodesToVueFiles(
  nodes: PenNode[],
  componentName: string,
): Array<{ path: string; content: string }> {
  const bounds = unionBounds(nodes.map(getNodeBounds));
  const markup = nodes.map((node) => renderHtmlNode(node, bounds)).join("\n");
  return [
    {
      path: `${componentName}.vue`,
      content: `<template>\n  <main class="${componentName}Root">\n${indent(markup, 4)}\n  </main>\n</template>\n\n<script setup lang="ts">\n</script>\n\n<style scoped src="./${componentName}.css"></style>\n`,
    },
    {
      path: `${componentName}.css`,
      content: buildExportCss(componentName, bounds),
    },
  ];
}

function renderReactNode(node: PenNode, rootBounds: CanvasBounds): string {
  const children = getNodeChildren(node)
    .map((child) => renderReactNode(child, rootBounds))
    .join("\n");
  const style = nodeToInlineStyle(node, rootBounds);
  const className = `node node-${node.type}`;
  if (node.type === "text") {
    return `<div className="${className}" style={${style}}>${escapeJsxText(String(node.content ?? ""))}</div>`;
  }
  if (node.type === "image") {
    const src = escapeAttr(
      String((node as unknown as Record<string, unknown>).src ?? ""),
    );
    return `<img className="${className}" style={${style}} src="${src}" alt="${escapeAttr(node.name ?? "")}" />`;
  }
  if (node.type === "videoEmbed") {
    const src = escapeAttr(
      String((node as unknown as Record<string, unknown>).src ?? ""),
    );
    return `<video className="${className}" style={${style}} src="${src}" controls />`;
  }
  return `<div className="${className}" style={${style}}>${children ? `\n${indent(children, 2)}\n` : ""}</div>`;
}

function renderHtmlNode(node: PenNode, rootBounds: CanvasBounds): string {
  const children = getNodeChildren(node)
    .map((child) => renderHtmlNode(child, rootBounds))
    .join("\n");
  const style = styleObjectToCss(nodeToStyleObject(node, rootBounds));
  const className = `node node-${node.type}`;
  if (node.type === "text") {
    return `<div class="${className}" style="${escapeAttr(style)}">${escapeHtml(String(node.content ?? ""))}</div>`;
  }
  if (node.type === "image") {
    const src = escapeAttr(
      String((node as unknown as Record<string, unknown>).src ?? ""),
    );
    return `<img class="${className}" style="${escapeAttr(style)}" src="${src}" alt="${escapeAttr(node.name ?? "")}" />`;
  }
  if (node.type === "videoEmbed") {
    const src = escapeAttr(
      String((node as unknown as Record<string, unknown>).src ?? ""),
    );
    return `<video class="${className}" style="${escapeAttr(style)}" src="${src}" controls></video>`;
  }
  return `<div class="${className}" style="${escapeAttr(style)}">${children ? `\n${indent(children, 2)}\n` : ""}</div>`;
}

function nodeToInlineStyle(node: PenNode, rootBounds: CanvasBounds): string {
  return `{ ${Object.entries(nodeToStyleObject(node, rootBounds))
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ")} }`;
}

function nodeToStyleObject(
  node: PenNode,
  rootBounds: CanvasBounds,
): Record<string, string | number> {
  const bounds = getNodeBounds(node);
  const record = node as unknown as Record<string, unknown>;
  const style: Record<string, string | number> = {
    position: "absolute",
    left: `${bounds.x - rootBounds.x}px`,
    top: `${bounds.y - rootBounds.y}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    boxSizing: "border-box",
    opacity: typeof node.opacity === "number" ? node.opacity : 1,
  };
  const fill = extractFillColor(record.fill);
  if (fill) {
    if (node.type === "text") style.color = cssVarReference(fill);
    else style.background = cssVarReference(fill);
  }
  const stroke = record.stroke;
  if (isRecord(stroke)) {
    const strokeColor = extractFillColor(stroke.fill);
    const thickness =
      typeof stroke.thickness === "number" ? stroke.thickness : 1;
    if (strokeColor && thickness > 0) {
      style.border = `${thickness}px solid ${cssVarReference(strokeColor)}`;
    }
  }
  if (typeof record.cornerRadius === "number") {
    style.borderRadius = `${record.cornerRadius}px`;
  }
  if (node.type === "text") {
    if (typeof record.fontSize === "number")
      style.fontSize = `${record.fontSize}px`;
    if (typeof record.fontFamily === "string")
      style.fontFamily = record.fontFamily;
    if (
      typeof record.fontWeight === "number" ||
      typeof record.fontWeight === "string"
    ) {
      style.fontWeight = record.fontWeight;
    }
    if (typeof record.lineHeight === "number")
      style.lineHeight = `${record.lineHeight}px`;
    if (typeof record.letterSpacing === "number") {
      style.letterSpacing = `${record.letterSpacing}px`;
    }
    if (typeof record.textAlign === "string")
      style.textAlign = record.textAlign;
    style.whiteSpace = "pre-wrap";
  }
  if (node.rotation) {
    style.transform = `rotate(${node.rotation}deg)`;
    style.transformOrigin = "center";
  }
  return style;
}

function cssVarReference(value: string): string {
  return value.startsWith("$") ? `var(--${value.slice(1)})` : value;
}

function styleObjectToCss(style: Record<string, string | number>): string {
  return Object.entries(style)
    .map(([key, value]) => `${kebabCase(key)}: ${value}`)
    .join("; ");
}

function buildExportCss(componentName: string, bounds: CanvasBounds): string {
  return `.${componentName}Root {\n  position: relative;\n  width: ${Math.max(1, Math.ceil(bounds.width))}px;\n  height: ${Math.max(1, Math.ceil(bounds.height))}px;\n  overflow: hidden;\n  background: #ffffff;\n  color: #111827;\n  font-family: Inter, ui-sans-serif, system-ui, sans-serif;\n}\n\n.${componentName}Root .node {\n  margin: 0;\n}\n`;
}

function kebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function escapeJsxText(value: string): string {
  return value
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildCodegenFiles(
  framework: string,
  chunks: Array<CodegenChunk & { result: Record<string, unknown> | null }>,
): Array<{ path: string; content: string }> {
  switch (framework) {
    case "react":
      return buildReactCodegenFiles(chunks);
    case "html":
      return buildHtmlCodegenFiles(chunks);
    default:
      return buildGenericCodegenFiles(framework, chunks);
  }
}

function buildReactCodegenFiles(
  chunks: Array<CodegenChunk & { result: Record<string, unknown> | null }>,
): Array<{ path: string; content: string }> {
  const componentFiles = chunks.map((chunk) => {
    const componentName = getChunkComponentName(chunk);
    const rawCode = getChunkCode(chunk);
    return {
      path: `components/${componentName}.tsx`,
      content:
        rawCode && rawCode.trim().length > 0
          ? rawCode
          : `export function ${componentName}() {\n  return <div data-missing-chunk="${chunk.chunkId}" />;\n}\n`,
    };
  });

  const imports = chunks
    .map((chunk) => {
      const componentName = getChunkComponentName(chunk);
      return `import { ${componentName} } from "./components/${componentName}";`;
    })
    .join("\n");
  const body = chunks
    .map((chunk) => `      <${getChunkComponentName(chunk)} />`)
    .join("\n");

  return [
    {
      path: "App.tsx",
      content: `${imports}\nimport "./styles.css";\n\nexport default function App() {\n  return (\n    <main className="cucumber-design-root">\n${body}\n    </main>\n  );\n}\n`,
    },
    ...componentFiles,
    {
      path: "styles.css",
      content:
        ".cucumber-design-root {\n  min-height: 100vh;\n  display: grid;\n  gap: 24px;\n  padding: 32px;\n  background: #ffffff;\n  color: #111827;\n  font-family: Inter, ui-sans-serif, system-ui, sans-serif;\n}\n",
    },
  ];
}

function buildHtmlCodegenFiles(
  chunks: Array<CodegenChunk & { result: Record<string, unknown> | null }>,
): Array<{ path: string; content: string }> {
  const sections = chunks
    .map((chunk) => {
      const code = getChunkCode(chunk);
      return (
        code?.trim() ||
        `<section data-missing-chunk="${chunk.chunkId}"></section>`
      );
    })
    .join("\n");

  return [
    {
      path: "index.html",
      content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>Cucumber Design Export</title>\n    <link rel="stylesheet" href="./styles.css" />\n  </head>\n  <body>\n${indent(sections, 4)}\n  </body>\n</html>\n`,
    },
    {
      path: "styles.css",
      content:
        "body {\n  margin: 0;\n  min-height: 100vh;\n  background: #ffffff;\n  color: #111827;\n  font-family: Inter, ui-sans-serif, system-ui, sans-serif;\n}\n",
    },
  ];
}

function buildGenericCodegenFiles(
  framework: string,
  chunks: Array<CodegenChunk & { result: Record<string, unknown> | null }>,
): Array<{ path: string; content: string }> {
  return chunks.map((chunk) => ({
    path: `${framework}/${safeFileName(getChunkComponentName(chunk))}.txt`,
    content:
      getChunkCode(chunk) ?? `Missing generated code for ${chunk.chunkId}.`,
  }));
}

function getChunkCode(
  chunk: CodegenChunk & { result: Record<string, unknown> | null },
): string | null {
  return typeof chunk.result?.code === "string" ? chunk.result.code : null;
}

function getChunkComponentName(
  chunk: CodegenChunk & { result: Record<string, unknown> | null },
): string {
  const contract = chunk.result?.contract;
  const name =
    isRecord(contract) && typeof contract.componentName === "string"
      ? contract.componentName
      : toPascalCase(chunk.chunkId);
  return /^[A-Z][A-Za-z0-9]*$/.test(name) ? name : toPascalCase(name);
}

function toPascalCase(value: string): string {
  const name = value
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return name || "GeneratedComponent";
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-") || "generated";
}

function indent(value: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line ? `${pad}${line}` : line))
    .join("\n");
}

function executeDesignLine(
  line: string,
  doc: PenDocument,
  bindings: Map<string, string>,
  results: OpResult[],
  pageId?: string,
): void {
  const assignMatch = line.match(/^(\w+)\s*=\s*([ICR])\((.+)\)$/s);
  const bindlessAssignMatch = !assignMatch && line.match(/^([ICR])\((.+)\)$/s);
  const callMatch = line.match(/^([UM])\((.+)\)$/s);
  const deleteMatch = line.match(/^D\((.+)\)$/s);

  const effectiveAssign =
    assignMatch ??
    (bindlessAssignMatch
      ? ([
          line,
          `_auto_${results.length}_${bindlessAssignMatch[1]}`,
          bindlessAssignMatch[1],
          bindlessAssignMatch[2],
        ] as RegExpMatchArray)
      : null);

  if (effectiveAssign) {
    const [, binding, op, argsStr] = effectiveAssign;
    if (!binding || !op || !argsStr) {
      throw new Error(`Cannot parse operation: ${line}`);
    }
    switch (op) {
      case "I": {
        const { data, parent } = parseInsertArgs(argsStr, bindings);
        const node = materializeNode(data);
        const currentChildren = getDocChildren(doc, pageId);
        ensureInsertParentExists(currentChildren, parent, pageId, doc);
        setDocChildren(
          doc,
          insertNodeInTree(currentChildren, parent, node),
          pageId,
        );
        bindings.set(binding, node.id);
        results.push({ binding, nodeId: node.id });
        break;
      }
      case "C": {
        const { data, parent, sourceId } = parseCopyArgs(argsStr, bindings);
        const currentChildren = getDocChildren(doc, pageId);
        ensureInsertParentExists(currentChildren, parent, pageId, doc);
        const source = findNodeInTree(currentChildren, sourceId);
        if (!source) throw new Error(`Copy source not found: ${sourceId}`);
        const cloned = cloneNodeWithNewIds(source);
        Object.assign(cloned, stripReservedNodeFields(data));
        if (isRecord(data.descendants)) {
          applyDescendantOverrides(
            cloned,
            data.descendants as Record<string, unknown>,
          );
        }
        setDocChildren(
          doc,
          insertNodeInTree(currentChildren, parent, cloned),
          pageId,
        );
        bindings.set(binding, cloned.id);
        results.push({ binding, nodeId: cloned.id });
        break;
      }
      case "R": {
        const { data, path } = parsePathDataArgs(argsStr, bindings, "Replace");
        const target = findNodeByPath(doc, path, pageId);
        if (!target) throw new Error(`Replace target not found: ${path}`);
        const replacement = materializeNode(data);
        const parent = findParentInTree(getDocChildren(doc, pageId), target.id);
        const parentId = parent?.id ?? null;
        const siblings = parent
          ? getNodeChildren(parent)
          : getDocChildren(doc, pageId);
        const index = siblings.findIndex((node) => node.id === target.id);
        let children = removeNodeFromTree(
          getDocChildren(doc, pageId),
          target.id,
        );
        children = insertNodeInTree(children, parentId, replacement, index);
        setDocChildren(doc, children, pageId);
        bindings.set(binding, replacement.id);
        results.push({ binding, nodeId: replacement.id });
        break;
      }
      default:
        throw new Error(`Unsupported assign operation: ${op}`);
    }
    return;
  }

  if (callMatch) {
    const [, op, argsStr] = callMatch;
    if (!op || !argsStr) throw new Error(`Cannot parse operation: ${line}`);
    switch (op) {
      case "U": {
        const { data, path } = parsePathDataArgs(argsStr, bindings, "Update");
        const target = findNodeByPath(doc, path, pageId);
        if (!target) throw new Error(`Update target not found: ${path}`);
        setDocChildren(
          doc,
          updateNodeInTree(
            getDocChildren(doc, pageId),
            target.id,
            stripReservedNodeFields(data),
          ),
          pageId,
        );
        break;
      }
      case "M": {
        const { index, nodeId, parent } = parseMoveArgs(argsStr, bindings);
        const currentChildren = getDocChildren(doc, pageId);
        ensureInsertParentExists(currentChildren, parent, pageId, doc);
        const node = findNodeInTree(currentChildren, nodeId);
        if (!node) throw new Error(`Move target not found: ${nodeId}`);
        if (parent === nodeId) {
          throw new Error(`Move target ${nodeId} cannot be moved into itself.`);
        }
        if (parent && findNodeInTree(getNodeChildren(node), parent)) {
          throw new Error(
            `Move target ${nodeId} cannot be moved into its own descendant ${parent}.`,
          );
        }
        let children = removeNodeFromTree(currentChildren, nodeId);
        children = insertNodeInTree(children, parent, node, index);
        setDocChildren(doc, children, pageId);
        break;
      }
      default:
        throw new Error(`Unsupported call operation: ${op}`);
    }
    return;
  }

  if (deleteMatch?.[1]) {
    const nodeId = resolveRef(deleteMatch[1].trim(), bindings);
    const currentChildren = getDocChildren(doc, pageId);
    if (!findNodeInTree(currentChildren, nodeId)) {
      throw new Error(`Delete target not found: ${nodeId}`);
    }
    setDocChildren(doc, removeNodeFromTree(currentChildren, nodeId), pageId);
    return;
  }

  throw new Error(`Cannot parse operation: ${line}`);
}

function splitOperations(raw: string): string[] {
  const result: string[] = [];
  let buffer = "";
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (const ch of raw) {
    buffer += ch;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (inString) {
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "\n" && depth === 0) {
      const trimmed = buffer.trim();
      if (trimmed && !trimmed.startsWith("//")) result.push(trimmed);
      buffer = "";
    }
  }

  const tail = buffer.trim();
  if (tail && !tail.startsWith("//")) result.push(tail);
  return result;
}

function parseInsertArgs(
  argsStr: string,
  bindings: Map<string, string>,
): { data: Record<string, unknown>; parent: string | null } {
  const firstComma = findTopLevelComma(argsStr);
  if (firstComma === -1)
    throw new Error("Insert requires parent and node data.");
  const parentRaw = argsStr.slice(0, firstComma).trim();
  const dataStr = argsStr.slice(firstComma + 1).trim();
  return {
    parent: parentRaw === "null" ? null : resolveRef(parentRaw, bindings),
    data: parseJsonArg(dataStr),
  };
}

function parseCopyArgs(
  argsStr: string,
  bindings: Map<string, string>,
): {
  data: Record<string, unknown>;
  parent: string | null;
  sourceId: string;
} {
  const firstComma = findTopLevelComma(argsStr);
  if (firstComma === -1) throw new Error("Copy requires source id and parent.");
  const sourceRaw = argsStr.slice(0, firstComma).trim();
  const rest = argsStr.slice(firstComma + 1).trim();
  const secondComma = findTopLevelComma(rest);
  const parentRaw =
    secondComma === -1 ? rest : rest.slice(0, secondComma).trim();
  const dataStr =
    secondComma === -1 ? "{}" : rest.slice(secondComma + 1).trim();
  return {
    sourceId: resolveRef(sourceRaw, bindings),
    parent:
      parentRaw === "null" || parentRaw === "undefined"
        ? null
        : resolveRef(parentRaw, bindings),
    data: parseJsonArg(dataStr),
  };
}

function parsePathDataArgs(
  argsStr: string,
  bindings: Map<string, string>,
  label: string,
): { data: Record<string, unknown>; path: string } {
  const firstComma = findTopLevelComma(argsStr);
  if (firstComma === -1) {
    throw new Error(`${label} requires path and node data.`);
  }
  return {
    path: resolvePathExpr(argsStr.slice(0, firstComma).trim(), bindings),
    data: parseJsonArg(argsStr.slice(firstComma + 1).trim()),
  };
}

function parseMoveArgs(
  argsStr: string,
  bindings: Map<string, string>,
): { index?: number; nodeId: string; parent: string | null } {
  const parts = splitTopLevel(argsStr);
  if (parts.length < 2) throw new Error("Move requires node id and parent.");
  const nodeRef = parts[0]?.trim();
  const parentRef = parts[1]?.trim();
  if (!nodeRef || !parentRef)
    throw new Error("Move requires node id and parent.");
  const maybeIndex = parts[2]?.trim();
  return {
    nodeId: resolveRef(nodeRef, bindings),
    parent:
      parentRef === "null" || parentRef === "undefined"
        ? null
        : resolveRef(parentRef, bindings),
    ...(maybeIndex ? { index: Number.parseInt(maybeIndex, 10) } : {}),
  };
}

function parseJsonArg(str: string): Record<string, unknown> {
  const trimmed = str.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const normalized = replaceSingleQuoteDelimiters(
      trimmed
        .replace(/(?<=\{|,)\s*(\w+)\s*:/g, ' "$1":')
        .replace(/,\s*""\s*:\s*[^,}\]]+/g, "")
        .replace(/,(\s*[}\]])/g, "$1"),
    );
    try {
      parsed = JSON.parse(normalized);
    } catch (error) {
      const snippet = str.slice(0, 300);
      throw new Error(
        `Failed to parse JSON (${error instanceof Error ? error.message : "unknown"}): ${snippet}${str.length > 300 ? "..." : ""}`,
      );
    }
  }

  if (!isRecord(parsed)) {
    throw new Error("Node data must be an object.");
  }
  return normalizeNodeShape(parsed) as Record<string, unknown>;
}

function normalizeNodeShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeNodeShape);
  if (!isRecord(value)) return value;
  const obj = { ...value };
  if ("fill" in obj) obj.fill = normalizeFillField(obj.fill);
  if ("stroke" in obj) obj.stroke = normalizeStrokeField(obj.stroke);
  if (Array.isArray(obj.children)) {
    obj.children = obj.children.map(normalizeNodeShape);
  }
  return obj;
}

function normalizeFillField(value: unknown): unknown {
  if (typeof value === "string") return [{ type: "solid", color: value }];
  if (isRecord(value)) return [value];
  return value;
}

function normalizeStrokeField(value: unknown): unknown {
  if (typeof value === "string") {
    return { thickness: 1, fill: [{ type: "solid", color: value }] };
  }
  if (!isRecord(value)) return value;
  const stroke = { ...value };
  if (stroke.color != null && stroke.fill == null) {
    stroke.fill = [{ type: "solid", color: stroke.color }];
    stroke.color = undefined;
  }
  if (stroke.fill != null) stroke.fill = normalizeFillField(stroke.fill);
  return stroke;
}

function materializeNode(data: Record<string, unknown>): PenNode {
  const node = stripReservedNodeFields(data);
  node.id =
    typeof data.id === "string" && data.id ? data.id : createNodeId("pen");
  if (Array.isArray(node.children)) {
    node.children = node.children.map((child) =>
      isRecord(child) ? materializeNode(child) : child,
    );
  }
  return node as unknown as PenNode;
}

function stripReservedNodeFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const { id: _id, type, ...rest } = data;
  return typeof type === "string" ? { ...rest, type } : rest;
}

function applyDescendantOverrides(
  node: PenNode,
  descendants: Record<string, unknown>,
): void {
  for (const child of getNodeChildren(node)) {
    const override = descendants[child.id];
    if (isRecord(override)) {
      Object.assign(child, stripReservedNodeFields(override));
    }
    applyDescendantOverrides(child, descendants);
  }
}

function resolveRef(raw: string, bindings: Map<string, string>): string {
  const cleaned = raw.replace(/^["']|["']$/g, "");
  return bindings.get(cleaned) ?? cleaned;
}

function resolvePathExpr(raw: string, bindings: Map<string, string>): string {
  if (!raw.includes("+")) return resolveRef(raw, bindings);
  return raw
    .split("+")
    .map((part) => {
      const trimmed = part.trim();
      if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
        return trimmed.slice(1, -1);
      }
      return bindings.get(trimmed) ?? trimmed;
    })
    .join("");
}

function replaceSingleQuoteDelimiters(str: string): string {
  const chars: string[] = [];
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i] ?? "";
    if (ch === "\\" && (inDouble || inSingle)) {
      chars.push(ch, str[++i] ?? "");
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      chars.push(ch);
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
        chars.push('"');
      } else {
        chars.push(ch);
      }
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      chars.push(ch);
    } else if (ch === "'") {
      inSingle = true;
      chars.push('"');
    } else {
      chars.push(ch);
    }
  }
  return chars.join("");
}

function findTopLevelComma(str: string): number {
  let depth = 0;
  let inString = false;
  let quote = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i] ?? "";
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    if (ch === "}" || ch === "]" || ch === ")") depth--;
    if (ch === "," && depth === 0) return i;
  }
  return -1;
}

function splitTopLevel(str: string): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let inString = false;
  let quote = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i] ?? "";
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    if (ch === "}" || ch === "]" || ch === ")") depth--;
    if (ch === "," && depth === 0) {
      result.push(str.slice(start, i));
      start = i + 1;
    }
  }
  result.push(str.slice(start));
  return result;
}

function getDocChildren(doc: PenDocument, pageId?: string): PenNode[] {
  return getActiveChildren(doc, pageId);
}

function setDocChildren(
  doc: PenDocument,
  children: PenNode[],
  pageId?: string,
): void {
  if (doc.pages && doc.pages.length > 0) {
    const resolvedPageId = resolveActivePageId(doc, pageId);
    const page = doc.pages.find((candidate) => candidate.id === resolvedPageId);
    if (!page) throw new Error(`Page ${resolvedPageId} does not exist.`);
    page.children = children;
    doc.children = [];
    return;
  }
  resolveActivePageId(doc, pageId);
  doc.children = children;
}

function getNodeChildren(node: PenNode | undefined): PenNode[] {
  if (!node || !("children" in node) || !Array.isArray(node.children))
    return [];
  return node.children as PenNode[];
}

function findNodeInTree(nodes: PenNode[], id: string): PenNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeInTree(getNodeChildren(node), id);
    if (found) return found;
  }
  return undefined;
}

function findNodeByPath(
  doc: PenDocument,
  path: string,
  pageId?: string,
): PenNode | undefined {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return undefined;
  const rootPart = parts[0];
  if (!rootPart) return undefined;
  let current = findNodeInTree(getDocChildren(doc, pageId), rootPart);
  for (let i = 1; i < parts.length && current; i++) {
    current = getNodeChildren(current).find((child) => child.id === parts[i]);
  }
  return current;
}

function findParentInTree(nodes: PenNode[], id: string): PenNode | undefined {
  for (const node of nodes) {
    const children = getNodeChildren(node);
    if (children.some((child) => child.id === id)) return node;
    const found = findParentInTree(children, id);
    if (found) return found;
  }
  return undefined;
}

function insertNodeInTree(
  nodes: PenNode[],
  parentId: string | null,
  node: PenNode,
  index?: number,
): PenNode[] {
  if (parentId === null) {
    const next = [...nodes];
    if (typeof index === "number" && index >= 0 && index <= next.length) {
      next.splice(index, 0, node);
    } else {
      next.push(node);
    }
    return next;
  }

  return nodes.map((candidate) => {
    if (candidate.id === parentId) {
      const children = getNodeChildren(candidate);
      const nextChildren = [...children];
      if (
        typeof index === "number" &&
        index >= 0 &&
        index <= nextChildren.length
      ) {
        nextChildren.splice(index, 0, node);
      } else {
        nextChildren.push(node);
      }
      return { ...candidate, children: nextChildren } as PenNode;
    }
    const children = getNodeChildren(candidate);
    if (children.length === 0) return candidate;
    return {
      ...candidate,
      children: insertNodeInTree(children, parentId, node, index),
    } as PenNode;
  });
}

function removeNodeFromTree(nodes: PenNode[], nodeId: string): PenNode[] {
  const filtered = nodes.filter((node) => node.id !== nodeId);
  return filtered.map((node) => {
    const children = getNodeChildren(node);
    if (children.length === 0) return node;
    return {
      ...node,
      children: removeNodeFromTree(children, nodeId),
    } as PenNode;
  });
}

function updateNodeInTree(
  nodes: PenNode[],
  nodeId: string,
  updates: Record<string, unknown>,
): PenNode[] {
  return nodes.map((node) => {
    if (node.id === nodeId)
      return { ...node, ...updates, id: node.id, type: node.type } as PenNode;
    const children = getNodeChildren(node);
    if (children.length === 0) return node;
    return {
      ...node,
      children: updateNodeInTree(children, nodeId, updates),
    } as PenNode;
  });
}

function cloneNodeWithNewIds(node: PenNode): PenNode {
  const cloned = structuredClone(node) as PenNode;
  rewriteNodeIds(cloned);
  return cloned;
}

function rewriteNodeIds(node: PenNode): void {
  node.id = createNodeId(node.type);
  for (const child of getNodeChildren(node)) rewriteNodeIds(child);
}

function searchNodes(
  nodes: PenNode[],
  pattern: { name?: string; reusable?: boolean; type?: string },
  maxDepth: number,
  currentDepth = 0,
): PenNode[] {
  if (currentDepth > maxDepth) return [];
  const results: PenNode[] = [];
  const nameRegex = pattern.name ? new RegExp(pattern.name, "i") : null;
  for (const node of nodes) {
    const matchesType = !pattern.type || node.type === pattern.type;
    const matchesName = !nameRegex || nameRegex.test(node.name ?? "");
    const matchesReusable =
      pattern.reusable === undefined ||
      Boolean((node as { reusable?: boolean }).reusable) === pattern.reusable;
    if (matchesType && matchesName && matchesReusable) results.push(node);
    results.push(
      ...searchNodes(
        getNodeChildren(node),
        pattern,
        maxDepth,
        currentDepth + 1,
      ),
    );
  }
  return results;
}

function readNodeWithDepth(
  node: PenNode,
  depth: number,
): Record<string, unknown> {
  const copy = structuredClone(node) as unknown as Record<string, unknown>;
  const children = getNodeChildren(node);
  if (children.length > 0) {
    copy.children =
      depth > 0
        ? children.map((child) => readNodeWithDepth(child, depth - 1))
        : "...";
  }
  return copy;
}

function flattenNodes(nodes: PenNode[]): PenNode[] {
  const result: PenNode[] = [];
  for (const node of nodes) {
    result.push(node);
    result.push(...flattenNodes(getNodeChildren(node)));
  }
  return result;
}

function flattenToDepth(
  nodes: PenNode[],
  maxDepth: number,
  currentDepth = 0,
): PenNode[] {
  if (currentDepth > maxDepth) return [];
  const result: PenNode[] = [];
  for (const node of nodes) {
    result.push(node);
    result.push(
      ...flattenToDepth(getNodeChildren(node), maxDepth, currentDepth + 1),
    );
  }
  return result;
}

function detectLayoutProblems(
  parent: PenNode,
  parentBounds: CanvasBounds,
  children: PenNode[],
): string[] {
  const problems: string[] = [];
  const clipsContent = Boolean(
    (parent as { clipContent?: boolean }).clipContent,
  );
  if (!clipsContent) return problems;
  for (const child of children) {
    const childBounds = getNodeBounds(child);
    const outside =
      childBounds.x < parentBounds.x ||
      childBounds.y < parentBounds.y ||
      childBounds.x + childBounds.width > parentBounds.x + parentBounds.width ||
      childBounds.y + childBounds.height > parentBounds.y + parentBounds.height;
    if (outside) problems.push(`child ${child.id} is clipped by parent bounds`);
  }
  return problems;
}

function unionBounds(bounds: CanvasBounds[]): CanvasBounds {
  if (bounds.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  const minX = Math.min(...bounds.map((bound) => bound.x));
  const minY = Math.min(...bounds.map((bound) => bound.y));
  const maxX = Math.max(...bounds.map((bound) => bound.x + bound.width));
  const maxY = Math.max(...bounds.map((bound) => bound.y + bound.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function countNodes(nodes: PenNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count++;
    count += countNodes(getNodeChildren(node));
  }
  return count;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
