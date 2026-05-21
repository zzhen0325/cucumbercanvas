export type ToolType =
  | 'select'
  | 'frame'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'polygon'
  | 'path'
  | 'text'
  | 'hand'
  | 'container';

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface SelectionState {
  selectedIds: string[];
  activeId: string | null;
  hoveredId: string | null;
  enteredFrameId: string | null;
  enteredFrameStack: string[];
}

export interface CanvasInteraction {
  isDrawing: boolean;
  isPanning: boolean;
  isDragging: boolean;
  drawStartPoint: { x: number; y: number } | null;
}
