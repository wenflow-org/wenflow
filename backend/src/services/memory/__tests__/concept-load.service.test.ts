import {
  ConceptLoadService,
  GRANULARITY_FACTOR,
  HARD_FACTOR,
  PROCEDURAL_FACTOR,
  MAX_JUDGE_BATCH,
  PROFILE_TTL_DAYS,
  mapProfileToLoad,
  normalizeJudgedProfiles,
  profileFactors,
  type ConceptLoadProfile,
  type LoadDeps,
} from '../concept-load.service';
import { estimateConceptLoad } from '../review-plan.service';

const profile = (over: Partial<ConceptLoadProfile> = {}): ConceptLoadProfile => ({
  conceptKey: '离开前翻页立好',
  label: '离开前翻页立好',
  granularity: 'atomic',
  knowledgeType: 'conceptual',
  difficultyBand: 'medium',
  rationale: '',
  source: 'llm',
  judgedAt: '2026-09-15T00:00:00.000Z',
  ...over,
});

describe('normalizeJudgedProfiles（护栏：只认输入里的原文键）', () => {
  const labels = new Map([
    ['离开前翻页立好', '离开前翻页立好'],
    ['CAP 定理', 'CAP 定理'],
  ]);

  it('越界键丢弃；枚举非法值兜底；冒号变体按归一化键收口', () => {
    const result = normalizeJudgedProfiles({
      concepts: [
        { conceptKey: '不存在', granularity: 'cluster', knowledgeType: 'procedural', difficultyBand: 'high' },
        // 冒号后缀 → 归一化后落到「离开前翻页立好」
        { conceptKey: '离开前翻页立好：动作先于评价', granularity: 'cluster', knowledgeType: 'procedural', difficultyBand: 'high', rationale: '含两个动作' },
        { conceptKey: 'CAP 定理', granularity: '???', knowledgeType: '???', difficultyBand: '???' },
      ],
    }, labels, new Date('2026-09-15T00:00:00Z'));

    expect(Object.keys(result).sort()).toEqual(['CAP 定理', '离开前翻页立好']);
    expect(result['离开前翻页立好']).toMatchObject({ granularity: 'cluster', knowledgeType: 'procedural', difficultyBand: 'high' });
    expect(result['CAP 定理'].granularity).toBe('atomic'); // 非法值兜底为最保守档
    expect(result['CAP 定理'].difficultyBand).toBe('unknown');
  });

  it('同一键重复只取第一条', () => {
    const result = normalizeJudgedProfiles({
      concepts: [
        { conceptKey: 'CAP 定理', granularity: 'cluster', knowledgeType: 'factual', difficultyBand: 'low' },
        { conceptKey: 'CAP 定理', granularity: 'atomic', knowledgeType: 'factual', difficultyBand: 'low' },
      ],
    }, labels, new Date('2026-09-15T00:00:00Z'));
    expect(result['CAP 定理'].granularity).toBe('cluster');
  });
});

describe('mapProfileToLoad（LLM 出档位 → 代码出数值）', () => {
  it('没有档位 → 原样返回规则版', () => {
    const result = mapProfileToLoad({ profile: null, ruleLoad: 2.25, ruleFactors: ['granularity:compound'] });
    expect(result).toEqual({ load: 2.25, factors: ['granularity:compound'], source: 'rule' });
  });

  it('档位因子：技能簇 ×1.5 / 程序型 ×1.5 / 高难度 ×1.3，全部只有惩罚', () => {
    expect(mapProfileToLoad({ profile: profile({ granularity: 'cluster' }), ruleLoad: 1, ruleFactors: [] }))
      .toMatchObject({ load: GRANULARITY_FACTOR, source: 'llm' });
    expect(mapProfileToLoad({ profile: profile({ knowledgeType: 'procedural' }), ruleLoad: 1, ruleFactors: [] }))
      .toMatchObject({ load: PROCEDURAL_FACTOR });
    expect(mapProfileToLoad({ profile: profile({ difficultyBand: 'high' }), ruleLoad: 1, ruleFactors: [] }))
      .toMatchObject({ load: HARD_FACTOR });
    // 三个都命中 → 连乘（结果按两位小数收敛）；低难度不降价
    const all = mapProfileToLoad({
      profile: profile({ granularity: 'cluster', knowledgeType: 'procedural', difficultyBand: 'high' }),
      ruleLoad: 1,
      ruleFactors: [],
    });
    expect(all.load).toBe(2.93);
    expect(all.factors).toEqual(['llm:cluster', 'llm:procedural', 'llm:hard']);
    expect(mapProfileToLoad({ profile: profile({ difficultyBand: 'low' }), ruleLoad: 1, ruleFactors: [] }).load).toBe(1);
  });

  it('profileFactors：非惩罚档位不产生因子', () => {
    expect(profileFactors(profile())).toEqual([]);
    expect(profileFactors(null)).toEqual([]);
  });
});

describe('estimateConceptLoad 优先用 LLM 档位（正则误判被替掉）', () => {
  it('正则判成"过程型"但 LLM 判 atomic/factual → 采用 LLM（回到 1.0）', () => {
    const name = '先看形态再允许说「抬高」的顺序';
    const ruleOnly = estimateConceptLoad(name, { masteryScore: 0.9 });
    expect(ruleOnly.factors).toContain('type:process');
    expect(ruleOnly.load).toBeGreaterThan(1);

    const withProfile = estimateConceptLoad(name, {
      masteryScore: 0.9,
      profile: profile({ conceptKey: name, label: name, granularity: 'atomic', knowledgeType: 'factual', difficultyBand: 'low' }),
    });
    expect(withProfile.load).toBe(1);
    expect(withProfile.factors).toEqual([]);
  });

  it('LLM 看出正则漏掉的技能簇 → 采用 LLM 并标 llm: 因子；掌握弱仍按数据加价', () => {
    const name = 'CAP 定理';
    const withProfile = estimateConceptLoad(name, {
      masteryScore: 0.3,
      profile: profile({ conceptKey: name, label: name, granularity: 'cluster', difficultyBand: 'high' }),
    });
    expect(withProfile.factors).toEqual(expect.arrayContaining(['llm:cluster', 'llm:hard', 'unfamiliar:mastery']));
    expect(withProfile.load).toBeCloseTo(Math.min(3, GRANULARITY_FACTOR * HARD_FACTOR * 1.3), 2);
  });

  it('无档位时行为与旧版一致（回归）', () => {
    expect(estimateConceptLoad('CAP 定理', { masteryScore: 0.9 })).toEqual({ load: 1, factors: [] });
    expect(estimateConceptLoad('顺推与倒推的区别', { masteryScore: 0.9 }).factors).toContain('granularity:compound');
  });
});

describe('ConceptLoadService.resolveProfiles（缓存 + 只判缺项 + 失败降级）', () => {
  function build(over: Partial<LoadDeps> = {}) {
    const writes = { writeCache: jest.fn().mockResolvedValue({}) };
    const deps: LoadDeps = {
      findTraceKeys: jest.fn().mockResolvedValue([]),
      readCache: jest.fn().mockResolvedValue(null),
      writeCache: writes.writeCache,
      callSkill: jest.fn().mockResolvedValue({
        success: true,
        output: {
          concepts: [
            { conceptKey: 'A', granularity: 'cluster', knowledgeType: 'procedural', difficultyBand: 'high', rationale: '三个动作' },
            { conceptKey: 'B', granularity: 'atomic', knowledgeType: 'factual', difficultyBand: 'low', rationale: '单词' },
          ],
        },
      }),
      ...over,
    };
    return { service: new ConceptLoadService(deps), deps, writes };
  }

  const cachedCache = {
    payload: JSON.stringify({
      schemaVersion: 'concept-load-profiles-v1',
      generatedAt: '2026-09-15T00:00:00.000Z',
      profiles: { A: profile({ conceptKey: 'A', label: 'A', granularity: 'cluster' }) },
    }),
  };

  it('全部命中且未过期 → 不调 LLM', async () => {
    const { service, deps } = build({ readCache: jest.fn().mockResolvedValue(cachedCache) });
    const result = await service.resolveProfiles('u1', ['A'], { now: new Date('2026-09-15T01:00:00Z') });
    expect(result.source).toBe('cache');
    expect(result.judged).toBe(0);
    expect(result.profiles.get('A')?.granularity).toBe('cluster');
    expect(deps.callSkill).not.toHaveBeenCalled();
  });

  it('缺项才判，判完写入缓存', async () => {
    const { service, deps, writes } = build({ readCache: jest.fn().mockResolvedValue(cachedCache) });
    const result = await service.resolveProfiles('u1', ['A', 'B'], { now: new Date('2026-09-15T01:00:00Z') });
    expect(deps.callSkill).toHaveBeenCalledTimes(1);
    expect((deps.callSkill as jest.Mock).mock.calls[0][0].concepts).toEqual([{ conceptKey: 'B' }]);
    expect(result.source).toBe('llm');
    expect(result.judged).toBe(1);
    expect(result.profiles.size).toBe(2);
    const written = JSON.parse(writes.writeCache.mock.calls[0][0].create.payload);
    expect(Object.keys(written.profiles).sort()).toEqual(['A', 'B']);
  });

  it('过期档位重新判（TTL 之外）', async () => {
    const stale = {
      payload: JSON.stringify({
        schemaVersion: 'concept-load-profiles-v1',
        generatedAt: '2025-01-01T00:00:00.000Z',
        profiles: { A: profile({ conceptKey: 'A', label: 'A', judgedAt: '2025-01-01T00:00:00.000Z' }) },
      }),
    };
    const { service, deps } = build({ readCache: jest.fn().mockResolvedValue(stale) });
    await service.resolveProfiles('u1', ['A'], { now: new Date('2026-09-15T01:00:00Z') });
    expect(deps.callSkill).toHaveBeenCalledTimes(1);
    expect(PROFILE_TTL_DAYS).toBeGreaterThan(0);
  });

  it('LLM 失败 → 用已有缓存兜底，不写缓存、不抛错（调用方回落规则版）', async () => {
    const { service, writes } = build({
      readCache: jest.fn().mockResolvedValue(cachedCache),
      callSkill: jest.fn().mockRejectedValue(new Error('gateway down')),
    });
    const result = await service.resolveProfiles('u1', ['A', 'B'], { now: new Date('2026-09-15T01:00:00Z') });
    expect(result.profiles.get('A')?.granularity).toBe('cluster');
    expect(result.profiles.has('B')).toBe(false);
    expect(result.source).toBe('cache');
    expect(writes.writeCache).not.toHaveBeenCalled();
  });

  it('无缓存且 LLM 失败 → source=degraded（空 Map）', async () => {
    const { service } = build({ callSkill: jest.fn().mockRejectedValue(new Error('gateway down')) });
    const result = await service.resolveProfiles('u1', ['A'], { now: new Date('2026-09-15T01:00:00Z') });
    expect(result.source).toBe('degraded');
    expect(result.profiles.size).toBe(0);
  });

  it('单次判定不超过 MAX_JUDGE_BATCH（控 token）', async () => {
    const many = Array.from({ length: MAX_JUDGE_BATCH + 5 }, (_, i) => `概念${i}`);
    const { service, deps } = build();
    await service.resolveProfiles('u1', many, { now: new Date('2026-09-15T01:00:00Z') });
    expect((deps.callSkill as jest.Mock).mock.calls[0][0].concepts).toHaveLength(MAX_JUDGE_BATCH);
  });

  it('判定超时 → 立即降级（不把开课卡住）', async () => {
    const never = jest.fn(() => new Promise(() => { /* 永不 resolve */ }));
    const { service } = build({ callSkill: never as any });
    const started = Date.now();
    const result = await service.resolveProfiles('u1', ['A'], {
      now: new Date('2026-09-15T01:00:00Z'),
      timeoutMs: 30,
    });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.source).toBe('degraded');
    expect(result.profiles.size).toBe(0);
  });

  it('空输入不调 LLM', async () => {
    const { service, deps } = build();
    const result = await service.resolveProfiles('u1', [], { now: new Date() });
    expect(result.profiles.size).toBe(0);
    expect(deps.callSkill).not.toHaveBeenCalled();
  });
});
