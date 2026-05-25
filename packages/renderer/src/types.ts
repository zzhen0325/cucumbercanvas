import type { ContainerNode } from '@cucumber/container';
import type { CanvasFill } from '@cucumber/canvas-core';

export interface RenderNode {
  id: string;
  type: string;
  absX: number;
  absY: number;
  absW: number;
  absH: number;
  rotation: number;
  opacity: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  label?: string;
  children?: RenderNode[];
}

export interface RendererOptions {
  canvas?: HTMLCanvasElement;
  width?: number;
  height?: number;
  backgroundColor?: string;
  resolution?: number;
  antialias?: boolean;
}

export interface ShadowModeOptions {
  excalidrawCanvas: HTMLElement;
  syncViewport: boolean;
}

function extractSolidColor(fills?: CanvasFill[]): string | undefined {
  if (!fills || fills.length === 0) return undefined;
  const first = fills[0];
  if (first?.type === 'solid') return first.color;
  return undefined;
}

export function containerNodeToRenderNode(container: ContainerNode): RenderNode {
  return {
    id: container.id,
    type: 'container',
    absX: container.x ?? 0,
    absY: container.y ?? 0,
    absW: (container as any).width ?? 400,
    absH: (container as any).height ?? 300,
    rotation: 0,
    opacity: typeof container.opacity === 'number' ? container.opacity : 1,
    fill: extractSolidColor(container.fill as CanvasFill[]) ?? '#ffffff0d',
    stroke: container.stroke?.fill?.[0] && container.stroke.fill[0].type === 'solid'
      ? container.stroke.fill[0].color
      : '#666666',
    strokeWidth: typeof container.stroke?.thickness === 'number' ? container.stroke.thickness : 2,
    cornerRadius: 8,
    label: container.name ?? 'Container',
  };
}
