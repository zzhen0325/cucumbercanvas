import type { ContainerManager, IOPort, ContainerNode } from '@cucumber/container';

export interface PortVisualOptions {
  portRadius?: number;
  inputColor?: string;
  outputColor?: string;
  hoverColor?: string;
  labelFontSize?: number;
}

interface PortDisplayObject {
  container: any;
  circle: any;
  label: any;
  portId: string;
  containerId: string;
  direction: IOPort['direction'];
}

export class IOPortRenderer {
  private stage: any = null;
  private portVisuals = new Map<string, PortDisplayObject>();
  private containerManager: ContainerManager;
  private options: Required<PortVisualOptions>;
  private portContainer: any = null;

  constructor(containerManager: ContainerManager, options?: PortVisualOptions) {
    this.containerManager = containerManager;
    this.options = {
      portRadius: options?.portRadius ?? 6,
      inputColor: options?.inputColor ?? '#FFD93D',
      outputColor: options?.outputColor ?? '#6BCB77',
      hoverColor: options?.hoverColor ?? '#ffffff',
      labelFontSize: options?.labelFontSize ?? 9,
    };
  }

  async init(stage: any): Promise<void> {
    const { Container: PixiContainer } = await import('pixi.js');
    this.stage = stage;
    this.portContainer = new PixiContainer();
    this.portContainer.label = 'io-ports';
    stage.addChild(this.portContainer);

    this.containerManager.on('container:add', (node) => this.syncPortsForContainer(node));
    this.containerManager.on('container:update', (node) => this.syncPortsForContainer(node));
    this.containerManager.on('container:remove', (id) => this.removePortsForContainer(id));
  }

  async syncPortsForContainer(containerNode: ContainerNode): Promise<void> {
    this.removePortsForContainer(containerNode.id);

    for (const port of containerNode.ioPorts) {
      await this.addPortVisual(containerNode, port);
    }
  }

  private async addPortVisual(containerNode: ContainerNode, port: IOPort): Promise<void> {
    if (!this.portContainer) return;
    const { Container: PixiContainer, Graphics, Text } = await import('pixi.js');

    const portGroup = new PixiContainer();
    portGroup.label = `port-${port.id}`;

    const pos = this.getPortPosition(containerNode, port);
    const color = port.direction === 'input' ? this.options.inputColor : this.options.outputColor;

    const outerCircle = new Graphics();
    outerCircle.circle(0, 0, this.options.portRadius + 2);
    outerCircle.fill({ color, alpha: 0.2 });
    portGroup.addChild(outerCircle);

    const circle = new Graphics();
    circle.circle(0, 0, this.options.portRadius);
    circle.fill({ color, alpha: 1 });
    circle.stroke({ color: '#ffffff', width: 1.5, alpha: 0.8 });
    portGroup.addChild(circle);

    const typeIcon = new Text({
      text: this.getTypeIcon(port.dataType),
      style: {
        fontSize: 8,
        fill: '#ffffff',
        fontFamily: 'Inter, sans-serif',
        fontWeight: 'bold',
      },
    });
    typeIcon.anchor.set(0.5, 0.5);
    portGroup.addChild(typeIcon);

    let labelText: any = null;
    if (port.label) {
      labelText = new Text({
        text: port.label,
        style: {
          fontSize: this.options.labelFontSize,
          fill: '#aaaaaa',
          fontFamily: 'Inter, sans-serif',
        },
      });
      const labelOffsetX = port.direction === 'input' ? -(this.options.portRadius + 6) : this.options.portRadius + 6;
      labelText.position.set(labelOffsetX, 0);
      labelText.anchor.set(port.direction === 'input' ? 1 : 0, 0.5);
      portGroup.addChild(labelText);
    }

    portGroup.position.set(pos.x, pos.y);
    portGroup.eventMode = 'static';
    portGroup.cursor = 'crosshair';

    this.portContainer.addChild(portGroup);
    const key = `${containerNode.id}:${port.id}`;
    this.portVisuals.set(key, {
      container: portGroup,
      circle,
      label: labelText,
      portId: port.id,
      containerId: containerNode.id,
      direction: port.direction,
    });
  }

  removePortsForContainer(containerId: string): void {
    const keysToRemove: string[] = [];
    for (const [key, visual] of this.portVisuals) {
      if (visual.containerId === containerId) {
        visual.container.destroy({ children: true });
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      this.portVisuals.delete(key);
    }
  }

  refreshAll(): void {
    const containers = this.containerManager.getAllContainers();
    for (const container of containers) {
      this.syncPortsForContainer(container);
    }
  }

  getPortAtPosition(x: number, y: number): { containerId: string; portId: string; direction: IOPort['direction'] } | null {
    for (const visual of this.portVisuals.values()) {
      const bounds = visual.container.getBounds();
      if (
        x >= bounds.x - 4 &&
        x <= bounds.x + bounds.width + 4 &&
        y >= bounds.y - 4 &&
        y <= bounds.y + bounds.height + 4
      ) {
        return {
          containerId: visual.containerId,
          portId: visual.portId,
          direction: visual.direction,
        };
      }
    }
    return null;
  }

  destroy(): void {
    for (const visual of this.portVisuals.values()) {
      visual.container.destroy({ children: true });
    }
    this.portVisuals.clear();
    if (this.portContainer) {
      this.portContainer.destroy({ children: true });
      this.portContainer = null;
    }
  }

  private getPortPosition(containerNode: ContainerNode, port: IOPort): { x: number; y: number } {
    const { bounds, ioPorts } = containerNode;
    const sameDirPorts = ioPorts.filter(p => p.direction === port.direction);
    const idx = sameDirPorts.indexOf(port);
    const spacing = bounds.height / (sameDirPorts.length + 1);

    if (port.direction === 'input') {
      return { x: bounds.x, y: bounds.y + spacing * (idx + 1) };
    }
    return { x: bounds.x + bounds.width, y: bounds.y + spacing * (idx + 1) };
  }

  private getTypeIcon(dataType: IOPort['dataType']): string {
    switch (dataType) {
      case 'image': return '🖼';
      case 'text': return 'T';
      case 'json': return '{}';
      case 'reference': return '⟶';
      case 'prompt': return '✎';
      default: return '•';
    }
  }
}
