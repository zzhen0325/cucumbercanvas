"use client";

import { getNodeBounds } from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";
import { type RefObject, useLayoutEffect } from "react";

const MIN_EXPANDED_WIDTH = 460;
const MAX_EXPANDED_WIDTH = 640;
const MIN_EXPANDED_HEIGHT = 220;
const MAX_EXPANDED_HEIGHT = 760;

export const AGENT_RUN_NODE_SIZE_WRITEBACK_EPSILON = 4;

export function useAgentRunNodeAutosize(input: {
  enabled: boolean;
  node: PenNode;
  onResize: (node: PenNode, size: { height: number; width: number }) => void;
  sectionRef: RefObject<HTMLElement | null>;
  zoom: number;
}) {
  const { enabled, node, onResize, sectionRef, zoom } = input;
  useLayoutEffect(() => {
    if (!enabled) return;
    const section = sectionRef.current;
    if (!section) return;
    const measuredHeight = section.scrollHeight;
    if (measuredHeight <= 0) return;
    const currentBounds = getNodeBounds(node);
    const desiredWidth = clampNumber(
      currentBounds.width,
      MIN_EXPANDED_WIDTH,
      MAX_EXPANDED_WIDTH,
    );
    const desiredHeight = clampNumber(
      Math.ceil(measuredHeight / zoom),
      MIN_EXPANDED_HEIGHT,
      MAX_EXPANDED_HEIGHT,
    );
    onResize(node, {
      height: desiredHeight,
      width: desiredWidth,
    });
  }, [enabled, node, onResize, sectionRef, zoom]);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
