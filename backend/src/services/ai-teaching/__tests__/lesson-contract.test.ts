/**
 * 课堂契约与自由支线（2026-11-19 全面改造）：
 * 契约 = 最低必须完成集；学生自由需求走有预算的支线；支线正确不冒充核心 KC 的独立证据。
 */
import {
  buildBranchDirective,
  buildLessonContract,
  buildLessonReport,
  collectLessonEvidence,
  evaluateLessonContract,
  evaluateLessonContractGate,
  normalizeBranchState,
  normalizeStudentNeed,
  parseExitTicketSubmission,
  resolveBranchDecision,
  type ExitTicket,
} from '../lesson-contract';

const context = (overrides: Record<string, unknown> = {}) => ({
  taskKcs: [
    { kcId: 'kc-1', name: '识别工具返回' },
    { kcId: 'kc-2', name: '解释 ReAct 往返' },
  ],
  taskKnowledgeSeeds: [{ name: '种子概念', status: 'pending', progress: 0 }],
  taskProfile: { coreConcept: '核心概念' },
  taskEstimatedMinutes: 30,
  ...overrides,
} as any);

describe('buildLessonContract', () => {
  it('优先用 taskKcs，冻结最低必须集与独立证据门槛', () => {
    const contract = buildLessonContract(context());
    expect(contract.coreKcs.map((kc) => kc.kcId)).toEqual(['kc-1', 'kc-2']);
    expect(contract.minIndependentEvidence).toBe(1);
    expect(contract.minTurns).toBe(3);
    expect(contract.timeBudgetMin).toBe(30);
    expect(contract.branchBudgets.deeperTurns).toBe(3);
  });

  it('无 taskKcs 时回退知识种子；再退回 coreConcept；最多 4 个', () => {
    expect(buildLessonContract(context({ taskKcs: [] })).coreKcs[0].name).toBe('种子概念');
    expect(buildLessonContract(context({ taskKcs: [], taskKnowledgeSeeds: [] })).coreKcs[0].name).toBe('核心概念');
    const many = buildLessonContract(context({
      taskKcs: Array.from({ length: 6 }, (_, i) => ({ kcId: `kc-${i}`, name: `概念${i}` })),
    }));
    expect(many.coreKcs).toHaveLength(4);
    expect(many.minIndependentEvidence).toBe(2);
  });
});

describe('studentNeed 与支线预算', () => {
  const contract = buildLessonContract(context());

  it('非法/缺失分型回退 answer', () => {
    expect(normalizeStudentNeed('deepen')).toBe('answer');
    expect(normalizeStudentNeed(undefined)).toBe('answer');
    expect(normalizeStudentNeed('prerequisite_gap')).toBe('prerequisite_gap');
  });

  it('deeper 最多 3 轮，用满后回主线', () => {
    let state = normalizeBranchState(null);
    for (let i = 0; i < 4; i++) {
      const decision = resolveBranchDecision({ need: 'deeper', contract, state, message: '想再深一点' });
      state = decision.state;
      if (i < 3) expect(decision.branch).toBe('deeper');
      else {
        expect(decision.branch).toBe('spine');
        expect(decision.directive).toContain('预算已用尽');
      }
    }
  });

  it('example 每 KC 最多 1 次，超出后要求自己举例', () => {
    let state = normalizeBranchState(null);
    const first = resolveBranchDecision({ need: 'example', contract, state, focusKc: '识别工具返回' });
    state = first.state;
    expect(first.branch).toBe('example');
    const second = resolveBranchDecision({ need: 'example', contract, state, focusKc: '识别工具返回' });
    expect(second.branch).toBe('spine');
    expect(second.directive).toContain('举例额度已用完');
  });

  it('prerequisite_gap 只补 1 次；第二次进停车区', () => {
    let state = normalizeBranchState(null);
    const first = resolveBranchDecision({ need: 'prerequisite_gap', contract, state, message: '我没学过函数' });
    state = first.state;
    expect(first.branch).toBe('patch');
    expect(state.patchesUsed).toBe(1);
    const second = resolveBranchDecision({ need: 'prerequisite_gap', contract, state, message: '我还缺别的' });
    expect(second.branch).toBe('park');
    expect(second.addParkingItem?.topic).toContain('先修');
  });

  it('off_topic 课内最多回应 1 轮并进停车区；重复则直接停车', () => {
    let state = normalizeBranchState(null);
    const first = resolveBranchDecision({ need: 'off_topic', contract, state, message: '顺便问个八卦' });
    state = first.state;
    expect(first.branch).toBe('park');
    expect(state.parkingLot).toHaveLength(1);
    const second = resolveBranchDecision({ need: 'off_topic', contract, state, message: '再问一个' });
    expect(second.branch).toBe('park');
    expect(second.state.parkingLot).toHaveLength(2);
  });

  it('goal_change 升级；test_out 走独立验证', () => {
    const escalated = resolveBranchDecision({ need: 'goal_change', contract, state: normalizeBranchState(null), message: '我想换目标' });
    expect(escalated.branch).toBe('escalate');
    expect(escalated.directive).toContain('重规划');
    const testOut = resolveBranchDecision({ need: 'test_out', contract, state: normalizeBranchState(null), message: '这个我会了' });
    expect(testOut.branch).toBe('test_out');
    expect(testOut.directive).toContain('独立题');
  });

  it('buildBranchDirective 在预算耗尽时同轮生效', () => {
    const state = normalizeBranchState({
      active: 'deeper',
      turnsUsed: 3,
      budget: 3,
    });
    expect(buildBranchDirective(state, contract)).toContain('预算已用尽');
  });
});

describe('证据账本与契约完成', () => {
  const contract = buildLessonContract(context());

  it('独立证据要求首答通过且非 model-reference；rubric 首答可算独立', () => {
    const evidence = collectLessonEvidence({
      contract,
      checkpointHistory: [
        { conceptName: '识别工具返回', passed: true, judgedBy: 'code', attempts: 1 },
        { conceptName: '解释 ReAct 往返', passed: true, judgedBy: 'model-rubric', attempts: 1 },
        { conceptName: '解释 ReAct 往返', passed: true, judgedBy: 'model-reference', attempts: 1 },
        { conceptName: '识别工具返回', passed: true, judgedBy: 'code', attempts: 3 },
      ],
      knowledgeState: [],
      teachingTurns: 4,
    });
    expect(evidence.find((item) => item.kcName === '识别工具返回')?.independent).toBe(true);
    expect(evidence.find((item) => item.kcName === '解释 ReAct 往返')?.independent).toBe(true);
    expect(evidence.filter((item) => item.kcName === '解释 ReAct 往返' && item.independent)).toHaveLength(1);
  });

  it('核心 KC 全有证据且独立数达标才 met', () => {
    const evidence = collectLessonEvidence({
      contract,
      checkpointHistory: [
        { conceptName: '识别工具返回', passed: true, judgedBy: 'code', attempts: 1 },
        { conceptName: '解释 ReAct 往返', passed: true, judgedBy: 'model-rubric', attempts: 1 },
      ],
      teachingTurns: 4,
    });
    const evaluation = evaluateLessonContract({ contract, evidence, teachingTurns: 4 });
    expect(evaluation.met).toBe(true);
    expect(evaluation.independentCount).toBe(2);
  });

  it('缺 KC / 回合不足 / 独立证据不足 → 不 met 且给原因', () => {
    const evidence = collectLessonEvidence({
      contract,
      checkpointHistory: [{ conceptName: '识别工具返回', passed: true, judgedBy: 'code', attempts: 1 }],
      teachingTurns: 2,
    });
    const evaluation = evaluateLessonContract({ contract, evidence, teachingTurns: 2 });
    expect(evaluation.met).toBe(false);
    expect(evaluation.missingKcs).toContain('解释 ReAct 往返');
    expect(evaluation.reasons.join(' ')).toContain('教学回合不足');
  });

  it('报告带支线用量与停车区，供结课展示', () => {
    const state = normalizeBranchState({ patchesUsed: 1, offTopicTurns: 1, parkingLot: [{ at: 't', topic: '八卦' }] });
    const evidence = collectLessonEvidence({ contract, checkpointHistory: [], teachingTurns: 3 });
    const evaluation = evaluateLessonContract({ contract, evidence, teachingTurns: 3 });
    const report = buildLessonReport({ contract, evaluation, evidence, branchState: state, teachingTurns: 3 });
    expect(report.parkingLot).toHaveLength(1);
    expect(report.branch.patchesUsed).toBe(1);
    expect(report.met).toBe(false);
  });
});

describe('evaluateLessonContractGate（结算入口共用门）', () => {
  const contract = buildLessonContract(context());
  const teachingState = (reportMet: boolean | null) => ({
    sessionArtifacts: {
      lessonContract: contract,
      ...(reportMet === null
        ? {}
        : { lessonReport: { met: reportMet, reasons: reportMet ? [] : ['独立证据不足：1/2（支线/提示证据不计入）'] } }),
    },
  });

  afterEach(() => {
    delete process.env.LESSON_CONTRACT_ENFORCE;
  });

  it('没有持久化契约（旧会话/夹具）→ 不启用硬门', () => {
    expect(evaluateLessonContractGate({ sessionArtifacts: {} })).toEqual({ enforced: false, met: false, reasons: [] });
    expect(evaluateLessonContractGate(null).enforced).toBe(false);
  });

  it('有契约无报告 → 视为未达成（宁可拦在结算前）', () => {
    expect(evaluateLessonContractGate(teachingState(null))).toEqual({ enforced: true, met: false, reasons: [] });
  });

  it('报告 met 与 reasons 原样透出', () => {
    expect(evaluateLessonContractGate(teachingState(true))).toEqual({ enforced: true, met: true, reasons: [] });
    const unmet = evaluateLessonContractGate(teachingState(false));
    expect(unmet.met).toBe(false);
    expect(unmet.reasons[0]).toContain('独立证据不足');
  });

  it('LESSON_CONTRACT_ENFORCE=0 应急开关关闭硬门', () => {
    process.env.LESSON_CONTRACT_ENFORCE = '0';
    expect(evaluateLessonContractGate(teachingState(false)).enforced).toBe(false);
  });
});

describe('课末独立终检（exit ticket）', () => {
  const contract = buildLessonContract(context());
  const ticket = (overrides: Partial<ExitTicket> = {}): ExitTicket => ({
    id: 'et-1',
    question: '新公司要求入职即起算两年竞业，这条哪里不合规？',
    type: 'single_choice',
    options: [
      { id: 'A', text: '起算点写成入职之日' },
      { id: 'B', text: '两年期限本身超限' },
    ],
    correctOptionIds: ['A'],
    conceptName: '识别工具返回',
    askedAt: '2026-11-19T00:00:00.000Z',
    status: 'passed',
    attempts: 1,
    judgedBy: 'code',
    passed: true,
    answeredAt: '2026-11-19T00:01:00.000Z',
    ...overrides,
  });

  it('通过的终检题计入独立证据（kind=exit-ticket）', () => {
    const evidence = collectLessonEvidence({
      contract,
      checkpointHistory: [],
      exitTickets: [ticket()],
      teachingTurns: 5,
    });
    const row = evidence.find((item) => item.kind === 'exit-ticket');
    expect(row?.kcName).toBe('识别工具返回');
    expect(row?.independent).toBe(true);
    const evaluation = evaluateLessonContract({ contract, evidence, teachingTurns: 5 });
    expect(evaluation.coveredKcs).toContain('识别工具返回');
  });

  it('未通过/待作答的终检题不进证据', () => {
    const evidence = collectLessonEvidence({
      contract,
      exitTickets: [ticket({ status: 'failed', passed: false })],
      teachingTurns: 5,
    });
    expect(evidence.some((item) => item.kind === 'exit-ticket')).toBe(false);
  });

  it('终检一旦发出，未通过/待作答时报告 met=false；通过后才 met=true', () => {
    const evidence = collectLessonEvidence({
      contract,
      checkpointHistory: [
        { conceptName: '识别工具返回', passed: true, judgedBy: 'code', attempts: 1 },
        { conceptName: '解释 ReAct 往返', passed: true, judgedBy: 'code', attempts: 1 },
      ],
      exitTickets: [ticket()],
      teachingTurns: 5,
    });
    const evaluation = evaluateLessonContract({ contract, evidence, teachingTurns: 5 });
    expect(evaluation.met).toBe(true);

    const pending = buildLessonReport({
      contract,
      evaluation,
      evidence,
      branchState: normalizeBranchState(null),
      teachingTurns: 5,
      exitTicket: ticket({ status: 'pending', passed: undefined, judgedBy: undefined }),
    });
    expect(pending.met).toBe(false);
    expect(pending.reasons.join(' ')).toContain('课末终检待作答');
    expect(pending.exitTicket).toMatchObject({ asked: true, passed: false, conceptName: '识别工具返回' });

    const passed = buildLessonReport({
      contract,
      evaluation,
      evidence,
      branchState: normalizeBranchState(null),
      teachingTurns: 5,
      exitTicket: ticket(),
    });
    expect(passed.met).toBe(true);
    expect(passed.exitTicket).toMatchObject({ asked: true, passed: true, judgedBy: 'code' });

    // 失败终检的 detail 可能带答案键，report.reasons 会直接回给客户端 → 不能泄题
    const failed = buildLessonReport({
      contract,
      evaluation,
      evidence,
      branchState: normalizeBranchState(null),
      teachingTurns: 5,
      exitTicket: ticket({ status: 'failed', passed: false, detail: '选项集合不一致（正确 A，作答 空）' }),
    });
    expect(failed.met).toBe(false);
    expect(failed.reasons.join(' ')).toContain('课末终检未通过：识别工具返回');
    expect(failed.reasons.join(' ')).not.toContain('正确 A');
  });

  it('选择题作答解析：选项字母 / 选项原文都认，多选取全部命中', () => {
    expect(parseExitTicketSubmission({ type: 'single_choice', options: ticket().options }, 'B')).toEqual({ selectedOptionIds: ['B'] });
    expect(parseExitTicketSubmission({ type: 'single_choice', options: ticket().options }, '我选起算点写成入职之日')).toEqual({ selectedOptionIds: ['A'] });
    expect(parseExitTicketSubmission({ type: 'short_answer' }, '起算点应从解除或终止劳动合同之日起算')).toEqual({
      answerText: '起算点应从解除或终止劳动合同之日起算',
    });
  });
});
