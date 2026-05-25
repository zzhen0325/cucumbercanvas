import type { PenNode } from '@cucumber/pen-types';

/** Lightweight RenderNode for spatial queries (will use full pen-renderer in Phase 3) */
export interface EngineRenderNode {
  node: PenNode;
  x: number;
  y: number;
  width: number;
  height: number;
  clip?: boolean;
}

/**
 * Simple in-memory spatial index.
 * Uses linear scan for Phase 2. Will be replaced with R-tree backed
 * SpatialIndex from @cucumber/pen-renderer in Phase 3.
 */
export class EngineSpatialIndex {
  private nodes: EngineRenderNode[] = [];

  rebuild(nodes: EngineRenderNode[]): void {
    this.nodes = [...nodes];
  }

  hitTest(sceneX: number, sceneY: number): EngineRenderNode[] {
    const hits: EngineRenderNode[] = [];
    for (const rn of this.nodes) {
      if (
        sceneX >= rn.x &&
        sceneX <= rn.x + rn.width &&
        sceneY >= rn.y &&
        sceneY <= rn.y + rn.height
      ) {
        if (!rn.clip) hits.push(rn);
      }
    }
    return hits.reverse(); // topmost first
  }

  searchRect(x: number, y: number, w: number, h: number): EngineRenderNode[] {
    return this.nodes.filter((rn) => {
      return rn.x < x + w && rn.x + rn.width > x && rn.y < y + h && rn.y + rn.height > y;
    });
  }

  get(nodeId: string): EngineRenderNode | undefined {
    return this.nodes.find((rn) => rn.node.id === nodeId);
  }

  hitTestNode(sceneX: number, sceneY: number): PenNode | null {
    const hits = this.hitTest(sceneX, sceneY);
    return hits.length > 0 ? hits[0]!.node : null;
  }

  searchRectNodes(x: number, y: number, w: number, h: number): PenNode[] {
    return this.searchRect(x, y, w, h).map((rn) => rn.node);
  }
}
