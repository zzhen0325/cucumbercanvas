"use client";

import type { CanvasSelectedElement } from "../canvas-editor";

type TraceDetailPanelProps = {
  selectedElement: CanvasSelectedElement | null;
  onJumpToChat?: (toolCallId: string) => void;
};

type TraceDetail = {
  kind?: "tool" | "artifact";
  runId?: string;
  toolCallId?: string;
  toolName?: string;
  status?: string;
  input?: Record<string, unknown>;
  outputSummary?: string;
  artifacts?: Array<Record<string, unknown>>;
  artifact?: Record<string, unknown>;
};

function isTraceElement(element: CanvasSelectedElement | null): boolean {
  return Boolean(
    element &&
      element.customData &&
      typeof element.customData.traceType === "string",
  );
}

function getTraceDetail(element: CanvasSelectedElement): TraceDetail | null {
  const detail = element.customData?.traceDetail;
  if (!detail || typeof detail !== "object") return null;
  return detail as TraceDetail;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getPreviewUrl(element: CanvasSelectedElement, detail: TraceDetail | null) {
  if (element.dataUrl || element.storageUrl || element.link) {
    return {
      kind:
        element.type === "embeddable" || element.mimeType?.startsWith("video/")
          ? "video"
          : "image",
      url: element.dataUrl ?? element.storageUrl ?? element.link ?? "",
    } as const;
  }
  const artifact = detail?.artifact;
  if (artifact && typeof artifact.url === "string") {
    return {
      kind:
        artifact.type === "video" || String(artifact.mimeType ?? "").startsWith("video/")
          ? "video"
          : "image",
      url: artifact.url,
    } as const;
  }
  return null;
}

export function TraceDetailPanel({
  selectedElement,
  onJumpToChat,
}: TraceDetailPanelProps) {
  if (!selectedElement || !isTraceElement(selectedElement)) return null;

  const detail = getTraceDetail(selectedElement);
  if (!detail) return null;

  const preview = getPreviewUrl(selectedElement, detail);
  const linkedToolCallId =
    detail.toolCallId ??
    (selectedElement.customData?.toolCallId as string | undefined) ??
    null;
  const title =
    detail.kind === "artifact"
      ? detail.toolName
        ? `${detail.toolName} artifact`
        : "Trace artifact"
      : detail.toolName ?? selectedElement.title ?? "Trace detail";

  return (
    <div
      data-testid="trace-detail-panel"
      className="absolute right-4 bottom-4 z-20 w-90 rounded-2xl border border-border bg-card/95 p-4 shadow-card backdrop-blur-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Run {detail.runId?.slice(0, 8) ?? "unknown"}
            {detail.status ? ` · ${detail.status}` : ""}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          {detail.kind ?? "trace"}
        </span>
      </div>

      {linkedToolCallId ? (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-border bg-muted/40 px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">
              对应 Tool Block
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {linkedToolCallId}
            </p>
          </div>
          <button
            data-testid="trace-detail-jump-chat"
            type="button"
            onClick={() => onJumpToChat?.(linkedToolCallId)}
            className="shrink-0 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            跳转到 Chat
          </button>
        </div>
      ) : null}

      {preview ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-muted/40">
          {preview.kind === "video" ? (
            <video
              src={preview.url}
              controls
              muted
              playsInline
              className="h-44 w-full object-contain bg-black"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.url}
              alt={selectedElement.title ?? title}
              className="h-44 w-full object-contain bg-muted/40"
            />
          )}
        </div>
      ) : null}

      {detail.outputSummary ? (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Output
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
            {detail.outputSummary}
          </p>
        </div>
      ) : null}

      {detail.input ? (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Input
          </p>
          <pre className="mt-1 max-h-40 overflow-auto rounded-xl bg-muted/60 p-3 text-xs text-foreground">
            {formatJson(detail.input)}
          </pre>
        </div>
      ) : null}

      {detail.artifacts?.length ? (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Artifacts
          </p>
          <div className="mt-2 space-y-2">
            {detail.artifacts.map((artifact, index) => (
              <div
                key={`${artifact.type ?? "artifact"}-${index}`}
                className="rounded-xl border border-border bg-muted/40 p-2 text-xs text-foreground"
              >
                <p className="font-medium">{String(artifact.type ?? "artifact")}</p>
                {artifact.title ? (
                  <p className="mt-1 text-muted-foreground">
                    {String(artifact.title)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
