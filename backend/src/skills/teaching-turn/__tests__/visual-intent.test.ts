/**
 * 视觉意图（2026-11-26 契约层拆分）：模型只交关系与焦点，不写绘图 JSON。
 *
 * 钉住：
 *  1) need=true + focus → 归一化成 { need, relation, focus }，非法 relation 兜底 structure；
 *  2) need≠true / focus 空 → 不产出（等于本轮不介入）；
 *  3) kindHint 只接受白名单图型，非法值丢弃；
 *  4) 旧提示词仍给 figure/diagram 时，归一化保持兼容（不因契约切换丢历史能力）。
 */
const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }));

import { teachingTurnAgentHandler, type TeachingTurnInput, type TeachingTurnOutput } from '../index';

const INPUT: TeachingTurnInput = {
  messages: [{ role: 'user', content: '这里能不能画出来？' }],
  learner: {} as TeachingTurnInput['learner'],
  scenario: { subject: '数学', topic: '追及', taskTitle: '追及题', taskDescription: '谁追谁', taskType: 'practice' },
  knowledge: { points: [] },
};

function basePayload() {
  return {
    reply: '好，我们摆出来看。',
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

async function run(extra: Record<string, unknown>) {
  mockCallPrompt.mockReset();
  mockCallPrompt.mockImplementation(async (spec: any) => ({
    success: true,
    output: spec.normalizeOutput({ ...basePayload(), ...extra }, INPUT),
    runtimeEnvelope: null,
    debug: {},
  }));
  const result = await teachingTurnAgentHandler(INPUT);
  const internal = result.internal as unknown as { ext?: { teaching?: TeachingTurnOutput } };
  return internal.ext?.teaching as TeachingTurnOutput;
}

describe('visualIntent 归一化', () => {
  it('need + focus → 意图保留关系与焦点', async () => {
    const out = await run({ visualIntent: { need: true, relation: 'position', focus: '甲在乙前 40 米，同向追及' } });
    expect(out.visualIntent).toEqual({ need: true, relation: 'position', focus: '甲在乙前 40 米，同向追及' });
  });

  it('非法 relation 兜底 structure；合法 kindHint 保留、非法丢弃', async () => {
    const fallback = await run({ visualIntent: { need: true, relation: 'spiral', focus: '结构关系' } });
    expect(fallback.visualIntent?.relation).toBe('structure');

    const withKind = await run({ visualIntent: { need: true, relation: 'range', focus: '两组区间', kindHint: 'range-bar' } });
    expect(withKind.visualIntent?.kindHint).toBe('range-bar');

    const badKind = await run({ visualIntent: { need: true, relation: 'range', focus: '两组区间', kindHint: 'pie-chart' } });
    expect(badKind.visualIntent?.kindHint).toBeUndefined();
  });

  it('need≠true / focus 空 → 不产出意图', async () => {
    expect((await run({ visualIntent: { need: false, relation: 'position', focus: 'x' } })).visualIntent).toBeUndefined();
    expect((await run({ visualIntent: { need: true, relation: 'position', focus: '  ' } })).visualIntent).toBeUndefined();
    expect((await run({})).visualIntent).toBeUndefined();
  });

  it('旧提示词的 figure/diagram 仍兼容（不因契约切换丢能力）', async () => {
    const out = await run({
      figure: { engine: 'svg', kind: 'position-line', axis: { min: 0, max: 100 }, marks: [{ at: 20, label: '甲' }] },
    });
    expect(out.figure?.kind).toBe('position-line');
  });
});
