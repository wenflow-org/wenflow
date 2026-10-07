import {
  ConceptConsolidatorService,
  buildKeyMergeFields,
  buildMergedFields,
  candidateFingerprint,
  classifyProposals,
  conceptFormKey,
  findSameFormGroups,
  lexicalSimilarity,
  pickDeterministicWinner,
  planMerge,
  validateConsolidation,
  MAX_CANDIDATES,
  type ConceptCandidate,
  type ConceptConsolidatorDeps,
  type ConsolidationTx,
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

// ═════════════════════ outlet（出口，2026-10-07 拍板）：apply 引擎测试设施 ═════════════════════

/** 引擎专用内存事务：真实执行 where/data 语义，测试断言的是**状态迁移结果**而非调用参数 */
function makeTxDb(seed: {
  traces?: any[]; evidence?: any[]; misconceptions?: any[];
  projections?: any[]; credentials?: any[]; audit?: any;
} = {}) {
  const db = {
    traces: (seed.traces ?? []).map((r) => ({ ...r })),
    evidence: (seed.evidence ?? []).map((r) => ({ ...r })),
    misconceptions: (seed.misconceptions ?? []).map((r) => ({ ...r })),
    projections: (seed.projections ?? []).map((r) => ({ ...r })),
    credentials: (seed.credentials ?? []).map((r) => ({ ...r })),
    createdEvidence: [] as any[],
    audit: seed.audit ? { payload: JSON.stringify(seed.audit), version: 1 } : null,
  };
  const byIdIn = (id: any): string[] => (typeof id === 'string' ? [id] : (id?.in ?? []));
  const conceptKeyOk = (row: any, keyFilter: any): boolean => {
    if (keyFilter == null) return true;
    if (typeof keyFilter === 'string') return row.conceptKey === keyFilter;
    return !keyFilter.in || keyFilter.in.includes(row.conceptKey);
  };
  const tx: ConsolidationTx = {
    findTraces: async (args: any) => db.traces.filter((r) =>
      (!args.where?.userId || r.userId === args.where.userId)
      && conceptKeyOk(r, args.where?.conceptKey)),
    updateTrace: async (args: any) => {
      const row = db.traces.find((r) => r.id === args.where.id);
      if (!row) throw new Error(`trace ${args.where.id} not found`);
      Object.assign(row, args.data);
      return row;
    },
    deleteTraces: async (args: any) => {
      for (const id of byIdIn(args.where?.id)) {
        const idx = db.traces.findIndex((r) => r.id === id);
        if (idx >= 0) db.traces.splice(idx, 1);
      }
      return { count: byIdIn(args.where?.id).length };
    },
    findEvidence: async (args: any) => db.evidence.filter((r) =>
      r.userId === args.where?.userId && r.evidenceKey === args.where?.evidenceKey),
    updateEvidence: async (args: any) => {
      // 重执行路径的凭据覆写也走这条 update：证据行 / 凭据行 / 本事务新建凭据都要能命中
      const row = db.evidence.find((r) => r.id === args.where.id)
        ?? db.credentials.find((r) => r.id === args.where.id)
        ?? db.createdEvidence.find((r) => r.id === args.where.id);
      if (!row) throw new Error(`evidence ${args.where.id} not found`);
      Object.assign(row, args.data);
      return row;
    },
    findMisconceptionRows: async (args: any) => db.misconceptions.filter((r) =>
      r.userId === args.where?.userId && r.conceptKey === args.where?.conceptKey),
    updateMisconceptionMany: async (args: any) => {
      let count = 0;
      for (const row of db.misconceptions) {
        if (!byIdIn(args.where?.id).includes(row.id)) continue;
        const data = { ...args.data };
        if (data.occurrenceCount?.increment !== undefined) {
          data.occurrenceCount = Number(row.occurrenceCount || 0) + data.occurrenceCount.increment;
        }
        Object.assign(row, data);
        count += 1;
      }
      return { count };
    },
    deleteMisconceptionRows: async (args: any) => {
      for (const id of byIdIn(args.where?.id)) {
        const idx = db.misconceptions.findIndex((r) => r.id === id);
        if (idx >= 0) db.misconceptions.splice(idx, 1);
      }
      return { count: byIdIn(args.where?.id).length };
    },
    findBeliefProjections: async (args: any) => db.projections.filter((r) =>
      r.userId === args.where?.userId && r.scope === args.where?.scope),
    writeProjection: async (args: any) => {
      const row = db.projections.find((r) => r.projectionKey === args.where.projectionKey);
      if (row) {
        const update = { ...args.update };
        if (update.version?.increment !== undefined) update.version = Number(row.version || 0) + update.version.increment;
        Object.assign(row, update);
        return row;
      }
      db.projections.push({ ...args.create });
      return args.create;
    },
    readAudit: async () => db.audit,
    writeAudit: async (args: any) => {
      if (db.audit) {
        const update = { ...args.update };
        if (update.version?.increment !== undefined) update.version = db.audit.version + update.version.increment;
        Object.assign(db.audit, update);
      } else {
        db.audit = { payload: args.create.payload, version: 1 };
      }
      return db.audit;
    },
    findEvidenceCredential: async (args: any) => {
      const { eventId, evidenceKey } = args.where.eventId_evidenceKey;
      return db.credentials.find((r) => r.eventId === eventId && r.evidenceKey === evidenceKey)
        ?? db.createdEvidence.find((r) => r.eventId === eventId && r.evidenceKey === evidenceKey)
        ?? null;
    },
    createEvidence: async (args: any) => {
      const data = args.data;
      const dup = [...db.credentials, ...db.createdEvidence].find((r) =>
        r.eventId === data.eventId && r.evidenceKey === data.evidenceKey);
      if (dup) throw new Error('Unique constraint failed on the fields: (`eventId`,`evidenceKey`) (P2002)');
      db.createdEvidence.push({ ...data });
      return data;
    },
  };
  return { db, tx };
}

/** 引擎测试服务：事务面绑定内存库，非事务的回滚还原点全部落 mock（断言还原参数用） */
function buildEngine(seed: Parameters<typeof makeTxDb>[0] = {}, over: Partial<ConceptConsolidatorDeps> = {}) {
  const { db, tx } = makeTxDb(seed);
  const writes = {
    updateTrace: jest.fn().mockResolvedValue({}),
    deleteTraces: jest.fn().mockResolvedValue({}),
    createTraces: jest.fn().mockResolvedValue({}),
    writeAudit: jest.fn().mockResolvedValue({}),
    recordMerge: jest.fn().mockResolvedValue({}),
    registerAlias: jest.fn().mockResolvedValue({ conceptId: 'cpt_canonical', registered: true }),
    updateTraceMany: jest.fn().mockResolvedValue({ count: 0 }),
    updateMisconceptionMany: jest.fn().mockResolvedValue({ count: 0 }),
    recordAliasMerge: jest.fn().mockResolvedValue({}),
  };
  const deps: ConceptConsolidatorDeps = {
    findTraces: jest.fn().mockImplementation(async (args: any) => tx.findTraces(args)),
    updateTrace: writes.updateTrace,
    deleteTraces: writes.deleteTraces,
    createTraces: writes.createTraces,
    findEvidence: jest.fn().mockResolvedValue([]),
    findPaths: jest.fn().mockResolvedValue([]),
    readAudit: jest.fn().mockResolvedValue(null),
    writeAudit: writes.writeAudit,
    recordMerge: writes.recordMerge,
    findMerges: jest.fn().mockImplementation(async (args: any) =>
      [...db.credentials, ...db.createdEvidence].filter((r: any) => !args.where?.evidenceType || r.evidenceType === args.where.evidenceType)),
    resolveConcept: jest.fn().mockResolvedValue({ conceptId: 'cpt_canonical' }),
    registerAlias: writes.registerAlias,
    updateTraceMany: writes.updateTraceMany,
    findMisconceptionRows: jest.fn().mockResolvedValue([]),
    updateMisconceptionMany: writes.updateMisconceptionMany,
    recordAliasMerge: writes.recordAliasMerge,
    findAliasMerges: jest.fn().mockResolvedValue([]),
    callSkill: jest.fn().mockResolvedValue({ success: true, output: { merges: [], ambiguous: [], dropCandidates: [] } }),
    runTransaction: (<T>(work: (txOps: ConsolidationTx) => Promise<T>) => work(tx)) as any,
    updateEvidence: jest.fn().mockResolvedValue({}),
    createMisconceptionRows: jest.fn().mockResolvedValue({}),
    writeProjection: jest.fn().mockResolvedValue({}),
    upsertEvidenceRecord: jest.fn().mockResolvedValue({}),
    ...over,
  } as ConceptConsolidatorDeps;
  const service = new ConceptConsolidatorService(deps);
  return { db, service, writes, deps };
}

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

  it('把握度足但词面远（语义近义）→ P2-24：降级进 ambiguous，不进 merges（yaml rule 7 对齐）', () => {
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
    expect(result.proposals).toHaveLength(0);
    expect(result.ambiguous[0]).toMatchObject({ a: '回来后的第一眼第一手交给已翻开的书' });
    expect(result.ambiguous[0].reason).toContain('词面相似度');
  });

  it('P2-24：词面远但 confidence 高（0.82 语义猜测）也不再混进可执行建议', () => {
    const result = validateConsolidation({
      candidates: [candidate('识别损失不可逆程度'), candidate('按能否挽回排序风险')],
      parsed: {
        merges: [{
          canonical: '识别损失不可逆程度',
          aliases: ['按能否挽回排序风险'],
          confidence: 0.82,
          rationale: '语义相近',
        }],
      },
    });
    expect(result.proposals).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(1);
  });

  it('P1-17：已执行的 canonical 本轮不再重复建议（appliedCanonicals 过滤）', () => {
    const result = validateConsolidation({
      candidates,
      appliedCanonicals: ['离开前翻页立好'],
      parsed: { merges: [{ canonical: '离开前翻页立好', aliases: ['离开前翻页立好：动作先于评价'], confidence: 0.9, rationale: '同一动作' }] },
    });
    expect(result.proposals).toHaveLength(0);
    expect(result.ambiguous[0]).toMatchObject({ a: '离开前翻页立好' });
    expect(result.ambiguous[0].reason).toContain('已执行');
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

  it('outlet(R7)：人审驳回的 canonical 不再重复建议（理由区分「驳回」）', () => {
    const result = validateConsolidation({
      candidates,
      rejectedCanonicals: ['离开前翻页立好'],
      parsed: { merges: [{ canonical: '离开前翻页立好', aliases: ['离开前翻页立好：动作先于评价'], confidence: 0.9, rationale: 'x' }] },
    });
    expect(result.proposals).toHaveLength(0);
    expect(result.ambiguous[0].reason).toContain('驳回');
  });

  it('outlet(R7)：人审驳回的散键清理不再出现在 dropCandidates', () => {
    const result = validateConsolidation({
      candidates,
      rejectedDrops: ['CAP 定理'],
      parsed: { dropCandidates: [{ conceptKey: 'CAP 定理', reason: '命名残缺' }] },
    });
    expect(result.dropCandidates).toHaveLength(0);
  });

  it('outlet(R7 复核)：人审驳回的 ambiguous 对（任一方向）不再重复给出', () => {
    const result = validateConsolidation({
      candidates,
      rejectedPairs: [{ a: 'CAP 定理', b: '回来后第一手落到哪里' }],
      parsed: {
        ambiguous: [
          { a: '回来后第一手落到哪里', b: 'CAP 定理', reason: '方向翻转再提' },   // 同一对，翻转方向也要拦
          { a: '离开前翻页立好', b: '离开前翻页立好：动作先于评价', reason: '别的对' },
        ],
      },
    });
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].a).toBe('离开前翻页立好');
  });

  it('outlet(R7 复核)：merge-proposal 驳回后，反向建议（原别名作 canonical）同样被抑制', () => {
    const result = validateConsolidation({
      candidates,
      // rejectProposals 记录 canonical + aliases（见 RejectedConsolidationItem），反向键一并抑制
      rejectedCanonicals: ['离开前翻页立好', '离开前翻页立好：动作先于评价'],
      parsed: {
        merges: [{ canonical: '离开前翻页立好：动作先于评价', aliases: ['离开前翻页立好'], confidence: 0.9, rationale: '反向' }],
      },
    });
    expect(result.proposals).toHaveLength(0);
    expect(result.ambiguous[0].reason).toContain('驳回');
  });

  it('outlet(R7 复核)：已在人审队列的对不再作为建议重新提出（防止同形对绕过人审转正为 auto）', () => {
    const result = validateConsolidation({
      candidates,
      pendingAmbiguousPairs: [{ a: '离开前翻页立好', b: '离开前翻页立好：动作先于评价' }],
      parsed: {
        merges: [{ canonical: '离开前翻页立好', aliases: ['离开前翻页立好：动作先于评价'], confidence: 0.95, rationale: '同形' }],
        ambiguous: [{ a: '离开前翻页立好', b: '离开前翻页立好：动作先于评价', reason: '已在队列' }],
      },
    });
    expect(result.proposals).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);   // 直通映射也去重（队列里已有，等人工）
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
  // 夹具要点（outlet 预闸门后）：两候选必须是**真近义**（机械归一化后仍是不同键）——
  // 「离开前翻页立好：动作先于评价」这类冒号从句变体与主键同形（conceptFormKey 相等），
  // 会被预闸门在 LLM 之前确定性归并，轮不到 LLM 建议（见 outlet describe 的预闸门用例）。
  const projectionRows = [
    {
      id: 'r1', conceptKey: '离开前翻页立好', label: '离开前翻页立好', source: 'derived',
      extractionCount: 7, masteryScore: 0.6, lastSeenAt: new Date('2026-09-10'), dueAt: new Date('2026-09-16'),
      ktMasteryEma: 0.5, fsrsStability: 3, fsrsDifficulty: 5,
    },
    {
      id: 'r2', conceptKey: '离开前翻页立好书', label: null, source: 'derived',
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
      // alias 策略（S3）用到的写入点
      registerAlias: jest.fn().mockResolvedValue({ conceptId: 'cpt_canonical', registered: true }),
      updateTraceMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMisconceptionMany: jest.fn().mockResolvedValue({ count: 0 }),
      recordAliasMerge: jest.fn().mockResolvedValue({}),
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
      // alias 策略（S3）依赖
      resolveConcept: jest.fn().mockResolvedValue({ conceptId: 'cpt_canonical' }),
      registerAlias: writes.registerAlias,
      updateTraceMany: writes.updateTraceMany,
      findMisconceptionRows: jest.fn().mockResolvedValue([]),
      updateMisconceptionMany: writes.updateMisconceptionMany,
      recordAliasMerge: writes.recordAliasMerge,
      findAliasMerges: jest.fn().mockResolvedValue([]),
      callSkill: jest.fn().mockResolvedValue({
        success: true,
        output: {
          merges: [{ canonical: '离开前翻页立好', aliases: ['离开前翻页立好书'], confidence: 0.92, rationale: '同一动作的完整说法' }],
          ambiguous: [{ a: '离开前翻页立好', b: '离开前翻页立好书', reason: '边界' }],
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

  describe('alias 策略（S3 升格：非破坏归并）', () => {
    // 夹具要点（P2-24 后）：两候选需同时满足 ①机械归一化后仍是不同键（真近义，否则 alias 无可归并）
    // ②词面相似度 ≥ 0.5（否则会被词面闸门降级进 ambiguous，不进 proposals）。
    const ALIAS_CANONICAL = '离开前翻页立好';
    const ALIAS_NEAR = '离开前翻页立好书';
    const aliasProjection = [
      { id: 'r1', conceptKey: ALIAS_CANONICAL, label: ALIAS_CANONICAL, source: 'derived', extractionCount: 7, masteryScore: 0.6, lastSeenAt: new Date('2026-09-10'), dueAt: new Date('2026-09-16'), ktMasteryEma: 0.5, fsrsStability: 3, fsrsDifficulty: 5 },
      { id: 'r2', conceptKey: ALIAS_NEAR, label: null, source: 'derived', extractionCount: 2, masteryScore: 0.5, lastSeenAt: new Date('2026-09-12'), dueAt: new Date('2026-09-14'), ktMasteryEma: 0.7, fsrsStability: null, fsrsDifficulty: null },
    ];

    function buildAliasCase(over: Partial<ConceptConsolidatorDeps> = {}) {
      return build({
        findTraces: jest.fn().mockImplementation((args: any) => {
          // 带 conceptKey in 过滤 = "待回填行"查询；否则是投影查询
          if (args?.where?.conceptKey) return Promise.resolve([{ id: 'r-alias', conceptId: 'cpt_alias_own' }]);
          return Promise.resolve(aliasProjection);
        }),
        callSkill: jest.fn().mockResolvedValue({
          success: true,
          output: {
            merges: [{ canonical: ALIAS_CANONICAL, aliases: [ALIAS_NEAR], confidence: 0.92, rationale: '同一动作的两种说法' }],
            ambiguous: [],
            dropCandidates: [],
          },
        }),
        ...over,
      });
    }

    async function applyAlias(service: ConceptConsolidatorService) {
      await service.consolidate('u1', { force: true, now: new Date('2026-09-15T00:00:00Z') });
      return service.consolidate('u1', {
        mode: 'apply', force: true, includeNeedsReview: true, now: new Date('2026-09-15T02:00:00Z'),
      });
    }

    it('apply 默认走 alias：登记别名 + 改指 conceptId，且**不删任何行**', async () => {
      const { service, writes } = buildAliasCase();
      const audit = await applyAlias(service);

      expect(audit?.appliedAliasMerges?.length).toBe(1);
      const applied = audit!.appliedAliasMerges![0];
      expect(applied.canonical).toBe(ALIAS_CANONICAL);
      expect(applied.aliases).toEqual([ALIAS_NEAR]);
      expect(applied.touchedRows).toEqual([
        { table: 'memory_traces', id: 'r-alias', previousConceptId: 'cpt_alias_own' },
      ]);
      expect(writes.registerAlias).toHaveBeenCalledWith(expect.objectContaining({ aliasRaw: ALIAS_NEAR }));
      expect(writes.updateTraceMany).toHaveBeenCalledWith({
        where: { userId: 'u1', id: { in: ['r-alias'] } },
        data: { conceptId: 'cpt_canonical' },
      });
      // 非破坏：不删行、不改 conceptKey
      expect(writes.deleteTraces).not.toHaveBeenCalled();
      expect(writes.updateTrace).not.toHaveBeenCalled();
    });

    it('凭据落档失败 → 当场撤销（还原 conceptId + 删别名），不留"改了却没凭据"的状态', async () => {
      const { service, writes } = buildAliasCase({
        recordAliasMerge: jest.fn().mockRejectedValue(new Error('evidence write failed')),
      });
      const audit = await applyAlias(service);

      expect(audit?.appliedAliasMerges?.length ?? 0).toBe(0);
      expect(writes.updateTraceMany).toHaveBeenCalledWith({
        where: { id: { in: ['r-alias'] } },
        data: { conceptId: 'cpt_alias_own' },
      });
    });

    it('回滚：还原 conceptId + 删别名，且凭据标记 rolledBackAt（幂等）', async () => {
      const { service, deps, writes } = buildAliasCase();
      const applied = await applyAlias(service);
      const merge = applied!.appliedAliasMerges![0];
      (deps.findAliasMerges as jest.Mock).mockResolvedValue([{ payload: JSON.stringify(merge) }]);
      (deps.readAudit as jest.Mock).mockResolvedValue({ payload: JSON.stringify(applied) });

      const rolled = await service.rollbackMerge('u1', [ALIAS_CANONICAL]);
      expect(rolled.rolledBack).toBe(1);
      expect(writes.updateTraceMany).toHaveBeenCalledWith({
        where: { id: { in: ['r-alias'] } },
        data: { conceptId: 'cpt_alias_own' },
      });
      expect(writes.recordAliasMerge).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ payload: expect.stringContaining('rolledBackAt') }),
      }));
    });

    it('影响行数超上限 → 整条不执行（保住"凡执行必可完全回滚"）', async () => {
      const manyRows = Array.from({ length: 501 }, (_, i) => ({ id: `r${i}`, conceptId: null }));
      const { service, writes } = buildAliasCase({
        findTraces: jest.fn().mockImplementation((args: any) => {
          if (args?.where?.conceptKey) return Promise.resolve(manyRows);
          return Promise.resolve(aliasProjection);
        }),
      });
      const audit = await applyAlias(service);

      expect(audit?.appliedAliasMerges?.length ?? 0).toBe(0);
      expect(writes.registerAlias).not.toHaveBeenCalled();
      expect(writes.updateTraceMany).not.toHaveBeenCalled();
    });
  });

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
    const audit = await service.consolidate('u1', { mode: 'apply', strategy: 'merge', now: new Date('2026-09-15T00:00:00Z') });
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
    const result = await service.applyProposals('u1', ['离开前翻页立好', '不存在的键'], { strategy: 'merge' });
    expect(result.applied).toBe(1);
    expect(result.skipped).toContain('不存在的键');
    expect(writes.deleteTraces).toHaveBeenCalledTimes(1);
    // 执行后建议从待办里移除
    expect(result.audit?.proposals).toHaveLength(0);
    expect(result.audit?.appliedMerges).toHaveLength(1);
  });

  it('applyProposals：词面远距的语义猜测不进 proposals，includeNeedsReview 也无法对其执行（P2-24）', async () => {
    const { service, writes, audit } = await buildWithAudit({
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
    // 词面闸门决定 merges 成员资格：远距项只进 ambiguous，审计里没有这条待办
    expect(audit?.proposals).toHaveLength(0);
    expect(audit?.ambiguous.some((item) => item.a === '回来后的第一眼第一手交给已翻开的书')).toBe(true);

    const denied = await service.applyProposals('u1', ['回来后的第一眼第一手交给已翻开的书'], { strategy: 'merge' });
    expect(denied.applied).toBe(0);
    expect(denied.skipped).toContain('回来后的第一眼第一手交给已翻开的书');
    expect(writes.deleteTraces).not.toHaveBeenCalled();

    // includeNeedsReview 只对审计里真实存在的 proposals 生效；远距猜测已不在其中，无法执行
    const forced = await service.applyProposals('u1', ['回来后的第一眼第一手交给已翻开的书'], { includeNeedsReview: true, strategy: 'merge' });
    expect(forced.applied).toBe(0);
    expect(writes.deleteTraces).not.toHaveBeenCalled();
  });

  it('rollbackMerge：胜出者还原 + 被删行按整行快照重建', async () => {
    const { service, writes } = await buildWithAudit();
    const applied = await service.applyProposals('u1', ['离开前翻页立好'], { strategy: 'merge' });
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
    expect(recreated[0]).toMatchObject({ id: 'r2', conceptKey: '离开前翻页立好书', dueAt: '2026-09-14T00:00:00.000Z' });
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
      const result = await service.applyProposals('u1', ['离开前翻页立好'], { strategy: 'merge' });

      expect(result.applied).toBe(0);            // 没留下"改了却没凭据"的状态
      expect(writes.createTraces).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'r2' })],
      });
      const restore = (writes.updateTrace as jest.Mock).mock.calls.at(-1)?.[0];
      expect(restore?.data).toMatchObject({ conceptKey: '离开前翻页立好' });
    });
  });
});

// ═════════════════════ outlet（出口，2026-10-07 拍板）：apply 引擎 + 双档 + 预闸门 ═════════════════════

describe('conceptFormKey（确定性同形口径：normalizeConceptKey + 字形折叠）', () => {
  it('大小写/空白/全半角差异 → 同形', () => {
    expect(conceptFormKey('Concat 纵向拼接')).toBe(conceptFormKey('concat 纵向 拼接'));
    expect(conceptFormKey('动作词(动词)在谓语槽位')).toBe(conceptFormKey('动作词（动词）在谓语槽位'));
    expect(conceptFormKey('离开前翻页立好：动作先于评价')).toBe(conceptFormKey('离开前翻页立好'));
  });

  it('语义字符不折并：内部顿号/逗号等留给 LLM 建议与人审', () => {
    // 「、」与「，」语义字符不同形——保守不归并（预闸门只吃纯字形差异）
    expect(conceptFormKey('标准分经等值处理，不等于卷面百分比'))
      .not.toBe(conceptFormKey('标准分经等值处理、不等于卷面百分比'));
  });
});

describe('findSameFormGroups / pickDeterministicWinner（预闸门的确定性残余与胜出者）', () => {
  const item = (conceptKey: string, occurrences = 1, lastSeenAt: string | null = null) => ({
    conceptKey, occurrences, lastSeenAt, label: conceptKey, source: 'derived', pathTitles: [],
  });

  it('同形多键成组（variants 互不相同），异形不成组', () => {
    const groups = findSameFormGroups([
      item('动作词(动词)在谓语槽位'),
      item('动作词（动词）在谓语槽位'),
      item('完全不同的另一个概念'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants).toHaveLength(2);
  });

  it('胜出者全序：提取次数多者 → 最近者 → 更短者 → 字典序', () => {
    expect(pickDeterministicWinner({
      family: 'f', variants: ['a', 'b'],
      members: [{ conceptKey: 'a', occurrences: 2, lastSeenAt: '2026-09-01' }, { conceptKey: 'b', occurrences: 1, lastSeenAt: '2026-09-20' }],
    })).toBe('a');
    expect(pickDeterministicWinner({
      family: 'f', variants: ['a', 'b'],
      members: [{ conceptKey: 'a', occurrences: 1, lastSeenAt: '2026-09-01' }, { conceptKey: 'b', occurrences: 1, lastSeenAt: '2026-09-20' }],
    })).toBe('b');
    expect(pickDeterministicWinner({
      family: 'f', variants: ['aaaa', 'bb'],
      members: [{ conceptKey: 'aaaa', occurrences: 1, lastSeenAt: null }, { conceptKey: 'bb', occurrences: 1, lastSeenAt: null }],
    })).toBe('bb');
  });
});

describe('classifyProposals（双档分类：autoApplicable + 同形 = 自动；其余 = 人审队列）', () => {
  const proposal = (canonical: string, aliases: string[], autoApplicable = true) => ({
    canonical, aliases, confidence: 0.9, rationale: 'x', lexicalSimilarity: 1, autoApplicable,
  });

  it('autoApplicable + 完全同形（含冒号从句变体/全半角）→ auto', () => {
    const [p] = classifyProposals([proposal('离开前翻页立好', ['离开前翻页立好：动作先于评价'])]);
    expect(p.track).toBe('auto');
    const [q] = classifyProposals([proposal('动作词(动词)在谓语槽位', ['动作词（动词）在谓语槽位'])]);
    expect(q.track).toBe('auto');
  });

  it('autoApplicable + 近形（真近义，机械归一化后仍不同键）→ review', () => {
    const [p] = classifyProposals([proposal('离开前翻页立好', ['离开前翻页立好书'])]);
    expect(p.track).toBe('review');
  });

  it('非 autoApplicable → 恒 review（即使同形）', () => {
    const [p] = classifyProposals([proposal('离开前翻页立好', ['离开前翻页立好：动作先于评价'], false)]);
    expect(p.track).toBe('review');
  });

  it('多别名混合：只要有一个不同形，整条进 review（建议是执行单元，不拆半自动）', () => {
    const [p] = classifyProposals([proposal('离开前翻页立好', ['离开前翻页立好：动作先于评价', '离开前翻页立好书'])]);
    expect(p.track).toBe('review');
  });
});

describe('buildKeyMergeFields（A：memory_traces 双行并一行的合并语义，任务书拍板）', () => {
  const fromRow = {
    id: 't_from', conceptKey: '旧键', label: '旧键', masteryScore: 0.4, stability: 'fragile',
    extractionCount: 3, lastSeenAt: new Date('2026-09-01'), dueAt: new Date('2026-09-05'),
    fsrsStability: 2, fsrsDifficulty: 6, fsrsLapses: 1, fsrsReps: 3, ktMasteryEma: 0.3, pathId: 'p1',
  };
  const toRow = {
    id: 't_to', conceptKey: '新键', label: '新键', masteryScore: 0.7, stability: 'developing',
    extractionCount: 2, lastSeenAt: new Date('2026-09-10'), dueAt: new Date('2026-09-20'),
    fsrsStability: 9, fsrsDifficulty: 4, fsrsLapses: 0, fsrsReps: 2, ktMasteryEma: 0.8, pathId: 'p2',
  };

  it('掌握度取证据更强一方（提取次数多者），extractionCount 求和', () => {
    const merged = buildKeyMergeFields(fromRow, toRow, '新键');
    expect(merged.masteryScore).toBe(0.4);           // from 行 3 次 > to 行 2 次 → 证据更强一方
    expect(merged.stability).toBe('fragile');        // 与 mastery 同侧
    expect(merged.extractionCount).toBe(5);          // 求和（与 legacy buildMergedFields 的取 max 不同口径）
    expect(merged.conceptKey).toBe('新键');
  });

  it('证据等量时 mastery 高者胜；dueAt 重排取最早、lastSeenAt 取最新', () => {
    const equalFrom = { ...fromRow, extractionCount: 2 };
    const merged = buildKeyMergeFields(equalFrom, toRow, '新键');
    expect(merged.masteryScore).toBe(0.7);
    expect(merged.dueAt).toEqual(new Date('2026-09-05'));    // 宁可早捞，不可漏捞
    expect(merged.lastSeenAt).toEqual(new Date('2026-09-10'));
  });

  it('FSRS 四元组取 stability 大者整组（lapses/reps 随行不拆分）', () => {
    const merged = buildKeyMergeFields(fromRow, toRow, '新键');
    expect(merged.fsrsStability).toBe(9);
    expect(merged.fsrsDifficulty).toBe(4);
    expect(merged.fsrsLapses).toBe(0);
    expect(merged.fsrsReps).toBe(2);
  });

  it('ktMasteryEma 按观测数加权；(0.3*3 + 0.8*2)/5 = 0.5', () => {
    const merged = buildKeyMergeFields(fromRow, toRow, '新键');
    expect(merged.ktMasteryEma).toBe(0.5);
  });

  it('双方均无 FSRS/kt 时不编造字段', () => {
    const bareFrom = { id: 'a', conceptKey: 'A', label: null, extractionCount: 1, masteryScore: 0.3, lastSeenAt: null, dueAt: null };
    const bareTo = { id: 'b', conceptKey: 'B', label: null, extractionCount: 2, masteryScore: 0.5, lastSeenAt: null, dueAt: null };
    const merged = buildKeyMergeFields(bareFrom, bareTo, 'B');
    expect(merged.fsrsStability).toBeUndefined();
    expect(merged.ktMasteryEma).toBeUndefined();
  });
});

describe('outlet apply 引擎（B：事务化 + 幂等重放 + 每表迁移语义）', () => {
  const engineSeed = () => ({
    traces: [
      { id: 't_from', userId: 'u1', conceptKey: '旧键', label: '旧键', masteryScore: 0.4, stability: 'fragile', extractionCount: 3, lastSeenAt: new Date('2026-09-01'), dueAt: new Date('2026-09-05'), fsrsStability: 2, fsrsDifficulty: 6, fsrsLapses: 1, fsrsReps: 3, ktMasteryEma: 0.3, conceptId: null, pathId: 'p1' },
      { id: 't_to', userId: 'u1', conceptKey: '新键', label: '新键', masteryScore: 0.7, stability: 'developing', extractionCount: 2, lastSeenAt: new Date('2026-09-10'), dueAt: new Date('2026-09-20'), fsrsStability: 9, fsrsDifficulty: 4, fsrsLapses: 0, fsrsReps: 2, ktMasteryEma: 0.8, conceptId: 'cpt_new', pathId: 'p2' },
    ],
    evidence: [
      { id: 'ev1', userId: 'u1', eventId: 'e1', evidenceKey: 'review:result:旧键', payload: JSON.stringify({ conceptKey: '旧键', rating: 'good' }) },
      { id: 'ev2', userId: 'u1', eventId: 'e1', evidenceKey: 'review:result:新键', payload: JSON.stringify({ conceptKey: '新键', rating: 'good' }) },
      { id: 'ev3', userId: 'u1', eventId: 'e3', evidenceKey: 'review:result:旧键', payload: JSON.stringify({ conceptKey: '旧键', rating: 'again' }) },
    ],
    misconceptions: [
      { id: 'mc1', userId: 'u1', conceptKey: '旧键', hypothesisHash: 'h1', occurrenceCount: 2, firstSeenAt: new Date('2026-09-01'), lastSeenAt: new Date('2026-09-02'), status: 'confirmed', confidence: 50, conceptId: null },
      { id: 'mc2', userId: 'u1', conceptKey: '新键', hypothesisHash: 'h1', occurrenceCount: 1, firstSeenAt: new Date('2026-09-05'), lastSeenAt: new Date('2026-09-06'), status: 'suspected', confidence: 25, conceptId: 'cpt_new' },
      { id: 'mc3', userId: 'u1', conceptKey: '旧键', hypothesisHash: 'h2', occurrenceCount: 1, firstSeenAt: new Date('2026-09-03'), lastSeenAt: new Date('2026-09-03'), status: 'suspected', confidence: 25, conceptId: null },
    ],
    projections: [
      { id: 'bp1', projectionKey: 'learner-concept-beliefs-v1:u1:p1', userId: 'u1', scope: 'beliefs', pathId: 'p1', version: 3, payload: JSON.stringify({ schemaVersion: 'learner-concept-beliefs-v1', beliefs: { '旧键': { pKnowL: 0.4, observations: 2, lastObservedAt: '2026-09-02' }, '新键': { pKnowL: 0.8, observations: 4, lastObservedAt: '2026-09-10', tier: 'hard' } } }) },
      // 快照投影（派生缓存）：合并不得改写
      { id: 'snap1', projectionKey: 'learner-snapshot-v1:u1:global:global:none:none', userId: 'u1', scope: 'global', pathId: null, version: 1, payload: JSON.stringify({ conceptLedger: [{ conceptKey: '旧键' }] }) },
    ],
  });

  it('双行并一行：memory_traces 语义 + 证据改指 + 误解并入 + 信念并入，一个事务全落', async () => {
    const { db, service } = buildEngine(engineSeed());
    const result = await service.applyKeyMerge('u1', '旧键', '新键');

    expect(result.status).toBe('applied');
    expect(result.applied).toBe(true);

    // memory_traces：双行并一行（语义断言见 buildKeyMergeFields 用例，此处钉状态）
    expect(db.traces).toHaveLength(1);
    expect(db.traces[0]).toMatchObject({
      id: 't_to', conceptKey: '新键', masteryScore: 0.4, extractionCount: 5,
      dueAt: new Date('2026-09-05'), lastSeenAt: new Date('2026-09-10'),
      fsrsStability: 9, ktMasteryEma: 0.5,
    });
    // 证据：保留双方不删行；无冲突行归到目标键（含 payload.conceptKey 改写），冲突行（同 eventId）跳过
    expect(db.evidence).toHaveLength(3);
    expect(db.evidence.find((r) => r.id === 'ev1')).toMatchObject({ evidenceKey: 'review:result:旧键' }); // e1 已被 ev2 代表
    expect(db.evidence.find((r) => r.id === 'ev3')).toMatchObject({ evidenceKey: 'review:result:新键' });
    expect(JSON.parse(db.evidence.find((r) => r.id === 'ev3').payload).conceptKey).toBe('新键');
    // 误解台账：同 hash 并入目标行（次数累加/更重状态/更高置信）后删 from 行；无冲突行改指
    expect(db.misconceptions).toHaveLength(2);
    expect(db.misconceptions.find((r) => r.id === 'mc2')).toMatchObject({
      conceptKey: '新键', occurrenceCount: 3, status: 'confirmed', confidence: 50,
      firstSeenAt: new Date('2026-09-01'), lastSeenAt: new Date('2026-09-06'),
    });
    expect(db.misconceptions.find((r) => r.id === 'mc1')).toBeUndefined();
    expect(db.misconceptions.find((r) => r.id === 'mc3')).toMatchObject({ conceptKey: '新键', conceptId: 'cpt_new' });
    // 信念投影：观测数加权 (0.8*4 + 0.4*2)/6 = 0.667、observations 求和、fromKey 条目移除
    const beliefs = JSON.parse(db.projections.find((r) => r.id === 'bp1').payload).beliefs;
    expect(beliefs['新键']).toMatchObject({ pKnowL: 0.667, observations: 6, tier: 'hard', lastObservedAt: '2026-09-10' });
    expect(beliefs['旧键']).toBeUndefined();
    // 快照投影（派生缓存）不动
    const snap = db.projections.find((r) => r.id === 'snap1');
    expect(JSON.parse(snap.payload).conceptLedger[0].conceptKey).toBe('旧键');
    // 凭据：concept:merge:applied，evidenceKey 带目标键，eventId 确定性
    expect(db.createdEvidence).toHaveLength(1);
    expect(db.createdEvidence[0]).toMatchObject({ evidenceType: 'concept:merge:applied', evidenceKey: 'concept-merge:新键' });
    const credential = JSON.parse(db.createdEvidence[0].payload);
    expect(credential).toMatchObject({ canonical: '新键', aliases: ['旧键'], winnerId: 't_to' });
    // 审计：mode=apply、执行前快照入审计（胜出者合并前整行 + 被删行整行）
    const audit = JSON.parse(db.audit.payload);
    expect(audit.mode).toBe('apply');
    expect(audit.appliedMerges[0]).toMatchObject({ canonical: '新键', winnerBefore: { id: 't_to' } });
    expect(audit.appliedMerges[0].deletedRows[0]).toMatchObject({ id: 't_from', conceptKey: '旧键' });
    expect(audit.stats.applied).toBe(1);
    // 合并提交后登记别名（防再碎片化）
    expect((service as any).deps.registerAlias).toHaveBeenCalledWith(expect.objectContaining({ aliasRaw: '旧键' }));
  });

  it('幂等重放：同一对重复 apply 直接返回已执行，不重复迁移', async () => {
    const { db, service } = buildEngine(engineSeed());
    await service.applyKeyMerge('u1', '旧键', '新键');
    const second = await service.applyKeyMerge('u1', '旧键', '新键');

    expect(second.status).toBe('already_applied');
    expect(second.applied).toBe(false);
    expect(db.traces).toHaveLength(1);                       // 没有第二次迁移
    expect(db.createdEvidence).toHaveLength(1);              // 没有第二张凭据
    expect(JSON.parse(db.audit.payload).stats.applied).toBe(1);
  });

  it('回滚后重新 apply：同对重新执行（迁移重做 + 凭据 rolledBackAt 清除），不被 already_applied 永久阻断', async () => {
    // 复核 #1 场景：rollbackMerge 只标记凭据 rolledBackAt（不删行）+ 还原数据 →
    // 重新 apply 必须是正当出口，否则残余永久复现、该用户 LLM observe 被闸门永久拦下。
    const { db, service } = buildEngine(engineSeed());
    await service.applyKeyMerge('u1', '旧键', '新键');
    const credentialRow = db.createdEvidence[0];
    // 模拟 rollbackMerge：数据整行还原 + 凭据标记 rolledBackAt（凭据行保留）
    const original = engineSeed();
    db.traces = original.traces.map((r) => ({ ...r }));
    db.evidence = original.evidence.map((r) => ({ ...r }));
    db.misconceptions = original.misconceptions.map((r) => ({ ...r }));
    db.projections = original.projections.map((r) => ({ ...r }));
    credentialRow.payload = JSON.stringify({ ...JSON.parse(credentialRow.payload), rolledBackAt: '2026-09-16T00:00:00Z' });

    const again = await service.applyKeyMerge('u1', '旧键', '新键');
    expect(again.status).toBe('applied');
    expect(again.applied).toBe(true);
    expect(db.traces).toHaveLength(1);                        // 迁移重做
    expect(db.createdEvidence).toHaveLength(1);               // 凭据行保留（覆写，不新建）
    expect(JSON.parse(credentialRow.payload).rolledBackAt).toBeNull(); // rolledBackAt 清除，重新可回滚
  });

  it('凭据仍生效但 from 行复现（失配态）→ 自愈重执行，不假报已执行', async () => {
    const { db, service } = buildEngine(engineSeed());
    await service.applyKeyMerge('u1', '旧键', '新键');
    db.traces.push({ ...engineSeed().traces[0] });            // from 行在凭据之外被还原
    const result = await service.applyKeyMerge('u1', '旧键', '新键');

    expect(result.status).toBe('applied');                    // 不假报 already_applied
    expect(db.traces).toHaveLength(1);                        // 残余被吃掉
  });

  it('并发重放：竞态窗口内读不到凭据、create 撞唯一约束 → 按已执行返回（不写第二张凭据）', async () => {
    // 真实 prisma 交互式事务在 create 冲突时整体回滚（DB 保证）；这里注入竞态验证引擎的冲突出口
    const { db, service } = buildEngine(engineSeed());
    await service.applyKeyMerge('u1', '旧键', '新键');
    const committed = { ...db.createdEvidence[0] };

    const { db: db2, tx: tx2 } = makeTxDb({ ...engineSeed(), credentials: [committed] });
    const { service: service2 } = buildEngine({}, {
      runTransaction: (<T>(work: (txOps: ConsolidationTx) => Promise<T>) =>
        work({ ...tx2, findEvidenceCredential: async () => null })) as any,   // 竞态：读时凭据尚未提交
      findTraces: jest.fn().mockImplementation(async (args: any) => tx2.findTraces(args)),
    });
    const replay = await service2.applyKeyMerge('u1', '旧键', '新键');

    expect(replay.status).toBe('already_applied');
    expect(db2.createdEvidence).toHaveLength(0);              // 撞约束后没有写出第二张凭据
    // 注：mock 无真实回滚能力，「整体回滚未改数据」由 prisma 交互式事务保证（此处不断言行状态）。
  });

  it('仅 fromKey 有行 → 原行改名不删行；仅 toKey 有行 → from_key_absent 不留凭据', async () => {
    const seed = engineSeed();
    seed.traces = seed.traces.filter((r) => r.id === 't_from');
    const { db, service } = buildEngine(seed);
    const result = await service.applyKeyMerge('u1', '旧键', '新键');
    expect(result.status).toBe('applied');
    expect(db.traces).toHaveLength(1);
    expect(db.traces[0]).toMatchObject({ id: 't_from', conceptKey: '新键' });

    const { db: db2, service: service2 } = buildEngine({ traces: [engineSeed().traces[1]] });
    const absent = await service2.applyKeyMerge('u1', '旧键', '新键');
    expect(absent.status).toBe('from_key_absent');
    expect(absent.applied).toBe(false);
    expect(db2.createdEvidence).toHaveLength(0);
  });

  it('applyKeyDrop：删痕迹行+误解行（整行快照入凭据）、证据行保留、beliefs 条目移除、审计 appliedDrops', async () => {
    const seed = {
      traces: [
        { id: 't_drop', userId: 'u1', conceptKey: '散键', label: '散键', masteryScore: 0.2, extractionCount: 1, lastSeenAt: new Date('2026-09-01'), dueAt: null, conceptId: null },
        { id: 't_keep', userId: 'u1', conceptKey: '好键', label: '好键', masteryScore: 0.8, extractionCount: 4, lastSeenAt: new Date('2026-09-10'), dueAt: null, conceptId: 'cpt_keep' },
      ],
      evidence: [{ id: 'ev9', userId: 'u1', eventId: 'e9', evidenceKey: 'review:result:散键', payload: JSON.stringify({ conceptKey: '散键' }) }],
      misconceptions: [{ id: 'mc9', userId: 'u1', conceptKey: '散键', hypothesisHash: 'h9', occurrenceCount: 1, status: 'suspected', confidence: 25, conceptId: null }],
      projections: [
        { id: 'bp2', projectionKey: 'learner-concept-beliefs-v1:u1:global', userId: 'u1', scope: 'beliefs', pathId: null, version: 1, payload: JSON.stringify({ beliefs: { '散键': { pKnowL: 0.2, observations: 1 }, '好键': { pKnowL: 0.9, observations: 5 } } }) },
      ],
    };
    const { db, service } = buildEngine(seed);
    const result = await service.applyKeyDrop('u1', '散键', { reason: '命名残缺' });

    expect(result.status).toBe('applied');
    expect(db.traces.map((r) => r.id)).toEqual(['t_keep']);          // 散键痕迹删除，好键不动
    expect(db.evidence).toHaveLength(1);                              // 证据行保留（历史观测不灭失）
    expect(db.misconceptions).toHaveLength(0);                        // 误解行删除
    const beliefs = JSON.parse(db.projections[0].payload).beliefs;
    expect(beliefs['散键']).toBeUndefined();
    expect(beliefs['好键']).toBeDefined();
    expect(db.createdEvidence).toHaveLength(1);
    expect(db.createdEvidence[0]).toMatchObject({ evidenceType: 'concept:drop:applied', evidenceKey: 'concept-drop:散键' });
    const audit = JSON.parse(db.audit.payload);
    expect(audit.appliedDrops[0]).toMatchObject({ conceptKey: '散键', reason: '命名残缺' });
    expect(audit.appliedDrops[0].deletedRows[0]).toMatchObject({ id: 't_drop' });   // 整行快照
    expect(audit.stats.dropped).toBe(1);

    // 幂等重放
    const second = await service.applyKeyDrop('u1', '散键');
    expect(second.status).toBe('already_applied');
    expect(db.createdEvidence).toHaveLength(1);
  });

  it('applyKeyDrop 回滚后重新 drop 同键 → 重新执行并覆写凭据（rolledBackAt 清除）', async () => {
    const seed = {
      traces: [
        { id: 't_drop', userId: 'u1', conceptKey: '散键', label: '散键', masteryScore: 0.2, extractionCount: 1, lastSeenAt: new Date('2026-09-01'), dueAt: null, conceptId: null },
        { id: 't_keep', userId: 'u1', conceptKey: '好键', label: '好键', masteryScore: 0.8, extractionCount: 4, lastSeenAt: new Date('2026-09-10'), dueAt: null, conceptId: 'cpt_keep' },
      ],
      misconceptions: [{ id: 'mc9', userId: 'u1', conceptKey: '散键', hypothesisHash: 'h9', occurrenceCount: 1, status: 'suspected', confidence: 25, conceptId: null }],
    };
    const { db, service } = buildEngine(seed);
    await service.applyKeyDrop('u1', '散键');
    // 模拟 rollbackMerge：被删行按快照重建 + 凭据标记 rolledBackAt（行保留）
    db.traces.push({ ...seed.traces[0] });
    db.misconceptions.push({ ...seed.misconceptions[0] });
    db.createdEvidence[0].payload = JSON.stringify({ ...JSON.parse(db.createdEvidence[0].payload), rolledBackAt: '2026-09-16T00:00:00Z' });

    const again = await service.applyKeyDrop('u1', '散键');
    expect(again.status).toBe('applied');
    expect(db.traces.map((r) => r.id)).toEqual(['t_keep']);
    expect(db.createdEvidence).toHaveLength(1);               // 凭据行覆写，不新建
    expect(JSON.parse(db.createdEvidence[0].payload).rolledBackAt).toBeNull();
  });

  it('回滚 key 归并：memory_traces 还原 + 扩展痕迹（证据/误解/信念）一并还原，凭据标记 rolledBackAt', async () => {
    const { db, service, writes, deps } = buildEngine(engineSeed());
    await service.applyKeyMerge('u1', '旧键', '新键');
    const credential = JSON.parse(db.createdEvidence[0].payload);

    const rolled = await service.rollbackMerge('u1', ['新键']);
    expect(rolled.rolledBack).toBe(1);

    // memory_traces：胜出者还原 + from 行重建（revertMerge 走非事务 mock）
    expect(writes.updateTrace).toHaveBeenCalledWith({ where: { id: 't_to' }, data: expect.objectContaining({ conceptKey: '新键' }) });
    expect(writes.createTraces).toHaveBeenCalledWith({ data: [expect.objectContaining({ id: 't_from', conceptKey: '旧键' })] });
    // 扩展痕迹：证据改指还原
    expect(deps.updateEvidence).toHaveBeenCalledWith({
      where: { id: 'ev3' },
      data: { evidenceKey: 'review:result:旧键', payload: JSON.stringify({ conceptKey: '旧键', rating: 'again' }) },
    });
    // 误解并入还原：目标行回退 + 被删行重建
    expect(deps.updateMisconceptionMany).toHaveBeenCalledWith({
      where: { id: 'mc2' },
      data: expect.objectContaining({ occurrenceCount: 1, status: 'suspected' }),
    });
    expect(deps.createMisconceptionRows).toHaveBeenCalledWith({ data: [expect.objectContaining({ id: 'mc1' })] });
    // 信念投影整行还原
    expect(deps.writeProjection).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectionKey: 'learner-concept-beliefs-v1:u1:p1' },
      update: expect.objectContaining({ payload: expect.stringContaining('旧键') }),
    }));
    // 凭据标记 rolledBackAt（幂等，不删痕迹；标记必须命中原凭据行——evidenceKey 带目标键）
    const markingCall = (writes.recordMerge as jest.Mock).mock.calls.at(-1)?.[0];
    expect(markingCall).toBeUndefined(); // 引擎凭据不走 legacy 标记（常量 evidenceKey 命不中）
    const marking = (deps.upsertEvidenceRecord as jest.Mock).mock.calls.at(-1)?.[0];
    expect(marking.where).toEqual({ eventId_evidenceKey: { eventId: credential.mergeId, evidenceKey: 'concept-merge:新键' } });
    expect(JSON.parse(marking.update.payload)).toMatchObject({ mergeId: credential.mergeId, rolledBackAt: expect.any(String) });
  });

  it('回滚散键清理：被删痕迹行与误解行按快照重建', async () => {
    const dropCredential = {
      mergeId: 'mgd_fixed', kind: 'drop', canonical: '散键', conceptKey: '散键', aliases: [], winnerId: '',
      mergedFields: {}, winnerBefore: null,
      deletedRows: [{ id: 't_drop', userId: 'u1', conceptKey: '散键', masteryScore: 0.2, extractionCount: 1 }],
      deletedMisconceptions: [{ id: 'mc9', userId: 'u1', conceptKey: '散键', hypothesisHash: 'h9' }],
      reason: '命名残缺', userId: 'u1',
      appliedAt: '2026-09-15T00:00:00Z', rolledBackAt: null,
    };
    const { service, writes, deps } = buildEngine({
      credentials: [{ eventId: 'mgd_fixed', evidenceKey: 'concept-drop:散键', evidenceType: 'concept:drop:applied', payload: JSON.stringify(dropCredential) }],
    });
    const rolled = await service.rollbackMerge('u1', ['散键']);
    expect(rolled.rolledBack).toBe(1);
    expect(writes.createTraces).toHaveBeenCalledWith({ data: [expect.objectContaining({ id: 't_drop', conceptKey: '散键' })] });
    expect(deps.createMisconceptionRows).toHaveBeenCalledWith({ data: [expect.objectContaining({ id: 'mc9' })] });
  });

  it('applyConfirmed：批量执行确认名单；名单外一律 skipped；终态项移出待办', async () => {
    const { db, service } = buildEngine(engineSeed(), {
      readAudit: jest.fn().mockResolvedValue({
        payload: JSON.stringify({
          schemaVersion: 'concept-merge-audits-v1', mode: 'observe', generatedAt: '2026-09-15T00:00:00Z',
          projectionFingerprint: 'fp', candidateCount: 3,
          proposals: [{ canonical: '新键', aliases: ['旧键'], confidence: 0.9, rationale: 'x', lexicalSimilarity: 0.95, autoApplicable: true }],
          ambiguous: [{ a: '甲键', b: '乙键', reason: '语义近' }],
          dropCandidates: [{ conceptKey: '散键', reason: '命名残缺' }],
          appliedMerges: [], appliedAliasMerges: [],
        }),
      }),
    });
    const result = await service.applyConfirmed('u1', {
      canonicals: ['新键', '不在名单'],          // '不在名单' 不在审计里 → skipped
      ambiguous: [{ a: '甲键', b: '乙键' }],     // 审计里有该对，但两键都无数据行 → no_rows（终态，移出待办）
      drops: ['散键'],                            // 同上
    });

    expect(result.skipped).toEqual(['不在名单']);
    expect(result.merges[0]).toMatchObject({ fromKey: '旧键', toKey: '新键', status: 'applied' });
    expect(result.applied).toBe(1);
    // 终态项全部移出待办（applied 或 no_rows 都代表「这一对已经没事可做」）
    expect(result.audit?.proposals).toHaveLength(0);
    expect(result.audit?.ambiguous).toHaveLength(0);
    expect(result.audit?.dropCandidates).toHaveLength(0);
    expect(db.traces).toHaveLength(1);
  });
});

describe('outlet 预闸门（D：LLM observe 之前先跑确定性归并；无残余才允许 LLM）', () => {
  const pregateRows = () => [
    { id: 'g1', userId: 'u1', conceptKey: '动作词(动词)在谓语槽位', label: '动作词(动词)在谓语槽位', source: 'derived', extractionCount: 5, masteryScore: 0.6, lastSeenAt: new Date('2026-09-10'), dueAt: null },
    { id: 'g2', userId: 'u1', conceptKey: '动作词（动词）在谓语槽位', label: null, source: 'derived', extractionCount: 2, masteryScore: 0.5, lastSeenAt: new Date('2026-09-11'), dueAt: null },
    // 无关概念：归并后候选池仍 ≥2，LLM observe 才有可观察对象
    { id: 'g3', userId: 'u1', conceptKey: '完全不同的另一个概念', label: '完全不同的另一个概念', source: 'derived', extractionCount: 4, masteryScore: 0.5, lastSeenAt: new Date('2026-09-09'), dueAt: null },
  ];

  it('有同形残余：先确定性归并（不调 LLM 的活），归并后残余清零 → LLM 收到干净候选', async () => {
    const { db, service, deps } = buildEngine({ traces: pregateRows() });
    const audit = await service.consolidate('u1', { force: true, now: new Date('2026-09-15T00:00:00Z') });

    // 预闸门已把同形双行并成一行（提取多者 5 次的 g1 为确定性胜出者）
    expect(db.traces).toHaveLength(2);
    expect(db.traces.find((r: any) => r.id === 'g1')).toMatchObject({ conceptKey: '动作词(动词)在谓语槽位', extractionCount: 7 });
    // LLM 仍被调用（残余已清零），但候选里只剩同形收敛后的键 + 无关键
    expect(deps.callSkill).toHaveBeenCalledTimes(1);
    const payload = (deps.callSkill as jest.Mock).mock.calls[0][0];
    expect(payload.candidates.map((c: any) => c.conceptKey).sort()).toEqual(['动作词(动词)在谓语槽位', '完全不同的另一个概念']);
    expect(audit?.stats.candidates).toBe(2);
  });

  it('归并失败（事务抛错）→ 残余未清零，本轮不调 LLM', async () => {
    // 同形残余存在（全半角变体），但事务执行器抛错 → 预闸门归并未落地
    const { service, deps } = buildEngine({
      traces: [
        { id: 'w1', userId: 'u1', conceptKey: '动作词(动词)在谓语槽位', label: 'a', source: 'derived', extractionCount: 3, masteryScore: 0.5, lastSeenAt: new Date(), dueAt: null },
        { id: 'w2', userId: 'u1', conceptKey: '动作词（动词）在谓语槽位', label: 'b', source: 'derived', extractionCount: 1, masteryScore: 0.5, lastSeenAt: new Date(), dueAt: null },
      ],
    }, {
      runTransaction: (() => Promise.reject(new Error('tx down'))) as any,
    });
    const audit = await service.consolidate('u1', { force: true, now: new Date('2026-09-15T00:00:00Z') });
    expect(deps.callSkill).not.toHaveBeenCalled();
    expect(audit).toBeNull(); // 无历史审计可回退
  });

  it('自动档：上一轮审计里 autoApplicable + 同形的建议在 LLM 之前自动执行（无需人审）', async () => {
    const { db, service, deps } = buildEngine({ traces: pregateRows() });
    (deps.readAudit as jest.Mock).mockResolvedValue({
      payload: JSON.stringify({
        schemaVersion: 'concept-merge-audits-v1', mode: 'observe', generatedAt: '2026-09-14T00:00:00Z',
        projectionFingerprint: 'old', candidateCount: 3,
        proposals: [{ canonical: '动作词（动词）在谓语槽位', aliases: ['动作词(动词)在谓语槽位'], confidence: 0.95, rationale: '同形', lexicalSimilarity: 1, autoApplicable: true }],
        ambiguous: [], dropCandidates: [], appliedMerges: [], appliedAliasMerges: [],
      }),
    });
    await service.consolidate('u1', { force: true, now: new Date('2026-09-15T00:00:00Z') });

    // 自动档拍板的 canonical（全半角变体）胜出——预闸门优先采纳建议目标名
    expect(db.traces.find((r: any) => r.conceptKey.startsWith('动作词')).conceptKey).toBe('动作词（动词）在谓语槽位');
    expect(deps.callSkill).toHaveBeenCalledTimes(1);
  });

  it('近形建议（review 档）绝不被预闸门自动执行', async () => {
    const { db, service, deps } = buildEngine({
      traces: [
        { id: 'n1', userId: 'u1', conceptKey: '离开前翻页立好', label: 'a', source: 'derived', extractionCount: 5, masteryScore: 0.6, lastSeenAt: new Date('2026-09-10'), dueAt: null },
        { id: 'n2', userId: 'u1', conceptKey: '离开前翻页立好书', label: 'b', source: 'derived', extractionCount: 5, masteryScore: 0.6, lastSeenAt: new Date('2026-09-10'), dueAt: null },
      ],
    });
    (deps.readAudit as jest.Mock).mockResolvedValue({
      payload: JSON.stringify({
        schemaVersion: 'concept-merge-audits-v1', mode: 'observe', generatedAt: '2026-09-14T00:00:00Z',
        projectionFingerprint: 'old', candidateCount: 2,
        proposals: [{ canonical: '离开前翻页立好', aliases: ['离开前翻页立好书'], confidence: 0.9, rationale: '近形', lexicalSimilarity: 0.9, autoApplicable: true }],
        ambiguous: [], dropCandidates: [], appliedMerges: [], appliedAliasMerges: [],
      }),
    });
    await service.consolidate('u1', { force: true, now: new Date('2026-09-15T00:00:00Z') });

    expect(db.traces).toHaveLength(2);            // 近形对留给人工
    expect(deps.callSkill).toHaveBeenCalledTimes(1);
  });

  it('复核#2：挂人审队列的同形对——预闸门跳过（恒为人审项）、不阻断 LLM observe、LLM 再提同对也不转正为 auto', async () => {
    const { db, service, deps } = buildEngine({ traces: pregateRows() }, {
      callSkill: jest.fn().mockResolvedValue({
        success: true,
        // LLM 下轮把同一对又放回 merges（同形 → 会成为 auto 档）——必须被 pendingAmbiguousPairs 压住
        output: {
          merges: [{ canonical: '动作词(动词)在谓语槽位', aliases: ['动作词（动词）在谓语槽位'], confidence: 0.95, rationale: '同形' }],
          ambiguous: [{ a: '动作词(动词)在谓语槽位', b: '动作词（动词）在谓语槽位', reason: '再提' }],
          dropCandidates: [],
        },
      }),
    });
    (deps.readAudit as jest.Mock).mockResolvedValue({
      payload: JSON.stringify({
        schemaVersion: 'concept-merge-audits-v1', mode: 'observe', generatedAt: '2026-09-14T00:00:00Z',
        projectionFingerprint: 'old', candidateCount: 3,
        proposals: [],
        ambiguous: [{ a: '动作词(动词)在谓语槽位', b: '动作词（动词）在谓语槽位', reason: '人工比对中' }],
        dropCandidates: [], appliedMerges: [], appliedAliasMerges: [],
      }),
    });
    const audit = await service.consolidate('u1', { force: true, now: new Date('2026-09-15T00:00:00Z') });

    expect(db.traces).toHaveLength(3);            // 挂队对不被预闸门归并（g1/g2 都还在）
    expect(db.createdEvidence).toHaveLength(0);   // 不留凭据
    expect(deps.callSkill).toHaveBeenCalledTimes(1); // 挂队对是「留人工的决定」，不阻断 observe
    // LLM 再提同对 → 不转正为 auto 建议，也不重复入队（队列里已有）
    expect(audit?.proposals).toHaveLength(0);
    expect(audit?.ambiguous).toHaveLength(1);
  });
});
