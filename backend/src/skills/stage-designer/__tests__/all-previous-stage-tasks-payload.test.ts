/**
 * #249 回归：`allPreviousStageTasks` 到不了模型。
 *
 * 现象：编排层在 stageIndex>1 时构造该键并打「已注入」日志
 * （`stage-enrichment.ts:532-550`），但 `stageDesigner` 的 `buildUserPayload` 是**手写键白名单**，
 * 两条分支都只列固定键、不做其余键透传 ⇒ 键在 skill 边界被静默丢弃，模型侧从未见过它。
 *
 * 本测试直接驱动真实 `stageDesigner()`，用 mock 的 callPrompt 拿到 spec + payload，
 * 再跑真实 `buildUserPayload`，断言：
 *  ① 顶层键里必须出现 `allPreviousStageTasks`（否则提示词里是死引用）；
 *  ② 白名单**原有键一个不少**（没修过头：不许为了加键而裁掉别的键）；
 *  ③ 两条分支（稳定前缀 / PAYLOAD_STABLE_PREFIX=0 回退）口径一致。
 */
const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }));

import { stageDesigner } from '../index';

type CapturedSpec = { spec: any; payload: any };

let captured: CapturedSpec | null = null;

const INPUT = {
  milestone: { stageNumber: 3, title: 'M3 实战', goal: 'g', coreConcept: 'c' },
  cognitiveCore: { coreConcept: 'c' },
  normalizedInput: {
    version: '1.0',
    learnerProfile: { surfaceGoal: 'g' },
    resources: { materials: [{ title: '嵌套资料' }] },
  },
  materials: [{ title: '投影资料' }],
  previousMilestone: { stageNumber: 2, tasks: [{ title: 't2' }] },
  pathStageMap: { stageCount: 3, currentStageNumber: 3, stages: [] },
  schoolAnchor: { textbook: '人教版' },
  firstDeliverable: '一份可交付物',
  successCriteria: { observableResult: 'o', acceptanceCheck: 'a' },
  repairHints: { fix: 'x' },
  previousStageOutcome: { fragile: ['a'] },
  supplementRequest: { target: 'b' },
  allPreviousStageTasks: [
    { stageNumber: 1, tasks: ['t1a', 't1b'] },
    { stageNumber: 2, tasks: ['t2a'] },
  ],
};

// 白名单原有键（加 allPreviousStageTasks 之前的完整集合）。
const ORIGINAL_KEYS = [
  'cognitiveCore',
  'normalizedInput',
  'materials',
  'milestone',
  'previousMilestone',
  'pathStageMap',
  'schoolAnchor',
  'firstDeliverable',
  'successCriteria',
  'repairHints',
  'previousStageOutcome',
  'supplementRequest',
];

async function buildUserPayload(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  captured = null;
  mockCallPrompt.mockImplementation(async (spec: any, payload: any) => {
    captured = { spec, payload };
    return {
      success: true,
      output: spec.normalizeOutput({ subtasks: [] }, payload),
      debug: {
        durationMs: 1,
        rawModelOutput: '{}',
        extractedJson: '{}',
        userPayload: '',
        systemPromptVersion: 'test',
      },
    };
  });
  await stageDesigner(input);
  if (!captured) throw new Error('buildUserPayload 未被触达');
  return captured.spec.buildUserPayload(captured.payload, {}) as Record<string, unknown>;
}

describe('#249 stage-designer 载荷：allPreviousStageTasks 必须过白名单', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PAYLOAD_STABLE_PREFIX;
  });

  afterAll(() => {
    delete process.env.PAYLOAD_STABLE_PREFIX;
  });

  it('稳定前缀分支（默认）：顶层键里出现 allPreviousStageTasks，且值与入参一致', async () => {
    const built = await buildUserPayload(INPUT);
    expect(Object.prototype.hasOwnProperty.call(built, 'allPreviousStageTasks')).toBe(true);
    expect(built.allPreviousStageTasks).toEqual(INPUT.allPreviousStageTasks);
  });

  it('PAYLOAD_STABLE_PREFIX=0 回退分支：同样带出该键（两条分支口径一致）', async () => {
    process.env.PAYLOAD_STABLE_PREFIX = '0';
    const built = await buildUserPayload(INPUT);
    expect(Object.prototype.hasOwnProperty.call(built, 'allPreviousStageTasks')).toBe(true);
    expect(built.allPreviousStageTasks).toEqual(INPUT.allPreviousStageTasks);
  });

  it('没修过头：两条分支里原有键一个不少，且没有多出计划外的键', async () => {
    const expected = [...ORIGINAL_KEYS, 'allPreviousStageTasks'].sort();
    for (const mode of [undefined, '0']) {
      if (mode === undefined) delete process.env.PAYLOAD_STABLE_PREFIX;
      else process.env.PAYLOAD_STABLE_PREFIX = mode;
      const built = await buildUserPayload(INPUT);
      for (const key of ORIGINAL_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(built, key)).toBe(true);
      }
      expect(Object.keys(built).sort()).toEqual(expected);
    }
  });

  it('恒发键：编排层未注入时（stage1）该键以 null 出现，可从载荷直方图看出是否为空', async () => {
    const { allPreviousStageTasks: _omit, ...stage1Input } = INPUT;
    const built = await buildUserPayload(stage1Input);
    expect(Object.prototype.hasOwnProperty.call(built, 'allPreviousStageTasks')).toBe(true);
    expect(built.allPreviousStageTasks).toBeNull();
  });

  it('原有行为不变：normalizedInput 的嵌套 materials 仍被剥离', async () => {
    const built = await buildUserPayload(INPUT);
    expect((built.normalizedInput as any).resources.materials).toBeUndefined();
    expect(built.materials).toEqual(INPUT.materials);
  });
});
