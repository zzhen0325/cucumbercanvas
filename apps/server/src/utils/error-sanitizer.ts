/**
 * Sanitize error messages before sending to the frontend.
 * Logs full error detail server-side, returns user-friendly message.
 */

const PROVIDER_PATTERN =
  /google|vertex|openai|deepseek|seedream|volcengine|langchain|gaxios|undici|fetch failed/i;
const DB_PATTERN = /supabase|postgres|database|relation|column|constraint/i;
const AUTH_PATTERN =
  /jwt|token|unauthorized|forbidden|credential|service.account/i;
const INFRA_PATTERN =
  /econnrefused|econnreset|etimedout|dns|socket|tls|certificate/i;

export function sanitizeErrorForClient(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const errorWithExtras = error as Error & {
    cause?: unknown;
    response?: { status?: unknown; data?: unknown; body?: unknown };
    details?: unknown;
  };

  // Log full detail server-side for debugging
  console.error("[error-sanitizer] Raw error:", raw);
  if (error instanceof Error) {
    // Log nested cause chain (LangChain wraps errors multiple levels deep)
    let cause: unknown = errorWithExtras.cause;
    while (cause) {
      console.error(
        "[error-sanitizer] Caused by:",
        cause instanceof Error ? cause.message : cause,
      );
      cause =
        typeof cause === "object" && cause !== null && "cause" in cause
          ? (cause as { cause?: unknown }).cause
          : undefined;
    }
    // Log response details if present (Google API errors attach response/details)
    if (errorWithExtras.response) {
      console.error(
        "[error-sanitizer] Response status:",
        errorWithExtras.response.status,
      );
      console.error(
        "[error-sanitizer] Response data:",
        JSON.stringify(
          errorWithExtras.response.data ?? errorWithExtras.response.body ?? "",
        ).substring(0, 2000),
      );
    }
    if (errorWithExtras.details) {
      console.error(
        "[error-sanitizer] Details:",
        JSON.stringify(errorWithExtras.details).substring(0, 2000),
      );
    }
    if (error.stack) {
      console.error("[error-sanitizer] Stack:", error.stack);
    }
  }

  // Map to user-friendly messages
  if (PROVIDER_PATTERN.test(raw)) {
    return "AI 服务暂时不可用，请稍后重试。";
  }
  if (DB_PATTERN.test(raw)) {
    return "数据服务异常，请稍后重试。";
  }
  if (AUTH_PATTERN.test(raw)) {
    return "认证失败，请刷新页面重新登录。";
  }
  if (INFRA_PATTERN.test(raw)) {
    return "网络连接异常，请检查网络后重试。";
  }
  if (raw.includes("abort") || raw.includes("cancel")) {
    return "请求已取消。";
  }
  if (raw.length > 100) {
    // Long messages are likely stack traces or JSON errors
    return "请求处理失败，请重试。";
  }

  // Short, non-technical messages can pass through
  return "请求处理失败，请重试。";
}
