import type { PenNode, PenDocument } from '@cucumber/pen-types';

export interface SceneTreeNode {
  id: string;
  node: PenNode;
  children: SceneTreeNode[];
  parent: SceneTreeNode | null;
  dirty: boolean;
}

export class SceneTree {
  private root: SceneTreeNode[] = [];
  private nodeMap = new Map<string, SceneTreeNode>();

  getRoot(): SceneTreeNode[] {
    return this.root;
  }

  getNode(id: string): SceneTreeNode | undefined {
    return this.nodeMap.get(id);
  }

  getAllNodes(): PenNode[] {
    const result: PenNode[] = [];
    const walk = (nodes: SceneTreeNode[]) => {
      for (const n of nodes) {
        result.push(n.node);
        walk(n.children);
      }
    };
    walk(this.root);
    return result;
  }

  loadFromDocument(doc: PenDocument): void {
    this.root = [];
    this.nodeMap.clear();
    for (const node of doc.children) {
      const treeNode = this.buildTreeNode(node, null);
      this.root.push(treeNode);
    }
  }

  addNode(node: PenNode, parentId?: string): SceneTreeNode {
    const treeNode: SceneTreeNode = {
      id: node.id,
      node,
      children: [],
      parent: null,
      dirty: true,
    };

    if (parentId) {
      const parent = this.nodeMap.get(parentId);
      if (parent) {
        treeNode.parent = parent;
        parent.children.push(treeNode);
        parent.dirty = true;
      } else {
        this.root.push(treeNode);
      }
    } else {
      this.root.push(treeNode);
    }

    this.nodeMap.set(node.id, treeNode);
    return treeNode;
  }

  removeNode(id: string): boolean {
    const node = this.nodeMap.get(id);
    if (!node) return false;

    if (node.parent) {
      node.parent.children = node.parent.children.filter(c => c.id !== id);
      node.parent.dirty = true;
    } else {
      this.root = this.root.filter(n => n.id !== id);
    }

    const removeRecursive = (n: SceneTreeNode) => {
      this.nodeMap.delete(n.id);
      for (const child of n.children) {
        removeRecursive(child);
      }
    };
    removeRecursive(node);
    return true;
  }

  updateNode(id: string, updates: Partial<PenNode>): boolean {
    const treeNode = this.nodeMap.get(id);
    if (!treeNode) return false;
    treeNode.node = { ...treeNode.node, ...updates } as PenNode;
    treeNode.dirty = true;
    return true;
  }

  moveNode(id: string, newParentId: string | null): boolean {
    const node = this.nodeMap.get(id);
    if (!node) return false;

    if (node.parent) {
      node.parent.children = node.parent.children.filter(c => c.id !== id);
      node.parent.dirty = true;
    } else {
      this.root = this.root.filter(n => n.id !== id);
    }

    if (newParentId) {
      const newParent = this.nodeMap.get(newParentId);
      if (newParent) {
        node.parent = newParent;
        newParent.children.push(node);
        newParent.dirty = true;
      } else {
        node.parent = null;
        this.root.push(node);
      }
    } else {
      node.parent = null;
      this.root.push(node);
    }

    node.dirty = true;
    return true;
  }

  markClean(id: string): void {
    const node = this.nodeMap.get(id);
    if (node) node.dirty = false;
  }

  getDirtyNodes(): SceneTreeNode[] {
    const dirty: SceneTreeNode[] = [];
    for (const node of this.nodeMap.values()) {
      if (node.dirty) dirty.push(node);
    }
    return dirty;
  }

  clearAllDirty(): void {
    for (const node of this.nodeMap.values()) {
      node.dirty = false;
    }
  }

  toDocument(version: string): PenDocument {
    const collectChildren = (nodes: SceneTreeNode[]): PenNode[] => {
      return nodes.map(n => {
        if (n.children.length > 0 && 'children' in n.node) {
          return { ...n.node, children: collectChildren(n.children) } as PenNode;
        }
        return n.node;
      });
    };
    return { version, children: collectChildren(this.root) };
  }

  private buildTreeNode(node: PenNode, parent: SceneTreeNode | null): SceneTreeNode {
    const treeNode: SceneTreeNode = {
      id: node.id,
      node,
      children: [],
      parent,
      dirty: false,
    };
    this.nodeMap.set(node.id, treeNode);

    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        const childNode = this.buildTreeNode(child, treeNode);
        treeNode.children.push(childNode);
      }
    }
    return treeNode;
  }
}
