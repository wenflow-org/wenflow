import {
  ReplanAttributionService,
  EXECUTABLE_RECOMMENDATIONS,
  isCalibratableDirection,
  normalizeAttribution,
  type ReplanAttributionDeps,
} from '../ReplanAttributionService';
import { applyAttribution, type ReplanAdvisory } from '../ReplanAdvisoryService';

const advisory = (over: Partial<ReplanAdvisory> = {}): ReplanAdvisory => ({
  shouldSuggest: true,
  priority: 'high',
  recommendation: 'slow_down',
  scope: 'next_milestone',
  rationale: '阈值版理由',
  reasonCodes: ['fragile_concepts', 'struggling_concepts'],
  attribution: null,
  ui: {
    title: '建议先调整下一阶段安排',
    body: 'body',
    options: [
      { key: 'keep', label: '保持原计划', description: '' },
      { key: 'reinforce', label: '补强后再进', description: '' },
      { key: 'resequence', label: '调整顺序', description: '' },
    ],
  },
  ...over,
});

describe('normalizeAttribution（护栏）', () => {
  const context = {
    reasonCodes: ['fragile_concepts', 'struggling_concepts'],
    allowedRecommendations: ['keep', 'reinforce', 'resequence'],
    evidenceIds: ['wrapup:summary', 'signal:fragile'],
  };

  it('主因越界 → 取召回的第一项；方向越界 → keep', () => {
    const result = normalizeAttribution({
      primaryReasonCode: '编的原因',
      recommendation: 'drop_course',
      reason: '这些点还不稳',
    }, context);
    expect(result?.primaryReasonCode).toBe('fragile_concepts');
    expect(result?.recommendation).toBe('keep');
  });

  it('证据引用越界被丢；合法的保留', () => {
    const result = normalizeAttribution({
      primaryReasonCode: 'struggling_concepts',
      recommendation: 'reinforce',
      reason: 'x',
      evidenceRefs: ['signal:fragile', '不存在的证据', 'wrapup:summary'],
    }, context);
    expect(result?.evidenceRefs).toEqual(['signal:fragile', 'wrapup:summary']);
  });

  it('reason 为空 → 整条丢弃（不产出没有归因的归因）', () => {
    expect(normalizeAttribution({ recommendation: 'reinforce' }, context)).toBeNull();
    expect(normalizeAttribution(null, context)).toBeNull();
  });

  it('checkOn 只接受 next_lesson / next_task', () => {
    expect(normalizeAttribution({ reason: 'x', checkOn: 'someday' }, context)?.checkOn).toBe('next_lesson');
    expect(normalizeAttribution({ reason: 'x', checkOn: 'next_task' }, context)?.checkOn).toBe('next_task');
  });
});

describe('isCalibratableDirection（只有风险方向与校准口径同向）', () => {
  it('reinforce / slow_down / resequence 可校准；accelerate / keep 不可', () => {
    expect(isCalibratableDirection('reinforce')).toBe(true);
    expect(isCalibratableDirection('slow_down')).toBe(true);
    expect(isCalibratableDirection('resequence')).toBe(true);
    expect(isCalibratableDirection('accelerate')).toBe(false);
    expect(isCalibratableDirection('keep')).toBe(false);
  });
});

describe('applyAttribution（归因合并：只在建议成立时、且方向必须可执行）', () => {
  const attribution = {
    primaryReasonCode: 'struggling_concepts',
    recommendation: 'reinforce',
    reason: '「取大取小依据」连着两次没答对',
    claim: '这些点在下一节仍会不稳',
    checkOn: 'next_lesson' as const,
    expect: '仍不稳',
    evidenceRefs: ['signal:struggling'],
    source: 'llm' as const,
  };

  it('方向落在可选项里 → 采用归因方向，并留下「为什么」', () => {
    const merged = applyAttribution(advisory(), attribution);
    expect(merged.recommendation).toBe('reinforce');
    expect(merged.attribution).toMatchObject({
      primaryReasonCode: 'struggling_concepts',
      reason: '「取大取小依据」连着两次没答对',
      claim: '这些点在下一节仍会不稳',
      thresholdRecommendation: 'slow_down',
    });
    // 阈值给的部分不被改写
    expect(merged.priority).toBe('high');
    expect(merged.reasonCodes).toEqual(['fragile_concepts', 'struggling_concepts']);
  });

  it('方向不在可选项里 → 退回阈值方向（不让 UI 出现"按钮说一套推荐说另一套"）', () => {
    const merged = applyAttribution(advisory(), { ...attribution, recommendation: 'accelerate' });
    expect(merged.recommendation).toBe('slow_down');
    expect(merged.attribution?.thresholdRecommendation).toBe('slow_down');
  });

  it('建议未成立（shouldSuggest=false）→ 不并归因（阈值是唯一召回门）', () => {
    const merged = applyAttribution(advisory({ shouldSuggest: false }), attribution);
    expect(merged.attribution).toBeNull();
  });

  it('归因为空 → 原样返回', () => {
    expect(applyAttribution(advisory(), null)).toEqual(advisory());
  });
});

describe('ReplanAttributionService.attribute（调用 + 降级）', () => {
  function build(over: Partial<ReplanAttributionDeps> = {}) {
    const deps: ReplanAttributionDeps = {
      callSkill: jest.fn().mockResolvedValue({
        success: true,
        output: {
          primaryReasonCode: 'fragile_concepts',
          recommendation: 'reinforce',
          reason: '「翻页立好」这类点还没稳住',
          claim: '下一节这几个点仍会不稳',
          checkOn: 'next_lesson',
          expect: '仍不稳',
          evidenceRefs: ['signal:fragile'],
        },
      }),
      ...over,
    };
    return { service: new ReplanAttributionService(deps), deps };
  }

  const recall = {
    shouldSuggest: true,
    priority: 'high',
    recommendation: 'slow_down',
    scope: 'next_milestone',
    rationale: '阈值版',
    reasonCodes: ['fragile_concepts', 'struggling_concepts'],
  } as any;

  it('正常产出归因，且不把「阈值方向」的能力交出去（方向必须在允许集合内）', async () => {
    const { service, deps } = build();
    const result = await service.attribute({
      recall,
      evidence: [{ id: 'signal:fragile', kind: 'fragile_concepts', text: 'A、B' }],
      allowedRecommendations: ['keep', 'reinforce', 'resequence'],
    });
    expect(result).toMatchObject({ recommendation: 'reinforce', primaryReasonCode: 'fragile_concepts' });
    expect((deps.callSkill as jest.Mock).mock.calls[0][0].allowedRecommendations)
      .toEqual(expect.arrayContaining(['slow_down', 'keep', 'reinforce', 'resequence']));
  });

  it('阈值方向一定放行（即使调用方没列进来）', async () => {
    const { service, deps } = build();
    await service.attribute({
      recall,
      evidence: [],
      allowedRecommendations: ['keep', 'reinforce'],
    });
    expect((deps.callSkill as jest.Mock).mock.calls[0][0].allowedRecommendations).toContain('slow_down');
  });

  it('失败 → 返回 null（调用方保留阈值版）', async () => {
    const { service } = build({ callSkill: jest.fn().mockRejectedValue(new Error('gateway down')) });
    expect(await service.attribute({ recall, evidence: [] })).toBeNull();
  });

  it('超时 → 返回 null，不阻塞课后收束', async () => {
    const { service } = build({ callSkill: jest.fn(() => new Promise(() => { /* 永不 resolve */ })) as any });
    const started = Date.now();
    expect(await service.attribute({ recall, evidence: [], timeoutMs: 30 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('允许集合为空 → 不调 LLM', async () => {
    const { service, deps } = build();
    expect(await service.attribute({ recall, evidence: [], allowedRecommendations: ['nonsense'] })).toBeNull();
    expect(deps.callSkill).not.toHaveBeenCalled();
  });

  it('可执行方向集合与 advisory 的 UI 选项口径一致', () => {
    expect([...EXECUTABLE_RECOMMENDATIONS]).toEqual(['keep', 'reinforce', 'slow_down', 'resequence', 'accelerate']);
  });
});
