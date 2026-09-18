jest.mock('../../../services/image', () => ({
  generateImages: jest.fn(),
}));

import { generateImages } from '../../../services/image';
import { ImageError } from '../../../services/image/types';
import { executeTextToImage, textToImageDefinition } from '../index';

const generateMock = generateImages as jest.Mock;

describe('text-to-image Skill', () => {
  beforeEach(() => {
    generateMock.mockReset();
  });

  it('定义登记为 generation 类 handler-only 能力', () => {
    expect(textToImageDefinition.name).toBe('text-to-image');
    expect(textToImageDefinition.category).toBe('generation');
    expect(textToImageDefinition.status).toBe('working');
    expect(textToImageDefinition.capabilities).toContain('text-to-image');
  });

  it('prompt 为空时返回 TEXT_TO_IMAGE_PROMPT_REQUIRED（不触达 service）', async () => {
    const result = await executeTextToImage({ prompt: '   ' });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TEXT_TO_IMAGE_PROMPT_REQUIRED');
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('成功时透传 provider / attempts / model / images', async () => {
    generateMock.mockResolvedValue({
      provider: 'agnes',
      attempts: ['agnes'],
      model: 'agnes-image-2.5-flash',
      latencyMs: 9500,
      images: [{ url: 'http://cdn.example/a.png', provider: 'agnes' }],
    });

    const result = await executeTextToImage({ prompt: '一只红苹果', size: '1024x1024' });

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      provider: 'agnes',
      model: 'agnes-image-2.5-flash',
      attempts: ['agnes'],
    });
    expect(result.output?.images).toHaveLength(1);
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '一只红苹果', size: '1024x1024' }),
      expect.any(Object)
    );
  });

  it('已知 ImageError 映射为可读文案', async () => {
    generateMock.mockRejectedValue(new ImageError('IMAGE_PROVIDER_NOT_CONFIGURED', 'raw'));

    const result = await executeTextToImage({ prompt: 'x' });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('IMAGE_PROVIDER_NOT_CONFIGURED');
    expect(result.error?.message).toContain('IMAGE_API_URL');
  });

  it('未知异常回落为 TEXT_TO_IMAGE_EXECUTION_FAILED（与 web-search / web-fetch 同一口径）', async () => {
    generateMock.mockRejectedValue(new Error('boom'));

    const result = await executeTextToImage({ prompt: 'x' });

    expect(result.error?.code).toBe('TEXT_TO_IMAGE_EXECUTION_FAILED');
    expect(result.error?.message).toBe('文生图执行失败');
  });
});
