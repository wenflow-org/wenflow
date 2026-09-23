/**
 * teaching-turn `visual` 块归一化（owner 口径 2026-09-23：「图片是一种特殊的文字」）。
 *
 * 契约：`visual.prompt` 非空才保留（空/非对象 → 整块丢弃，不编造）；`caption`/`kind` 裁长、空串归 null。
 * 至于"要不要真的画"，不在这里裁决——那是代码闸门（`teaching-visual.service.ts`）。
 */
const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }));

import { teachingTurnAgentHandler, type TeachingTurnInput } from '../index';

const input: TeachingTurnInput = {
  messages: [{ role: 'user', content: '这两条边是不是直角边？' }],
  learner: {} as TeachingTurnInput['learner'],
  scenario: { subject: '数学', topic: '勾股定理', taskTitle: '认直角边', taskDescription: '标出直角边', taskType: 'practice' },
  knowledge: { points: [] },
};

const basePayload = {
  reply: '先想一步：哪两条边夹着直角？',
  analysis: {
    cognitiveLevel: 'understand',
    levelScore: 2,
    understanding: 0.6,
    confusionPoints: [],
    engagement: 0.8,
    emotionalState: 'neutral',
    loadIndex: 0.4,
    loadBasis: 'semantic',
  },
  knowledge: { currentPoint: '直角边', points: [{ name: '直角边', status: 'learning', progress: 50 }] },
  pedagogy: { strategies: ['explain'] },
  control: { isCompletionCandidate: false, shouldTriggerPeer: false },
};

async function runWithVisual(raw: any): Promise<any> {
  mockCallPrompt.mockReset();
  mockCallPrompt.mockImplementation(async (spec: any) => ({
    success: true,
    output: spec.normalizeOutput(raw, input),
    runtimeEnvelope: null,
    debug: {},
  }));
  const output = await teachingTurnAgentHandler(input);
  return (output.internal?.ext as any)?.teaching;
}

describe('teaching-turn visual 归一化', () => {
  beforeEach(() => mockCallPrompt.mockReset());

  it('有 prompt 才保留；caption/kind 裁长与空串归 null', async () => {
    const teaching = await runWithVisual({
      ...basePayload,
      visual: { prompt: '  一个直角三角形，直角在左下角，两条直角边分别标 3 和 4  ', caption: ' 先把边标上 ', kind: '示意图' },
    });
    expect(teaching.visual).toEqual({
      prompt: '一个直角三角形，直角在左下角，两条直角边分别标 3 和 4',
      caption: '先把边标上',
      kind: '示意图',
    });
  });

  it('prompt 空白 / visual 非对象 → 整块丢弃（不编造）', async () => {
    expect((await runWithVisual({ ...basePayload, visual: { prompt: '   ' } })).visual).toBeUndefined();
    expect((await runWithVisual({ ...basePayload, visual: '示意图' })).visual).toBeUndefined();
    expect((await runWithVisual({ ...basePayload })).visual).toBeUndefined();
  });

  it('caption/kind 缺省 → null（不默认填字）', async () => {
    const teaching = await runWithVisual({ ...basePayload, visual: { prompt: '两条平行线被一条斜线穿过，标出内错角' } });
    expect(teaching.visual).toEqual({ prompt: '两条平行线被一条斜线穿过，标出内错角', caption: null, kind: null });
  });
});
