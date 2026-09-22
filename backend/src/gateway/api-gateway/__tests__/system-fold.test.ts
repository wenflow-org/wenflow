/**
 * 上游 system 消息折叠回归（2026-09-22 事故）。
 *
 * 事故：平台 zijian 网关静默丢弃 role:'system'，所有 skill 的系统提示词从未到达模型；
 * 直连实测（带 1467 字 system 与不带 system 的 prompt_tokens 完全相同）与
 * "同一约束写进 user 则被完美遵从"双向证实。表现为纯标注类 skill 集体把结构化输入
 * 当文档做总结（concept-consolidator 6/6 失败、kc-mapper 34 连败）。
 *
 * 本测试锁死折叠语义：内容不丢、只进首条 user、其余消息顺序不变、无 system 时不拷贝。
 */
import { foldSystemMessagesIntoUser } from '../executor';

describe('foldSystemMessagesIntoUser（上游不支持 system 角色的兼容层）', () => {
  it('system 内容前置进首条 user，并保留其余消息顺序', () => {
    const out = foldSystemMessagesIntoUser([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'U1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'U2' },
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'SYS\n\n---\nU1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'U2' },
    ]);
  });

  it('多条 system 按序拼接', () => {
    const out = foldSystemMessagesIntoUser([
      { role: 'system', content: 'S1' },
      { role: 'system', content: 'S2' },
      { role: 'user', content: 'U' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('S1\n\nS2\n\n---\nU');
  });

  it('无 system 时原样返回（引用不变，不做无谓拷贝）', () => {
    const input = [{ role: 'user' as const, content: 'U' }];
    expect(foldSystemMessagesIntoUser(input)).toBe(input);
  });

  it('空白 system 视为不存在', () => {
    const input = [{ role: 'system' as const, content: '   ' }, { role: 'user' as const, content: 'U' }];
    expect(foldSystemMessagesIntoUser(input)).toBe(input);
  });

  it('只有 system（无 user）时生成一条 user 承载', () => {
    const out = foldSystemMessagesIntoUser([{ role: 'system', content: 'SYS' }]);
    expect(out).toEqual([{ role: 'user', content: 'SYS' }]);
  });

  it('空数组 / 非数组安全返回', () => {
    expect(foldSystemMessagesIntoUser([])).toEqual([]);
    expect(foldSystemMessagesIntoUser(undefined as any)).toBeUndefined();
  });
});
