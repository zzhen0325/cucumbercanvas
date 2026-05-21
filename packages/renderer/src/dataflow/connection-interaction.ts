import type { ContainerManager, IOPort } from '@cucumber/container';
import type { DataFlowEngine } from '@cucumber/container';
import { isPortCompatible } from '@cucumber/container';
import type { IOPortRenderer } from './io-port-renderer.js';

export type ConnectionState = 'idle' | 'dragging' | 'validTarget' | 'invalidTarget';

export interface ConnectionDragState {
  state: ConnectionState;
  sourceContainerId: string | null;
  sourcePortId: string | null;
  sourceDirection: IOPort['direction'] | null;
  mouseX: number;
  mouseY: number;
}

export interface ConnectionInteractionEvents {
  'drag:start': (state: ConnectionDragState) => void;
  'drag:move': (state: ConnectionDragState) => void;
  'drag:end': (success: boolean) => void;
  'connection:preview': (
    sourceContainerId: string,
    sourcePortId: string,
    targetContainerId: string,
    targetPortId: string,
    compatible: boolean
  ) => void;
}

let edgeIdCounter = 0;
function generateEdgeId(): string {
  return `edge_${Date.now()}_${++edgeIdCounter}`;
}

export class ConnectionInteraction {
  private containerManager: ContainerManager;
  private dataFlowEngine: DataFlowEngine;
  private portRenderer: IOPortRenderer;
  private dragState: ConnectionDragState = {
    state: 'idle',
    sourceContainerId: null,
    sourcePortId: null,
    sourceDirection: null,
    mouseX: 0,
    mouseY: 0,
  };
  private previewGraphics: any = null;
  private stage: any = null;
  private listeners: Map<string, Set<Function>> = new Map();

  constructor(
    containerManager: ContainerManager,
    dataFlowEngine: DataFlowEngine,
    portRenderer: IOPortRenderer
  ) {
    this.containerManager = containerManager;
    this.dataFlowEngine = dataFlowEngine;
    this.portRenderer = portRenderer;
  }

  async init(stage: any): Promise<void> {
    const { Graphics } = await import('pixi.js');
    this.stage = stage;
    this.previewGraphics = new Graphics();
    this.previewGraphics.label = 'connection-preview';
    this.previewGraphics.zIndex = 1000;
    stage.addChild(this.previewGraphics);
  }

  startDrag(containerId: string, portId: string, direction: IOPort['direction'], x: number, y: number): void {
    this.dragState = {
      state: 'dragging',
      sourceContainerId: containerId,
      sourcePortId: portId,
      sourceDirection: direction,
      mouseX: x,
      mouseY: y,
    };
    this.emitEvent('drag:start', this.dragState);
  }

  moveDrag(x: number, y: number): void {
    if (this.dragState.state === 'idle') return;

    this.dragState.mouseX = x;
    this.dragState.mouseY = y;

    const targetPort = this.portRenderer.getPortAtPosition(x, y);
    if (targetPort && this.canConnect(targetPort.containerId, targetPort.portId)) {
      this.dragState.state = 'validTarget';
      this.emitEvent('connection:preview',
        this.dragState.sourceContainerId!,
        this.dragState.sourcePortId!,
        targetPort.containerId,
        targetPort.portId,
        true
      );
    } else if (targetPort) {
      this.dragState.state = 'invalidTarget';
      this.emitEvent('connection:preview',
        this.dragState.sourceContainerId!,
        this.dragState.sourcePortId!,
        targetPort.containerId,
        targetPort.portId,
        false
      );
    } else {
      this.dragState.state = 'dragging';
    }

    this.drawPreviewLine();
    this.emitEvent('drag:move', this.dragState);
  }

  endDrag(x: number, y: number): boolean {
    if (this.dragState.state === 'idle') return false;

    const targetPort = this.portRenderer.getPortAtPosition(x, y);
    let success = false;

    if (targetPort && this.canConnect(targetPort.containerId, targetPort.portId)) {
      const sourceDir = this.dragState.sourceDirection;
      const edgeSource = sourceDir === 'output'
        ? { nodeId: this.dragState.sourceContainerId!, portId: this.dragState.sourcePortId! }
        : { nodeId: targetPort.containerId, portId: targetPort.portId };
      const edgeTarget = sourceDir === 'output'
        ? { nodeId: targetPort.containerId, portId: targetPort.portId }
        : { nodeId: this.dragState.sourceContainerId!, portId: this.dragState.sourcePortId! };

      const edge = this.dataFlowEngine.addEdge({
        id: generateEdgeId(),
        source: edgeSource,
        target: edgeTarget,
      });
      success = edge !== null;
    }

    this.clearPreview();
    this.dragState = {
      state: 'idle',
      sourceContainerId: null,
      sourcePortId: null,
      sourceDirection: null,
      mouseX: 0,
      mouseY: 0,
    };
    this.emitEvent('drag:end', success);
    return success;
  }

  cancelDrag(): void {
    this.clearPreview();
    this.dragState = {
      state: 'idle',
      sourceContainerId: null,
      sourcePortId: null,
      sourceDirection: null,
      mouseX: 0,
      mouseY: 0,
    };
    this.emitEvent('drag:end', false);
  }

  getDragState(): ConnectionDragState {
    return { ...this.dragState };
  }

  on<K extends keyof ConnectionInteractionEvents>(
    event: K,
    callback: Function
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => { this.listeners.get(event)?.delete(callback); };
  }

  destroy(): void {
    this.clearPreview();
    this.previewGraphics?.destroy();
    this.listeners.clear();
  }

  private canConnect(targetContainerId: string, targetPortId: string): boolean {
    if (!this.dragState.sourceContainerId || !this.dragState.sourcePortId) return false;
    if (targetContainerId === this.dragState.sourceContainerId && targetPortId === this.dragState.sourcePortId) return false;

    const sourceContainer = this.containerManager.getContainer(this.dragState.sourceContainerId);
    const targetContainer = this.containerManager.getContainer(targetContainerId);
    if (!sourceContainer || !targetContainer) return false;

    const sourcePort = sourceContainer.ioPorts.find(p => p.id === this.dragState.sourcePortId);
    const targetPort = targetContainer.ioPorts.find(p => p.id === targetPortId);
    if (!sourcePort || !targetPort) return false;

    if (sourcePort.direction === targetPort.direction) return false;

    const outPort = sourcePort.direction === 'output' ? sourcePort : targetPort;
    const inPort = sourcePort.direction === 'input' ? sourcePort : targetPort;

    return isPortCompatible(outPort.dataType, inPort.dataType);
  }

  private drawPreviewLine(): void {
    if (!this.previewGraphics || !this.dragState.sourceContainerId) return;
    this.previewGraphics.clear();

    const sourceContainer = this.containerManager.getContainer(this.dragState.sourceContainerId);
    if (!sourceContainer) return;

    const sourcePort = sourceContainer.ioPorts.find(p => p.id === this.dragState.sourcePortId);
    if (!sourcePort) return;

    const { bounds, ioPorts } = sourceContainer;
    const sameDirPorts = ioPorts.filter(p => p.direction === sourcePort.direction);
    const idx = sameDirPorts.indexOf(sourcePort);
    const spacing = bounds.height / (sameDirPorts.length + 1);
    const startX = sourcePort.direction === 'output' ? bounds.x + bounds.width : bounds.x;
    const startY = bounds.y + spacing * (idx + 1);

    const color = this.dragState.state === 'validTarget'
      ? '#00ff88'
      : this.dragState.state === 'invalidTarget'
        ? '#ff4444'
        : '#ffffff';
    const alpha = this.dragState.state === 'invalidTarget' ? 0.4 : 0.8;

    const dx = this.dragState.mouseX - startX;
    const controlOffset = Math.max(Math.abs(dx) * 0.4, 40);
    const cx1 = sourcePort.direction === 'output' ? startX + controlOffset : startX - controlOffset;
    const cx2 = sourcePort.direction === 'output' ? this.dragState.mouseX - controlOffset : this.dragState.mouseX + controlOffset;

    this.previewGraphics.moveTo(startX, startY);
    this.previewGraphics.bezierCurveTo(cx1, startY, cx2, this.dragState.mouseY, this.dragState.mouseX, this.dragState.mouseY);
    this.previewGraphics.stroke({ color, width: 2, alpha });
  }

  private clearPreview(): void {
    this.previewGraphics?.clear();
  }

  private emitEvent(event: string, ...args: any[]): void {
    const callbacks = this.listeners.get(event);
    if (!callbacks) return;
    for (const cb of callbacks) {
      cb(...args);
    }
  }
}
