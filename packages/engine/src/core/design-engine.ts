import type {
  PenDocument,
  PenNode,
  DesignEngineEvents,
  DesignEngineOptions,
  ViewportState,
  ToolType,
} from '@cucumber/pen-types';
import { TypedEventEmitter } from './event-emitter.js';
import { HistoryManager } from './history-manager.js';
import { SelectionManager } from './selection-manager.js';
import { ViewportController } from './viewport-controller.js';
import { SceneTree } from './scene-tree.js';
import { DEFAULT_MAX_HISTORY } from './constants.js';

export class DesignEngine extends TypedEventEmitter<DesignEngineEvents> {
  readonly history: HistoryManager;
  readonly selection: SelectionManager;
  readonly viewport: ViewportController;
  readonly sceneTree: SceneTree;

  private currentDoc: PenDocument;
  private activeTool: ToolType = 'select';
  private renderScheduled = false;
  private rafId: number | null = null;

  constructor(doc: PenDocument, options?: DesignEngineOptions) {
    super();
    this.currentDoc = doc;
    this.sceneTree = new SceneTree();
    this.sceneTree.loadFromDocument(doc);

    this.history = new HistoryManager({
      maxStates: options?.maxHistoryStates ?? DEFAULT_MAX_HISTORY,
      onChange: (state) => this.emit('history:change', state),
    });

    this.selection = new SelectionManager({
      onChange: (ids) => this.emit('selection:change', ids),
      onHover: (id) => this.emit('node:hover', id),
    });

    this.viewport = new ViewportController({
      onChange: (state) => this.emit('viewport:change', state),
    });
  }

  getDocument(): PenDocument {
    return this.currentDoc;
  }

  setDocument(doc: PenDocument): void {
    this.history.push(this.currentDoc);
    this.currentDoc = doc;
    this.sceneTree.loadFromDocument(doc);
    this.emit('document:change', doc);
    this.scheduleRender();
  }

  getActiveTool(): ToolType {
    return this.activeTool;
  }

  setActiveTool(tool: ToolType): void {
    this.activeTool = tool;
    this.emit('tool:change', tool);
  }

  addNode(node: PenNode, parentId?: string): void {
    this.history.push(this.currentDoc);
    this.sceneTree.addNode(node, parentId);
    this.syncDocFromTree();
  }

  removeNode(id: string): void {
    this.history.push(this.currentDoc);
    this.sceneTree.removeNode(id);
    this.syncDocFromTree();
  }

  updateNode(id: string, updates: Partial<PenNode>): void {
    this.history.push(this.currentDoc);
    this.sceneTree.updateNode(id, updates);
    this.syncDocFromTree();
  }

  moveNode(id: string, newParentId: string | null): void {
    this.history.push(this.currentDoc);
    this.sceneTree.moveNode(id, newParentId);
    this.syncDocFromTree();
  }

  undo(): void {
    const prev = this.history.undo(this.currentDoc);
    if (prev) {
      this.currentDoc = prev;
      this.sceneTree.loadFromDocument(prev);
      this.emit('document:change', prev);
      this.scheduleRender();
    }
  }

  redo(): void {
    const next = this.history.redo(this.currentDoc);
    if (next) {
      this.currentDoc = next;
      this.sceneTree.loadFromDocument(next);
      this.emit('document:change', next);
      this.scheduleRender();
    }
  }

  startBatch(): void {
    this.history.startBatch(this.currentDoc);
  }

  endBatch(): void {
    this.history.endBatch(this.currentDoc);
  }

  scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(() => {
        this.renderScheduled = false;
        this.emit('render');
      });
    } else {
      queueMicrotask(() => {
        this.renderScheduled = false;
        this.emit('render');
      });
    }
  }

  dispose(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
    }
    super.dispose();
  }

  private syncDocFromTree(): void {
    this.currentDoc = this.sceneTree.toDocument(this.currentDoc.version);
    this.emit('document:change', this.currentDoc);
    this.scheduleRender();
  }
}
