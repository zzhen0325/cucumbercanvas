import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database, StreamEvent } from "@cucumber/shared";
import type { ToolRuntime } from "@langchain/core/tools";

import { buildApp } from "../app.js";
import { loadServerEnv } from "../config/env.js";
import { bridgeMcpToolToDeepAgent } from "../mcp/deepagents-bridge.js";
import { createCucumberMcpServer } from "../mcp/server.js";
import { createAdminSupabaseClient } from "../supabase/admin.js";
import { createAgentBackend } from "./backends/index.js";
import type { CucumberAgent, CucumberAgentFactory } from "./deep-agent.js";

const SERVER_ROOT_URL = new URL("../../", import.meta.url);
const ENV_FILE_PATH = fileURLToPath(
  new URL("../../../.env.local", SERVER_ROOT_URL),
);
const TEST_TIMEOUT_MS = 5 * 60 * 1000;
const REQUIRED_ENV_KEYS = [
  "CUCUMBER_SUPABASE_URL",
  "CUCUMBER_SUPABASE_ANON_KEY",
  "CUCUMBER_SUPABASE_SERVICE_ROLE_KEY",
  "CUCUMBER_SUPABASE_DB_URL",
  "CUCUMBER_VOLCENGINE_ACCESS_KEY_ID",
  "CUCUMBER_VOLCENGINE_SECRET_ACCESS_KEY",
  "CUCUMBER_SEEDREAM_REQ_KEY",
] as const;

loadLocalEnvFileIfNeeded();

const missingEnvKeys = REQUIRED_ENV_KEYS.filter(
  (key) => !process.env[key] || process.env[key]?.trim().length === 0,
);

if (missingEnvKeys.length > 0) {
  console.warn(
    `[real-image-generation-chain] skipped, missing env: ${missingEnvKeys.join(", ")}`,
  );
}

const describeRealChain = missingEnvKeys.length > 0 ? describe.skip : describe;
type WorkerProcess = ReturnType<typeof spawn>;

describeRealChain("real image generation chain", () => {
  let origin = "";
  let worker: WorkerProcess | null = null;
  let workerLogs = "";
  const app = buildApp({
    agentFactory: createDeterministicGenerateImageAgentFactory(),
  });
  const env = loadServerEnv();
  const admin = createAdminSupabaseClient(env);

  beforeAll(async () => {
    origin = await app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const spawnedWorker = spawn(
      process.execPath,
      ["--import", "tsx", "./src/worker.ts"],
      {
        cwd: fileURLToPath(SERVER_ROOT_URL),
        env: {
          ...process.env,
          CUCUMBER_WORKER_ID: `vitest-${randomUUID().slice(0, 8)}`,
          CUCUMBER_WORKER_IMAGE_CONCURRENCY: "1",
          CUCUMBER_WORKER_MAX_BATCH_SIZE: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    worker = spawnedWorker;

    spawnedWorker.stdout?.setEncoding("utf8");
    spawnedWorker.stderr?.setEncoding("utf8");
    spawnedWorker.stdout?.on("data", (chunk) => {
      workerLogs += chunk;
    });
    spawnedWorker.stderr?.on("data", (chunk) => {
      workerLogs += chunk;
    });

    await waitForWorkerReady(spawnedWorker, () => workerLogs);
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await stopWorker(worker);
    await app.close();
  });

  it(
    "streams a real Seedream image generation run through tasks and SSE",
    async () => {
      const email = `seedream-e2e-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
      const password = `Aime!${randomUUID()}`;
      let userId: string | undefined;
      let objectPath: string | undefined;
      let accessToken: string | undefined;
      const sseAbort = new AbortController();

      try {
        const { data: createdUser, error: createUserError } =
          await admin.auth.admin.createUser({
            email,
            email_confirm: true,
            password,
            user_metadata: {
              display_name: "Seedream E2E",
            },
          });

        expect(createUserError).toBeNull();
        expect(createdUser.user?.id).toBeTruthy();
        userId = createdUser.user?.id;

        const anon = createClient<Database>(
          env.supabaseUrl!,
          env.supabaseAnonKey!,
          {
            auth: {
              autoRefreshToken: false,
              persistSession: false,
            },
          },
        );

        const { data: signedIn, error: signInError } =
          await anon.auth.signInWithPassword({
            email,
            password,
          });

        expect(signInError).toBeNull();
        accessToken = signedIn.session?.access_token;
        expect(accessToken).toBeTruthy();

        const authHeaders = {
          authorization: `Bearer ${accessToken}`,
        };

        const viewerResponse = await fetch(`${origin}/api/viewer`, {
          headers: authHeaders,
        });
        expect(viewerResponse.status).toBe(200);

        const projectResponse = await fetch(`${origin}/api/projects`, {
          method: "POST",
          headers: {
            ...authHeaders,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            description: "真实 Seedream 端到端集成测试",
            name: `Seedream E2E ${Date.now()}`,
          }),
        });
        expect(projectResponse.status).toBe(201);
        const projectBody = (await projectResponse.json()) as {
          project: { primaryCanvas: { id: string } };
        };
        const canvasId = projectBody.project.primaryCanvas.id;
        expect(canvasId).toBeTruthy();

        const sessionResponse = await fetch(
          `${origin}/api/canvases/${canvasId}/sessions`,
          {
            method: "POST",
            headers: authHeaders,
          },
        );
        expect(sessionResponse.status).toBe(201);
        const sessionBody = (await sessionResponse.json()) as {
          session: { id: string };
        };
        const sessionId = sessionBody.session.id;
        expect(sessionId).toBeTruthy();

        const sseResponse = await fetch(
          `${origin}/api/canvases/${canvasId}/stream`,
          {
            headers: authHeaders,
            signal: sseAbort.signal,
          },
        );
        expect(sseResponse.status).toBe(200);
        const reader = sseResponse.body?.getReader();
        expect(reader).toBeDefined();

        const runResponse = await fetch(`${origin}/api/agent/runs`, {
          method: "POST",
          headers: {
            ...authHeaders,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            canvasId,
            conversationId: `conversation_${randomUUID().replace(/-/g, "")}`,
            imageGenerationPreference: {
              mode: "manual",
              models: ["bytedance/seedream-4.6"],
            },
            prompt: "帮我生成一张图",
            sessionId,
          }),
        });
        expect(runResponse.status).toBe(202);
        const runBody = (await runResponse.json()) as { runId: string };
        expect(runBody.runId).toBeTruthy();

        const events = await readSseEventsUntil(reader!, (event) => {
          return (
            (event.type === "run.completed" || event.type === "run.failed") &&
            event.runId === runBody.runId
          );
        });

        const runFailed = events.find(
          (event) =>
            event.type === "run.failed" && event.runId === runBody.runId,
        );
        expect(runFailed).toBeUndefined();

        const toolStarted = events.find(
          (event) =>
            event.type === "tool.started" &&
            event.runId === runBody.runId &&
            event.toolName === "generate_image",
        );
        expect(toolStarted).toBeDefined();

        const toolCompleted = events.find(
          (event) =>
            event.type === "tool.completed" &&
            event.runId === runBody.runId &&
            event.toolName === "generate_image",
        );
        expect(toolCompleted).toBeDefined();

        const imageArtifacts =
          toolCompleted?.type === "tool.completed"
            ? (toolCompleted.artifacts ?? [])
            : [];
        expect(imageArtifacts.length).toBeGreaterThan(0);
        expect(imageArtifacts[0]?.type).toBe("image");
        expect(imageArtifacts[0]?.url).toMatch(/^https?:\/\//);

        const canvasSyncCount = events.filter(
          (event) =>
            event.type === "canvas.sync" && event.runId === runBody.runId,
        ).length;
        expect(canvasSyncCount).toBeGreaterThanOrEqual(2);

        const runCompleted = events.find(
          (event) =>
            event.type === "run.completed" && event.runId === runBody.runId,
        );
        expect(runCompleted).toBeDefined();

        const jobRow = await pollUntil(
          async () => {
            const { data, error } = await admin
              .from("background_jobs")
              .select("id, status, result, created_by, canvas_id, session_id")
              .eq("created_by", userId!)
              .eq("canvas_id", canvasId)
              .eq("session_id", sessionId)
              .eq("job_type", "image_generation")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (error) {
              throw new Error(`background_jobs query failed: ${error.message}`);
            }

            return data?.status === "succeeded" ? data : null;
          },
          { label: "background_jobs.succeeded" },
        );

        const jobId = jobRow.id;
        expect(jobId).toBeTruthy();
        expect(jobRow.status).toBe("succeeded");

        const jobResult = (jobRow.result ?? {}) as {
          signed_url?: string;
          object_path?: string;
          width?: number;
          height?: number;
          mime_type?: string;
        };

        expect(jobResult.signed_url).toMatch(/^https?:\/\//);
        expect(imageArtifacts[0]?.url).toBe(jobResult.signed_url);
        expect(jobResult.width).toBeGreaterThan(0);
        expect(jobResult.height).toBeGreaterThan(0);
        expect(jobResult.mime_type).toMatch(/^image\//);
        objectPath = jobResult.object_path;

        const taskRow = await pollUntil(
          async () => {
            const { data, error } = await admin
              .from("tasks")
              .select("job_id, status, completed_at, queue_name")
              .eq("job_id", jobId!)
              .single();

            if (error) {
              throw new Error(`tasks query failed: ${error.message}`);
            }

            return data?.status === "succeeded" ? data : null;
          },
          { label: "tasks.succeeded" },
        );

        expect(taskRow.queue_name).toBe("image_generation_jobs");
        expect(taskRow.status).toBe("succeeded");
        expect(taskRow.completed_at).toBeTruthy();

        const { data: assetRow, error: assetError } = await admin
          .from("asset_objects")
          .select("id, bucket, object_path, mime_type")
          .eq("object_path", jobResult.object_path!)
          .single();

        expect(assetError).toBeNull();
        expect(assetRow?.bucket).toBe("project-assets");
        expect(assetRow?.mime_type).toMatch(/^image\//);

        const imageResponse = await fetch(jobResult.signed_url!);
        expect(imageResponse.ok).toBe(true);
        expect(imageResponse.headers.get("content-type") ?? "").toMatch(
          /^image\//,
        );
      } finally {
        sseAbort.abort();

        if (objectPath) {
          await admin.storage.from("project-assets").remove([objectPath]);
        }

        if (userId) {
          await admin.auth.admin.deleteUser(userId);
        }
      }
    },
    TEST_TIMEOUT_MS,
  );
});

function createDeterministicGenerateImageAgentFactory(): CucumberAgentFactory {
  return (options) => {
    const backend =
      options.backendResult?.factory ??
      createAgentBackend(options.env, options.canvasId).factory;
    const server = createCucumberMcpServer(backend, {
      createUserClient:
        options.createUserClient ??
        (() => {
          throw new Error(
            "createUserClient is required for generate_image test agent",
          );
        }),
      ...(options.connectionManager
        ? { connectionManager: options.connectionManager }
        : {}),
      ...(options.persistImage ? { persistImage: options.persistImage } : {}),
      ...(options.submitImageJob
        ? { submitImageJob: options.submitImageJob }
        : {}),
      ...(options.submitVideoJob
        ? { submitVideoJob: options.submitVideoJob }
        : {}),
    });

    const generateImageTool = bridgeMcpToolToDeepAgent(
      server.getTool("generate_image")!,
    );

    return {
      async *stream() {
        throw new Error("deterministic test agent does not implement stream()");
      },
      async *streamEvents(input: unknown, runtime: unknown) {
        const prompt = extractPromptFromStreamInput(input);
        const toolCallId = `tool_${randomUUID().replace(/-/g, "")}`;
        const toolInput = {
          aspectRatio: "1:1",
          model: "bytedance/seedream-4.6",
          prompt,
          title: prompt.slice(0, 80),
        };

        yield {
          data: { input: toolInput },
          event: "on_tool_start",
          name: "generate_image",
          run_id: toolCallId,
        };

        const output = await generateImageTool.invoke(
          toolInput,
          runtime as unknown as ToolRuntime,
        );

        yield {
          data: { output },
          event: "on_tool_end",
          name: "generate_image",
          run_id: toolCallId,
        };
      },
    } as unknown as CucumberAgent;
  };
}

function extractPromptFromStreamInput(input: unknown) {
  const message = (input as { messages?: unknown[] } | undefined)
    ?.messages?.[0] as { content?: unknown } | undefined;
  const content = message?.content;

  if (typeof content === "string" && content.trim().length > 0) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (
          part &&
          typeof part === "object" &&
          "type" in part &&
          (part as { type?: unknown }).type === "text" &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("\n")
      .trim();

    if (text.length > 0) {
      return text;
    }
  }

  return "帮我生成一张图";
}

function loadLocalEnvFileIfNeeded() {
  const hasAllRequiredEnv = REQUIRED_ENV_KEYS.every((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.trim().length > 0;
  });

  if (hasAllRequiredEnv) {
    return;
  }

  if (existsSync(ENV_FILE_PATH) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(ENV_FILE_PATH);
  }
}

async function waitForWorkerReady(
  worker: WorkerProcess,
  getLogs: () => string,
) {
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    if (getLogs().includes("Started.")) {
      return;
    }

    if (worker.exitCode !== null) {
      throw new Error(
        `worker exited before becoming ready (code ${worker.exitCode}). Logs:\n${getLogs()}`,
      );
    }

    await delay(250);
  }

  throw new Error(
    `worker did not become ready within 30s. Logs:\n${getLogs()}`,
  );
}

async function stopWorker(worker: WorkerProcess | null) {
  if (!worker || worker.exitCode !== null) {
    return;
  }

  worker.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => {
      worker.once("exit", () => resolve());
    }),
    delay(10_000).then(() => {
      if (worker.exitCode === null) {
        worker.kill("SIGKILL");
      }
    }),
  ]);
}

async function readSseEventsUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (event: StreamEvent) => boolean,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  let buffer = "";
  let currentData = "";

  const startedAt = Date.now();
  while (Date.now() - startedAt < TEST_TIMEOUT_MS) {
    const chunk = await readWithTimeout(reader, 30_000);
    if (chunk.done) {
      break;
    }

    buffer += new TextDecoder().decode(chunk.value);
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, "");
      if (!line) {
        if (!currentData) {
          continue;
        }

        const event = JSON.parse(currentData) as StreamEvent;
        events.push(event);
        currentData = "";
        if (predicate(event)) {
          return events;
        }
        continue;
      }

      if (line.startsWith(":")) {
        continue;
      }

      if (line.startsWith("data:")) {
        currentData += line.slice(5).trimStart();
      }
    }
  }

  throw new Error(
    `Timed out waiting for SSE terminal event. Received events: ${JSON.stringify(events, null, 2)}`,
  );
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
) {
  return await Promise.race([
    reader.read(),
    delay(timeoutMs).then(() => {
      throw new Error(`Timed out waiting for SSE data after ${timeoutMs}ms`);
    }),
  ]);
}

async function pollUntil<T>(
  fn: () => Promise<T | null>,
  options: { intervalMs?: number; label: string; timeoutMs?: number },
): Promise<T> {
  const intervalMs = options.intervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await fn();
    if (result) {
      return result;
    }
    await delay(intervalMs);
  }

  throw new Error(
    `Timed out waiting for ${options.label} after ${timeoutMs}ms`,
  );
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
