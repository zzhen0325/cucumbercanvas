import type { PenDocument } from './pen.js';
import type { ViewportState, ToolType } from './canvas.js';

export interface DesignEngineOptions {
  backgroundColor?: string;
  devicePixelRatio?: number;
  maxHistoryStates?: number;
}

export interface DesignEngineEvents {
  'document:change': (doc: PenDocument) => void;
  'selection:change': (ids: string[]) => void;
  'viewport:change': (state: ViewportState) => void;
  'tool:change': (tool: ToolType) => void;
  'history:change': (state: { canUndo: boolean; canRedo: boolean }) => void;
  'node:hover': (id: string | null) => void;
  render: () => void;
}

export interface AgentIndicatorEntry {
  nodeId: string;
  color: string;
  name: string;
}

export interface AgentFrameEntry {
  frameId: string;
  color: string;
  name: string;
}

export interface InsertionIndicator {
  x: number;
  y: number;
  length: number;
  orientation: 'horizontal' | 'vertical';
}

export interface ContainerHighlight {
  x: number;
  y: number;
  w: number;
  h: number;
}
