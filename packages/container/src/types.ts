// Re-export canonical types from pen-types
import type { PenNode } from '@cucumber/pen-types';

export type {
  ContainerRole,
  InheritPolicy,
  ContextSlots,
  IOPort,
  AgentBinding,
  ContainerPermissions,
} from '@cucumber/pen-types';

/** @deprecated Backward-compatible alias for PenNode. Use PenNode from @cucumber/pen-types directly. */
export type ContainerNode = PenNode;

// Container-specific bounds (legacy, use PenNode x/y/width/height)
export interface ContainerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  z?: number;
}
