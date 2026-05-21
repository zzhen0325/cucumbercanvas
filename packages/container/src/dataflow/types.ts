import type { IOPort, ContextSlots } from '../types.js';

export interface DataFlowEdge {
  id: string;
  source: { nodeId: string; portId: string };
  target: { nodeId: string; portId: string };
  status: 'idle' | 'flowing' | 'error';
  transform?: { type: string; params?: unknown };
}

export type PortPayload =
  | { type: 'image'; url: string; width?: number; height?: number; mime?: string }
  | { type: 'text'; content: string }
  | { type: 'json'; value: unknown; schema?: string }
  | { type: 'reference'; refType: 'image' | 'text' | 'node'; ref: string }
  | { type: 'prompt'; template: string; vars?: Record<string, unknown> };

export interface ResolvedContext extends ContextSlots {
  containerId: string;
  containerPath: string[];
}

export type NodeExecutor = (
  inputs: Record<string, PortPayload>,
  ctx: ResolvedContext,
  emit: (portId: string, payload: PortPayload) => void
) => Promise<void>;

export interface PortCompatibilityRule {
  output: IOPort['dataType'];
  input: IOPort['dataType'];
}

export const PORT_COMPATIBILITY: PortCompatibilityRule[] = [
  { output: 'image', input: 'image' },
  { output: 'image', input: 'reference' },
  { output: 'text', input: 'text' },
  { output: 'text', input: 'prompt' },
  { output: 'json', input: 'json' },
  { output: 'reference', input: 'reference' },
  { output: 'prompt', input: 'prompt' },
];

export function isPortCompatible(
  outputType: IOPort['dataType'],
  inputType: IOPort['dataType']
): boolean {
  return PORT_COMPATIBILITY.some(
    rule => rule.output === outputType && rule.input === inputType
  );
}
