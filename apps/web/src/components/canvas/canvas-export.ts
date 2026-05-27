import {
  type CanvasBounds,
  type CucumberCanvasDocument,
  flattenNodes,
  getNodeBounds,
  normalizeBounds,
} from "@cucumber/canvas-core";

export type CanvasExportOptions = {
  maxWidthOrHeight?: number;
  mimeType?: string;
  bounds?: CanvasBounds;
  activePageId?: string | null;
};

export type CanvasExportSize = {
  width: number;
  height: number;
  scale: number;
};

export type CanvasExportWarningCode =
  | "unsupported-node-type"
  | "missing-image-source"
  | "unsupported-image-fill"
  | "unsupported-gradient-fill"
  | "unsupported-rich-text";

export type CanvasExportWarning = {
  code: CanvasExportWarningCode;
  nodeId: string;
  message: string;
};

type ExportableNode = {
  fill?: Array<{ color?: string; type?: string; url?: string }>;
  stroke?: {
    color?: string;
    fill?: Array<{ color?: string }>;
    thickness?: number;
  };
  color?: string;
  content?: unknown;
  fontSize?: number;
  startAnchor?: string;
  endAnchor?: string;
  _connectorType?: string;
  polygonCount?: number;
  points?: number;
  d?: string;
};

const SVG_RENDERED_NODE_TYPES = new Set([
  "frame",
  "rectangle",
  "text",
  "image",
  "line",
  "ellipse",
  "polygon",
  "path",
  "icon_font",
]);

export function calculateDocumentBounds(
  doc: CucumberCanvasDocument,
  activePageId?: string | null,
): CanvasBounds {
  const nodes = flattenNodes(doc, activePageId).filter(
    (node) => node.visible !== false,
  );
  if (nodes.length === 0) return { x: 0, y: 0, width: 800, height: 600 };
  const minX = Math.min(...nodes.map((node) => getNodeBounds(node).x));
  const minY = Math.min(...nodes.map((node) => getNodeBounds(node).y));
  const maxX = Math.max(
    ...nodes.map((node) => getNodeBounds(node).x + getNodeBounds(node).width),
  );
  const maxY = Math.max(
    ...nodes.map((node) => getNodeBounds(node).y + getNodeBounds(node).height),
  );
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function calculateExportSize(
  bounds: CanvasBounds,
  maxWidthOrHeight = 1024,
): CanvasExportSize {
  const normalized = normalizeBounds(bounds);
  const scale = Math.min(
    1,
    maxWidthOrHeight / Math.max(normalized.width, normalized.height, 1),
  );
  return {
    width: Math.max(1, Math.round(normalized.width * scale)),
    height: Math.max(1, Math.round(normalized.height * scale)),
    scale,
  };
}

export function analyzeDocumentExportWarnings(
  doc: CucumberCanvasDocument,
  opts?: Pick<CanvasExportOptions, "activePageId" | "bounds">,
): CanvasExportWarning[] {
  return flattenNodes(doc, opts?.activePageId)
    .filter((node) => node.visible !== false)
    .filter((node) =>
      opts?.bounds ? boundsIntersect(getNodeBounds(node), opts.bounds) : true,
    )
    .flatMap((node) => {
      const warnings: CanvasExportWarning[] = [];
      if (!SVG_RENDERED_NODE_TYPES.has(node.type)) {
        warnings.push({
          code: "unsupported-node-type",
          nodeId: node.id,
          message: `Node "${node.id}" uses unsupported type "${node.type}" and will be exported as a rectangle.`,
        });
      }
      if (
        node.type === "image" &&
        (typeof node.src !== "string" || node.src.trim().length === 0)
      ) {
        warnings.push({
          code: "missing-image-source",
          nodeId: node.id,
          message: `Image node "${node.id}" is missing a usable source and may not appear in the export.`,
        });
      }
      const n = node as ExportableNode;
      if (
        node.type !== "image" &&
        n.fill?.some((fill) => fill.type === "image")
      ) {
        warnings.push({
          code: "unsupported-image-fill",
          nodeId: node.id,
          message: `Node "${node.id}" uses an image fill that is not preserved by SVG export and will be exported with a fallback fill.`,
        });
      }
      if (
        n.fill?.some(
          (fill) =>
            fill.type === "linear_gradient" || fill.type === "radial_gradient",
        )
      ) {
        warnings.push({
          code: "unsupported-gradient-fill",
          nodeId: node.id,
          message: `Node "${node.id}" uses a gradient fill that is not preserved by SVG export and will be exported with a fallback fill.`,
        });
      }
      if (node.type === "text" && Array.isArray(n.content)) {
        warnings.push({
          code: "unsupported-rich-text",
          nodeId: node.id,
          message: `Text node "${node.id}" uses rich text segments that are not preserved by SVG export and will be exported as plain text.`,
        });
      }
      return warnings;
    });
}

function boundsIntersect(a: CanvasBounds, b: CanvasBounds): boolean {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > left && bottom > top;
}

export async function exportDocumentImage(
  doc: CucumberCanvasDocument,
  opts?: CanvasExportOptions,
  canvasViewport?: { backgroundColor?: string },
): Promise<Blob> {
  const bounds = normalizeBounds(
    opts?.bounds ?? calculateDocumentBounds(doc, opts?.activePageId),
  );
  const { scale } = calculateExportSize(bounds, opts?.maxWidthOrHeight);
  const svg = renderDocumentSvg(
    doc,
    bounds,
    scale,
    canvasViewport,
    opts?.activePageId,
  );
  return new Blob([svg], { type: opts?.mimeType ?? "image/svg+xml" });
}

function renderDocumentSvg(
  doc: CucumberCanvasDocument,
  bounds: CanvasBounds,
  scale: number,
  canvasViewport?: { backgroundColor?: string },
  activePageId?: string | null,
): string {
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const nodes = flattenNodes(doc, activePageId)
    .filter((node) => node.visible !== false)
    .map((node) => {
      const nodeBounds = getNodeBounds(node);
      const x = (nodeBounds.x - bounds.x) * scale;
      const y = (nodeBounds.y - bounds.y) * scale;
      const w = nodeBounds.width * scale;
      const h = nodeBounds.height * scale;
      const n = node as ExportableNode;
      const transform = nodeBounds.rotation
        ? ` transform="rotate(${nodeBounds.rotation} ${x + w / 2} ${y + h / 2})"`
        : "";
      if (node.type === "text") {
        const fontSize = (n.fontSize ?? 16) * scale;
        const textContent = extractPlainText(n.content);
        return `<text x="${x}" y="${y + fontSize}" font-size="${fontSize}" fill="${escapeAttr(n.color ?? "#111827")}"${transform}>${escapeText(textContent)}</text>`;
      }
      if (node.type === "image") {
        return `<image href="${escapeAttr(node.src)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"${transform} />`;
      }
      if (node.type === "line") {
        const startAnchor = n.startAnchor ?? "tl";
        const endAnchor = n.endAnchor ?? "br";
        const start = anchorToPoint(startAnchor, w, h);
        const end = anchorToPoint(endAnchor, w, h);
        const markerId = `svg-marker-${escapeAttr(node.id)}`;
        const strokeColor = n.stroke?.fill?.[0]?.color ?? "#111827";
        const defs =
          n._connectorType === "arrow"
            ? `<defs><marker id="${markerId}" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="${escapeAttr(strokeColor)}" /></marker></defs>`
            : "";
        return `${defs}<line x1="${x + start.x}" y1="${y + start.y}" x2="${x + end.x}" y2="${y + end.y}" stroke="${escapeAttr(strokeColor)}" stroke-width="${n.stroke?.thickness ?? 3}" stroke-linecap="round"${n._connectorType === "arrow" ? ` marker-end="url(#${markerId})"` : ""}${transform} />`;
      }
      if (node.type === "ellipse") {
        const fillColor = n.fill?.[0]?.color ?? "#f8fafc";
        const strokeColor = n.stroke?.fill?.[0]?.color ?? "none";
        return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${escapeAttr(fillColor)}" stroke="${escapeAttr(strokeColor)}" stroke-width="${n.stroke?.thickness ?? 0}"${transform} />`;
      }
      if (node.type === "polygon") {
        const fillColor = n.fill?.[0]?.color ?? "#f8fafc";
        const strokeColor = n.stroke?.fill?.[0]?.color ?? "none";
        const polyCount = n.polygonCount ?? n.points ?? 3;
        return `<polygon points="${createPolygonPoints(polyCount, w, h)
          .split(" ")
          .map((point) => {
            const [px, py] = point.split(",").map(Number);
            return `${x + (px ?? 0)},${y + (py ?? 0)}`;
          })
          .join(
            " ",
          )}" fill="${escapeAttr(fillColor)}" stroke="${escapeAttr(strokeColor)}" stroke-width="${n.stroke?.thickness ?? 0}"${transform} />`;
      }
      if (node.type === "path") {
        return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${nodeBounds.width} ${nodeBounds.height}" overflow="visible"${transform}><path d="${escapeAttr(n.d ?? "")}" fill="${escapeAttr(n.fill?.[0]?.color ?? "none")}" stroke="${escapeAttr(n.stroke?.fill?.[0]?.color ?? "none")}" stroke-width="${n.stroke?.thickness ?? 0}" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
      }
      if (node.type === "icon_font") {
        return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 24 24"${transform}><path d="M12 3 10.3 8.3 5 10l5.3 1.7L12 17l1.7-5.3L19 10l-5.3-1.7L12 3Z" fill="${escapeAttr(n.fill?.[0]?.color ?? "none")}" stroke="${escapeAttr(n.stroke?.fill?.[0]?.color ?? "#64748B")}" stroke-width="${n.stroke?.thickness ?? 2}" stroke-linejoin="round" /></svg>`;
      }
      const fill =
        node.type === "frame"
          ? (n.fill?.[0]?.color ?? "rgba(255,255,255,.78)")
          : node.type === "rectangle"
            ? (n.fill?.[0]?.color ?? "#d3f256")
            : "#111827";
      const stroke =
        node.type === "frame"
          ? (n.stroke?.color ?? "#6c5ce7")
          : node.type === "rectangle"
            ? (n.stroke?.fill?.[0]?.color ?? "none")
            : "none";
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${n.stroke?.thickness ?? 0}"${transform} />`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${escapeAttr(canvasViewport?.backgroundColor ?? "#f0f0f0")}"/>${nodes}</svg>`;
}

function createPolygonPoints(points: number, width: number, height: number) {
  const count = Math.max(3, Math.round(points));
  const raw = Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
  const minX = Math.min(...raw.map((point) => point.x));
  const maxX = Math.max(...raw.map((point) => point.x));
  const minY = Math.min(...raw.map((point) => point.y));
  const maxY = Math.max(...raw.map((point) => point.y));
  const rawW = Math.max(maxX - minX, 1);
  const rawH = Math.max(maxY - minY, 1);
  return raw
    .map((point) => {
      const x = ((point.x - minX) / rawW) * width;
      const y = ((point.y - minY) / rawH) * height;
      return `${x},${y}`;
    })
    .join(" ");
}

function anchorToPoint(
  anchor: string,
  width: number,
  height: number,
): { x: number; y: number } {
  switch (anchor) {
    case "tr":
      return { x: width, y: 0 };
    case "bl":
      return { x: 0, y: height };
    case "br":
      return { x: width, y: height };
    default:
      return { x: 0, y: 0 };
  }
}

function escapeText(value: string): string {
  return value.replace(
    /[&<>]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch] ?? ch,
  );
}

function extractPlainText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((segment) =>
        typeof segment === "string"
          ? segment
          : isRecord(segment) && typeof segment.text === "string"
            ? segment.text
            : "",
      )
      .join("");
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}
