import type { DataFlowEdge } from '@cucumber/container';
import type { ContainerManager, IOPort } from '@cucumber/container';
import type { DataFlowEngine } from '@cucumber/container';
import { DataFlowParticleSystem } from '../filters/dataflow-particle-system.js';
import type { FlowPathPoint } from '../filters/dataflow-particle-system.js';

export interface DataFlowRendererOptions {
  edgeColor?: string;
  edgeWidth?: number;
  activeColor?: string;
  errorColor?: string;
  particleEnabled?: boolean;
}

interface EdgeVisual {
  graphics: any;
  particleSystem: DataFlowParticleSystem | null;
  path: FlowPathPoint[];
}

export class DataFlowRenderer {
  private stage: any = null;
  private edgeVisuals = new Map<string, EdgeVisual>();
  private dataFlowEngine: DataFlowEngine;
  private containerManager: ContainerManager;
  private options: Required<DataFlowRendererOptions>;
  private edgeContainer: any = null;

  constructor(
    dataFlowEngine: DataFlowEngine,
    containerManager: ContainerManager,
    options?: DataFlowRendererOptions
  ) {
    this.dataFlowEngine = dataFlowEngine;
    this.containerManager = containerManager;
    this.options = {
      edgeColor: options?.edgeColor ?? '#4ECDC4',
      edgeWidth: options?.edgeWidth ?? 2,
      activeColor: options?.activeColor ?? '#00ff88',
      errorColor: options?.errorColor ?? '#ff4444',
      particleEnabled: options?.particleEnabled ?? true,
    };
  }

  async init(stage: any): Promise<void> {
    const { Container: PixiContainer } = await import('pixi.js');
    this.stage = stage;
    this.edgeContainer = new PixiContainer();
    this.edgeContainer.label = 'dataflow-edges';
    stage.addChild(this.edgeContainer);

    this.dataFlowEngine.on('edge:add', (edge) => this.addEdgeVisual(edge));
    this.dataFlowEngine.on('edge:remove', (id) => this.removeEdgeVisual(id));
    this.dataFlowEngine.on('edge:status', (id, status) => this.updateEdgeStatus(id, status));
  }

  async addEdgeVisual(edge: DataFlowEdge): Promise<void> {
    if (!this.edgeContainer) return;
    const { Graphics } = await import('pixi.js');

    const graphics = new Graphics();
    graphics.label = `edge-${edge.id}`;

    const path = this.computeEdgePath(edge);
    this.drawEdgeLine(graphics, path, edge.status);
    this.edgeContainer.addChild(graphics);

    let particleSystem: DataFlowParticleSystem | null = null;
    if (this.options.particleEnabled) {
      particleSystem = new DataFlowParticleSystem({
        color: this.hexToRgb(this.options.edgeColor),
        speed: 1.0,
        particleCount: 8,
        particleSize: 3,
      });
      await particleSystem.create(this.edgeContainer);
      particleSystem.setPath(path);
      particleSystem.setActive(edge.status === 'flowing');
    }

    this.edgeVisuals.set(edge.id, { graphics, particleSystem, path });
  }

  removeEdgeVisual(id: string): void {
    const visual = this.edgeVisuals.get(id);
    if (!visual) return;

    visual.graphics.destroy();
    visual.particleSystem?.destroy();
    this.edgeVisuals.delete(id);
  }

  updateEdgeStatus(id: string, status: DataFlowEdge['status']): void {
    const visual = this.edgeVisuals.get(id);
    if (!visual) return;

    const edge = this.dataFlowEngine.getEdge(id);
    if (!edge) return;

    visual.graphics.clear();
    this.drawEdgeLine(visual.graphics, visual.path, status);

    if (visual.particleSystem) {
      visual.particleSystem.setActive(status === 'flowing');
      if (status === 'flowing') {
        visual.particleSystem.setColor(this.hexToRgb(this.options.activeColor));
      } else if (status === 'error') {
        visual.particleSystem.setColor(this.hexToRgb(this.options.errorColor));
      } else {
        visual.particleSystem.setColor(this.hexToRgb(this.options.edgeColor));
      }
    }
  }

  update(deltaTime: number): void {
    for (const visual of this.edgeVisuals.values()) {
      visual.particleSystem?.update(deltaTime);
    }
  }

  refreshAllEdges(): void {
    for (const [id, visual] of this.edgeVisuals) {
      const edge = this.dataFlowEngine.getEdge(id);
      if (!edge) continue;

      const path = this.computeEdgePath(edge);
      visual.path = path;
      visual.graphics.clear();
      this.drawEdgeLine(visual.graphics, path, edge.status);
      visual.particleSystem?.setPath(path);
    }
  }

  destroy(): void {
    for (const visual of this.edgeVisuals.values()) {
      visual.graphics.destroy();
      visual.particleSystem?.destroy();
    }
    this.edgeVisuals.clear();
    if (this.edgeContainer) {
      this.edgeContainer.destroy({ children: true });
      this.edgeContainer = null;
    }
  }

  private computeEdgePath(edge: DataFlowEdge): FlowPathPoint[] {
    const sourceContainer = this.containerManager.getContainer(edge.source.nodeId);
    const targetContainer = this.containerManager.getContainer(edge.target.nodeId);
    if (!sourceContainer || !targetContainer) return [];

    const sourcePort = sourceContainer.ioPorts.find(p => p.id === edge.source.portId);
    const targetPort = targetContainer.ioPorts.find(p => p.id === edge.target.portId);
    if (!sourcePort || !targetPort) return [];

    const sourcePos = this.getPortWorldPosition(sourceContainer, sourcePort);
    const targetPos = this.getPortWorldPosition(targetContainer, targetPort);

    const dx = targetPos.x - sourcePos.x;
    const controlOffset = Math.max(Math.abs(dx) * 0.4, 50);

    return [
      sourcePos,
      { x: sourcePos.x + controlOffset, y: sourcePos.y },
      { x: targetPos.x - controlOffset, y: targetPos.y },
      targetPos,
    ];
  }

  private getPortWorldPosition(container: any, port: IOPort): FlowPathPoint {
    const { bounds, ioPorts } = container;
    const sameDirPorts = ioPorts.filter((p: IOPort) => p.direction === port.direction);
    const idx = sameDirPorts.indexOf(port);
    const spacing = bounds.height / (sameDirPorts.length + 1);

    if (port.direction === 'output') {
      return { x: bounds.x + bounds.width, y: bounds.y + spacing * (idx + 1) };
    }
    return { x: bounds.x, y: bounds.y + spacing * (idx + 1) };
  }

  private drawEdgeLine(graphics: any, path: FlowPathPoint[], status: DataFlowEdge['status']): void {
    if (path.length < 2) return;

    const color = status === 'flowing'
      ? this.options.activeColor
      : status === 'error'
        ? this.options.errorColor
        : this.options.edgeColor;

    const alpha = status === 'flowing' ? 1.0 : 0.6;

    graphics.moveTo(path[0]!.x, path[0]!.y);

    if (path.length === 4) {
      graphics.bezierCurveTo(
        path[1]!.x, path[1]!.y,
        path[2]!.x, path[2]!.y,
        path[3]!.x, path[3]!.y
      );
    } else {
      for (let i = 1; i < path.length; i++) {
        graphics.lineTo(path[i]!.x, path[i]!.y);
      }
    }

    graphics.stroke({ color, width: this.options.edgeWidth, alpha });

    const lastPoint = path[path.length - 1]!;
    const prevPoint = path[path.length - 2]!;
    this.drawArrowHead(graphics, prevPoint, lastPoint, color, alpha);
  }

  private drawArrowHead(
    graphics: any,
    from: FlowPathPoint,
    to: FlowPathPoint,
    color: string,
    alpha: number
  ): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const arrowSize = 8;

    const p1x = to.x - arrowSize * Math.cos(angle - Math.PI / 6);
    const p1y = to.y - arrowSize * Math.sin(angle - Math.PI / 6);
    const p2x = to.x - arrowSize * Math.cos(angle + Math.PI / 6);
    const p2y = to.y - arrowSize * Math.sin(angle + Math.PI / 6);

    graphics.moveTo(to.x, to.y);
    graphics.lineTo(p1x, p1y);
    graphics.lineTo(p2x, p2y);
    graphics.lineTo(to.x, to.y);
    graphics.fill({ color, alpha });
  }

  private hexToRgb(hex: string): [number, number, number] {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    return [r, g, b];
  }
}
