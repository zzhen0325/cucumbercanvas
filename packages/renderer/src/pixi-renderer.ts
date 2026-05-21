import type { Application, Container, Graphics, Text } from 'pixi.js';
import type { DesignEngine } from '@cucumber/engine';
import type { ContainerManager, ContainerNode, ContainerBounds, AgentBinding } from '@cucumber/container';
import type { ViewportState } from '@cucumber/pen-types';
import type { RenderNode, RendererOptions, ShadowModeOptions } from './types.js';
import { containerNodeToRenderNode } from './types.js';

export class PixiRenderer {
  private app: Application | null = null;
  private engine: DesignEngine;
  private containerManager: ContainerManager;
  private containerDisplayObjects = new Map<string, Container>();
  private shadowMode = false;
  private disposed = false;
  private animationTime = 0;
  private tickerCallback: (() => void) | null = null;

  constructor(engine: DesignEngine, containerManager: ContainerManager) {
    this.engine = engine;
    this.containerManager = containerManager;
  }

  async init(options: RendererOptions): Promise<void> {
    const { Application } = await import('pixi.js');
    this.app = new Application();
    await this.app.init({
      canvas: options.canvas,
      width: options.width ?? 1920,
      height: options.height ?? 1080,
      backgroundColor: options.backgroundColor ?? '#1a1a1a',
      resolution: options.resolution ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1),
      antialias: options.antialias ?? true,
      autoDensity: true,
    });

    this.engine.on('render', () => this.render());
    this.engine.on('viewport:change', (state) => this.syncViewport(state));

    this.containerManager.on('container:add', (node) => this.addContainerVisual(node));
    this.containerManager.on('container:remove', (id) => this.removeContainerVisual(id));
    this.containerManager.on('container:update', (node) => this.updateContainerVisual(node));

    this.tickerCallback = () => {
      this.animationTime += 0.016;
      this.updateGlowAnimations();
    };
    this.app.ticker.add(this.tickerCallback as any);

    this.render();
  }

  getCanvas(): HTMLCanvasElement | undefined {
    return this.app?.canvas as HTMLCanvasElement | undefined;
  }

  enableShadowMode(options: ShadowModeOptions): void {
    this.shadowMode = true;
    const canvas = this.getCanvas();
    if (!canvas) return;

    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '10';
    canvas.style.opacity = '0.85';

    options.excalidrawCanvas.parentElement?.appendChild(canvas);
  }

  disableShadowMode(): void {
    this.shadowMode = false;
    const canvas = this.getCanvas();
    if (canvas) {
      canvas.style.pointerEvents = 'auto';
      canvas.style.opacity = '1';
    }
  }

  isShadowMode(): boolean {
    return this.shadowMode;
  }

  render(): void {
    if (this.disposed || !this.app) return;

    const containers = this.containerManager.getAllContainers();
    for (const container of containers) {
      if (!this.containerDisplayObjects.has(container.id)) {
        this.addContainerVisual(container);
      } else {
        this.updateContainerVisual(container);
      }
    }

    const existingIds = new Set(containers.map(c => c.id));
    for (const [id] of this.containerDisplayObjects) {
      if (!existingIds.has(id)) {
        this.removeContainerVisual(id);
      }
    }
  }

  private async addContainerVisual(node: ContainerNode): Promise<void> {
    if (!this.app) return;
    const { Container: PixiContainer, Graphics, Text } = await import('pixi.js');

    const container = new PixiContainer();
    container.label = node.id;

    const glowGraphics = new Graphics();
    glowGraphics.label = 'glow';
    container.addChild(glowGraphics);

    const bg = new Graphics();
    bg.label = 'bg';
    this.drawContainerRect(bg, node.bounds, node.style);
    container.addChild(bg);

    if (node.style?.label) {
      const label = new Text({
        text: node.style.label,
        style: {
          fontSize: 12,
          fill: '#cccccc',
          fontFamily: 'Inter, sans-serif',
        },
      });
      label.position.set(node.bounds.x + 8, node.bounds.y + 6);
      label.label = 'label';
      container.addChild(label);
    }

    if (node.agentBinding?.agentId) {
      this.drawAgentBadge(container, node);
      this.drawAgentGlow(glowGraphics, node.bounds, node.agentBinding);
    }

    container.position.set(0, 0);
    this.app.stage.addChild(container);
    this.containerDisplayObjects.set(node.id, container);
  }

  private async updateContainerVisual(node: ContainerNode): Promise<void> {
    const container = this.containerDisplayObjects.get(node.id);
    if (!container) {
      await this.addContainerVisual(node);
      return;
    }

    const { Graphics, Text } = await import('pixi.js');

    const glow = container.children.find(c => c.label === 'glow') as Graphics | undefined;
    const bg = container.children.find(c => c.label === 'bg') as Graphics | undefined;

    if (bg) {
      bg.clear();
      this.drawContainerRect(bg, node.bounds, node.style);
    }

    const labelChild = container.children.find(c => c.label === 'label') as Text | undefined;
    if (labelChild && node.style?.label) {
      labelChild.text = node.style.label;
      labelChild.position.set(node.bounds.x + 8, node.bounds.y + 6);
    }

    if (glow) {
      glow.clear();
      if (node.agentBinding?.agentId) {
        this.drawAgentGlow(glow, node.bounds, node.agentBinding);
      }
    }

    const existingBadge = container.children.find(c => c.label === 'agent-badge');
    if (existingBadge) {
      existingBadge.destroy({ children: true });
    }
    if (node.agentBinding?.agentId) {
      this.drawAgentBadge(container, node);
    }
  }

  private removeContainerVisual(id: string): void {
    const container = this.containerDisplayObjects.get(id);
    if (container) {
      container.destroy({ children: true });
      this.containerDisplayObjects.delete(id);
    }
  }

  private drawContainerRect(
    g: any,
    bounds: ContainerBounds,
    style?: ContainerNode['style']
  ): void {
    const fill = style?.fill ?? '#ffffff0d';
    const stroke = style?.stroke ?? '#666666';

    g.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, 8);
    g.fill({ color: fill, alpha: 0.05 });
    g.stroke({ color: stroke, width: 2, alpha: 0.8 });

    g.rect(bounds.x, bounds.y, bounds.width, 28);
    g.fill({ color: stroke, alpha: 0.15 });
  }

  private drawAgentGlow(g: any, bounds: ContainerBounds, binding: AgentBinding): void {
    const color = binding.color ?? '#4ECDC4';
    const isRunning = binding.status === 'running' || binding.status === 'thinking';
    const alpha = isRunning ? 0.4 + Math.sin(this.animationTime * 3) * 0.2 : 0.25;

    g.roundRect(bounds.x - 3, bounds.y - 3, bounds.width + 6, bounds.height + 6, 10);
    g.stroke({ color, width: 3, alpha });

    if (isRunning) {
      g.roundRect(bounds.x - 6, bounds.y - 6, bounds.width + 12, bounds.height + 12, 12);
      g.stroke({ color, width: 1.5, alpha: alpha * 0.5 });
    }
  }

  private async drawAgentBadge(container: any, node: ContainerNode): Promise<void> {
    const { Container: PixiContainer, Graphics, Text } = await import('pixi.js');
    const binding = node.agentBinding!;
    const bounds = node.bounds;

    const badge = new PixiContainer();
    badge.label = 'agent-badge';

    const badgeWidth = 80;
    const badgeHeight = 20;
    const badgeX = bounds.x + bounds.width - badgeWidth - 8;
    const badgeY = bounds.y + 4;

    const bg = new Graphics();
    bg.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 10);
    bg.fill({ color: binding.color ?? '#4ECDC4', alpha: 0.9 });
    badge.addChild(bg);

    const statusDot = new Graphics();
    const dotX = badgeX + 8;
    const dotY = badgeY + badgeHeight / 2;
    statusDot.circle(dotX, dotY, 3);
    statusDot.label = 'status-dot';

    const dotColor = this.getStatusColor(binding.status);
    statusDot.fill({ color: dotColor, alpha: 1 });
    badge.addChild(statusDot);

    if (binding.name) {
      const nameText = new Text({
        text: binding.name,
        style: {
          fontSize: 10,
          fill: '#ffffff',
          fontFamily: 'Inter, sans-serif',
          fontWeight: 'bold',
        },
      });
      nameText.position.set(badgeX + 16, badgeY + 3);
      badge.addChild(nameText);
    }

    container.addChild(badge);
  }

  private getStatusColor(status?: AgentBinding['status']): string {
    switch (status) {
      case 'running': return '#00ff88';
      case 'thinking': return '#ffdd00';
      case 'blocked': return '#ff4444';
      case 'completed': return '#888888';
      case 'idle':
      default: return '#ffffff';
    }
  }

  private updateGlowAnimations(): void {
    const containers = this.containerManager.getAllContainers();
    for (const node of containers) {
      if (!node.agentBinding?.agentId) continue;
      const isRunning = node.agentBinding.status === 'running' || node.agentBinding.status === 'thinking';
      if (!isRunning) continue;

      const displayObj = this.containerDisplayObjects.get(node.id);
      if (!displayObj) continue;

      const glow = displayObj.children.find(c => c.label === 'glow') as any;
      if (glow) {
        glow.clear();
        this.drawAgentGlow(glow, node.bounds, node.agentBinding);
      }
    }
  }

  private syncViewport(state: ViewportState): void {
    if (!this.app) return;
    this.app.stage.position.set(state.panX, state.panY);
    this.app.stage.scale.set(state.zoom, state.zoom);
  }

  resize(width: number, height: number): void {
    if (!this.app) return;
    this.app.renderer.resize(width, height);
  }

  destroy(): void {
    this.disposed = true;
    if (this.tickerCallback && this.app) {
      this.app.ticker.remove(this.tickerCallback as any);
    }
    for (const [, container] of this.containerDisplayObjects) {
      container.destroy({ children: true });
    }
    this.containerDisplayObjects.clear();
    this.app?.destroy(true);
    this.app = null;
  }
}
