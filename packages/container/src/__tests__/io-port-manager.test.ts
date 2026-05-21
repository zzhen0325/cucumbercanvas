import { describe, it, expect, beforeEach } from 'vitest';
import { IOPortManager } from '../io-port-manager.js';
import { ContainerManager } from '../container-manager.js';

describe('IOPortManager', () => {
  let containerManager: ContainerManager;
  let portManager: IOPortManager;

  beforeEach(() => {
    containerManager = new ContainerManager();
    portManager = new IOPortManager(containerManager);

    containerManager.createContainer({
      id: 'container-1',
      bounds: { x: 0, y: 0, width: 300, height: 200 },
    });
  });

  describe('addPort', () => {
    it('should add an input port to container', () => {
      const port = portManager.addPort({
        containerId: 'container-1',
        direction: 'input',
        dataType: 'image',
        label: 'Image Input',
      });

      expect(port).not.toBeNull();
      expect(port!.direction).toBe('input');
      expect(port!.dataType).toBe('image');
      expect(port!.label).toBe('Image Input');
    });

    it('should add an output port to container', () => {
      const port = portManager.addPort({
        containerId: 'container-1',
        direction: 'output',
        dataType: 'text',
      });

      expect(port).not.toBeNull();
      expect(port!.direction).toBe('output');
      expect(port!.dataType).toBe('text');
    });

    it('should return null for nonexistent container', () => {
      const port = portManager.addPort({
        containerId: 'nonexistent',
        direction: 'input',
        dataType: 'json',
      });

      expect(port).toBeNull();
    });

    it('should support all port types', () => {
      const types = ['image', 'text', 'json', 'reference', 'prompt'] as const;
      for (const type of types) {
        const port = portManager.addPort({
          containerId: 'container-1',
          direction: 'input',
          dataType: type,
        });
        expect(port).not.toBeNull();
        expect(port!.dataType).toBe(type);
      }
    });
  });

  describe('removePort', () => {
    it('should remove an existing port', () => {
      const port = portManager.addPort({
        containerId: 'container-1',
        direction: 'input',
        dataType: 'image',
        id: 'port-to-remove',
      });

      const result = portManager.removePort('container-1', 'port-to-remove');
      expect(result).toBe(true);

      const container = containerManager.getContainer('container-1');
      expect(container!.ioPorts.find(p => p.id === 'port-to-remove')).toBeUndefined();
    });

    it('should return false for nonexistent port', () => {
      expect(portManager.removePort('container-1', 'nonexistent')).toBe(false);
    });
  });

  describe('getPort', () => {
    it('should retrieve a port by id', () => {
      portManager.addPort({
        containerId: 'container-1',
        direction: 'output',
        dataType: 'json',
        id: 'my-port',
        label: 'JSON Output',
      });

      const port = portManager.getPort('container-1', 'my-port');
      expect(port).toBeDefined();
      expect(port!.label).toBe('JSON Output');
    });
  });

  describe('getInputPorts / getOutputPorts', () => {
    it('should separate input and output ports', () => {
      portManager.addPort({ containerId: 'container-1', direction: 'input', dataType: 'image' });
      portManager.addPort({ containerId: 'container-1', direction: 'input', dataType: 'text' });
      portManager.addPort({ containerId: 'container-1', direction: 'output', dataType: 'json' });

      expect(portManager.getInputPorts('container-1')).toHaveLength(2);
      expect(portManager.getOutputPorts('container-1')).toHaveLength(1);
    });
  });

  describe('getPortPosition', () => {
    it('should calculate input port positions on left edge', () => {
      portManager.addPort({ containerId: 'container-1', direction: 'input', dataType: 'image', id: 'p1' });
      portManager.addPort({ containerId: 'container-1', direction: 'input', dataType: 'text', id: 'p2' });

      const pos1 = portManager.getPortPosition('container-1', 'p1');
      const pos2 = portManager.getPortPosition('container-1', 'p2');

      expect(pos1).not.toBeNull();
      expect(pos1!.x).toBe(0);
      expect(pos1!.y).toBeCloseTo(200 / 3);

      expect(pos2).not.toBeNull();
      expect(pos2!.x).toBe(0);
      expect(pos2!.y).toBeCloseTo(200 * 2 / 3);
    });

    it('should calculate output port positions on right edge', () => {
      portManager.addPort({ containerId: 'container-1', direction: 'output', dataType: 'image', id: 'p1' });

      const pos = portManager.getPortPosition('container-1', 'p1');
      expect(pos).not.toBeNull();
      expect(pos!.x).toBe(300);
      expect(pos!.y).toBe(100);
    });
  });

  describe('updatePort', () => {
    it('should update port properties', () => {
      portManager.addPort({
        containerId: 'container-1',
        direction: 'input',
        dataType: 'text',
        id: 'port-1',
        label: 'Original',
      });

      portManager.updatePort('container-1', 'port-1', { label: 'Updated', dataType: 'prompt' });

      const port = portManager.getPort('container-1', 'port-1');
      expect(port!.label).toBe('Updated');
      expect(port!.dataType).toBe('prompt');
    });
  });
});
