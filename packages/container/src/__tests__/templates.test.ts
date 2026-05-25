import { describe, it, expect, beforeEach } from 'vitest';
import { ContainerManager } from '../container-manager.js';
import { DataFlowEngine } from '../dataflow/dataflow-engine.js';
import { IOPortManager } from '../io-port-manager.js';
import { TemplateRegistry } from '../templates/template-registry.js';
import { PRESET_TEMPLATES } from '../templates/presets.js';

describe('TemplateRegistry', () => {
  let containerManager: ContainerManager;
  let dataFlowEngine: DataFlowEngine;
  let ioPortManager: IOPortManager;
  let registry: TemplateRegistry;

  beforeEach(() => {
    containerManager = new ContainerManager();
    dataFlowEngine = new DataFlowEngine(containerManager);
    ioPortManager = new IOPortManager(containerManager);
    registry = new TemplateRegistry(containerManager, ioPortManager, dataFlowEngine);
  });

  it('should load preset templates on initialization', () => {
    const all = registry.getAll();
    expect(all.length).toBe(PRESET_TEMPLATES.length);
    expect(all.some(t => t.id === 'preset_image-generation-pipeline')).toBe(true);
    expect(all.some(t => t.id === 'preset_text-refiner')).toBe(true);
    expect(all.some(t => t.id === 'preset_multi-agent-review')).toBe(true);
  });

  it('should add a custom template', () => {
    const tpl = registry.add({
      name: 'Custom Template',
      description: 'A test template',
      category: 'custom',
      version: '1.0.0',
      nodes: [],
      edges: [],
    });
    expect(tpl.id).toBeTruthy();
    expect(registry.get(tpl.id)).toBeDefined();
  });

  it('should update a template', () => {
    const tpl = registry.add({
      name: 'Original',
      description: 'desc',
      category: 'test',
      version: '1.0.0',
      nodes: [],
      edges: [],
    });
    registry.update(tpl.id, { name: 'Updated', version: '1.1.0' });
    const updated = registry.get(tpl.id)!;
    expect(updated.name).toBe('Updated');
    expect(updated.version).toBe('1.1.0');
  });

  it('should remove a template', () => {
    const tpl = registry.add({
      name: 'To Remove',
      description: '',
      category: 'test',
      version: '1.0.0',
      nodes: [],
      edges: [],
    });
    expect(registry.remove(tpl.id)).toBe(true);
    expect(registry.get(tpl.id)).toBeUndefined();
  });

  it('should search templates by name and tags', () => {
    registry.add({
      name: 'Unique Flowchart',
      description: 'A flowchart template',
      category: 'diagram',
      version: '1.0.0',
      tags: ['flow', 'diagram'],
      nodes: [],
      edges: [],
    });

    const results = registry.search('flowchart');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toContain('Flowchart');

    const tagResults = registry.search('flow');
    expect(tagResults.length).toBeGreaterThan(0);
  });

  it('should filter by category', () => {
    const gen = registry.getByCategory('generation');
    expect(gen.length).toBeGreaterThan(0);
    expect(gen.every(t => t.category === 'generation')).toBe(true);
  });

  it('should instantiate image-generation-pipeline template', () => {
    const instance = registry.instantiate('preset_image-generation-pipeline', 100, 100);
    expect(instance).not.toBeNull();
    expect(instance!.containerIds).toHaveLength(2);
    expect(instance!.edgeIds).toHaveLength(1);

    const containers = containerManager.getAllContainers();
    expect(containers).toHaveLength(2);

    const promptGen = containers.find(c => c.title === 'Prompt Generator');
    expect(promptGen).toBeDefined();
    expect(promptGen!.bounds.x).toBe(100);
    expect(promptGen!.ioPorts).toHaveLength(2);
    expect(promptGen!.agentBinding?.agentType).toBe('composer');

    const imgRenderer = containers.find(c => c.title === 'Image Renderer');
    expect(imgRenderer).toBeDefined();
    expect(imgRenderer!.bounds.x).toBe(500);
    expect(imgRenderer!.ioPorts).toHaveLength(2);
  });

  it('should instantiate multi-agent-review template with correct edges', () => {
    const instance = registry.instantiate('preset_multi-agent-review', 0, 0);
    expect(instance).not.toBeNull();
    expect(instance!.containerIds).toHaveLength(5);
    expect(instance!.edgeIds).toHaveLength(6);

    const edges = dataFlowEngine.getAllEdges();
    expect(edges).toHaveLength(6);
  });

  it('should save containers as template', () => {
    const c1 = containerManager.createContainer({
      bounds: { x: 50, y: 50, width: 200, height: 150 },
      label: 'Source',
      role: ['context'],
    });
    ioPortManager.addPort({ containerId: c1.id, direction: 'output', dataType: 'text' });

    const c2 = containerManager.createContainer({
      bounds: { x: 350, y: 50, width: 200, height: 150 },
      label: 'Processor',
      role: ['task'],
    });
    ioPortManager.addPort({ containerId: c2.id, direction: 'input', dataType: 'text' });

    const tpl = registry.saveFromContainers([c1.id, c2.id], 'My Workflow', 'Custom workflow', 'custom');
    expect(tpl).not.toBeNull();
    expect(tpl!.nodes).toHaveLength(2);
    expect(tpl!.nodes[0]!.relativePosition.x).toBe(0);
    expect(tpl!.nodes[1]!.relativePosition.x).toBe(300);
  });
});
