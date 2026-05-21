# CucumberCanvas AI 无限画布 — 端到端测试方案

> 版本：1.0.0 | 更新日期：2026-05-21  
> 测试框架：Playwright (Browser-based, 模拟真实用户操作)  
> 适用分支：main

---

## 一、功能模块覆盖矩阵

基于项目源码梳理，当前已实现功能按优先级分类如下：

| 优先级 | 模块 | 核心源码 |
|--------|------|----------|
| P0 | 画布基础操作 | `packages/engine/src/core/viewport-controller.ts`, `selection-manager.ts`, `history-manager.ts`, `scene-tree.ts` |
| P0 | ContainerNode 容器操作 | `packages/container/src/container-manager.ts`, `context-resolver.ts` |
| P0 | Agent 系统 | `packages/container/src/agent-registry.ts`, `agent-context-builder.ts`, `apps/server/src/agent/runtime.ts` |
| P1 | IOPorts 数据端口 | `packages/container/src/io-port-manager.ts`, `packages/renderer/src/dataflow/io-port-renderer.ts` |
| P1 | Brand Kit 品牌资源 | `apps/web/src/components/brand-kit/`, `apps/server/src/features/brand-kit/` |
| P2 | DataFlow 数据流引擎 | `packages/container/src/dataflow/dataflow-engine.ts`, `performance/dataflow-batch-executor.ts` |
| P2 | WebGL Shader 特效 | `packages/renderer/src/shaders/`, `packages/renderer/src/filters/` |
| P2 | 图片/视频生成 | `apps/server/src/generation/`, `apps/web/src/components/canvas/image-generator-panel.tsx` |
| P3 | Multi-Agent 协作 | `packages/container/src/collaboration/agent-orchestrator.ts`, `agent-collab-session.ts` |
| P3 | 容器模板系统 | `packages/container/src/templates/template-registry.ts`, `presets.ts` |
| P3 | Skill 市场 | `apps/web/src/components/skills/`, `skills/` |

---

## 二、测试设计原则

1. **真实用户视角**：每个案例描述一个具体业务场景，非技术单元测试
2. **浏览器模拟**：所有操作通过 Playwright 的 `click`、`drag`、`keyboard`、`scroll`、`hover` 等 API 完成
3. **独立 Harness**：每个测试文件内嵌 HTML harness（参照项目已有 e2e 模式），不依赖完整后端启动
4. **截图验证**：关键步骤通过 `page.screenshot()` 留档，便于 CI 回溯
5. **状态断言**：通过 `data-testid` 属性和暴露的 `window.__CUCUMBER_*` API 验证内部状态

---

## 三、测试案例详情

### 模块一：画布基础操作

---

#### TC-001 画布缩放操作

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-001 |
| **场景名称** | 用户通过滚轮缩放画布 |
| **用户角色** | 设计师 |
| **前置条件** | 画布已加载，包含至少一个 ContainerNode |
| **截图节点** | 缩放前、缩放后 |

**操作步骤：**
1. 打开画布页面，等待 canvas-stage 渲染完成
2. 在画布中心位置滚动鼠标滚轮（向上 3 次 = 放大）
3. 验证 zoom level 从 1.0 增大
4. 在画布中心位置滚动鼠标滚轮（向下 5 次 = 缩小）
5. 验证 zoom level 小于 1.0
6. 验证 zoom 不超过 MIN_ZOOM / MAX_ZOOM 边界

**预期结果：**
- 画布缩放平滑，元素等比例缩放
- zoom 值被 clamp 到 [0.1, 5.0] 区间

**验证方式：**
- 断言 `viewport.zoom` 在有效范围内
- 截图对比缩放前后画布尺寸变化

---

#### TC-002 画布平移操作

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-002 |
| **场景名称** | 用户通过空格+拖拽平移画布 |
| **用户角色** | 设计师 |
| **前置条件** | 画布已加载 |
| **截图节点** | 平移前、平移后 |

**操作步骤：**
1. 按住空格键
2. 在画布上按下鼠标左键并拖拽 200px 向右、100px 向下
3. 释放鼠标和空格键
4. 验证画布偏移量变化

**预期结果：**
- panX 增加约 200，panY 增加约 100
- 画布内所有元素跟随平移

**验证方式：**
- 断言 `viewport.panX` 和 `viewport.panY` 的增量
- 截图对比元素位移

---

#### TC-003 多选操作

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-003 |
| **场景名称** | 用户框选多个容器节点 |
| **用户角色** | 设计师 |
| **前置条件** | 画布上已有 3 个容器节点 |
| **截图节点** | 框选过程、选中高亮 |

**操作步骤：**
1. 创建 3 个 ContainerNode 在不同位置
2. 从画布空白区域按下鼠标，拖拽出包含所有节点的选框
3. 释放鼠标
4. 验证所有 3 个节点被选中

**预期结果：**
- 选中计数为 3
- 选中的节点显示高亮边框

**验证方式：**
- 断言 `selectionManager.selectedIds.length === 3`
- 验证选中节点的 CSS 类包含 `selected`

---

#### TC-004 快捷键撤销/重做

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-004 |
| **场景名称** | 用户使用 Ctrl+Z/Ctrl+Y 撤销和重做 |
| **用户角色** | 设计师 |
| **前置条件** | 画布上已有容器，用户刚执行了创建操作 |
| **截图节点** | 创建后、撤销后、重做后 |

**操作步骤：**
1. 创建一个新的 ContainerNode
2. 验证容器计数 +1
3. 按下 Ctrl+Z（撤销）
4. 验证容器计数恢复
5. 按下 Ctrl+Y（重做）
6. 验证容器再次出现

**预期结果：**
- 撤销后节点消失，重做后恢复

**验证方式：**
- 断言容器数量在操作前后的变化
- 断言 history stack 的 index

---

### 模块二：ContainerNode 容器操作

---

#### TC-005 创建容器节点

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-005 |
| **场景名称** | 用户通过工具栏创建不同类型的容器 |
| **用户角色** | 设计师 |
| **前置条件** | 画布为空 |
| **截图节点** | 每种容器创建后 |

**操作步骤：**
1. 点击工具栏「创建 Prompt 生成器」按钮
2. 验证画布上出现一个带标题「Prompt 生成器」的容器
3. 点击工具栏「创建 图片渲染器」按钮
4. 验证画布上出现第二个容器
5. 验证容器数量为 2

**预期结果：**
- 容器正确渲染在指定位置
- 容器标题、边框颜色符合配置

**验证方式：**
- 断言 `[data-testid="container-count"]` 文本
- 验证容器 DOM 元素的 CSS 属性

---

#### TC-006 移动容器节点

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-006 |
| **场景名称** | 用户拖拽移动容器到新位置 |
| **用户角色** | 设计师 |
| **前置条件** | 画布上有一个容器在 (60, 120) |
| **截图节点** | 拖拽前、拖拽后 |

**操作步骤：**
1. 找到容器节点的标题栏区域
2. 按下鼠标并拖拽到 (300, 300) 位置
3. 释放鼠标
4. 验证容器位置更新

**预期结果：**
- 容器 CSS left/top 更新为新坐标
- 连接的边线跟随更新

**验证方式：**
- 断言容器 `bounds` 的 x/y 值
- 截图对比

---

#### TC-007 调整容器大小

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-007 |
| **场景名称** | 用户拖拽容器边角调整大小 |
| **用户角色** | 设计师 |
| **前置条件** | 画布上有一个 220×140 的容器 |
| **截图节点** | 调整前、调整后 |

**操作步骤：**
1. 鼠标移到容器右下角 resize handle
2. 按下并拖拽向右下方 100px
3. 释放鼠标
4. 验证容器宽高增大

**预期结果：**
- 容器 width/height 增加约 100px
- 内部端口和子元素重新布局

**验证方式：**
- 断言容器 `bounds.width` 和 `bounds.height`

---

#### TC-008 容器嵌套（父子关系）

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-008 |
| **场景名称** | 用户将一个容器拖入另一个容器形成嵌套 |
| **用户角色** | 设计师 |
| **前置条件** | 画布上有两个容器 A（大）和 B（小） |
| **截图节点** | 嵌套前、嵌套后 |

**操作步骤：**
1. 创建大容器 A (400×300)
2. 创建小容器 B (150×100) 在 A 外部
3. 拖拽 B 到 A 的内部区域
4. 释放鼠标
5. 验证 B 的 parentId 变为 A 的 id

**预期结果：**
- B 成为 A 的子容器
- 移动 A 时 B 跟随移动

**验证方式：**
- 断言 `container_B.parentId === container_A.id`
- 断言 scene tree 的层级关系

---

### 模块三：Agent 系统

---

#### TC-009 绑定 Agent 到容器

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-009 |
| **场景名称** | 用户为容器绑定一个 AI Agent |
| **用户角色** | 设计师 |
| **前置条件** | 画布上有一个空容器 |
| **截图节点** | 绑定前、绑定后（Agent badge 出现） |

**操作步骤：**
1. 创建一个 ContainerNode
2. 通过 API 调用 `bindAgent` 绑定 designer 类型的 Agent
3. 验证容器上出现 Agent 状态标记
4. 验证 agentBinding 字段包含正确的 agentId 和 role

**预期结果：**
- 容器显示 Agent 角色图标
- `agentBinding.status` 为 "idle"

**验证方式：**
- 断言容器数据中 `agentBinding` 非 null
- 断言状态 badge 可见

---

#### TC-010 Agent 状态流转

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-010 |
| **场景名称** | Agent 从 idle → running → completed 状态变化 |
| **用户角色** | 设计师 |
| **前置条件** | 容器已绑定 Agent，状态为 idle |
| **截图节点** | idle、running、completed 各状态 |

**操作步骤：**
1. 启动 Agent（调用 orchestrator.startAgent）
2. 验证状态变为 "running"，容器边框动画开始
3. 完成 Agent（调用 orchestrator.completeAgent）
4. 验证状态变为 "completed"

**预期结果：**
- 状态按 idle → running → completed 顺序流转
- UI 反映相应的视觉反馈（边框颜色/动画）

**验证方式：**
- 断言 `agentBinding.status` 在各阶段的值
- 断言 orchestrator 事件触发

---

#### TC-011 AgentContext 注入

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-011 |
| **场景名称** | Agent 运行时自动获取容器上下文 |
| **用户角色** | AI 系统 |
| **前置条件** | 容器配置了 contextSlots（rules + tokens） |
| **截图节点** | 上下文构建结果展示 |

**操作步骤：**
1. 创建容器并设置 contextSlots: `{ rules: ["Generate prompts"], tokens: { style: "flat" } }`
2. 绑定 Agent
3. 调用 AgentContextBuilder 构建上下文
4. 验证返回的 context 包含 rules 和 tokens

**预期结果：**
- context 对象完整包含容器的 contextSlots 内容
- 父容器的 context 按 inheritPolicy 合并

**验证方式：**
- 断言 `resolvedContext.rules` 数组内容
- 断言 `resolvedContext.tokens` 对象内容

---

### 模块四：IOPorts 数据端口

---

#### TC-012 添加输入/输出端口

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-012 |
| **场景名称** | 用户为容器添加 IO 端口 |
| **用户角色** | 设计师 |
| **前置条件** | 画布上有容器节点 |
| **截图节点** | 添加端口后 |

**操作步骤：**
1. 点击「添加端口」按钮
2. 验证 Prompt 生成器获得一个 output 端口 (prompt 类型)
3. 验证 图片渲染器获得一个 input 端口 (prompt 类型) 和一个 output 端口 (image 类型)
4. 验证端口的视觉位置和标签

**预期结果：**
- output 端口显示在容器右侧（青色）
- input 端口显示在容器左侧（红色）
- 端口标签正确

**验证方式：**
- 断言 `[data-testid="port-*"]` 元素可见
- 断言端口 CSS 类包含 `output` 或 `input`

---

#### TC-013 拖拽建立连线

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-013 |
| **场景名称** | 用户从输出端口拖拽连线到输入端口 |
| **用户角色** | 设计师 |
| **前置条件** | 两个容器各有兼容的端口 |
| **截图节点** | 连线过程中（虚线）、连线完成（实线） |

**操作步骤：**
1. 从 Prompt 生成器的 output 端口开始拖拽
2. 拖拽线跟随鼠标移动
3. 释放在 图片渲染器的 input 端口上
4. 验证连线建立成功

**预期结果：**
- 连线显示为贝塞尔曲线
- edge 状态为 "idle"
- 边数量 +1

**验证方式：**
- 断言 `[data-testid="edge-count"]` 文本
- 断言 edge 的 `data-status` 为 "idle"

---

#### TC-014 端口类型兼容性校验

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-014 |
| **场景名称** | 尝试连接不兼容的端口类型时被拒绝 |
| **用户角色** | 设计师 |
| **前置条件** | 存在 image 类型 output 和 text 类型 input |
| **截图节点** | 连接尝试被拒绝 |

**操作步骤：**
1. 创建容器 A，添加 image 类型 output 端口
2. 创建容器 B，添加 text 类型 input 端口
3. 尝试建立 A→B 的连线
4. 验证连线失败

**预期结果：**
- 连线不建立
- 边数量保持为 0

**验证方式：**
- 断言 `addEdge` 返回 null
- 断言 edge-count 不变

---

### 模块五：DataFlow 数据流

---

#### TC-015 执行数据流

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-015 |
| **场景名称** | 用户触发数据流执行，观察状态流转 |
| **用户角色** | 设计师 |
| **前置条件** | 两个容器已建立连线 |
| **截图节点** | idle、flowing、completed 三个状态 |

**操作步骤：**
1. 建立完整的 Prompt生成器 → 图片渲染器 工作流
2. 点击「执行数据流」按钮
3. 观察 edge 状态从 idle → flowing
4. 等待执行完成，状态变为 completed
5. 验证数据载荷已传递

**预期结果：**
- 执行过程中连线动画可见（stroke-dasharray）
- 完成后载荷数据正确

**验证方式：**
- 断言 `data-status` 属性的变化
- 断言 `[data-testid="data-payload"]` 包含有效 JSON

---

#### TC-016 循环依赖保护

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-016 |
| **场景名称** | 系统检测并阻止循环依赖连线 |
| **用户角色** | 设计师 |
| **前置条件** | A→B→C 已连线 |
| **截图节点** | 尝试 C→A 时的错误提示 |

**操作步骤：**
1. 创建 3 个容器 A、B、C，分别添加端口
2. 建立 A→B、B→C 连线
3. 尝试建立 C→A 连线
4. 验证连线被拒绝
5. 验证错误提示 toast 出现

**预期结果：**
- 连线不建立
- 显示"循环依赖检测：无法建立连接"提示
- 触发 `cycle:detected` 事件

**验证方式：**
- 断言 error-toast 可见且文本正确
- 断言 edge-count 不增加

---

#### TC-017 批量执行优化

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-017 |
| **场景名称** | 多个独立节点的数据流同时执行 |
| **用户角色** | AI 系统 |
| **前置条件** | 多个独立的数据流管道 |
| **截图节点** | 批量执行开始、全部完成 |

**操作步骤：**
1. 创建 3 条独立的数据流管道（6 个容器，3 条边）
2. 触发批量执行
3. 验证所有管道并行执行
4. 等待全部完成

**预期结果：**
- 3 条管道的 edge 同时进入 flowing 状态
- 批量执行时间 ≈ 单条执行时间（而非 3 倍）

**验证方式：**
- 断言 `execution:batch` 事件包含所有节点
- 验证执行时间

---

### 模块六：WebGL Shader 特效

---

#### TC-018 容器背景渐变 Shader

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-018 |
| **场景名称** | 容器激活时显示动态背景渐变 |
| **用户角色** | 设计师 |
| **前置条件** | 画布已创建带 shader 特效的容器 |
| **截图节点** | 渐变激活前后 |

**操作步骤：**
1. 创建一个支持 shader 背景的容器
2. 激活渐变效果（设置 gradient mode）
3. 验证容器内出现 `.shader-background` 元素
4. 验证 canvas 元素渲染了渐变动画

**预期结果：**
- 容器背景呈现动态渐变效果
- shader uniform 正确传入颜色值

**验证方式：**
- 断言 `.shader-background` 的 `data-active` 为 true
- 截图验证视觉效果

---

#### TC-019 节点发光滤镜

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-019 |
| **场景名称** | Agent 运行时容器显示发光效果 |
| **用户角色** | 设计师 |
| **前置条件** | 容器已绑定 Agent |
| **截图节点** | Agent idle（无发光）、running（发光） |

**操作步骤：**
1. 创建容器并绑定 Agent
2. 验证初始无发光（filter inactive）
3. 启动 Agent，触发 glow filter
4. 验证发光效果激活
5. 验证发光颜色与 Agent 角色匹配

**预期结果：**
- running 状态下发光滤镜激活
- 发光半径和颜色正确

**验证方式：**
- 断言 `.glow-filter` 的 `data-active` 为 true
- 断言发光颜色值

---

#### TC-020 数据流粒子动画

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-020 |
| **场景名称** | 数据流执行时连线上显示粒子动画 |
| **用户角色** | 设计师 |
| **前置条件** | 两容器已连线 |
| **截图节点** | 粒子激活、粒子停止 |

**操作步骤：**
1. 建立数据流连线
2. 执行数据流
3. 观察连线上的粒子动画
4. 执行完成后粒子停止

**预期结果：**
- flowing 状态时粒子系统激活
- 粒子沿连线路径移动
- completed 后粒子消失

**验证方式：**
- 断言 `.particle-system` 的粒子数量 > 0
- 断言动画 class 存在

---

### 模块七：Multi-Agent 协作

---

#### TC-021 并发 Agent 调度

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-021 |
| **场景名称** | 多个 Agent 并发运行且不超过并发限制 |
| **用户角色** | AI 系统 |
| **前置条件** | 5 个容器各绑定不同 Agent，maxConcurrentAgents=5 |
| **截图节点** | 5 个 Agent 全部 running |

**操作步骤：**
1. 创建 5 个容器并绑定不同 Agent
2. 依次启动所有 Agent
3. 验证 5 个同时 running
4. 尝试启动第 6 个 Agent
5. 验证第 6 个被 throttle

**预期结果：**
- 前 5 个正常运行
- 第 6 个触发 `agent:throttled` 事件并排队

**验证方式：**
- 断言 `orchestrator.runningCount === 5`
- 断言 throttled 事件触发

---

#### TC-022 消息广播

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-022 |
| **场景名称** | 一个 Agent 广播消息给其他所有 Agent |
| **用户角色** | AI 系统 |
| **前置条件** | 3 个 Agent 在同一协作 session |
| **截图节点** | 广播后消息列表 |

**操作步骤：**
1. 创建 3 个容器并绑定 Agent
2. 启动所有 Agent
3. Agent A 广播消息 "review:start"
4. 验证 session.messages 包含广播记录
5. 验证消息类型为 "broadcast"

**预期结果：**
- 消息正确记录在 collabSession 中
- 所有 Agent 可访问广播内容

**验证方式：**
- 断言 `session.messages.length === 1`
- 断言消息 type 和 payload

---

#### TC-023 锁冲突解决

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-023 |
| **场景名称** | 两个 Agent 同时尝试修改同一容器时的冲突处理 |
| **用户角色** | AI 系统 |
| **前置条件** | 一个容器被 Agent A 锁定 |
| **截图节点** | 锁获取成功、冲突触发 |

**操作步骤：**
1. Agent A 获取容器的写锁
2. 验证锁成功获取（`lock:acquired` 事件）
3. Agent B 尝试获取同一容器的锁
4. 验证冲突事件触发（`lock:conflict`）
5. Agent A 释放锁
6. Agent B 成功获取锁

**预期结果：**
- 乐观锁机制保护数据一致性
- 冲突被正确检测和上报

**验证方式：**
- 断言事件序列：acquired → conflict → released → acquired

---

### 模块八：容器模板系统

---

#### TC-024 浏览预设模板

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-024 |
| **场景名称** | 用户浏览可用的容器模板列表 |
| **用户角色** | 设计师 |
| **前置条件** | 模板注册表已加载预设 |
| **截图节点** | 模板列表展示 |

**操作步骤：**
1. 调用 `templateRegistry.listTemplates()`
2. 验证返回列表包含 3 个预设模板
3. 验证每个模板包含 name、description、icon、tags
4. 按 category 筛选 "generation" 类型

**预期结果：**
- 预设模板完整列出
- 筛选结果正确

**验证方式：**
- 断言模板数量
- 断言每个模板的 schema 完整性

---

#### TC-025 实例化模板

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-025 |
| **场景名称** | 用户选择模板并在画布上实例化 |
| **用户角色** | 设计师 |
| **前置条件** | 选中 "Image Generation Pipeline" 模板 |
| **截图节点** | 实例化后的容器和连线 |

**操作步骤：**
1. 调用 `templateRegistry.instantiate('preset_image-generation-pipeline', 100, 100)`
2. 验证画布上出现 2 个容器（Prompt Generator + Image Renderer）
3. 验证容器间的连线自动建立
4. 验证端口和 Agent 绑定已配置

**预期结果：**
- 模板完整实例化
- 容器位置基于参考偏移
- 连线正确连接对应端口

**验证方式：**
- 断言 `instance.containerIds.length === 2`
- 断言 edges 数量为 1

---

#### TC-026 保存自定义模板

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-026 |
| **场景名称** | 用户将当前画布状态保存为自定义模板 |
| **用户角色** | 设计师 |
| **前置条件** | 画布上有自定义的工作流 |
| **截图节点** | 保存确认 |

**操作步骤：**
1. 创建自定义工作流（3 个容器 + 2 条连线）
2. 调用 `templateRegistry.saveAsTemplate(name, description, containerIds)`
3. 验证模板被保存
4. 重新列出模板，验证新模板存在
5. 实例化新模板验证完整性

**预期结果：**
- 自定义模板成功保存
- 包含所有节点、端口、连线、Agent 绑定信息

**验证方式：**
- 断言模板列表数量 +1
- 断言模板内容完整

---

### 模块九：复杂业务场景

---

#### TC-027 活动 KV 生成工作流

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-027 |
| **场景名称** | 多 Agent 协作生成活动 KV 视觉设计 |
| **用户角色** | 设计师 |
| **前置条件** | 5 个 Agent（风格/排版/字体/色彩/审核） |
| **截图节点** | 拓扑创建、并行执行、汇总完成 |

**操作步骤：**
1. 创建 5 个 ContainerNode 对应 5 个 Agent 角色
2. 建立数据流拓扑：4 个设计 Agent → 1 个审核 Agent
3. 启动 4 个设计 Agent 并行执行
4. 等待设计 Agent 完成
5. 数据汇入审核 Agent 执行最终评分
6. 验证完整的执行日志

**预期结果：**
- 4 个设计 Agent 并行运行
- 审核 Agent 在所有输入就绪后执行
- 最终输出包含评分结果

**验证方式：**
- 断言执行顺序和时间关系
- 断言最终输出数据格式

---

#### TC-028 图片生成端到端工作流

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-028 |
| **场景名称** | 从用户输入到生成图片的完整工作流 |
| **用户角色** | 设计师 |
| **前置条件** | 配置了完整的图片生成管道 |
| **截图节点** | 输入、生成中、生成完成 |

**操作步骤：**
1. 使用 Image Generation Pipeline 模板实例化
2. 注册 promptGen executor（生成描述文本）
3. 注册 imageRenderer executor（模拟图片生成）
4. 执行数据流
5. 验证最终输出包含图片 URL

**预期结果：**
- 数据正确流经各节点
- 最终产出 image 类型的 payload
- 执行日志记录完整

**验证方式：**
- 断言 `lastPayload.type === 'image'`
- 断言 URL 格式有效

---

### 模块十：边界与异常场景

---

#### TC-029 循环依赖重复尝试

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-029 |
| **场景名称** | 多次尝试建立循环连线均被阻止 |
| **用户角色** | 设计师 |
| **前置条件** | A→B→C 已连线 |
| **截图节点** | 每次尝试的错误提示 |

**操作步骤：**
1. 已有 A→B→C 链路
2. 尝试 C→A（被拒绝）
3. 尝试 C→B（被拒绝，因为 B→C 已存在形成环）
4. 尝试 B→A（被拒绝）
5. 验证所有尝试均触发 cycle:detected 事件

**预期结果：**
- 3 次尝试均失败
- 每次都显示错误提示

**验证方式：**
- 断言 cycle:detected 事件触发 3 次
- 断言 edge-count 始终不变

---

#### TC-030 并发冲突恢复

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-030 |
| **场景名称** | Agent 执行出错后系统正确恢复 |
| **用户角色** | AI 系统 |
| **前置条件** | Agent 正在执行中 |
| **截图节点** | 错误状态、恢复后状态 |

**操作步骤：**
1. 启动 Agent 执行
2. 模拟 Agent 抛出错误
3. 验证 `agent:error` 事件触发
4. 验证容器锁被释放
5. 验证其他 Agent 可以正常获取锁
6. 验证 orchestrator 的 runningCount 正确减少

**预期结果：**
- 错误被优雅处理
- 系统状态保持一致
- 不影响其他 Agent 的正常运行

**验证方式：**
- 断言 error 事件包含正确的错误信息
- 断言 lock 释放
- 断言 runningCount 递减

---

#### TC-031 网络异常（超时回退）

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-031 |
| **场景名称** | Agent 执行超时后自动终止 |
| **用户角色** | AI 系统 |
| **前置条件** | executionTimeout 设置为 2000ms |
| **截图节点** | 超时前、超时后 |

**操作步骤：**
1. 配置 orchestrator `executionTimeout: 2000`
2. 启动一个永不完成的 Agent
3. 等待 2000ms 超时触发
4. 验证 Agent 被强制终止
5. 验证状态变为 error

**预期结果：**
- 超时后 Agent 自动停止
- 触发 `agent:error` 事件，message 包含 "timeout"
- 系统资源被正确回收

**验证方式：**
- 断言超时事件触发
- 断言 runningCount 恢复

---

#### TC-032 大量节点性能

| 项目 | 内容 |
|------|------|
| **案例编号** | TC-032 |
| **场景名称** | 画布上创建 50+ 节点时的性能表现 |
| **用户角色** | 设计师 |
| **前置条件** | 空画布 |
| **截图节点** | 50 节点创建完成 |

**操作步骤：**
1. 循环创建 50 个 ContainerNode
2. 为每个节点添加端口
3. 验证渲染帧率和响应时间
4. 执行一次全量数据流

**预期结果：**
- 创建过程流畅（< 5s 总时间）
- 所有节点正确渲染
- 无内存泄漏

**验证方式：**
- 断言创建时间 < 5000ms
- 断言容器数量 === 50
- 断言无 JS 错误

---

## 四、Playwright 测试文件组织结构

```
cucumbercanvas/
├── e2e/
│   ├── TEST_PLAN.md                          ← 本文档
│   ├── full-suite/
│   │   ├── 01-canvas-basics.spec.ts          ← TC-001 ~ TC-004
│   │   ├── 02-container-operations.spec.ts   ← TC-005 ~ TC-008
│   │   ├── 03-agent-system.spec.ts           ← TC-009 ~ TC-011
│   │   ├── 04-io-ports.spec.ts               ← TC-012 ~ TC-014
│   │   ├── 05-dataflow.spec.ts               ← TC-015 ~ TC-017
│   │   ├── 06-webgl-shaders.spec.ts          ← TC-018 ~ TC-020
│   │   ├── 07-multi-agent-collab.spec.ts     ← TC-021 ~ TC-023
│   │   ├── 08-templates.spec.ts              ← TC-024 ~ TC-026
│   │   ├── 09-business-scenarios.spec.ts     ← TC-027 ~ TC-028
│   │   └── 10-edge-cases.spec.ts             ← TC-029 ~ TC-032
│   ├── fixtures/
│   │   └── harness-base.html                 ← 共享 HTML harness 模板
│   ├── helpers/
│   │   ├── canvas-actions.ts                 ← 封装画布操作工具函数
│   │   └── assertions.ts                     ← 自定义断言工具
│   └── screenshots/
│       └── full-suite/                       ← 截图输出目录
├── playwright-full-suite.config.ts           ← 全量测试 Playwright 配置
└── ...
```

---

## 五、配置文件

### playwright-full-suite.config.ts

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e/full-suite",
  timeout: 60_000,
  retries: 1,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "e2e/full-suite/reports", open: "never" }],
    ["json", { outputFile: "e2e/full-suite/reports/results.json" }],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
});
```

---

## 六、执行命令

```bash
# 运行全量 E2E 测试
pnpm exec playwright test --config=playwright-full-suite.config.ts

# 运行单个模块
pnpm exec playwright test --config=playwright-full-suite.config.ts e2e/full-suite/01-canvas-basics.spec.ts

# 生成报告
pnpm exec playwright show-report e2e/full-suite/reports
```
