import {
  ConceptConsolidatorService,
  candidateFingerprint,
  lexicalSimilarity,
  planMerge,
  validateConsolidation,
  MAX_CANDIDATES,
  type ConceptCandidate,
  type ConceptConsolidatorDeps,
} from '../ConceptConsolidatorService';

const candidate = (conceptKey: string, over: Partial<ConceptCandidate> = {}): ConceptCandidate => ({
  conceptKey,
  label: conceptKey,
  source: 'derived',
  occurrences: 3,
  lastSeenAt: '2026-09-14T10:00:00.000Z',
  pathTitles: [],
  ...over,
});

describe('lexicalSimilarity（自动执行闸门：只看词面）', () => {
  it('完全相同 → 1；只差引号/标点 → 1', () => {
    expect(lexicalSimilarity('离开前翻页立好', '离开前翻页立好')).toBe(1);
    expect(lexicalSimilarity('靠「动作先发生」取胜', '靠动作先发生取胜')).toBe(1);
  });

  it('包含关系（加解释从句/截断变体）→ 高分', () => {
    const score = lexicalSimilarity('离开前翻页立好', '离开前翻页立好：动作先于评价');
    expect(score).toBeGreaterThanOrEqual(0.6);
  });

  it('语义近但词面远 → 低分（这类只记录、不自动执行）', () => {
    const score = lexicalSimilarity('回来后的第一眼第一手交给已翻开的书', '回来后第一手落到哪里');
    expect(score).toBeLessThan(0.5);
  });

  it('完全无关 → 低分', () => {
    expect(lexicalSimilarity('CAP 定理', '酯键水解')).toBeLessThan(0.3);
  });
});

describe('candidateFingerprint（节流指纹）', () => {
  it('与顺序无关，内容变化则变化', () => {
    expect(candidateFingerprint([candidate('a'), candidate('b')]))
      .toBe(candidateFingerprint([candidate('b'), candidate('a')]));
    expect(candidateFingerprint([candidate('a')])).not.toBe(candidateFingerprint([candidate('b')]));
  });
});

describe('validateConsolidation（护栏：模型建议必须落在候选内）', () => {
  const candidates = [
    candidate('离开前翻页立好'),
    candidate('离开前翻页立好：动作先于评价'),
    candidate('回来后的第一眼第一手交给已翻开的书'),
    candidate('回来后第一手落到哪里'),
    candidate('CAP 定理'),
  ];

  it('canonical/aliases 越界 → 整条丢弃', () => {
    const result = validateConsolidation({
      candidates,
      parsed: { merges: [{ canonical: '不存在的概念', aliases: ['离开前翻页立好'], confidence: 0.95, rationale: 'x' }] },
    });
    expect(result.proposals).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  it('把握度不足 → 不进 merges，降级进 ambiguous（观察期正是要这些）', () => {
    const result = validateConsolidation({
      candidates,
      parsed: { merges: [{ canonical: '离开前翻页立好', aliases: ['离开前翻页立好：动作先于评价'], confidence: 0.5, rationale: '像' }] },
    });
    expect(result.proposals).toEqual([]);
    expect(result.ambiguous[0]).toMatchObject({ a: '离开前翻页立好' });
  });

  it('把握度足 + 词面近 → autoApplicable（允许 P2 执行）', () => {
    const result = validateConsolidation({
      candidates,
      parsed: { merges: [{ canonical: '离开前翻页立好', aliases: ['离开前翻页立好：动作先于评价'], confidence: 0.9, rationale: '同一动作' }] },
    });
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].autoApplicable).toBe(true);
    expect(result.proposals[0].lexicalSimilarity).toBeGreaterThanOrEqual(0.5);
  });

  it('把握度足但词面远（语义近义）→ 记录但 autoApplicable=false（跨 path 同词异义的真风险）', () => {
    const result = validateConsolidation({
      candidates,
      parsed: {
        merges: [{
          canonical: '回来后的第一眼第一手交给已翻开的书',
          aliases: ['回来后第一手落到哪里'],
          confidence: 0.9,
          rationale: '同一动作的不同说法',
        }],
      },
    });
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].autoApplicable).toBe(false);
  });

  it('ambiguous / dropCandidates 里的越界名字被过滤', () => {
    const result = validateConsolidation({
      candidates,
      parsed: {
        ambiguous: [{ a: 'CAP 定理', b: '不存在', reason: 'x' }, { a: 'CAP 定理', b: '回来后第一手落到哪里', reason: 'x' }],
        dropCandidates: [{ conceptKey: '不存在', reason: 'x' }, { conceptKey: 'CAP 定理', reason: '命名残缺' }],
      },
    });
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].b).toBe('回来后第一手落到哪里');
    expect(result.dropCandidates).toEqual([{ conceptKey: 'CAP 定理', reason: '命名残缺' }]);
  });
});

describe('planMerge（合并执行计划）', () => {
  const rows = [
    { id: 'r1', conceptKey: '离开前翻页立好', label: '离开前翻页立好', extractionCount: 2, masteryScore: 0.5, lastSeenAt: new Date('2026-09-01') },
    { id: 'r2', conceptKey: '离开前翻页立好：动作先于评价', label: null, extractionCount: 9, masteryScore: 0.9, lastSeenAt: new Date('2026-09-10') },
  ];

  it('优先保留名字已等于规范键的那条（避免改键撞唯一约束）', () => {
    const plan = planMerge(rows, '离开前翻页立好', ['离开前翻页立好：动作先于评价']);
    expect(plan?.winnerId).toBe('r1');
    expect(plan?.winnerPatch).toBeNull();
    expect(plan?.deletedRows.map((row) => row.id)).toEqual(['r2']);
  });

  it('没有同名条目时按 extractionCount → mastery → lastSeenAt 选胜出者，并补 label', () => {
    const plan = planMerge(rows, '离开前：把书翻到下一页立好', ['离开前翻页立好', '离开前翻页立好：动作先于评价']);
    expect(plan?.winnerId).toBe('r2');
    expect(plan?.winnerPatch).toEqual({ conceptKey: '离开前：把书翻到下一页立好', label: '离开前翻页立好：动作先于评价' });
    expect(plan?.deletedRows).toHaveLength(1);
  });

  it('族内不足两条 → 不执行', () => {
    expect(planMerge([rows[0]], '离开前翻页立好', [])).toBeNull();
  });

  it('族匹配走归一化（冒号/引号变体算同族）', () => {
    const plan = planMerge(rows, '离开前翻页立好', ['离开前翻页立好：动作先于评价']);
    expect(plan?.deletedRows).toHaveLength(1);
  });
});

describe('ConceptConsolidatorService（默认观察模式：一个字节都不动数据）', () => {
  const candidates = [
    candidate('离开前翻页立好', { occurrences: 7 }),
    candidate('离开前翻页立好：动作先于评价', { occurrences: 2, pathTitles: ['收尾习惯'] }),
  ];

  function build(over: Partial<ConceptConsolidatorDeps> = {}) {
    const writes = { updateTrace: jest.fn(), deleteTraces: jest.fn(), writeAudit: jest.fn().mockResolvedValue({}) };
    const deps: ConceptConsolidatorDeps = {
      findTraces: jest.fn().mockImplementation(async (args: any) => {
        if (args?.select?.id) return [
          { id: 'r1', conceptKey: '离开前翻页立好', label: '离开前翻页立好', extractionCount: 7, masteryScore: 0.6, lastSeenAt: new Date('2026-09-10') },
          { id: 'r2', conceptKey: '离开前翻页立好：动作先于评价', label: null, extractionCount: 2, masteryScore: 0.5, lastSeenAt: new Date('2026-09-12') },
        ];
        return [
          { conceptKey: '离开前翻页立好', label: '离开前翻页立好', source: 'derived', extractionCount: 7, lastSeenAt: new Date('2026-09-10') },
          { conceptKey: '离开前翻页立好：动作先于评价', label: null, source: 'derived', extractionCount: 2, lastSeenAt: new Date('2026-09-12') },
        ];
      }),
      updateTrace: writes.updateTrace,
      deleteTraces: writes.deleteTraces,
      findEvidence: jest.fn().mockResolvedValue([]),
      findPaths: jest.fn().mockResolvedValue([]),
      readAudit: jest.fn().mockResolvedValue(null),
      writeAudit: writes.writeAudit,
      callSkill: jest.fn().mockResolvedValue({
        success: true,
        output: {
          merges: [{ canonical: '离开前翻页立好', aliases: ['离开前翻页立好：动作先于评价'], confidence: 0.92, rationale: '同一动作的完整说法' }],
          ambiguous: [{ a: '离开前翻页立好', b: '离开前翻页立好：动作先于评价', reason: '边界' }],
          dropCandidates: [],
        },
      }),
      ...over,
    };
    return { service: new ConceptConsolidatorService(deps), deps, writes };
  }

  it('默认 observe：记录审计但不改 memory_traces', async () => {
    const { service, writes } = build();
    const audit = await service.consolidate('u1', { now: new Date('2026-09-15T00:00:00Z') });
    expect(audit?.mode).toBe('observe');
    expect(audit?.stats).toMatchObject({ candidates: 2, proposed: 1, autoApplicable: 1, applied: 0, deleted: 0 });
    expect(writes.updateTrace).not.toHaveBeenCalled();
    expect(writes.deleteTraces).not.toHaveBeenCalled();
    expect(writes.writeAudit).toHaveBeenCalledTimes(1);
  });

  it('节流：同指纹窗口内不重复调 LLM', async () => {
    const { service, deps } = build();
    const first = await service.consolidate('u1', { now: new Date('2026-09-15T00:00:00Z') });
    (deps.readAudit as jest.Mock).mockResolvedValue({ payload: JSON.stringify(first) });
    const second = await service.consolidate('u1', { now: new Date('2026-09-15T01:00:00Z') });
    expect(second).toEqual(first);
    expect(deps.callSkill).toHaveBeenCalledTimes(1);
  });

  it('force 跳过节流；指纹变化也不节流', async () => {
    const { service, deps } = build();
    const first = await service.consolidate('u1', { now: new Date('2026-09-15T00:00:00Z') });
    (deps.readAudit as jest.Mock).mockResolvedValue({ payload: JSON.stringify({ ...first, projectionFingerprint: 'changed' }) });
    await service.consolidate('u1', { now: new Date('2026-09-15T01:00:00Z') });
    expect(deps.callSkill).toHaveBeenCalledTimes(2);
  });

  it('apply 模式：只执行 autoApplicable，并留下可回滚的删除前快照', async () => {
    const { service, writes } = build();
    const audit = await service.consolidate('u1', { mode: 'apply', now: new Date('2026-09-15T00:00:00Z') });
    expect(audit?.stats).toMatchObject({ applied: 1, deleted: 1 });
    expect(writes.deleteTraces).toHaveBeenCalledWith({ where: { id: { in: ['r2'] } } });
    expect(audit?.appliedMerges[0].deletedRows[0]).toMatchObject({ id: 'r2', conceptKey: '离开前翻页立好：动作先于评价' });
  });

  it('apply 模式：需要人工看的（词面远）不自动执行', async () => {
    const { service, writes } = build({
      callSkill: jest.fn().mockResolvedValue({
        success: true,
        output: {
          merges: [{
            canonical: '回来后的第一眼第一手交给已翻开的书',
            aliases: ['回来后第一手落到哪里'],
            confidence: 0.9,
            rationale: '同一动作的不同说法',
          }],
          ambiguous: [],
          dropCandidates: [],
        },
      }),
      findTraces: jest.fn().mockImplementation(async (args: any) => {
        if (args?.select?.id) return [];
        return [
          { conceptKey: '回来后的第一眼第一手交给已翻开的书', label: 'a', source: 'derived', extractionCount: 5, lastSeenAt: new Date() },
          { conceptKey: '回来后第一手落到哪里', label: 'b', source: 'derived', extractionCount: 5, lastSeenAt: new Date() },
        ];
      }),
    });
    const audit = await service.consolidate('u1', { mode: 'apply', now: new Date('2026-09-15T00:00:00Z') });
    expect(audit?.stats.applied).toBe(0);
    expect(writes.deleteTraces).not.toHaveBeenCalled();
    expect(audit?.proposals[0].autoApplicable).toBe(false);
  });

  it('候选不足两条 → 不调用 LLM', async () => {
    const { service, deps } = build({
      findTraces: jest.fn().mockResolvedValue([
        { conceptKey: '只有一个', label: '只有一个', source: 'derived', extractionCount: 1, lastSeenAt: new Date() },
      ]),
    });
    expect(await service.consolidate('u1', { now: new Date() })).toBeNull();
    expect(deps.callSkill).not.toHaveBeenCalled();
  });

  it('LLM 失败 → 不写审计、不改数据，返回上一次结果', async () => {
    const { service, writes, deps } = build({
      callSkill: jest.fn().mockRejectedValue(new Error('llm down')),
    });
    const previous = { schemaVersion: 'concept-merge-audits-v1', mode: 'observe' } as any;
    (deps.readAudit as jest.Mock).mockResolvedValue({ payload: JSON.stringify(previous) });
    const audit = await service.consolidate('u1', { now: new Date('2026-09-15T00:00:00Z') });
    expect(audit).toEqual(previous);
    expect(writes.writeAudit).not.toHaveBeenCalled();
    expect(writes.deleteTraces).not.toHaveBeenCalled();
  });

  it('候选上限受 MAX_CANDIDATES 约束（控 LLM 成本）', async () => {
    const many = Array.from({ length: MAX_CANDIDATES + 20 }, (_, i) => ({
      conceptKey: `概念 ${i}`,
      label: `概念 ${i}`,
      source: 'derived',
      extractionCount: 1,
      lastSeenAt: new Date(),
    }));
    const { service, deps } = build({ findTraces: jest.fn().mockResolvedValue(many) });
    await service.consolidate('u1', { now: new Date() });
    const payload = (deps.callSkill as jest.Mock).mock.calls[0][0];
    expect(payload.candidates).toHaveLength(MAX_CANDIDATES);
  });
});
