export interface SelectionManagerOptions {
  onChange?: (ids: string[]) => void;
  onHover?: (id: string | null) => void;
}

export class SelectionManager {
  private selectedIds: string[] = [];
  private activeId: string | null = null;
  private hoveredId: string | null = null;
  private onChangeCb?: (ids: string[]) => void;
  private onHoverCb?: (id: string | null) => void;

  constructor(options?: SelectionManagerOptions) {
    this.onChangeCb = options?.onChange;
    this.onHoverCb = options?.onHover;
  }

  getSelection(): string[] {
    return this.selectedIds;
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  getHoveredId(): string | null {
    return this.hoveredId;
  }

  select(ids: string[], activeId?: string): void {
    this.selectedIds = [...ids];
    this.activeId = activeId ?? (ids.length === 1 ? ids[0]! : null);
    this.onChangeCb?.(this.selectedIds);
  }

  clearSelection(): void {
    this.selectedIds = [];
    this.activeId = null;
    this.onChangeCb?.(this.selectedIds);
  }

  setHoveredId(id: string | null): void {
    this.hoveredId = id;
    this.onHoverCb?.(id);
  }
}
