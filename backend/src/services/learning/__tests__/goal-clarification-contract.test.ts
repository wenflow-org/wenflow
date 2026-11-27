/**
 * Goal 澄清契约的内核契约（设计稿 v0.1）。
 *
 * 钉死的语义：
 * - 只有“会改变第一站/停机条件”的未知才阻止提案；范围/后续阶段未知可带假设提案；
 * - 基线必须是证据（用户原话/术语/经历），不是 beginner/intermediate 标签；
 * - 去向由契约属性派生（learning_path / one_off / support / clarify），不由身份标签派生；
 * - 提问按 planImpact 优先级选，一次一个。
 */
import {
  normalizeClarificationContract,
  deriveClarificationGaps,
  canProposeClarification,
  selectNextClarificationQuestion,
  deriveGoalRoute,
  validateProposalTraceability,
  buildClarificationShadowObservation,
  decideClarificationGate,
  isClarificationEnforceEnabled,
  assertClarificationReadyForPath,
  ClarificationRequiredError,
  auditMilestoneRationales,
} from '../goal-clarification-contract';

const cltAfterTurn2 = {
  core: {
    question: '学习科学与 CLT 是包含关系还是冲突关系，边界在哪',
    evidence: ['和 clt 之间关系'],
  },
  baseline: {
    known: ['用户主动使用 CLT 缩写'],
    unknown: ['是否读过样例效应/元素交互'],
    misconceptions: [],
    evidence: ['用户自然说出 CLT，说明不是零基础'],
  },
  stopping: {
    kind: 'explain',
    scope: 'class',
    evidence: 'platform',
    statement: '能解释两者的关系，并把一个新案例放进这个框架',
  },
  constraints: { timePerSessionMin: 25 },
  assumptions: [],
  blockingNeed: 'none',
  unknowns: [
    {
      id: 'u2',
      question: '你读过 Sweller 的样例效应/元素交互吗？',
      planImpact: 'first-station',
      discriminates: [
        '只听过名字：第一站从样例效应实验建立直觉',
        '读过：第一站直接进入 2006 年那场争论',
      ],
    },
  ],
};

describe('goal-clarification-contract · 提案门控', () => {
  it('CLT 案例：基线只有“会用缩写”，第一站未决 → 不出提案，且选中该问题', () => {
    const gate = canProposeClarification(cltAfterTurn2);
    expect(gate.allowed).toBe(false);
    expect(gate.blocking.map((gap) => gap.field)).toContain('unknowns.first-station');
    expect(selectNextClarificationQuestion(cltAfterTurn2)?.id).toBe('u2');
  });

  it('基线问题答完后 → 允许提案', () => {
    const answered = {
      ...cltAfterTurn2,
      baseline: {
        ...cltAfterTurn2.baseline,
        known: ['知道 CLT 与 Sweller 的名字', '只听过名字，没读过样例效应'],
        unknown: [],
        evidence: ['只听过名字，没读过'],
      },
      unknowns: [],
    };
    expect(canProposeClarification(answered).allowed).toBe(true);
  });

  it('只剩范围级未知 → 允许提案，但标 advisory', () => {
    const scopeOnly = {
      ...cltAfterTurn2,
      baseline: { ...cltAfterTurn2.baseline, unknown: [] },
      unknowns: [
        {
          id: 'u3',
          question: '你更想偏学科史还是教学应用？',
          planImpact: 'scope',
          discriminates: ['学科史：第二站展开 2006 争论', '教学应用：第二站换成课堂设计'],
        },
      ],
    };
    const gate = canProposeClarification(scopeOnly);
    expect(gate.allowed).toBe(true);
    expect(gate.advisory.map((gap) => gap.field)).toContain('unknowns.scope');
  });

  it('基线未知没消化进 unknowns → 拦住提案（股票案例的绕过路径）', () => {
    const hidden = {
      ...cltAfterTurn2,
      baseline: {
        ...cltAfterTurn2.baseline,
        unknown: ['是否已能读懂单根K线与成交量'],
      },
      unknowns: [
        {
          id: 'u9',
          question: '你想先看大盘还是个股？',
          planImpact: 'scope',
          discriminates: ['大盘：先讲指数', '个股：先讲单只走势'],
        },
      ],
    };
    const gate = canProposeClarification(hidden);
    expect(gate.allowed).toBe(false);
    expect(gate.blocking.map((gap) => gap.field)).toContain('baseline.unknown');
    // Path 入口不因此二次判死：基线未知只在提案前拦。
    expect(() => assertClarificationReadyForPath(hidden)).not.toThrow();

    // 同一未知只要镜像进了 unknowns，就按 unknowns 拦，不再额外按 baseline.unknown 拦。
    const mirrored = {
      ...hidden,
      unknowns: [{
        id: 'u10',
        question: '你现在能读懂单根K线和成交量吗？',
        planImpact: 'first-station',
        discriminates: ['不能：第一站从读图语言起步', '能：第一站直接讲指标组合'],
      }],
    };
    const mirroredGate = canProposeClarification(mirrored);
    expect(mirroredGate.allowed).toBe(false);
    expect(mirroredGate.blocking.map((gap) => gap.field)).toContain('unknowns.first-station');
    expect(mirroredGate.blocking.map((gap) => gap.field)).not.toContain('baseline.unknown');
  });

  it('缺核心问题 / 缺基线证据降为 advisory；缺停机条件仍 blocking', () => {
    const empty = {
      ...cltAfterTurn2,
      core: { question: null, evidence: ['学习科学'] },
      baseline: { known: [], unknown: [], misconceptions: [], evidence: [] },
      stopping: { ...cltAfterTurn2.stopping, statement: null },
      unknowns: [],
    };
    const gate = canProposeClarification(empty);
    expect(gate.allowed).toBe(false);
    expect(gate.blocking.map((gap) => gap.field)).toEqual(['stopping.statement']);
    expect(gate.advisory.map((gap) => gap.field)).toEqual(
      expect.arrayContaining(['core.question', 'baseline.evidence'])
    );
  });

  it('时间约束缺失只是 advisory，不阻断提案', () => {
    const noTime = {
      ...cltAfterTurn2,
      baseline: { ...cltAfterTurn2.baseline, unknown: [] },
      constraints: {},
      unknowns: [],
    };
    const gate = canProposeClarification(noTime);
    expect(gate.allowed).toBe(true);
    expect(gate.advisory.map((gap) => gap.field)).toContain('constraints');
  });
});

describe('goal-clarification-contract · 去向派生（替代身份分型）', () => {
  it('明确的一类问题 + 可验收 → learning_path', () => {
    const answered = {
      ...cltAfterTurn2,
      baseline: { ...cltAfterTurn2.baseline, unknown: [] },
      unknowns: [],
    };
    expect(deriveGoalRoute(answered)).toBe('learning_path');
  });

  it('一次性实例（scope=instance）→ one_off，不排路径', () => {
    const oneOff = {
      ...cltAfterTurn2,
      stopping: { ...cltAfterTurn2.stopping, scope: 'instance', kind: 'do' },
      unknowns: [],
    };
    expect(deriveGoalRoute(oneOff)).toBe('one_off');
  });

  it('情绪/转介需求 → support，不排路径', () => {
    const emotional = { ...cltAfterTurn2, blockingNeed: 'emotional', unknowns: [] };
    expect(deriveGoalRoute(emotional)).toBe('support');
  });

  it('还有第一站级未知 → clarify', () => {
    expect(deriveGoalRoute(cltAfterTurn2)).toBe('clarify');
  });
});

describe('goal-clarification-contract · 提问优先级', () => {
  it('first-station > stopping > scope > later', () => {
    const contract = {
      ...cltAfterTurn2,
      unknowns: [
        { id: 'later', question: '以后想不想深入？', planImpact: 'later', discriminates: [] },
        { id: 'scope', question: '偏史还是偏应用？', planImpact: 'scope', discriminates: [] },
        { id: 'stop', question: '什么算学会？', planImpact: 'stopping', discriminates: [] },
        { id: 'first', question: '读过样例效应吗？', planImpact: 'first-station', discriminates: [] },
      ],
    };
    expect(selectNextClarificationQuestion(contract)?.id).toBe('first');
    expect(normalizeClarificationContract(contract).unknowns.map((item) => item.id)).toEqual([
      'first',
      'stop',
      'scope',
      'later',
    ]);
  });

  it('没有 blocking 级未知时不再提问', () => {
    const scopeOnly = {
      ...cltAfterTurn2,
      unknowns: [{ id: 's', question: '偏史还是偏应用？', planImpact: 'scope', discriminates: [] }],
    };
    expect(selectNextClarificationQuestion(scopeOnly)).toBeNull();
  });
});

describe('goal-clarification-contract · 提案可追溯性', () => {
  const proposal = {
    direction: '从样例效应实验建立 CLT 直觉，再放回学习科学版图',
    firstStation: 'Sweller 的样例效应实验',
    stages: ['样例效应', '2006 争论', '新案例判断'],
    stoppingEvidence: '能解释两者的关系，并把一个新案例放进框架',
    outOfScope: ['完整学科分支'],
    assumptions: [],
  };

  it('结构完整 + 无未决项 → 通过', () => {
    expect(validateProposalTraceability(proposal, { ...cltAfterTurn2, unknowns: [] })).toEqual([]);
  });

  it('有未决项但没写假设 → 报错', () => {
    const issues = validateProposalTraceability(proposal, cltAfterTurn2);
    expect(issues.map((issue) => issue.field)).toContain('proposal.assumptions');
  });

  it('缺第一站 / 缺停机证据 → 报错', () => {
    const issues = validateProposalTraceability(
      { ...proposal, firstStation: '', stoppingEvidence: '' },
      { ...cltAfterTurn2, unknowns: [] }
    );
    expect(issues.map((issue) => issue.field)).toEqual(expect.arrayContaining([
      'proposal.firstStation',
      'proposal.stoppingEvidence',
    ]));
  });
});

describe('goal-clarification-contract · Phase 1 shadow 观测', () => {
  const proposal = { direction: 'x', firstStation: 'y', stoppingEvidence: 'z' };

  it('提案存在且契约有 first-station 级未知 → 产出「本应拦截」观测', () => {
    const observation = buildClarificationShadowObservation({
      conversationId: 'gc-1',
      stage: 'proposing',
      clarification: { ...cltAfterTurn2, baseline: { ...cltAfterTurn2.baseline, unknown: [] } },
      nextAction: 'propose',
      confirmedProposal: proposal,
    });
    expect(observation).toEqual(expect.objectContaining({
      conversationId: 'gc-1',
      stage: 'proposing',
      nextAction: 'propose',
      blocking: ['unknowns.first-station'],
    }));
    expect(observation?.unknowns.map((unknown) => unknown.id)).toContain('u2');
  });

  it('契约允许提案 → 不记 shadow（避免噪声）', () => {
    const observation = buildClarificationShadowObservation({
      conversationId: 'gc-2',
      stage: 'proposing',
      clarification: {
        ...cltAfterTurn2,
        baseline: { ...cltAfterTurn2.baseline, unknown: [] },
        unknowns: [],
      },
      nextAction: 'propose',
      confirmedProposal: proposal,
    });
    expect(observation).toBeNull();
  });

  it('没有提案（ask 且无 confirmedProposal）→ 不记 shadow', () => {
    const observation = buildClarificationShadowObservation({
      conversationId: 'gc-3',
      stage: 'understanding',
      clarification: cltAfterTurn2,
      nextAction: 'ask',
      confirmedProposal: null,
    });
    expect(observation).toBeNull();
  });

  it('模型没产出 clarification → 不记 shadow', () => {
    const observation = buildClarificationShadowObservation({
      conversationId: 'gc-4',
      stage: 'proposing',
      clarification: undefined,
      nextAction: 'propose',
      confirmedProposal: proposal,
    });
    expect(observation).toBeNull();
  });
});

describe('goal-clarification-contract · Phase 2 门控与 Path 回路', () => {
  it('decideClarificationGate：提案存在且有 first-station 未知 → blocked + 提问', () => {
    const decision = decideClarificationGate({
      clarification: cltAfterTurn2,
      nextAction: 'propose',
      confirmedProposal: { direction: 'x' },
      stage: 'proposing',
    });
    expect(decision.blocked).toBe(true);
    expect(decision.blocking).toContain('unknowns.first-station');
    expect(decision.prompt).toContain('样例效应');
  });

  it('decideClarificationGate：没有提案时不算拦截', () => {
    const decision = decideClarificationGate({
      clarification: cltAfterTurn2,
      nextAction: 'ask',
      confirmedProposal: null,
      stage: 'understanding',
    });
    expect(decision.blocked).toBe(false);
  });

  it('decideClarificationGate：提案回合 baseline.unknown 未消化 → blocked，并追问具体条目', () => {
    const decision = decideClarificationGate({
      clarification: {
        ...cltAfterTurn2,
        baseline: {
          ...cltAfterTurn2.baseline,
          unknown: ['常看的标的与周期（日线还是分钟线）'],
        },
        unknowns: [],
      },
      nextAction: 'propose',
      confirmedProposal: { direction: 'x' },
      stage: 'proposing',
    });
    expect(decision.blocked).toBe(true);
    expect(decision.blocking).toContain('baseline.unknown');
    expect(decision.prompt).toContain('常看的标的与周期');
  });

  it('decideClarificationGate：缺 baseline 不拦提案（advisory）；缺停机条件给兜底提问', () => {
    const baselineMissing = decideClarificationGate({
      clarification: {
        ...cltAfterTurn2,
        baseline: { known: [], unknown: [], misconceptions: [], evidence: [] },
        unknowns: [],
      },
      nextAction: 'propose',
      confirmedProposal: { direction: 'x' },
      stage: 'proposing',
    });
    expect(baselineMissing.blocked).toBe(false);

    const stoppingMissing = decideClarificationGate({
      clarification: {
        ...cltAfterTurn2,
        baseline: { ...cltAfterTurn2.baseline, unknown: [] },
        stopping: { ...cltAfterTurn2.stopping, statement: null },
        unknowns: [],
      },
      nextAction: 'propose',
      confirmedProposal: { direction: 'x' },
      stage: 'proposing',
    });
    expect(stoppingMissing.blocked).toBe(true);
    expect(stoppingMissing.blocking).toContain('stopping.statement');
    expect(stoppingMissing.prompt).toContain('什么算把这件事弄通了');
  });

  it('开关默认开启；0/false/off/no 才关闭（回滚口）', () => {
    expect(isClarificationEnforceEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(isClarificationEnforceEnabled({ GOAL_CLARIFICATION_ENFORCE: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isClarificationEnforceEnabled({ GOAL_CLARIFICATION_ENFORCE: 'false' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isClarificationEnforceEnabled({ GOAL_CLARIFICATION_ENFORCE: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isClarificationEnforceEnabled({ GOAL_CLARIFICATION_ENFORCE: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isClarificationEnforceEnabled({ GOAL_CLARIFICATION_ENFORCE: 'TRUE' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isClarificationEnforceEnabled({ GOAL_CLARIFICATION_ENFORCE: 'on' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('assertClarificationReadyForPath：不完整时抛 CLARIFICATION_REQUIRED 并带 gaps', () => {
    try {
      assertClarificationReadyForPath(cltAfterTurn2);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ClarificationRequiredError);
      expect((error as ClarificationRequiredError).code).toBe('CLARIFICATION_REQUIRED');
      expect((error as ClarificationRequiredError).gaps.map((gap) => gap.field)).toContain('unknowns.first-station');
    }
    expect(() => assertClarificationReadyForPath({ ...cltAfterTurn2, unknowns: [] })).not.toThrow();
  });

  it('auditMilestoneRationales：每个 milestone 有 rationale 且终点 serves=stopping → ok', () => {
    const audit = auditMilestoneRationales([
      { title: 'a', rationale: { serves: 'baseline', evidence: 'baseline.known' } },
      { title: 'b', rationale: { serves: 'core', evidence: 'core.question' } },
      { title: 'c', rationale: { serves: 'stopping', evidence: 'stopping.statement' } },
    ], { ...cltAfterTurn2, unknowns: [] });
    expect(audit.ok).toBe(true);
    expect(audit.stoppingCovered).toBe(true);
  });

  it('auditMilestoneRationales：缺 rationale / 终点不服务 stopping → 失败并给原因', () => {
    const audit = auditMilestoneRationales([
      { title: 'a' },
      { title: 'b', rationale: { serves: 'core', evidence: 'core.question' } },
    ], { ...cltAfterTurn2, unknowns: [] });
    expect(audit.ok).toBe(false);
    expect(audit.missingRationale).toContain(0);
    expect(audit.stoppingCovered).toBe(false);
    expect(audit.reasons.some((reason) => reason.includes('stopping'))).toBe(true);
  });

  it('auditMilestoneRationales：subject 拓扑末单元不是全书终评 → requireStopping=false 时通过', () => {
    const audit = auditMilestoneRationales([
      { title: '第1章 机械运动', rationale: { serves: 'core', evidence: 'core.question' } },
      { title: '第6章 质量与密度', rationale: { serves: 'baseline', evidence: 'baseline.known' } },
    ], { ...cltAfterTurn2, unknowns: [] }, { requireStopping: false });
    expect(audit.ok).toBe(true);
    expect(audit.stoppingCovered).toBe(false);
  });

  it('auditMilestoneRationales：非法 serves 计入 invalidServes', () => {
    const audit = auditMilestoneRationales([
      { rationale: { serves: 'whatever', evidence: 'x' } },
      { rationale: { serves: 'stopping', evidence: 'stopping.statement' } },
    ], { ...cltAfterTurn2, unknowns: [] });
    expect(audit.invalidServes).toContain(0);
    expect(audit.ok).toBe(false);
  });
});

describe('goal-clarification-contract · 宽容归一化', () => {
  it('空输入回落安全默认，不抛错', () => {
    const contract = normalizeClarificationContract(null);
    expect(contract.core.question).toBeNull();
    expect(contract.stopping).toEqual({
      kind: 'explain',
      scope: 'class',
      evidence: 'self',
      statement: null,
    });
    expect(contract.blockingNeed).toBe('none');
    expect(contract.unknowns).toEqual([]);
  });

  it('非法枚举回落默认；空字符串字段视为缺失', () => {
    const contract = normalizeClarificationContract({
      core: { question: '   ', evidence: ['x', ''] },
      stopping: { kind: 'bogus', scope: 'bogus', evidence: 'bogus', statement: '  ' },
      blockingNeed: 'bogus',
      unknowns: [{ id: '', question: '问题', planImpact: 'bogus', discriminates: ['a'] }],
    });
    expect(contract.core.question).toBeNull();
    expect(contract.core.evidence).toEqual(['x']);
    expect(contract.stopping.kind).toBe('explain');
    expect(contract.stopping.scope).toBe('class');
    expect(contract.stopping.evidence).toBe('self');
    expect(contract.blockingNeed).toBe('none');
    expect(contract.unknowns[0]).toEqual({
      id: 'u1',
      question: '问题',
      planImpact: 'later',
      discriminates: ['a'],
    });
  });

  it('未知项缺 question 时丢弃，不产出空问题', () => {
    const contract = normalizeClarificationContract({
      unknowns: [{ id: 'x', question: '' }, { id: 'y', question: '有效问题' }],
    });
    expect(contract.unknowns.map((item) => item.id)).toEqual(['y']);
    expect(deriveClarificationGaps(contract).some((gap) => gap.field.startsWith('unknowns.'))).toBe(false);
  });
});
