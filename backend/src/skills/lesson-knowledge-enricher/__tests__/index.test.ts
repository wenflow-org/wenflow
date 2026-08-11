const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }));

import { lessonKnowledgeEnricher } from '../index';
import type { LessonKnowledgeEnricherInput } from '../index';

const input: LessonKnowledgeEnricherInput = {
  knowledgeState: [{ name: 'A', status: 'mastered', progress: 100 }],
  knowledgeDelta: { newlyMastered: ['A'] },
  taskContext: { learningPathId: 'path-1', taskId: 'task-1' },
};

describe('lesson-knowledge-enricher 失败显式传播', () => {
  beforeEach(() => jest.clearAllMocks());

  it('callPrompt 抛错 → handler 直接 throw（不再返回 success:true + fallback 伪数据）', async () => {
    mockCallPrompt.mockRejectedValue(new Error('provider timeout'));
    await expect(lessonKnowledgeEnricher(input)).rejects.toThrow('provider timeout');
    expect(mockCallPrompt).toHaveBeenCalledTimes(1);
  });

  it('callPrompt success:false → handler throw（保留错误信息）', async () => {
    mockCallPrompt.mockResolvedValue({
      success: false,
      error: { code: 'SKILL_X_FAILED', message: 'validation failed' },
      debug: { durationMs: 12 },
    });
    await expect(lessonKnowledgeEnricher(input)).rejects.toThrow('validation failed');
  });
});

describe('lesson-knowledge-enricher normalize（不注入伪值）', () => {
  beforeEach(() => jest.clearAllMocks());

  it('模型输出空数组 → 输出保持空数组，不注入伪置信度/伪台账', async () => {
    mockCallPrompt.mockImplementation(async (spec: any, payload: any) => {
      const normalized = spec.normalizeOutput({}, payload);
      return { success: true, output: normalized, debug: { durationMs: 5 } };
    });

    const result = await lessonKnowledgeEnricher(input);

    expect(result.success).toBe(true);
    expect(result.quality).toBe('model');
    expect(result.output?.conceptLedger).toEqual([]);
    expect(result.output?.reusableFoundations).toEqual([]);
    expect(result.output?.blockedFoundations).toEqual([]);
    expect(result.output?.transferSignals).toEqual([]);
    expect(result.output?.recurringConfusions).toEqual([]);
  });

  it('模型产出的 confidence 原样保留（不覆盖为 0.8/0.65 等伪值）', async () => {
    mockCallPrompt.mockImplementation(async (spec: any, payload: any) => {
      const normalized = spec.normalizeOutput({
        conceptLedger: [
          { conceptKey: 'A', label: 'A', familiarity: 'stable', transferReadiness: 'high', misconceptionRisk: 'low', evidenceCount: 3 },
        ],
        transferSignals: [{ conceptKey: 'A', label: 'A', readiness: 'high', confidence: 0.91 }],
        recurringConfusions: [{ conceptKey: 'B', label: 'B', pattern: 'p', confidence: 0.73, count: 2 }],
      }, payload);
      return { success: true, output: normalized, debug: { durationMs: 5 } };
    });

    const result = await lessonKnowledgeEnricher(input);

    expect(result.success).toBe(true);
    expect(result.output?.transferSignals?.[0].confidence).toBe(0.91);
    expect(result.output?.recurringConfusions?.[0].confidence).toBe(0.73);
    expect(result.output?.conceptLedger?.[0].evidenceCount).toBe(3);
  });

  it('部分字段缺失时仅做字段级归一化（confidence 缺省 clamp，不注入整段伪数组）', async () => {
    mockCallPrompt.mockImplementation(async (spec: any, payload: any) => {
      const normalized = spec.normalizeOutput({
        conceptLedger: [{ conceptKey: 'A', label: 'A' }],
        transferSignals: [{ conceptKey: 'A', label: 'A', readiness: 'high' }],
      }, payload);
      return { success: true, output: normalized, debug: { durationMs: 5 } };
    });

    const result = await lessonKnowledgeEnricher(input);

    expect(result.output?.conceptLedger).toHaveLength(1);
    expect(result.output?.conceptLedger?.[0].evidenceCount).toBe(1);
    expect(result.output?.transferSignals?.[0].confidence).toBe(0.5);
    expect(result.output?.recurringConfusions).toEqual([]);
  });
});
