jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { resolveImageProviderOrder } from '../providers';
import { generateImages } from '../image.service';
import { ImageError } from '../types';
import type { GeneratedImage, ImageProvider, ImageProviderId, ImageProviderResult, ImageRequest } from '../types';

function image(provider: ImageProviderId, index = 0): GeneratedImage {
  return { url: `http://cdn.example/${index}.png`, provider };
}

function fakeProvider(
  id: ImageProviderId,
  generateImpl: (request: ImageRequest) => Promise<ImageProviderResult>,
  configured = true
): ImageProvider {
  return { id, isConfigured: () => configured, generate: jest.fn(generateImpl) };
}

describe('generateImages 编排', () => {
  it('入参不合法时抛 IMAGE_REQUEST_INVALID（不触达 provider）', async () => {
    const provider = fakeProvider('agnes', async () => ({ images: [image('agnes')], model: 'm' }));

    await expect(
      generateImages({ prompt: '' }, { providers: { agnes: provider } })
    ).rejects.toMatchObject({ code: 'IMAGE_REQUEST_INVALID' });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('未知字段被 .strict() 拒绝', async () => {
    await expect(
      generateImages({ prompt: 'x', foo: 1 } as unknown as ImageRequest)
    ).rejects.toMatchObject({ code: 'IMAGE_REQUEST_INVALID' });
  });

  it('IMAGE_PROVIDER 配置未知 id 时抛 IMAGE_PROVIDER_UNKNOWN', () => {
    expect(() => resolveImageProviderOrder('agnes,no-such')).toThrow(/未知的文生图 provider/);
  });

  it('无已配置 provider 时抛 IMAGE_PROVIDER_NOT_CONFIGURED', async () => {
    const provider = fakeProvider('agnes', async () => ({ images: [image('agnes')], model: 'm' }), false);

    await expect(
      generateImages({ prompt: 'x' }, { providers: { agnes: provider } })
    ).rejects.toMatchObject({ code: 'IMAGE_PROVIDER_NOT_CONFIGURED' });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('成功时返回图片、模型与尝试链', async () => {
    const provider = fakeProvider('agnes', async () => ({ images: [image('agnes')], model: 'agnes-image-2.5-flash' }));

    const result = await generateImages(
      { prompt: '一只红苹果' },
      { providers: { agnes: provider } }
    );

    expect(result.provider).toBe('agnes');
    expect(result.model).toBe('agnes-image-2.5-flash');
    expect(result.attempts).toEqual(['agnes']);
    expect(result.images).toHaveLength(1);
  });

  it('单 provider 失败时保留上游原始错误码（不压成 ALL_FAILED）', async () => {
    const provider = fakeProvider('agnes', async () => {
      throw new ImageError('IMAGE_UPSTREAM_TIMEOUT', '超时');
    });

    await expect(
      generateImages({ prompt: 'x' }, { providers: { agnes: provider } })
    ).rejects.toMatchObject({ code: 'IMAGE_UPSTREAM_TIMEOUT' });
  });

  it('前置 provider 失败时降级到链上下一个 provider', async () => {
    // 目前仅 agnes 一个已实现 provider；用注入的假链验证降级逻辑本身（新增 provider 时可直接复用）
    const failing = fakeProvider('agnes', async () => {
      throw new ImageError('IMAGE_UPSTREAM_TIMEOUT', '超时');
    });
    const succeeding: ImageProvider = {
      id: 'agnes',
      isConfigured: () => true,
      generate: jest.fn(async (): Promise<ImageProviderResult> => ({
        images: [{ url: 'http://cdn.example/fake.png', provider: 'agnes' }],
        model: 'm',
      })),
    };

    const result = await generateImages(
      { prompt: 'x' },
      {
        providerOrder: ['agnes', 'fake'] as unknown as ImageProviderId[],
        providers: { agnes: failing, fake: succeeding } as unknown as Partial<Record<ImageProviderId, ImageProvider>>,
      }
    );

    expect(result.provider).toBe('fake');
    expect(result.attempts).toEqual(['agnes', 'fake']);
    expect(failing.generate).toHaveBeenCalledTimes(1);
    expect(succeeding.generate).toHaveBeenCalledTimes(1);
  });
});
