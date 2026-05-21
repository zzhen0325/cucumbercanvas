import { TypedEventEmitter } from '@cucumber/engine';
import type { ContainerManager } from '../container-manager.js';
import type { IOPortManager } from '../io-port-manager.js';
import type { DataFlowEngine } from '../dataflow/dataflow-engine.js';
import type { ContainerTemplate, ContainerTemplateNode, TemplateInstance } from './types.js';
import { PRESET_TEMPLATES } from './presets.js';

let templateIdCounter = 0;
function generateTemplateId(): string {
  return `tpl_${Date.now()}_${++templateIdCounter}`;
}

export interface TemplateRegistryEvents {
  'template:add': (template: ContainerTemplate) => void;
  'template:update': (template: ContainerTemplate) => void;
  'template:remove': (id: string) => void;
  'template:instantiate': (instance: TemplateInstance) => void;
}

export class TemplateRegistry extends TypedEventEmitter<TemplateRegistryEvents> {
  private templates = new Map<string, ContainerTemplate>();
  private containerManager: ContainerManager;
  private ioPortManager: IOPortManager;
  private dataFlowEngine: DataFlowEngine;

  constructor(
    containerManager: ContainerManager,
    ioPortManager: IOPortManager,
    dataFlowEngine: DataFlowEngine
  ) {
    super();
    this.containerManager = containerManager;
    this.ioPortManager = ioPortManager;
    this.dataFlowEngine = dataFlowEngine;
    this.loadPresets();
  }

  private loadPresets(): void {
    for (const preset of PRESET_TEMPLATES) {
      this.templates.set(preset.id, preset);
    }
  }

  add(template: Omit<ContainerTemplate, 'id' | 'createdAt' | 'updatedAt'>): ContainerTemplate {
    const full: ContainerTemplate = {
      ...template,
      id: generateTemplateId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.templates.set(full.id, full);
    this.emit('template:add', full);
    return full;
  }

  update(id: string, updates: Partial<Omit<ContainerTemplate, 'id' | 'createdAt'>>): boolean {
    const existing = this.templates.get(id);
    if (!existing) return false;
    const updated = { ...existing, ...updates, id, createdAt: existing.createdAt, updatedAt: Date.now() };
    this.templates.set(id, updated);
    this.emit('template:update', updated);
    return true;
  }

  remove(id: string): boolean {
    if (!this.templates.has(id)) return false;
    this.templates.delete(id);
    this.emit('template:remove', id);
    return true;
  }

  get(id: string): ContainerTemplate | undefined {
    return this.templates.get(id);
  }

  getAll(): ContainerTemplate[] {
    return [...this.templates.values()];
  }

  getByCategory(category: string): ContainerTemplate[] {
    return [...this.templates.values()].filter(t => t.category === category);
  }

  search(query: string): ContainerTemplate[] {
    const lower = query.toLowerCase();
    return [...this.templates.values()].filter(
      t => t.name.toLowerCase().includes(lower) ||
           t.description.toLowerCase().includes(lower) ||
           t.tags?.some(tag => tag.toLowerCase().includes(lower))
    );
  }

  instantiate(templateId: string, originX: number, originY: number): TemplateInstance | null {
    const template = this.templates.get(templateId);
    if (!template) return null;

    const refMap = new Map<string, string>();
    const containerIds: string[] = [];
    const edgeIds: string[] = [];

    for (const node of template.nodes) {
      this.instantiateNode(node, null, originX, originY, refMap, containerIds);
    }

    for (const edge of template.edges) {
      const sourceId = refMap.get(edge.sourceRef);
      const targetId = refMap.get(edge.targetRef);
      if (!sourceId || !targetId) continue;

      const sourceContainer = this.containerManager.getContainer(sourceId);
      const targetContainer = this.containerManager.getContainer(targetId);
      if (!sourceContainer || !targetContainer) continue;

      const outputPorts = sourceContainer.ioPorts.filter(p => p.direction === 'output');
      const inputPorts = targetContainer.ioPorts.filter(p => p.direction === 'input');
      const sourcePort = outputPorts[edge.sourcePortIndex];
      const targetPort = inputPorts[edge.targetPortIndex];
      if (!sourcePort || !targetPort) continue;

      const addedEdge = this.dataFlowEngine.addEdge({
        id: `edge_${Date.now()}_${edgeIds.length}`,
        source: { nodeId: sourceId, portId: sourcePort.id },
        target: { nodeId: targetId, portId: targetPort.id },
      });
      if (addedEdge) edgeIds.push(addedEdge.id);
    }

    const instance: TemplateInstance = { templateId, containerIds, edgeIds, refMap };
    this.emit('template:instantiate', instance);
    return instance;
  }

  saveFromContainers(containerIds: string[], name: string, description: string, category: string): ContainerTemplate | null {
    if (containerIds.length === 0) return null;

    const nodes: ContainerTemplateNode[] = [];
    const firstContainer = this.containerManager.getContainer(containerIds[0]!);
    if (!firstContainer) return null;

    const originX = firstContainer.bounds.x;
    const originY = firstContainer.bounds.y;

    for (const id of containerIds) {
      const container = this.containerManager.getContainer(id);
      if (!container) continue;

      nodes.push({
        refId: id,
        role: container.role,
        label: container.style?.label ?? 'Container',
        relativePosition: {
          x: container.bounds.x - originX,
          y: container.bounds.y - originY,
          width: container.bounds.width,
          height: container.bounds.height,
        },
        contextSlots: container.contextSlots,
        inheritPolicy: container.inheritPolicy,
        ioPorts: container.ioPorts.map(p => ({
          direction: p.direction,
          dataType: p.dataType,
          label: p.label,
          schema: p.schema,
        })),
        agentBinding: container.agentBinding ? {
          agentType: container.agentBinding.agentType,
          role: container.agentBinding.role,
          permissions: container.agentBinding.permissions,
        } : undefined,
      });
    }

    return this.add({ name, description, category, version: '1.0.0', nodes, edges: [], tags: [] });
  }

  private instantiateNode(
    node: ContainerTemplateNode,
    parentId: string | null,
    originX: number,
    originY: number,
    refMap: Map<string, string>,
    containerIds: string[]
  ): void {
    const container = this.containerManager.createContainer({
      parentId,
      role: node.role,
      bounds: {
        x: originX + node.relativePosition.x,
        y: originY + node.relativePosition.y,
        width: node.relativePosition.width,
        height: node.relativePosition.height,
      },
      label: node.label,
    });

    refMap.set(node.refId, container.id);
    containerIds.push(container.id);

    if (node.contextSlots) {
      this.containerManager.updateContextSlots(container.id, node.contextSlots);
    }
    if (node.inheritPolicy) {
      this.containerManager.setInheritPolicy(container.id, node.inheritPolicy);
    }

    for (const portDef of node.ioPorts) {
      this.ioPortManager.addPort({
        containerId: container.id,
        direction: portDef.direction,
        dataType: portDef.dataType,
        label: portDef.label,
        schema: portDef.schema,
      });
    }

    if (node.agentBinding) {
      this.containerManager.bindAgent(container.id, {
        agentId: `agent_${container.id}_${Date.now()}`,
        agentType: node.agentBinding.agentType,
        role: node.agentBinding.role,
        permissions: node.agentBinding.permissions,
        status: 'idle',
      });
    }

    if (node.children) {
      for (const child of node.children) {
        this.instantiateNode(child, container.id, originX, originY, refMap, containerIds);
      }
    }
  }
}
