jest.mock('../../../../utils/safe-http', () => {
  class UnsafeUrlError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UnsafeUrlError';
    }
  }
  return { safeHttpRequest: jest.fn(), UnsafeUrlError };
});

import { safeHttpRequest } from '../../../../utils/safe-http';
import {
  AgnesImageProvider,
  buildAgnesImageBody,
  normalizeAgnesImageResult,
  type AgnesImageConfig,
} from '../agnes';

const requestMock = safeHttpRequest as jest.Mock;

const CONFIG: AgnesImageConfig = {
  endpoint: 'http://gw.example/v1/images/generations',
  apiKey: 'sk-test-key',
  model: 'agnes-image-2.5-flash',
  timeoutMs: 180_000,
};

function okResponse(data: unknown) {
  return { status: 200, statusText: 'OK', headers: {}, url: '', data };
}

describe('AgnesImageProvider', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('未配置 endpoint / apiKey 时 isConfigured=false，调用抛 IMAGE_PROVIDER_NOT_CONFIGURED', async () => {
    const provider = new AgnesImageProvider({ ...CONFIG, apiKey: '' });

    expect(provider.isConfigured()).toBe(false);
    await expect(provider.generate({ prompt: 'x' })).rejects.toMatchObject({
      code: 'IMAGE_PROVIDER_NOT_CONFIGURED',
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('POST JSON + Bearer 认证，body 映射 model / prompt / n 与可选 size / response_format', async () => {
    requestMock.mockResolvedValue(okResponse({ data: [{ url: 'http://cdn.example/a.png' }] }));
    const provider = new AgnesImageProvider(CONFIG);

    await provider.generate({ prompt: '一只红苹果', size: '1024x1024', responseFormat: 'b64_json' });

    const [url, options] = requestMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('http://gw.example/v1/images/generations');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-key');
    expect(options.privateNetworkPolicy).toBe('public-only');
    expect(options.body).toEqual({
      model: 'agnes-image-2.5-flash',
      prompt: '一只红苹果',
      n: 1,
      size: '1024x1024',
      // 实测本网关忽略 extra_body.response_format 与 return_base64，b64 仍走顶层
      response_format: 'b64_json',
    });
  });

  it('档位式 size + ratio 透传；response_format=url（默认）不落任何字段', async () => {
    requestMock.mockResolvedValue(okResponse({ data: [{ url: 'http://cdn.example/a.png' }] }));
    const provider = new AgnesImageProvider(CONFIG);

    await provider.generate({ prompt: '一条位置线：甲在前、乙在后', size: '1K', ratio: '16:9', responseFormat: 'url' });

    const [, options] = requestMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.body).toEqual({
      model: 'agnes-image-2.5-flash',
      prompt: '一条位置线：甲在前、乙在后',
      n: 1,
      size: '1K',
      ratio: '16:9',
    });
  });

  it('显式 model 覆盖默认模型', async () => {
    requestMock.mockResolvedValue(okResponse({ data: [{ url: 'http://cdn.example/a.png' }] }));
    const provider = new AgnesImageProvider(CONFIG);

    const result = await provider.generate({ prompt: 'x', model: 'agnes-image-2.0-flash' });

    expect(result.model).toBe('agnes-image-2.0-flash');
    expect((requestMock.mock.calls[0][1] as Record<string, unknown>).body).toMatchObject({
      model: 'agnes-image-2.0-flash',
    });
  });

  it('n>1 抛 IMAGE_PROVIDER_UNSUPPORTED（上游仅支持 n=1），不发请求', () => {
    expect(() => buildAgnesImageBody({ prompt: 'x', n: 2 }, CONFIG.model)).toThrow(
      /不支持 n>1/
    );
  });

  it('归一化：url 与 b64_json 两侧取非空侧，全空条目丢弃', () => {
    const images = normalizeAgnesImageResult({
      data: [
        { url: 'http://cdn.example/a.png', b64_json: '', revised_prompt: 'rewritten' },
        { url: '', b64_json: 'QUJD' },
        { url: '', b64_json: '' },
      ],
    });

    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({
      url: 'http://cdn.example/a.png',
      b64Json: undefined,
      revisedPrompt: 'rewritten',
      provider: 'agnes',
    });
    expect(images[1]).toMatchObject({ url: undefined, b64Json: 'QUJD' });
  });

  it('非 2xx 抛 IMAGE_UPSTREAM_HTTP_ERROR 并带上游 message', async () => {
    requestMock.mockResolvedValue({
      status: 403,
      statusText: 'Forbidden',
      headers: {},
      url: '',
      data: { error: { message: '该令牌无权访问模型 x' } },
    });
    const provider = new AgnesImageProvider(CONFIG);

    await expect(provider.generate({ prompt: 'x' })).rejects.toMatchObject({
      code: 'IMAGE_UPSTREAM_HTTP_ERROR',
      status: 403,
    });
  });

  it('2xx 但无可用图片条目抛 IMAGE_EMPTY_RESULT', async () => {
    requestMock.mockResolvedValue(okResponse({ data: [{ url: '', b64_json: '' }] }));
    const provider = new AgnesImageProvider(CONFIG);

    await expect(provider.generate({ prompt: 'x' })).rejects.toMatchObject({
      code: 'IMAGE_EMPTY_RESULT',
    });
  });
});
