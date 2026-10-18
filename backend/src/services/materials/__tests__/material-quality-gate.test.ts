/**
 * 质量闸门策略单测（不触网）。
 *
 * 覆盖 2026-10-18 实测得到的四条分支：
 *   1) 缺陷类型（拦截页/导航页/乱码/视频页）→ 直接拒收，不看可用性分；
 *   2) dump（整本转储）→ 限量收录，而不是拒收；
 *   3) 可用性低于阈值 → 拒收；
 *   4) 主题一致性低于阈值 → 拒收（版本错配/同名不同主题）。
 */

import { classifyMaterialVerdict, sampleForGate } from '../material-quality-gate';
import type { DecisionAnswer } from '../../decision';

function answer(
  partial: Partial<Record<'usable' | 'defect' | 'topic_match' | 'has_prose', DecisionAnswer>>
): Record<string, DecisionAnswer> {
  return partial as Record<string, DecisionAnswer>;
}

describe('classifyMaterialVerdict', () => {
  it('拦截页：即使可用性分很高也拒收（缺陷类型优先）', () => {
    const verdict = classifyMaterialVerdict(
      answer({
        usable: { type: 'noul', noul: 0.99 },
        defect: { type: 'choice', choice: 'bot_wall' },
        topic_match: { type: 'noul', noul: 0.99 },
      })
    );
    expect(verdict.action).toBe('reject');
    expect(verdict.reason).toContain('bot_wall');
  });

  it('整本转储：限量收录而不是拒收', () => {
    const verdict = classifyMaterialVerdict(
      answer({
        usable: { type: 'noul', noul: 0.9 },
        defect: { type: 'choice', choice: 'dump' },
        topic_match: { type: 'noul', noul: 0.95 },
      })
    );
    expect(verdict.action).toBe('cap');
  });

  it('可用性低于阈值 → 拒收', () => {
    const verdict = classifyMaterialVerdict(
      answer({
        usable: { type: 'noul', noul: 0.2 },
        defect: { type: 'choice', choice: 'ok' },
        topic_match: { type: 'noul', noul: 0.9 },
      })
    );
    expect(verdict.action).toBe('reject');
    expect(verdict.reason).toContain('可用性');
  });

  it('主题一致性低于阈值 → 拒收（同名不同主题）', () => {
    const verdict = classifyMaterialVerdict(
      answer({
        usable: { type: 'noul', noul: 0.9 },
        defect: { type: 'choice', choice: 'ok' },
        topic_match: { type: 'noul', noul: 0.05 },
      })
    );
    expect(verdict.action).toBe('reject');
    expect(verdict.reason).toContain('主题一致性');
  });

  it('没有成段正文（导航/列表碎片）→ 拒收，即使可用性与主题分都高', () => {
    const verdict = classifyMaterialVerdict(
      answer({
        usable: { type: 'noul', noul: 0.97 },
        defect: { type: 'choice', choice: 'ok' },
        topic_match: { type: 'noul', noul: 0.9 },
        has_prose: { type: 'noul', noul: 0.1 },
      })
    );
    expect(verdict.action).toBe('reject');
    expect(verdict.reason).toContain('无成段正文');
  });

  it('正常正文 → 放行', () => {
    const verdict = classifyMaterialVerdict(
      answer({
        usable: { type: 'noul', noul: 0.9 },
        defect: { type: 'choice', choice: 'ok' },
        topic_match: { type: 'noul', noul: 0.9 },
      })
    );
    expect(verdict.action).toBe('accept');
  });

  it('缺字段时按「无信号」放行，不因上游少答一个槽位就拒收', () => {
    expect(classifyMaterialVerdict(answer({})).action).toBe('accept');
    expect(classifyMaterialVerdict(null).action).toBe('accept');
  });

  it('阈值可覆盖', () => {
    const strict = classifyMaterialVerdict(
      answer({ usable: { type: 'noul', noul: 0.6 }, defect: { type: 'choice', choice: 'ok' } }),
      { usableMin: 0.8 }
    );
    expect(strict.action).toBe('reject');
  });
});

describe('sampleForGate', () => {
  it('短文本原样返回', () => {
    expect(sampleForGate('短正文', 7000)).toBe('短正文');
  });

  it('长文本同时包含首/中/尾，避免只看开头漏掉转储与乱码', () => {
    const text = `HEAD_MARKER${'a'.repeat(10000)}MID_MARKER${'b'.repeat(10000)}TAIL_MARKER`;
    const sampled = sampleForGate(text, 7000);
    expect(sampled).toContain('HEAD_MARKER');
    expect(sampled).toContain('TAIL_MARKER');
    expect(sampled.length).toBeLessThanOrEqual(7000 + 40);
  });
});
