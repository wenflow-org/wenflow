/**
 * payload-prefix 门禁的首键解析（`firstKeyOf`）：
 *
 * 关键回归：遥测瘦身（`slimPromptCallRow` 把 >4K 的 userPayload 换成 `{__slim,bytes,sha256,head}`）
 * 之后，护栏若直接取 `Object.keys(parsed)[0]` 会恒得 `__slim` ⇒ 6 个 skill 全判违规
 * （实测 2026-10-15：teaching-turn / stage-designer / path-reviewer / adaptive-guidance-copy /
 * virtual-learner-learn-turn-simulator / virtual-learner-goal-dialogue-simulator）。
 * 修法 = 遇标记时从 `head`（原 JSON 前 400 字符）还原首键；本用例钉住该行为与边界。
 */
jest.mock('../../config/database', () => ({ __esModule: true, default: {} }));

import { firstKeyOf } from '../check-payload-prefix-stability';

describe('firstKeyOf（含瘦身标记解包）', () => {
  it('普通对象：取首键（按插入顺序，不是字母序）', () => {
    expect(firstKeyOf(JSON.stringify({ scenario: 1, learner: 2 }))).toBe('scenario');
    expect(firstKeyOf(JSON.stringify({ learner: 1, scenario: 2 }))).toBe('learner');
  });

  it('瘦身标记：从 head 还原真实首键（不是 __slim）', () => {
    const original = JSON.stringify({ scenario: { big: 'x'.repeat(9000) }, learner: {} });
    const slim = JSON.stringify({
      __slim: true,
      bytes: original.length,
      sha256: 'abc123',
      head: original.slice(0, 400),
    });
    expect(firstKeyOf(slim)).toBe('scenario');
  });

  it('瘦身标记：head 缺失或非字符串 → undefined（不误判为 __slim 违规）', () => {
    expect(firstKeyOf(JSON.stringify({ __slim: true, bytes: 1 }))).toBeUndefined();
    expect(firstKeyOf(JSON.stringify({ __slim: true, head: 42 }))).toBeUndefined();
  });

  it('head 里的转义键名按原样还原', () => {
    const slim = JSON.stringify({ __slim: true, head: '{"a\\"b":1,"c":2}' });
    expect(firstKeyOf(slim)).toBe('a"b');
  });

  it('非对象载荷 / 非法 JSON / 非字符串 → undefined（护栏不抛错）', () => {
    expect(firstKeyOf('[1,2,3]')).toBeUndefined();
    expect(firstKeyOf('{不是 JSON')).toBeUndefined();
    expect(firstKeyOf({ scenario: 1 })).toBeUndefined();
    expect(firstKeyOf('')).toBeUndefined();
    expect(firstKeyOf(null)).toBeUndefined();
  });
});
