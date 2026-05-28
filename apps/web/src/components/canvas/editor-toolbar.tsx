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
  onInsertIcon?: () => void;
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
  onInsertIcon,
  onImportImage,
  onImportSvg,
  onRedo,
  onToolChange,
  onUndo,
}: CanvasEditorToolbarProps) {
  return (
    <nav
      aria-label="Canvas editor tools"
      className="pointer-events-auto absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-full border border-border bg-card/75 p-1.5 py-4   backdrop-blur-lg"
      onClick={stopCanvasPropagation}
      onDoubleClick={stopCanvasPropagation}
      onKeyDown={stopCanvasPropagation}
      onPointerCancel={stopCanvasPropagation}
      onPointerDown={stopCanvasPropagation}
      onPointerMove={stopCanvasPropagation}
      onPointerUp={stopCanvasPropagation}
      onWheel={stopCanvasPropagation}
    >
      <div className="flex flex-col items-center gap-1">
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
      </div>

      <Separator className="h-px w-4 bg-border/70" />

      <div className="flex flex-col items-center gap-1">
        <ShapeToolDropdown
          activeTool={activeTool}
          onInsertIcon={onInsertIcon}
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
      </div>

      <Separator className="h-px w-4  bg-border/70" />

      <div className="flex flex-col items-center gap-1">
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
      </div>

      <Separator className="h-px w-4 bg-border/70" />

      <div className="flex flex-col items-center gap-1">
        <EditorToolButton
          icon={Plus}
          label="New container"
          onClick={onCreateContainer}
        />
        <EditorToolButton
          className="hover:bg-destructive/10 hover:text-destructive"
          disabled={selectedCount === 0}
          icon={Trash2}
          label="Delete"
          onClick={onDelete}
        />
      </div>
    </nav>
  );
}
