import type { Application, Container, Graphics, Text } from 'pixi.js';
import type { DesignEngine } from '@cucumber/engine';
import type { ContainerManager, ContainerNode, ContainerBounds } from '@cucumber/container';
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

    const bg = new Graphics();
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

    const bg = container.children[0] as Graphics;
    if (bg) {
      bg.clear();
      this.drawContainerRect(bg, node.bounds, node.style);
    }

    const labelChild = container.children.find(c => c.label === 'label') as Text | undefined;
    if (labelChild && node.style?.label) {
      labelChild.text = node.style.label;
      labelChild.position.set(node.bounds.x + 8, node.bounds.y + 6);
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
    for (const [, container] of this.containerDisplayObjects) {
      container.destroy({ children: true });
    }
    this.containerDisplayObjects.clear();
    this.app?.destroy(true);
    this.app = null;
  }
}
