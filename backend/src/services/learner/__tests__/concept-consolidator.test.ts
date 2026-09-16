import {
  ConceptConsolidatorService,
  buildMergedFields,
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

  it('把握度足 + 词面近 → autoApplicable（允许执行）', () => {
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

describe('buildMergedFields（并字段，不是删了就算了）', () => {
  const members = [
    {
      id: 'r1',
      conceptKey: '离开前翻页立好',
      label: '离开前翻页立好',
      source: 'derived',
      masteryScore: 0.5,
      extractionCount: 2,
      lastSeenAt: new Date('2026-09-01'),
      dueAt: new Date('2026-09-16'),
      ktMasteryEma: 0.4,
      fsrsStability: null,
      fsrsDifficulty: null,
    },
    {
      id: 'r2',
      conceptKey: '离开前翻页立好：动作先于评价',
      label: null,
      source: 'derived',
      masteryScore: 0.9,
      extractionCount: 8,
      lastSeenAt: new Date('2026-09-12'),
      dueAt: new Date('2026-09-20'),
      ktMasteryEma: 0.8,
      fsrsStability: 12.5,
      fsrsDifficulty: 4.2,
    },
  ];
  const winner = members[0];

  it('dueAt 取最早、mastery 取最高、extractionCount 取最大、lastSeenAt 取最新', () => {
    const merged = buildMergedFields(members, winner, '离开前翻页立好');
    expect(merged.dueAt).toEqual(new Date('2026-09-16'));
    expect(merged.masteryScore).toBe(0.9);
    expect(merged.extractionCount).toBe(8);
    expect(merged.lastSeenAt).toEqual(new Date('2026-09-12'));
    expect(merged.conceptKey).toBe('离开前翻页立好');
    expect(merged.label).toBe('离开前翻页立好');
  });

  it('ktMasteryEma 按观测数加权；FSRS 取最稳固的那条', () => {
    const merged = buildMergedFields(members, winner, '离开前翻页立好');
    // (0.4*2 + 0.8*8) / 10 = 0.72
    expect(merged.ktMasteryEma).toBe(0.72);
    expect(merged.fsrsStability).toBe(12.5);
    expect(merged.fsrsDifficulty).toBe(4.2);
  });

  it('无 kt/FSRS 时不编造字段', () => {
    const merged = buildMergedFields(
      [{ id: 'a', conceptKey: 'A', label: null, extractionCount: 1, masteryScore: 0.3, lastSeenAt: null, dueAt: null }],
      { id: 'a', conceptKey: 'A', label: null, masteryScore: 0.3, extractionCount: 1, lastSeenAt: null, dueAt: null },
      'A',
    );
    expect(merged.ktMasteryEma).toBeUndefined();
    expect(merged.fsrsStability).toBeUndefined();
    expect(merged.label).toBe('A');
  });
});

describe('planMerge（合并执行计划：整行快照）', () => {
  const rows = [
    { id: 'r1', conceptKey: '离开前翻页立好', label: '离开前翻页立好', extractionCount: 2, masteryScore: 0.5, lastSeenAt: new Date('2026-09-01'), dueAt: new Date('2026-09-16') },
    { id: 'r2', conceptKey: '离开前翻页立好：动作先于评价', label: null, extractionCount: 9, masteryScore: 0.9, lastSeenAt: new Date('2026-09-10'), dueAt: new Date('2026-09-20') },
  ];

  it('优先保留名字已等于规范键的那条（避免改键撞唯一约束）', () => {
    const plan = planMerge(rows, '离开前翻页立好', ['离开前翻页立好：动作先于评价']);
    expect(plan?.winnerId).toBe('r1');
    expect(plan?.winnerBefore).toEqual(rows[0]);
    expect(plan?.deletedRows.map((row) => row.id)).toEqual(['r2']);
    // 并字段：被删那条更早的排期不能丢
    expect(plan?.mergedFields.dueAt).toEqual(new Date('2026-09-16'));
    expect(plan?.mergedFields.masteryScore).toBe(0.9);
  });

  it('没有同名条目时按 extractionCount → mastery → lastSeenAt 选胜出者', () => {
    const plan = planMerge(rows, '离开前：把书翻到下一页立好', ['离开前翻页立好', '离开前翻页立好：动作先于评价']);
    expect(plan?.winnerId).toBe('r2');
    expect(plan?.mergedFields.conceptKey).toBe('离开前：把书翻到下一页立好');
    // 胜出者 label 为空 → 用规范键兜底（展示名不空）
    expect(plan?.mergedFields.label).toBe('离开前：把书翻到下一页立好');
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

describe('ConceptConsolidatorService', () => {
  const projectionRows = [
    {
      id: 'r1', conceptKey: '离开前翻页立好', label: '离开前翻页立好', source: 'derived',
      extractionCount: 7, masteryScore: 0.6, lastSeenAt: new Date('2026-09-10'), dueAt: new Date('2026-09-16'),
      ktMasteryEma: 0.5, fsrsStability: 3, fsrsDifficulty: 5,
    },
    {
      id: 'r2', conceptKey: '离开前翻页立好：动作先于评价', label: null, source: 'derived',
      extractionCount: 2, masteryScore: 0.5, lastSeenAt: new Date('2026-09-12'), dueAt: new Date('2026-09-14'),
      ktMasteryEma: 0.7, fsrsStability: null, fsrsDifficulty: null,
    },
  ];

  function build(over: Partial<ConceptConsolidatorDeps> = {}) {
    const writes = {
      updateTrace: jest.fn().mockResolvedValue({}),
      deleteTraces: jest.fn().mockResolvedValue({}),
      createTraces: jest.fn().mockResolvedValue({}),
      writeAudit: jest.fn().mockResolvedValue({}),
      recordMerge: jest.fn().mockResolvedValue({}),
    };
    const deps: ConceptConsolidatorDeps = {
      findTraces: jest.fn().mockResolvedValue(projectionRows),
      updateTrace: writes.updateTrace,
      deleteTraces: writes.deleteTraces,
      createTraces: writes.createTraces,
      findEvidence: jest.fn().mockResolvedValue([]),
      findPaths: jest.fn().mockResolvedValue([]),
      readAudit: jest.fn().mockResolvedValue(null),
      writeAudit: writes.writeAudit,
      recordMerge: writes.recordMerge,
      findMerges: jest.fn().mockResolvedValue([]),
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

  /** 已有一条审计（含一条可执行建议）的服务：用于 apply / rollback */
  async function buildWithAudit(over: Partial<ConceptConsolidatorDeps> = {}) {
    const built = build(over);
    const audit = await built.service.consolidate('u1', { now: new Date('2026-09-15T00:00:00Z') });
    (built.deps.readAudit as jest.Mock).mockResolvedValue({ payload: JSON.stringify(audit) });
    return { ...built, audit: audit! };
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

  it('apply 模式：并字段 + 留整行快照（可回滚）', async () => {
    const { service, writes } = build();
    const audit = await service.consolidate('u1', { mode: 'apply', now: new Date('2026-09-15T00:00:00Z') });
    expect(audit?.stats).toMatchObject({ applied: 1, deleted: 1 });
    expect(writes.deleteTraces).toHaveBeenCalledWith({ where: { id: { in: ['r2'] } } });
    // 并字段：被删那条更早的 dueAt 与更高的 ktMasteryEma 都要并进胜出者
    const patch = writes.updateTrace.mock.calls[0][0].data;
    expect(patch.dueAt).toEqual(new Date('2026-09-14'));
    expect(patch.extractionCount).toBe(7);
    expect(patch.masteryScore).toBe(0.6);
    expect(patch.ktMasteryEma).toBeCloseTo((0.5 * 7 + 0.7 * 2) / 9, 3);
    // 整行快照（不只是 id）
    const applied = audit?.appliedMerges[0];
    expect(applied?.winnerBefore).toMatchObject({ id: 'r1', conceptKey: '离开前翻页立好' });
    expect(applied?.deletedRows[0]).toMatchObject({ id: 'r2', dueAt: new Date('2026-09-14'), ktMasteryEma: 0.7 });
  });

  it('applyProposals：只执行勾选的，未勾选/不存在的不动', async () => {
    const { service, writes } = await buildWithAudit();
    const result = await service.applyProposals('u1', ['离开前翻页立好', '不存在的键']);
    expect(result.applied).toBe(1);
    expect(result.skipped).toContain('不存在的键');
    expect(writes.deleteTraces).toHaveBeenCalledTimes(1);
    // 执行后建议从待办里移除
    expect(result.audit?.proposals).toHaveLength(0);
    expect(result.audit?.appliedMerges).toHaveLength(1);
  });

  it('applyProposals：需人工确认的（autoApplicable=false）默认拒绝执行', async () => {
    const { service, writes } = await buildWithAudit({
      findTraces: jest.fn().mockResolvedValue([
        { id: 's1', conceptKey: '回来后的第一眼第一手交给已翻开的书', label: 'a', source: 'derived', extractionCount: 5, masteryScore: 0.5, lastSeenAt: new Date(), dueAt: null },
        { id: 's2', conceptKey: '回来后第一手落到哪里', label: 'b', source: 'derived', extractionCount: 5, masteryScore: 0.5, lastSeenAt: new Date(), dueAt: null },
      ]),
      callSkill: jest.fn().mockResolvedValue({
        success: true,
        output: {
          merges: [{
            canonical: '回来后的第一眼第一手交给已翻开的书',
            aliases: ['回来后第一手落到哪里'],
            confidence: 0.9,
            rationale: '同一动作',
          }],
          ambiguous: [],
          dropCandidates: [],
        },
      }),
    });
    const denied = await service.applyProposals('u1', ['回来后的第一眼第一手交给已翻开的书']);
    expect(denied.applied).toBe(0);
    expect(denied.skipped).toContain('回来后的第一眼第一手交给已翻开的书');
    expect(writes.deleteTraces).not.toHaveBeenCalled();

    const forced = await service.applyProposals('u1', ['回来后的第一眼第一手交给已翻开的书'], { includeNeedsReview: true });
    expect(forced.applied).toBe(1);
  });

  it('rollbackMerge：胜出者还原 + 被删行按整行快照重建', async () => {
    const { service, writes } = await buildWithAudit();
    const applied = await service.applyProposals('u1', ['离开前翻页立好']);
    expect(applied.applied).toBe(1);
    (writes.updateTrace as jest.Mock).mockClear();
    (writes.createTraces as jest.Mock).mockClear();

    // 审计已更新 → 让 readAudit 返回最新
    const latest = applied.audit!;
    (service as any).deps.readAudit = jest.fn().mockResolvedValue({ payload: JSON.stringify(latest) });

    const rolled = await service.rollbackMerge('u1', ['离开前翻页立好']);
    expect(rolled.rolledBack).toBe(1);
    // 胜出者还原成合并前整行（id 不作为 update 的 data 字段）
    const restore = writes.updateTrace.mock.calls[0][0];
    expect(restore.where).toEqual({ id: 'r1' });
    expect(restore.data.conceptKey).toBe('离开前翻页立好');
    expect(restore.data.id).toBeUndefined();
    // 被删行整行重建（含 dueAt / ktMasteryEma）
    const recreated = writes.createTraces.mock.calls[0][0].data;
    expect(recreated).toHaveLength(1);
    // 快照经 JSON 往返后日期是 ISO 字符串（Prisma 接受），不失真
    expect(recreated[0]).toMatchObject({ id: 'r2', conceptKey: '离开前翻页立好：动作先于评价', dueAt: '2026-09-14T00:00:00.000Z' });
    expect(rolled.audit?.appliedMerges).toHaveLength(0);
  });

  it('rollbackMerge：不存在的归并项报告 skipped，不写数据', async () => {
    const { service, writes } = await buildWithAudit();
    const rolled = await service.rollbackMerge('u1', ['没执行过的键']);
    expect(rolled.rolledBack).toBe(0);
    expect(rolled.skipped).toEqual(['没执行过的键']);
    expect(writes.updateTrace).not.toHaveBeenCalled();
    expect(writes.createTraces).not.toHaveBeenCalled();
  });

  it('候选不足两条 → 不调用 LLM', async () => {
    const { service, deps } = build({
      findTraces: jest.fn().mockResolvedValue([
        { id: 'only', conceptKey: '只有一个', label: '只有一个', source: 'derived', extractionCount: 1, masteryScore: 0.5, lastSeenAt: new Date() },
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
      id: `t${i}`,
      conceptKey: `概念 ${i}`,
      label: `概念 ${i}`,
      source: 'derived',
      extractionCount: 1,
      masteryScore: 0.5,
      lastSeenAt: new Date(),
      dueAt: null,
    }));
    const { service, deps } = build({ findTraces: jest.fn().mockResolvedValue(many) });
    await service.consolidate('u1', { now: new Date() });
    const payload = (deps.callSkill as jest.Mock).mock.calls[0][0];
    expect(payload.candidates).toHaveLength(MAX_CANDIDATES);
  });

  describe('按次留档：回滚凭据不过期', () => {
    const durableMerge = (over: Record<string, unknown> = {}) => ({
      mergeId: 'mrg_deadbeef',
      canonical: '离开前翻页立好',
      aliases: ['离开前翻页立好：动作先于评价'],
      winnerId: 'r1',
      mergedFields: { dueAt: new Date('2026-09-14'), extractionCount: 7 },
      winnerBefore: { id: 'r1', conceptKey: '离开前翻页立好', dueAt: null, extractionCount: 3 },
      deletedRows: [{ id: 'r2', conceptKey: '离开前翻页立好：动作先于评价', ktMasteryEma: 0.7 }],
      appliedAt: '2026-09-15T00:00:00Z',
      rolledBackAt: null,
      ...over,
    });

    it('审计窗口里已没有这条归并（滚动挤掉了）→ 仍能按留档凭据回滚', async () => {
      const { service, writes } = build({
        findMerges: jest.fn().mockResolvedValue([{ payload: JSON.stringify(durableMerge()) }]),
      });
      // 没有审计视图也要能回滚（凭据是权威来源）
      const result = await service.rollbackMerge('u1', ['离开前翻页立好']);

      expect(result.rolledBack).toBe(1);
      expect(result.skipped).toEqual([]);
      expect(writes.updateTrace).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { conceptKey: '离开前翻页立好', dueAt: null, extractionCount: 3 },
      });
      expect(writes.createTraces).toHaveBeenCalledWith({
        data: [{ id: 'r2', conceptKey: '离开前翻页立好：动作先于评价', ktMasteryEma: 0.7 }],
      });
    });

    it('回滚后标记凭据（不删痕迹），二次回滚幂等 → skipped', async () => {
      const { service, writes } = build({
        findMerges: jest.fn().mockResolvedValue([{ payload: JSON.stringify(durableMerge()) }]),
      });
      await service.rollbackMerge('u1', ['离开前翻页立好']);

      const updates = (writes.recordMerge as jest.Mock).mock.calls
        .map((call) => call[0]?.update?.payload)
        .filter(Boolean)
        .map((payload: string) => JSON.parse(payload));
      expect(updates).toHaveLength(1);
      expect(updates[0].rolledBackAt).toBeTruthy();
      expect(updates[0].mergeId).toBe('mrg_deadbeef');

      // 第二次：已标记的凭据不再作为可回滚目标
      (service as any).deps.findMerges = jest.fn().mockResolvedValue([
        { payload: JSON.stringify(durableMerge({ rolledBackAt: '2026-09-16T00:00:00Z' })) },
      ]);
      (writes.updateTrace as jest.Mock).mockClear();
      const again = await service.rollbackMerge('u1', ['离开前翻页立好']);
      expect(again.rolledBack).toBe(0);
      expect(again.skipped).toContain('离开前翻页立好');
      expect(writes.updateTrace).not.toHaveBeenCalled();
    });

    it('凭据写不进去 → 当次改动当场撤销（绝不留下"改了数据却没有回滚凭据"的状态）', async () => {
      const { service, writes } = await buildWithAudit({
        recordMerge: jest.fn().mockRejectedValue(new Error('db down')),
      });
      const result = await service.applyProposals('u1', ['离开前翻页立好']);

      expect(result.applied).toBe(0);            // 没留下"改了却没凭据"的状态
      expect(writes.createTraces).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'r2' })],
      });
      const restore = (writes.updateTrace as jest.Mock).mock.calls.at(-1)?.[0];
      expect(restore?.data).toMatchObject({ conceptKey: '离开前翻页立好' });
    });
  });
});
