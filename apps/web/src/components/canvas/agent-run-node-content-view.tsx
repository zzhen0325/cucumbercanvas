"use client";

import type { AgentRunNodeViewModel } from "@cucumber/canvas-core";
import {
  CircleCheck,
  CircleDashed,
  CircleDotDashed,
  CircleX,
  FileImage,
} from "lucide-react";
import type { ReactNode } from "react";

import { MessageResponse } from "@/components/ai-elements/message";
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from "@/components/ai-elements/queue";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader } from "@/components/ai-elements/tool";
import { cn } from "@/lib/utils";

const STATUS_STYLES = {
  done: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
  paused: "bg-muted text-muted-foreground",
  running: "bg-accent/40 text-foreground",
  waiting: "bg-muted text-muted-foreground",
} as const;

const STATUS_LABELS = {
  done: "已完成",
  failed: "失败",
  paused: "已暂停",
  running: "执行中",
  waiting: "等待中",
} as const;

export function AgentRunNodeContentView({
  onSelectArtifact,
  viewModel,
}: {
  onSelectArtifact: (nodeId: string) => void;
  viewModel: AgentRunNodeViewModel;
}) {
  const statusClassName = STATUS_STYLES[viewModel.status];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start gap-3 px-4 pb-2 pt-3">
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-5 shrink-0 rounded-full",
            viewModel.status === "running"
              ? "bg-success motion-safe:animate-pulse"
              : "bg-success",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                statusClassName,
              )}
            >
              {STATUS_LABELS[viewModel.status]}
            </span>
          </div>
          <h3 className="mt-3 truncate text-sm font-semibold text-foreground">
            Agent 执行 · {viewModel.title}
          </h3>
        </div>
        <div aria-hidden="true" className="h-7 w-16 shrink-0" />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pr-3 text-sm [scrollbar-gutter:stable]">
        {viewModel.failureReason ? (
          <div className="mb-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
            {viewModel.failureReason}
          </div>
        ) : null}

        {viewModel.reasoning ? (
          <Reasoning
            className="mb-3 rounded-lg bg-background/55 px-3 py-2"
            isStreaming={viewModel.reasoning.isStreaming}
          >
            <ReasoningTrigger
              className="text-xs"
              getThinkingMessage={(isStreaming) =>
                isStreaming ? "思考中..." : "思考过程"
              }
            />
            <ReasoningContent className="mt-2 text-xs leading-5">
              {viewModel.reasoning.content}
            </ReasoningContent>
          </Reasoning>
        ) : null}

        {viewModel.tasks.length > 0 ? (
          <Queue className="mb-3 rounded-lg bg-background/45 p-2">
            <QueueSection defaultOpen>
              <QueueSectionTrigger>
                <QueueSectionLabel
                  count={viewModel.tasks.length}
                  label="任务"
                  icon={<CircleDotDashed className="size-3.5" />}
                />
              </QueueSectionTrigger>
              <QueueSectionContent>
                <QueueList className="mt-1">
                  {viewModel.tasks.map((task) => (
                    <QueueItem key={task.id} className="px-1.5">
                      <div className="flex items-start gap-2">
                        <QueueItemIndicator
                          completed={task.status === "completed"}
                          className={
                            task.active ? "border-success bg-success/30" : ""
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <QueueItemContent
                            completed={task.status === "completed"}
                          >
                            {task.title}
                          </QueueItemContent>
                          {task.description ? (
                            <QueueItemDescription
                              completed={task.status === "completed"}
                            >
                              {task.description}
                            </QueueItemDescription>
                          ) : null}
                        </div>
                      </div>
                    </QueueItem>
                  ))}
                </QueueList>
              </QueueSectionContent>
            </QueueSection>
          </Queue>
        ) : null}

        {viewModel.tools.map((tool) => (
          <Tool
            className="mb-3 rounded-xl bg-background/65"
            defaultOpen
            key={tool.id}
          >
            <ToolHeader
              className="gap-2 px-3 py-2 text-xs"
              state={tool.state}
              title={tool.toolName.replace(/_/g, " ")}
              type={tool.type}
            />
            <ToolContent className="space-y-2 p-3">
              {tool.input ? (
                <AgentRunNodeDataBlock label="参数" value={tool.input} />
              ) : (
                <AgentRunNodeNotice
                  icon={<CircleDashed className="size-3.5" />}
                  text={tool.inputMissingReason}
                />
              )}
              {tool.outputSummary ? (
                <AgentRunNodeNotice
                  icon={<CircleCheck className="size-3.5" />}
                  text={tool.outputSummary}
                />
              ) : null}
              {tool.output || tool.errorText ? (
                <AgentRunNodeDataBlock
                  label={tool.errorText ? "错误" : "结果"}
                  tone={tool.errorText ? "danger" : "default"}
                  value={tool.errorText ?? tool.output}
                />
              ) : tool.outputMissingReason ? (
                <AgentRunNodeNotice
                  icon={<CircleX className="size-3.5" />}
                  text={tool.outputMissingReason}
                />
              ) : null}
            </ToolContent>
          </Tool>
        ))}

        {viewModel.messages.map((message) => (
          <div
            className="mb-3 rounded-lg bg-background/55 px-3 py-2 text-xs leading-5 text-muted-foreground"
            key={message.id}
          >
            <MessageResponse>{message.content}</MessageResponse>
          </div>
        ))}

        {viewModel.artifacts.length > 0 ? (
          <div className="grid gap-2">
            {viewModel.artifacts.map((artifact) => (
              <button
                className="flex items-center gap-2 rounded-lg border border-border bg-background/65 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                key={artifact.nodeId}
                onClick={() => onSelectArtifact(artifact.nodeId)}
                type="button"
              >
                <FileImage className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  画布产物 {artifact.nodeId}
                </span>
                <CircleCheck className="size-3.5 shrink-0 text-success" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AgentRunNodeNotice({
  icon,
  text,
}: {
  icon: ReactNode;
  text: string | undefined;
}) {
  if (!text) return null;
  return (
    <div className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function AgentRunNodeDataBlock({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "danger" | "default";
  value: Record<string, unknown> | string | undefined;
}) {
  if (value === undefined) return null;
  const code =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-semibold uppercase leading-4 text-muted-foreground">
        {label}
      </div>
      <pre
        className={cn(
          "max-h-40 overflow-auto whitespace-pre-wrap rounded-md border px-3 py-2 font-mono text-[11px] leading-4 [overflow-wrap:anywhere]",
          tone === "danger"
            ? "border-destructive/20 bg-destructive/10 text-destructive"
            : "border-border bg-background/75 text-muted-foreground",
        )}
      >
        {code}
      </pre>
    </div>
  );
}
