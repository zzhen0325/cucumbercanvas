import { describe, expect, it, vi } from "vitest";

import { AgentPersistenceInitializationError } from "../agent/persistence/index.js";
import {
  describeErrorForClient,
  sanitizeErrorForClient,
} from "./error-sanitizer.js";

describe("sanitizeErrorForClient", () => {
  it("maps nested provider billing failures to a concrete client message", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const providerError = new Error("402 Insufficient Balance");
      const middlewareError = new Error("MiddlewareError");
      (middlewareError as Error & { cause?: unknown }).cause = providerError;

      expect(sanitizeErrorForClient(middlewareError)).toBe(
        "AI 服务调用失败：当前模型服务余额或额度不足，请检查对应提供商账户的充值、账单或配额设置后重试。",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("maps nested provider rate limits without exposing raw provider text", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const error = new Error("Agent middleware failed");
      (error as Error & { response?: { status: number } }).response = {
        status: 429,
      };

      expect(sanitizeErrorForClient(error)).toBe(
        "AI 服务请求过于频繁或达到限流，请稍后重试。",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("classifies LangChain tool identity errors as actionable tool failures", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const error = new Error(
        'You have modified a tool in "wrapModelCall" hook of middleware "todoListMiddleware": screenshot_canvas. This is not supported.',
      );

      expect(sanitizeErrorForClient(error)).toBe(
        "Agent 工具执行失败：某个画布或生成工具返回错误，本次运行已停止，请根据工具输出修正输入后重试。",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("maps agent persistence connection timeouts to a data service message", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const error = new AgentPersistenceInitializationError({
        cause: new Error("Connection terminated due to connection timeout", {
          cause: new Error("Connection terminated unexpectedly"),
        }),
        component: "store",
        target:
          "postgres@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres",
      });
      const description = describeErrorForClient(error);

      expect(description).toMatchObject({
        details: {
          reason: "data_service",
          retryable: true,
        },
        message:
          "Agent 数据服务连接失败：无法初始化会话持久化，请检查服务端数据库连接配置、网络连通性和 Supabase 连接池状态后重试。",
      });
      expect(description.details.diagnosticSummary).toContain(
        "AgentPersistenceInitializationError",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
