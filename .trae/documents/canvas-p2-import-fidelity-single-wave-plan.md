# Canvas P2 导入保真升级计划

## Summary

- 本轮只规划 `单波实现`，目标是把当前 `SVG / Figma-like` 的 first slice 导入升级为更稳的生产可用导入能力，而不是同时展开完整的 `component/ref`、`variables/token`、`design-as-code` 三条主线。
- 这波的核心不是“再多支持几个快捷入口”，而是把导入链路从“形状级降级导入”升级为“保留更多结构与来源信息的可编辑导入”。
- 交付后，用户应能通过 `系统粘贴优先` 导入更复杂的 SVG / Figma 剪贴板内容，看到更完整的节点结构、明确的兼容 warning、稳定的历史记录和更好的可诊断日志。
- 本轮继续坚持 `@cucumber/canvas-core` 为唯一运行时文档模型，不直接把 `openpencil` 的 `PenDocument` 持久化进主产品。

## Current State Analysis

### 已完成基础

- `packages/canvas-core/src/import.ts`
  - 已有导入归一化主入口：
    - `parseClipboardImport()`
    - `parseSvgMarkup()`
    - `insertCanvasImportResult()`
    - `getCanvasImportBounds()`
  - 已支持把 `SVG` 或 `Figma-like HTML` 解析为 `CanvasNode[] + CanvasAsset[]`，并写回 `CucumberCanvasDocument`。
- `apps/web/src/components/canvas/use-canvas-clipboard-import.ts`
  - 已监听 `paste` 事件，并支持 `navigator.clipboard.read()` / `readText()` fallback。
- `apps/web/src/components/canvas/canvas-surface.tsx`
  - 已接入系统剪贴板导入、SVG 文件导入、导入 warning toast、viewport 居中插入和 history 追踪。
- `apps/web/src/components/canvas-logo-menu.tsx`
  - 已暴露 `导入 SVG` 与 `粘贴` 菜单入口。
- `docs/architecture.md`
  - 已记录三段式导入边界：浏览器捕获 payload -> `canvas-core` 归一化 -> `CanvasSurface` 正常 mutation 插入。

### 当前真实缺口

- `packages/canvas-core/src/import.ts`
  - Figma 导入本质仍是降级策略：
    - 有内嵌 `<svg>` 就走 SVG fallback。
    - 否则按 styled HTML 部分导入。
  - 当前只保留很薄的来源信息：
    - `meta.source`
    - `meta.originNodeType`
  - 没有保留更细的导入 provenance，例如：
    - 导入批次
    - Figma clipboard 节点标识
    - 组件/实例痕迹
    - auto-layout / constraints / effects / boolean operation 的降级说明
- `packages/canvas-core/src/types.ts`
  - `CanvasNodeBase.meta` 仍是 `Record<string, unknown>`，没有明确的 typed import metadata 约定。
- `apps/web/src/components/canvas/use-canvas-clipboard-import.ts`
  - 只负责把 `html/text` 交给上层，没有导入源分类、权限失败原因、payload 类型埋点。
- `apps/web/src/components/canvas/canvas-surface.tsx`
  - 导入 warning 目前只展示第一条 toast。
  - 导入结果虽然能选中，但没有更清晰的“导入摘要 + 兼容性说明”反馈。
  - 导入历史虽然接入了 history manager，但没有明确把“整次导入”视为一个原子批处理单元的约束说明。
- `apps/web/src/app/canvas/page.tsx`
  - 页面级导入提示比较轻，只提示导入数量，不足以承载复杂 warning 与后续 provenance 展示。
- 验证侧
  - `canvas-core` 已有部分导入测试，但还没有覆盖：
    - 更复杂 SVG 结构
    - Figma HTML fallback 结果
    - warning 聚合与 metadata 落盘
  - Web 侧也缺少 focused tests 去覆盖系统粘贴分支与 UI 反馈。

### 这波不做

- 不在这波正式引入新的 `component` / `ref` / `instance` 节点 schema。
- 不在这波建立 document-level `variables/themes/token` 系统。
- 不在这波做 `design-as-code export`。
- 不改动现有 agent runtime、Supabase、全局设计 token、部署配置。

## Proposed Changes

### 1. 明确导入元数据协议

#### `packages/canvas-core/src/types.ts`

- 增加一组明确的导入元数据约定，仍然挂在 `meta` 内，但通过 typed helper 保证形状稳定。
- 建议约定字段：
  - `source: "svg-import" | "figma-paste"`
  - `originNodeType?: string`
  - `importSessionId?: string`
  - `importSourceLabel?: string`
  - `originNodeId?: string`
  - `figmaNodeType?: string`
  - `degradationHints?: string[]`
- 不直接重构整个 `CanvasNode` schema；优先用轻量 typed contract 约束导入字段，降低对现有操作层的破坏面。

#### 为什么这样做

- 当前 `meta` 太宽泛，后续即使要上 `component/ref`、`token`、`codegen`，也需要先把导入来源和降级信息稳定保留下来。
- 这一步是后续 P2 能力的共同地基，但风险明显低于现在就引入新节点类型。

### 2. 升级 `canvas-core` 导入归一化层

#### `packages/canvas-core/src/import.ts`

- 把现有单文件导入逻辑继续整理成“同文件内清晰分层”或拆为邻近模块，职责至少显式分成：
  - Clipboard source detection
  - SVG parser
  - Figma clipboard fallback parser
  - Import metadata normalization
  - Warning aggregation
  - Document insertion
- 保持对外 API 兼容，优先保留：
  - `parseClipboardImport()`
  - `parseSvgMarkup()`
  - `insertCanvasImportResult()`
  - `getCanvasImportBounds()`

#### 重点升级项

- SVG 路径
  - 扩充对常见结构的支持与保留度：
    - `transform`
    - `viewBox` 参与 bounds 计算
    - `tspan` / 多段文本基础拼接
    - `stroke-linecap` / `stroke-linejoin` / `opacity` 继续透传
    - `image` 尺寸与 mime 推断更稳
  - 对仍不支持的标签，不静默跳过；继续产出明确 warning，并尽量标记来源节点信息。
- Figma clipboard 路径
  - 维持“系统粘贴优先”的入口不变，但把 fallback 结果保留得更完整：
    - 若有内嵌 SVG，除现有 warning 外，补充 `importSessionId`、`originNodeType` 等 metadata。
    - 若走 styled HTML fallback，除了 block/text 之外，尽可能保留：
      - 层级关系
      - 绝对定位
      - border radius
      - opacity
      - font family / font size / color
    - 对 auto-layout、component instance、boolean、effects 等无法还原的能力，统一写入 `degradationHints`。
- Warning 聚合
  - 由“只吐第一条 message”升级为“按导入批次聚合 warning 列表”。
  - warning 要求区分：
    - `unsupported_tag`
    - `partial_fidelity`
    - `layout_degraded`
    - `component_metadata_dropped`
    - `effects_dropped`

#### `packages/canvas-core/src/index.ts`

- 确认继续导出新增的 typed helper / warning contract，避免 web 层自行 hardcode 字段名。

### 3. 让导入插入成为稳定的单次 mutation

#### `packages/canvas-core/src/import.ts`

- 审视 `insertCanvasImportResult()`，确保以下规则稳定：
  - 整次导入只形成一次文档写入结果。
  - root 节点插入顺序稳定。
  - parent 容器存在时写入 `childrenOrder`，不存在时写入 `rootNodeIds`。
  - 导入选区只选 root 节点，避免选中所有内部叶子节点导致属性面板噪声。
  - 所有导入节点共享同一个 `importSessionId`，便于 UI 聚合反馈。

#### `apps/web/src/components/canvas/canvas-surface.tsx`

- 保持 `importFromPayload()` 为主装配入口，但增强行为：
  - 把解析结果里的多条 warning 全量传给 UI，而不只消费第一条。
  - 在导入成功日志中补充：
    - `importSessionId`
    - `source`
    - `insertedCount`
    - `warningCount`
    - `degradationCodes`
  - 在失败日志中明确区分：
    - 剪贴板为空
    - 权限失败
    - payload 无法识别
    - parser 失败
    - doc insertion 失败

### 4. 强化 Web 侧导入反馈与入口一致性

#### `apps/web/src/components/canvas/use-canvas-clipboard-import.ts`

- 保持 hook 简洁，但增加导入前的分类辅助与日志埋点：
  - 是否来自 paste event
  - 是否来自 clipboard API fallback
  - payload 含 `text/html` 还是 `text/plain`
  - 是否命中 SVG / Figma-like 检测
- 输入框、textarea、contentEditable 的跳过规则继续保留。
- 不在 hook 内做解析，只把更完整的 payload context 回传给 `CanvasSurface`。

#### `apps/web/src/components/canvas-logo-menu.tsx`

- 保持菜单入口统一走 `CanvasApi`，但对用户反馈做一致化：
  - `粘贴` 成功时区分：
    - 内部 clipboard paste
    - 系统剪贴板导入
  - `导入 SVG` 成功后如果存在 warning，要通过 UI 提示“已导入，但有兼容性提醒”。

#### `apps/web/src/app/canvas/page.tsx`

- 将页面顶部现有导入提示从“单条成功文案”升级为“轻量导入摘要承载层”。
- 目标能力：
  - 展示导入来源：`SVG` / `Figma`
  - 展示导入节点数
  - 展示 warning 数量
  - 若存在 warning，显示“查看兼容性提醒”入口
- 不需要在这波做复杂 drawer；只需提供稳定、可扫描、不会打断工作流的摘要反馈。

### 5. 文档与测试同步

#### `packages/canvas-core/src/__tests__/canvas-core.test.ts`

- 增补以下单测：
  - SVG 导入保留 root 节点顺序和 parent 关系。
  - Figma HTML fallback 会写入 warning 与 typed import metadata。
  - 导入节点共享同一 `importSessionId`。
  - unsupported tag 会产出明确 warning，不会直接抛错中断整个导入。

#### Web focused tests

- 为 `apps/web/src/components/canvas/use-canvas-clipboard-import.ts` 增加 focused tests：
  - 普通输入框 paste 不拦截。
  - 非输入上下文 paste 会传递 payload。
  - clipboard API fallback 读取失败时不崩溃。
- 为 `apps/web` 画布导入接线增加 focused tests：
  - 系统剪贴板命中 SVG 时成功导入并更新选区。
  - 系统剪贴板命中 Figma-like HTML 时成功导入并展示 warning 摘要。

#### `docs/architecture.md`

- 补充一段“导入 provenance / degradation metadata”的架构约定：
  - 为什么本轮只加强 metadata 和 warning，而不直接上 component schema。
  - 这些 metadata 将如何为未来的 component/ref、token、codegen 铺底。

#### `progress.md`

- 更新本轮进展与遗留项：
  - 已完成导入保真升级到什么程度。
  - 仍未覆盖的 Figma 能力清单。

#### `feature_list.json`

- 更新对应 feature summary / artifacts，明确这是 `P2 import fidelity upgrade`，不是“完整 Figma integration”。

## Assumptions & Decisions

- 用户已经明确：
  - 这轮 P2 优先主线是 `导入保真升级`
  - 计划粒度选择 `单波实现`
- 本轮继续沿用现有三段式导入边界，不让 web 层直接消费 OpenPencil 内部文档模型。
- 这波的成功标准是“更高保真、更强 warning、更稳定 provenance”，而不是“完整还原 Figma 组件系统”。
- 对无法保真的特性，不做静默兜底，不输出模糊默认值；必须给出明确 warning 或错误说明。
- `CanvasApi` 现有表面尽量保持稳定；优先在内部增强导入结果与 UI 反馈，而不是扩大外部调用面。
- 若在实现时发现 `meta` typed helper 仍不足以承载必要 provenance，才升级为更明确的 shared type，但避免本轮大规模 schema 重写。

## Verification

### 必跑验证

- `pnpm --filter @cucumber/canvas-core typecheck`
- `pnpm --filter @cucumber/canvas-core test`
- `pnpm --filter @cucumber/web typecheck`

### 针对性验证

- 导入相关 focused tests：
  - SVG clipboard payload
  - Figma-like HTML payload
  - warning 聚合
  - import metadata 落盘
- 对最近编辑文件跑 diagnostics，确认没有新增 TS / lint 问题。

### 手动验收场景

- 从系统剪贴板粘贴纯 SVG 文本：
  - 节点成功落到当前 viewport 中心或当前选中容器内
  - root 结构与排序稳定
  - 可再次编辑
- 从系统剪贴板粘贴 Figma-like HTML：
  - 导入成功
  - 顶部摘要能提示导入来源与 warning 数量
  - 降级能力有明确兼容性说明
- 导入失败场景：
  - 空剪贴板
  - 无法识别的 payload
  - 浏览器权限受限
  - parser 抛错
  - 都会返回明确错误说明，不会让画布进入异常状态

### 验收口径

- 这波完成后，可以认为 `P2 import fidelity upgrade` 达到“生产可用的增强版 first slice”。
- 这不意味着：
  - 已支持完整 Figma component/ref
  - 已支持变量/token 系统
  - 已支持 design-as-code export
- 这些方向保留到后续独立波次推进。
