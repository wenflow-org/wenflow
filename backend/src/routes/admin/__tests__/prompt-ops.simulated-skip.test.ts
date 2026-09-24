/* eslint-disable @typescript-eslint/no-explicit-any -- 探针/测试：LLM I/O 与 JSON 载荷形状内在动态（对齐 verify-from-zero 先例） */
/**
 * 回归：批量评估的单用例模拟输入解析失败（典型：引用的模拟学习者已被删除）
 * → 跳过该用例并在 skipped 中报告，不再让整批评估失败。
 * 2026-09-22 交互走查发现：评估用例引用已删除的虚拟学习者 → 每次批量评估必失败。
 */

export {}

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { $disconnect: jest.fn() },
}));
jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: { $disconnect: jest.fn() },
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { partitionSimulatedEvalCases } from '../prompt-ops';

type CaseItem = {
  id: string;
  name: string;
  messages: Array<{ role: string; content: string }>;
  expectations: any;
};

const simCase = (id: string, name: string, personaId?: string): CaseItem => ({
  id,
  name,
  messages: [{ role: 'user', content: '原始消息' }],
  expectations: personaId
    ? { mode: 'simulated', personaId, dialogueRounds: 1, frictionBudget: 'normal', convergeRequires: [] }
    : { mode: 'simulated', scenario: '随便聊聊', dialogueRounds: 1, frictionBudget: 'normal', convergeRequires: [] },
});

const fakeResolve = async (sim: { personaId?: string; scenario?: string }) => {
  if (sim.personaId === 'ghost-id') {
    throw new Error(`模拟学习者 ${sim.personaId} 不存在`);
  }
  return { learner: { nameHint: '模拟学生' }, story: null, demandText: '我想学会X', source: 'scenario' };
};

describe('partitionSimulatedEvalCases：悬空引用跳过而非整批失败', () => {
  it('混合用例：有效保留、悬空引用进 skipped（含原因），非模拟用例不受影响', async () => {
    const cases: CaseItem[] = [
      simCase('c1', '正常用例', 'p1'),
      simCase('c2', '悬空引用用例', 'ghost-id'),
      { id: 'c3', name: '非模拟用例', messages: [{ role: 'user', content: 'hi' }], expectations: null },
    ];
    const r = await partitionSimulatedEvalCases(cases, fakeResolve);

    expect(r.keptCases.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toMatchObject({ caseId: 'c2', caseName: '悬空引用用例' });
    expect(r.skipped[0].reason).toContain('不存在');
    // 三数组下标一一对应
    expect(r.keptSimConfigs).toHaveLength(r.keptCases.length);
    expect(r.keptSimInputs).toHaveLength(r.keptCases.length);
  });

  it('全部悬空 → kept 为空、skipped 全量报告', async () => {
    const cases: CaseItem[] = [simCase('a', 'A', 'ghost-id'), simCase('b', 'B', 'ghost-id')];
    const r = await partitionSimulatedEvalCases(cases, fakeResolve);
    expect(r.keptCases).toHaveLength(0);
    expect(r.skipped).toHaveLength(2);
  });

  it('有效模拟用例：首条 user 消息被替换为模拟学生诉求', async () => {
    const cases: CaseItem[] = [simCase('c1', '正常用例', 'p1')];
    const r = await partitionSimulatedEvalCases(cases, fakeResolve);
    expect(r.keptCases[0].messages[0].content).toBe('我想学会X');
  });
});
