/**
 * 重调分区渲染（审计 P0 §1.3）。
 *
 * 评审反馈此前只写进 replan 对象、从不渲染，也没有旧路径可对照 ⇒ 规则「逐条修正评审反馈」
 * 完全失效，自动重规划退化成「同样输入的再次采样」。本文件锁定：反馈与原路径都进载荷、且限长。
 */
import { renderReplanSection, renderPreviousPlanForPrompt } from '../index';

describe('renderReplanSection', () => {
  it('带评审反馈 + 原路径：两个分区都渲染，并追加「逐条修正」要求', () => {
    const section = renderReplanSection({
      mode: 'replan',
      triggerSource: 'path-reviewer',
      sourcePathId: 'lp_1',
      freezeCompletedTaskIds: ['t1', 't2'],
      reviewerFeedback: '1. milestone-1 之前需补一个前置概念「把问题拆成可验证的结构」；2. milestone-3 过跳。',
      previousPlan: {
        name: '向上汇报的结构化表达',
        summary: '把进展、问题、请求组织成上级能快速决策的框架。',
        cognitiveCore: { coreConcepts: [{ name: '结论先行' }, { name: '依据分层' }] },
        milestones: [{ title: '识别问题结构', goal: '能说清结论与依据' }],
      },
      learnerReplanProjection: { stableConcepts: ['结论先行'] },
    });

    expect(section).toContain('【路径评审反馈】');
    expect(section).toContain('把问题拆成可验证的结构');
    expect(section).toContain('【被调整的原路径】');
    expect(section).toContain('原路径名：向上汇报的结构化表达');
    expect(section).toContain('结论先行');
    expect(section).toContain('冻结已完成任务：t1、t2');
    expect(section).toContain('【学习者重调投影】');
    // 反馈存在时才追加的第 6 条要求
    expect(section).toContain('必须逐条修正反馈中指出的结构缺陷');
  });

  it('无评审反馈（用户补充说明式重调）：不渲染反馈分区，也不追加第 6 条', () => {
    const section = renderReplanSection({
      mode: 'regenerate-user',
      reason: '第二阶段太难了，想先补基础',
      learnerReplanProjection: {},
    });

    expect(section).toContain('【路径重调模式】');
    expect(section).not.toContain('【路径评审反馈】');
    expect(section).not.toContain('【被调整的原路径】');
    expect(section).not.toContain('必须逐条修正反馈中指出的结构缺陷');
    // 基础重调要求仍在
    expect(section).toContain('不是从零忽略已有学习历史重新规划');
  });

  it('非对象 / 空值 → 空串（无重调时零输出）', () => {
    expect(renderReplanSection(null)).toBe('');
    expect(renderReplanSection(undefined)).toBe('');
    expect(renderReplanSection('replan')).toBe('');
  });

  it('长文本被限长（反馈 ≤1200、原路径 ≤2400），避免挤爆载荷', () => {
    const section = renderReplanSection({
      reviewerFeedback: '缺'.repeat(5000),
      previousPlan: { milestones: Array.from({ length: 30 }, (_, i) => ({ title: `阶段${i}`, goal: '目'.repeat(300) })) },
    });

    // 反馈体：截到 1200（多一个就超）
    expect(section).toContain('缺'.repeat(1200));
    expect(section).not.toContain('缺'.repeat(1201));

    // 原路径体：渲染函数自身的输出被截到 2400
    const planBody = renderPreviousPlanForPrompt({
      milestones: Array.from({ length: 30 }, (_, i) => ({ title: `阶段${i}`, goal: '目'.repeat(300) })),
    });
    expect(planBody.length).toBeLessThanOrEqual(2400);

    // 30 个阶段只渲染前 12 个
    expect(section).toContain('原里程碑（共 30 个）');
    expect(section).toContain('阶段11');
    expect(section).not.toContain('阶段12.');
  });
});

describe('renderPreviousPlanForPrompt', () => {
  it('只取渲染需要的字段，容忍缺失 title/name/goal', () => {
    const rendered = renderPreviousPlanForPrompt({
      name: '路径A',
      milestones: [{ name: '只有 name 的阶段' }, { goal: '只有 goal 的阶段' }, {}],
    });
    expect(rendered).toContain('路径A');
    expect(rendered).toContain('只有 name 的阶段');
    expect(rendered).toContain('(未命名阶段)');
  });

  it('无可用信息 → 空串（不产生空分区标题）', () => {
    expect(renderPreviousPlanForPrompt({})).toBe('');
    expect(renderPreviousPlanForPrompt(null)).toBe('');
    expect(renderPreviousPlanForPrompt({ milestones: [] })).toBe('');
  });
});
