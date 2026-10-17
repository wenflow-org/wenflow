/**
 * #52 P-26 第③例：终态一致性校验。
 *
 * ① wrapup 知识点：evidence/reason 里写了「反复冒头」「仍会」这类相悖表述，
 *    却输出 mastered / ≥90% —— 总结与证据互相打脸，必须降级封顶。
 * ② 任务终态：收束声称任务完成，但写入结果里的任务仍是 todo/in_progress —— 会话 completed、
 *    任务未完成，属异常终态。
 */
import {
  applyKnowledgeTerminalConsistency,
  validateTaskTerminalConsistency,
  CONTRADICTION_PROGRESS_CAP,
} from '../terminal-consistency';

describe('applyKnowledgeTerminalConsistency', () => {
  it('证据含「仍会」且标 mastered/95% → 降级 learning + 封顶 89', () => {
    const { knowledgeItems, downgraded } = applyKnowledgeTerminalConsistency([
      { name: '向量组线性相关', status: 'mastered', progress: 95, evidence: '学生说「这类题我仍会搞混符号」' },
    ]);
    expect(downgraded).toEqual(['向量组线性相关']);
    expect(knowledgeItems[0]).toEqual(
      expect.objectContaining({ status: 'learning', progress: CONTRADICTION_PROGRESS_CAP }),
    );
  });

  it('证据含「反复冒头」但 status 已是 learning、进度 88 → 不动（不重复降级）', () => {
    const { knowledgeItems, downgraded } = applyKnowledgeTerminalConsistency([
      { name: '复合函数求导', status: 'learning', progress: 88, evidence: '求导符号错误反复冒头' },
    ]);
    expect(downgraded).toEqual([]);
    expect(knowledgeItems[0]).toEqual(
      expect.objectContaining({ status: 'learning', progress: 88 }),
    );
  });

  it('无相悖表述 / 无可核对文本 → 原样保留', () => {
    const { knowledgeItems, downgraded } = applyKnowledgeTerminalConsistency([
      { name: '光合作用', status: 'mastered', progress: 96, evidence: '学生完整复述了光反应与暗反应' },
      { name: '无证据点', status: 'mastered', progress: 93 },
    ]);
    expect(downgraded).toEqual([]);
    expect(knowledgeItems[0]).toEqual(expect.objectContaining({ status: 'mastered', progress: 96 }));
    expect(knowledgeItems[1]).toEqual(expect.objectContaining({ status: 'mastered', progress: 93 }));
  });

  it('空输入安全', () => {
    expect(applyKnowledgeTerminalConsistency(undefined)).toEqual({ knowledgeItems: [], downgraded: [] });
  });
});

describe('validateTaskTerminalConsistency', () => {
  it('任务已是 completed → 通过', () => {
    expect(validateTaskTerminalConsistency({ task: { status: 'completed' } })).toEqual(
      expect.objectContaining({ ok: true, observedStatus: 'completed' }),
    );
  });

  it('任务仍是 todo → 失败并给出观测状态', () => {
    const result = validateTaskTerminalConsistency({ task: { status: 'todo' } });
    expect(result.ok).toBe(false);
    expect(result.observedStatus).toBe('todo');
    expect(result.message).toContain('todo');
  });

  it('形状未知（旧调用方/测试桩不返回 task）→ 不误伤', () => {
    expect(validateTaskTerminalConsistency({ alreadyCompleted: true }).ok).toBe(true);
    expect(validateTaskTerminalConsistency(null).ok).toBe(true);
  });
});
