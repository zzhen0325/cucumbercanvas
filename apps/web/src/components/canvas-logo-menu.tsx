"use client";

import { createNodeId } from "@cucumber/canvas-core";
import {
  ClipboardPaste,
  Copy,
  FolderOpen,
  Home,
  ImagePlus,
  Maximize2,
  Plus,
  ScanText,
  Scissors,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import type { CanvasApi } from "@/components/canvas/canvas-api";
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
  return createNodeId("asset");
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
  const { error: toastError, success: toastSuccess } = useToast();
  const { create: createNewProject } = useCreateProject();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const svgInputRef = useRef<HTMLInputElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleDuplicateElements = useCallback(() => {
    if (!canvasApi) return;
    const cloneIds = canvasApi.duplicateSelection();
    if (!cloneIds.length) return;
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

  const handleImageImport = useCallback(
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

  const handleSvgImport = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || !canvasApi) return;
      const reader = new FileReader();
      reader.onload = () => {
        const svgMarkup = String(reader.result ?? "");
        const inserted = canvasApi.importSvgMarkup(svgMarkup);
        if (inserted.length > 0) {
          toastSuccess(
            `SVG 已导入 ${inserted.length} 个节点，如有兼容性提醒会显示在画布顶部。`,
          );
        }
      };
      reader.onerror = () => toastError("SVG 文件读取失败");
      reader.readAsText(file);
    },
    [canvasApi, toastError, toastSuccess],
  );

  const handleCopy = useCallback(() => {
    if (canvasApi?.copySelection()) {
      toastSuccess("已复制当前选区");
    }
  }, [canvasApi, toastSuccess]);

  const handleCut = useCallback(() => {
    if (!canvasApi) return;
    if (canvasApi.copySelection()) {
      canvasApi.deleteSelection();
      toastSuccess("已剪切当前选区");
    }
  }, [canvasApi, toastSuccess]);

  const handlePaste = useCallback(async () => {
    if (!canvasApi) return;
    const internal = canvasApi.pasteClipboard();
    if (internal.length > 0) {
      toastSuccess(`已粘贴 ${internal.length} 个节点`);
      return;
    }
    const imported = await canvasApi.pasteFromSystemClipboard();
    if (imported.length > 0) {
      toastSuccess(
        `已从系统剪贴板导入 ${imported.length} 个节点，请留意画布顶部兼容性提醒。`,
      );
    }
  }, [canvasApi, toastSuccess]);

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
            <DropdownMenuItem onClick={() => svgInputRef.current?.click()}>
              <ScanText className="size-4" />
              导入 SVG
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuItem onClick={handleCopy}>
              <Copy className="size-4" />
              复制
              <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleCut}>
              <Scissors className="size-4" />
              剪切
              <DropdownMenuShortcut>⌘X</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handlePaste()}>
              <ClipboardPaste className="size-4" />
              粘贴
              <DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
            </DropdownMenuItem>
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
        onChange={handleImageImport}
      />
      <input
        ref={svgInputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={handleSvgImport}
      />
    </>
  );
}
