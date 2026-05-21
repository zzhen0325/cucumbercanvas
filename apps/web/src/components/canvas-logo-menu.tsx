"use client";

import { createCanvasNodeId } from "@cucumber/canvas-core";
import {
  Copy,
  FolderOpen,
  Home,
  ImagePlus,
  Maximize2,
  Plus,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import type { CanvasApi } from "@/components/canvas/canvas-surface";
import { CucumberLogo } from "@/components/icons/cucumber-logo";
import { useToast } from "@/components/toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCreateProject } from "@/hooks/use-create-project";
import { deleteProject } from "@/lib/server-api";

interface CanvasLogoMenuProps {
  accessToken: string;
  projectId: string;
  canvasId: string;
  canvasApi: CanvasApi | null;
}

function generateFileId(): string {
  return createCanvasNodeId("asset");
}

function scaleToFit(width: number, height: number, maxSize: number) {
  if (width <= maxSize && height <= maxSize) return { width, height };
  const scale = maxSize / Math.max(width, height);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

export function CanvasLogoMenu({
  accessToken,
  projectId,
  canvasApi,
}: CanvasLogoMenuProps) {
  const router = useRouter();
  const { error: toastError } = useToast();
  const { create: createNewProject } = useCreateProject();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleDuplicateElements = useCallback(() => {
    if (!canvasApi) return;
    const selectedIds = canvasApi.getAppState().selectedElementIds ?? {};
    const doc = canvasApi.getDocument();
    const selected = Object.values(doc.nodes).filter(
      (node) => selectedIds[node.id],
    );
    if (!selected.length) return;

    const cloneIds: string[] = [];
    for (const node of selected) {
      const cloneId = createCanvasNodeId(node.type);
      cloneIds.push(cloneId);
      canvasApi.insertNode(
        {
          ...node,
          id: cloneId,
          bounds: {
            ...node.bounds,
            x: node.bounds.x + 10,
            y: node.bounds.y + 10,
          },
          title: node.title ? `${node.title} copy` : node.title,
          ...(node.type === "container" ? { childrenOrder: [] } : {}),
        },
        node.parentId,
      );
    }
    canvasApi.setSelection(cloneIds);
    console.info("[canvas-menu] duplicated canvas nodes", {
      count: cloneIds.length,
    });
  }, [canvasApi]);

  const handleDeleteProject = useCallback(async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    try {
      await deleteProject(accessToken, projectId);
      router.push("/projects");
    } catch (err) {
      console.warn("Failed to delete project:", err);
      toastError("项目删除失败");
    } finally {
      setConfirmingDelete(false);
    }
  }, [accessToken, projectId, router, confirmingDelete, toastError]);

  const handleFileImport = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !canvasApi) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataURL = reader.result as string;
        const img = new Image();
        img.onload = () => {
          const scaled = scaleToFit(img.width, img.height, 600);
          canvasApi.insertImageArtifact({
            assetId: generateFileId(),
            url: dataURL,
            mimeType: file.type || "image/png",
            width: scaled.width,
            height: scaled.height,
            title: file.name,
          });
          console.info("[canvas-menu] imported image into canvas", {
            name: file.name,
            mimeType: file.type,
          });
        };
        img.src = dataURL;
      };
      reader.readAsDataURL(file);
      event.target.value = "";
    },
    [canvasApi],
  );

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) setConfirmingDelete(false);
        }}
      >
        <DropdownMenuTrigger
          className="flex items-center justify-center size-8 rounded-xl bg-card/80 backdrop-blur-sm shadow-sm border border-border hover:bg-card transition-colors cursor-pointer outline-none"
          aria-label="菜单"
        >
          <CucumberLogo className="size-5 text-foreground" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" sideOffset={6} className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => router.push("/home")}>
              <Home className="size-4" />
              主页
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/projects")}>
              <FolderOpen className="size-4" />
              项目库
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => createNewProject()}>
              <Plus className="size-4" />
              新建项目
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={handleDeleteProject}
            >
              <Trash2 className="size-4" />
              {confirmingDelete ? "确认删除?" : "删除当前项目"}
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <ImagePlus className="size-4" />
              导入图片
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuItem onClick={handleDuplicateElements}>
              <Copy className="size-4" />
              复制对象
              <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => canvasApi?.scrollToContent()}>
              <Maximize2 className="size-4" />
              显示画布所有元素
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileImport}
      />
    </>
  );
}
