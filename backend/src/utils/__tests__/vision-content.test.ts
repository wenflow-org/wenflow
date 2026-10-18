/**
 * 视觉内容块工具（#123）：URL 白名单 / 数量上限 / 纯文本回退 / 图片剥离。
 */
import {
  MAX_VISION_IMAGES_PER_MESSAGE,
  buildVisionContent,
  isVisionImageUrl,
  normalizeVisionImages,
  stripVisionImages,
} from '../vision-content';

const png = (n = 1) => `data:image/png;base64,${'B'.repeat(n)}`;

describe('isVisionImageUrl', () => {
  it('接受 data:image/*;base64 与 http(s)', () => {
    expect(isVisionImageUrl(png())).toBe(true);
    expect(isVisionImageUrl('https://example.com/a.png')).toBe(true);
    expect(isVisionImageUrl('http://example.com/a.jpg')).toBe(true);
  });

  it('拒绝其他形态（file/ftp/svg data URL/空值）', () => {
    expect(isVisionImageUrl('file:///etc/passwd')).toBe(false);
    expect(isVisionImageUrl('ftp://example.com/a.png')).toBe(false);
    expect(isVisionImageUrl('data:image/svg+xml;base64,AAA')).toBe(false);
    expect(isVisionImageUrl('data:image/png,AAA')).toBe(false);
    expect(isVisionImageUrl(undefined)).toBe(false);
    expect(isVisionImageUrl(123)).toBe(false);
  });
});

describe('normalizeVisionImages', () => {
  it('过滤非法 URL，保留合法顺序', () => {
    const out = normalizeVisionImages([{ url: png(1) }, { url: 'javascript:alert(1)' }, { url: 'https://a/b.png' }]);
    expect(out.map((image) => image.url)).toEqual([png(1), 'https://a/b.png']);
  });

  it('超过上限保留最近的若干张（越近越相关）', () => {
    const images = [1, 2, 3, 4, 5, 6].map((index) => ({ url: png(index) }));
    const out = normalizeVisionImages(images, { max: 3 });
    expect(out.map((image) => image.url)).toEqual([png(4), png(5), png(6)]);
  });

  it('默认上限生效且是单条消息粒度', () => {
    const images = Array.from({ length: MAX_VISION_IMAGES_PER_MESSAGE + 2 }, (_, index) => ({ url: png(index + 1) }));
    expect(normalizeVisionImages(images)).toHaveLength(MAX_VISION_IMAGES_PER_MESSAGE);
  });
});

describe('buildVisionContent', () => {
  it('无有效图片 → 返回原字符串（纯文本回退，请求形态不变）', () => {
    expect(buildVisionContent('正文', [])).toBe('正文');
    expect(buildVisionContent('正文', [{ url: 'nope' }])).toBe('正文');
    expect(buildVisionContent('正文', undefined)).toBe('正文');
  });

  it('文本在前、图片块依次在后；每张图前有标签行', () => {
    const out = buildVisionContent('正文', [{ url: png(2), caption: '板书表' }], { label: '课堂配图' });
    expect(out).toEqual([
      { type: 'text', text: '正文' },
      { type: 'text', text: '【课堂配图】板书表' },
      { type: 'image_url', image_url: { url: png(2) } },
    ]);
  });

  it('无 caption 时标签行不带冒号内容', () => {
    const out = buildVisionContent('正文', [{ url: png(3) }], { label: '配图' });
    expect(out).toEqual([
      { type: 'text', text: '正文' },
      { type: 'text', text: '【配图】' },
      { type: 'image_url', image_url: { url: png(3) } },
    ]);
  });
});

describe('stripVisionImages', () => {
  it('单个文本块 → 收敛回字符串', () => {
    expect(stripVisionImages([
      { type: 'text', text: '正文' },
      { type: 'image_url', image_url: { url: png(1) } },
    ])).toBe('正文');
  });

  it('多个文本块 → 保留文本块数组', () => {
    expect(stripVisionImages([
      { type: 'text', text: 'SYS' },
      { type: 'image_url', image_url: { url: png(1) } },
      { type: 'text', text: '正文' },
    ])).toEqual([
      { type: 'text', text: 'SYS' },
      { type: 'text', text: '正文' },
    ]);
  });

  it('纯图片数组 → 空串；字符串内容原样返回', () => {
    expect(stripVisionImages([{ type: 'image_url', image_url: { url: png(1) } }])).toBe('');
    expect(stripVisionImages('已经是文本')).toBe('已经是文本');
  });

  it('连带移除本模块生成的图片标签行（不留悬空【课堂配图】）', () => {
    expect(stripVisionImages([
      { type: 'text', text: '正文' },
      { type: 'text', text: '【课堂配图】三列表' },
      { type: 'image_url', image_url: { url: png(1) } },
    ])).toBe('正文');
  });

  it('不误删正文里自带的【…】段（只删与图片相邻的生成标签）', () => {
    expect(stripVisionImages([
      { type: 'text', text: '【本节要点】这是一段正文标题' },
      { type: 'image_url', image_url: { url: png(1) } },
      { type: 'text', text: '继续' },
    ])).toEqual([
      { type: 'text', text: '【本节要点】这是一段正文标题' },
      { type: 'text', text: '继续' },
    ]);
  });
});
