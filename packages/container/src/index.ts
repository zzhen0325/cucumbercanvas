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
