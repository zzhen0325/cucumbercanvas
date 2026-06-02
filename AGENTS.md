# Cucumber Studio Agent Manual

AI 原生无限画布，画布不是先存在的空白空间，而是 AI Agent 执行过程的可视化产物；

## 核心设计理念

Agent 优先：所有内容由 Agent 生成，用户仅提供目标和反馈
容器即输出：每个 Agent 的执行结果都以独立容器的形式呈现在画布上
空间即上下文：容器的位置、大小、连接关系天然表达了 Agent 的思考逻辑和数据流动

## 核心要求

- 代码旨在为高效生产和高质量要求而不是 MVP 搭建 DEMO 完成，完成功能要考虑产品特性和整体交互，阅读以及撰写时思维需要有大局观，以第一性原理直击痛点。
- 当提出加入新功能是，要从用户真实体验交互的视角完善考虑，不要代码没问题，但是视觉上或者操作交互上出现点不到或者别的低级问题。
- 在相关代码加入对应日志便于后续线上或本地排查，以及 TODO 或相关备注，为后续他人接手提供更好的桥梁。
- 不做无关改动，不重写架构，不碰未被请求的设计 token、全局样式、依赖、认证、支付、生产迁移和部署配置。
- 每次开始编码前先读相关文件和现有模式，优先复用项目已有组件、工具函数、服务边界和测试习惯。
- 不做降级或兜底方案，将错误抛出
- 不要在界面上直接返回任何错误码、null、undefined或默认值。要返回具体错误说明和原因。

## Project Context

Cucumber Studio is a Next.js + TypeScript AI creative workspace. The product centers on chat-driven canvas/productivity workflows: infinite canvas editing, project assets, Brand Kit, workspace skills, image/video generation, and agent execution traces.

This is a pnpm/turbo monorepo:

- `apps/web/`: Next.js App Router frontend.
- `apps/server/`: Fastify backend, Deep Agents/LangChain runtime, Supabase access, generation workers, WebSocket streaming.
- `packages/canvas-core/`: canonical Cucumber canvas document model, page helpers, operations, import/export helpers, clipboard, geometry, history, and agent context helpers.
- `packages/pen-core/`: Pen document tree utilities, layout, boolean ops, merge/diff, normalization, and shape/path helpers.
- `packages/pen-types/`: Pen document, page, node, style, variable, layout, and theme contracts.
- `packages/pen-renderer/`: CanvasKit/Skia renderer, hit testing, thumbnails, viewport, fonts, and image loading.
- `packages/pen-figma/`: Figma clipboard/file parsing and conversion into Cucumber Pen nodes.
- `packages/shared/`: cross-app contracts, event schemas, job contracts, and shared errors.
- `packages/config/`: shared TypeScript configuration package.
- `skills/`: workspace skills loaded by the backend agent runtime.
- `supabase/`: local Supabase config and migrations.
- `docs/`: architecture, workflow, design-system, and integration notes.
- `scripts/`: setup, debugging, and verification entry points.

## Development Commands

Use these commands from the repository root:

- Install dependencies: `pnpm install`
- Run dev server: `pnpm dev`
- Type check: `pnpm typecheck`
- Lint: `pnpm lint`
- Unit/workspace tests: `pnpm test`
- Build: `pnpm build`
- Quick harness check: `pnpm check:quick`
- Full harness check: `pnpm check:full`

## Definition of Done

A task is done only when:

- The requested behavior is implemented and no unrelated files are changed.
- TypeScript has no errors for the affected workspace.
- Lint passes, or any existing unrelated lint failures are called out with file paths.
- Relevant tests pass, or missing coverage is explicitly documented.
- Build passes when the change can affect runtime bundling or deployment.
- UI changes follow existing Tailwind/shadcn/Base UI/component conventions.
- New product behavior is documented when it changes workflow, contracts, persistence, or agent/tool behavior.
- `progress.md` and `feature_list.json` are updated when the work changes project status or a tracked feature.

## How to Work

For complex tasks:

1. Read the relevant files first, including nearby tests and shared contracts.
2. Write a short plan before editing.
3. Implement in small, reviewable steps.
4. Add focused logs where production or local diagnosis would otherwise be opaque.
5. Add TODO comments only when they identify a real follow-up owner/problem, not as decoration.
6. Run the narrowest useful verification first, then the full check when risk or scope justifies it.
7. Summarize changed files, verification result, and remaining risks.

## UI Rules

- UI 相关任务先参考根目录 `design.md`，其中维护当前 Web 端设计令牌、字体、布局、基础组件和关键实现位置索引。

## Backend And Agent Rules

- Keep agent tools small, typed, logged, and observable.
- Use shared contracts from `packages/shared` when crossing app/server or server/worker boundaries.
- Do not bypass persistence, auth, or Supabase access helpers unless the task explicitly requires it.
- For long-running agent or generation flows, include enough structured log context to correlate session, project, job, and provider failures.
- Treat skill execution, file persistence, and external generation providers as production boundaries: sanitize inputs, return typed errors, and preserve diagnosability.

## Canvas And Agent Development Order

Current development sequence:

1. Canvas foundation first: stabilize `PenDocument.pages`, active page handling, selection, rendering, persistence, import/export, and performance.
2. Canvas tools and container types next: make tools easy to extend, keep containers as Agent output units, and keep canvas operations small, typed, logged, and page-aware.
3. Agent canvas read/write next: Agent must rely on the current live canvas state before editing, using `canvas.bind` → `CanvasEditor` RPC → `LiveCanvasService` → `inspect_canvas` / `manipulate_canvas` / Cucumber structured canvas tools.
4. Agent runtime workflow after that: tune Deep Agents/LangGraph runtime, prompt layers, tool selection, skill access, and workflow orchestration only after the canvas read/write substrate is reliable.

Canvas persistence rule: `PenDocument.pages` with a valid `activePageId` is the only supported durable canvas shape. Do not add runtime compatibility for old flat-map/root-children canvas formats. If old canvas data is encountered, fail fast with a clear error and handle any real production data repair as a separate migration or data-fix task.

## LangChain / LangGraph / Deep Agents

关于 LangChain、LangGraph、Deep Agents 相关开发，先查看官方 `llms.txt` 作为索引，再进入对应文档获取最佳实践：<https://docs.langchain.com/llms.txt>

When changing agent runtime code under `apps/server/src/agent/`, inspect the current Deep Agents/LangGraph patterns in the repository before editing. Do not change framework-level orchestration, checkpointer/store behavior, or tool protocol shape without documenting the reason in `docs/architecture.md` or an adjacent technical note.

## External Frameworks

对于其他框架包括 Next.js、Excalidraw、Supabase、shadcn/Base UI 等不理解或者不熟悉的地方，一定要先看文档或者源码再开始，确保先获取信息上下文再开干，不然容易导致返工。

## Forbidden Changes

Do not modify these unless explicitly requested:

- `.env`
- `.env.local`
- Package manager lockfile, unless dependencies change.
- Production database migrations.
- Auth logic.
- Payment logic.
- Global design tokens.
- Deployment configuration.

