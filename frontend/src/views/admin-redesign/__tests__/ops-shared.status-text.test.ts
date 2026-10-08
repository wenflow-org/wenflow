/**
 * opsShared 学习路径状态本地化：
 * 路径状态曾是「两份字典」——opsShared 自己一份只含四个值，命中不了就原样吐英文，
 * 而全局 statusText.ts 已经有一份完整的枚举字典。2026-10-08 走查在「学习路径」
 * 状态列看到裸的 abandoned（灰色胶囊），与同列中文状态及图例的五个中文口径都对不上。
 */
import { describe, expect, it } from 'vitest';
import { statusText, statusBadge } from '../opsShared';

describe('opsShared 路径状态本地化', () => {
  it('路径域文案优先：active 在路径域是「学习中」，不是全局字典的「进行中」', () => {
    expect(statusText('active')).toBe('学习中');
    expect(statusText('completed')).toBe('已完成');
    expect(statusText('failed')).toBe('生成失败');
    expect(statusText('archived')).toBe('已下线');
  });

  it('表里没有的取值落回全局字典，不再漏出原始英文枚举', () => {
    expect(statusText('abandoned')).toBe('已放弃');
    expect(statusText('stopped')).toBe('已停止');
    expect(statusText('cancelled')).toBe('已取消');
  });

  it('全局字典会归一大小写', () => {
    expect(statusText('ABANDONED')).toBe('已放弃');
  });

  it('彻底未知的取值原样返回，不吞掉信息', () => {
    expect(statusText('brand_new_state')).toBe('brand_new_state');
  });

  it('abandoned 用中性徽章，与「已下线」同色而非默认落空', () => {
    expect(statusBadge('abandoned')).toBe('mk-badge--muted');
    expect(statusBadge('archived')).toBe('mk-badge--muted');
  });
});
