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
const BILLING_PATTERN =
  /\b402\b|insufficient (balance|credit|credits|quota)|quota exceeded|payment required|billing|余额不足|额度不足/i;
const RATE_LIMIT_PATTERN = /\b429\b|rate limit|too many requests/i;

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

  const diagnostics = collectErrorDiagnostics(error);

  // Map to user-friendly messages
  if (BILLING_PATTERN.test(diagnostics)) {
    return "AI 服务调用失败：当前模型服务余额或额度不足，请检查对应提供商账户的充值、账单或配额设置后重试。";
  }
  if (RATE_LIMIT_PATTERN.test(diagnostics)) {
    return "AI 服务请求过于频繁或达到限流，请稍后重试。";
  }
  if (PROVIDER_PATTERN.test(diagnostics)) {
    return "AI 服务暂时不可用，请稍后重试。";
  }
  if (DB_PATTERN.test(diagnostics)) {
    return "数据服务异常，请稍后重试。";
  }
  if (AUTH_PATTERN.test(diagnostics)) {
    return "认证失败，请刷新页面重新登录。";
  }
  if (INFRA_PATTERN.test(diagnostics)) {
    return "网络连接异常，请检查网络后重试。";
  }
  if (diagnostics.includes("abort") || diagnostics.includes("cancel")) {
    return "请求已取消。";
  }
  if (raw.length > 100) {
    // Long messages are likely stack traces or JSON errors
    return "请求处理失败，请重试。";
  }

  // Short, non-technical messages can pass through
  return "请求处理失败，请重试。";
}

function collectErrorDiagnostics(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();

  function push(value: unknown) {
    if (value === undefined || value === null) return;
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      parts.push(String(value));
      return;
    }
    if (value instanceof Error) {
      parts.push(value.name, value.message);
      return;
    }
    try {
      parts.push(JSON.stringify(value));
    } catch {
      parts.push(String(value));
    }
  }

  let current: unknown = error;
  for (let depth = 0; current && depth < 10 && !seen.has(current); depth++) {
    seen.add(current);
    push(current);

    if (typeof current === "object") {
      const extras = current as {
        cause?: unknown;
        code?: unknown;
        details?: unknown;
        response?: { body?: unknown; data?: unknown; status?: unknown };
        status?: unknown;
      };
      push(extras.code);
      push(extras.status);
      push(extras.response?.status);
      push(extras.response?.data);
      push(extras.response?.body);
      push(extras.details);
      current = extras.cause;
      continue;
    }

    break;
  }

  return parts.join("\n").toLowerCase();
}
