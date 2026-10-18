/**
 * 课堂配图随上下文进模型（#123 验收①的管道段）。
 *
 * 形态决策（2026-10-18 实测）：历史消息保持**纯文本**，历史配图统一附加到**本轮 user 消息**尾部。
 * 为什么不挂在历史 assistant 消息上：平台上游对 assistant 消息里的 image_url 内容块返回
 * 400 invalid_request（`npm run vision:probe -- --history-image` 可复现），user 消息上的图片块正常。
 *
 * 判据侧（toWireMessages）永远只有文本：它喂 evaluateByCriteria/evaluateByProfile 这类确定性检查。
 */
import {
  collectHistoryImages,
  toWireMessages,
  type TeachingTurnInput,
} from '../index';

const png = (n: number) => `data:image/png;base64,${'C'.repeat(n)}`;

const msg = (over: Record<string, unknown>) => ({ role: 'assistant', content: 'x', ...over }) as unknown as TeachingTurnInput['messages'][number];

describe('collectHistoryImages（配图随上下文进模型）', () => {
  it('空历史 / 无图历史 → 空数组（请求形态与改动前一致）', () => {
    expect(collectHistoryImages([])).toEqual([]);
    expect(collectHistoryImages([msg({ role: 'user', content: '老师，我没懂' })])).toEqual([]);
  });

  it('按历史顺序收集，图片总量保留**最近**的（旧图退化为纯文本，正文不丢）', () => {
    const images = collectHistoryImages([
      msg({ content: '第一张图', images: [{ url: png(1) }] }),
      msg({ role: 'user', content: '懂了' }),
      msg({ content: '第二张图', images: [{ url: png(2) }] }),
      msg({ content: '第三张图', images: [{ url: png(3) }] }),
      msg({ content: '第四张图', images: [{ url: png(4) }] }),
      msg({ content: '第五张图', images: [{ url: png(5) }] }),
    ]);
    // 上限 4：最旧的「第一张图」被丢出，其余按时间序
    expect(images.map((image) => image.url)).toEqual([png(2), png(3), png(4), png(5)]);
  });

  it('caption 一并带上（供模型把图与板书文字对上）', () => {
    const images = collectHistoryImages([
      msg({ content: '看这张表', images: [{ url: png(6), caption: '三列核对框架' }] }),
    ]);
    expect(images[0]).toEqual({ url: png(6), caption: '三列核对框架' });
  });

  it('toWireMessages 不受配图影响（判据侧依旧纯文本）', () => {
    const out = toWireMessages([
      msg({ role: 'assistant', content: '看这张表', images: [{ url: png(7) }] }),
    ]);
    expect(out).toEqual([{ role: 'assistant', content: '看这张表' }]);
  });
});
