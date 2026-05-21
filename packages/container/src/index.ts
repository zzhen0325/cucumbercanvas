export type {
  ContainerRole,
  InheritPolicy,
  ContainerBounds,
  ContextSlots,
  IOPort,
  AgentBinding,
  ContainerPermissions,
  ContainerNode,
} from './types.js';

export { resolveContext } from './context-resolver.js';
export { ContainerManager } from './container-manager.js';
export type { ContainerManagerEvents, CreateContainerOptions } from './container-manager.js';

export { AgentRegistry } from './agent-registry.js';
export type { AgentIdentity, AgentRegistryEvents } from './agent-registry.js';

export type {
  AgentContext,
  AgentMessage,
  PeerRequest,
  PeerResponse,
  ContainerEvents,
  NodeSummary,
} from './agent-context.js';

export { AgentContextBuilder } from './agent-context-builder.js';

export { IOPortManager } from './io-port-manager.js';
export type { AddPortOptions } from './io-port-manager.js';

export { DataFlowEngine } from './dataflow/dataflow-engine.js';
export type { DataFlowEngineEvents } from './dataflow/dataflow-engine.js';
export type {
  DataFlowEdge,
  PortPayload,
  NodeExecutor,
  ResolvedContext,
  PortCompatibilityRule,
} from './dataflow/types.js';
export { isPortCompatible, PORT_COMPATIBILITY } from './dataflow/types.js';
