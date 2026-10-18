/**
 * 压缩服务保留课堂配图（#123）：图随最近窗口进模型上下文；
 * 图片 token 估算按**常数**折算（不能按 base64 字符数——否则每节课都被顶进压缩路径）。
 */
import { teachingContextCompressionService } from '../TeachingContextCompressionService';

function makeMessage(role: 'user' | 'assistant', content: string, i: number, images?: any[]) {
  return {
    role,
    content,
    timestamp: new Date().toISOString(),
    textLength: content.length,
    id: `m${i}`,
    ...(images ? { images } : {}),
  } as any;
}

const png = (n: number) => `data:image/png;base64,${'D'.repeat(n)}`;

describe('TeachingContextCompressionService × 配图（#123）', () => {
  it('短会话：带图消息原样保留 images', () => {
    const result = teachingContextCompressionService.compress([
      makeMessage('user', '老师好', 0),
      makeMessage('assistant', '看这张表', 1, [{ url: png(10), caption: '核对框架', prompt: 'p', provider: 'x', model: 'y', kind: null, createdAt: '' }]),
    ]);
    expect(result.compressed).toBe(false);
    expect(result.messages[1].images?.[0]?.url).toBe(png(10));
    expect(result.messages[0].images).toBeUndefined();
  });

  it('图片不计入长文本估计：一张大图不会把短会话顶进压缩路径', () => {
    const result = teachingContextCompressionService.compress([
      makeMessage('user', '老师好', 0),
      // 体积上一张 2MB 级 data URL（按字符数估 ≈ 50 万 token，若按字符算必然误触发压缩）
      makeMessage('assistant', '看这张表', 1, [{ url: png(2_000_000), caption: null, prompt: '', provider: '', model: '', kind: null, createdAt: '' }]),
    ]);
    expect(result.compressed).toBe(false);
    expect(result.estimatedTokens).toBeLessThan(5000);
  });

  it('压缩路径：最近窗口内的图保留、更早的消息折叠进摘要（图随之消失）', () => {
    const longText = 'x'.repeat(4000);
    const messages = [
      ...Array.from({ length: 40 }, (_, i) => makeMessage(i % 2 === 0 ? 'user' : 'assistant', longText, i)),
      makeMessage('assistant', '这是最近带图的消息', 40, [{ url: png(11), caption: '板书', prompt: '', provider: '', model: '', kind: null, createdAt: '' }]),
    ];
    const result = teachingContextCompressionService.compress(messages);
    expect(result.compressed).toBe(true);
    const withImages = result.messages.filter((m) => Array.isArray(m.images) && m.images.length > 0);
    expect(withImages).toHaveLength(1);
    expect(withImages[0].images?.[0]?.url).toBe(png(11));
  });

  it('空 images 数组不产生 images 字段（请求形态保持最简）', () => {
    const result = teachingContextCompressionService.compress([
      makeMessage('assistant', '无图', 0, []),
    ]);
    expect(result.messages[0].images).toBeUndefined();
  });
});
