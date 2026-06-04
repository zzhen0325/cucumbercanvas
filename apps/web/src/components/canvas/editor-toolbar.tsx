"use client";

import {
  Cable,
  Hand,
  MousePointer2,
  PanelTop,
  Plus,
  Redo2,
  StickyNote,
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
      aria-label="画布编辑工具"
      className="pointer-events-auto absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card/75 px-3 py-1.5 shadow-card backdrop-blur-lg"
      onClick={stopCanvasPropagation}
      onDoubleClick={stopCanvasPropagation}
      onKeyDown={stopCanvasPropagation}
      onPointerCancel={stopCanvasPropagation}
      onPointerDown={stopCanvasPropagation}
      onPointerMove={stopCanvasPropagation}
      onPointerUp={stopCanvasPropagation}
      onWheel={stopCanvasPropagation}
    >
      <div className="flex items-center gap-1">
        <EditorToolButton
          active={activeTool === "select"}
          icon={MousePointer2}
          label="选择"
          onClick={() => onToolChange("select")}
          shortcut="V"
        />
        <EditorToolButton
          active={activeTool === "hand"}
          icon={Hand}
          label="平移"
          onClick={() => onToolChange("hand")}
          shortcut="H"
        />
      </div>

      <Separator orientation="vertical" className="h-6 w-px bg-border/70" />

      <div className="flex items-center gap-1">
        <EditorToolButton
          active={activeTool === "sticky"}
          icon={StickyNote}
          label="便签"
          onClick={() => onToolChange("sticky")}
          shortcut="S"
        />
        <ShapeToolDropdown
          activeTool={activeTool}
          onInsertIcon={onInsertIcon}
          onImportImage={onImportImage}
          onImportSvg={onImportSvg}
          onToolChange={onToolChange}
        />
        <EditorToolButton
          active={activeTool === "connector"}
          icon={Cable}
          label="连接线"
          onClick={() => onToolChange("connector")}
          shortcut="C"
        />
        <EditorToolButton
          active={activeTool === "text"}
          icon={Type}
          label="文本"
          onClick={() => onToolChange("text")}
          shortcut="T"
        />
        <EditorToolButton
          active={activeTool === "section" || activeTool === "container"}
          icon={PanelTop}
          label="分区"
          onClick={() => onToolChange("section")}
          shortcut="F"
        />
      </div>

      <Separator orientation="vertical" className="h-6 w-px bg-border/70" />

      <div className="flex items-center gap-1">
        <EditorToolButton
          disabled={!canUndo}
          icon={Undo2}
          label="撤销"
          onClick={onUndo}
        />
        <EditorToolButton
          disabled={!canRedo}
          icon={Redo2}
          label="重做"
          onClick={onRedo}
        />
      </div>

      <Separator orientation="vertical" className="h-6 w-px bg-border/70" />

      <div className="flex items-center gap-1">
        <EditorToolButton
          icon={Plus}
          label="新建容器"
          onClick={onCreateContainer}
        />
        <EditorToolButton
          className="hover:bg-destructive/10 hover:text-destructive"
          disabled={selectedCount === 0}
          icon={Trash2}
          label="删除"
          onClick={onDelete}
        />
      </div>
    </nav>
  );
}
