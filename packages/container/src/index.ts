export type {
  ContainerRole,
  InheritPolicy,
  ContextSlots,
  IOPort,
  AgentBinding,
  ContainerPermissions,
} from '@cucumber/pen-types';

export type { ContainerNode, ContainerBounds } from './types.js';

export { resolveContext, getContainerPath } from './context-resolver.js';
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

export { AgentOrchestrator } from './collaboration/agent-orchestrator.js';
export type { AgentOrchestratorEvents } from './collaboration/agent-orchestrator.js';
export { AgentCollabSession } from './collaboration/agent-collab-session.js';
export type { AgentCollabSessionEvents } from './collaboration/agent-collab-session.js';
export type {
  AgentCollabMessage,
  AgentCollabMessageType,
  AgentCollabSessionState,
  AgentStatus,
  ConflictRecord,
  ContainerLock,
  OperationEntry,
  OrchestratorConfig,
} from './collaboration/types.js';

export { TemplateRegistry } from './templates/template-registry.js';
export type { TemplateRegistryEvents } from './templates/template-registry.js';
export { PRESET_TEMPLATES } from './templates/presets.js';
export type {
  ContainerTemplate,
  ContainerTemplateNode,
  ContainerTemplateEdge,
  ContainerTemplatePort,
  ContainerTemplateBinding,
  ContainerTemplateShader,
  TemplateInstance,
} from './templates/types.js';
export { IncrementalRenderer } from './performance/incremental-renderer.js';
export type { DirtyMarkingEvents } from './performance/incremental-renderer.js';
export { AgentThrottler } from './performance/agent-throttler.js';
export type { AgentThrottlerEvents, ThrottlerConfig } from './performance/agent-throttler.js';
export { DataFlowBatchExecutor } from './performance/dataflow-batch-executor.js';
export type { BatchExecutorEvents, BatchExecutorConfig } from './performance/dataflow-batch-executor.js';
