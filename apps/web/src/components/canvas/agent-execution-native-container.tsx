"use client";

import type {
  AgentExecutionContainer,
  AgentExecutionContainerPartStatus,
  AgentExecutionContainerTodo,
  AgentExecutionContainerToolPart,
} from "@cucumber/canvas-core";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Circle,
  LoaderCircle,
  PauseCircle,
  Wrench,
} from "lucide-react";

import { cn } from "@/lib/utils";

export function AgentExecutionNativeContainer({
  className,
  container,
}: {
  className?: string;
  container: AgentExecutionContainer;
}) {
  const statusLabel = getContainerStatusLabel(container.status);
  const latestStreamParts = container.streamParts.slice(-4);
  const visibleSummary = latestStreamParts.some(
    (part) => part.content?.trim() === container.summary?.trim(),
  )
    ? undefined
    : container.summary;
  return (
    <section
      aria-label={`Agent 执行容器：${container.title}`}
      className={cn(
        "min-w-0 rounded-xl border border-border bg-card/95 text-xs text-foreground shadow-card backdrop-blur-md",
        className,
      )}
      data-canvas-overlay="agent-execution-native-container"
    >
      <header className="flex min-w-0 items-start justify-between gap-3 border-b border-border/70 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {container.title}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{formatKindLabel(container.kind)}</span>
            {container.runId ? (
              <span className="truncate font-mono">{container.runId}</span>
            ) : null}
          </div>
        </div>
        <span
          className={cn(
            "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium",
            statusClassName(container.status),
          )}
        >
          <StatusIcon status={container.status} />
          {statusLabel}
        </span>
      </header>

      <div className="space-y-3 px-3 py-3">
        {container.failure ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-2.5 py-2 text-destructive">
            <div className="font-medium">{container.failure.step}</div>
            <div className="mt-1 leading-relaxed">
              {container.failure.reason}
            </div>
          </div>
        ) : null}

        {container.waitingForUser ? (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-amber-800">
            <div className="font-medium">等待用户补充</div>
            <div className="mt-1 leading-relaxed">
              {container.waitingForUser.prompt}
            </div>
          </div>
        ) : null}

        {visibleSummary ? (
          <p className="line-clamp-3 text-sm leading-relaxed text-foreground/85">
            {visibleSummary}
          </p>
        ) : null}

        {container.todos.length > 0 ? (
          <div aria-label="Agent todo 列表" className="space-y-1.5">
            {container.todos.map((todo, index) => (
              <TodoRow
                key={`${todo.status}:${todo.content}:${index}`}
                todo={todo}
              />
            ))}
          </div>
        ) : null}

        {container.toolParts.length > 0 ? (
          <div aria-label="Agent 工具调用" className="space-y-1.5">
            {container.toolParts.slice(-3).map((tool) => (
              <ToolRow key={tool.id} tool={tool} />
            ))}
          </div>
        ) : null}

        {latestStreamParts.length > 0 ? (
          <div aria-label="Agent 流式输出" className="space-y-1.5">
            {latestStreamParts.map((part) => (
              <div
                className="rounded-lg border border-border/70 bg-muted/35 px-2.5 py-2"
                key={part.id}
              >
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground/70">
                    {part.label}
                  </span>
                  <span>{getPartStatusLabel(part.status)}</span>
                </div>
                {part.content ? (
                  <div className="mt-1 line-clamp-3 text-sm leading-relaxed text-foreground/85">
                    {part.content}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {container.artifactRefs.length > 0 ? (
          <div className="rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-[11px] text-muted-foreground">
            {container.artifactRefs.length} 个产物
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TodoRow({ todo }: { todo: AgentExecutionContainerTodo }) {
  const Icon =
    todo.status === "completed"
      ? Check
      : todo.status === "in_progress"
        ? ArrowRight
        : Circle;
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          todo.status === "completed"
            ? "border-emerald-500/30 text-emerald-700"
            : "border-border text-muted-foreground",
        )}
      >
        <Icon aria-hidden="true" className="size-2.5" />
      </span>
      <span
        className={cn(
          "min-w-0 text-sm leading-relaxed",
          todo.status === "completed"
            ? "text-muted-foreground line-through"
            : todo.status === "pending"
              ? "text-muted-foreground"
              : "text-foreground",
        )}
      >
        {todo.content}
      </span>
    </div>
  );
}

function ToolRow({ tool }: { tool: AgentExecutionContainerToolPart }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background px-2.5 py-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Wrench
            aria-hidden="true"
            className="size-3.5 text-muted-foreground"
          />
          <span className="truncate text-sm font-medium">
            {formatToolName(tool.toolName)}
          </span>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {getPartStatusLabel(tool.status)}
        </span>
      </div>
      {tool.outputSummary || tool.inputSummary ? (
        <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
          {tool.outputSummary ?? tool.inputSummary}
        </div>
      ) : null}
    </div>
  );
}

function StatusIcon({ status }: { status: AgentExecutionContainer["status"] }) {
  if (status === "failed") {
    return <AlertTriangle aria-hidden="true" className="size-3" />;
  }
  if (status === "paused") {
    return <PauseCircle aria-hidden="true" className="size-3" />;
  }
  if (status === "running") {
    return <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />;
  }
  if (status === "done") return <Check aria-hidden="true" className="size-3" />;
  return <Circle aria-hidden="true" className="size-3" />;
}

function getContainerStatusLabel(
  status: AgentExecutionContainer["status"],
): string {
  switch (status) {
    case "done":
      return "已完成";
    case "failed":
      return "失败";
    case "paused":
      return "已暂停";
    case "running":
      return "运行中";
    case "waiting":
      return "等待中";
  }
}

function getPartStatusLabel(status: AgentExecutionContainerPartStatus): string {
  switch (status) {
    case "done":
      return "已完成";
    case "failed":
      return "失败";
    case "paused":
      return "已暂停";
    case "running":
      return "进行中";
  }
}

function statusClassName(status: AgentExecutionContainer["status"]): string {
  switch (status) {
    case "done":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700";
    case "failed":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "paused":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700";
    case "running":
      return "border-sky-500/35 bg-sky-500/10 text-sky-700";
    case "waiting":
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function formatKindLabel(kind: AgentExecutionContainer["kind"]): string {
  return kind.replace(/_/g, " ");
}

function formatToolName(toolName: string): string {
  return toolName.replace(/_/g, " ");
}
