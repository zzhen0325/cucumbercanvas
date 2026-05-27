"use client";

import {
  ArrowRight,
  ChevronDown,
  Circle,
  FileCode2,
  ImageIcon,
  Minus,
  PenTool,
  Pentagon,
  Smile,
  Square,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { CanvasTool } from "./canvas-api";
import { EditorToolButton } from "./editor-tool-button";

type ShapeTool = Extract<
  CanvasTool,
  "rect" | "ellipse" | "polygon" | "line" | "arrow" | "path"
>;

const SHAPE_TOOLS: Array<{
  icon: typeof Square;
  label: string;
  shortcut?: string;
  tool: ShapeTool;
}> = [
  { icon: Square, label: "Rectangle", shortcut: "R", tool: "rect" },
  { icon: Circle, label: "Ellipse", shortcut: "O", tool: "ellipse" },
  { icon: Pentagon, label: "Polygon", tool: "polygon" },
  { icon: Minus, label: "Line", tool: "line" },
  { icon: ArrowRight, label: "Arrow", tool: "arrow" },
  { icon: PenTool, label: "Path", shortcut: "P", tool: "path" },
];

const DEFAULT_SHAPE_TOOL = SHAPE_TOOLS[0] as (typeof SHAPE_TOOLS)[number];

const shapeToolSet = new Set<CanvasTool>(
  SHAPE_TOOLS.map((shape) => shape.tool),
);

export type ShapeToolDropdownProps = {
  activeTool: CanvasTool;
  onInsertIcon?: () => void;
  onImportImage: () => void;
  onImportSvg: () => void;
  onToolChange: (tool: CanvasTool) => void;
};

export function ShapeToolDropdown({
  activeTool,
  onInsertIcon,
  onImportImage,
  onImportSvg,
  onToolChange,
}: ShapeToolDropdownProps) {
  const [lastShapeTool, setLastShapeTool] = useState<ShapeTool>("rect");
  const activeShape = shapeToolSet.has(activeTool) ? activeTool : null;
  const primaryTool = (activeShape ?? lastShapeTool) as ShapeTool;
  const primaryShape = useMemo(
    () =>
      SHAPE_TOOLS.find((shape) => shape.tool === primaryTool) ??
      DEFAULT_SHAPE_TOOL,
    [primaryTool],
  );

  const chooseShapeTool = (tool: ShapeTool) => {
    setLastShapeTool(tool);
    onToolChange(tool);
  };

  return (
    <DropdownMenu modal={false}>
      <div className="flex items-center rounded-lg">
        <EditorToolButton
          active={Boolean(activeShape)}
          icon={primaryShape.icon}
          label="Shapes"
          onClick={() => chooseShapeTool(primaryTool)}
          shortcut={primaryShape.shortcut}
        />
        <DropdownMenuTrigger
          aria-label="Open shape menu"
          className={cn(
            "-ml-1 flex size-5 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
            activeShape && "text-foreground",
          )}
          title="Open shape menu"
        >
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent
        align="start"
        side="right"
        sideOffset={8}
        className="w-44"
      >
        <DropdownMenuGroup>
          {SHAPE_TOOLS.map((shape) => {
            const Icon = shape.icon;
            return (
              <DropdownMenuItem
                key={shape.tool}
                onClick={() => chooseShapeTool(shape.tool)}
              >
                <Icon className="size-4" />
                {shape.label}
                {shape.shortcut ? (
                  <DropdownMenuShortcut>{shape.shortcut}</DropdownMenuShortcut>
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              if (onInsertIcon) {
                onInsertIcon();
                return;
              }
              onToolChange("icon");
            }}
          >
            <Smile className="size-4" />
            Insert icon
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onImportImage}>
            <ImageIcon className="size-4" />
            Import image
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onImportSvg}>
            <FileCode2 className="size-4" />
            Import SVG
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
