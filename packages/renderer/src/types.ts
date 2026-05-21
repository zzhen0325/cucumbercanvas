import type { ContainerNode, ContainerBounds } from '@cucumber/container';

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

export function containerNodeToRenderNode(container: ContainerNode): RenderNode {
  return {
    id: container.id,
    type: 'container',
    absX: container.bounds.x,
    absY: container.bounds.y,
    absW: container.bounds.width,
    absH: container.bounds.height,
    rotation: 0,
    opacity: container.style?.opacity ?? 1,
    fill: container.style?.fill ?? '#ffffff0d',
    stroke: container.style?.stroke ?? '#666666',
    strokeWidth: 2,
    cornerRadius: 8,
    label: container.style?.label ?? 'Container',
  };
}
