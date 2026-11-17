/**
 * 学情画像三态（2026-11-17 真机 gc_1794926822072_rpp3pu7）：
 * 旧逻辑「有值=已收集」把系统默认/脑补算成绿勾，首轮就显示 5/7。
 * 这里锁住三态判定：用户事实=done；系统默认/推断=default；未聊到=todo。
 */
import { describe, expect, it } from 'vitest';
import { resolveFieldStatus } from '../useGoalLive';
import type { GoalUnderstanding } from '@/api/goalConversation';

const u = (patch: Partial<GoalUnderstanding> = {}): GoalUnderstanding => ({
  surface_goal: '我想知道陶行知的教育理念',
  entry_state: 'exploratory',
  ...patch,
});

describe('resolveFieldStatus：已确认 / 系统默认 / 未收集', () => {
  it('宽泛主题下 real_problem 是系统诊断 → default，不算已确认', () => {
    expect(resolveFieldStatus('real_problem', '初次接触，未预设用途', u(), 'understanding')).toBe('default');
  });

  it('用户给出场景或明确 focused → real_problem 才算 done', () => {
    expect(resolveFieldStatus('real_problem', 'x', u({ scenario: '写论文' }), 'understanding')).toBe('done');
    expect(resolveFieldStatus('real_problem', 'x', u({ entry_state: 'focused' }), 'understanding')).toBe('done');
  });

  it('baseline.level=unknown → 背景经验 default；给了水平才 done', () => {
    expect(resolveFieldStatus('background_experience', '未提及', u({ current_baseline: { level: 'unknown' } }), 'understanding')).toBe('default');
    expect(resolveFieldStatus('background_experience', '零基础', u({ current_baseline: { level: 'beginner' } }), 'understanding')).toBe('done');
  });

  it('sessionsLengthSource=default 的 25 分钟 → default，不是用户给的时间', () => {
    expect(resolveFieldStatus('time_per_session', '未提，按 25 分钟默认', u({
      time_dimensions: { sessionsLengthSource: 'default', sessionsLengthMin: 25 },
    }), 'understanding')).toBe('default');
    expect(resolveFieldStatus('time_per_session', '每次 40 分钟', u({
      time_dimensions: { sessionsLengthSource: 'explicit', sessionsLengthMin: 40 },
    }), 'understanding')).toBe('done');
  });

  it('成功标准在方案确认前是系统建议 → default；ready/completed 后才 done', () => {
    expect(resolveFieldStatus('success_criteria', '能说出三句主张', u(), 'proposing')).toBe('default');
    expect(resolveFieldStatus('success_criteria', '能说出三句主张', u(), 'ready')).toBe('done');
  });

  it('没有值 → todo', () => {
    expect(resolveFieldStatus('time_horizon', '', u(), 'understanding')).toBe('todo');
  });
});
