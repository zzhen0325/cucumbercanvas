import { glowFilterVertex, glowFilterFragment } from '../shaders/glow-filter.glsl.js';

export interface GlowFilterOptions {
  color?: [number, number, number];
  intensity?: number;
  radius?: number;
  pulseSpeed?: number;
}

export class NodeGlowFilter {
  private filter: any = null;
  private time = 0;
  private options: Required<GlowFilterOptions>;

  constructor(options?: GlowFilterOptions) {
    this.options = {
      color: options?.color ?? [0.3, 0.8, 0.5],
      intensity: options?.intensity ?? 1.0,
      radius: options?.radius ?? 4.0,
      pulseSpeed: options?.pulseSpeed ?? 2.0,
    };
  }

  async create(): Promise<any> {
    const { Filter, GlProgram } = await import('pixi.js');

    const glProgram = GlProgram.from({
      vertex: glowFilterVertex,
      fragment: glowFilterFragment,
    });

    this.filter = new Filter({
      glProgram,
      resources: {
        uniforms: {
          uTime: { value: 0, type: 'f32' },
          uGlowColor: { value: new Float32Array(this.options.color), type: 'vec3<f32>' },
          uGlowIntensity: { value: this.options.intensity, type: 'f32' },
          uGlowRadius: { value: this.options.radius, type: 'f32' },
          uPulseSpeed: { value: this.options.pulseSpeed, type: 'f32' },
        },
      },
      padding: Math.ceil(this.options.radius),
    });

    return this.filter;
  }

  update(deltaTime: number): void {
    if (!this.filter) return;
    this.time += deltaTime;
    this.filter.resources.uniforms.uniforms.uTime = this.time;
  }

  setColor(color: [number, number, number]): void {
    if (!this.filter) return;
    this.filter.resources.uniforms.uniforms.uGlowColor = new Float32Array(color);
  }

  setIntensity(intensity: number): void {
    if (!this.filter) return;
    this.filter.resources.uniforms.uniforms.uGlowIntensity = intensity;
  }

  getFilter(): any {
    return this.filter;
  }

  static fromHexColor(hex: string, intensity?: number): NodeGlowFilter {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    return new NodeGlowFilter({ color: [r, g, b], intensity });
  }
}
