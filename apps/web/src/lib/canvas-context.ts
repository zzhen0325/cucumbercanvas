import type { CanvasContextRef } from "@cucumber/shared";

import type { CanvasSelectedElement } from "../components/canvas-editor";

export function buildCanvasContextRefs(
  selectedElements: CanvasSelectedElement[],
): CanvasContextRef[] {
  return selectedElements.flatMap<CanvasContextRef>((element) => {
    const base = {
      elementId: element.id,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };

    if (element.type === "text" && element.text?.trim()) {
      return [
        {
          kind: "text" as const,
          ...base,
          text: element.text.trim(),
        },
      ];
    }

    if (element.type === "image" && (element.storageUrl || element.dataUrl)) {
      return [
        {
          kind: "image" as const,
          ...base,
          ...(element.fileId ? { assetId: element.id } : {}),
          ...(element.storageUrl ? { storageUrl: element.storageUrl } : {}),
          ...(element.dataUrl ? { dataUrl: element.dataUrl } : {}),
          ...(element.mimeType ? { mimeType: element.mimeType } : {}),
          ...(element.title ? { title: element.title } : {}),
        },
      ];
    }

    if (element.type === "embeddable" && element.link) {
      return [
        {
          kind: "video" as const,
          ...base,
          url: element.link,
          ...(element.mimeType ? { mimeType: element.mimeType } : {}),
          ...(element.title ? { title: element.title } : {}),
          ...(typeof element.durationSeconds === "number"
            ? { durationSeconds: element.durationSeconds }
            : {}),
        },
      ];
    }

    return [
      {
        kind: "shape" as const,
        ...base,
        shapeType: element.shapeType ?? element.type,
        ...(element.title ? { label: element.title } : {}),
        ...(element.text?.trim() ? { text: element.text.trim() } : {}),
      },
    ];
  });
}

export function summarizeCanvasSelection(
  selectedElements: CanvasSelectedElement[],
): Array<{
  id: string;
  kind: "text" | "image" | "video" | "shape";
  label: string;
}> {
  return selectedElements.map((element) => {
    if (element.type === "text") {
      return {
        id: element.id,
        kind: "text" as const,
        label: `文字: ${truncate(element.text ?? "未命名文本", 24)}`,
      };
    }

    if (element.type === "image") {
      return {
        id: element.id,
        kind: "image" as const,
        label: `图片: ${truncate(element.title ?? element.id, 24)}`,
      };
    }

    if (element.type === "embeddable") {
      return {
        id: element.id,
        kind: "video" as const,
        label: `视频: ${truncate(element.title ?? element.id, 24)}`,
      };
    }

    return {
      id: element.id,
      kind: "shape" as const,
      label: `形状: ${truncate(element.shapeType ?? element.type, 24)}`,
    };
  });
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 1)}...`
    : value;
}
