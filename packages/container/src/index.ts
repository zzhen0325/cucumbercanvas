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
