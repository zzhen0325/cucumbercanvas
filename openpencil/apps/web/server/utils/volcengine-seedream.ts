import { createHash, createHmac } from 'node:crypto';

const DEFAULT_HOST = 'visual.volcengineapi.com';
const DEFAULT_REGION = 'cn-north-1';
const DEFAULT_SERVICE = 'cv';
const DEFAULT_VERSION = '2022-08-31';
const DEFAULT_IMAGE_MODEL = 'bytedance/seedream-4.6';
const DEFAULT_IMAGE_REQ_KEY = 'jimeng_seedream46_cvtob';
const DEFAULT_VIDEO_MODEL = 'bytedance/seedream-video';
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLL_ATTEMPTS = 60;
const JSON_CONTENT_TYPE = 'application/json';

export interface VolcengineSeedreamConfig {
  accessKeyId: string;
  secretAccessKey: string;
  host: string;
  region: string;
  service: string;
  version: string;
  imageModel: string;
  imageReqKey: string;
  videoModel: string;
  videoReqKey?: string;
}

export interface VolcengineSeedreamConfigInput {
  accessKeyId?: string;
  secretAccessKey?: string;
  host?: string;
  baseUrl?: string;
  region?: string;
  service?: string;
  version?: string;
  imageModel?: string;
  imageReqKey?: string;
  videoModel?: string;
  videoReqKey?: string;
}

export interface GenerateVolcengineImageInput extends VolcengineSeedreamConfigInput {
  prompt: string;
  size?: string;
  forceSingle?: boolean;
  imageUrls?: string[];
  model?: string;
  reqKey?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

export interface GenerateVolcengineVideoInput extends VolcengineSeedreamConfigInput {
  prompt: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  imageUrls?: string[];
  model?: string;
  reqKey?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

interface VolcengineSignedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

interface VolcengineApiResponse<TData = Record<string, unknown>> {
  code?: number | string;
  message?: string;
  msg?: string;
  error?: string;
  request_id?: string;
  data?: TData;
}

interface SubmitTaskData {
  task_id?: string;
  taskId?: string;
  id?: string;
}

interface AsyncResultData {
  status?: string | number;
  task_status?: string | number;
  state?: string | number;
  task_id?: string;
  image_urls?: string[];
  images?: string[];
  video_url?: string;
  video_urls?: string[];
  error?: string;
  fail_reason?: string;
  reason?: string;
  message?: string;
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function hmacSha256(key: Buffer | string, content: string): Buffer {
  return createHmac('sha256', key).update(content, 'utf8').digest();
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function buildCanonicalQueryString(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(query[key] ?? '')}`)
    .join('&');
}

function toUtcTimestamp(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function normalizeHost(input?: string): string | undefined {
  if (!input?.trim()) return undefined;
  const trimmed = input.trim();
  if (trimmed.includes('://')) {
    return new URL(trimmed).host;
  }
  return trimmed.replace(/\/+$/, '');
}

function envFirst(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function resolveVolcengineSeedreamConfig(
  overrides: VolcengineSeedreamConfigInput = {},
): VolcengineSeedreamConfig {
  const accessKeyId =
    overrides.accessKeyId ??
    envFirst('CUCUMBER_VOLCENGINE_ACCESS_KEY_ID', 'CUCUMBER_SEEDREAM_ACCESS_KEY_ID');
  const secretAccessKey =
    overrides.secretAccessKey ??
    envFirst(
      'CUCUMBER_VOLCENGINE_SECRET_ACCESS_KEY',
      'CUCUMBER_SEEDREAM_SECRET_ACCESS_KEY',
    );

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'Missing Volcengine credentials. Set CUCUMBER_VOLCENGINE_ACCESS_KEY_ID / CUCUMBER_VOLCENGINE_SECRET_ACCESS_KEY or the CUCUMBER_SEEDREAM_* equivalents.',
    );
  }

  const host =
    normalizeHost(overrides.host) ??
    normalizeHost(overrides.baseUrl) ??
    normalizeHost(process.env.CUCUMBER_SEEDREAM_HOST) ??
    DEFAULT_HOST;

  return {
    accessKeyId,
    secretAccessKey,
    host,
    region: overrides.region ?? process.env.CUCUMBER_SEEDREAM_REGION?.trim() ?? DEFAULT_REGION,
    service: overrides.service ?? process.env.CUCUMBER_SEEDREAM_SERVICE?.trim() ?? DEFAULT_SERVICE,
    version: overrides.version ?? process.env.CUCUMBER_SEEDREAM_VERSION?.trim() ?? DEFAULT_VERSION,
    imageModel:
      overrides.imageModel ?? process.env.CUCUMBER_SEEDREAM_MODEL?.trim() ?? DEFAULT_IMAGE_MODEL,
    imageReqKey:
      overrides.imageReqKey ??
      process.env.CUCUMBER_SEEDREAM_REQ_KEY?.trim() ??
      DEFAULT_IMAGE_REQ_KEY,
    videoModel:
      overrides.videoModel ??
      process.env.CUCUMBER_SEEDREAM_VIDEO_MODEL?.trim() ??
      DEFAULT_VIDEO_MODEL,
    videoReqKey:
      overrides.videoReqKey ?? process.env.CUCUMBER_SEEDREAM_VIDEO_REQ_KEY?.trim() ?? undefined,
  };
}

export function buildVolcengineSignedRequest(
  action: string,
  payload: Record<string, unknown>,
  config: VolcengineSeedreamConfig,
  date = new Date(),
): VolcengineSignedRequest {
  const body = JSON.stringify(payload);
  const xDate = toUtcTimestamp(date);
  const shortDate = xDate.slice(0, 8);
  const query = buildCanonicalQueryString({
    Action: action,
    Version: config.version,
  });
  const contentSha = sha256Hex(body);
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonicalHeaders = [
    `content-type:${JSON_CONTENT_TYPE}`,
    `host:${config.host}`,
    `x-content-sha256:${contentSha}`,
    `x-date:${xDate}`,
  ].join('\n');
  const canonicalRequest = [
    'POST',
    '/',
    query,
    canonicalHeaders,
    '',
    signedHeaders,
    contentSha,
  ].join('\n');
  const credentialScope = `${shortDate}/${config.region}/${config.service}/request`;
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const kDate = hmacSha256(config.secretAccessKey, shortDate);
  const kRegion = hmacSha256(kDate, config.region);
  const kService = hmacSha256(kRegion, config.service);
  const kSigning = hmacSha256(kService, 'request');
  const signature = hmacSha256(kSigning, stringToSign).toString('hex');

  return {
    url: `https://${config.host}/?${query}`,
    body,
    headers: {
      Authorization: `HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'Content-Type': JSON_CONTENT_TYPE,
      Host: config.host,
      'X-Content-Sha256': contentSha,
      'X-Date': xDate,
    },
  };
}

function isSuccessCode(code: unknown): boolean {
  return (
    code === undefined ||
    code === null ||
    code === 0 ||
    code === '0' ||
    code === 200 ||
    code === '200' ||
    code === 10000 ||
    code === '10000'
  );
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const direct =
    record.message ?? record.msg ?? record.error ?? record.fail_reason ?? record.reason;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }
  const nested = record.data;
  if (nested && typeof nested === 'object') {
    return extractErrorMessage(nested);
  }
  return undefined;
}

async function callVolcengineAction<TData extends object>(
  action: string,
  payload: Record<string, unknown>,
  config: VolcengineSeedreamConfig,
): Promise<VolcengineApiResponse<TData>> {
  const signed = buildVolcengineSignedRequest(action, payload, config);
  let response: Response;

  try {
    response = await fetch(signed.url, {
      method: 'POST',
      headers: signed.headers,
      body: signed.body,
    });
  } catch (error) {
    throw new Error(`Volcengine request failed: ${String(error)}`);
  }

  const text = await response.text();
  let json: VolcengineApiResponse<TData>;

  try {
    json = text ? (JSON.parse(text) as VolcengineApiResponse<TData>) : {};
  } catch {
    throw new Error(
      `Volcengine returned a non-JSON response (${response.status}): ${text.slice(0, 200)}`,
    );
  }

  if (!response.ok || !isSuccessCode(json.code)) {
    const message =
      extractErrorMessage(json) ??
      `Volcengine ${action} failed with status ${response.status || 'unknown'}`;
    throw new Error(message);
  }

  return json;
}

function extractTaskId(data?: SubmitTaskData): string | undefined {
  return data?.task_id ?? data?.taskId ?? data?.id;
}

function normalizeStatus(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function isPendingStatus(status: string): boolean {
  return (
    status === '' ||
    status === 'queued' ||
    status === 'pending' ||
    status === 'running' ||
    status === 'processing' ||
    status === 'submitted' ||
    status === 'created' ||
    status === 'in_progress'
  );
}

function isFailureStatus(status: string): boolean {
  return (
    status === 'failed' ||
    status === 'error' ||
    status === 'canceled' ||
    status === 'cancelled' ||
    status === 'timeout'
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectImageUrls(data?: AsyncResultData): string[] {
  const urls = data?.image_urls ?? data?.images;
  return Array.isArray(urls) ? urls.filter((item): item is string => typeof item === 'string') : [];
}

function collectVideoUrls(data?: AsyncResultData): string[] {
  const urls = [...(data?.video_urls ?? [])];
  if (data?.video_url) urls.unshift(data.video_url);
  return urls.filter((item): item is string => typeof item === 'string');
}

export async function generateVolcengineImage(
  input: GenerateVolcengineImageInput,
): Promise<{ url: string; urls: string[]; taskId: string }> {
  const config = resolveVolcengineSeedreamConfig({
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    host: input.host,
    baseUrl: input.baseUrl,
    region: input.region,
    service: input.service,
    version: input.version,
    imageModel: input.model ?? input.imageModel,
    imageReqKey: input.reqKey ?? input.imageReqKey,
    videoModel: input.videoModel,
    videoReqKey: input.videoReqKey,
  });

  const submitPayload: Record<string, unknown> = {
    model: input.model ?? config.imageModel,
    req_key: input.reqKey ?? config.imageReqKey,
    prompt: input.prompt,
    size: input.size ?? '1024x1024',
    force_single: input.forceSingle ?? true,
  };
  if (input.imageUrls?.length) {
    submitPayload.image_urls = input.imageUrls;
  }

  const submitResult = await callVolcengineAction<SubmitTaskData>(
    'CVSync2AsyncSubmitTask',
    submitPayload,
    config,
  );
  const taskId = extractTaskId(submitResult.data);
  if (!taskId) {
    throw new Error('Volcengine submit response missing task_id');
  }

  const maxAttempts = input.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await delay(pollIntervalMs);
    }

    const pollResult = await callVolcengineAction<AsyncResultData>(
      'CVSync2AsyncGetResult',
      { task_id: taskId },
      config,
    );
    const data = pollResult.data;
    const urls = collectImageUrls(data);
    if (urls.length > 0) {
      return { url: urls[0], urls, taskId };
    }

    const status = normalizeStatus(data?.status ?? data?.task_status ?? data?.state);
    if (isFailureStatus(status)) {
      throw new Error(extractErrorMessage(data) ?? `Volcengine image task ${status}`);
    }
    if (!isPendingStatus(status)) {
      const message = extractErrorMessage(data);
      if (message) {
        throw new Error(message);
      }
    }
  }

  throw new Error('Volcengine image generation timed out while waiting for task result');
}

export async function generateVolcengineVideo(
  input: GenerateVolcengineVideoInput,
): Promise<{ url: string; urls: string[]; taskId: string }> {
  const config = resolveVolcengineSeedreamConfig({
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    host: input.host,
    baseUrl: input.baseUrl,
    region: input.region,
    service: input.service,
    version: input.version,
    imageModel: input.imageModel,
    imageReqKey: input.imageReqKey,
    videoModel: input.model ?? input.videoModel,
    videoReqKey: input.reqKey ?? input.videoReqKey,
  });

  const submitPayload: Record<string, unknown> = {
    model: input.model ?? config.videoModel,
    req_key: input.reqKey ?? config.videoReqKey ?? config.imageReqKey,
    prompt: input.prompt,
  };
  if (input.duration != null) submitPayload.duration = input.duration;
  if (input.resolution) submitPayload.resolution = input.resolution;
  if (input.aspectRatio) submitPayload.aspect_ratio = input.aspectRatio;
  if (input.imageUrls?.length) submitPayload.image_urls = input.imageUrls.slice(0, 1);

  const submitResult = await callVolcengineAction<SubmitTaskData>(
    'CVSync2AsyncSubmitTask',
    submitPayload,
    config,
  );
  const taskId = extractTaskId(submitResult.data);
  if (!taskId) {
    throw new Error('Volcengine submit response missing task_id');
  }

  const maxAttempts = input.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await delay(pollIntervalMs);
    }

    const pollResult = await callVolcengineAction<AsyncResultData>(
      'CVSync2AsyncGetResult',
      { task_id: taskId },
      config,
    );
    const data = pollResult.data;
    const urls = collectVideoUrls(data);
    if (urls.length > 0) {
      return { url: urls[0], urls, taskId };
    }

    const status = normalizeStatus(data?.status ?? data?.task_status ?? data?.state);
    if (isFailureStatus(status)) {
      throw new Error(extractErrorMessage(data) ?? `Volcengine video task ${status}`);
    }
    if (!isPendingStatus(status)) {
      const message = extractErrorMessage(data);
      if (message) {
        throw new Error(message);
      }
    }
  }

  throw new Error('Volcengine video generation timed out while waiting for task result');
}

export async function testVolcengineCredentials(
  input: VolcengineSeedreamConfigInput = {},
): Promise<void> {
  const config = resolveVolcengineSeedreamConfig(input);
  try {
    await callVolcengineAction<AsyncResultData>(
      'CVSync2AsyncGetResult',
      { task_id: '__openpencil_healthcheck__' },
      config,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/task|result|not\s*found|missing|invalid\s*task/i.test(message)) {
      return;
    }
    throw error;
  }
}
