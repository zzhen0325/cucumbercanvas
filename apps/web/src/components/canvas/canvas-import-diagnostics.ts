import type { CanvasImportResult, ImportNode } from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";

export function getClipboardImportStrategy(result: CanvasImportResult): string {
  if (result.source !== "figma") return result.source;
  const usedNative = result.nodes.some((node) => {
    const meta = (node as { meta?: Record<string, unknown> }).meta;
    return meta?.originNodeType === "figma-native";
  });
  return usedNative ? "figma-native" : "figma-html-fallback";
}

export function summarizeImportedNodes(result: CanvasImportResult) {
  return result.nodes.slice(0, 20).map((node) => {
    const record = node as Partial<ImportNode> &
      Partial<PenNode> & {
        fill?: Array<{ type?: string }>;
        fills?: Array<{ type?: string }>;
        childrenOrder?: string[];
        children?: PenNode[];
      };
    const bounds =
      record.bounds ??
      ({
        x: record.x ?? 0,
        y: record.y ?? 0,
        width:
          typeof (record as Record<string, unknown>).width === "number"
            ? (record as Record<string, number>).width
            : undefined,
        height:
          typeof (record as Record<string, unknown>).height === "number"
            ? (record as Record<string, number>).height
            : undefined,
      } as Record<string, unknown>);
    const fills = record.fills ?? record.fill;
    const meta = record.meta as Record<string, unknown> | undefined;
    return {
      id: record.id,
      type: record.type,
      title: record.title ?? record.name,
      bounds,
      fillTypes: fills?.map((fill) => fill.type ?? "unknown"),
      hasStroke: Boolean(record.stroke),
      childCount: record.childrenOrder?.length ?? record.children?.length ?? 0,
      autoLayout: meta?.autoLayout,
    };
  });
}
