/**
 * 契约闭环对账门禁测试（#199）
 *
 * 覆盖三层判据：
 * 1) 实参对账：装配层 handed 键根必须落在 skill 的 inputs 声明（或豁免）；
 * 2) 消费者存在性：handoff 目标必须可定位（manifest agent/skill 或阶段编排 agent）；
 * 3) 产出-消费闭环：skill: 输入 ref 指向上游 core 的产出字段。
 *
 * 真实编排 + 真实 core 必须零告警，且判据对象非空跑；每类注入缺陷都必须被报出。
 */

import {
  checkContractClosure,
  checkDeclaredInputDelivery,
  checkHandoffConsumers,
  checkProducerContracts,
  checkSandboxRefs,
  checkSkillInputArgs,
  declaredInputKeys,
  SKILL_INPUT_ARG_EXEMPTIONS,
  SKILL_INPUT_DEAD_EDGE_EXEMPTIONS,
  type ClosureCoreLike,
  type ClosureInputLike,
  type ClosureStageLike,
} from '../contract-closure-check';
import { scanCoreFiles } from '../core-file-loader';
import { loadOrchestrationFiles } from '../../field-routing/orchestration-file';
import { SANDBOX_EXTRA_KEYS } from '../../agent-contract-view';

function core(partial: Partial<ClosureCoreLike> & { skillId: string }): ClosureCoreLike {
  return { fields: [], ...partial };
}

function input(partial: Partial<ClosureInputLike>): ClosureInputLike {
  return {
    kind: 'sandbox',
    skill: '',
    fieldPath: '',
    sandboxPath: '',
    userPath: '',
    ...partial,
  };
}

describe('checkContractClosure（#199 契约闭环）', () => {
  it('真实编排 + 真实 core 零告警，且判据对象非空跑', () => {
    const { files } = scanCoreFiles();
    const stages = loadOrchestrationFiles();

    expect(checkContractClosure({ stages, cores: files })).toEqual([]);

    // 非空跑守卫：确实存在「handoff 指向 skill」的 routing 行，且 core 确实声明了 inputs
    const skillHandoffs = stages.flatMap((stage) =>
      stage.routings.flatMap((routing) => routing.handoff.filter((target) => target.startsWith('skill:'))),
    );
    expect(skillHandoffs.length).toBeGreaterThan(5);
    expect(files.filter((file) => (file.inputs ?? []).length > 0).length).toBeGreaterThan(10);
  });
});

describe('checkSkillInputArgs（实参对账）', () => {
  const stages: ClosureStageLike[] = [
    {
      stage: 'teaching',
      contracts: [{ agentId: 'teaching-agent' }],
      routings: [{ agentId: 'skill:teaching-turn', fieldId: 'control.trigger', handoff: ['skill:peer-reinforcement'] }],
    },
  ];

  it('复现 #199 原病灶：三条「声明≠载荷」都会被拦下', () => {
    // 修复前的三条真实声明（path.yaml / teaching.yaml / profile/teaching 的 learning-predictor 链路）
    const originalStages: ClosureStageLike[] = [
      {
        stage: 'teaching',
        contracts: [{ agentId: 'teaching-agent' }],
        routings: [
          { agentId: 'teaching-agent', fieldId: 'knowledgeStateSummary', handoff: ['skill:learning-predictor'] },
          { agentId: 'skill:teaching-turn', fieldId: 'control.shouldTriggerPeer', handoff: ['skill:peer-reinforcement', 'teaching-agent'] },
        ],
      },
      {
        stage: 'path',
        contracts: [{ agentId: 'path-agent' }],
        routings: [
          { agentId: 'skill:path-reviewer', fieldId: 'replanInstructions', handoff: ['path-agent', 'skill:path-planning'] },
        ],
      },
    ];
    const cores: ClosureCoreLike[] = [
      // 修复前 learning-predictor 没有任何 inputs 声明
      core({ skillId: 'learning-predictor', fields: [] }),
      // path-planning 只声明 replan，没有 replanInstructions
      core({ skillId: 'path-planning', fields: [], inputs: [input({ name: 'replan', ref: 'sandbox:path.replan', sandboxPath: 'path.replan' })] }),
      // peer-reinforcement 声明 reply/analysis 的来源，但没有 control
      core({
        skillId: 'peer-reinforcement',
        fields: [],
        inputs: [input({ kind: 'skill', skill: 'teaching-turn', fieldPath: 'reply', ref: 'skill:teaching-turn.reply' })],
      }),
    ];

    const issues = checkSkillInputArgs(originalStages, cores);
    expect(issues).toHaveLength(3);
    expect(issues.every((issue) => issue.code === 'skill-input-undeclared-arg')).toBe(true);
    const text = issues.map((issue) => issue.message).join('\n');
    expect(text).toContain('skill:learning-predictor');
    expect(text).toContain('knowledgeStateSummary');
    expect(text).toContain('skill:path-planning');
    expect(text).toContain('replanInstructions');
    expect(text).toContain('skill:peer-reinforcement');
    expect(text).toContain('control');
  });

  it('装配层交付的键未在 inputs 声明 → skill-input-undeclared-arg', () => {
    const issues = checkSkillInputArgs(stages, [core({ skillId: 'peer-reinforcement', fields: [] })]);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('skill-input-undeclared-arg');
    expect(issues[0].message).toContain('control');
    expect(issues[0].message).toContain('peer-reinforcement');
  });

  it('声明了同根的输入（name 或 ref 来源根）即通过', () => {
    const byName = checkSkillInputArgs(stages, [
      core({
        skillId: 'peer-reinforcement',
        fields: [],
        inputs: [input({ name: 'control', ref: 'sandbox:teaching.control' })],
      }),
    ]);
    expect(byName).toEqual([]);

    const byRefRoot = checkSkillInputArgs(stages, [
      core({
        skillId: 'peer-reinforcement',
        fields: [],
        inputs: [input({ kind: 'skill', skill: 'teaching-turn', fieldPath: 'control.trigger', ref: 'skill:teaching-turn.control.trigger' })],
      }),
    ]);
    expect(byRefRoot).toEqual([]);
  });

  it('已登记豁免可放行（验收购建里明确允许的「或已登记为豁免」）', () => {
    const before = SKILL_INPUT_ARG_EXEMPTIONS['peer-reinforcement'];
    (SKILL_INPUT_ARG_EXEMPTIONS as Record<string, readonly string[]>)['peer-reinforcement'] = ['control'];
    try {
      expect(checkSkillInputArgs(stages, [core({ skillId: 'peer-reinforcement', fields: [] })])).toEqual([]);
    } finally {
      if (before === undefined) delete (SKILL_INPUT_ARG_EXEMPTIONS as Record<string, readonly string[]>)['peer-reinforcement'];
      else (SKILL_INPUT_ARG_EXEMPTIONS as Record<string, readonly string[]>)['peer-reinforcement'] = before;
    }
  });
});

describe('checkHandoffConsumers（消费者存在性）', () => {
  it('manifest 内 agent/skill 目标可定位', () => {
    const stages: ClosureStageLike[] = [
      {
        stage: 'teaching',
        contracts: [{ agentId: 'teaching-agent' }],
        routings: [{ agentId: 'skill:teaching-turn', fieldId: 'reply', handoff: ['teaching-agent', 'skill:peer-reinforcement'] }],
      },
    ];
    expect(checkHandoffConsumers(stages)).toEqual([]);
  });

  it('阶段名有编排 agent 时可定位', () => {
    const stages: ClosureStageLike[] = [
      {
        stage: 'path',
        contracts: [{ agentId: 'path-agent' }],
        routings: [{ agentId: 'path-agent', fieldId: 'path.name', handoff: ['teaching'] }],
      },
      { stage: 'teaching', contracts: [{ agentId: 'teaching-agent' }], routings: [] },
    ];
    expect(checkHandoffConsumers(stages)).toEqual([]);
  });

  it('无法定位的目标 → handoff-consumer-unresolvable', () => {
    const stages: ClosureStageLike[] = [
      {
        stage: 'path',
        contracts: [{ agentId: 'path-agent' }],
        routings: [
          { agentId: 'path-agent', fieldId: 'path.name', handoff: ['skill:ghost-skill'] },
          { agentId: 'path-agent', fieldId: 'path.summary', handoff: ['profile'] },
        ],
      },
    ];
    const issues = checkHandoffConsumers(stages);
    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.code === 'handoff-consumer-unresolvable')).toBe(true);
    expect(issues.map((issue) => issue.message).join('\n')).toContain('skill:ghost-skill');
  });
});

describe('checkProducerContracts（产出-消费闭环）', () => {
  it('被消费字段在上游 fields 声明 → 通过', () => {
    const cores: ClosureCoreLike[] = [
      core({ skillId: 'path-planning', fields: [{ name: 'milestones' }] }),
      core({
        skillId: 'stage-designer',
        fields: [],
        inputs: [input({ kind: 'skill', skill: 'path-planning', fieldPath: 'milestones.title', ref: 'skill:path-planning.milestones' })],
      }),
    ];
    expect(checkProducerContracts(cores)).toEqual([]);
  });

  it('上游无该产出字段 → input-producer-field-undeclared', () => {
    const cores: ClosureCoreLike[] = [
      core({ skillId: 'path-planning', fields: [{ name: 'milestones' }] }),
      core({
        skillId: 'stage-designer',
        fields: [],
        inputs: [input({ kind: 'skill', skill: 'path-planning', fieldPath: 'ghostField', ref: 'skill:path-planning.ghostField' })],
      }),
    ];
    const issues = checkProducerContracts(cores);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('input-producer-field-undeclared');
    expect(issues[0].message).toContain('ghostField');
  });

  it('上游 core 不存在 → input-producer-core-missing', () => {
    const cores: ClosureCoreLike[] = [
      core({
        skillId: 'stage-designer',
        fields: [],
        inputs: [input({ kind: 'skill', skill: 'ghost-skill', fieldPath: 'x', ref: 'skill:ghost-skill.x' })],
      }),
    ];
    const issues = checkProducerContracts(cores);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('input-producer-core-missing');
  });
});

describe('checkDeclaredInputDelivery（#199 盲区 1 反向死声明）', () => {
  const stages: ClosureStageLike[] = [
    {
      stage: 'teaching',
      contracts: [{ agentId: 'teaching-agent' }],
      // teaching-turn 自动链产出 reply，但 handoff 只给 path-planning，
      // 不给下面声明消费的 peer-reinforcement ⇒ 反向死声明
      routings: [
        { agentId: 'skill:teaching-turn', fieldId: 'reply', handoff: ['skill:path-planning'] },
        // 这一行自动链产出 reply 且 handoff 给 peer-reinforcement ⇒ 正向用例
        { agentId: 'skill:teaching-turn', fieldId: 'analysis.levelScore', handoff: ['skill:peer-reinforcement'] },
      ],
    },
  ];

  it('正向：声明的 skill 输入确实在自动链上被 handoff 给本 skill → 通过', () => {
    const cores: ClosureCoreLike[] = [
      core({ skillId: 'teaching-turn', fields: [{ name: 'analysis' }] }),
      core({
        skillId: 'peer-reinforcement',
        fields: [],
        inputs: [input({ kind: 'skill', skill: 'teaching-turn', fieldPath: 'analysis.levelScore', ref: 'skill:teaching-turn.analysis.levelScore' })],
      }),
    ];
    expect(checkDeclaredInputDelivery(stages, cores)).toEqual([]);
    // 同时确认整体闭环零告警（reverse 方向不污染前向判断）
    expect(checkContractClosure({ stages, cores })).toEqual([]);
  });

  it('反向：声明消费 skill:teaching-turn.reply，但自动链从不 handoff 给本 skill → skill-input-dead-declaration', () => {
    const cores: ClosureCoreLike[] = [
      core({
        skillId: 'peer-reinforcement',
        fields: [],
        inputs: [input({ kind: 'skill', skill: 'teaching-turn', fieldPath: 'reply', ref: 'skill:teaching-turn.reply' })],
      }),
    ];
    const issues = checkDeclaredInputDelivery(stages, cores);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('skill-input-dead-declaration');
    expect(issues[0].message).toContain('peer-reinforcement');
    expect(issues[0].message).toContain('reply');
  });

  it('非自动边（reachability: manual）产出、从不 handoff 给本 skill → 不报错（非自动链口径）', () => {
    const manualStages: ClosureStageLike[] = [
      {
        stage: 'teaching',
        contracts: [{ agentId: 'teaching-agent' }],
        routings: [
          { agentId: 'skill:teaching-turn', fieldId: 'reply', handoff: ['skill:path-planning'], reachability: 'manual' },
        ],
      },
    ];
    const cores: ClosureCoreLike[] = [
      core({
        skillId: 'peer-reinforcement',
        fields: [],
        inputs: [input({ kind: 'skill', skill: 'teaching-turn', fieldPath: 'reply', ref: 'skill:teaching-turn.reply' })],
      }),
    ];
    // 该根只有 manual 产出行，不属于「自动链从不交付」口径 ⇒ 放行
    expect(checkDeclaredInputDelivery(manualStages, cores)).toEqual([]);
  });

  it('豁免可放行（与 SKILL_INPUT_ARG_EXEMPTIONS 同机制）', () => {
    const before = SKILL_INPUT_DEAD_EDGE_EXEMPTIONS['peer-reinforcement'];
    (SKILL_INPUT_DEAD_EDGE_EXEMPTIONS as Record<string, readonly string[]>)['peer-reinforcement'] = ['reply'];
    try {
      const cores: ClosureCoreLike[] = [
        core({
          skillId: 'peer-reinforcement',
          fields: [],
          inputs: [input({ kind: 'skill', skill: 'teaching-turn', fieldPath: 'reply', ref: 'skill:teaching-turn.reply' })],
        }),
      ];
      expect(checkDeclaredInputDelivery(stages, cores)).toEqual([]);
    } finally {
      if (before === undefined) delete (SKILL_INPUT_DEAD_EDGE_EXEMPTIONS as Record<string, readonly string[]>)['peer-reinforcement'];
      else (SKILL_INPUT_DEAD_EDGE_EXEMPTIONS as Record<string, readonly string[]>)['peer-reinforcement'] = before;
    }
  });

  it('sandbox / user 输入不参与反向死声明（避免编排注入式交付误报）', () => {
    const cores: ClosureCoreLike[] = [
      core({
        skillId: 'peer-reinforcement',
        fields: [],
        inputs: [input({ name: 'snapshot', ref: 'sandbox:profile.snapshot.dynamicState', sandboxPath: 'profile.snapshot.dynamicState' })],
      }),
    ];
    // 不报错：sandbox 投影键的存在性由 checkSandboxRefs 负责，本判据只治 skill→skill
    expect(checkDeclaredInputDelivery(stages, cores)).toEqual([]);
  });
});

describe('checkSandboxRefs（#199 盲区 3 sandbox ref 语义）', () => {
  const registry = new Map<string, Set<string>>([
    ['teaching-agent', new Set(['scenario', 'scenario.interactionProfile', 'learner.learnerProjection'])],
    ['profile-agent', new Set(['snapshot.dynamicState', 'snapshot.learningControlState'])],
  ]);

  const sandboxInput = (path: string): ClosureInputLike =>
    input({ name: 'k', ref: `sandbox:${path}`, sandboxPath: path });

  it('正向：ref 命中已登记键（精确）通过；未登记的子段/拼错 → 唯一告警', () => {
    const cores: ClosureCoreLike[] = [
      core({ skillId: 'demo', fields: [], inputs: [sandboxInput('teaching.scenario')] }),
      core({ skillId: 'demo', fields: [], inputs: [sandboxInput('teaching.scenario.interactionProfile')] }),
      // 以下两个未登记 ⇒ 告警
      core({ skillId: 'demo', fields: [], inputs: [sandboxInput('teaching.scenario.extra')] }),
      core({ skillId: 'demo', fields: [], inputs: [sandboxInput('profile.snapshot')] }),
    ];
    const issues = checkSandboxRefs([], cores, registry);
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.message).join('\n')).toContain('teaching.scenario.extra');
    expect(issues.map((i) => i.message).join('\n')).toContain('profile.snapshot');
  });

  it('反向：ref 指向不存在的 agent / 缺键 / 未登记键 → sandbox-ref-unregistered', () => {
    const cores: ClosureCoreLike[] = [
      core({ skillId: 'demo', fields: [], inputs: [sandboxInput('nope.x')] }),
      core({ skillId: 'demo', fields: [], inputs: [sandboxInput('teaching.ghost')] }),
      core({ skillId: 'demo', fields: [], inputs: [sandboxInput('teaching.')] }),
    ];
    const issues = checkSandboxRefs([], cores, registry);
    expect(issues).toHaveLength(3);
    expect(issues.every((i) => i.code === 'sandbox-ref-unregistered')).toBe(true);
    expect(issues.map((i) => i.message).join('\n')).toContain('nope');
    expect(issues.map((i) => i.message).join('\n')).toContain('ghost');
  });

  it('canonical agent 名（<stage>-agent）也被接受', () => {
    const cores: ClosureCoreLike[] = [
      core({ skillId: 'demo', fields: [], inputs: [sandboxInput('teaching-agent.scenario')] }),
    ];
    expect(checkSandboxRefs([], cores, registry)).toEqual([]);
  });
});

describe('declaredInputKeys（输入声明可见键）', () => {
  it('合并 name、skill ref 根、sandbox 首段、user 根', () => {
    const keys = declaredInputKeys(
      core({
        skillId: 'demo',
        fields: [],
        inputs: [
          input({ name: 'learner', ref: 'sandbox:teaching.learner.learnerProjection', sandboxPath: 'teaching.learner.learnerProjection' }),
          input({ kind: 'skill', skill: 'path-planning', fieldPath: 'milestones.title', ref: 'skill:path-planning.milestones' }),
          input({ kind: 'user', userPath: 'peerHistory', ref: 'user:peerHistory' }),
        ],
      }),
    );
    expect([...keys].sort()).toEqual(['learner', 'milestones', 'peerHistory']);
  });

  it('learning-predictor 的三个编排注入键已在沙盘注册表登记（#199 补声明配套）', () => {
    const keys = SANDBOX_EXTRA_KEYS['teaching-agent'];
    for (const key of ['knowledgeStateSummary', 'taskContext', 'learningState']) {
      expect(keys).toContain(key);
    }
  });
});
