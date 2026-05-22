"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import type {
  CanvasContent,
  ImageArtifact,
  VideoArtifact,
} from "@cucumber/shared";
import { BrandKitSelector } from "../../components/brand-kit-selector";
import { CanvasBottomBar } from "../../components/canvas-bottom-bar";
import type { CanvasSelectedElement } from "../../components/canvas-editor";
import { CanvasEditor } from "../../components/canvas-editor";
import { CanvasEmptyHint } from "../../components/canvas-empty-hint";
import { CanvasFilesPanel } from "../../components/canvas-files-panel";
import type { CanvasImageItem } from "../../components/canvas-image-picker";
import { CanvasLayersPanel } from "../../components/canvas-layers-panel";
import { CanvasLogoMenu } from "../../components/canvas-logo-menu";
import type {
  CanvasApi,
  CanvasFileRecord,
  CanvasSceneElement,
} from "../../components/canvas/canvas-surface";
import { ChatSidebar } from "../../components/chat-sidebar";
import { EditableProjectName } from "../../components/editable-project-name";
import { LoadingScreen } from "../../components/loading-screen";
import { useJobFallbackPolling } from "../../hooks/use-job-fallback-polling";
import { useWebSocket } from "../../hooks/use-websocket";
import { useAuth } from "../../lib/auth-context";
import { ApiAuthError, fetchCanvas, fetchProject } from "../../lib/server-api";

type CanvasImportSummary = {
  sourceLabel: string;
  importedCount: number;
  warningCount: number;
  degradationHints: string[];
};

function formatImportHint(hint: string): string {
  switch (hint) {
    case "unsupported_tag":
      return "部分 SVG 标签未支持";
    case "partial_fidelity":
      return "复杂结构按降级路径导入";
    case "layout_degraded":
      return "自动布局已按绝对定位近似";
    case "component_metadata_dropped":
      return "组件引用语义未保留";
    case "effects_dropped":
      return "高级效果未完整保留";
    default:
      return hint;
  }
}

function CanvasPageContent() {
  const searchParams = useSearchParams();
  const canvasId = searchParams.get("id");
  const initialSessionId = searchParams.get("session") ?? undefined;
  // Capture prompt once — router.replace will strip it from URL, but the
  // value must survive for the auto-send effect in ChatSidebar.
  const [initialPrompt] = useState(
    () => searchParams.get("prompt") ?? undefined,
  );
  const { user, session, loading: authLoading, signOut } = useAuth();
  const router = useRouter();

  const [canvasData, setCanvasData] = useState<{
    id: string;
    name: string;
    projectId: string;
    content: CanvasContent;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  // Default chat open on desktop, closed on mobile/tablet to avoid blocking canvas
  const [chatOpen, setChatOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 1024;
  });
  const [layersOpen, setLayersOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [brandKitId, setBrandKitId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Untitled");
  const [selectedCanvasElements, setSelectedCanvasElements] = useState<
    CanvasSelectedElement[]
  >([]);
  const [importSummary, setImportSummary] = useState<CanvasImportSummary | null>(
    null,
  );
  const [showImportWarnings, setShowImportWarnings] = useState(false);

  const canvasApiRef = useRef<CanvasApi | null>(null);
  const [canvasApi, setCanvasApi] = useState<CanvasApi | null>(null);

  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  const routerRef = useRef(router);
  routerRef.current = router;

  // Stable callbacks for panel toggles to prevent re-renders of child components
  const handleOpenChat = useCallback(() => setChatOpen(true), []);
  const handleToggleChat = useCallback(() => setChatOpen((v) => !v), []);
  const handleToggleLayers = useCallback(() => {
    setLayersOpen((v) => !v);
    setFilesOpen(false);
  }, []);
  const handleToggleFiles = useCallback(() => {
    setFilesOpen((v) => !v);
    setLayersOpen(false);
  }, []);
  const handleCloseLayers = useCallback(() => setLayersOpen(false), []);
  const handleCloseFiles = useCallback(() => setFilesOpen(false), []);

  const accessToken = session?.access_token;
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  const getToken = useCallback(() => accessTokenRef.current ?? null, []);
  const ws = useWebSocket(getToken);

  const handleApiReady = useCallback((api: CanvasApi) => {
    canvasApiRef.current = api;
    setCanvasApi(api);
  }, []);

  useEffect(() => {
    if (selectedCanvasElements.length === 0) return;
    const imported = selectedCanvasElements.filter((element) =>
      ["svg-import", "figma-paste"].includes(
        String((element as CanvasSelectedElement & { source?: string }).source ?? ""),
      ),
    );
    if (imported.length === 0) return;
    const warningCount = Math.max(
      ...imported.map((element) => element.importWarningCount ?? 0),
      0,
    );
    const degradationHints = Array.from(
      new Set(
        imported.flatMap((element) => element.degradationHints ?? []),
      ),
    );
    setImportSummary({
      sourceLabel: imported[0]?.importSourceLabel ?? "导入内容",
      importedCount: imported.length,
      warningCount,
      degradationHints,
    });
    setShowImportWarnings(false);
    const timer = window.setTimeout(() => {
      setImportSummary(null);
      setShowImportWarnings(false);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [selectedCanvasElements]);

  const handleImageGenerated = useCallback((artifact: ImageArtifact) => {
    const api = canvasApiRef.current;
    if (!api) return;
    if (typeof api.insertImageArtifact === "function") {
      api.insertImageArtifact(artifact);
      return;
    }
    console.warn("Canvas API cannot insert image artifacts.");
  }, []);

  const handleVideoGenerated = useCallback((artifact: VideoArtifact) => {
    const api = canvasApiRef.current;
    if (!api) return;
    if (typeof api.insertVideoArtifact === "function") {
      api.insertVideoArtifact(artifact);
      return;
    }
    console.warn("Canvas API cannot insert video artifacts.");
  }, []);

  // Must be defined BEFORE useJobFallbackPolling which references it
  const handleCanvasSync = useCallback(async () => {
    const api = canvasApiRef.current;
    const token = accessTokenRef.current;
    if (!api || !token || !canvasData) return;
    try {
      const { canvas } = await fetchCanvas(token, canvasData.id);
      if (typeof api.setDocument === "function") {
        api.setDocument(canvas.content);
        return;
      }
      console.warn("Canvas API cannot sync document content.");
    } catch (err) {
      console.warn("Failed to sync canvas:", err);
    }
  }, [canvasData]);

  // Fallback polling for timed-out generation jobs.
  // When the agent's tool times out but the worker eventually succeeds,
  // the backend will have already inserted the element into the canvas.
  // This hook detects completion and triggers a canvas re-fetch.
  const { checkForTimedOutJobs } = useJobFallbackPolling({
    accessTokenRef,
    onJobSucceeded: useCallback(
      (_jobId: string, _jobType: string) => {
        // Element was inserted by backend — just refresh the canvas
        handleCanvasSync();
      },
      [handleCanvasSync],
    ),
  });

  const handleSessionChange = useCallback(
    (sessionId: string) => {
      if (!canvasId) return;
      // Update URL: set session param, remove prompt param to prevent re-send on refresh
      routerRef.current.replace(`/canvas?id=${canvasId}&session=${sessionId}`);
    },
    [canvasId],
  );

  const handleRequestCanvasImages = useCallback((): CanvasImageItem[] => {
    const api = canvasApiRef.current;
    if (!api) return [];
    const elements = api.getSceneElements() ?? [];
    const files: Record<string, CanvasFileRecord> = api.getFiles() ?? {};
    let idx = 0;
    return elements
      .filter(
        (el): el is CanvasSceneElement & { fileId: string } =>
          el.type === "image" && !el.isDeleted && Boolean(el.fileId),
      )
      .map((el) => {
        idx++;
        const file = files[el.fileId];
        const dataURL = file?.dataURL ?? "";
        const titleCandidate = el.customData?.title ?? el.customData?.label;
        const title =
          typeof titleCandidate === "string" ? titleCandidate : `Image ${idx}`;
        return {
          kind: "canvas-image",
          id: el.id,
          name: title,
          thumbnailUrl: dataURL,
          assetId: el.id,
          url: dataURL,
          mimeType: file?.mimeType ?? "image/png",
        };
      });
  }, []);

  // Only re-fetch when canvasId changes or on initial auth resolution.
  // Token refreshes (e.g. tab switch back) should NOT trigger a reload —
  // we depend on user.id (stable string) instead of the user object ref.
  const userId = user?.id;

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      routerRef.current.replace("/login");
      return;
    }
    const token = accessTokenRef.current;
    if (!canvasId || !token) return;

    setPageLoading(true);
    fetchCanvas(token, canvasId)
      .then((data) => {
        const c = data.canvas;
        setCanvasData({
          id: c.id,
          name: c.name,
          projectId: c.projectId,
          content: c.content,
        });
        setPageLoading(false);
        // Fetch project to get brand_kit_id and name
        fetchProject(token, c.projectId)
          .then((projectData) => {
            setBrandKitId(projectData.project.brand_kit_id);
            setProjectName(projectData.project.name ?? "Untitled");
          })
          .catch((err) =>
            console.warn("Failed to fetch project for brand kit:", err),
          );
      })
      .catch((err) => {
        if (err instanceof ApiAuthError) {
          signOutRef.current().then(() => routerRef.current.replace("/login"));
          return;
        }
        setError("Failed to load canvas.");
        setPageLoading(false);
      });
    // Intentionally omitting accessTokenRef (stable ref) and signOutRef/routerRef
    // (ref wrappers) from deps — only re-run when auth resolves, user changes, or
    // canvasId changes. Token refresh (e.g. tab switch) must NOT trigger a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, userId, canvasId]);

  if (!canvasId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">No canvas ID specified.</p>
      </div>
    );
  }

  if (authLoading || pageLoading) {
    return <LoadingScreen />;
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!canvasData || !accessToken) return null;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Top-left navigation bar */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5">
        <CanvasLogoMenu
          accessToken={accessToken}
          projectId={canvasData.projectId}
          canvasId={canvasData.id}
          canvasApi={canvasApi}
        />
        <EditableProjectName
          accessToken={accessToken}
          projectId={canvasData.projectId}
          initialName={projectName}
        />
        <BrandKitSelector
          accessToken={accessToken}
          projectId={canvasData.projectId}
          currentBrandKitId={brandKitId}
          onBrandKitChange={(kitId) => setBrandKitId(kitId)}
        />
      </div>
      {/* Canvas always takes full width; on mobile/tablet, ChatSidebar overlays instead of side-by-side */}
      <div className="flex-1 relative min-w-0 overflow-hidden">
        {importSummary ? (
          <div className="absolute left-1/2 top-16 z-20 w-95 max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-2xl border border-border bg-card/95 px-4 py-3 text-xs text-foreground shadow-card backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="font-medium">
                  {importSummary.sourceLabel} 已导入并选中{" "}
                  {importSummary.importedCount} 个可编辑节点
                </p>
                <p className="text-muted-foreground">
                  {importSummary.warningCount > 0
                    ? `包含 ${importSummary.warningCount} 条兼容性提醒`
                    : "未检测到兼容性提醒"}
                </p>
              </div>
              {importSummary.warningCount > 0 ? (
                <button
                  type="button"
                  className="shrink-0 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => setShowImportWarnings((value) => !value)}
                >
                  {showImportWarnings ? "收起提醒" : "查看兼容性提醒"}
                </button>
              ) : null}
            </div>
            {showImportWarnings && importSummary.degradationHints.length > 0 ? (
              <div className="mt-2 rounded-xl bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
                {importSummary.degradationHints.map(formatImportHint).join(" · ")}
              </div>
            ) : null}
          </div>
        ) : null}
        <CanvasEditor
          canvasId={canvasData.id}
          projectId={canvasData.projectId}
          accessToken={accessToken}
          initialContent={canvasData.content}
          onApiReady={handleApiReady}
          ws={ws}
          leftPanelOpen={layersOpen || filesOpen}
          onSelectionChange={setSelectedCanvasElements}
        />
        <CanvasEmptyHint canvasApi={canvasApi} onOpenChat={handleOpenChat} />
        <CanvasBottomBar
          canvasApi={canvasApi}
          layersOpen={layersOpen}
          onToggleLayers={handleToggleLayers}
          filesOpen={filesOpen}
          onToggleFiles={handleToggleFiles}
          leftPanelOpen={layersOpen || filesOpen}
        />
        <CanvasLayersPanel
          canvasApi={canvasApi}
          open={layersOpen}
          onClose={handleCloseLayers}
        />
        <CanvasFilesPanel
          canvasApi={canvasApi}
          open={filesOpen}
          onClose={handleCloseFiles}
        />
      </div>
      <ChatSidebar
        accessToken={accessToken}
        canvasId={canvasData.id}
        open={chatOpen}
        onToggle={handleToggleChat}
        onImageGenerated={handleImageGenerated}
        onVideoGenerated={handleVideoGenerated}
        onCanvasSync={handleCanvasSync}
        onStreamEvent={checkForTimedOutJobs}
        initialPrompt={initialPrompt}
        initialSessionId={initialSessionId}
        onSessionChange={handleSessionChange}
        onRequestCanvasImages={handleRequestCanvasImages}
        currentBrandKitId={brandKitId}
        ws={ws}
        selectedCanvasElements={selectedCanvasElements}
      />
    </div>
  );
}

export default function CanvasPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <CanvasPageContent />
    </Suspense>
  );
}
