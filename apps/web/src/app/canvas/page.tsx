"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { findNode, getAgentExecutionMeta } from "@cucumber/canvas-core";
import type {
  CanvasContent,
  ImageArtifact,
  StreamEvent,
  VideoArtifact,
} from "@cucumber/shared";
import {
  AgentRunControlBar,
  type AgentRunControlState,
} from "../../components/agent-run-control-bar";
import { BrandKitSelector } from "../../components/brand-kit-selector";
import { CanvasBottomBar } from "../../components/canvas-bottom-bar";
import {
  CanvasDesignSystemPanel,
  type CanvasDesignSystemPanelProps,
} from "../../components/canvas-design-system-panel";
import type { CanvasSelectedElement } from "../../components/canvas-editor";
import { CanvasEditor } from "../../components/canvas-editor";
import { CanvasEmptyHint } from "../../components/canvas-empty-hint";
import { CanvasFilesPanel } from "../../components/canvas-files-panel";
import type { CanvasImageItem } from "../../components/canvas-image-picker";
import { CanvasLayersPanel } from "../../components/canvas-layers-panel";
import { CanvasLogoMenu } from "../../components/canvas-logo-menu";
import {
  getAgentRunPausedNodeUpdates,
  getAgentRunStoppedNodeUpdates,
} from "../../components/canvas/agent-run-pause-writeback";
import { getAgentWaitingResponseSubmittedUpdates } from "../../components/canvas/agent-waiting-response-writeback";
import type {
  CanvasApi,
  CanvasFileRecord,
  CanvasSceneElement,
} from "../../components/canvas/canvas-api";
import type {
  AgentExecutionContinueIntent,
  AgentExecutionContinueOptions,
} from "../../components/canvas/property-panel/agent-execution-section";
import type { AgentContinuationMode } from "../../components/chat-input";
import {
  type AgentContinuationSubmitSummary,
  ChatSidebar,
} from "../../components/chat-sidebar";
import { EditableProjectName } from "../../components/editable-project-name";
import { LoadingScreen } from "../../components/loading-screen";
import { useJobFallbackPolling } from "../../hooks/use-job-fallback-polling";
import { useWebSocket } from "../../hooks/use-websocket";
import { useAuth } from "../../lib/auth-context";
import {
  ApiApplicationError,
  ApiAuthError,
  fetchCanvas,
  fetchProject,
} from "../../lib/server-api";

type CanvasImportSummary = {
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
    case "component_editability_limited":
      return "组件引用已保留，编辑能力有限";
    case "component_metadata_dropped":
      return "组件引用语义未保留";
    case "effects_dropped":
      return "高级效果未完整保留";
    default:
      return hint;
  }
}

function modeForAgentContinueIntent(
  intent: AgentExecutionContinueIntent,
): AgentContinuationMode {
  return intent === "new_branch" ? "new_branch" : "overwrite_current";
}

function buildAgentContinueDraft(
  element: CanvasSelectedElement,
  intent: AgentExecutionContinueIntent,
  options: AgentExecutionContinueOptions = {},
): string {
  const execution = element.agentExecution;
  const title = execution?.title?.trim() || "当前 Agent 节点";
  const waitingResponseText =
    options.waitingResponseText?.trim() ||
    execution?.waitingForUser?.response?.text?.trim();
  if (intent === "attach_files") {
    return `为「${title}」补充文件或图片，并基于这些新材料从当前等待节点继续执行。`;
  }
  if (execution?.kind === "ask_user_more" && waitingResponseText) {
    return `已为「${title}」提交补充：${formatAgentContinueContextText(waitingResponseText)}\n\n请基于这条补充从当前等待节点继续执行，并把后续过程和结果写回画布执行链。`;
  }
  if (intent === "retry") {
    return `重试「${title}」这一步，优先沿用原有输入和上下文；如果仍失败，请在画布执行链中记录新的失败原因和下一步建议。`;
  }
  if (intent === "rerun_checkpoint") {
    const downstreamNodeIds = execution?.downstreamNodeIds ?? [];
    const downstreamCopy = downstreamNodeIds.length
      ? `本次预计重建 ${downstreamNodeIds.length} 个后续结果。`
      : "当前保存点没有记录后续结果；请先检查画布内容，再决定需要重建的后续部分。";
    return `从保存点「${title}」重跑后续执行链：保留这个保存点，重新读取当前画布上下文，重建后续步骤、产物和验证结果。${downstreamCopy}`;
  }
  if (intent === "rewrite") {
    return `改写「${title}」的输入或约束后继续执行，并把新的过程和结果写回当前主线。`;
  }
  if (intent === "skip") {
    return `跳过「${title}」这一步，继续执行后续可完成的任务，并在画布上记录跳过原因。`;
  }
  if (execution?.kind === "variant_branch") {
    return `继续深化「${title}」，沿这个方案分支扩展下一步产物，并保留其他方案作为分支。`;
  }
  if (intent === "new_branch") {
    return `基于「${title}」复制为新分支继续尝试，保留当前节点和原有主线不变。`;
  }
  if (execution?.kind === "critique") {
    return `基于「${title}」继续修复问题，并把修改结果写回画布执行链。`;
  }
  if (execution?.kind === "checkpoint") {
    return `从「${title}」继续执行，保留已有上下文并生成下一步结果。`;
  }
  return `基于「${title}」继续执行下一步，并把过程和结果写到画布执行链。`;
}

function formatAgentContinueContextText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 240) return normalized;
  return `${normalized.slice(0, 240)}...`;
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
  const [designOpen, setDesignOpen] = useState(false);
  const [designInitialTab, setDesignInitialTab] =
    useState<CanvasDesignSystemPanelProps["initialTab"]>("components");
  const [designInitialTabRequestKey, setDesignInitialTabRequestKey] =
    useState(0);
  const [brandKitId, setBrandKitId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Untitled");
  const [selectedCanvasElements, setSelectedCanvasElements] = useState<
    CanvasSelectedElement[]
  >([]);
  const selectedCanvasElementsKeyRef = useRef("");
  const [importSummary, setImportSummary] =
    useState<CanvasImportSummary | null>(null);
  const [showImportWarnings, setShowImportWarnings] = useState(false);
  const [agentRunControlState, setAgentRunControlState] =
    useState<AgentRunControlState>({ streaming: false });
  const pauseAgentRunRef = useRef<(() => void) | null>(null);
  const stopAgentRunRef = useRef<(() => void) | null>(null);
  const [agentTraceEvents, setAgentTraceEvents] = useState<StreamEvent[]>([]);
  const agentContinueDraftRequestIdRef = useRef(0);
  const [agentContinueDraftRequest, setAgentContinueDraftRequest] = useState<{
    continuationTargetElement?: CanvasSelectedElement;
    intent: AgentExecutionContinueIntent;
    requestId: number;
    message: string;
    mode: AgentContinuationMode;
    openFilePicker?: boolean;
    waitingResponseText?: string;
  } | null>(null);

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
    setDesignOpen(false);
  }, []);
  const handleToggleFiles = useCallback(() => {
    setFilesOpen((v) => !v);
    setLayersOpen(false);
    setDesignOpen(false);
  }, []);
  const handleToggleDesign = useCallback(() => {
    setDesignInitialTab("components");
    setDesignOpen((v) => !v);
    setLayersOpen(false);
    setFilesOpen(false);
  }, []);
  const handleInsertIconFromToolbar = useCallback(() => {
    setDesignInitialTab("icons");
    setDesignInitialTabRequestKey((key) => key + 1);
    setDesignOpen(true);
    setLayersOpen(false);
    setFilesOpen(false);
    console.info("[canvas-page] toolbar.insert-icon.design-system.opened", {
      canvasId,
      targetTab: "icons",
    });
  }, [canvasId]);
  const handleCloseLayers = useCallback(() => setLayersOpen(false), []);
  const handleCloseFiles = useCallback(() => setFilesOpen(false), []);
  const handleCloseDesign = useCallback(() => setDesignOpen(false), []);

  const accessToken = session?.access_token;
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  const getToken = useCallback(() => accessTokenRef.current ?? null, []);
  const ws = useWebSocket(getToken);

  const handleApiReady = useCallback((api: CanvasApi) => {
    canvasApiRef.current = api;
    setCanvasApi(api);
  }, []);

  const handleSelectionChange = useCallback(
    (elements: CanvasSelectedElement[]) => {
      const summaryKey = elements
        .map((element) =>
          [
            element.id,
            element.type,
            element.fileId ?? "",
            element.importWarningCount ?? 0,
            (element.degradationHints ?? []).join(","),
            element.agentExecution?.kind ?? "",
            element.agentExecution?.status ?? "",
            element.agentExecution?.runId ?? "",
            element.agentExecution?.title ?? "",
            element.agentExecution?.branchId ?? "",
            element.agentExecution?.waitingForUser?.response?.text ?? "",
            element.agentExecution?.waitingForUser?.response?.attachmentCount ??
              0,
            element.agentExecution?.branch?.isMainline ? "mainline" : "",
          ].join(":"),
        )
        .join("|");
      if (summaryKey === selectedCanvasElementsKeyRef.current) return;
      selectedCanvasElementsKeyRef.current = summaryKey;
      setSelectedCanvasElements(elements);
    },
    [],
  );

  const handleContinueAgentExecution = useCallback(
    (
      nodeId: string,
      intent: AgentExecutionContinueIntent = "continue",
      options?: AgentExecutionContinueOptions,
    ) => {
      const selectedElement =
        selectedCanvasElements.find(
          (element) => element.id === nodeId && element.agentExecution,
        ) ?? options?.continuationTargetElement;
      if (!selectedElement?.agentExecution) {
        console.warn("[canvas-page] agent_continue.request.missing_context", {
          nodeId,
        });
        return;
      }
      const request = {
        continuationTargetElement: selectedElement,
        intent,
        message: buildAgentContinueDraft(selectedElement, intent, options),
        mode: modeForAgentContinueIntent(intent),
        ...(intent === "attach_files" ? { openFilePicker: true } : {}),
        ...(options?.waitingResponseText?.trim()
          ? { waitingResponseText: options.waitingResponseText.trim() }
          : {}),
        requestId: ++agentContinueDraftRequestIdRef.current,
      };
      setChatOpen(true);
      setAgentContinueDraftRequest(request);
      console.info("[canvas-page] agent_continue.request", {
        hasWaitingResponseText: Boolean(options?.waitingResponseText?.trim()),
        intent,
        kind: selectedElement.agentExecution.kind,
        mode: request.mode,
        nodeId,
        openFilePicker: request.openFilePicker === true,
        requestId: request.requestId,
        targetNodeId: request.continuationTargetElement.id,
        title: selectedElement.agentExecution.title,
      });
    },
    [selectedCanvasElements],
  );

  const handleAgentContinuationSubmit = useCallback(
    (summary: AgentContinuationSubmitSummary) => {
      if (summary.attachmentCount <= 0) return;
      const api = canvasApiRef.current;
      if (!api) {
        console.warn(
          "[canvas-page] agent_continue.attachments.writeback.skipped",
          {
            nodeId: summary.nodeId,
            reason: "canvas_api_unavailable",
          },
        );
        return;
      }

      const activePageId = api.getActivePageId();
      const node = findNode(api.getDocument(), summary.nodeId, activePageId);
      const execution = getAgentExecutionMeta(node);
      if (!node || !execution?.waitingForUser) {
        console.warn(
          "[canvas-page] agent_continue.attachments.writeback.skipped",
          {
            nodeId: summary.nodeId,
            reason: "waiting_node_not_found",
          },
        );
        return;
      }

      const existingResponse = execution.waitingForUser.response;
      const responseText =
        existingResponse?.text?.trim() ||
        summary.text.trim() ||
        `已补充 ${summary.attachmentCount} 个文件/图片，材料随本次 Agent 消息发送。`;
      const nextAttachmentCount =
        (existingResponse?.attachmentCount ?? 0) + summary.attachmentCount;

      const updates = getAgentWaitingResponseSubmittedUpdates(node, {
        text: responseText,
        submittedAt: new Date().toISOString(),
        attachmentCount: nextAttachmentCount,
      });
      if (!updates) {
        console.warn(
          "[canvas-page] agent_continue.attachments.writeback.skipped",
          {
            nodeId: summary.nodeId,
            reason: "waiting_response_update_unavailable",
          },
        );
        return;
      }
      api.updateNode(summary.nodeId, updates);
      console.info("[canvas-page] agent_continue.attachments.writeback", {
        attachmentCount: summary.attachmentCount,
        nextAttachmentCount,
        nodeId: summary.nodeId,
      });
    },
    [],
  );

  const handleAgentRunPaused = useCallback((summary: { runId: string }) => {
    const api = canvasApiRef.current;
    if (!api) {
      console.warn("[canvas-page] agent_run.pause.writeback.skipped", {
        reason: "canvas_api_unavailable",
        runId: summary.runId,
      });
      return;
    }
    const updates = getAgentRunPausedNodeUpdates(
      api.getDocument(),
      api.getActivePageId(),
      summary.runId,
    );
    for (const update of updates) {
      api.updateNode(update.nodeId, update.updates);
    }
    console.info("[canvas-page] agent_run.pause.writeback", {
      nodeCount: updates.length,
      runId: summary.runId,
    });
  }, []);

  const handleAgentRunStopped = useCallback((summary: { runId: string }) => {
    const api = canvasApiRef.current;
    if (!api) {
      console.warn("[canvas-page] agent_run.stop.writeback.skipped", {
        reason: "canvas_api_unavailable",
        runId: summary.runId,
      });
      return;
    }
    const updates = getAgentRunStoppedNodeUpdates(
      api.getDocument(),
      api.getActivePageId(),
      summary.runId,
    );
    for (const update of updates) {
      api.updateNode(update.nodeId, update.updates);
    }
    console.info("[canvas-page] agent_run.stop.writeback", {
      nodeCount: updates.length,
      runId: summary.runId,
    });
  }, []);

  useEffect(() => {
    if (selectedCanvasElements.length === 0) return;
    const imported = selectedCanvasElements.filter((element) =>
      ["svg-import", "figma-paste", "image-paste"].includes(
        String(
          (element as CanvasSelectedElement & { source?: string }).source ?? "",
        ),
      ),
    );
    if (imported.length === 0) return;
    const warningCount = Math.max(
      ...imported.map((element) => element.importWarningCount ?? 0),
      0,
    );
    const degradationHints = Array.from(
      new Set(imported.flatMap((element) => element.degradationHints ?? [])),
    );
    if (warningCount === 0 && degradationHints.length === 0) {
      setImportSummary(null);
      setShowImportWarnings(false);
      return;
    }
    setImportSummary({
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

  const handleAgentStreamEvent = useCallback(
    (event: StreamEvent) => {
      setAgentTraceEvents((events) => [...events, event].slice(-120));
      checkForTimedOutJobs(event);
    },
    [checkForTimedOutJobs],
  );

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
        console.error("[canvas-page] failed to load canvas", {
          canvasId,
          reason: err instanceof Error ? err.message : String(err),
        });
        setError(
          err instanceof ApiApplicationError
            ? err.message
            : "暂时无法打开这个画布，请稍后重试；如果仍然失败，请联系团队排查项目访问或画布数据状态。",
        );
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
        <p className="text-sm text-muted-foreground">
          缺少画布信息，请从项目列表重新打开画布。
        </p>
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
                  导入存在{" "}
                  {Math.max(
                    importSummary.warningCount,
                    importSummary.degradationHints.length,
                  )}{" "}
                  条兼容性提醒
                </p>
                <p className="text-muted-foreground">
                  部分内容可能无法完全保留原始设计语义
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => setShowImportWarnings((value) => !value)}
              >
                {showImportWarnings ? "收起提醒" : "查看详情"}
              </button>
            </div>
            {showImportWarnings && importSummary.degradationHints.length > 0 ? (
              <div className="mt-2 rounded-xl bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
                {importSummary.degradationHints
                  .map(formatImportHint)
                  .join(" · ")}
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
          onContinueAgentExecution={handleContinueAgentExecution}
          onInsertIcon={handleInsertIconFromToolbar}
          ws={ws}
          leftPanelOpen={layersOpen || filesOpen || designOpen}
          onSelectionChange={handleSelectionChange}
        />
        <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2">
          <AgentRunControlBar
            runState={agentRunControlState}
            selectedCanvasElements={selectedCanvasElements}
            onContinueFromSelection={(nodeId, intent = "continue") =>
              handleContinueAgentExecution(nodeId, intent)
            }
            onPauseRun={() => pauseAgentRunRef.current?.()}
            onStopRun={() => stopAgentRunRef.current?.()}
            traceEvents={agentTraceEvents}
          />
        </div>
        <CanvasEmptyHint canvasApi={canvasApi} onOpenChat={handleOpenChat} />
        <CanvasBottomBar
          canvasApi={canvasApi}
          layersOpen={layersOpen}
          onToggleLayers={handleToggleLayers}
          filesOpen={filesOpen}
          onToggleFiles={handleToggleFiles}
          designOpen={designOpen}
          onToggleDesign={handleToggleDesign}
          leftPanelOpen={layersOpen || filesOpen || designOpen}
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
        <CanvasDesignSystemPanel
          key={`design-system-${designInitialTabRequestKey}`}
          canvasApi={canvasApi}
          initialTab={designInitialTab}
          open={designOpen}
          onClose={handleCloseDesign}
        />
      </div>
      <ChatSidebar
        accessToken={accessToken}
        canvasId={canvasData.id}
        open={chatOpen}
        onToggle={handleToggleChat}
        onImageGenerated={handleImageGenerated}
        onVideoGenerated={handleVideoGenerated}
        onBeforeRun={async () => {
          await canvasApiRef.current?.flushPendingSave();
        }}
        onCanvasSync={handleCanvasSync}
        onStreamEvent={handleAgentStreamEvent}
        initialPrompt={initialPrompt}
        initialSessionId={initialSessionId}
        onSessionChange={handleSessionChange}
        onRequestCanvasImages={handleRequestCanvasImages}
        currentBrandKitId={brandKitId}
        ws={ws}
        selectedCanvasElements={selectedCanvasElements}
        agentContinueDraftRequest={agentContinueDraftRequest}
        onAgentContinuationSubmit={handleAgentContinuationSubmit}
        onRunControlStateChange={setAgentRunControlState}
        onRunPauseChange={(handler) => {
          pauseAgentRunRef.current = handler;
        }}
        onRunPaused={handleAgentRunPaused}
        onRunStopChange={(handler) => {
          stopAgentRunRef.current = handler;
        }}
        onRunStopped={handleAgentRunStopped}
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
