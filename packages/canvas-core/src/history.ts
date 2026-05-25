import type { PenDocument } from '@cucumber/pen-types';

export interface CanvasHistoryManagerOptions {
  maxStates?: number;
  onChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
}

export class CanvasHistoryManager {
  private undoStack: PenDocument[] = [];
  private redoStack: PenDocument[] = [];
  private readonly maxStates: number;
  private readonly onChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;

  constructor(options?: CanvasHistoryManagerOptions) {
    this.maxStates = options?.maxStates ?? 200;
    this.onChange = options?.onChange;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  push(doc: PenDocument): void {
    const snapshot = structuredClone(doc);
    const last = this.undoStack[this.undoStack.length - 1];
    if (last && JSON.stringify(last) === JSON.stringify(snapshot)) return;
    this.undoStack = [...this.undoStack.slice(-(this.maxStates - 1)), snapshot];
    this.redoStack = [];
    this.notify();
  }

  undo(currentDoc: PenDocument): PenDocument | null {
    const previous = this.undoStack.pop();
    if (!previous) return null;
    this.redoStack.push(structuredClone(currentDoc));
    this.notify();
    return structuredClone(previous);
  }

  redo(currentDoc: PenDocument): PenDocument | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(structuredClone(currentDoc));
    this.notify();
    return structuredClone(next);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  private notify(): void {
    this.onChange?.({ canUndo: this.canUndo, canRedo: this.canRedo });
  }
}
