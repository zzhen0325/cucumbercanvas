import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildVolcengineSignedRequest,
  generateVolcengineImage,
  generateVolcengineVideo,
  resolveVolcengineSeedreamConfig,
} from '../utils/volcengine-seedream';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('volcengine-seedream', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('resolves credentials and defaults from either env prefix', () => {
    vi.stubEnv('CUCUMBER_SEEDREAM_ACCESS_KEY_ID', 'seed-ak');
    vi.stubEnv('CUCUMBER_SEEDREAM_SECRET_ACCESS_KEY', 'seed-sk');
    vi.stubEnv('CUCUMBER_SEEDREAM_HOST', 'custom.volcengineapi.com');
    vi.stubEnv('CUCUMBER_SEEDREAM_REGION', 'cn-beijing');
    vi.stubEnv('CUCUMBER_SEEDREAM_SERVICE', 'vision');
    vi.stubEnv('CUCUMBER_SEEDREAM_VERSION', '2025-01-01');
    vi.stubEnv('CUCUMBER_SEEDREAM_REQ_KEY', 'custom-image-req');
    vi.stubEnv('CUCUMBER_SEEDREAM_VIDEO_REQ_KEY', 'custom-video-req');

    const config = resolveVolcengineSeedreamConfig();

    expect(config).toMatchObject({
      accessKeyId: 'seed-ak',
      secretAccessKey: 'seed-sk',
      host: 'custom.volcengineapi.com',
      region: 'cn-beijing',
      service: 'vision',
      version: '2025-01-01',
      imageReqKey: 'custom-image-req',
      videoReqKey: 'custom-video-req',
    });
  });

  it('builds HMAC-SHA256 signed headers for the visual API', () => {
    const request = buildVolcengineSignedRequest(
      'CVSync2AsyncSubmitTask',
      {
        model: 'bytedance/seedream-4.6',
        req_key: 'jimeng_seedream46_cvtob',
        prompt: 'test prompt',
        size: '1024x1024',
        force_single: true,
      },
      {
        accessKeyId: 'ak-test',
        secretAccessKey: 'sk-test',
        host: 'visual.volcengineapi.com',
        region: 'cn-north-1',
        service: 'cv',
        version: '2022-08-31',
        imageModel: 'bytedance/seedream-4.6',
        imageReqKey: 'jimeng_seedream46_cvtob',
        videoModel: 'bytedance/seedream-video',
      },
      new Date('2026-05-23T12:34:56.000Z'),
    );

    expect(request.url).toBe(
      'https://visual.volcengineapi.com/?Action=CVSync2AsyncSubmitTask&Version=2022-08-31',
    );
    expect(request.headers).toMatchObject({
      Host: 'visual.volcengineapi.com',
      'Content-Type': 'application/json',
      'X-Date': '20260523T123456Z',
    });
    expect(request.headers['X-Content-Sha256']).toHaveLength(64);
    expect(request.headers.Authorization).toContain('HMAC-SHA256 Credential=ak-test/');
    expect(request.headers.Authorization).toContain(
      'SignedHeaders=content-type;host;x-content-sha256;x-date',
    );
    expect(request.headers.Authorization).toContain('Signature=');
  });

  it('submits and polls image tasks until image_urls are available', async () => {
    vi.stubEnv('CUCUMBER_VOLCENGINE_ACCESS_KEY_ID', 'env-ak');
    vi.stubEnv('CUCUMBER_VOLCENGINE_SECRET_ACCESS_KEY', 'env-sk');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 10000,
          message: 'Success',
          data: { task_id: 'task-image-1' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 10000,
          message: 'Success',
          data: { status: 'processing' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 10000,
          message: 'Success',
          data: {
            status: 'done',
            image_urls: ['https://cdn.example.com/result.png'],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateVolcengineImage({
      prompt: 'draw a product mockup',
      size: '1024x1024',
      pollIntervalMs: 0,
      maxPollAttempts: 3,
    });

    expect(result).toEqual({
      url: 'https://cdn.example.com/result.png',
      urls: ['https://cdn.example.com/result.png'],
      taskId: 'task-image-1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const submitCall = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(submitCall[0]).toContain('Action=CVSync2AsyncSubmitTask');
    expect(submitCall[1].headers).toMatchObject({
      Host: 'visual.volcengineapi.com',
      'Content-Type': 'application/json',
    });
  });

  it('uses the video req key when generating video tasks', async () => {
    vi.stubEnv('CUCUMBER_VOLCENGINE_ACCESS_KEY_ID', 'env-ak');
    vi.stubEnv('CUCUMBER_VOLCENGINE_SECRET_ACCESS_KEY', 'env-sk');
    vi.stubEnv('CUCUMBER_SEEDREAM_VIDEO_REQ_KEY', 'jimeng_video_custom');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 10000,
          message: 'Success',
          data: { task_id: 'task-video-1' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 10000,
          message: 'Success',
          data: {
            status: 'done',
            video_url: 'https://cdn.example.com/video.mp4',
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateVolcengineVideo({
      prompt: 'animate the poster',
      duration: 5,
      resolution: '720p',
      aspectRatio: '16:9',
      pollIntervalMs: 0,
      maxPollAttempts: 2,
    });

    expect(result.url).toBe('https://cdn.example.com/video.mp4');

    const submitCall = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(submitCall[1].body)) as Record<string, unknown>;
    expect(body.req_key).toBe('jimeng_video_custom');
    expect(body.model).toBe('bytedance/seedream-video');
  });
});
