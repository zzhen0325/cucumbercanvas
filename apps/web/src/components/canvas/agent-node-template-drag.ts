"use client";

export const CANVAS_NODE_TEMPLATE_MIME =
  "application/x-cucumber-canvas-node-template";

export type CanvasNodeTemplatePayload = {
  type: "agent_input_node";
  text?: string;
};

export function writeCanvasNodeTemplateDragPayload(
  dataTransfer: DataTransfer,
  payload: CanvasNodeTemplatePayload,
) {
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(CANVAS_NODE_TEMPLATE_MIME, JSON.stringify(payload));
}

export function hasCanvasNodeTemplateDragPayload(
  dataTransfer: DataTransfer | null,
): boolean {
  return Boolean(dataTransfer?.types?.includes(CANVAS_NODE_TEMPLATE_MIME));
}

export function readCanvasNodeTemplateDragPayload(
  dataTransfer: DataTransfer,
): CanvasNodeTemplatePayload {
  const raw = dataTransfer.getData(CANVAS_NODE_TEMPLATE_MIME);
  if (!raw) {
    throw new Error("拖拽内容缺少画布节点模板信息，请从工具栏重新拖出节点。");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("拖拽内容不是有效的画布节点模板，请从工具栏重新拖出节点。");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("拖拽内容不是有效的画布节点模板，请从工具栏重新拖出节点。");
  }
  const payload = parsed as Record<string, unknown>;
  if (payload.type !== "agent_input_node") {
    throw new Error("暂不支持拖入这个节点模板，请选择工具栏里的 InputNode。");
  }
  return {
    type: "agent_input_node",
    ...(typeof payload.text === "string" ? { text: payload.text } : {}),
  };
}
