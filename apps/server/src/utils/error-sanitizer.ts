/**
 * Sanitize error messages before sending to the frontend.
 * Logs full error detail server-side, returns user-friendly message.
 */

const PROVIDER_PATTERN =
  /google|vertex|openai|deepseek|seedream|volcengine|langchain|gaxios|undici|fetch failed/i;
const DB_CONNECTION_PATTERN =
  /agent_persistence|agentpersistenceinitializationerror|agent 持久化|supabase postgres/i;
const DB_PATTERN = /supabase|postgres|database|relation|column|constraint/i;
const AUTH_PATTERN =
  /jwt|token|unauthorized|forbidden|credential|service.account/i;
const INFRA_PATTERN =
  /econnrefused|econnreset|etimedout|dns|socket|tls|certificate/i;
const BILLING_PATTERN =
  /\b402\b|insufficient (balance|credit|credits|quota)|quota exceeded|payment required|billing|余额不足|额度不足/i;
const RATE_LIMIT_PATTERN = /\b429\b|rate limit|too many requests/i;
const CONFIG_PATTERN =
  /missing|required|not configured|environment variable|api[_-]?key|service account|CUCUMBER_[A-Z0-9_]+ is required/i;
const CANVAS_PATTERN =
  /canvas.*not found|invalid canvas|activePageId|PenDocument\.pages|legacy root children|canvas document/i;
const TOOL_PATTERN =
  /tool.*failed|mcp|inspect_canvas|manipulate_canvas|screenshot_canvas|apply_canvas_transaction|validate_canvas/i;

export type ClientSafeErrorReason =
  | "auth"
  | "billing"
  | "canceled"
  | "canvas_state"
  | "configuration"
  | "data_service"
  | "network"
  | "provider_unavailable"
  | "rate_limit"
  | "runtime"
  | "tool_execution";

export type ClientSafeErrorDescription = {
  details: {
    diagnosticSummary: string;
    reason: ClientSafeErrorReason;
    retryable: boolean;
  };
  message: string;
};

export function sanitizeErrorForClient(error: unknown): string {
  return describeErrorForClient(error).message;
}

export function describeErrorForClient(
  error: unknown,
): ClientSafeErrorDescription {
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
  const diagnosticSummary = summarizeErrorForClient(error);

  // Map to user-friendly messages
  if (BILLING_PATTERN.test(diagnostics)) {
    return {
      details: {
        diagnosticSummary,
        reason: "billing",
        retryable: false,
      },
      message:
        "AI 服务调用失败：当前模型服务余额或额度不足，请检查对应提供商账户的充值、账单或配额设置后重试。",
    };
  }
  if (RATE_LIMIT_PATTERN.test(diagnostics)) {
    return {
      details: {
        diagnosticSummary,
        reason: "rate_limit",
        retryable: true,
      },
      message: "AI 服务请求过于频繁或达到限流，请稍后重试。",
    };
  }
  if (CONFIG_PATTERN.test(diagnostics)) {
    return {
      details: {
        diagnosticSummary,
        reason: "configuration",
        retryable: false,
      },
      message:
        "Agent 配置缺失：服务端缺少必要的模型、数据库或运行时配置，请补齐配置后重试。",
    };
  }
  if (DB_CONNECTION_PATTERN.test(diagnostics)) {
    return {
      details: {
        diagnosticSummary,
        reason: "data_service",
        retryable: true,
      },
      message:
        "Agent 数据服务连接失败：无法初始化会话持久化，请检查服务端数据库连接配置、网络连通性和 Supabase 连接池状态后重试。",
    };
  }
  if (PROVIDER_PATTERN.test(diagnostics)) {
    return {
      details: {
        diagnosticSummary,
        reason: "provider_unavailable",
        retryable: true,
      },
      message:
        "AI 服务暂时不可用：上游模型或工具调用失败，请稍后重试或切换模型。",
    };
  }
  if (DB_PATTERN.test(diagnostics)) {
    return {
      details: {
        diagnosticSummary,
        reason: "data_service",
        retryable: true,
      },
      message: "数据服务异常：会话、画布或运行记录读写失败，请稍后重试。",
    };
  }
  if (AUTH_PATTERN.test(diagnostics)) {
    return {
      details: {
        diagnosticSummary,
        reason: "auth",
        retryable: false,
      },
      message: "认证失败：登录态或访问令牌无效，请刷新页面重新登录。",
    };
  }
  if (INFRA_PATTERN.test(diagnostics)) {
    return {
      details: {
        diagnosticSummary,
        reason: "network",
        retryable: true,
      },
      message:
        "网络连接异常：Agent 无法连接模型、数据服务或本地运行时，请检查网络后重试。",
    };
  }
  if (diagnostics.includes("abort") || diagnostics.includes("cancel")) {
    return {
      details: {
        diagnosticSummary,
        reason: "canceled",
        retryable: false,
      },
      message: "请求已取消。",
    };
  }
  if (CANVAS_PATTERN.test(diagnostics)) {
    return {
      details: {
        diagnosticSummary,
        reason: "canvas_state",
        retryable: false,
      },
      message:
        "画布状态无效：当前画布文档缺少运行所需的页面或 activePageId，请修复画布数据后重试。",
    };
  }
  if (TOOL_PATTERN.test(diagnostics)) {
    return {
      details: {
        diagnosticSummary,
        reason: "tool_execution",
        retryable: false,
      },
      message:
        "Agent 工具执行失败：某个画布或生成工具返回错误，本次运行已停止，请根据工具输出修正输入后重试。",
    };
  }

  return {
    details: {
      diagnosticSummary,
      reason: "runtime",
      retryable: true,
    },
    message:
      raw.length > 0 && raw.length <= 100
        ? `Agent 运行时异常：${redactSensitiveText(raw)}`
        : "Agent 运行时异常：服务端在执行过程中抛出未分类错误，完整堆栈已写入服务端日志。",
  };
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

function summarizeErrorForClient(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; current && depth < 4 && !seen.has(current); depth++) {
    seen.add(current);

    if (current instanceof Error) {
      parts.push(`${current.name}: ${current.message}`);
      current = (current as Error & { cause?: unknown }).cause;
      continue;
    }

    if (typeof current === "object") {
      const extras = current as {
        cause?: unknown;
        code?: unknown;
        message?: unknown;
        response?: { status?: unknown };
        status?: unknown;
      };
      const summary = [
        typeof extras.message === "string" ? extras.message : undefined,
        extras.code != null ? `code=${String(extras.code)}` : undefined,
        extras.status != null ? `status=${String(extras.status)}` : undefined,
        extras.response?.status != null
          ? `response=${String(extras.response.status)}`
          : undefined,
      ].filter(Boolean);
      if (summary.length > 0) {
        parts.push(summary.join(" "));
      }
      current = extras.cause;
      continue;
    }

    parts.push(String(current));
    break;
  }

  const summary = parts.join(" <- ").replace(/\s+/g, " ").trim();
  if (!summary) {
    return "Agent run failed without a diagnostic payload.";
  }
  return truncateDiagnostic(redactSensitiveText(summary));
}

function redactSensitiveText(value: string): string {
  return value
    .replace(
      /(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|service[_-]?account)\s*[:=]\s*["']?[^"',\s]+/gi,
      "$1=[redacted]",
    )
    .replace(
      /(Bearer|sk-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]+)/g,
      "[redacted]",
    );
}

function truncateDiagnostic(value: string): string {
  return value.length > 240 ? `${value.slice(0, 237)}...` : value;
}
