/**
 * goal 入口条文案（2026-11-08 两修后口径）。
 *
 * 确认入口必须在场（2026-11-08 用户裁定）：模型 proposing 文本指引「你点确认」，入口条若只给
 * 「查看方案」，确认按钮被藏进面板，用户看不到确认入口、只好打字说「方案可行」——可他连方案
 * 全文都还没看过。打字裁决是对话流的次通道，入口条「查看并确认」→ 面板内确认按钮是主通道。
 * 唯一动态项是未答自测计数（代码可判的结构事实）。
 */
import { describe, expect, it } from 'vitest';
import { proposalEntryCopy } from '../goalStageCopy';

describe('proposalEntryCopy：确认入口恒定在场', () => {
  it('无未答题：无提示句，按钮表达「看完即可确认」的动作闭环（2026-11-05 裁定口径）', () => {
    const copy = proposalEntryCopy(0);
    expect(copy.hint).toBe('');
    expect(copy.button).toBe('查看并确认');
  });

  it('无参数调用（默认无题）与显式 0 同文案', () => {
    expect(proposalEntryCopy()).toEqual(proposalEntryCopy(0));
  });
});

describe('proposalEntryCopy：有未答自测时把这件事挑明（2026-11-02 业务口径）', () => {
  it('有未答题：提示写明还有几道可选自测，按钮不变', () => {
    const copy = proposalEntryCopy(2);
    expect(copy.hint).toContain('2 道快速自测');
    expect(copy.hint).toContain('校准起点');
    expect(copy.button).toBe('查看并确认');
  });
});
