import { containerBackgroundVertex, containerBackgroundFragment } from '../shaders/container-background.glsl.js';

export interface ContainerBackgroundFilterOptions {
  color1?: [number, number, number];
  color2?: [number, number, number];
  color3?: [number, number, number];
  opacity?: number;
  gradientAngle?: number;
}

export class ContainerBackgroundFilter {
  private filter: any = null;
  private time = 0;
  private options: Required<ContainerBackgroundFilterOptions>;

  constructor(options?: ContainerBackgroundFilterOptions) {
    this.options = {
      color1: options?.color1 ?? [0.2, 0.1, 0.4],
      color2: options?.color2 ?? [0.1, 0.3, 0.5],
      color3: options?.color3 ?? [0.05, 0.15, 0.3],
      opacity: options?.opacity ?? 0.15,
      gradientAngle: options?.gradientAngle ?? 0.785,
    };
  }

  async create(): Promise<any> {
    const { Filter, GlProgram } = await import('pixi.js');

    const glProgram = GlProgram.from({
      vertex: containerBackgroundVertex,
      fragment: containerBackgroundFragment,
    });

    this.filter = new Filter({
      glProgram,
      resources: {
        uniforms: {
          uTime: { value: 0, type: 'f32' },
          uColor1: { value: new Float32Array(this.options.color1), type: 'vec3<f32>' },
          uColor2: { value: new Float32Array(this.options.color2), type: 'vec3<f32>' },
          uColor3: { value: new Float32Array(this.options.color3), type: 'vec3<f32>' },
          uOpacity: { value: this.options.opacity, type: 'f32' },
          uGradientAngle: { value: this.options.gradientAngle, type: 'f32' },
        },
      },
    });

    return this.filter;
  }

  update(deltaTime: number): void {
    if (!this.filter) return;
    this.time += deltaTime;
    this.filter.resources.uniforms.uniforms.uTime = this.time;
  }

  setColors(color1: [number, number, number], color2: [number, number, number], color3: [number, number, number]): void {
    if (!this.filter) return;
    const u = this.filter.resources.uniforms.uniforms;
    u.uColor1 = new Float32Array(color1);
    u.uColor2 = new Float32Array(color2);
    u.uColor3 = new Float32Array(color3);
  }

  setOpacity(opacity: number): void {
    if (!this.filter) return;
    this.filter.resources.uniforms.uniforms.uOpacity = opacity;
  }

  getFilter(): any {
    return this.filter;
  }

  static fromColorPalette(palette: string[]): ContainerBackgroundFilter {
    const parseColor = (hex: string): [number, number, number] => {
      const clean = hex.replace('#', '');
      const r = parseInt(clean.slice(0, 2), 16) / 255;
      const g = parseInt(clean.slice(2, 4), 16) / 255;
      const b = parseInt(clean.slice(4, 6), 16) / 255;
      return [r, g, b];
    };

    const color1 = palette[0] ? parseColor(palette[0]) : [0.2, 0.1, 0.4] as [number, number, number];
    const color2 = palette[1] ? parseColor(palette[1]) : [0.1, 0.3, 0.5] as [number, number, number];
    const color3 = palette[2] ? parseColor(palette[2]) : [0.05, 0.15, 0.3] as [number, number, number];

    return new ContainerBackgroundFilter({ color1, color2, color3 });
  }
}
