## 一、背景与目标

CucumberCanvas 当前以 **React Flow + Excalidraw** 双层结构为画布基础：React Flow 负责"图节点 + 连线"的逻辑层，Excalidraw 负责"自由手绘 + 矢量图形"的视觉层。这套组合解决了"画图"的问题，但还没有解决"画布即设计系统"的问题——画布只是一块平面，缺少能够承载结构、任务、上下文、数据流的"容器"概念。

本方案的目标，是把画布升级为 AI 设计系统的一部分，让 **容器（Container）**成为画布的一等公民，同时担当四种角色：

<callout icon="bulb" bgc="5" bc="5">
**容器的四重身份**
1. **视觉组织单元**：让用户像在 Figma 里用 Frame / Section 一样组织画布结构。
2. **任务分配单元**：不同 Agent 在不同容器里独立工作，互不干扰。
3. **上下文单元**：风格、规则、约束沿父子层级单向继承，子容器自动获得父容器的设计上下文。
4. **数据流单元**：节点的 `output` 通过 `ioPorts` 流向另一个节点的 `input`，形成显式数据管道。
</callout>

完成这套架构后，"设计空间结构""执行区域隔离""多代理协作位置感知"将成为 zz 在产品里可以直接感知和讲清楚的能力，而不是隐藏在工程实现里的抽象。

---

## 二、核心架构总览

整个系统围绕一个核心数据结构 `ContainerNode` 展开。它向上对接 React Flow 的节点系统，向下脱离 Excalidraw 的元素系统，独立由 React 组件渲染为叠加层（Overlay）。

![board_H1SNwRncMhMGJhbyuyTcLsU9nHg](images/board_H1SNwRncMhMGJhbyuyTcLsU9nHg_2.svg)

### 2.1 ContainerNode 数据模型

`ContainerNode` 是一个被显式建模的图节点，不依赖 Excalidraw 元素，可以独立持久化、独立调度、独立渲染。

```typescript
// packages/canvas/src/container/types.ts
export type ContainerRole = 'visual' | 'task' | 'context' | 'dataflow';
export type InheritPolicy = 'merge' | 'override' | 'block';

export interface ContainerBounds {
  x: number;        // 画布坐标系（与 Excalidraw scene coords 对齐）
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
  agentId?: string;                       // 绑定的 Agent 实例 ID
  agentType?: 'designer' | 'critic' | 'composer' | string;
  status?: 'idle' | 'thinking' | 'running' | 'blocked' | 'done';
  permissions?: ('read' | 'write' | 'spawn')[]; // 容器内的权限
}

export interface ContainerNode {
  id: string;
  parentId: string | null;                // 嵌套的父容器；null 表示根画布直接子节点
  role: ContainerRole[];                  // 一个容器可以同时是多种角色
  bounds: ContainerBounds;
  contextSlots: ContextSlots;             // 本容器自身定义的上下文
  inheritPolicy: InheritPolicy;           // 继承策略：merge | override | block
  ioPorts: IOPort[];                      // 该容器对外暴露的 IO 端口
  agentBinding?: AgentBinding;            // 任务/Agent 绑定信息
  style?: { fill?: string; stroke?: string; opacity?: number; label?: string };
  meta?: Record<string, unknown>;         // 扩展字段，例如 templateId、createdBy
}
```

<callout icon="speech_balloon" bgc="3" bc="3">
**关键设计点**
- `role` 是数组而非枚举：一个容器在产品中天然可以"既是视觉分组，也是任务区域"，无需建两套数据。
- `parentId` 而不是 `children[]`：单向引用更易增删，重排时无需双向同步。
- `contextSlots` 只存"本容器贡献的上下文"，**不存储继承后的最终值**——最终值在运行时由继承解析器算出，避免数据冗余和漂移。
- `ioPorts` 是显式数组：端口数量可变，每个端口都有自己的类型和 Schema。
</callout>

### 2.2 四种角色的实现方式

四种角色不是四种不同的容器类型，而是**同一个&nbsp;ContainerNode&nbsp;在不同子系统中的"投影"**。容器是否具备某种角色，由它的 `role` 数组决定。

<table header-row="true" col-widths="120,200,260,260">
    <tr>
        <td>角色</td>
        <td>数据字段</td>
        <td>实现方式</td>
        <td>用户感知</td>
    </tr>
    <tr>
        <td>**视觉组织单元** `visual`</td>
        <td>`bounds`、`style`、`label`</td>
        <td>由 Container Overlay 层渲染圆角矩形 + 标题栏；支持拖拽、缩放、嵌套；命中检测使用 `bounds`，不进入 Excalidraw 元素树。</td>
        <td>"我可以像 Figma Frame 一样组织画布"</td>
    </tr>
    <tr>
        <td>**任务分配单元** `task`</td>
        <td>`agentBinding`、`bounds`</td>
        <td>每个 task 容器对应一个 Agent Sandbox：Agent 只能读写自己 `bounds` 内的节点；调度器通过 `agentBinding.agentId` 路由消息和工具调用。</td>
        <td>"不同 Agent 在不同容器里干活，不会互相打架"</td>
    </tr>
    <tr>
        <td>**上下文单元** `context`</td>
        <td>`contextSlots`、`inheritPolicy`、`parentId`</td>
        <td>运行时维护一棵 Context Tree；查询某节点的 effective context 时，沿 `parentId` 向上遍历，根据每层的 `inheritPolicy` 做 merge / override / block。</td>
        <td>"在这个容器里，所有生成都自动遵守品牌色"</td>
    </tr>
    <tr>
        <td>**数据流单元** `dataflow`</td>
        <td>`ioPorts`、节点间的边</td>
        <td>`ioPorts` 渲染为容器边缘的小圆点；连线由 React Flow 的 Edge 系统承载；运行时由 DataFlow Engine 按拓扑顺序传递 payload。</td>
        <td>"一个节点的产物可以直接喂给下一个节点"</td>
    </tr>
</table>

> 容器同时具备多种角色时，它们彼此正交：一个容器可以既是 `visual + task + context`（Agent 工作区），也可以只是 `visual`（纯分组）。
> 

---

## 三、与 Excalidraw 的兼容方案

这是整个架构里最关键、也最容易踩坑的一道分叉。下面把三种方案放在同一张桌子上对比：

<table header-row="true" col-widths="160,260,220,220">
    <tr>
        <td>方案</td>
        <td>做法</td>
        <td>优点</td>
        <td>缺点</td>
    </tr>
    <tr>
        <td>**A. 真实 Excalidraw 元素**</td>
        <td>用 Excalidraw 的 `rectangle` / `frame` 类型存容器，复用其元素系统、序列化和操作历史。</td>
        <td>免费拿到撤销/重做、协同、SVG 导出、缩放交互；视觉风格与画布一致。</td>
        <td>Excalidraw 元素 schema 不可扩展（无法塞 `agentBinding` / `ioPorts`）；其 frame 是单层的，不支持深层嵌套语义；事件系统封闭，难以挂自定义交互；数据耦合后期想脱离非常痛。</td>
    </tr>
    <tr>
        <td>**B. Overlay 叠加层（推荐）**</td>
        <td>容器完全独立于 Excalidraw，由 React Flow 节点 + 自定义 React 组件渲染在 Excalidraw canvas 之上；坐标系与 Excalidraw scene coords 对齐。</td>
        <td>数据模型完全自由；交互层可插拔；保留 Excalidraw 的"画图"能力作为下层；后期切换底层引擎成本最低。</td>
        <td>需要自己处理坐标同步、缩放/平移联动；命中检测要小心，避免与 Excalidraw 元素事件冲突；导出 SVG/PNG 需要合并两层。</td>
    </tr>
    <tr>
        <td>**C. 完全脱离 Excalidraw**</td>
        <td>用 React Flow + 自研 Drawing Layer（或换 Konva / tldraw）替换 Excalidraw。</td>
        <td>架构最干净；上下文/数据流模型不会被任何外部引擎反向约束。</td>
        <td>沉没成本巨大：手绘体验、形状库、协同、性能调优需要重做；产品发布周期会被显著拉长。</td>
    </tr>
</table>

<callout icon="star" bgc="4" bc="4">
**推荐方案：B. Overlay 叠加层**
理由：
1. **数据自由度**：容器是 AI 设计系统的核心抽象，必须拥有独立、可演进的 schema；任何依赖 Excalidraw 元素 schema 的方案都会在 P2 阶段（数据流 + 嵌套）撞墙。
2. **交互可控**：四种角色里有三种（task / context / dataflow）都需要自定义交互（Agent 状态指示、上下文气泡、IO 端口连线），Excalidraw 元素系统无法承载。
3. **演进成本最低**：未来如果要切到 tldraw 或自研画布，只需要替换"下层渲染引擎"，容器层逻辑不动。
4. **保留长板**：Excalidraw 继续负责其擅长的部分（手绘、矢量编辑、白板气质），容器只是叠加在它之上。
</callout>

### 3.1 Overlay 方案的工程要点

```
┌─────────────────────────────────────────────────────┐
│  React Flow (Overlay)                               │
│  └── Container Layer (自定义 React 组件)             │
│      ├── 监听 Excalidraw appState (zoom, scrollX/Y) │
│      └── 自身坐标系 = Excalidraw scene coords        │
├─────────────────────────────────────────────────────┤
│  Excalidraw Canvas (底层)                            │
│  └── 手绘 / 矢量 / 文字 / 自由形状                    │
└─────────────────────────────────────────────────────┘
```

- **坐标同步**：订阅 Excalidraw 的 `onChange(appState)`，把 `zoom`、`scrollX`、`scrollY` 同步给 React Flow 的 Viewport，保证拖拽 Excalidraw 时容器跟随移动。

- **事件冲突**：Container Layer 默认 `pointer-events: none`，仅在容器边框/标题栏/IO 端口上启用 `pointer-events: auto`，确保 Excalidraw 中间区域的手绘不被吞掉。

- **命中检测**：使用容器 `bounds` 做点击 / 拖拽判定，与 Excalidraw 元素的命中检测分通道，互不影响。

- **导出兼容**：Export 时先抓 Excalidraw 的 SVG，再叠加 React Flow + Container 的 SVG，输出合并文件。

---

## 四、上下文继承机制

### 4.1 嵌套结构与继承示例

下图展示了一棵典型的容器树：Root Canvas 下挂两个父容器，父容器里再嵌套子画布与普通节点。橙色箭头是上下文流，青色虚线是数据流。

![board_FJllwE6odhPGsybHo3scI64EnJc](images/board_FJllwE6odhPGsybHo3scI64EnJc_2.svg)

### 4.2 三种继承策略

每个容器在自身 `inheritPolicy` 上声明它如何对待父容器传下来的上下文：

<table header-row="true" col-widths="140,260,300">
    <tr>
        <td>策略</td>
        <td>语义</td>
        <td>典型场景</td>
    </tr>
    <tr>
        <td>`merge`（默认）</td>
        <td>合并父级 slot 与本地 slot；同 key 时本地覆盖父级。</td>
        <td>子画布想"继承品牌色 + 局部加几条规则"，最常见。</td>
    </tr>
    <tr>
        <td>`override`</td>
        <td>整段替换父级对应 slot，不再继承。</td>
        <td>Hero Section 想用一套和 Brand 完全不同的 token（例如海报级排版），父级排版规则不应渗透。</td>
    </tr>
    <tr>
        <td>`block`</td>
        <td>显式阻断该 slot 的继承，本容器及其子容器都不会再收到。</td>
        <td>临时实验区不希望被全局规则约束，例如"创意发散容器"刻意 block 掉所有 constraints。</td>
    </tr>
</table>

### 4.3 继承解析算法

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
        // 清空本节点后续将注入的 slot；等价于从这里"截断"
        acc = filterOutBlockedSlots(acc, node.contextSlots);
        break;
      case 'override':
        acc = { ...acc, ...node.contextSlots }; // 整段替换
        break;
      case 'merge':
      default:
        acc = mergeSlots(acc, node.contextSlots); // 深合并
        break;
    }
  }
  return acc;
}
```

<callout icon="bulb" bgc="3" bc="3">
**几条务实的工程纪律**
- **解析结果可缓存但要可失效**：把 `resolveContext(containerId)` 用 memoization 缓存；任一祖先 `contextSlots` / `inheritPolicy` / `parentId` 变化时清掉对应子树缓存。
- **运行时只读**：节点拿到的是解析后的"快照"，不能反向写入；想修改上下文必须修改某个具体容器的 `contextSlots`。
- **写时显式声明归属**：所有上下文写入必须明确写到哪个 `containerId`，避免出现"全局上下文池"这种隐藏耦合。
</callout>

---

## 五、数据流机制

### 5.1 ioPort 协议设计

每个节点（无论是容器还是普通节点）都可以暴露若干 `ioPorts`。一条边连接两个端口：源端 `direction === 'output'`，目标端 `direction === 'input'`，且 `dataType` 必须可兼容。

```typescript
// packages/canvas/src/dataflow/types.ts
export interface DataFlowEdge {
  id: string;
  source: { nodeId: string; portId: string };
  target: { nodeId: string; portId: string };
  // 可选：在边上做轻量变换（例如裁剪、降采样）
  transform?: { type: string; params?: unknown };
}

export type PortPayload =
  | { type: 'image'; url: string; width?: number; height?: number; mime?: string }
  | { type: 'text'; content: string }
  | { type: 'json'; value: unknown; schema?: string }
  | { type: 'reference'; refType: 'image' | 'text' | 'node'; ref: string }
  | { type: 'prompt'; template: string; vars?: Record<string, unknown> };
```

**类型兼容规则（保守版）：**

- `output:image` → `input:image | input:reference`（图像可以作为引用）

- `output:text` → `input:text | input:prompt`（文本可注入到 prompt 模板）

- `output:json` → `input:json`（必须 schema 兼容）

- 其他组合默认 reject，UI 上拖动连线时即时反馈"不兼容"。

### 5.2 执行模型

```typescript
// packages/canvas/src/dataflow/engine.ts
export interface DataFlowEngine {
  // 注册节点的执行函数
  register(nodeId: string, executor: NodeExecutor): void;
  // 触发某节点的执行：先收集上游 inputs，再执行，再把 outputs 推给下游
  run(nodeId: string, ctx: ResolvedContext): Promise<void>;
  // 推断执行顺序：DAG 拓扑排序，环 → 报错
  topoSort(rootId: string): string[];
}

export type NodeExecutor = (
  inputs: Record<string /*portId*/, PortPayload>,
  ctx: ResolvedContext,        // 来自 resolveContext()
  emit: (portId: string, payload: PortPayload) => void
) => Promise<void>;
```

<callout icon="speech_balloon" bgc="5" bc="5">
**执行特性**
- **拉取式（pull）+ 缓存**：下游节点要执行时拉取上游缓存的最近一次输出；上游 `contextSlots` 或 inputs 变化才会重新执行。
- **跨容器允许**：数据流连线可以跨越容器边界（参见上图青色虚线），不受继承策略影响——容器只决定"上下文怎么走"，不决定"数据能不能流过去"。
- **Schema 校验**：每次 emit 都按目标端口 schema 做轻量校验，校验失败把错误投递到目标节点的 `errors` 端口（而不是 throw）。
</callout>

---

## 六、Agent 空间感知

让 Agent 知道"我在哪个容器、容器里有什么、上下文是什么"，是多代理协作的前提。

### 6.1 AgentContext 注入接口

调度器在调起 Agent 时构造一份 `AgentContext` 注入到提示词或工具调用上下文里：

```typescript
// packages/agent/src/context.ts
export interface AgentContext {
  agentId: string;
  containerId: string;
  containerPath: string[];          // 从 root 到当前容器的 id 链路
  effectiveContext: ContextSlots;   // resolveContext(containerId) 的结果
  visibleNodes: NodeSummary[];      // 容器 bounds 内的节点摘要
  ioPorts: IOPort[];                // 当前容器对外的 IO 端口
  permissions: ('read' | 'write' | 'spawn')[];
  siblings: { containerId: string; agentId?: string; status?: string }[];
}
```

### 6.2 Agent 能做与不能做

<table header-row="true" col-widths="160,260,260">
    <tr>
        <td>能力</td>
        <td>允许</td>
        <td>禁止 / 受限</td>
    </tr>
    <tr>
        <td>读取节点</td>
        <td>读 `containerId` 内（含子容器）的所有节点</td>
        <td>不能直接读其它兄弟容器内的节点；如需引用必须通过 `ioPort` 显式连边</td>
    </tr>
    <tr>
        <td>写入 / 创建节点</td>
        <td>在 `containerId` 内创建、修改、删除节点</td>
        <td>不能跨越 `bounds` 写入</td>
    </tr>
    <tr>
        <td>spawn 子 Agent</td>
        <td>当 `permissions` 包含 `spawn`，可在子容器中创建并绑定新 Agent</td>
        <td>不能修改父容器的 `agentBinding`</td>
    </tr>
    <tr>
        <td>读取上下文</td>
        <td>读取 `effectiveContext`（已解析）</td>
        <td>不能直接读取祖先容器的原始 `contextSlots`，避免越权</td>
    </tr>
</table>

### 6.3 协作模式

- **同级并行**：同一父容器下的多个子容器，各自的 Agent 并行工作，互不干扰，最后通过 `ioPorts` 汇总。

- **父子串行**：父容器 Agent（例如 `composer`）等子容器 Agent 输出后，做组合 / 评审。

- **跨容器引用**：通过 `ioPort` 显式连线，Agent 在自己的容器内拿到来自其它容器的"产物快照"，无需直接访问对方内部。

---

## 七、分阶段实施路径

### 7.1 路线图总览

![board_TFUQwTYxUhOR84bjf53cSVfPnpg](images/board_TFUQwTYxUhOR84bjf53cSVfPnpg_2.svg)

### 7.2 P0：MVP（立刻启动，建议 2-3 周）

**目标：让"容器"在产品里跑起来——可见、可拖拽、可嵌套，但还没有 Agent / 上下文 / 数据流。**

P0 核心交付物：

- **数据模型基线**：`ContainerNode` schema（仅 `id / parentId / bounds / role / style / meta`）已落库；`role` 暂只支持 `'visual'`。

- **Container Overlay 层**：基于 React Flow 节点 + 自定义 React 组件渲染容器；坐标系与 Excalidraw scene coords 对齐；支持拖拽、缩放、嵌套（仅一层）。

- **持久化**：容器随画布序列化/反序列化；与现有 Excalidraw 数据互不冲突。

- **基础交互**：右键菜单"新建容器"、双击标题栏改名、删除时给提示。

**P0 不做：** `agentBinding`、`contextSlots`、`ioPorts`、跨层嵌套继承、数据流。

P0 验收标准：

1. 用户在画布任意位置框选 → 一键转为容器。

2. 容器可在 Excalidraw 上自由拖拽，下层手绘内容跟随移动。

3. 嵌套一层后保存、刷新，结构不丢。

4. 容器与 Excalidraw 元素的事件互不抢占。

### 7.3 P1：任务/上下文容器（约 3 周）

**目标：让 Agent 能"住进"某个容器，并感知容器的上下文。**

- 扩展 `ContainerNode` 增加 `agentBinding` 和 `contextSlots`、`inheritPolicy`。

- 实现 `resolveContext(containerId)` 与缓存失效机制。

- 改造 Agent 调度器：调起 Agent 时注入 `AgentContext`。

- UI 层增加 Agent 状态指示（idle / running / blocked）和上下文编辑面板。

P1 验收：在容器 A 里设置"只用品牌紫"，A 中的 Agent 生成的图片确实只用品牌紫；移到容器 B 后效果切换。

### 7.4 P2：数据流 + 嵌套（约 3-4 周）

**目标：节点间能显式传数据，子容器能从父容器继承上下文。**

- `ContainerNode.ioPorts` 与 `DataFlowEdge` 上线。

- Schema 驱动的端口兼容性校验。

- DataFlow Engine：拓扑排序、拉取式执行、payload 缓存。

- 多层嵌套的继承解析（≥ 3 层）+ `merge / override / block` 完整语义。

P2 验收：A 容器输出图片 → 喂给 B 容器作为参考；A 修改后 B 自动重算；3 层嵌套下父级规则正确传播。

### 7.5 P3：多代理协作 + 高级能力（约 4 周）

**目标：让"多 Agent 在同一画布协作"成为产品的差异化叙事。**

- Agent 位置感知 API（`siblings`、`containerPath`）。

- 跨容器引用：基于 `ioPort` 的"快照引用"语义。

- Container 模板与复用：把一个容器（含其上下文与节点结构）保存为模板，跨画布实例化。

- 性能优化：大容器树（>200 容器）下的渲染与解析缓存策略。

P3 验收：3 个 Agent 在同一画布的不同容器中并行工作，最后由父容器 Agent 汇总产出，整个过程在 UI 上可视化、可回放。

---

## 八、风险与对策

<table header-row="true" col-widths="220,300,260">
    <tr>
        <td>风险</td>
        <td>描述</td>
        <td>对策</td>
    </tr>
    <tr>
        <td>**坐标系漂移**</td>
        <td>Excalidraw 与 React Flow Overlay 的坐标 / 缩放不同步，容器和手绘内容错位。</td>
        <td>P0 阶段就把 viewport 同步层抽成独立模块；写 e2e 用例覆盖 zoom / pan / 触控板手势。</td>
    </tr>
    <tr>
        <td>**继承解析性能**</td>
        <td>大量嵌套 + 频繁修改时，`resolveContext` 重算成本高。</td>
        <td>使用基于 `parentId` 的子树级缓存失效；P3 阶段加入增量解析。</td>
    </tr>
    <tr>
        <td>**数据流死循环**</td>
        <td>节点之间形成环，导致执行死循环。</td>
        <td>DataFlow Engine 在 `topoSort` 时检测环，UI 上明确报错并高亮环路；不允许保存包含环的画布。</td>
    </tr>
    <tr>
        <td>**Agent 越权写入**</td>
        <td>Agent 通过工具调用绕过容器 bounds 修改其它容器的节点。</td>
        <td>所有写工具在调用前由调度器注入 `containerId` 校验；P1 起就引入 permission gate。</td>
    </tr>
    <tr>
        <td>**导出兼容**</td>
        <td>合并 Excalidraw + Container 两层 SVG/PNG 后，视觉效果不一致。</td>
        <td>P2 阶段做导出器专项；提供"仅导出底层" / "包含容器结构" 两种模式。</td>
    </tr>
</table>

---

## 九、结语

**本方案的核心判断**：把"容器"建模成一等公民，并通过 Overlay 叠加层的方式与 Excalidraw 解耦，是把 CucumberCanvas 从"AI 画板工具"升级为"AI 设计系统"的关键一步。

P0 的工程量受控（约 2-3 周），但产品意义巨大——一旦容器系统跑起来，后续的多 Agent 协作、上下文继承、数据流编排都将是"在已有框架上加肉"，而不是"重写架构"。

> 建议下一步：基于本文档启动 P0 的工程拆解（issues 拆细到工程师粒度），同步在产品侧准备 1-2 个核心使用场景的可视化 Demo（"品牌色容器 → 生成 Hero 图"是首选示范），用真实场景驱动 schema 与交互的最后打磨。
>
