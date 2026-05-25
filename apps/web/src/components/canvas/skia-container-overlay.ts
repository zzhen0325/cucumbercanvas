/**
 * Container overlay rendering utilities for Skia canvas.
 *
 * Draws container-specific visuals on top of PenRenderer output:
 * - Role-colored borders
 * - Agent status indicators (idle/thinking/running/error)
 * - Shimmer animation for running containers
 * - IOPort handles
 */

import type { CanvasKit, Canvas, Paint, Surface } from "canvaskit-wasm";
import type { PenNode, PenDocument, IOPort } from "@cucumber/pen-types";
import type { RenderNode } from "@cucumber/pen-renderer";

// ---------------------------------------------------------------------------
// Role → color mapping
// ---------------------------------------------------------------------------

const ROLE_COLORS: Record<string, string> = {
  visual: "#6c5ce7",
  task: "#00b894",
  context: "#fdcb6e",
  dataflow: "#e17055",
};

const STATUS_COLORS: Record<string, string> = {
  idle: "#b2bec3",
  thinking: "#fdcb6e",
  running: "#a29bfe",
  blocked: "#e17055",
  completed: "#00b894",
  error: "#d63031",
};

/** Get border color for a container node based on its primary role */
export function getContainerBorderColor(node: PenNode): string {
  const role = node.containerRole?.[0];
  return role ? ROLE_COLORS[role] ?? "#6c5ce7" : "#6c5ce7";
}

/** Get status indicator color */
export function getStatusColor(status?: string): string {
  if (!status) return "#b2bec3";
  return STATUS_COLORS[status] ?? "#b2bec3";
}

// ---------------------------------------------------------------------------
// Container overlay drawing
// ---------------------------------------------------------------------------

export interface ContainerOverlayContext {
  ck: CanvasKit;
  zoom: number;
  /** Current timestamp for shimmer animation (ms) */
  time: number;
}

/**
 * Draw container decoration: thickened role-colored border and agent status dot.
 * Called after PenRenderer renders the base node.
 */
export function drawContainerOverlay(
  canvas: Canvas,
  renderNode: RenderNode,
  ctx: ContainerOverlayContext,
): void {
  const { node, absX, absY, absW, absH } = renderNode;
  const isContainer = node.type === "frame" || node.type === "group";
  if (!isContainer) return;

  const hasRole = (node.containerRole?.length ?? 0) > 0;
  const binding = node.agentBinding;
  if (!hasRole && !binding) return;

  const ck = ctx.ck;
  const borderColor = getContainerBorderColor(node);
  const parsed = parseHexColor(ck, borderColor);

  // Draw extra-thick border for container visibility (2px on top of base stroke)
  const paint = new ck.Paint();
  paint.setStyle(ck.PaintStyle.Stroke);
  paint.setColor(parsed);
  paint.setStrokeWidth(hasRole ? 2.5 / ctx.zoom : 1.5 / ctx.zoom);
  paint.setAntiAlias(true);

  const rx = (node as any).cornerRadius ?? 8;
  const rect = ck.LTRBRect(absX, absY, absX + absW, absY + absH);
  const rrect = ck.RRectXY(rect, rx, rx);
  canvas.drawRRect(rrect, paint);
  paint.delete();

  // Agent status dot (top-right corner)
  if (binding?.status) {
    const dotR = 5 / ctx.zoom;
    const dotX = absX + absW - dotR * 2;
    const dotY = absY + dotR * 2;
    const statusColor = getStatusColor(binding.status);

    const dotPaint = new ck.Paint();
    dotPaint.setColor(parseHexColor(ck, statusColor));
    dotPaint.setAntiAlias(true);
    canvas.drawCircle(dotX, dotY, dotR, dotPaint);

    // Pulse ring for running state
    if (binding.status === "running") {
      const pulsePhase = (ctx.time % 2000) / 2000;
      const pulseR = dotR + 4 / ctx.zoom + Math.sin(pulsePhase * Math.PI * 2) * 2 / ctx.zoom;
      const pulseAlpha = 1 - pulsePhase;

      const ringPaint = new ck.Paint();
      ringPaint.setStyle(ck.PaintStyle.Stroke);
      ringPaint.setColor(ck.Color4f(0.65, 0.6, 1.0, pulseAlpha * 0.6));
      ringPaint.setStrokeWidth(1.5 / ctx.zoom);
      ringPaint.setAntiAlias(true);
      canvas.drawCircle(dotX, dotY, pulseR, ringPaint);
      ringPaint.delete();
    }
    dotPaint.delete();
  }

  // Shimmer overlay for running state (simplified: pulsing opacity)
  if (binding?.status === "running") {
    const shimmerPhase = (ctx.time % 3000) / 3000;
    const alpha = 0.04 + Math.sin(shimmerPhase * Math.PI * 2) * 0.04;
    const shimmerPaint = new ck.Paint();
    shimmerPaint.setColor(ck.Color4f(1, 1, 1, alpha));
    shimmerPaint.setAntiAlias(true);
    canvas.drawRRect(rrect, shimmerPaint);
    shimmerPaint.delete();
  }
}

// ---------------------------------------------------------------------------
// IOPort rendering
// ---------------------------------------------------------------------------

export interface PortVisual {
  x: number;
  y: number;
  r: number;
  direction: IOPort["direction"];
  dataType: IOPort["dataType"];
}

const PORT_TYPE_COLORS: Record<string, string> = {
  image: "#00b894",
  text: "#0984e3",
  json: "#fdcb6e",
  reference: "#a29bfe",
  prompt: "#e17055",
  any: "#b2bec3",
};

/** Compute visual positions for IOPorts on a container node */
export function getPortPositions(
  renderNode: RenderNode,
  zoom: number,
): PortVisual[] {
  const { node, absX, absY, absW, absH } = renderNode;
  const ports = node.ioPorts ?? [];
  if (ports.length === 0) return [];

  const portR = 5 / zoom;
  const spacing = Math.min(absH / (ports.length + 1), 30);

  return ports.map((port: IOPort, i: number) => {
    const isInput = port.direction === "input";
    const x = isInput ? absX : absX + absW;
    const offsetY = spacing * (i + 1);
    const y = absY + offsetY;
    return { x, y, r: portR, direction: port.direction, dataType: port.dataType };
  });
}

/** Draw IOPort handles on a container */
export function drawIOPorts(
  canvas: Canvas,
  renderNode: RenderNode,
  zoom: number,
  ck: CanvasKit,
): void {
  const portVisuals = getPortPositions(renderNode, zoom);
  for (const pv of portVisuals) {
    const color = PORT_TYPE_COLORS[pv.dataType] ?? PORT_TYPE_COLORS.any!;
    const parsed = parseHexColor(ck, color);

    const fill = new ck.Paint();
    fill.setColor(parsed);
    fill.setAntiAlias(true);
    canvas.drawCircle(pv.x, pv.y, pv.r, fill);
    fill.delete();

    // White inner dot
    const inner = new ck.Paint();
    inner.setColor(ck.WHITE);
    inner.setAntiAlias(true);
    canvas.drawCircle(pv.x, pv.y, pv.r * 0.5, inner);
    inner.delete();
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function parseHexColor(ck: CanvasKit, hex: string): Float32Array {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return ck.Color4f(r, g, b, 1);
}
