/**
 * A 项：条件规则按需注入（2026-09-23）。
 *
 * 契约：
 *  1) 编译产物里以「若输入提供 X / 如果输入提供 X / 若 classroomEventContext…」开头的规则是**条件规则**；
 *  2) system 提示词里**剥掉**条件规则（常驻规则重编号）——system 保持稳定 → KV 前缀缓存不受影响；
 *  3) 条件规则只在**对应输入真的存在**时注入**载荷尾部**（`conditionalRules`）；值条件走 override
 *     （如 `controls.temporalGap.isLongGap === true`）。
 */
const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }));

import {
  splitConditionalRules,
  selectApplicableRules,
  teachingTurnAgentHandler,
  type ConditionalRule,
  type TeachingTurnInput,
} from '../index';

// ─────────────────────────── 纯函数 ───────────────────────────

const SAMPLE = [
  '## 身份',
  '你是老师。',
  '',
  '## 执行规则',
  '',
  '1. 常驻规则甲。',
  '2. 若输入提供 scenario.materials（资料包）：优先引用。',
  '3. 常驻规则乙。',
  '4. 如果输入提供 scenario.taskKcs（KC 列表）：按 KC 组织。',
  '5. 若输入提供 controls.temporalGap 且 temporalGap.isLongGap 为 true：先回捞。',
  '',
  '## 输出字段',
  '- reply',
].join('\n');

describe('splitConditionalRules', () => {
  it('摘出条件规则、常驻规则重编号、其余段落原样保留', () => {
    const { stable, rules } = splitConditionalRules(SAMPLE);

    expect(rules.map((rule) => rule.key)).toEqual(['scenario.materials', 'scenario.taskKcs', 'controls.temporalGap']);
    expect(stable).toContain('1. 常驻规则甲。');
    expect(stable).toContain('2. 常驻规则乙。'); // 重编号（原为 3.）
    expect(stable).not.toContain('若输入提供');
    expect(stable).toContain('## 身份');
    expect(stable).toContain('## 输出字段');
    expect(stable).toContain('- reply');
  });

  it('没有条件规则 → 原样返回（零改动）', () => {
    const plain = '## 执行规则\n\n1. 只有常驻。\n\n## 输出字段\n- reply';
    expect(splitConditionalRules(plain)).toEqual({ stable: plain, rules: [] });
  });

  it('没有执行规则段 → 原样返回、零条件规则', () => {
    const { stable, rules } = splitConditionalRules('## 身份\n你是老师。');
    expect(rules).toHaveLength(0);
    expect(stable).toBe('## 身份\n你是老师。');
  });
});

describe('selectApplicableRules', () => {
  const rules: ConditionalRule[] = [
    { key: 'scenario.materials', text: '若输入提供 scenario.materials：优先引用。' },
    { key: 'scenario.taskKcs', text: '如果输入提供 scenario.taskKcs：按 KC 组织。' },
    { key: 'controls.temporalGap', text: '若输入提供 controls.temporalGap 且 isLongGap 为 true：先回捞。' },
    { key: 'visualOpportunity.suggested', text: '若输入提供 visualOpportunity.suggested === true：必须输出 visual。' },
  ];
  const base = { messages: [] } as unknown as TeachingTurnInput;

  it('字段缺失 → 不带；存在 → 带', () => {
    expect(selectApplicableRules(rules, base)).toHaveLength(0);
    const withMaterials = { ...base, scenario: { materials: [{ title: '附件.pdf' }] } } as never;
    expect(selectApplicableRules(rules, withMaterials)).toEqual(['若输入提供 scenario.materials：优先引用。']);
  });

  it('空数组/空串不算存在', () => {
    expect(selectApplicableRules(rules, { ...base, scenario: { materials: [] } } as never)).toHaveLength(0);
  });

  it('值条件走 override：temporalGap 在、但 isLongGap=false → 不带', () => {
    const present = { ...base, controls: { temporalGap: { isLongGap: false } } } as never;
    expect(selectApplicableRules(rules, present)).toHaveLength(0);
    const longGap = { ...base, controls: { temporalGap: { isLongGap: true } } } as never;
    expect(selectApplicableRules(rules, longGap)).toHaveLength(1);
  });

  it('boolean 只认 true（visualOpportunity.suggested）', () => {
    expect(selectApplicableRules(rules, { ...base, visualOpportunity: { suggested: false } } as never)).toHaveLength(0);
    expect(selectApplicableRules(rules, { ...base, visualOpportunity: { suggested: true } } as never)).toHaveLength(1);
  });
});

// ─────────────────────────── 接线（真实编译产物） ───────────────────────────

const INPUT: TeachingTurnInput = {
  messages: [{ role: 'user', content: '老师，我有点乱。' }],
  learner: {} as TeachingTurnInput['learner'],
  scenario: { subject: '数学', topic: '行程问题', taskTitle: '追及题', taskDescription: '看清谁追谁', taskType: 'practice' },
  knowledge: { points: [] },
};

function basePayload() {
  return {
    reply: '好，我们先把关系摆出来。',
    analysis: {
      cognitiveLevel: 'understand',
      levelScore: 2,
      understanding: 0.4,
      confusionPoints: [],
      engagement: 0.6,
      emotionalState: 'neutral',
      loadIndex: 0.4,
      loadBasis: 'semantic',
    },
    knowledge: { currentPoint: '追及', points: [{ name: '追及', status: 'learning', progress: 40 }] },
    pedagogy: { strategies: ['explain'] },
    control: { isCompletionCandidate: false, shouldTriggerPeer: false },
  };
}

async function capture(input: TeachingTurnInput) {
  mockCallPrompt.mockReset();
  let payload: any = null;
  let spec: any = null;
  mockCallPrompt.mockImplementation(async (capturedSpec: any, payloadInput: any) => {
    spec = capturedSpec;
    payload = capturedSpec.buildUserPayload(payloadInput, {} as never);
    return {
      success: true,
      output: capturedSpec.normalizeOutput(basePayload(), payloadInput),
      runtimeEnvelope: null,
      debug: {},
    };
  });
  await teachingTurnAgentHandler(input);
  return { payload, spec };
}

describe('条件规则接线（真实编译产物）', () => {
  it('输入没有条件字段 → 载荷不带 conditionalRules', async () => {
    const { payload } = await capture(INPUT);
    expect(payload).not.toHaveProperty('conditionalRules');
  });

  it('输入提供 scenario.materials → 只注入对应那条（在载荷尾部）', async () => {
    const { payload } = await capture({
      ...INPUT,
      scenario: { ...INPUT.scenario, materials: [{ title: '水循环.pdf' }] },
    } as never);
    expect(payload.conditionalRules).toContain('【本轮适用规则】');
    expect(payload.conditionalRules).toContain('scenario.materials');
    expect(payload.conditionalRules).not.toContain('scenario.behavioralProfile');
    // 放尾部：位于逐回合变化项之后（不打断前缀缓存）
    expect(Object.keys(payload).indexOf('conditionalRules')).toBe(Object.keys(payload).length - 1);
  });

  it('spec.prepareSystemPrompt 把条件规则从 system 里剥掉（system 稳定 → 可缓存）', async () => {
    const { spec } = await capture(INPUT);
    const original: string = spec.defaultSystemPrompt;
    const stripped: string = await spec.prepareSystemPrompt(original, INPUT, {} as never);

    expect(original).toMatch(/若输入提供/); // 编译产物里本来有
    // 剥离后**不再有"条件规则行"**（边界约束里那条 conditional 约束本次不处理，故不按字样断言）
    expect(stripped).not.toMatch(/^\d+\.\s*(若输入提供|如果输入提供|若 classroomEventContext)/m);
    expect(stripped.length).toBeLessThan(original.length);
    expect(stripped).toContain('## 执行规则');
    expect(stripped).toContain('## 输出字段');
    // 剥掉的量 ≈ 条件规则总量（实测 13 条 / 3,078 字量级）
    expect(original.length - stripped.length).toBeGreaterThan(2500);
  });
});
