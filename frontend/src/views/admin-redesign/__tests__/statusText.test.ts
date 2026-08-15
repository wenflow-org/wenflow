/**
 * statusText.ts 本地化字典测试：
 * 已知枚举必须命中中文映射；未知值原样回退；空值不崩溃
 */
import { describe, expect, it } from 'vitest';
import {
  statusText,
  stageText,
  stageBadgeCls,
  categoryText,
  actionText,
  targetTypeText,
  stageProgressIndex,
  stageProgress,
  stageTimeline,
  stageTimelineText,
  sessionProgressPct,
  sessionProgressText,
  sessionProgressTone,
  sessionProgressDone,
  GOAL_STAGE_TOTAL
} from '../statusText';

describe('statusText', () => {
  it('核心状态映射', () => {
    expect(statusText('completed')).toBe('已完成');
    expect(statusText('success')).toBe('成功');
    expect(statusText('error')).toBe('错误');
    expect(statusText('timeout')).toBe('超时');
    expect(statusText('failed')).toBe('失败');
    expect(statusText('active')).toBe('进行中');
    expect(statusText('draft')).toBe('草稿');
    expect(statusText('published')).toBe('已发布');
  });

  it('大小写不敏感（后端枚举混杂 snake_case）', () => {
    expect(statusText('Completed')).toBe('已完成');
    expect(statusText('IN_PROGRESS')).toBe('进行中');
  });

  it('未知值原样返回（不丢信息）', () => {
    expect(statusText('unknown-state')).toBe('unknown-state');
  });

  it('空值返回空串', () => {
    expect(statusText(null)).toBe('');
    expect(statusText(undefined)).toBe('');
  });
});

describe('stageText（Goal 会话阶段）', () => {
  it('五阶段映射', () => {
    expect(stageText('understanding')).toBe('澄清中');
    expect(stageText('proposal')).toBe('方案收敛中');
    expect(stageText('planning')).toBe('规划中');
    expect(stageText('completed')).toBe('已完成');
    expect(stageText('failed')).toBe('失败');
  });

  it('未知值回退原文', () => {
    expect(stageText('archived')).toBe('archived');
  });
});

describe('stageBadgeCls（G1：会话域阶段列徽章单源档位）', () => {
  it('已完成 → ok；失败 → bad', () => {
    expect(stageBadgeCls('completed')).toBe('mk-badge--ok');
    expect(stageBadgeCls('failed')).toBe('mk-badge--bad');
  });

  it('方案收敛中 / 已取消 → warn', () => {
    expect(stageBadgeCls('proposal')).toBe('mk-badge--warn');
    expect(stageBadgeCls('cancelled')).toBe('mk-badge--warn');
  });

  it('澄清中 / 规划中 / initial → info', () => {
    expect(stageBadgeCls('understanding')).toBe('mk-badge--info');
    expect(stageBadgeCls('planning')).toBe('mk-badge--info');
    expect(stageBadgeCls('initial')).toBe('mk-badge--info');
  });

  it('未知阶段 → muted，空值不崩溃', () => {
    expect(stageBadgeCls('mystery')).toBe('mk-badge--muted');
    expect(stageBadgeCls(null)).toBe('mk-badge--muted');
  });
});

describe('categoryText（Skill 类别）', () => {
  it('核心类别映射', () => {
    expect(categoryText('analysis')).toBe('分析');
    expect(categoryText('generation')).toBe('生成');
    expect(categoryText('teaching')).toBe('教学');
    expect(categoryText('simulation')).toBe('模拟');
  });
});

describe('actionText（审计动作）', () => {
  it('审计动作映射', () => {
    expect(actionText('user-create')).toBe('创建用户');
    expect(actionText('admin-login')).toBe('管理员登录');
    expect(actionText('session-revoke')).toBe('强制下线会话');
  });

  it('虚拟学习者域动作映射（A5 审计语义化）', () => {
    expect(actionText('virtual-create')).toBe('创建虚拟学习者');
    expect(actionText('virtual-update')).toBe('更新虚拟画像');
    expect(actionText('virtual-delete')).toBe('删除虚拟学习者');
    expect(actionText('virtual-story-generate')).toBe('生成故事');
    expect(actionText('virtual-story-update')).toBe('编辑故事');
    expect(actionText('virtual-story-delete')).toBe('删除故事');
    expect(actionText('virtual-session-start')).toBe('启动虚拟实验');
    expect(actionText('virtual-session-delete')).toBe('删除虚拟会话');
    expect(actionText('virtual-session-stale-reclaim')).toBe('回收卡死会话');
    expect(actionText('virtual-session-batch-terminate')).toBe('批量终止虚拟会话');
    expect(actionText('virtual-cascade-delete')).toBe('级联删除虚拟数据');
    expect(actionText('Virtual-Session-Start')).toBe('启动虚拟实验');
  });

  it('未知动作回退原文', () => {
    expect(actionText('mystery-action')).toBe('mystery-action');
  });
});

describe('targetTypeText（审计目标类型）', () => {
  it('已知类型映射', () => {
    expect(targetTypeText('user')).toBe('用户');
    expect(targetTypeText('session')).toBe('会话');
    expect(targetTypeText('virtual-learner')).toBe('虚拟学习者');
    expect(targetTypeText('virtual-session')).toBe('虚拟会话');
  });

  it('空值 → —', () => {
    expect(targetTypeText('')).toBe('—');
    expect(targetTypeText(null)).toBe('—');
  });

  it('未知类型回退原文', () => {
    expect(targetTypeText('skill')).toBe('skill');
  });
});

describe('stageProgress（Goal 阶段过程步，单源：创建→澄清→方案→完成）', () => {
  it('四步序号：创建 0 / 澄清 1 / 方案 2 / 完成 3', () => {
    expect(stageProgressIndex('initial')).toBe(0);
    expect(stageProgressIndex('understanding')).toBe(1);
    expect(stageProgressIndex('proposal')).toBe(2);
    expect(stageProgressIndex('proposing')).toBe(2);
    expect(stageProgressIndex('ready')).toBe(2);
    expect(stageProgressIndex('planning')).toBe(2);
    expect(stageProgressIndex('completed')).toBe(3);
  });

  it('失败/取消给中断位（2 / 1）；未知阶段回退 0；空值不崩溃', () => {
    expect(stageProgressIndex('failed')).toBe(2);
    expect(stageProgressIndex('cancelled')).toBe(1);
    expect(stageProgressIndex('mystery')).toBe(0);
    expect(stageProgressIndex(null)).toBe(0);
    expect(stageProgress(undefined)).toEqual({ index: 0, total: GOAL_STAGE_TOTAL });
    expect(GOAL_STAGE_TOTAL).toBe(4);
  });
});

describe('stageTimeline（Goal 会话轻量阶段时间线，列表展示单源）', () => {
  const base = {
    createdAt: '2026-08-12T02:00:00.000Z',
    updatedAt: '2026-08-13T04:00:00.000Z',
    completedAt: '2026-08-14T06:00:00.000Z'
  };

  it('进行中：创建 → 当前阶段（跨日）', () => {
    const tl = stageTimeline({ ...base, stage: 'understanding', status: 'active' });
    expect(tl).toEqual([
      { label: '创建', date: '08-12' },
      { label: '澄清中', date: '08-13' }
    ]);
    expect(stageTimelineText({ ...base, stage: 'understanding', status: 'active' })).toBe('创建 08-12 → 澄清中 08-13');
  });

  it('已完成：创建 → 完成（用 completedAt）', () => {
    const tl = stageTimeline({ ...base, stage: 'completed', status: 'completed' });
    expect(tl.map((i) => i.label)).toEqual(['创建', '已完成']);
    expect(tl[1].date).toBe('08-14');
  });

  it('同日收敛为最晚一条（「创建 08-12 → 澄清中 08-12」只留「澄清中 08-12」）', () => {
    const tl = stageTimeline({
      createdAt: '2026-08-12T02:00:00.000Z',
      updatedAt: '2026-08-12T09:00:00.000Z',
      stage: 'understanding',
      status: 'active'
    });
    expect(tl).toEqual([{ label: '澄清中', date: '08-12' }]);
  });

  it('取消：终态标签用最近更新时间，同日与当前阶段收敛', () => {
    const tl = stageTimeline({
      ...base,
      stage: 'proposal',
      status: 'cancelled',
      completedAt: null
    });
    expect(tl.map((i) => i.label)).toEqual(['创建', '已取消']);
    expect(tl[1].date).toBe('08-13');
  });

  it('无时间戳 → 空列表（前端显示 —）', () => {
    expect(stageTimeline({ stage: 'understanding', status: 'active' })).toEqual([]);
    expect(stageTimelineText({})).toBe('');
    expect(stageTimelineText(null as unknown as Record<string, never>)).toBe('');
  });

  it('非法日期不崩坏', () => {
    expect(stageTimelineText({ createdAt: 'not-a-date', updatedAt: 'x', stage: 'understanding', status: 'active' })).toBe('');
  });
});

describe('sessionProgress（教学会话进度列单源：任务 x/y + 迷你条档位）', () => {
  const p = { taskIndex: 3, totalTasks: 5, milestoneIndex: 2, totalMilestones: 4 };

  it('百分比 = 任务位置/总数（钳制 0-100）', () => {
    expect(sessionProgressPct(p)).toBe(60);
    expect(sessionProgressPct({ taskIndex: 5, totalTasks: 5, milestoneIndex: 2, totalMilestones: 4 })).toBe(100);
    expect(sessionProgressPct({ taskIndex: 0, totalTasks: 0, milestoneIndex: 1, totalMilestones: 4 })).toBe(null);
    expect(sessionProgressPct(null)).toBe(null);
  });

  it('文本 = 任务 x/y；中断态加「中断于」前缀；无数据 → —', () => {
    expect(sessionProgressText(p, 'active')).toBe('任务 3/5');
    expect(sessionProgressText(p, 'completed')).toBe('任务 3/5');
    expect(sessionProgressText(p, 'failed')).toBe('中断于 任务 3/5');
    expect(sessionProgressText(p, 'timeout')).toBe('中断于 任务 3/5');
    expect(sessionProgressText(p, 'finalization_failed')).toBe('中断于 任务 3/5');
    expect(sessionProgressText(null, 'active')).toBe('—');
    expect(sessionProgressText({ taskIndex: 9, totalTasks: 5, milestoneIndex: 1, totalMilestones: 4 }, 'active')).toBe('任务 5/5');
  });

  it('条档位：完成 → ok；失败/超时/收尾失败/废弃 → bad；其余默认蓝条', () => {
    expect(sessionProgressTone('completed')).toBe('ok');
    expect(sessionProgressTone('succeeded')).toBe('ok');
    expect(sessionProgressTone('failed')).toBe('bad');
    expect(sessionProgressTone('timeout')).toBe('bad');
    expect(sessionProgressTone('finalization_failed')).toBe('bad');
    expect(sessionProgressTone('discarded')).toBe('bad');
    expect(sessionProgressTone('active')).toBe(null);
    expect(sessionProgressTone(null)).toBe(null);
  });

  it('终态完成判定：completed/succeeded 为终态完成，其余非终态完成', () => {
    expect(sessionProgressDone('completed')).toBe(true);
    expect(sessionProgressDone('succeeded')).toBe(true);
    expect(sessionProgressDone('Completed')).toBe(true);
    expect(sessionProgressDone('active')).toBe(false);
    expect(sessionProgressDone('failed')).toBe(false);
    expect(sessionProgressDone('timeout')).toBe(false);
    expect(sessionProgressDone('')).toBe(false);
    expect(sessionProgressDone(null)).toBe(false);
  });
});
