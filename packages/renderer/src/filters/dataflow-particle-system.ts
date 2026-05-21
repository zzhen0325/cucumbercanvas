export interface DataFlowParticleOptions {
  color?: [number, number, number];
  speed?: number;
  particleCount?: number;
  particleSize?: number;
  globalAlpha?: number;
}

export interface FlowPathPoint {
  x: number;
  y: number;
}

export class DataFlowParticleSystem {
  private container: any = null;
  private particles: any[] = [];
  private time = 0;
  private options: Required<DataFlowParticleOptions>;
  private path: FlowPathPoint[] = [];
  private active = true;

  constructor(options?: DataFlowParticleOptions) {
    this.options = {
      color: options?.color ?? [0.3, 0.8, 1.0],
      speed: options?.speed ?? 1.0,
      particleCount: options?.particleCount ?? 12,
      particleSize: options?.particleSize ?? 4,
      globalAlpha: options?.globalAlpha ?? 0.8,
    };
  }

  async create(stage: any): Promise<any> {
    const { Container: PixiContainer, Graphics } = await import('pixi.js');
    this.container = new PixiContainer();
    this.container.label = 'dataflow-particles';

    for (let i = 0; i < this.options.particleCount; i++) {
      const particle = new Graphics();
      particle.circle(0, 0, this.options.particleSize);
      particle.fill({
        color: this.colorToHex(this.options.color),
        alpha: 0,
      });
      this.container.addChild(particle);
      this.particles.push(particle);
    }

    stage.addChild(this.container);
    return this.container;
  }

  setPath(path: FlowPathPoint[]): void {
    this.path = path;
  }

  update(deltaTime: number): void {
    if (!this.active || this.path.length < 2) return;
    this.time += deltaTime * this.options.speed;

    const totalLength = this.getPathLength();

    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      if (!particle) continue;

      const offset = (i / this.particles.length + this.time * 0.3) % 1.0;
      const pos = this.getPointAtProgress(offset);
      if (!pos) continue;

      particle.position.set(pos.x, pos.y);

      const fade = Math.sin(offset * Math.PI);
      const pulse = 0.6 + 0.4 * Math.sin(this.time * 4 + i * 0.5);
      particle.alpha = fade * pulse * this.options.globalAlpha;
      particle.scale.set(0.5 + fade * 0.5);
    }
  }

  setActive(active: boolean): void {
    this.active = active;
    if (this.container) {
      this.container.visible = active;
    }
  }

  setColor(color: [number, number, number]): void {
    this.options.color = color;
    const hex = this.colorToHex(color);
    for (const particle of this.particles) {
      particle.clear();
      particle.circle(0, 0, this.options.particleSize);
      particle.fill({ color: hex, alpha: 1 });
    }
  }

  destroy(): void {
    if (this.container) {
      this.container.destroy({ children: true });
      this.container = null;
    }
    this.particles = [];
  }

  private getPathLength(): number {
    let length = 0;
    for (let i = 1; i < this.path.length; i++) {
      const dx = this.path[i]!.x - this.path[i - 1]!.x;
      const dy = this.path[i]!.y - this.path[i - 1]!.y;
      length += Math.sqrt(dx * dx + dy * dy);
    }
    return length;
  }

  private getPointAtProgress(progress: number): FlowPathPoint | null {
    if (this.path.length < 2) return null;

    const totalLength = this.getPathLength();
    const targetDist = progress * totalLength;
    let accumulated = 0;

    for (let i = 1; i < this.path.length; i++) {
      const dx = this.path[i]!.x - this.path[i - 1]!.x;
      const dy = this.path[i]!.y - this.path[i - 1]!.y;
      const segLen = Math.sqrt(dx * dx + dy * dy);

      if (accumulated + segLen >= targetDist) {
        const t = (targetDist - accumulated) / segLen;
        return {
          x: this.path[i - 1]!.x + dx * t,
          y: this.path[i - 1]!.y + dy * t,
        };
      }
      accumulated += segLen;
    }

    return this.path[this.path.length - 1] ?? null;
  }

  private colorToHex(color: [number, number, number]): string {
    const r = Math.round(color[0] * 255).toString(16).padStart(2, '0');
    const g = Math.round(color[1] * 255).toString(16).padStart(2, '0');
    const b = Math.round(color[2] * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
}
