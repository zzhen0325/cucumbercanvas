import type { IOPort } from './types.js';
import type { ContainerManager } from './container-manager.js';

let portIdCounter = 0;
function generatePortId(): string {
  return `port_${Date.now()}_${++portIdCounter}`;
}

export interface AddPortOptions {
  containerId: string;
  direction: IOPort['direction'];
  dataType: IOPort['dataType'];
  schema?: unknown;
  label?: string;
  id?: string;
}

export class IOPortManager {
  private containerManager: ContainerManager;

  constructor(containerManager: ContainerManager) {
    this.containerManager = containerManager;
  }

  addPort(options: AddPortOptions): IOPort | null {
    const container = this.containerManager.getContainer(options.containerId);
    if (!container) return null;

    const port: IOPort = {
      id: options.id ?? generatePortId(),
      direction: options.direction,
      dataType: options.dataType,
      schema: options.schema,
      label: options.label ?? `${options.direction} (${options.dataType})`,
    };

    const updatedPorts = [...container.ioPorts, port];
    this.containerManager.updateContainer(options.containerId, { ioPorts: updatedPorts });
    return port;
  }

  removePort(containerId: string, portId: string): boolean {
    const container = this.containerManager.getContainer(containerId);
    if (!container) return false;

    const idx = container.ioPorts.findIndex(p => p.id === portId);
    if (idx === -1) return false;

    const updatedPorts = container.ioPorts.filter(p => p.id !== portId);
    this.containerManager.updateContainer(containerId, { ioPorts: updatedPorts });
    return true;
  }

  updatePort(containerId: string, portId: string, updates: Partial<Omit<IOPort, 'id'>>): boolean {
    const container = this.containerManager.getContainer(containerId);
    if (!container) return false;

    const updatedPorts = container.ioPorts.map(p =>
      p.id === portId ? { ...p, ...updates } : p
    );
    this.containerManager.updateContainer(containerId, { ioPorts: updatedPorts });
    return true;
  }

  getPort(containerId: string, portId: string): IOPort | undefined {
    const container = this.containerManager.getContainer(containerId);
    return container?.ioPorts.find(p => p.id === portId);
  }

  getInputPorts(containerId: string): IOPort[] {
    const container = this.containerManager.getContainer(containerId);
    return container?.ioPorts.filter(p => p.direction === 'input') ?? [];
  }

  getOutputPorts(containerId: string): IOPort[] {
    const container = this.containerManager.getContainer(containerId);
    return container?.ioPorts.filter(p => p.direction === 'output') ?? [];
  }

  getPortPosition(containerId: string, portId: string): { x: number; y: number } | null {
    const container = this.containerManager.getContainer(containerId);
    if (!container) return null;

    const port = container.ioPorts.find(p => p.id === portId);
    if (!port) return null;

    const { bounds } = container;
    const inputPorts = container.ioPorts.filter(p => p.direction === 'input');
    const outputPorts = container.ioPorts.filter(p => p.direction === 'output');

    if (port.direction === 'input') {
      const idx = inputPorts.indexOf(port);
      const spacing = bounds.height / (inputPorts.length + 1);
      return { x: bounds.x, y: bounds.y + spacing * (idx + 1) };
    } else {
      const idx = outputPorts.indexOf(port);
      const spacing = bounds.height / (outputPorts.length + 1);
      return { x: bounds.x + bounds.width, y: bounds.y + spacing * (idx + 1) };
    }
  }
}
