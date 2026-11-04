/**
 * 前置自测作答的确定性合并（2026-11-02 业务口径梳理）。
 *
 * 旧链路：每答一题发一个对话回合，由模型回填 prerequisiteCheckResults——
 * 两题场景实测卡住（答第 1 题后全部选项禁用 30-90s、回来题目漂移）。
 * 新链路：面板内本地作答，确认时一次性提交，服务端按 correctOption 确定性判分。
 */
import {
  mergeProbeAnswersIntoUnderstanding,
  normalizeProbeAnswerInput,
} from '../goal-probe-answers';

const proposal = {
  prerequisiteDiagnostics: [
    { probeId: 'p1', targetConcept: '时态', correctOption: 'A' },
    { probeId: 'p2', targetConcept: '非谓语', correctOption: 'B' },
  ],
};

describe('normalizeProbeAnswerInput：只收合法项', () => {
  it('丢弃空项、重复题号、超长与缺字段', () => {
    expect(normalizeProbeAnswerInput([
      { probeId: 'p1', userAnswer: 'A' },
      { probeId: 'p1', userAnswer: 'B' }, // 重复题号：保留第一条
      { probeId: '', userAnswer: 'A' },
      { probeId: 'p2', userAnswer: '' },
      'not-an-object',
      { probeId: 'p3', userAnswer: 'C', targetConcept: '  从句  ' },
    ])).toEqual([
      { probeId: 'p1', userAnswer: 'A' },
      { probeId: 'p3', userAnswer: 'C', targetConcept: '从句' },
    ]);
  });

  it('非数组输入返回空数组', () => {
    expect(normalizeProbeAnswerInput(undefined)).toEqual([]);
    expect(normalizeProbeAnswerInput({ probeId: 'p1' })).toEqual([]);
  });
});

describe('mergeProbeAnswersIntoUnderstanding：确定性判分与合并', () => {
  it('按 correctOption 判分并保留 targetConcept', () => {
    const merged = mergeProbeAnswersIntoUnderstanding({}, proposal, [
      { probeId: 'p1', userAnswer: 'A' },
      { probeId: 'p2', userAnswer: 'A' },
    ]);
    expect(merged.prerequisiteCheckResults).toEqual([
      { probeId: 'p1', targetConcept: '时态', userAnswer: 'A', isCorrect: true },
      { probeId: 'p2', targetConcept: '非谓语', userAnswer: 'A', isCorrect: false },
    ]);
  });

  it('不认识的题号直接丢弃（旧面板/伪造题号）', () => {
    const merged = mergeProbeAnswersIntoUnderstanding({}, proposal, [
      { probeId: 'p1', userAnswer: 'A' },
      { probeId: 'ghost', userAnswer: 'B' },
    ]);
    expect((merged.prerequisiteCheckResults as Array<{ probeId: string }>).map((r) => r.probeId)).toEqual(['p1']);
  });

  it('用户改选时以最新作答覆盖同一题号，其余历史结果保留', () => {
    const merged = mergeProbeAnswersIntoUnderstanding(
      { prerequisiteCheckResults: [{ probeId: 'p1', userAnswer: 'B', isCorrect: false }] },
      proposal,
      [{ probeId: 'p1', userAnswer: 'A' }],
    );
    expect(merged.prerequisiteCheckResults).toEqual([
      { probeId: 'p1', targetConcept: '时态', userAnswer: 'A', isCorrect: true },
    ]);
  });

  it('出题方没给 correctOption 时不臆测判分（不写 isCorrect）', () => {
    const merged = mergeProbeAnswersIntoUnderstanding({}, { prerequisiteDiagnostics: [{ probeId: 'p1' }] }, [
      { probeId: 'p1', userAnswer: 'A' },
    ]);
    expect(merged.prerequisiteCheckResults).toEqual([{ probeId: 'p1', userAnswer: 'A' }]);
  });

  it('空作答时原样返回原 understanding（不产生空数组字段）', () => {
    const base = { real_problem: 'x' };
    expect(mergeProbeAnswersIntoUnderstanding(base, proposal, [])).toBe(base);
  });
});