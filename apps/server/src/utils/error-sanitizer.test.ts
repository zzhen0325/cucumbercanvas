import { describe, expect, it, vi } from "vitest";

import { sanitizeErrorForClient } from "./error-sanitizer.js";

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
});
