> **[STAR]**
> **本文档定位**
> 本文档是 CucumberCanvas 改造的**唯一启动参考文档**，整合了三份子方案（多角色容器系统架构、Headless Engine + Pixi.js v8 引擎改造、OpenPencil Agent 系统复用评估）。它解决一个核心问题——**把 CucumberCanvas 从"AI 画板工具"升级为"AI 设计系统"**，并直接作为 P0 编码启动、issue 拆分、跨团队对齐的依据。
> 阅读建议：先看「关键决策摘要」对齐选型，再看「统一总架构图」建立全局直觉，然后按「分阶段实施路径」拆 issue 即可启动 P0。

## 一、关键决策摘要（Decision Log）

下面这张表是整个改造的"选型答案集"——所有架构争议在三份子方案里已经吵完，本节只记录**最终落地的决策**。

| 决策点 | 结论 | 理由 | 影响阶段 |
| --- | --- | --- | --- |
| **底层渲染引擎** | **Pixi.js v8** 替换 Excalidraw | WebGL2 + WebGPU 双后端、Filter 系统支持自定义着色器、生态成熟、license 友好 | P0 起 |
| **引擎核心架构** | **Headless Engine**（零 DOM 依赖） | 渲染、UI、状态彻底解耦；未来可换 WebGPU 原生 / SSR 缩略图，不动核心 | P0 起 |
| **OpenPencil 复用** | MIT License，**最大化复用** pen-engine / pen-core / pen-types | 命名空间 `@zseven-w`，Headless 设计、TypedEventEmitter、SpatialIndex 等可直接拿来用 | P0 起 |
| **Excalidraw 处理** | **完全替换**，不做兼容并存 | Excalidraw 元素 schema 不可扩展、事件系统封闭，长期看是技术债 | P0–P3 |
| **容器系统模型** | `ContainerNode` 是**引擎一等公民**，不再是 Overlay hack | 新引擎支持原生节点类型扩展，避免坐标同步、命中检测分通道这些工程负担 | P1 起 |
| **容器角色建模** | `role: ContainerRole[]`，**多角色并存**而非枚举 | 同一容器天然可以"既视觉分组又是 Agent 工作区"，单数据多投影 | P1 起 |
| **上下文继承策略** | `merge`（默认）/ `override` / `block` 三态 | 覆盖 99% 设计场景；`contextSlots` 只存本地贡献，运行时解析，避免数据漂移 | P1 起 |
| **数据流执行模型** | **拉取式（pull）+ 缓存**，DAG 拓扑 | 下游变化才回溯上游，避免无关重算；环 → 报错而非死循环 | P2 起 |
| **Agent 隔离模型** | **硬隔离**：`canOperate()` 门控 + 容器级乐观锁 | OpenPencil 是软隔离（视觉标记），CC 需要执行层强制约束 | P1 起 |
| **Agent 通信模式** | **双向通信**：SSE 广播 + P2P 请求/响应 | OpenPencil 单向广播不够，CC 需要 `requestFromPeer()` 协商语义 | P2–P3 |
| **冲突处理** | **容器级乐观锁 + 操作队列**，不用 3-way Merge | 3-way Merge 是离线 Git 语义，不适合多 Agent 实时场景 | P3 |
| **迁移策略** | **Shadow → 灰度（5/20/50/100%）→ 完全切换** | 避免 Big-Bang；灰度按 UserID 粒度回退；旧包保留 30 天热备 | P0–P3 |
| **视觉一致性** | **像素级复刻**旧版外观，前端用户无感切换 | 用 `PIXI.Graphics` 复刻 Excalidraw 圆角/填充/描边；Playwright 截图对比 CI 兜底 | P0 验收 |
| **总周期** | **约 13–14 周**（P0 3w + P1 3w + P2 3–4w + P3 4w） | 三份子方案对齐后的合并时间线（详见第六节） | — |

---

## 二、统一总架构图

下面这张图是改造后的全栈视图——四层架构、容器系统的横向投影、Agent 编排层一次性呈现。**阅读重点**：紫色高亮的 ContainerNode 是贯穿三层的一等公民，橙色是 Agent 编排侧栏。

![board_QnFlw1YbchC6yxbolvJcHdM2nyb](./images/board_QnFlw1YbchC6yxbolvJcHdM2nyb_4.svg)

### 2.1 四层架构职责

| 层级 | 职责 | 核心模块 | 技术选型 |
| --- | --- | --- | --- |
| **Layer 1** React UI / 交互层 | 用户可见的所有界面元素和交互 | React Flow 节点系统、DOM Overlay（ContainerNode 渲染、Agent 状态、Context 面板）、工具栏、属性面板、右键菜单 | React 18 + React Flow + Zustand |
| **Layer 2** Headless Engine 核心层 | 纯逻辑状态机，零 DOM 依赖 | DesignEngine、DocumentManager、SelectionManager、HistoryManager、ViewportController、ContainerManager、DataFlowEngine、SpatialIndex、TypedEventEmitter | TypeScript（复用 OpenPencil pen-engine） |
| **Layer 3** Pixi.js v8 渲染层 | 画布视觉表现、节点绘制、特效 | Application/Stage、Container 树（映射 SceneTree）、Graphics/Sprite/Text、Filter System、Ticker | Pixi.js v8 (WebGL2 + WebGPU) |
| **Layer 4** 底层 GPU 能力 | 硬件加速渲染和自定义着色器 | WebGL 2.0 / WebGPU、Custom Shaders、Asset Loader | GLSL / WGSL |

### 2.2 层间通信机制

| 通信方向 | 触发方式 | 说明 |
| --- | --- | --- |
| UI → Engine | 调用 Engine API | 用户操作（拖拽、选择、属性修改）通过 DesignEngine 的公开方法修改状态 |
| Engine → UI | `TypedEventEmitter` 事件 | `document:change`、`selection:change`、`history:change` 通知 React 组件重绘 |
| Engine → Renderer | `document:change` 事件驱动 | 渲染层监听变更，调用 `flattenToRenderNodes()` 将场景树平坦化后重绘 |
| Renderer → Engine | Hit Test 回调 | 点击检测结果回传给 SelectionManager，更新选区状态 |
| Engine ↔ Agent Orchestrator | `AgentContext` 注入 + 工具调用 | 调度器通过 `ContainerManager` 拿到容器边界和 effective context；Agent 写操作必须经过 `canOperate()` 门控 |

### 2.3 ContainerNode 在三层的投影

ContainerNode 不是某一层独有，而是**同一份数据在三层各有投影**——通过 `containerId` 保持一致。

| 容器系统概念 | 场景树节点（Engine） | Pixi.js DisplayObject | React Flow Node |
| --- | --- | --- | --- |
| **ContainerNode** | `SceneTreeNode { type: 'container', children: [...] }` | `PIXI.Container` 实例（含子 Graphics/Sprite） | `ReactFlowNode { type: 'container', data: ContainerNode }` |
| **ContainerBounds** | `node.bounds: { x, y, width, height }` | `container.position.set(x, y)`；mask 裁剪为 width×height | `node.position`、`node.style: { width, height }` |
| **嵌套关系（parentId）** | 树的 parent-child 引用 | `parentContainer.addChild(childContainer)` | React Flow `parentNode` 属性 |
| **IOPort** | `node.ioPorts: IOPort[]` | 容器边缘小圆形 `PIXI.Graphics` | React Flow `Handle` 组件 |
| **DataFlowEdge** | Engine 内的 `edges: DataFlowEdge[]` | 带箭头的 `PIXI.Graphics` 路径 | React Flow `Edge` 组件 |
| **AgentBinding** | `node.agentBinding` | 容器标题栏右侧 Agent 状态图标 | DOM Overlay 中的 Agent 状态 Badge |
| **ContextSlots** | `node.contextSlots` + `resolveContext()` | 影响子节点的渲染参数（色板、字体） | DOM Overlay 中的 Context 编辑面板 |

---

## 三、统一数据模型

下面这套类型系统是**整个改造的"数据契约"**——所有层都围绕它展开。这一节是 P0 编码的"第一份要落地的代码"。

### 3.1 ContainerNode：容器节点

```typescript
// packages/canvas/src/container/types.ts
export type ContainerRole = 'visual' | 'task' | 'context' | 'dataflow';
export type InheritPolicy = 'merge' | 'override' | 'block';

export interface ContainerBounds {
  x: number;        // 画布坐标系（与 Engine scene coords 对齐）
  y: number;
  width: number;
  height: number;
  z?: number;       // 层级，用于多容器重叠时的渲染顺序
}

export interface ContextSlots {
  style?: Record<string, unknown>;        // 视觉风格：色板、字体、圆角
  tokens?: Record<string, unknown>;       // 设计 Token：spacing、radius、shadow
  rules?: string[];                       // 自然语言规则："只用品牌紫"
  constraints?: Record<string, unknown>;  // 强约束：aspect ratio、最大元素数
}

export interface IOPort {
  id: string;
  direction: 'input' | 'output';
  dataType: 'image' | 'text' | 'json' | 'reference' | 'prompt';
  schema?: unknown;                       // JSON Schema，用于运行时校验
  label?: string;                         // UI 上显示的端口名
}

export interface AgentBinding {
  agentId?: string;                       // Agent 实例 ID（来自 Agent Identity）
  agentType?: 'designer' | 'critic' | 'composer' | string;
  role?: 'designer' | 'developer' | 'reviewer' | 'assistant';
  color?: string;                         // 来自 Agent Identity palette（如 #FF6B6B）
  name?: string;                          // 来自 Agent Identity names（如 Kiki）
  status?: 'idle' | 'thinking' | 'running' | 'blocked' | 'done';
  permissions?: ('read' | 'write' | 'spawn')[];
  assignedAt?: number;                    // 持久化绑定时间戳
}

export interface ContainerPermissions {
  owner: string;                          // agentId
  canRead: string[];                      // agentIds that can read
  canWrite: string[];                     // agentIds that can write
  isolationLevel: 'strict' | 'collaborative' | 'open';
}

export interface ContainerNode {
  id: string;
  type: 'container';
  parentId: string | null;                // 嵌套的父容器；null 表示根画布直接子节点
  role: ContainerRole[];                  // 一个容器可以同时是多种角色
  bounds: ContainerBounds;
  contextSlots: ContextSlots;             // 本容器自身定义的上下文（不存储继承后的值）
  inheritPolicy: InheritPolicy;
  ioPorts: IOPort[];
  agentBinding?: AgentBinding;
  permissions?: ContainerPermissions;
  style?: { fill?: string; stroke?: string; opacity?: number; label?: string };
  meta?: Record<string, unknown>;         // 扩展字段，例如 templateId、createdBy
}
```

> **[SPEECH_BALLOON]**
> **几条关键设计纪律**
> - **role&nbsp;是数组而非枚举**：一个容器天然可以"既是视觉分组也是任务区域"，无需建两套数据。
> - **parentId&nbsp;而不是&nbsp;children[]**：单向引用更易增删，重排时无需双向同步。
> - **contextSlots&nbsp;只存"本容器贡献的上下文"**：最终值在运行时由继承解析器算出，避免数据冗余和漂移。
> - **ioPorts&nbsp;是显式数组**：端口数量可变，每个端口都有自己的类型和 Schema。
> - **agentBinding&nbsp;合并了三方语义**：CC 的 task 角色 + OpenPencil 的 Agent Identity（color + name）+ 持久化字段。

### 3.2 AgentContext：Agent 注入接口

调度器在调起 Agent 时构造一份 `AgentContext` 注入到提示词或工具调用上下文里。这份 context 对齐了**容器架构方案**和 **OpenPencil 复用方案**两边的字段。

```typescript
// packages/agent/src/context.ts
export interface NodeSummary {
  id: string;
  type: string;
  bounds?: ContainerBounds;
  label?: string;
}

export interface AgentMessage {
  from: string;       // agentId
  to?: string;        // agentId or '*' for broadcast
  payload: unknown;
}

export interface PeerRequest {
  type: string;
  payload: unknown;
}

export interface PeerResponse {
  ok: boolean;
  payload: unknown;
}

export interface AgentContext {
  // —— 身份与位置 ——
  agentId: string;
  containerId: string;
  containerPath: string[];                  // 从 root 到当前容器的 id 链路
  parent: ContainerNode | null;
  siblings: { containerId: string; agentId?: string; status?: string }[];

  // —— 上下文与可见性 ——
  effectiveContext: ContextSlots;           // resolveContext(containerId) 的结果
  visibleNodes: NodeSummary[];              // 容器 bounds 内的节点摘要
  ioPorts: IOPort[];                        // 当前容器对外的 IO 端口

  // —— 权限与门控 ——
  permissions: ('read' | 'write' | 'spawn')[];
  canOperate: (nodeId: string) => boolean;  // 硬隔离门控（CC 自研，超越 OpenPencil 软隔离）

  // —— 事件订阅 ——
  subscribe: <K extends keyof ContainerEvents>(
    event: K,
    cb: ContainerEvents[K]
  ) => () => void;

  // —— 跨容器通信 ——
  broadcast: (message: AgentMessage) => void;
  requestFromPeer: (agentId: string, req: PeerRequest) => Promise<PeerResponse>;
}

export interface ContainerEvents {
  'content:change': (nodes: NodeSummary[]) => void;
  'agent:enter': (binding: AgentBinding) => void;
  'agent:leave': (agentId: string) => void;
  'agent:status': (agentId: string, status: AgentBinding['status']) => void;
  'boundary:resize': (newBounds: ContainerBounds) => void;
  'permission:change': (perms: ContainerPermissions) => void;
}
```

### 3.3 IOPort 数据流协议

```typescript
// packages/canvas/src/dataflow/types.ts
export interface DataFlowEdge {
  id: string;
  source: { nodeId: string; portId: string };
  target: { nodeId: string; portId: string };
  transform?: { type: string; params?: unknown }; // 边上的轻量变换（裁剪、降采样）
}

export type PortPayload =
  | { type: 'image'; url: string; width?: number; height?: number; mime?: string }
  | { type: 'text'; content: string }
  | { type: 'json'; value: unknown; schema?: string }
  | { type: 'reference'; refType: 'image' | 'text' | 'node'; ref: string }
  | { type: 'prompt'; template: string; vars?: Record<string, unknown> };

export interface ResolvedContext extends ContextSlots {
  containerId: string;
  containerPath: string[];
}

export type NodeExecutor = (
  inputs: Record<string /*portId*/, PortPayload>,
  ctx: ResolvedContext,
  emit: (portId: string, payload: PortPayload) => void
) => Promise<void>;

export interface DataFlowEngine {
  register(nodeId: string, executor: NodeExecutor): void;
  run(nodeId: string, ctx: ResolvedContext): Promise<void>;
  topoSort(rootId: string): string[]; // 环 → 报错
}
```

**类型兼容规则（保守版）：**

- `output:image` → `input:image | input:reference`（图像可以作为引用）

- `output:text` → `input:text | input:prompt`（文本可注入到 prompt 模板）

- `output:json` → `input:json`（必须 schema 兼容）

- 其他组合默认 reject，UI 上拖动连线时即时反馈"不兼容"

### 3.4 上下文继承解析算法

```typescript
// packages/canvas/src/container/context-resolver.ts
export function resolveContext(
  containerId: string,
  tree: Map<string, ContainerNode>
): ContextSlots {
  const chain: ContainerNode[] = [];
  let cur = tree.get(containerId);
  while (cur) {
    chain.push(cur);
    cur = cur.parentId ? tree.get(cur.parentId) : undefined;
  }
  // 从根开始向下应用，让靠近自身的层有更高优先级
  chain.reverse();

  let acc: ContextSlots = {};
  for (const node of chain) {
    switch (node.inheritPolicy) {
      case 'block':
        acc = filterOutBlockedSlots(acc, node.contextSlots); // 截断该 slot 的继承
        break;
      case 'override':
        acc = { ...acc, ...node.contextSlots };               // 整段替换
        break;
      case 'merge':
      default:
        acc = mergeSlots(acc, node.contextSlots);             // 深合并
        break;
    }
  }
  return acc;
}
```

> **[BULB]**
> **继承解析的工程纪律**
> - **解析结果可缓存但要可失效**：用 memoization 缓存 `resolveContext(containerId)`；任一祖先 `contextSlots` / `inheritPolicy` / `parentId` 变化时清掉对应子树缓存。
> - **运行时只读**：节点拿到的是解析后的"快照"，不能反向写入；想修改上下文必须修改某个具体容器的 `contextSlots`。
> - **写时显式声明归属**：所有上下文写入必须明确写到哪个 `containerId`，避免出现"全局上下文池"这种隐藏耦合。

---

## 四、统一 OpenPencil 复用清单

把"引擎模块"和"Agent 模块"两份清单合并成一份，**按"可直接复制 / 需适配 / 需新建"三档**给出。这是 P0 启动后第一周就要执行的"代码搬运地图"。

### 4.1 可直接复制（Copy as-is）

| 包 / 模块 | 源路径 | 功能 | 复用理由 |
| --- | --- | --- | --- |
| **pen-types** | `packages/pen-types/` | 文档模型接口（PenDocument、PenNode、PenNodeBase、ContainerProps 等） | 纯 TypeScript 接口，零运行时依赖；可直接作为 CC 的基础 schema |
| **pen-engine/event-emitter** | `packages/pen-engine/src/core/event-emitter.ts` | 类型安全的事件总线 `TypedEventEmitter` | 纯 TypeScript 泛型实现，无任何外部依赖；可扩展为 ContainerScopedEmitter |
| **pen-engine/history-manager** | `packages/pen-engine/src/core/history-manager.ts` | Undo/Redo 状态栈 | 基于快照的历史管理，与具体节点类型解耦 |
| **pen-engine/selection-manager** | `packages/pen-engine/src/core/selection-manager.ts` | 多选 / 单选 / 框选状态管理 | 纯状态逻辑，可直接用于 CC 的选区管理 |
| **pen-engine/viewport-controller** | `packages/pen-engine/src/core/viewport-controller.ts` | 缩放、平移、视口变换 | 数学变换逻辑可直接移植，与渲染层解耦 |
| **pen-engine/spatial-index** | `packages/pen-engine/src/core/spatial-index.ts` | R-Tree 空间索引 | 高性能点击检测和范围查询；后续可扩展为"操作边界检查" |
| **pen-core/layout-engine** | `packages/pen-core/src/layout/` | Flexbox 子集布局计算 | 纯计算逻辑，可直接用于容器内子节点的自动布局 |
| **pen-core/variables** | `packages/pen-core/src/variables/` | 设计变量 / Token 解析 | 与 `ContainerNode.contextSlots.tokens` 字段天然匹配 |
| **pen-renderer/viewport** | `packages/pen-renderer/src/viewport.ts` | 视口矩阵计算（screenToScene / sceneToScreen） | 纯数学函数，可直接用于 Pixi.js 的坐标变换 |
| **Agent Identity 系统** | `apps/web/src/services/ai/agent-identity.ts` | Agent 颜色 + 名称分配（Kiki #FF6B6B 等） | 成熟的 Identity palette，扩展为持久化绑定即可 |
| **AgentFrameEntry** | `apps/web/src/canvas/agent-indicator.ts` | `{ frameId, color, name }` 全局态 | 映射到 CC 的 `AgentBinding`，扩展 role/permissions 即可 |

### 4.2 需适配改造（Fork + Modify）

| 包 / 模块 | 改造点 | 具体改动 |
| --- | --- | --- |
| **pen-engine/design-engine** | 扩展 ContainerManager / DataFlowEngine | 在 `DesignEngine` 类中新增 `ContainerManager`（管理 ContainerNode 的 CRUD、继承解析、Agent 绑定）和 `DataFlowEngine`（拓扑排序、端口连线）。这两个是 OpenPencil 没有但容器系统需要的 |
| **pen-engine/document-manager** | 扩展文档模型 | 在 `PenDocument` 中增加 `containers: ContainerNode[]` 字段；修改序列化/反序列化逻辑以支持容器数据持久化 |
| **pen-types/pen.ts** | 扩展节点类型 | 新增 `ContainerNode` 类型定义；扩展 `PenNodeType` 枚举增加 `'container'` |
| **pen-renderer/document-flattener** | 适配 Pixi.js 输出 | 将 `flattenToRenderNodes` 的输出从 CanvasKit 绘制指令改为 Pixi.js `Container` / `Graphics` / `Sprite` 的创建指令 |
| **pen-react/hooks** | 保留事件订阅模式 | `use-engine-subscribe.ts` 的模式（引擎事件 → React 状态更新）可复用，需要适配新的 ContainerManager 事件 |
| **Orchestrator Plan** | plan → subtasks → parallel | 保留并行执行架构；将 OpenPencil 的"空间区域分解"改为"容器任务分配"，支持动态增减 Agent |
| **MCP Sync (SSE)** | 容器级事件过滤 | 保留 SSE 广播模式；事件按 `containerId` 过滤，Agent 只收到自己容器的变更；防抖：内容 1s、状态 200ms |
| **SpatialIndex** | 从"点击检测"扩展为"操作边界检查" | R-Tree 同时承载 hit-test 和 `canOperate()` 边界判定 |

### 4.3 需全新实现（New Implementation）

| 模块 | 说明 |
| --- | --- |
| **PixiRenderer** | 替代 `pen-renderer` 的 CanvasKit/Skia 渲染，用 Pixi.js v8 的 `Application`、`Container`、`Graphics`、`Sprite`、`Text` 重新实现节点绘制 |
| **ContainerManager** | 管理 ContainerNode 的生命周期、嵌套层级、继承解析（`resolveContext`）、Agent 绑定调度 |
| **DataFlowEngine** | IO 端口连线、类型兼容校验、DAG 拓扑排序、拉取式执行、Payload 缓存 |
| **WebGL Shader 集成** | Pixi.js v8 Filter Pipeline 中的自定义着色器（容器背景玻璃态、节点光晕、生成预览） |
| **Excalidraw → Engine 迁移适配器** | 将旧版 Excalidraw 元素数据转换为新引擎 PenNode 格式的一次性迁移脚本（详见第七节） |
| **容器级硬隔离层** | `canOperate()` 门控、容器级乐观锁、跨容器 `requestFromPeer()` 协商；OpenPencil 是软隔离，CC 必须重写为硬隔离 |
| **容器级操作队列** | 替代 OpenPencil 的 3-way Merge；每个容器维护独立 operation log，跨容器操作经过协商 |
| **Container 模板系统** | 把容器（含上下文与节点结构）保存为模板，跨画布实例化；P3 阶段产出 |

---

## 五、统一总架构详图（参考视图）

下面这两张图是子方案中已有、放在这里作为"局部细化视图"——主图见第二节。

### 5.1 容器嵌套与继承示例（来自方案一）

橙色箭头是上下文流，青色虚线是数据流。展示典型的容器树结构：Root Canvas 下挂两个父容器，父容器里再嵌套子画布与普通节点。

![board_GygNwKcqChPf1Tb3BD2cyZ6dnzc](./images/board_GygNwKcqChPf1Tb3BD2cyZ6dnzc_4.svg)

### 5.2 ContainerNode 数据模型示意（来自方案一）

ContainerNode 向上对接 React Flow 的节点系统，向下脱离 Excalidraw（新引擎里则成为 Pixi.js Container 树的原生节点）。

![board_KtRRwavCBh2xRKbbwE9ckhnXnub](./images/board_KtRRwavCBh2xRKbbwE9ckhnXnub_4.svg)

### 5.3 OpenPencil → CucumberCanvas 架构映射（来自方案三）

左侧是 OpenPencil 的 Agent 系统组件，右侧是 CucumberCanvas 的对应映射，箭头表示复用关系。

![board_VWG1wYfCqhQuMlbxPjKcLoH9npg](./images/board_VWG1wYfCqhQuMlbxPjKcLoH9npg_4.svg)

---

## 六、统一分阶段实施路径

下面把三份子方案的 P0–P3 合并对齐成**单一时间线**——总周期 **13–14 周**。每个阶段的目标、要做什么、替换什么、保留什么、验收标准都已合并去重。

> **[FIRST_PLACE_MEDAL]**
> **P0 — 引擎骨架 + 容器 MVP（3 周）**
> 让新引擎在画布上"跑起来"，同时容器作为视觉单元已经可见。

**做什么：**

1. **移植 pen-engine 核心**：Fork `DesignEngine`、`DocumentManager`、`HistoryManager`、`SelectionManager`、`ViewportController`、`SpatialIndex`、`TypedEventEmitter`

2. **实现 PixiRenderer 基础版**：
	- 初始化 Pixi.js v8 `Application`，挂载到 Canvas DOM（占据原 Excalidraw 位置）
	- `RectangleNode` → `PIXI.Graphics`、`ImageNode` → `PIXI.Sprite`、`TextNode` → `PIXI.Text` 映射
	- Viewport 同步（Engine viewport state ↔ Pixi.js stage transform）

3. **移植 document-flattener**：适配输出为 Pixi.js DisplayObject 创建指令

4. **接入现有 React UI**：工具栏、属性面板通过 Engine API 改状态；`useEngineSubscribe` 响应引擎事件

5. **ContainerNode MVP**（最小子集）：
	- schema 仅含 `id / parentId / bounds / role / style / meta`，`role` 暂只支持 `'visual'`
	- 在 Pixi.js 中渲染为圆角矩形 + 标题栏；支持拖拽、缩放、嵌套（仅一层）
	- 右键菜单"新建容器"、双击改名、删除提示
	- 持久化：容器随画布序列化/反序列化

6. **Shadow 模式上线**：新引擎在后台加载相同数据，比对状态一致性；用户操作仍由 Excalidraw 处理（迁移脚手架）

**替换：** Excalidraw 的 `ExcalidrawElement` 系统、内置 Canvas 渲染、`AppState`。**保留：** React Flow 节点 + 连线系统、所有前端 UI 组件、CSS 样式和布局。

**验收：**

- [ ] 用户在画布任意位置框选 → 一键转为容器

- [ ] 容器可在 Pixi.js 上自由拖拽，子内容跟随移动

- [ ] 嵌套一层后保存、刷新，结构不丢

- [ ] 节点视觉与 Excalidraw 像素级对齐（Playwright 截图对比 CI 通过）

- [ ] Shadow 模式下两边状态一致性 ≥ 99.9%

> **[SECOND_PLACE_MEDAL]**
> **P1 — 容器系统完整化 + 上下文继承 + Agent 注入（3 周）**
> ContainerNode 成为引擎原生节点，支持嵌套、继承、Agent 绑定。

**做什么：**

1. **扩展 ContainerNode schema**：补全 `agentBinding`、`contextSlots`、`inheritPolicy`、`ioPorts`（端口结构定义但 P1 不接连线）

2. **实现 ContainerManager**：
	- ContainerNode CRUD（创建、删除、移动、嵌套）
	- `resolveContext()` 继承解析算法（merge / override / block）
	- 缓存失效机制（祖先变更时清除子树缓存）

3. **容器在 Pixi.js 中的完整渲染**：
	- 圆角矩形 + 标题栏 + 边框（Agent color 标记）
	- 嵌套容器使用 Pixi.js `Container` 的 parent-child 关系
	- Agent 状态指示器（idle / running / blocked）+ 呼吸动画

4. **DOM Overlay 升级**：上下文编辑面板、IO 端口可视化（容器边缘小圆点）、继承路径可视化

5. **Agent Identity + AgentBinding**：
	- 复制 OpenPencil 的颜色/名称分配逻辑
	- 增加持久化（Supabase 存储绑定关系）
	- 增加 `role` 和 `permissions` 字段

6. **Agent 调度器适配**：
	- 调起 Agent 时注入 `AgentContext`
	- **硬隔离**：所有写工具在调用前由调度器注入 `containerId` 校验，越界拒绝（permission gate）

7. **TypedEventEmitter → ContainerScopedEmitter**：每个容器持有独立 emitter；子容器事件向上冒泡

8. **灰度切换 Stage 1**：5% → 20% 用户切到新引擎渲染

**验收：**

- [ ] 在容器 A 设置"只用品牌紫"，A 内 Agent 生成图片确实只用品牌紫

- [ ] 节点移到容器 B 后效果切换

- [ ] Agent 尝试越界写入被 `canOperate()` 拒绝并报错

- [ ] 5–20% 灰度用户无明显回归

> **[THIRD_PLACE_MEDAL]**
> **P2 — 数据流 + WebGL 特效 + 多层嵌套（3–4 周）**
> 节点间显式数据流、自定义着色器集成、深层嵌套继承稳定。

**做什么：**

1. **DataFlowEngine 完整实现**：
	- IOPort 协议（input/output、dataType、schema）
	- DataFlowEdge 连线系统、UI 拖动连线时即时反馈兼容性
	- DAG 拓扑排序 + 环检测（环 → UI 高亮报错，禁止保存）
	- 拉取式（pull）执行 + Payload 缓存；上游变化才回溯重算
	- Schema 校验失败投递到目标节点 `errors` 端口（不 throw）

2. **多层嵌套支持**：≥ 3 层继承解析 + 性能优化（dirty flag 增量解析）

3. **WebGL Shader 集成**：
	- **容器背景**：玻璃态 + 渐变模糊（`GlassMorphFilter`）；Agent running 时边缘发光
	- **节点渲染**：选中 outline glow、AI 生成扫描线动画
	- **生成结果预览**：实时缩略图、色温/对比度调节、渐进加载模糊

4. **Filter 性能守则落地**：仅对焦点容器启用 shader；缩放 < 0.3 时 LOD 降级到色块；Filter 失败 fallback 纯色

5. **MCP Sync 容器级广播**：SSE 按 `containerId` 过滤；防抖：内容 1s、状态 200ms；> 2MB 文档跳过同步

6. **灰度切换 Stage 2**：50% 用户

**验收：**

- [ ] 容器 A 输出图片 → 喂给容器 B 作为参考；A 修改后 B 自动重算

- [ ] 3 层嵌套下父级规则正确传播，性能可接受（resolveContext < 1ms）

- [ ] 焦点容器启用 GlassMorph 时 FPS ≥ 50（中端笔记本）

- [ ] 50% 灰度无显著性能退化

> **[STAR]**
> **P3 — 多代理协作 + 性能优化 + 模板化（4 周）**
> 把"多 Agent 在同一画布协作"做成产品的差异化叙事。

**做什么：**

1. **Agent 位置感知 API 完整化**：`siblings`、`containerPath`、`parent`

2. **跨容器引用**：基于 `ioPort` 的"快照引用"语义；Agent 拿到的是其它容器的产物快照，不直接访问内部

3. **Task Orchestrator**：plan → subtasks → parallel execution；支持动态增减 Agent

4. **容器级隔离执行**：
	- 容器级乐观锁（先执行后验证）
	- 每个容器独立 operation log
	- 跨容器操作通过 `requestFromPeer()` 协商

5. **Container 模板与复用**：把容器（含上下文与节点结构）保存为模板，跨画布实例化

6. **大规模性能优化**：
	- 大容器树（> 200 容器）下的渲染批处理
	- 增量解析（`resolveContext` dirty flag）
	- Pixi.js culling 只渲染可见节点
	- 空间索引做视口裁剪

7. **WebGPU 渲染路径**：Pixi.js v8 的 WebGPU 后端，支持 Compute Shader（粒子、后处理）

8. **灰度切换 Stage 3**：100% 用户；下线 Excalidraw 依赖、删除旧代码；Excalidraw 包保留 30 天热备

**验收：**

- [ ] 3 个 Agent 在同一画布的不同容器并行工作，由父容器 Agent 汇总，过程在 UI 上可视化、可回放

- [ ] 200+ 容器树场景下 FPS ≥ 30

- [ ] WebGPU 后端在支持设备上自动启用

- [ ] 100% 用户切换 7 天内无重大回归

- [ ] Excalidraw 代码完全下线

---

## 七、统一迁移策略

把"Excalidraw 替换"、"数据兼容"、"视觉不变"三个互相纠缠的话题合并成一份操作指南。

### 7.1 核心原则：影子模式 + 灰度切换

> **[BULB]**
> **避免 Big-Bang 迁移**：用 Shadow → 灰度（5/20/50/100%）→ 完全切换三阶段，每阶段都有明确回滚策略。

```typescript
interface EngineSwitch {
  mode: 'excalidraw' | 'new_engine' | 'shadow';
  // shadow 模式：新引擎在后台运行，渲染仍由 Excalidraw 负责，用于验证数据一致性
}
```

### 7.2 三阶段切换计划

| 阶段 | 模式 | 做什么 | 回滚策略 |
| --- | --- | --- | --- |
| **Stage 1（P0）** | Shadow 模式 | 新引擎在后台加载相同数据，比对状态一致性；所有用户操作仍由 Excalidraw 处理，新引擎只"旁听"并记录差异 | 关闭 Feature Flag 即回退 |
| **Stage 2（P1–P2）** | 灰度切换 5/20/50% | 按用户比例切换到新引擎渲染；旧数据自动通过迁移适配器转换 | 按 UserID 粒度回退到 Excalidraw |
| **Stage 3（P3）** | 100% + 完全切换 | 下线 Excalidraw 依赖，删除旧代码，新引擎全量服务 | 保留 Excalidraw 包 30 天作为热备 |

### 7.3 旧数据兼容：Excalidraw → PenNode 映射

| Excalidraw Element | PenNode Type | 转换规则 |
| --- | --- | --- |
| `rectangle` | `rectangle` | x/y/width/height 直接映射；fill → PenFill[]；stroke → PenStroke |
| `ellipse` | `ellipse` | center 坐标转 x/y（左上角）；rx/ry → width/height |
| `line` / `arrow` | `line` / `path` | points 数组 → PenNode path data；arrow markers → PenStroke.startArrow/endArrow |
| `text` | `text` | content/fontSize/fontFamily 直接映射；textAlign → PenNode textAlign |
| `image` | `image` | fileId → CDN URL 解析；bounds 直接映射 |
| `frame` | `frame` / `container` | 有 ContainerNode 元数据则升级为 container；否则保持为普通 frame |
| `freedraw` | `path` | 手绘路径点 → SVG path d 字符串 |

```typescript
// packages/canvas/src/migration/excalidraw-to-pen.ts
export function migrateExcalidrawScene(
  elements: ExcalidrawElement[],
  appState: ExcalidrawAppState
): PenDocument {
  const nodes: PenNode[] = elements.map(el => convertElement(el));
  const containers: ContainerNode[] = extractContainers(elements, appState);
  return {
    version: '1.0.0',
    children: nodes,
    containers,
    variables: {},
  };
}
```

### 7.4 数据版本管理

- 新格式文件扩展名：`.cucumber`（JSON）

- 旧格式文件（`.excalidraw`）首次打开时自动触发迁移

- 迁移后保留原始文件作为备份（`_backup.excalidraw`）

- 序列化格式包含 `schemaVersion` 字段，便于未来增量升级

### 7.5 视觉不变的工程清单

> **[THOUGHT_BALLOON]**
> **目标**：用户切换前后**像素级对齐**，无感知。

- **DOM 占位一致**：Pixi.js Canvas 替换 Excalidraw Canvas，占据相同 DOM 位置和尺寸

- **z-index 与 pointer-events**：UI 叠加层（DOM Overlay、React Flow Overlay）规则不变

- **节点外观复刻**：通过 `PIXI.Graphics` 精确复刻 Excalidraw 的圆角、填充色、描边

- **Playwright 视觉回归 CI**：在每次 PR 上跑截图对比测试，差异 > 阈值则阻断合并

- **回退入口**：每个用户在设置里有"回退到旧版引擎"开关（P3 之前保留）

---

## 八、风险与对策

把三份方案的风险表合并去重，按"工程风险 / 数据风险 / 性能风险 / 协作风险"分组。

| 风险 | 描述 | 对策 |
| --- | --- | --- |
| **Pixi.js v8 稳定性** | v8 为最新大版本，API 可能有 breaking change 或未知 bug | 锁定具体版本号（如 `8.x.y`）；关键功能写集成测试；建立 Pixi.js 升级 SOP |
| **OpenPencil 移植适配** | pen-engine 内部假设 CanvasKit 渲染，某些 API 可能隐式依赖 Skia | P0 阶段逐文件 review，抽象 Renderer Interface；标记所有 Skia 特有调用并替换 |
| **迁移数据丢失** | Excalidraw 的 freedraw、特殊 group 在转换时可能丢失精度 | 迁移脚本写详尽的单元测试；保留原始文件备份；提供"回退到旧版"入口 |
| **前端视觉回归** | 新引擎的节点渲染可能与旧版存在像素级差异 | Playwright 截图对比 CI；每次 PR 阻断合并；像素差异阈值 < 0.5% |
| **继承解析性能** | 大量嵌套 + 频繁修改时，`resolveContext` 重算成本高 | 基于 `parentId` 的子树级缓存失效；P3 阶段加入增量解析（dirty flag） |
| **容器树性能** | > 200 个容器时继承解析和重绘开销大 > | 空间索引做视口裁剪；Pixi.js culling 只渲染可见节点；增量解析 |
| **数据流死循环** | 节点之间形成环，导致执行死循环 | DataFlowEngine `topoSort` 时检测环，UI 高亮报错；不允许保存包含环的画布 |
| **Agent 越权写入** | Agent 通过工具调用绕过容器 bounds 修改其它容器节点 | 所有写工具在调用前由调度器注入 `containerId` 校验；P1 起就引入 permission gate（硬隔离） |
| **WebGL 兼容性** | 低端设备或 Safari 对 WebGL 2 / WebGPU 支持不完善 | Pixi.js v8 自动降级到 WebGL 1；Filter 失败 fallback 纯色；提供"轻量模式" |
| **导出兼容** | 新引擎输出 SVG/PNG 与旧版视觉不一致 | P2 做导出器专项；提供"仅底层" / "包含容器结构"两种模式 |
| **多 Agent 协作冲突** | OpenPencil 的 3-way Merge 不适合实时多 Agent；CC 自研容器级乐观锁可能有边界 case | P3 阶段先做窄场景灰度；操作日志做幂等性设计；提供"撤销并重做"兜底 |

---

## 九、下一步行动

> **[STAR]**
> **P0 启动清单（建议本周内完成）**
> 1. **Repo 准备**：在 `packages/canvas` 下建立 monorepo 子包（`@cucumber/engine`、`@cucumber/renderer`、`@cucumber/container`、`@cucumber/migration`）
> 2. **OpenPencil 拷贝任务**：按第四节"可直接复制"清单，建 issue 把 11 个模块逐个搬到新 repo
> 3. **数据契约落地**：把第三节的 TypeScript 接口落到 `@cucumber/types`，作为所有后续模块的依赖
> 4. **Pixi.js v8 脚手架**：初始化 `Application`，挂到 Canvas DOM；先把 `RectangleNode` → `PIXI.Graphics` 跑通
> 5. **Shadow 模式开关**：在现有 Excalidraw 渲染旁开一个 Feature Flag，注入新引擎 store 做状态比对
> 6. **Playwright 视觉回归 CI**：建立基线截图，作为后续每次 PR 的合并门禁
> 7. **Demo 场景准备**：产品侧准备"品牌色容器 → 生成 Hero 图"作为 P1 验收的核心叙事场景
> **Issue 拆分建议**：每个模块的搬运 / 改造 / 新建分别拆为独立 issue（颗粒度 ≈ 1–2 工程师日），按依赖关系排序，第一周聚焦 ContainerNode schema + Pixi.js scaffolding。

> 这套架构最有价值的地方在于：**Headless Engine 完全不绑定渲染实现**。13–14 周做完一次大改造之后，未来无论是切换到 WebGPU 原生渲染、接入 3D 场景、还是支持服务端渲染（SSR 缩略图），都只需要实现新的 Renderer 适配层，引擎核心和容器系统逻辑完全不动。一次性投入，长期吃利息。
>
