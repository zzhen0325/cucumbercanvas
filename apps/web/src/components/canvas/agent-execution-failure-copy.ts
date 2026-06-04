const RAW_EMPTY_VALUE_PATTERN = /\b(?:null|undefined)\b/gi;
const HTTP_STATUS_PATTERN = /\b(?:HTTP\s*)?[1-5]\d{2}\b/gi;
const RAW_CODE_PATTERN =
  /\b(?:E[A-Z0-9_]{3,}|ERR_[A-Z0-9_]+|[A-Z][A-Z0-9_]{4,})\b/g;

const AUTH_PATTERN = /\b(?:401|403|unauthori[sz]ed|forbidden)\b/i;
const RATE_LIMIT_PATTERN = /\b(?:429|rate.?limit|too many requests)\b/i;
const TIMEOUT_PATTERN = /\b(?:timeout|timed.?out|ETIMEDOUT|ECONNABORTED)\b/i;
const NETWORK_PATTERN =
  /\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed|network)\b/i;
const SERVICE_PATTERN =
  /\b(?:500|502|503|504|internal server|bad gateway|service unavailable)\b/i;

export function formatAgentFailureReason(value: string | undefined): string {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "该步骤失败，但当前节点没有记录可读的失败原因。请重试此步骤，或改写输入后继续。";
  }
  const mapped = mapDiagnosticReason(normalized);
  if (mapped) return mapped;
  if (isOnlyDiagnosticNoise(normalized)) {
    return "该步骤失败，但当前节点没有记录可读的失败原因。请重试此步骤，或改写输入后继续。";
  }
  const cleaned = normalized
    .replace(RAW_EMPTY_VALUE_PATTERN, "")
    .replace(HTTP_STATUS_PATTERN, "")
    .replace(RAW_CODE_PATTERN, "")
    .replace(/\s*[:：]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return (
    cleaned ||
    "该步骤失败，但当前节点没有记录可读的失败原因。请重试此步骤，或改写输入后继续。"
  );
}

export function formatAgentFailureListItem(value: string): string {
  const readable = formatAgentFailureReason(value);
  return readable || "记录缺少可读说明。";
}

function mapDiagnosticReason(value: string): string | undefined {
  if (AUTH_PATTERN.test(value)) {
    return "请求未通过权限校验，请刷新登录状态后重试。";
  }
  if (RATE_LIMIT_PATTERN.test(value)) {
    return "服务请求过于频繁，请稍后重试。";
  }
  if (TIMEOUT_PATTERN.test(value)) {
    return "服务响应超时，请稍后重试或减少本次输入范围。";
  }
  if (NETWORK_PATTERN.test(value)) {
    return "服务连接失败，请检查网络后重试。";
  }
  if (SERVICE_PATTERN.test(value)) {
    return "外部服务暂时不可用，请稍后重试或改写输入后继续。";
  }
  return undefined;
}

function isOnlyDiagnosticNoise(value: string): boolean {
  const withoutNoise = value
    .replace(RAW_EMPTY_VALUE_PATTERN, "")
    .replace(HTTP_STATUS_PATTERN, "")
    .replace(RAW_CODE_PATTERN, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
  return withoutNoise.length === 0;
}
