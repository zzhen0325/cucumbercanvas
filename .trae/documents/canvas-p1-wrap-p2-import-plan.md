# Canvas P1 收尾与 P2 导入计划

## Summary

- 本轮范围确定为 `P1 收尾 + P2 启动`，交付标准按生产可用执行。
- P1 收尾聚焦把当前已存在但不完整的编辑能力补齐为稳定工作流：图层真实管理、快捷键拆分、复制粘贴质量、完整变换与属性编辑整理。
- P2 首波主线聚焦 `系统粘贴优先` 的 `Figma/SVG 可编辑导入`，优先打通浏览器剪贴板到 `CucumberCanvasDocument` 的可编辑节点落盘链路。
- 总体策略不是直接把 `openpencil/` 大块搬入 `apps/web`，而是优先复用其 `解析/交互模式/分层职责`，把文档模型适配到现有 `@cucumber/canvas-core`。

## Current State Analysis

### 已有底座

- `apps/web/src/components/canvas/canvas-surface.tsx`
  - 已具备多选、框选、撤销/重做、删除、复制/粘贴/重复、组合/取消组合、8 向 resize、旋转、对齐、网格吸附、基础属性面板、图形插入、图层锁定/显隐/前后移动快捷入口。
  - 当前渲染顺序已走 `getOrderedCanvasNodes(doc)`，不是简单的 `Object.values(doc.nodes)`；`Object.values` 只还出现在导出 SVG 的辅助逻辑。
- `packages/canvas-core/src/operations.ts`
  - 已支持 `reorderNode`、`groupNodes`、`ungroupNode`、`alignNodes` 等文档级能力。
- `packages/canvas-core/src/clipboard.ts`
  - 已支持递归复制/粘贴/重复，且容器 `childrenOrder` 会在 clone 过程中重建，和“复制容器会清空 childrenOrder”的旧问题相比，当前实现已基本修正。
- `packages/canvas-core/src/history.ts`
  - 已有独立历史栈，`CanvasSurface` 已接入 `CanvasHistoryManager`，说明“历史栈完全未接入”已不成立，剩余问题更偏向快捷键、批处理粒度和 UI 一致性。
- `packages/canvas-core/src/types.ts`
  - 已有 `ellipse`、`polygon`、`path`、`icon`、`group` 类型，P1 图形类型缺口主要在工具体验、属性编辑和导入映射，不是 schema 空白。

### 现存缺口

- `apps/web/src/components/canvas-layers-panel.tsx`
  - 仍是扁平列表，只支持单击选择、锁定/显隐/前后移动。
  - 缺少层级树、折叠展开、重命名、拖拽排序、右键菜单、多选联动。
- `apps/web/src/components/canvas/canvas-surface.tsx`
  - 键盘逻辑全部内聚在一个 `useEffect`，继续扩展会进一步膨胀。
  - `firstSelectedContainerId()`、若干面板入口和粘贴落点逻辑仍以 `doc.selection?.[0]` 为锚点，说明多选态虽然可用，但很多高级操作仍是“单主节点思维”。
  - `CanvasPropertyPanel` 虽存在，但仍是轻量内联实现，缺少分区结构、图片适配/裁剪、效果等更完整的 P1 面板体验。
  - 导入侧只有图片文件导入，没有 SVG/Figma 可编辑导入入口，也没有系统剪贴板解析。
- `apps/web/src/components/canvas-logo-menu.tsx`
  - 只暴露 duplicate/import image 等少量入口，未承载可编辑导入、剪切、粘贴相关菜单动作。
- `apps/web/src/app/canvas/page.tsx`
  - 已有 `CanvasLayersPanel` 与 `CanvasApi` 挂接点，适合作为导入反馈、菜单状态、未来组件/代码导出入口的页面级承载层。
- 自动化覆盖
  - 当前 web 侧几乎没有针对 `CanvasSurface` P1 能力的组件测试。
  - `packages/canvas-core/src/__tests__/canvas-core.test.ts` 已覆盖部分核心文档操作，可继续补齐导入归一化与 z-order 规则测试。
  - 仓库已经准备了 `playwright-p2.config.ts`，适合新增 `e2e/p2` 场景验证编辑链路。

### 可直接复用的 OpenPencil 参考

- `openpencil/apps/web/src/hooks/use-edit-shortcuts.ts`
  - 可参考其把编辑快捷键按职责拆分的方式，避免 `CanvasSurface` 内继续堆条件分支。
- `openpencil/apps/web/src/hooks/use-clipboard-shortcuts.ts`
  - 已有“内部剪贴板为空时，退回系统剪贴板读取 Figma”的模式，可直接借鉴到 Cucumber 的粘贴入口。
- `openpencil/apps/web/src/hooks/use-figma-paste.ts`
  - 已有 Figma HTML 识别、解码、viewport 居中、批量入栈到历史的一整套交互模式。
- `openpencil/packages/pen-engine/src/core/svg-parser.ts`
  - 已有浏览器/Node 双路径 SVG 解析器，可作为 `SVG -> 可编辑节点` 的主参考实现。
- `openpencil/packages/pen-figma/src/figma-clipboard.ts`
  - 已有 Figma 剪贴板 HTML/二进制 buffer 解码能力，可作为 `Figma clipboard -> 中间节点树` 的主参考实现。
- `openpencil/packages/pen-engine/src/core/variable-manager.ts`
  - 后续 P2 变量/token 可以参考其“文档变量 + 引用替换 + 主题”的职责拆分。
- `openpencil/packages/pen-types/src/codegen.ts`
  - 后续 Design-as-Code 可参考其 `chunk/contract/assembly` 输出协议建模。

## Proposed Changes

### Wave 1: 稳定 P1 编辑骨架

#### `apps/web/src/components/canvas/canvas-surface.tsx`

- 目标
  - 将当前超大文件内的“快捷键、选择拖拽、变换、导入”逻辑继续模块化，避免后续 P2 功能继续堆在单文件中。
- 变更
  - 抽出 `useCanvasKeyboardShortcuts`、`useCanvasClipboardImport`、`canvas-selection-helpers` 等邻近模块。
  - 保留 `CanvasSurface` 作为总装配层，只负责 `doc/api/render/panel wiring`。
  - 把 `doc.selection?.[0]` 锚点逻辑集中封装成显式 helper，例如：
    - “单主选中节点”
    - “首个可承载容器”
    - “多选锚点”
  - 对 move/resize/rotate/clipboard/import 加结构化日志，便于后续排查导入和层级联动。
- 原因
  - 当前文件已接近大型单体；P2 再加系统粘贴和导入解析后，维护成本会显著上升。

#### `apps/web/src/components/canvas-layers-panel.tsx`

- 目标
  - 把现有图层面板从“只读列表 + 几个按钮”升级为真实图层管理入口。
- 变更
  - 基于 `getOrderedCanvasNodes()` 与父子关系生成树形视图，而不是简单 `reverse()`。
  - 支持折叠/展开容器与 group。
  - 支持双击或内联重命名 `title`。
  - 增加拖拽排序，拖拽结果统一走 `canvasApi.reorderNode()` 或新增批量排序入口。
  - 增加右键菜单，至少包含：
    - 重命名
    - 锁定/解锁
    - 显示/隐藏
    - 置顶/置底/前移/后移
    - 复制/删除
    - 组合/取消组合（按当前选区可用性启用）
  - 多选时允许在图层面板中保留现有选区，不强制退化成单选。
- 原因
  - 当前图层面板是 P1 体验短板；也是 P2 导入后管理复杂节点树的必要前提。

#### `packages/canvas-core/src/operations.ts`

- 目标
  - 让层级顺序与树形排序规则可预测，并为图层面板拖拽排序提供稳定文档操作。
- 变更
  - 审视并补强 `reorderNode` 语义，明确四类操作：
    - 同层前移/后移
    - 同层置顶/置底
    - 受控拖拽排序插入
    - group/container 内局部排序
  - 若现有四向枚举不足，新增显式“插入到某父节点某索引”操作。
  - 增加对锁定/隐藏节点排序行为的约束测试。
- 原因
  - 仅靠 `forward/backward/front/back` 不够表达图层拖拽排序，且未来导入复杂树结构时更容易出边界问题。

#### `packages/canvas-core/src/__tests__/canvas-core.test.ts`

- 增加针对以下场景的单测：
  - 树形层级拖拽排序后的 `rootNodeIds/childrenOrder` 稳定性。
  - 多选复制/粘贴后 group/container 子结构保持。
  - 变换后的 group/container 子节点比例更新规则。
  - 后续导入归一化后的节点插入顺序。

### Wave 2: 补齐快捷键与编辑工作流

#### 新增 `apps/web/src/components/canvas/use-canvas-keyboard-shortcuts.ts`

- 目标
  - 对齐 OpenPencil 的 shortcuts 分层模式，把编辑、历史、工具、导入入口解耦。
- 变更
  - 从 `CanvasSurface` 抽出键盘逻辑，并按主题拆分：
    - `history`: `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`
    - `selection/edit`: `Delete`, `Cmd/Ctrl+A`, `Cmd/Ctrl+C/X/V/D`, `Cmd/Ctrl+G`, `Shift+Cmd/Ctrl+G`
    - `nudge`: 方向键微调，`Shift` 加速
    - `tool`: `V/T/H/R`，以及现有 shape tool 热键
    - `layer order`: 可考虑补 `[` / `]`
  - 对输入框/textarea/contentEditable 保持跳过逻辑。
  - `Cmd/Ctrl+V` 时先尝试内部 clipboard；内部 clipboard 为空时进入系统剪贴板导入链路。
- 原因
  - 当前快捷键虽然部分已存在，但还未形成可扩展结构，也未与 P2 导入入口打通。

#### `apps/web/src/components/canvas-logo-menu.tsx`

- 目标
  - 让菜单与快捷键能力一致，作为桌面用户发现导入/编辑功能的补充入口。
- 变更
  - 新增：
    - 粘贴
    - 剪切
    - 复制
    - 置顶/置底
    - 导入 SVG
    - 从剪贴板粘贴 Figma/SVG
  - 菜单点击统一走 `CanvasApi`，避免实现分叉。
- 原因
  - P2 导入不能只靠快捷键发现。

### Wave 3: P2 首波可编辑导入

#### 新增 `packages/canvas-core/src/import/*`

- 目标
  - 在 Cucumber 侧建立独立的“导入归一化层”，不要让 `apps/web` 直接塞入 OpenPencil `PenNode`。
- 变更
  - 新增中间适配模块，职责拆为：
    - `svg-parser-adapter.ts`
      - 复用或移植 OpenPencil `parseSvgToNodes()` 关键逻辑，得到中间节点树。
    - `figma-clipboard-adapter.ts`
      - 复用或移植 OpenPencil `isFigmaClipboardHtml()` / `extractFigmaClipboardData()` / `figmaClipboardToNodes()` 的关键链路。
    - `normalize-imported-nodes.ts`
      - 将 OpenPencil 风格节点树归一化为 `CanvasNode[] + CanvasAsset[]`。
      - 需要定义清晰映射：
        - `frame/group -> container 或 group`
        - `rectangle -> rect`
        - `ellipse -> ellipse`
        - `path -> path`
        - `line -> line`
        - `text -> text`
        - `image -> image + assets`
      - 对暂不支持的样式/效果输出 warning，而不是静默吞掉。
    - `insert-import-result.ts`
      - 将导入结果批量插入 `CucumberCanvasDocument`，保证单次历史记录、选区与排序稳定。
  - 导出统一的导入结果协议，例如：
    - `nodes`
    - `assets`
    - `warnings`
    - `suggestedSelection`
    - `placementBounds`
- 原因
  - P2 首波的核心不是“能读格式”，而是“导入后仍是 Cucumber 可编辑文档的一部分”。

#### `packages/canvas-core/src/types.ts`

- 目标
  - 让导入后的节点能保留最小必要来源信息，为后续 ref/token/codegen 铺底。
- 变更
  - 给 `meta` 约定来源字段，例如：
    - `source: "svg-import" | "figma-paste" | ...`
    - `importSessionId`
    - `originNodeType`
  - 仅在现有 `meta` 能承载时扩展约定；若不足，再新增轻量 typed helper，而非贸然改大 schema。
- 原因
  - 后续 token/ref/codegen 需要知道节点来源与可追踪性。

#### `apps/web/src/components/canvas/use-canvas-clipboard-import.ts`

- 目标
  - 承接系统剪贴板导入入口，处理浏览器权限与 fallback。
- 变更
  - 监听 `paste` 事件。
  - 对 `text/html` 做 Figma clipboard 检测。
  - 对 `image/svg+xml` 或 `text/plain` 中 SVG 文本做 SVG 导入检测。
  - 当浏览器未把 paste 事件送达时，`Cmd/Ctrl+V` fallback 到 `navigator.clipboard.read()` / `readText()`。
  - 导入插入位置默认对齐“当前 viewport 中心”；如果当前选中容器明确存在，则作为首选父容器。
  - 将整次导入放进单次 history capture。
  - 记录结构化日志：
    - payload 类型
    - 识别到的导入源
    - 节点数/资源数
    - warning 数量
    - 失败原因
- 原因
  - 这是“系统粘贴优先”策略的主入口。

#### `apps/web/src/components/canvas/canvas-surface.tsx`

- 目标
  - 通过导入 hook 与面板反馈完成 UI 闭环。
- 变更
  - 接入 `useCanvasClipboardImport`。
  - 导入成功后统一更新：
    - 文档
    - 选区
    - 历史栈
    - `onSelectionChange`
  - 导入 warning 通过 toast/面板提示给用户，而不是直接吞掉。
  - 对导入出来的 container/group 在首次插入时采用稳定 z-order 追加策略。
- 原因
  - `CanvasSurface` 仍是当前画布主控点，导入链路需要在这里总装配。

#### `apps/web/src/app/canvas/page.tsx`

- 目标
  - 提供页面级反馈与后续扩展位。
- 变更
  - 增加导入结果提示承载，例如：
    - 成功导入多少节点
    - 有多少 warning
    - 点击查看图层位置
  - 预留后续 P2 组件/ref、token、代码导出入口的 page-level actions，不在本波实现完整 UI。
- 原因
  - 避免把所有导入反馈堆到 `CanvasSurface` 内部浮层。

### Wave 4: 为后续 P2 打地基

#### `packages/canvas-core` 与 `docs/architecture.md`

- 目标
  - 在不一次性实现完整 ref/token/codegen 的前提下，把架构边界说明白。
- 变更
  - 在 `docs/architecture.md` 记录：
    - 导入归一化层与 `canvas-core` 的关系
    - 为什么首波不直接持久化 OpenPencil `PenDocument`
    - 后续组件/ref、变量/token、代码导出将如何复用导入时的来源元数据
  - 若本波新增核心导入协议，也同步更新共享文档说明。
- 原因
  - 这属于框架级演进说明，符合仓库对 agent/runtime/架构改动需要文档化的要求。

#### `progress.md` 与 `feature_list.json`

- 目标
  - 反映 P1 收尾与 P2 导入主线的实际完成状态。
- 变更
  - 实施完成后更新：
    - `progress.md` 新增本轮完成项、遗留风险、验证结果。
    - `feature_list.json` 更新 `CORE-005` 的 summary/artifacts；必要时新增独立的 P2 导入 feature 条目。
- 原因
  - 仓库 `Definition of Done` 明确要求项目状态变化时同步更新。

## Assumptions & Decisions

- 已确认 `P0` 与第一波 `P1` 已经落地，不再重复规划“从零接历史栈/多选/8 向缩放”。
- 本轮计划不会切换底层文档模型到 `packages/engine` 或 OpenPencil `PenDocument`；继续以 `@cucumber/canvas-core` 的 `CucumberCanvasDocument` 为运行时单一事实源。
- `packages/engine/src/core/design-engine.ts` 本轮仅作为职责拆分参考，不在本波直接接入 `CanvasSurface`。
- Figma/SVG 首波入口以 `系统粘贴` 为主，`本地 SVG 文件导入` 作为次级扩展位，可在同一实现中预留 parser 调用但不作为首要验收项。
- Figma 导入首波优先支持：
  - 剪贴板 HTML 检测
  - 文本/矩形/椭圆/路径/线条/图片的可编辑落地
  - 基础样式（填充、描边、透明度、字号/字体）
- Figma 导入首波暂不承诺完整支持：
  - 复杂自动布局语义
  - 组件实例/ref 还原
  - design token 自动映射
  - 高级 effects 的完全保真
- 对暂不支持的导入能力不做静默兜底；要返回明确 warning/错误说明，遵守“不要返回默认值/模糊错误”的项目约束。
- 图层拖拽排序若发现现有 `reorderNode` 无法表达，应优先扩展 `canvas-core` 操作协议，而不是在 UI 层偷偷改数组顺序。

## Verification

### 单元与集成验证

- `packages/canvas-core`
  - 补充并运行导入归一化、排序、clipboard 结构保持、历史批处理相关单测。
- `apps/web`
  - 为抽出的 shortcuts/import hooks 增加 focused tests；至少覆盖：
    - `Cmd/Ctrl+V` 内部 clipboard 分支
    - `Cmd/Ctrl+V` 系统 Figma/SVG 分支
    - 图层拖拽排序/重命名/锁定显隐

### 端到端验证

- 在 `e2e/p2` 增加或扩展场景，至少覆盖：
  - 多选 + 图层排序 + undo/redo 回退
  - 复制/粘贴/重复后 group/container 结构不丢失
  - 系统粘贴 SVG 后节点可再次编辑
  - 系统粘贴 Figma clipboard 后节点可再次编辑，且 warning 可见
- 使用现有 `playwright-p2.config.ts` 执行对应场景。

### 质量门槛

- 对受影响 workspace 运行最小必要的 `typecheck` / `lint` / 针对性 `test`。
- 对最近编辑文件运行 diagnostics，修复新增 TS/ESLint 问题。
- 若导入协议或架构边界有变化，确认 `docs/architecture.md`、`progress.md`、`feature_list.json` 一并更新。
