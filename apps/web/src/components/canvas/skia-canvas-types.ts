import type { CanvasBounds } from "@cucumber/canvas-core";
import type {
  PenConnectorEndpointBinding,
  PenConnectorSide,
  PenDocument,
} from "@cucumber/pen-types";

import type { DrawableCanvasTool, ResizeHandle } from "./canvas-draw-geometry";

export type PendingRendererDocumentSync = {
  activePageId: string;
  coalescedCount: number;
  deferredForDrag: boolean;
  document: PenDocument;
  source: string;
  version: number;
};

export type DragState =
  | {
      kind: "pan";
      button: number;
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  | {
      kind: "move";
      nodeIds: string[];
      startPoint: { x: number; y: number };
      origins: Record<string, CanvasBounds>;
      hasMoved: boolean;
      sceneDelta: { x: number; y: number };
    }
  | {
      kind: "resize";
      nodeId: string;
      handle: ResizeHandle;
      startPoint: { x: number; y: number };
      origin: CanvasBounds;
      preserveAspectRatio: boolean;
      sceneDelta: { x: number; y: number };
    }
  | {
      kind: "lineEndpoint";
      nodeId: string;
      endpoint: "start" | "end";
      startPoint: { x: number; y: number };
      originStart: { x: number; y: number };
      originEnd: { x: number; y: number };
    }
  | {
      kind: "stickyConnector";
      nodeId: string;
      side: PenConnectorSide;
      startPoint: { x: number; y: number };
      sourceBounds: CanvasBounds;
    }
  | {
      kind: "rotate";
      nodeId: string;
      center: { x: number; y: number };
      originRotation: number;
      startAngle: number;
    }
  | {
      kind: "drawShape";
      shapeType: DrawableCanvasTool;
      startPoint: { x: number; y: number };
      startConnector?: PenConnectorEndpointBinding;
      fromCenter: boolean;
    }
  | {
      kind: "drawText";
      startPoint: { x: number; y: number };
      startScreenX: number;
      startScreenY: number;
      hasMoved: boolean;
    }
  | {
      kind: "pen";
    }
  | {
      kind: "marquee";
      startPoint: { x: number; y: number };
      originSelection: string[];
    };
