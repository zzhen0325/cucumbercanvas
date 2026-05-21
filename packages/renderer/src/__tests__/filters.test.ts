import { describe, it, expect } from 'vitest';
import { ContainerBackgroundFilter } from '../filters/container-background-filter.js';
import { NodeGlowFilter } from '../filters/node-glow-filter.js';
import { DataFlowParticleSystem } from '../filters/dataflow-particle-system.js';

describe('ContainerBackgroundFilter', () => {
  it('should create with default options', () => {
    const filter = new ContainerBackgroundFilter();
    expect(filter).toBeDefined();
    expect(filter.getFilter()).toBeNull();
  });

  it('should create with custom options', () => {
    const filter = new ContainerBackgroundFilter({
      color1: [1, 0, 0],
      color2: [0, 1, 0],
      color3: [0, 0, 1],
      opacity: 0.5,
      gradientAngle: 1.57,
    });
    expect(filter).toBeDefined();
  });

  it('should create from color palette', () => {
    const filter = ContainerBackgroundFilter.fromColorPalette(['#FF6B6B', '#4ECDC4', '#1A1A2E']);
    expect(filter).toBeDefined();
  });

  it('should handle empty palette gracefully', () => {
    const filter = ContainerBackgroundFilter.fromColorPalette([]);
    expect(filter).toBeDefined();
  });
});

describe('NodeGlowFilter', () => {
  it('should create with default options', () => {
    const filter = new NodeGlowFilter();
    expect(filter).toBeDefined();
    expect(filter.getFilter()).toBeNull();
  });

  it('should create from hex color', () => {
    const filter = NodeGlowFilter.fromHexColor('#FF6B6B', 1.5);
    expect(filter).toBeDefined();
  });

  it('should not crash when setting color before create', () => {
    const filter = new NodeGlowFilter();
    filter.setColor([1, 0, 0]);
    filter.setIntensity(2.0);
    filter.update(0.016);
  });
});

describe('DataFlowParticleSystem', () => {
  it('should create with default options', () => {
    const system = new DataFlowParticleSystem();
    expect(system).toBeDefined();
  });

  it('should create with custom options', () => {
    const system = new DataFlowParticleSystem({
      color: [1, 0.5, 0],
      speed: 2.0,
      particleCount: 20,
      particleSize: 5,
      globalAlpha: 0.6,
    });
    expect(system).toBeDefined();
  });

  it('should handle path setting', () => {
    const system = new DataFlowParticleSystem();
    system.setPath([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: 200, y: 0 },
    ]);
    system.update(0.016);
  });

  it('should handle empty path gracefully', () => {
    const system = new DataFlowParticleSystem();
    system.setPath([]);
    system.update(0.016);
  });

  it('should toggle active state', () => {
    const system = new DataFlowParticleSystem();
    system.setActive(false);
    system.setActive(true);
  });
});
