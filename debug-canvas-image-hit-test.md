# Debug Session: canvas-image-hit-test

- Status: OPEN
- Symptom: 生成图片后，画布交互阶段抛出 `Cannot read properties of undefined (reading 'length')`，调用栈落在 Excalidraw `isTransparent()`.
- Scope: `apps/web` 画布图片生成/插入链路

## Hypotheses

1. 新插入的图片元素缺少 Excalidraw 命中测试所需的透明度数据字段，导致 `isTransparent()` 读取 `undefined.length`。
2. 图片生成完成后有二次 patch 元素属性的逻辑，把原始图片元素上的某个位图/裁剪相关字段覆盖成了 `undefined`。
3. 历史恢复、Agent 生图、用户上传共用了同一插入路径，但只有其中一条路径会跳过透明度缓存初始化。
4. 命中测试发生在图片资源尚未完全解码时，元素已经可交互，但关联的像素/透明度元信息还未就绪。
5. 某个自定义元素映射或序列化逻辑把图片当成普通 shape 处理，生成了不完整的 image element 数据。

## Next Step

- Debug server:
  - URL: `http://127.0.0.1:7777/event`
  - Env file: `.dbg/canvas-image-hit-test.env`
- Instrumentation:
  - `apps/web/src/lib/canvas-elements.ts`
    - A: 图片元素构造快照
    - B: `insertImageOnCanvas()` 更新前/后 scene 快照
  - `apps/web/src/components/canvas/image-generator-panel.tsx`
    - E: 占位元素替换前/后快照
- Evidence so far:
  - Excalidraw `isTransparent(color)` 直接读取 `color.length`，已确认某些 scene 元素会丢失 `backgroundColor`。
  - Excalidraw 多处直接读取 `element.groupIds.includes(...)`，post-fix 新报错说明某些 scene 元素也会丢失 `groupIds`。
  - 后端 `fetchCanvas` load path 会把文件解析成 `storageUrl` 并清空 `dataURL`；此前 `handleCanvasSync()` 直接把这类文件传给 `api.addFiles()`，会导致图片元素长期处于 loading。
- Fixes in progress:
  - 图片元素创建切换为 `convertToExcalidrawElements(..., { regenerateIds: false })`
  - `normalizeCanvasElements()` 统一补齐缺失的 `backgroundColor` / `groupIds`
  - `CanvasEditor.onChange()` 在 scene 流入时即时修复缺失字段，阻断崩溃态继续传播
  - `handleCanvasSync()` 现在会把同步回来的 `storageUrl` 文件先转成 `dataURL` 再注入 Excalidraw
