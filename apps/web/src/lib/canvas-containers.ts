import type { CanvasContainerKind } from "@cucumber/shared";
import type React from "react";

export type CanvasContainerHostElement = {
  customData?: {
    cucumberContainer?: {
      kind?: CanvasContainerKind;
      containerId?: string;
      version?: number;
    };
    [key: string]: unknown;
  };
};

export type CanvasContainerRenderer = (props: {
  element: CanvasContainerHostElement & {
    width?: number;
    height?: number;
  };
}) => React.ReactElement | null;

const renderers = new Map<CanvasContainerKind, CanvasContainerRenderer>();

export function registerCanvasContainerRenderer(
  kind: CanvasContainerKind,
  renderer: CanvasContainerRenderer,
) {
  renderers.set(kind, renderer);
}

export function getCanvasContainerKind(
  element: CanvasContainerHostElement | null | undefined,
): CanvasContainerKind | null {
  const kind = element?.customData?.cucumberContainer?.kind;
  return kind === "agent_flow" ? kind : null;
}

export function renderCanvasContainer(props: {
  element: CanvasContainerHostElement & {
    width?: number;
    height?: number;
  };
}): React.ReactElement | null {
  const kind = getCanvasContainerKind(props.element);
  if (!kind) return null;
  return renderers.get(kind)?.(props) ?? null;
}
