# Loomic UI Design Guidelines

> 本文档梳理 Loomic 当前 Web 端的视觉语言、组件规范和页面设计约定。适用范围：`apps/web` 下的产品工作台、画布、Brand Kit、Skills、Pricing、登录注册与官网展示页。

## 1. 产品气质

Loomic 是一个画布式 AI 创意工作台。界面要让用户专注于“输入想法、生成素材、在画布上整理作品”，因此整体应保持克制、轻量、低噪声。

核心关键词：

- **创作工具感**：优先支持高频操作、快速扫描、稳定布局，而不是营销式大面积装饰。
- **中性底色 + 高识别强调色**：主界面以黑白灰为骨架，使用荧光黄绿色作为 AI、当前态、聚焦态和关键行动的提示。
- **轻浮层、轻边框、轻阴影**：工作台和画布需要“漂浮但不抢内容”的控件。
- **图像优先**：项目、画布、官网展示页都应让真实生成图、缩略图、视频或画布内容成为第一视觉信号。
- **动效有功能性**：动效用于状态切换、生成中反馈、悬浮确认和导航过渡，避免无意义的装饰动效。

## 2. 设计令牌

项目使用 Tailwind CSS 4、shadcn/base-nova 风格、CSS Variables 和 OKLCH 颜色。新增 UI 应优先使用语义 token，而不是手写颜色。

主要定义位置：

- `apps/web/src/app/globals.css`
- `apps/web/components.json`
- `apps/web/src/components/ui/*`

### 2.1 颜色

| 用途 | Token | 当前值 | 使用建议 |
| --- | --- | --- | --- |
| 页面背景 | `--background` | `oklch(1 0 0)` | App 主背景、登录右侧背景 |
| 主文本 | `--foreground` | `oklch(0.145 0 0)` | 标题、正文、图标主态 |
| 卡片/浮层 | `--card` | `oklch(1 0 0)` | 卡片、侧栏、弹窗、工具条 |
| 次级底色 | `--muted` | `oklch(0.97 0 0)` | 输入框、缩略图占位、选中背景 |
| 次级文本 | `--muted-foreground` | `oklch(0.556 0 0)` | 描述、时间、元信息、弱图标 |
| 主按钮 | `--primary` | `oklch(0.205 0 0)` | 提交、确认、开关开启态 |
| 强调色 | `--accent` | `oklch(0.90 0.17 115)` | AI、选中、聚焦、品牌能量感 |
| 边框 | `--border` | `oklch(0.922 0 0)` | 卡片、分割线、输入框、工具栏 |
| 表单边框 | `--input-border` | `oklch(0.84 0 0)` | 更明确的输入边界 |
| 错误 | `--destructive` | `oklch(0.577 0.245 27.325)` | 删除、失败、危险提示 |
| 成功 | `--success` | `oklch(0.60 0.15 145)` | 成功状态、可用状态 |
| 警告 | `--warning` | `oklch(0.75 0.15 85)` | 额度、限制、等待确认 |
| 信息 | `--info` | `oklch(0.65 0.1 250)` | 系统提示、辅助说明 |

颜色使用原则：

- 默认只使用语义类：`bg-background`、`bg-card`、`bg-muted`、`text-foreground`、`text-muted-foreground`、`border-border`、`ring-ring`。
- 强调色只用于“当前/选中/AI/关键反馈”，不要把大面积背景染成 accent。
- 危险操作使用 `text-destructive`、`bg-destructive/10`、`border-destructive/20`，并保留二次确认。
- 官网展示页可以使用更强的图像、渐变文字和局部 glow，但产品工作台应保持安静。

### 2.2 字体

当前全局字体为 `Geist`，通过 `--font-sans` 注入。新增 UI 默认使用 `font-sans`。

字号建议：

| 场景 | Tailwind 建议 | 说明 |
| --- | --- | --- |
| 页面主标题 | `text-base sm:text-lg` | 工作台标题，如“项目” |
| 页面 Hero 标题 | `text-xl sm:text-2xl` | Home 工作台欢迎区 |
| 官网 Hero 标题 | `text-5xl` 到 `lg:text-8xl` | 仅官网首屏使用 |
| 卡片标题 | `text-sm font-medium/semibold` | 项目卡片、面板标题 |
| 正文 | `text-sm` | 表单、列表、聊天正文 |
| 元信息 | `text-xs` / `text-[11px]` | 时间、模型名、状态 |
| 标签 | `text-[10px]` 到 `text-xs` | Badge、计数、状态 pill |

字体规范：

- 产品内标题不使用超大字号，避免压迫工具界面。
- 字重以 `font-medium` 和 `font-semibold` 为主，少用 `font-bold`。
- 不使用负字距。官网可用轻微 tracking，但产品界面保持默认字距。
- 中文文本需要保留足够行高，正文建议 `leading-relaxed`。

### 2.3 圆角

全局基础圆角：`--radius: 0.625rem`。

| 场景 | 建议 |
| --- | --- |
| 基础按钮/输入框 | `rounded-lg` |
| 卡片/面板 | `rounded-xl`，大面板可到 `rounded-2xl` |
| 图标按钮 | `rounded-lg` 或 `rounded-full`，跟所在区域一致 |
| 小标签 | `rounded-md` / `rounded-full` |
| 缩略图 | `rounded-lg` |

注意：

- 工作台卡片应避免过度圆润；如果不是品牌展示或大浮层，不要滥用 `rounded-3xl` 以上。
- 图像容器圆角和外层卡片圆角需要协调，内层通常比外层小一级。

### 2.4 间距

基础间距使用 Tailwind 4px 栅格：

- 紧凑控件内部：`gap-1`、`gap-1.5`、`px-2`、`px-2.5`
- 普通列表/工具条：`gap-2`、`gap-3`
- 页面内容：`px-4 sm:px-6 md:p-8`
- 内容区大段落：`gap-6`、`gap-8`
- Brand Kit 编辑区：桌面可使用更宽留白，如 `md:px-[80px] xl:px-[160px]`

移动端触控目标：

- 底部导航、核心按钮、上传入口等触控目标不小于 `44px`。
- 桌面工具按钮可使用 `32px`，例如画布底部工具栏。

### 2.5 阴影和浮层

全局工具类：

- `shadow-subtle`: 轻提示、细小浮起
- `shadow-card`: 卡片和工具栏默认
- `shadow-card-hover`: 卡片 hover
- `shadow-float`: 弹窗、浮动面板
- `accent-glow`: 关键按钮/AI 生成按钮的短暂强调

浮层原则：

- 浮层背景优先使用 `bg-card` 或 `bg-card/75 backdrop-blur-lg`。
- 浮层必须有边框或 ring：`border border-border` 或 `ring-1 ring-foreground/10`。
- 阴影要轻，不要让工作台出现厚重拟物感。

## 3. 布局模式

### 3.1 工作台布局

当前工作台使用：

- 桌面：左侧 `60px` 图标 rail，主内容区滚动。
- 移动端：底部固定导航，主内容区预留 `pb-14`。
- 主内容：`main` 负责滚动，页面内部避免再制造多个大滚动容器。

新增工作台页面建议结构：

```tsx
<div className="px-4 py-6 sm:px-6 md:p-8">
  <header className="mb-4 sm:mb-6">
    <h1 className="text-base font-medium text-foreground sm:text-lg">页面标题</h1>
  </header>
  <section>{/* 页面内容 */}</section>
</div>
```

### 3.2 画布布局

画布是沉浸式工具界面，应以内容为中心：

- 画布占满窗口：`h-screen w-screen overflow-hidden`。
- 控件使用绝对定位浮在画布上，避免占用画布空间。
- 顶部左侧用于 logo、项目名、返回/菜单。
- 顶部右侧用于额度和状态。
- 底部中间用于工具栏。
- 左右面板用于聊天、图层、文件，移动端默认收起。

画布控件视觉：

- `bg-card/75 backdrop-blur-lg border border-border shadow-card`
- 工具按钮 `h-8 w-8 rounded-lg`
- 当前工具：`bg-foreground/[0.08] text-foreground`
- 默认工具：`text-foreground/60 hover:bg-foreground/[0.04]`

### 3.3 卡片网格

项目卡片当前使用固定比例：

- 外层比例：`aspect-[286/208]`
- 缩略图比例：`aspect-[395/227]`
- 网格：`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`

卡片规范：

- 图像/缩略图永远是卡片第一视觉。
- 标题一行截断：`truncate`。
- 时间、状态等元信息用 `text-[10px] sm:text-[11px] text-muted-foreground`。
- hover 只增强阴影或轻微背景，不移动布局。

### 3.4 官网/营销页布局

官网页允许比产品页更具表现力：

- 首屏使用真实产品图或生成作品图，不使用空泛插画。
- Hero 文案可使用大字号、渐变文字、淡 glow、轻动效。
- 展示图必须清晰可辨，避免过暗、模糊或只做氛围。
- CTA 使用 `primary`，局部可增加 `landing-cta-shimmer`。

产品工作台与官网不要混用风格：工作台不做大 Hero 和装饰性大卡片。

## 4. 基础组件规范

### 4.1 Button

优先使用 `apps/web/src/components/ui/button.tsx` 的 `Button`。

变体：

- `default`: 主要动作，黑底白字。
- `outline`: 次要动作或设置入口。
- `secondary`: 中性辅助动作。
- `ghost`: 工具栏、菜单项、图标按钮。
- `destructive`: 删除、取消订阅、危险确认。
- `link`: 文本链接。

尺寸：

- `default`: `h-8`
- `xs`: `h-6`
- `sm`: `h-7`
- `lg`: `h-9`
- `icon`: `size-8`
- `icon-xs`: `size-6`
- `icon-sm`: `size-7`
- `icon-lg`: `size-9`

按钮规则：

- 主要动作一个区域内只保留一个。
- 图标按钮必须有 `aria-label` 或 `title`。
- 需要表达工具属性时优先用图标按钮，不要用一排文字按钮堆满工具栏。
- 禁用态使用 `disabled:opacity-50`，不可点击时同时设置清晰 cursor 或 disabled。

### 4.2 Input / Textarea

基础输入框：

- 高度：`h-8`
- 圆角：`rounded-lg`
- 边框：`border-input`
- 聚焦：`focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`
- 占位符：`placeholder:text-muted-foreground`

多行输入：

- 使用 `resize-none`。
- 聊天输入允许自动高度，提交后恢复。
- 输入容器可使用 `bg-muted border-[0.5px] border-border shadow-[0_4px_8px_rgba(0,0,0,0.04)]`。

### 4.3 Dialog / Popover / Dropdown

弹窗和浮层：

- 背景：`bg-popover` 或 `bg-card`
- 圆角：`rounded-xl` / `rounded-2xl`
- 边界：`border` 或 `ring-1 ring-foreground/10`
- 阴影：`shadow-lg` / `shadow-float`
- 菜单项：`rounded-md px-1.5 py-1 text-sm`

交互：

- 危险项必须用 `text-destructive`。
- 复杂弹窗需要明确标题、说明、主要动作、取消动作。
- 小浮层避免超过 `380px` 宽；复杂详情可到 `520px` 左右。

### 4.4 Badge / Pill

用于分类、模型、套餐、状态：

- `inline-flex items-center rounded-full`
- `px-2 py-0.5` 或 `px-2.5 py-1`
- `text-[10px]` 到 `text-xs`
- 默认：`bg-muted text-muted-foreground`
- 选中/AI：`bg-accent/15 text-accent-foreground`
- 危险：`bg-destructive/10 text-destructive`

### 4.5 Skeleton / Loading

加载态应保持布局稳定：

- 使用骨架屏替代整页 spinner，除非是创建项目、鉴权初始化等短暂阻塞。
- 项目网格 skeleton 保持同样 `aspect-ratio` 和列数。
- 生成中的图像/视频元素使用 shimmer overlay，而不是改变画布布局。

## 5. 导航规范

### 5.1 桌面侧栏

桌面侧栏是窄图标 rail：

- 宽度：`60px`
- 图标按钮：`h-9 w-9 rounded-full`
- 当前态：`bg-accent/10 border-l-2 border-accent`
- 图标默认：`text-muted-foreground`
- 图标当前：`text-foreground`

导航顺序：

1. Logo/Home
2. Home
3. Projects
4. Brand Kit
5. Skills
6. Credits
7. Settings
8. Sign out

### 5.2 移动端底部导航

移动端使用底部导航：

- 固定在底部：`fixed inset-x-0 bottom-0 z-40`
- 背景：`bg-card/95 backdrop-blur-sm`
- 边框：`border-t border-border`
- 触控目标：`min-h-[48px] min-w-[48px]`
- 文本：`text-[10px] font-medium`
- 需要加 `pb-[env(safe-area-inset-bottom)]`

## 6. 页面级规范

### 6.1 Home

Home 是创作入口，不是营销页：

- 中心布局，最大宽度约 `max-w-3xl`。
- Logo + Loomic + 一句短标题 + 一句辅助文案。
- Prompt 输入框是主元素。
- 示例、发现、最近项目作为下方辅助，不抢主输入。

文案气质：

- 简短、直接、偏行动。
- 中文优先，按钮和页面主流程保持中文一致。
- 可以保留产品名和模型名英文。

### 6.2 Projects

Projects 目标是快速找图、开画布、新建：

- 使用缩略图网格。
- 新建项目卡固定在第一位。
- 删除按钮默认隐藏，桌面 hover/focus 展示。
- 移动端危险操作必须保证可触达，不依赖 hover。

### 6.3 Canvas

Canvas 页面是高密度工具界面：

- 不显示普通工作台 sidebar。
- 聊天面板桌面默认展开，移动/平板默认收起。
- 工具栏、文件、图层、AI 面板都应作为浮层。
- 生成中、错误、完成状态直接贴近画布元素展示。

### 6.4 Brand Kit

Brand Kit 是设置型页面：

- 左侧/顶部 Kit 列表，右侧/下方编辑区。
- 色彩、字体、Logo、图片资产使用可视化网格。
- Add 卡片使用虚线边框。
- 默认 Kit 使用小 badge 或开关表达，不要用大面积警示。

### 6.5 Skills

Skills 是管理型页面：

- 卡片要展示名称、描述、作者/来源、状态。
- 详情弹窗可以展示 markdown 或代码片段，但需要限制高度并允许滚动。
- 导入/删除属于高风险操作，要用二次确认或明确 destructive 样式。

### 6.6 Auth

登录注册页面：

- 桌面左右分栏，左侧品牌叙事，右侧表单。
- 移动端只保留表单，减少干扰。
- 表单最大宽度 `max-w-sm`。
- 成功态使用独立图标 + 简短说明。

## 7. 交互与动效

动效来自 Framer Motion 和全局 keyframes。新增动效应遵守：

- 常规进入：`opacity + y: 16/20`，持续 `0.4s` 到 `0.5s`。
- hover：只做轻微 scale、阴影或背景变化。
- tap：可使用 `scale: 0.9` 或 `active:translate-y-px`。
- 页面切换使用既有 `PageTransition`。
- 生成中使用 shimmer、loading dot、状态文字，不让用户误以为卡死。
- 长循环动效只用于 loading、logo、官网 hero，不用于常规工作台卡片。

动效曲线建议：

```ts
ease: [0.25, 0.46, 0.45, 0.94]
```

## 8. 响应式规范

断点策略：

- 默认从移动端开始写。
- `sm`: 增加留白、字号和卡片密度。
- `md`: 切换到桌面 sidebar、取消底部导航。
- `lg`: 展开高密度桌面布局，如 Canvas 聊天面板。
- `xl`: 增加项目网格列数或编辑区左右留白。

必须检查：

- 文本不溢出按钮和卡片。
- 移动端底部导航不遮挡内容。
- 画布页移动端默认收起侧面面板。
- hover 才出现的功能，在移动端要有替代入口。
- 固定比例卡片使用 `aspect-*`，避免图片加载造成布局跳动。

## 9. 可访问性

最低要求：

- 所有图标按钮必须有 `aria-label` 或 `title`。
- 键盘可交互元素要有 `focus-visible:ring-*`。
- 页面布局保留 skip link，例如工作台已有“跳到主内容”。
- 表单输入需要 label，或在语义上提供可访问名称。
- 弹窗打开后应聚焦到弹窗内容，关闭后回到触发元素。
- 错误文案使用 `text-destructive`，不要只靠颜色表达。
- 图片需要有有意义的 `alt`；装饰图可 `aria-hidden`。

对比度：

- 正文优先 `text-foreground`。
- 弱文案使用 `text-muted-foreground`，不要再叠加过低 opacity。
- `accent` 色不要直接承载大段小字号文字；小字优先用深色或语义 foreground。

## 10. 图像与媒体

Loomic 的视觉可信度来自生成作品和画布内容：

- 项目、官网、展示区优先使用真实作品图。
- 图片容器必须固定比例。
- 缩略图使用 `object-cover`。
- 可查看细节的图片不要过度加暗色蒙层、模糊或裁切。
- 视频元素需要明确播放、生成中、失败和完成状态。

## 11. 文案规范

语言：

- 产品主流程中文优先。
- 页面标题和动作按钮使用短中文。
- 模型名、技术名、品牌名保留英文。

语气：

- 直接说明动作结果：`新建项目`、`删除`、`上传 Logo`。
- 少用解释型长句。
- 错误提示说明发生了什么和用户可以做什么。
- 空状态给下一步动作，不写营销式大段介绍。

## 12. 实现约定

新增 UI 时优先复用：

- `@/components/ui/button`
- `@/components/ui/input`
- `@/components/ui/dialog`
- `@/components/ui/dropdown-menu`
- `@/components/ui/skeleton`
- `@/lib/utils` 中的 `cn`
- `lucide-react` 图标

代码规范：

- 使用 token class，不硬编码色值；确需特殊视觉时加注释说明。
- 新增复杂页面先拆成小组件，页面文件负责数据流和布局。
- 保持 class 顺序大体为：布局 -> 尺寸 -> 间距 -> 边框/圆角 -> 背景 -> 字体 -> 状态 -> 动效。
- 不在组件内注入大量 `<style>`，通用 keyframes 放到 `globals.css`。
- 高风险交互补充测试，尤其是删除、导入、支付、额度相关 UI。

## 13. Do / Don't

Do:

- 使用语义 token 和现有 UI primitives。
- 让画布、作品图、项目缩略图成为视觉中心。
- 保持工具栏紧凑，图标优先，必要时加 tooltip/title。
- 为移动端提供真实可用的触控尺寸。
- 用 skeleton 和 shimmer 保持等待时的空间稳定。

Don't:

- 不要在工作台页面做营销式大 Hero。
- 不要把多个大卡片嵌套成厚重面板。
- 不要大面积使用 accent 背景。
- 不要只靠 hover 暴露移动端必需操作。
- 不要手写一套新的按钮、输入框、弹窗样式。
- 不要使用无内容意义的装饰块、过强渐变或模糊背景抢占注意力。

## 14. 新页面检查清单

提交新 UI 前检查：

- [ ] 是否复用了现有 token 和基础组件？
- [ ] 主行动是否清晰，且每个区域只有一个主按钮？
- [ ] 移动端是否可用，底部导航是否遮挡内容？
- [ ] 所有图标按钮是否有 `aria-label` 或 `title`？
- [ ] loading、empty、error、disabled 状态是否完整？
- [ ] 图片/卡片是否有固定比例，避免布局跳动？
- [ ] 文案是否短、直接、符合当前中英混合规则？
- [ ] 危险操作是否有确认或明确 destructive 样式？
- [ ] 是否避免了大面积装饰性颜色和不必要动效？

