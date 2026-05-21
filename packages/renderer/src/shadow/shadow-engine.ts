import type { DesignEngine } from '@cucumber/engine';
import type { ContainerManager } from '@cucumber/container';
import type { ViewportState } from '@cucumber/pen-types';
import { PixiRenderer } from '../pixi-renderer.js';

export type EngineSwitchMode = 'excalidraw' | 'new_engine' | 'shadow';

export interface ShadowEngineOptions {
  excalidrawCanvasSelector: string;
  mode: EngineSwitchMode;
}

export class ShadowEngine {
  private renderer: PixiRenderer;
  private engine: DesignEngine;
  private containerManager: ContainerManager;
  private mode: EngineSwitchMode;
  private canvas: HTMLCanvasElement | null = null;

  constructor(engine: DesignEngine, containerManager: ContainerManager, options: ShadowEngineOptions) {
    this.engine = engine;
    this.containerManager = containerManager;
    this.renderer = new PixiRenderer(engine, containerManager);
    this.mode = options.mode;
  }

  async mount(parentElement: HTMLElement): Promise<void> {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'cucumber-canvas-overlay';
    const rect = parentElement.getBoundingClientRect();

    await this.renderer.init({
      canvas: this.canvas,
      width: rect.width,
      height: rect.height,
      backgroundColor: 'transparent',
    });

    if (this.mode === 'shadow') {
      this.canvas.style.position = 'absolute';
      this.canvas.style.top = '0';
      this.canvas.style.left = '0';
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      this.canvas.style.pointerEvents = 'none';
      this.canvas.style.zIndex = '5';
      parentElement.style.position = 'relative';
      parentElement.appendChild(this.canvas);
    } else if (this.mode === 'new_engine') {
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      parentElement.appendChild(this.canvas);
    }
  }

  getMode(): EngineSwitchMode {
    return this.mode;
  }

  setMode(mode: EngineSwitchMode): void {
    this.mode = mode;
    if (!this.canvas) return;

    switch (mode) {
      case 'shadow':
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.opacity = '1';
        this.canvas.style.display = 'block';
        break;
      case 'new_engine':
        this.canvas.style.pointerEvents = 'auto';
        this.canvas.style.opacity = '1';
        this.canvas.style.display = 'block';
        break;
      case 'excalidraw':
        this.canvas.style.display = 'none';
        break;
    }
  }

  syncViewportFromExcalidraw(state: ViewportState): void {
    this.engine.viewport.setViewport(state.zoom, state.panX, state.panY);
  }

  getRenderer(): PixiRenderer {
    return this.renderer;
  }

  destroy(): void {
    this.renderer.destroy();
    if (this.canvas?.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
    this.canvas = null;
  }
}
