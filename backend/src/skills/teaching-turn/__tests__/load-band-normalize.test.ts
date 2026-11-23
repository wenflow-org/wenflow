/**
 * P1-5：loadBand 为权威档位，numeric loadIndex 由代码映射；legacy 数值保持原样。
 * 重点守「无证据 → unknown/0.5/absent」，不能误落 under/hint。
 */
import { normalizeOutput, type TeachingTurnInput } from '../index';

const input: TeachingTurnInput = {
  messages: [{ role: 'user', content: '这一步我不太确定。' }],
  learner: {} as TeachingTurnInput['learner'],
  scenario: {
    subject: 'TypeScript',
    topic: '条件类型',
    taskTitle: '理解条件类型',
    taskDescription: '解释条件类型的基本行为',
    taskType: 'practice',
  },
  knowledge: { points: [] },
};

const outputWith = (analysis: Record<string, unknown>) => ({
  reply: '我们先拆成两步来看。',
  analysis: {
    cognitiveLevel: 'understand',
    levelScore: 2,
    understanding: 0.5,
    confusionPoints: [],
    engagement: 0.6,
    emotionalState: 'neutral',
    ...analysis,
  },
  knowledge: { currentPoint: '条件类型', points: [] },
  pedagogy: { strategies: ['worked-example'] },
  control: { isCompletionCandidate: false, shouldTriggerPeer: false },
});

async function normalizedAnalysis(analysis: Record<string, unknown>) {
  return normalizeOutput(outputWith(analysis), input).analysis as unknown as Record<string, unknown>;
}

describe('teaching-turn loadBand 归一', () => {
  it('显式 loadBand → numeric 用档位中点（不再保留模型浮点）', async () => {
    const a = await normalizedAnalysis({ loadBand: 'overload', loadIndex: 0.73, loadBasis: 'semantic' });
    expect(a.loadBand).toBe('overload');
    expect(a.loadIndex).toBe(0.9);
    expect(a.loadBasis).toBe('semantic');
  });

  it('loadBand=unknown → 0.5 且 loadBasis 强制 absent（不误落 under/hint）', async () => {
    const a = await normalizedAnalysis({ loadBand: 'unknown', loadIndex: 0.7, loadBasis: 'semantic' });
    expect(a.loadBand).toBe('unknown');
    expect(a.loadIndex).toBe(0.5);
    expect(a.loadBasis).toBe('absent');
  });

  it('有档位但没给依据 → 按文本语义 semantic 兜底', async () => {
    const a = await normalizedAnalysis({ loadBand: 'hint' });
    expect(a.loadBand).toBe('hint');
    expect(a.loadIndex).toBe(0.7);
    expect(a.loadBasis).toBe('semantic');
  });

  it('legacy「无证据」契约（0.5 + absent）→ unknown，不被 numeric 反推成 flow', async () => {
    const a = await normalizedAnalysis({ loadIndex: 0.5, loadBasis: 'absent' });
    expect(a.loadBand).toBe('unknown');
    expect(a.loadIndex).toBe(0.5);
    expect(a.loadBasis).toBe('absent');
  });

  it('legacy numeric（无 loadBand）→ 原值保留，档位由阈值反推', async () => {
    const a = await normalizedAnalysis({ loadIndex: 0.4, loadBasis: 'structure' });
    expect(a.loadIndex).toBe(0.4);
    expect(a.loadBand).toBe('flow');
    expect(a.loadBasis).toBe('structure');
  });

  it('两者都缺 → unknown / 0.5 / absent', async () => {
    const a = await normalizedAnalysis({});
    expect(a.loadBand).toBe('unknown');
    expect(a.loadIndex).toBe(0.5);
    expect(a.loadBasis).toBe('absent');
  });
});
