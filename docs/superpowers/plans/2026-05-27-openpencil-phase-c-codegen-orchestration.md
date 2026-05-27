# OpenPencil Phase C Codegen Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Phase C end-to-end thin slice: prompt-to-canvas planning, bounded concurrent container materialization, and Vue export alongside React/HTML.

**Architecture:** Extend the existing OpenPencil-compatible MCP tool module rather than introducing a new runtime. Store lightweight prompt-canvas plans in memory, execute them against `LiveCanvasService`, serialize document writes, and reuse the current Pen node export helpers for React/HTML while adding Vue output.

**Tech Stack:** TypeScript, Zod, Vitest, Fastify MCP registry helpers, `@cucumber/canvas-core` Pen document helpers, existing live-canvas RPC boundary.

---

### Task 1: Add Red Tests For Phase C Tool Listing And Planning

**Files:**
- Modify: `apps/server/src/mcp/tools/open-pencil-canvas.test.ts`
- Modify: `apps/server/src/mcp/tools/open-pencil-canvas.ts`

- [ ] **Step 1: Write failing tests for new tool exposure and validation**

Add these tests inside the existing `describe("OpenPencil-compatible canvas MCP tools", ...)` block:

```ts
  it("lists Phase C prompt-to-canvas orchestration tools", () => {
    const harness = createLiveCanvasHarness(createEmptyDocument());
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    expect(server.getTool("prompt_canvas_plan")).toBeTruthy();
    expect(server.getTool("prompt_canvas_execute")).toBeTruthy();
  });

  it("creates a deterministic prompt_canvas_plan with bounded sections", async () => {
    const harness = createLiveCanvasHarness(createEmptyDocument());
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    const planned = await server.callTool(
      "prompt_canvas_plan",
      {
        exportTargets: ["react", "html", "vue"],
        maxSections: 3,
        prompt:
          "Create a SaaS dashboard canvas with navigation, metrics, and activity details",
        surface: "dashboard",
      },
      userContext,
    );

    expect(planned.structuredContent).toMatchObject({
      success: true,
      summary: expect.stringContaining("Created prompt canvas plan"),
    });
    expect(planned.structuredContent?.planId).toMatch(/^prompt_canvas_/);
    expect(planned.structuredContent?.rootFrame).toMatchObject({
      height: expect.any(Number),
      layout: "vertical",
      name: expect.stringContaining("SaaS Dashboard"),
      width: 1200,
    });
    expect(planned.structuredContent?.sections).toEqual([
      expect.objectContaining({
        dependencies: [],
        region: expect.objectContaining({ width: 1120 }),
        role: "navigation",
        sectionId: "section-1-navigation",
      }),
      expect.objectContaining({
        dependencies: ["section-1-navigation"],
        role: "metrics",
        sectionId: "section-2-metrics",
      }),
      expect.objectContaining({
        dependencies: ["section-2-metrics"],
        role: "activity",
        sectionId: "section-3-activity",
      }),
    ]);
  });

  it("rejects invalid prompt_canvas_plan input with concrete messages", async () => {
    const harness = createLiveCanvasHarness(createEmptyDocument());
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    await expect(
      server.callTool(
        "prompt_canvas_plan",
        {
          exportTargets: ["swiftui"],
          maxSections: 3,
          prompt: "Design a settings screen",
          surface: "mobile",
        },
        userContext,
      ),
    ).rejects.toThrow("Unsupported Phase C export target: swiftui");
  });
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PATH="/Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" ../../node_modules/.bin/vitest run src/mcp/tools/open-pencil-canvas.test.ts --passWithNoTests
```

from `apps/server`.

Expected: FAIL because `prompt_canvas_plan` and `prompt_canvas_execute` are not registered.

### Task 2: Add Red Tests For Prompt Canvas Execution

**Files:**
- Modify: `apps/server/src/mcp/tools/open-pencil-canvas.test.ts`
- Modify: `apps/server/src/mcp/tools/open-pencil-canvas.ts`

- [ ] **Step 1: Write failing execution tests**

Add this test in the same describe block:

```ts
  it("executes a prompt_canvas_plan into durable section containers", async () => {
    const doc = createEmptyDocument();
    const existing: PenDocument["children"] = [
      {
        id: "manual-note",
        type: "text",
        content: "Keep this manual context",
        x: 10,
        y: 20,
        width: 240,
        height: 32,
      },
    ];
    doc.children = existing;
    if (doc.pages?.[0]) doc.pages[0].children = existing;

    const harness = createLiveCanvasHarness(doc);
    const server = createInMemoryMcpServer(
      createOpenPencilCanvasMcpTools({
        liveCanvasService: harness.liveCanvasService as never,
      }),
    );

    const planned = await server.callTool(
      "prompt_canvas_plan",
      {
        exportTargets: ["react", "html", "vue"],
        maxSections: 2,
        prompt: "Create a mobile onboarding screen with hero and form sections",
        surface: "mobile",
      },
      userContext,
    );
    const planId = planned.structuredContent?.planId as string;

    const executed = await server.callTool(
      "prompt_canvas_execute",
      {
        commitMode: "section",
        concurrency: 2,
        planId,
      },
      userContext,
    );

    expect(executed.structuredContent).toMatchObject({
      success: true,
      summary: expect.stringContaining("Executed prompt canvas plan"),
    });
    const rootNodeId = executed.structuredContent?.rootNodeId as string;
    expect(rootNodeId).toBeTruthy();
    expect(findNode(harness.state.doc, "manual-note")).toBeTruthy();
    expect(findNode(harness.state.doc, rootNodeId)).toMatchObject({
      containerRole: ["task", "visual"],
      type: "frame",
    });
    const root = findNode(harness.state.doc, rootNodeId) as
      | (PenDocument["children"][number] & { children?: PenDocument["children"] })
      | undefined;
    expect(root?.children?.length).toBeGreaterThanOrEqual(2);
    expect(executed.structuredContent?.sectionResults).toEqual([
      expect.objectContaining({ sectionId: "section-1-hero", status: "completed" }),
      expect.objectContaining({ sectionId: "section-2-form", status: "completed" }),
    ]);
    expect(executed.structuredContent?.exportableNodeIds).toEqual([rootNodeId]);
  });
```

- [ ] **Step 2: Run tests and verify RED**

Run the same focused Vitest command from `apps/server`.

Expected: FAIL because `prompt_canvas_execute` is not implemented.

### Task 3: Add Red Tests For Vue Export

**Files:**
- Modify: `apps/server/src/mcp/tools/open-pencil-canvas.test.ts`
- Modify: `apps/server/src/mcp/tools/open-pencil-canvas.ts`

- [ ] **Step 1: Extend export test to include Vue**

In the existing `"exports the current canvas selection directly to React and HTML"` test, after the HTML assertion add:

```ts
    const vueExport = await server.callTool(
      "codegen_export",
      {
        componentName: "selected-card",
        framework: "vue",
        nodeIds: ["export-card"],
      },
      userContext,
    );
    expect(vueExport.structuredContent).toMatchObject({
      framework: "vue",
      nodeIds: ["export-card"],
      success: true,
    });
    expect(vueExport.structuredContent?.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining("<template>"),
          path: "SelectedCard.vue",
        }),
        expect.objectContaining({
          content: expect.stringContaining(".SelectedCardRoot"),
          path: "SelectedCard.css",
        }),
      ]),
    );
```

- [ ] **Step 2: Run tests and verify RED**

Run the focused Vitest command from `apps/server`.

Expected: FAIL because `codegen_export` currently rejects `vue` at the schema level.

### Task 4: Implement Prompt Canvas Planning, Execution, And Vue Export

**Files:**
- Modify: `apps/server/src/mcp/tools/open-pencil-canvas.ts`
- Modify: `apps/server/src/mcp/tools/open-pencil-canvas.test.ts`

- [ ] **Step 1: Add schemas and plan storage**

Add Zod schemas near the existing codegen schemas:

```ts
const phaseCExportTargetSchema = z.enum(["react", "html", "vue"]);

const promptCanvasPlanSchema = z.object({
  prompt: z.string().trim().min(1),
  surface: z.enum(["desktop", "mobile", "dashboard", "flow", "auto"]).default("auto"),
  maxSections: z.number().int().min(1).max(6).default(4),
  exportTargets: z.array(phaseCExportTargetSchema).min(1).default(["react", "html", "vue"]),
  pageId: z.string().optional(),
});

const promptCanvasExecuteSchema = z.object({
  planId: z.string().min(1),
  concurrency: z.number().int().min(1).max(4).default(2),
  commitMode: z.enum(["section", "final"]).default("section"),
  pageId: z.string().optional(),
});
```

Add types and an in-memory map:

```ts
type PromptCanvasSurface = z.infer<typeof promptCanvasPlanSchema>["surface"];
type PhaseCExportTarget = z.infer<typeof phaseCExportTargetSchema>;
type PromptCanvasSectionStatus = "completed" | "failed" | "skipped";

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
  rootFrame: CanvasBounds & { name: string; layout: "vertical" | "horizontal" | "none" };
  sections: PromptCanvasSectionPlan[];
  warnings: string[];
  createdAt: number;
};

const promptCanvasPlans = new Map<string, PromptCanvasPlanRecord>();
```

- [ ] **Step 2: Register tools**

Add two `createNativeMcpTool(...)` entries before codegen tools:

```ts
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
```

- [ ] **Step 3: Implement deterministic planning helpers**

Add helper functions below the style helpers:

```ts
function createPromptCanvasPlan(
  input: z.infer<typeof promptCanvasPlanSchema>,
): PromptCanvasPlanRecord {
  const unsupported = input.exportTargets.find(
    (target) => !phaseCExportTargetSchema.safeParse(target).success,
  );
  if (unsupported) throw new Error(`Unsupported Phase C export target: ${unsupported}`);

  const planId = `prompt_canvas_${randomUUID()}`;
  const rootFrame = buildPromptCanvasRootFrame(input.prompt, input.surface);
  const sections = buildPromptCanvasSections(input.prompt, input.surface, input.maxSections, rootFrame);
  const plan: PromptCanvasPlanRecord = {
    createdAt: Date.now(),
    exportTargets: input.exportTargets,
    pageId: input.pageId,
    planId,
    prompt: input.prompt,
    rootFrame,
    sections,
    surface: input.surface,
    warnings: [],
  };
  promptCanvasPlans.set(planId, plan);
  return plan;
}
```

Implement `buildPromptCanvasRootFrame`, `buildPromptCanvasSections`, `inferSectionRoles`, `titleCase`, and `slugifySectionId` using deterministic keyword rules for `dashboard`, `mobile`, `flow`, and `desktop`.

- [ ] **Step 4: Implement execution helpers**

Add `executePromptCanvasPlan`, `createPromptRootNode`, `createPromptSectionNode`, `appendChildToNode`, and `setNodeTreeInDoc` helpers.

Key implementation rule:

```ts
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
  setDocChildren(doc, insertNodeInTree(getDocChildren(doc, pageId), null, root), pageId);
  await liveCanvasService.setDocument(live.user, live.canvasId, doc);

  const sectionResults = [];
  for (const section of plan.sections) {
    doc = await liveCanvasService.getDocument(live.user, live.canvasId);
    if (!findNode(doc, root.id)) {
      throw new Error(`Prompt canvas root container was removed before section ${section.sectionId} could be written.`);
    }
    const sectionNode = createPromptSectionNode(plan, section, root);
    appendChildToNode(doc, root.id, sectionNode, pageId);
    await liveCanvasService.setDocument(live.user, live.canvasId, doc);
    sectionResults.push({
      insertedNodeIds: [sectionNode.id],
      sectionId: section.sectionId,
      status: "completed" satisfies PromptCanvasSectionStatus,
      warnings: [],
    });
  }

  promptCanvasPlans.delete(input.planId);
  return {
    success: true,
    summary: `Executed prompt canvas plan ${input.planId} into ${sectionResults.length} section container(s).`,
    rootNodeId: root.id,
    insertedNodeIds: [root.id, ...sectionResults.flatMap((result) => result.insertedNodeIds)],
    sectionResults,
    exportableNodeIds: [root.id],
  };
}
```

Keep writes serialized. The first slice may simulate concurrency by honoring dependency-ready order while using the bounded `concurrency` value for logs and validation.

- [ ] **Step 5: Add Vue export support**

Change `codegenExportSchema` to:

```ts
const codegenExportSchema = z.object({
  framework: z.enum(["react", "html", "vue"]),
  nodeIds: z.array(z.string()).optional(),
  componentName: z.string().default("CucumberExport"),
});
```

Change export selection:

```ts
const files =
  input.framework === "react"
    ? exportNodesToReactFiles(nodes, componentName)
    : input.framework === "vue"
      ? exportNodesToVueFiles(nodes, componentName)
      : exportNodesToHtmlFiles(nodes, componentName);
```

Add:

```ts
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
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run from `apps/server`:

```bash
PATH="/Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" ../../node_modules/.bin/vitest run src/mcp/tools/open-pencil-canvas.test.ts --passWithNoTests
```

Expected: PASS.

### Task 5: Update Prompt, Docs, Registry, And Verify

**Files:**
- Modify: `apps/server/src/agent/prompts/cucumber-main.ts`
- Modify: `docs/tech/canvas-design-integration.md`
- Modify: `progress.md`
- Modify: `feature_list.json`
- Test: `apps/server/src/mcp/tools/open-pencil-canvas.test.ts`

- [ ] **Step 1: Update system prompt tool inventory**

In `CUCUMBER_SYSTEM_PROMPT`, extend the OpenPencil tool list with:

```md
- prompt_canvas_plan / prompt_canvas_execute：用于 Phase C 端到端视觉 prompt 编排，先把需求拆成空间化 section plan，再并发/分段写入容器化画布结果，适合 dashboard、landing page、app screen、workflow 等结构化视觉产出
```

Also update the codegen sentence to mention Vue:

```md
- read_nodes / codegen_plan / codegen_submit_chunk / codegen_assemble / codegen_export / codegen_clean：用于设计转代码的分块读取、计划、提交、组装，以及把当前选区直接导出为 React/HTML/Vue
```

- [ ] **Step 2: Update canvas integration doc**

Append a `## Phase C Codegen And Prompt-To-Canvas Orchestration` section to `docs/tech/canvas-design-integration.md` describing the two new tools, serialized writes, section metadata, and React/HTML/Vue export.

- [ ] **Step 3: Update status files**

Update `progress.md` top timestamp and add a Phase C implementation bullet. Update `feature_list.json` `updatedAt`, mark `openpencil-phase-c-codegen-orchestration` as `active`, and keep artifacts aligned with touched files.

- [ ] **Step 4: Run verification**

Run:

```bash
./node_modules/.bin/tsc -p apps/server/tsconfig.json --noEmit
PATH="/Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" ../../node_modules/.bin/vitest run src/mcp/tools/open-pencil-canvas.test.ts --passWithNoTests
./node_modules/.bin/biome check apps/server/src/mcp/tools/open-pencil-canvas.ts apps/server/src/mcp/tools/open-pencil-canvas.test.ts apps/server/src/agent/prompts/cucumber-main.ts docs/tech/canvas-design-integration.md progress.md feature_list.json docs/superpowers/plans/2026-05-27-openpencil-phase-c-codegen-orchestration.md
```

Expected: all pass. If Biome skips ignored docs, record that in the final summary.

- [ ] **Step 5: Commit**

```bash
git add -f docs/superpowers/plans/2026-05-27-openpencil-phase-c-codegen-orchestration.md
git add apps/server/src/mcp/tools/open-pencil-canvas.ts apps/server/src/mcp/tools/open-pencil-canvas.test.ts apps/server/src/agent/prompts/cucumber-main.ts docs/tech/canvas-design-integration.md progress.md feature_list.json
git commit -m "feat: add phase c prompt canvas orchestration"
```

## Self-Review

Spec coverage:

- Planning: Task 1 and Task 4.
- Execution: Task 2 and Task 4.
- Bounded concurrency and serialized writes: Task 4.
- Vue export: Task 3 and Task 4.
- Prompt/docs/status updates: Task 5.
- Verification: Task 5.

Placeholder scan: no `TBD`, `TODO`, `implement later`, or vague edge-case placeholders are used as plan instructions.

Type consistency: tool names, schema names, and result fields match across test and implementation tasks.
