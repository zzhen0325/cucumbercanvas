"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import type { ImageArtifact, StreamEvent, VideoArtifact } from "@cucumber/shared";
import { BrandKitSelector } from "../../components/brand-kit-selector";
import { CanvasBottomBar } from "../../components/canvas-bottom-bar";
import type { CanvasSelectedElement } from "../../components/canvas-editor";
import { CanvasEditor } from "../../components/canvas-editor";
import { CanvasEmptyHint } from "../../components/canvas-empty-hint";
import { CanvasFilesPanel } from "../../components/canvas-files-panel";
import { TraceDetailPanel } from "../../components/canvas/trace-detail-panel";
import type { CanvasImageItem } from "../../components/canvas-image-picker";
import { CanvasLayersPanel } from "../../components/canvas-layers-panel";
import { CanvasLogoMenu } from "../../components/canvas-logo-menu";
import { ChatSidebar } from "../../components/chat-sidebar";
import { EditableProjectName } from "../../components/editable-project-name";
import { LoadingScreen } from "../../components/loading-screen";
import { useJobFallbackPolling } from "../../hooks/use-job-fallback-polling";
import { useWebSocket } from "../../hooks/use-websocket";
import { createAgentTraceProjector } from "../../lib/agent-trace-projector";
import { useAuth } from "../../lib/auth-context";
import {
  insertImageOnCanvas,
  insertVideoOnCanvas,
} from "../../lib/canvas-elements";
import { normalizeCanvasElements } from "../../lib/canvas-normalize";
import { ApiAuthError, fetchCanvas, fetchProject } from "../../lib/server-api";

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
    content: {
      elements: Record<string, unknown>[];
      appState: Record<string, unknown>;
      files: Record<string, Record<string, unknown>>;
    };
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
  const [traceRecordingEnabled, setTraceRecordingEnabled] = useState(true);
  const [brandKitId, setBrandKitId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Untitled");
  const [selectedCanvasElements, setSelectedCanvasElements] = useState<
    CanvasSelectedElement[]
  >([]);
  const [linkedToolCallId, setLinkedToolCallId] = useState<string | null>(null);
  const selectedTraceElement =
    selectedCanvasElements.find(
      (element) =>
        element.customData &&
        typeof element.customData.traceType === "string",
    ) ?? null;
  const selectedTraceToolCallId =
    (selectedTraceElement?.customData?.toolCallId as string | undefined) ??
    (selectedTraceElement?.customData?.traceDetail as
      | { toolCallId?: string }
      | undefined)?.toolCallId ??
    null;
  const activeTraceToolCallId = selectedTraceToolCallId ?? linkedToolCallId;

  const excalidrawApiRef = useRef<any>(null);
  const [excalidrawApi, setExcalidrawApi] = useState<any>(null);
  const traceProjectorRef = useRef(createAgentTraceProjector());

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
  const handleToggleTraceRecording = useCallback(() => {
    setTraceRecordingEnabled((value) => !value);
  }, []);

  const accessToken = session?.access_token;
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  const getToken = useCallback(() => accessTokenRef.current ?? null, []);
  const ws = useWebSocket(getToken);

  const handleApiReady = useCallback((api: any) => {
    excalidrawApiRef.current = api;
    setExcalidrawApi(api);
  }, []);

  const handleImageGenerated = useCallback((artifact: ImageArtifact) => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    insertImageOnCanvas(api, artifact).catch((err) => {
      console.warn("Failed to insert image on canvas:", err);
    });
  }, []);

  const handleVideoGenerated = useCallback((artifact: VideoArtifact) => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    insertVideoOnCanvas(api, artifact).catch((err) => {
      console.warn("Failed to insert video on canvas:", err);
    });
  }, []);

  const handleProjectTraceEvent = useCallback((event: StreamEvent) => {
    if (!traceRecordingEnabled) return;
    const api = excalidrawApiRef.current;
    if (!api) return;
    void traceProjectorRef.current.projectEvent(api, event);
  }, [traceRecordingEnabled]);

  const handleLinkToTrace = useCallback((toolCallId: string) => {
    setLinkedToolCallId(toolCallId);
    const api = excalidrawApiRef.current;
    if (!api) return;

    const sceneElements = api
      .getSceneElements()
      .filter((element: any) => !element.isDeleted);
    const targetElement =
      sceneElements.find(
        (element: any) =>
          element.customData?.traceType === "tool-node" &&
          element.customData?.toolCallId === toolCallId,
      ) ??
      sceneElements.find(
        (element: any) => element.customData?.toolCallId === toolCallId,
      );

    if (!targetElement) return;

    api.updateScene({
      appState: { selectedElementIds: { [targetElement.id]: true } },
    });

    if (typeof api.scrollToContent === "function") {
      try {
        api.scrollToContent([targetElement]);
      } catch {
        api.scrollToContent();
      }
    }
  }, []);

  const handleJumpToChatTool = useCallback((toolCallId: string) => {
    setLinkedToolCallId(toolCallId);
    if (!chatOpen) setChatOpen(true);
  }, [chatOpen]);

  const handleClearTrace = useCallback(() => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    setLinkedToolCallId(null);
    void traceProjectorRef.current.clearProjectedTraces(api);
  }, []);

  useEffect(() => {
    if (!selectedTraceToolCallId) return;
    setLinkedToolCallId(selectedTraceToolCallId);
    if (!chatOpen) setChatOpen(true);
  }, [selectedTraceToolCallId, chatOpen]);

  useEffect(() => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    void traceProjectorRef.current.highlightRunForTool(
      api,
      activeTraceToolCallId,
    );
  }, [activeTraceToolCallId]);

  // Must be defined BEFORE useJobFallbackPolling which references it
  const handleCanvasSync = useCallback(async () => {
    const api = excalidrawApiRef.current;
    const token = accessTokenRef.current;
    if (!api || !token || !canvasData) return;
    try {
      const { canvas } = await fetchCanvas(token, canvasData.id);
      const elements = [...(canvas.content.elements ?? [])];
      const normalized = normalizeCanvasElements(elements);
      if (normalized.changed) {
        console.log("[canvas-page] normalized synced canvas elements", {
          canvasId: canvasData.id,
        });
      }
      const files = (canvas.content as Record<string, unknown>).files as
        | Record<
            string,
            { id: string; dataURL: string; mimeType: string; created: number }
          >
        | undefined;

      // Sync files (base64 dataURLs from backend-inserted images) into Excalidraw
      if (files && Object.keys(files).length > 0) {
        api.addFiles(Object.values(files));
      }

      api.updateScene({
        elements: normalized.elements,
        captureUpdate: "IMMEDIATELY",
      });
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
    const api = excalidrawApiRef.current;
    if (!api) return [];
    const elements: any[] = api.getSceneElements() ?? [];
    const files: Record<string, any> = api.getFiles() ?? {};
    let idx = 0;
    return elements
      .filter((el: any) => el.type === "image" && !el.isDeleted && el.fileId)
      .map((el: any) => {
        idx++;
        const file = files[el.fileId];
        const dataURL = file?.dataURL ?? "";
        const title =
          el.customData?.title || el.customData?.label || `Image ${idx}`;
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
          content: {
            elements: c.content.elements ?? [],
            appState: c.content.appState ?? {},
            files: (c.content as any).files ?? {},
          },
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
          excalidrawApi={excalidrawApi}
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
        <CanvasEmptyHint
          excalidrawApi={excalidrawApi}
          onOpenChat={handleOpenChat}
        />
        <CanvasBottomBar
          excalidrawApi={excalidrawApi}
          layersOpen={layersOpen}
          onToggleLayers={handleToggleLayers}
          filesOpen={filesOpen}
          onToggleFiles={handleToggleFiles}
          leftPanelOpen={layersOpen || filesOpen}
          traceRecordingEnabled={traceRecordingEnabled}
          onToggleTraceRecording={handleToggleTraceRecording}
          onClearTrace={handleClearTrace}
        />
        <CanvasLayersPanel
          excalidrawApi={excalidrawApi}
          open={layersOpen}
          onClose={handleCloseLayers}
        />
        <CanvasFilesPanel
          excalidrawApi={excalidrawApi}
          open={filesOpen}
          onClose={handleCloseFiles}
        />
        <TraceDetailPanel
          selectedElement={selectedTraceElement}
          onJumpToChat={handleJumpToChatTool}
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
        onProjectTraceEvent={handleProjectTraceEvent}
        initialPrompt={initialPrompt}
        initialSessionId={initialSessionId}
        onSessionChange={handleSessionChange}
        onRequestCanvasImages={handleRequestCanvasImages}
        currentBrandKitId={brandKitId}
        ws={ws}
        selectedCanvasElements={selectedCanvasElements}
        linkedToolCallId={linkedToolCallId}
        onLinkToTrace={handleLinkToTrace}
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
