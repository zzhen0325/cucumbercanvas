import { TypedEventEmitter } from '@cucumber/pen-engine';
import type { ContainerManager } from '../container-manager.js';

export interface DirtyMarkingEvents {
  'dirty:mark': (containerId: string) => void;
  'dirty:clear': (containerId: string) => void;
  'dirty:flush': (dirtyIds: string[]) => void;
}

export class IncrementalRenderer extends TypedEventEmitter<DirtyMarkingEvents> {
  private dirtySet = new Set<string>();
  private containerManager: ContainerManager;
  private frameScheduled = false;
  private renderCallback: ((dirtyIds: string[]) => void) | null = null;

  constructor(containerManager: ContainerManager) {
    super();
    this.containerManager = containerManager;
    this.setupListeners();
  }

  private setupListeners(): void {
    this.containerManager.on('container:update', (node) => {
      this.markDirty(node.id);
    });
    this.containerManager.on('container:add', (node) => {
      this.markDirty(node.id);
    });
    this.containerManager.on('container:remove', (id) => {
      this.dirtySet.delete(id);
    });
    this.containerManager.on('agent:status', (containerId) => {
      this.markDirty(containerId);
    });
  }

  markDirty(containerId: string): void {
    this.dirtySet.add(containerId);
    this.emit('dirty:mark', containerId);
    this.scheduleFlush();
  }

  markClean(containerId: string): void {
    this.dirtySet.delete(containerId);
    this.emit('dirty:clear', containerId);
  }

  isDirty(containerId: string): boolean {
    return this.dirtySet.has(containerId);
  }

  getDirtyIds(): string[] {
    return [...this.dirtySet];
  }

  onFlush(callback: (dirtyIds: string[]) => void): void {
    this.renderCallback = callback;
  }

  flush(): void {
    if (this.dirtySet.size === 0) return;
    const dirtyIds = [...this.dirtySet];
    this.dirtySet.clear();
    this.emit('dirty:flush', dirtyIds);
    if (this.renderCallback) {
      this.renderCallback(dirtyIds);
    }
  }

  private scheduleFlush(): void {
    if (this.frameScheduled) return;
    this.frameScheduled = true;
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        this.frameScheduled = false;
        this.flush();
      });
    } else {
      setTimeout(() => {
        this.frameScheduled = false;
        this.flush();
      }, 16);
    }
  }

  dispose(): void {
    this.dirtySet.clear();
    this.renderCallback = null;
    super.dispose();
  }
}
