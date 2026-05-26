"use client";

import {
  Frame,
  Hand,
  MousePointer2,
  Plus,
  Redo2,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";

import { Separator } from "@/components/ui/separator";
import type { CanvasTool } from "./canvas-api";
import { EditorToolButton } from "./editor-tool-button";
import { ShapeToolDropdown } from "./shape-tool-dropdown";

type ToolbarEvent =
  | React.MouseEvent<HTMLElement>
  | React.PointerEvent<HTMLElement>
  | React.KeyboardEvent<HTMLElement>
  | React.WheelEvent<HTMLElement>;

function stopCanvasPropagation(event: ToolbarEvent) {
  event.stopPropagation();
}

export type CanvasEditorToolbarProps = {
  activeTool: CanvasTool;
  canRedo: boolean;
  canUndo: boolean;
  selectedCount: number;
  onCreateContainer: () => void;
  onDelete: () => void;
  onImportImage: () => void;
  onImportSvg: () => void;
  onRedo: () => void;
  onToolChange: (tool: CanvasTool) => void;
  onUndo: () => void;
};

export function CanvasEditorToolbar({
  activeTool,
  canRedo,
  canUndo,
  selectedCount,
  onCreateContainer,
  onDelete,
  onImportImage,
  onImportSvg,
  onRedo,
  onToolChange,
  onUndo,
}: CanvasEditorToolbarProps) {
  return (
    <nav
      aria-label="Canvas editor tools"
      className="pointer-events-auto absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-1 rounded-lg border border-border bg-card/95 p-1.5 shadow-card backdrop-blur"
      onClick={stopCanvasPropagation}
      onDoubleClick={stopCanvasPropagation}
      onKeyDown={stopCanvasPropagation}
      onPointerCancel={stopCanvasPropagation}
      onPointerDown={stopCanvasPropagation}
      onPointerMove={stopCanvasPropagation}
      onPointerUp={stopCanvasPropagation}
      onWheel={stopCanvasPropagation}
    >
      <EditorToolButton
        active={activeTool === "select"}
        icon={MousePointer2}
        label="Select"
        onClick={() => onToolChange("select")}
        shortcut="V"
      />
      <EditorToolButton
        active={activeTool === "hand"}
        icon={Hand}
        label="Hand"
        onClick={() => onToolChange("hand")}
        shortcut="H"
      />
      <ShapeToolDropdown
        activeTool={activeTool}
        onImportImage={onImportImage}
        onImportSvg={onImportSvg}
        onToolChange={onToolChange}
      />
      <EditorToolButton
        active={activeTool === "text"}
        icon={Type}
        label="Text"
        onClick={() => onToolChange("text")}
        shortcut="T"
      />
      <EditorToolButton
        active={activeTool === "container"}
        icon={Frame}
        label="Frame"
        onClick={() => onToolChange("container")}
        shortcut="F"
      />

      <Separator className="my-1 h-px w-6" />

      <EditorToolButton
        disabled={!canUndo}
        icon={Undo2}
        label="Undo"
        onClick={onUndo}
      />
      <EditorToolButton
        disabled={!canRedo}
        icon={Redo2}
        label="Redo"
        onClick={onRedo}
      />

      <Separator className="my-1 h-px w-6" />

      <EditorToolButton
        icon={Plus}
        label="New container"
        onClick={onCreateContainer}
      />
      <EditorToolButton
        className="hover:text-destructive"
        disabled={selectedCount === 0}
        icon={Trash2}
        label="Delete"
        onClick={onDelete}
      />
    </nav>
  );
}
