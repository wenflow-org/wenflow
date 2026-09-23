/**
 * 误解台账去重与存量归并（2026-09-23）
 *
 * 背景：去重锚点原先是对 hypothesis **原文**做哈希。LLM 每轮换一种说法表述同一个误解，
 * 实测同一概念下 12 条 hypothesis 文字各不相同 → 行行新建、occurrenceCount 恒为 1，
 * 某学习者 22 行里只有约 4 个真误解。改锚点后用模型产出的 canonicalLabel 归一哈希。
 */
import {
  normalizeMisconceptionLabel,
  misconceptionDedupeAnchor,
  misconceptionConsolidationAuditKey,
  misconceptionConsolidationPreviewKey,
  planMisconceptionConsolidation,
  recordMisconceptions,
  consolidateMisconceptions,
  type MisconceptionLedgerDeps,
  type MisconceptionMergeRow,
} from '../misconception-ledger.service';

function row(over: Partial<MisconceptionMergeRow> & { id: string }): MisconceptionMergeRow {
  return {
    userId: 'u1',
    conceptKey: '提取社会性行为的关键词维度',
    conceptId: 'cpt_1',
    hypothesisHash: `hyp:${over.id}`,
    hypothesis: `学生误以为…${over.id}`,
    canonicalLabel: null,
    confidence: 50,
    evidence: null,
    status: 'suspected',
    occurrenceCount: 1,
    firstSeenAt: new Date('2026-09-03T00:00:00Z'),
    lastSeenAt: new Date('2026-09-03T00:00:00Z'),
    lastSessionId: null,
    resolvedAt: null,
    ...over,
  };
}

describe('normalizeMisconceptionLabel（标签归一）', () => {
  it('去空白、引号、中英标点，并压低大小写', () => {
    expect(normalizeMisconceptionLabel('  一个行为 只能对应一个维度。 ')).toBe('一个行为只能对应一个维度');
    expect(normalizeMisconceptionLabel('「抢玩具」= 规则？')).toBe('抢玩具规则');
    expect(normalizeMisconceptionLabel('Foo, Bar!')).toBe('foobar');
  });

  it('空 / null / undefined → 空串（调用方据此判定"无标签"）', () => {
    expect(normalizeMisconceptionLabel('')).toBe('');
    expect(normalizeMisconceptionLabel(null as unknown as string)).toBe('');
  });
});

describe('misconceptionDedupeAnchor（去重锚点）', () => {
  it('有标签 → lbl: 前缀，且标签的标点/空白差异不影响锚点', () => {
    const a = misconceptionDedupeAnchor('假设 A 的措辞', '一个行为只能对应一个维度');
    const b = misconceptionDedupeAnchor('完全不同的另一句假设', ' 一个行为只能对应一个维度。');
    expect(a).toBe(b);
    expect(a.startsWith('lbl:')).toBe(true);
  });

  it('无标签 → hyp: 前缀，退回归一后的 hypothesis 哈希', () => {
    const a = misconceptionDedupeAnchor('学生误以为一个行为只能对应一个维度', null);
    const b = misconceptionDedupeAnchor('学生误以为一个行为只能对应一个维度。', null);
    expect(a).toBe(b);
    expect(a.startsWith('hyp:')).toBe(true);
  });

  it('不同标签 → 不同锚点（不会被误并）', () => {
    expect(misconceptionDedupeAnchor('x', '关键词提取等同于行为复述'))
      .not.toBe(misconceptionDedupeAnchor('x', '一个行为只能对应一个维度'));
  });

  it('标签缺失（空串）等价于无标签', () => {
    expect(misconceptionDedupeAnchor('假设文本', '   '))
      .toBe(misconceptionDedupeAnchor('假设文本', null));
  });
});

describe('planMisconceptionConsolidation（归并计划，纯函数）', () => {
  it('同概念同标签的多行 → 并成一行，occurrenceCount 求和、confidence 取最大', () => {
    const plan = planMisconceptionConsolidation('u1', [
      row({ id: 'a', canonicalLabel: '一个行为只能对应一个维度', occurrenceCount: 3, confidence: 50, firstSeenAt: new Date('2026-09-01T00:00:00Z') }),
      row({ id: 'b', canonicalLabel: '一个行为只能对应一个维度', occurrenceCount: 5, confidence: 75 }),
      row({ id: 'c', canonicalLabel: '一个行为只能对应一个维度。', occurrenceCount: 1, confidence: 25, lastSeenAt: new Date('2026-09-09T00:00:00Z'), evidence: '最近一次原话' }),
    ]);
    expect(plan.groups).toHaveLength(1);
    const g = plan.groups[0];
    expect(g.byLabel).toBe(true);
    expect(g.winnerId).toBe('a'); // 最早观察到的那行留任
    expect(g.mergedFields.occurrenceCount).toBe(9);
    expect(g.mergedFields.confidence).toBe(75);
    expect(g.mergedFields.evidence).toBe('最近一次原话'); // 取最近一次的证据
    expect(g.deletedRows.map((r) => r.id).sort()).toEqual(['b', 'c']);
    expect(plan.deletedCount).toBe(2);
  });

  it('anchor 被改写为 lbl: 锚点（否则下一轮写入又会新建一行）', () => {
    const plan = planMisconceptionConsolidation('u1', [
      row({ id: 'a', hypothesisHash: 'hyp:old1', canonicalLabel: '标签 X' }),
      row({ id: 'b', hypothesisHash: 'hyp:old2', canonicalLabel: '标签 X' }),
    ]);
    expect(String(plan.groups[0].mergedFields.hypothesisHash).startsWith('lbl:')).toBe(true);
    expect(plan.groups[0].mergedFields.hypothesisHash)
      .toBe(misconceptionDedupeAnchor('任意', '标签 X'));
  });

  it('status 只升不降：任一 confirmed 即 confirmed，全 addressed 才 addressed', () => {
    const mk = (ids: Array<[string, string]>) => planMisconceptionConsolidation('u1',
      ids.map(([id, status]) => row({ id, canonicalLabel: 'L', status })));
    expect(mk([['a', 'suspected'], ['b', 'confirmed']]).groups[0].mergedFields.status).toBe('confirmed');
    expect(mk([['a', 'addressed'], ['b', 'addressed']]).groups[0].mergedFields.status).toBe('addressed');
    expect(mk([['a', 'suspected'], ['b', 'suspected']]).groups[0].mergedFields.status).toBe('suspected');
    // addressed + confirmed 混合 → 不能升成 addressed（还没全好）
    expect(mk([['a', 'addressed'], ['b', 'confirmed']]).groups[0].mergedFields.status).toBe('confirmed');
  });

  it('**不跨概念**归并：同一标签落在两个 conceptKey 下是两条独立记录', () => {
    const plan = planMisconceptionConsolidation('u1', [
      row({ id: 'a', conceptKey: 'KC-A', canonicalLabel: '同一个标签' }),
      row({ id: 'b', conceptKey: 'KC-A', canonicalLabel: '同一个标签' }),
      row({ id: 'c', conceptKey: 'KC-B', canonicalLabel: '同一个标签' }),
      row({ id: 'd', conceptKey: 'KC-B', canonicalLabel: '同一个标签' }),
    ]);
    expect(plan.groups).toHaveLength(2);
    expect(plan.groups.map((g) => g.conceptKey).sort()).toEqual(['KC-A', 'KC-B']);
    expect(plan.groups.every((g) => g.deletedRows.length === 1)).toBe(true);
  });

  it('无标签行只有归一文本完全相同才并；文本不同 → 保留并计入 ungroupedRows', () => {
    const plan = planMisconceptionConsolidation('u1', [
      row({ id: 'a', hypothesis: '学生误以为一个行为只能归入一个维度' }),
      row({ id: 'b', hypothesis: '学生误以为一个行为只能归入一个维度。' }), // 仅标点差异 → 并
      row({ id: 'c', hypothesis: '学生把教育建议当成条目本身的一部分，尚未区分目标描述与教育建议' }),
      row({ id: 'd', hypothesis: '学生仍倾向于用行为字面与条目关键词的表面重叠来定位' }),
    ]);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].byLabel).toBe(false);
    expect(plan.groups[0].deletedRows.map((r) => r.id)).toEqual(['b']);
    expect(plan.ungroupedRows).toBe(2); // c / d 语义相近但文本不同——不猜
  });

  it('单行组不产出归并；有标签的单行组也不计入 ungroupedRows', () => {
    const plan = planMisconceptionConsolidation('u1', [
      row({ id: 'a', canonicalLabel: '已归位的标签' }),
      row({ id: 'b', hypothesis: '孤立的一条无标签假设' }),
    ]);
    expect(plan.groups).toHaveLength(0);
    expect(plan.deletedCount).toBe(0);
    expect(plan.ungroupedRows).toBe(1);
    expect(plan.scannedRows).toBe(2);
  });

  it('firstSeenAt 同刻时按 id 定序 → winner 稳定可复现', () => {
    const same = new Date('2026-09-01T00:00:00Z');
    const plan = planMisconceptionConsolidation('u1', [
      row({ id: 'zzz', canonicalLabel: 'L', firstSeenAt: same }),
      row({ id: 'aaa', canonicalLabel: 'L', firstSeenAt: same }),
    ]);
    expect(plan.groups[0].winnerId).toBe('aaa');
  });

  it('deletedRows 带完整快照（审计要能回溯"这 12 行原本是什么"）', () => {
    const plan = planMisconceptionConsolidation('u1', [
      row({ id: 'a', canonicalLabel: 'L' }),
      row({ id: 'b', canonicalLabel: 'L', hypothesis: '原话 B', evidence: '证据 B', lastSessionId: 's-2' }),
    ]);
    const deleted = plan.groups[0].deletedRows[0];
    expect(deleted.hypothesis).toBe('原话 B');
    expect(deleted.evidence).toBe('证据 B');
    expect(deleted.lastSessionId).toBe('s-2');
  });
});

/** 记录调用顺序的假 deps */
function makeDeps(initialRows: MisconceptionMergeRow[]) {
  const calls: string[] = [];
  const state = { rows: [...initialRows] };
  const deps: MisconceptionLedgerDeps = {
    findByAnchor: async ({ conceptKey, hypothesisHash }) => {
      calls.push('findByAnchor');
      const hit = state.rows.find((r) => r.conceptKey === conceptKey && r.hypothesisHash === hypothesisHash);
      return hit ? { id: hit.id, status: hit.status, occurrenceCount: hit.occurrenceCount } : null;
    },
    findActiveSiblings: async ({ conceptKey }) => {
      calls.push('findActiveSiblings');
      return state.rows
        .filter((r) => r.conceptKey === conceptKey && r.status !== 'addressed')
        .map((r) => ({ id: r.id, status: r.status, occurrenceCount: r.occurrenceCount, hypothesisHash: r.hypothesisHash, canonicalLabel: r.canonicalLabel }));
    },
    findAllRows: async () => { calls.push('findAllRows'); return state.rows; },
    applyReobservation: async (write) => { calls.push(`applyReobservation:${write.id}`); return {}; },
    insertRow: async (write) => { calls.push('insertRow'); state.rows.push(write); return {}; },
    deleteRows: async (ids) => { calls.push(`deleteRows:${ids.join(',')}`); return {}; },
    updateRowFields: async (id) => { calls.push(`updateRowFields:${id}`); return {}; },
    readAudit: async () => null,
    writeAudit: async (_userId, _payload, _generatedAt, kind) => { calls.push(`writeAudit:${kind}`); return {}; },
    resolveConceptId: async () => 'cpt_resolved',
  };
  return { deps, calls, state };
}

describe('recordMisconceptions（写路径按标签锚点去重）', () => {
  it('同一标签、**不同措辞**的第二条 → 更新既有行而非新建（这正是原先失控的地方）', async () => {
    const first = row({ id: 'r1', canonicalLabel: '一个行为只能对应一个维度', hypothesisHash: misconceptionDedupeAnchor('随便', '一个行为只能对应一个维度') });
    const { deps, calls } = makeDeps([first]);
    await recordMisconceptions('u1', 's1', [{
      conceptKey: first.conceptKey,
      hypothesis: '学生误以为一个行为描述只能归入一个维度，因此会怀疑自己选错',
      canonicalLabel: '一个行为只能对应一个维度',
      confidence: 50,
    }], deps);
    expect(calls).toContain('applyReobservation:r1');
    expect(calls).not.toContain('insertRow');
  });

  it('历史行是 hypothesis 锚点、本轮才第一次带标签 → 并进该行并把锚点改写为 lbl:', async () => {
    const legacy = row({ id: 'r1', canonicalLabel: '一个行为只能对应一个维度', hypothesisHash: 'hyp:legacy' });
    const { deps, calls } = makeDeps([legacy]);
    const writes: Array<{ reanchorTo?: string }> = [];
    const spyDeps: MisconceptionLedgerDeps = {
      ...deps,
      applyReobservation: async (write) => { writes.push(write); calls.push(`applyReobservation:${write.id}`); return {}; },
    };
    await recordMisconceptions('u1', 's1', [{
      conceptKey: legacy.conceptKey,
      hypothesis: '换一种说法表述同一个误解',
      canonicalLabel: '一个行为只能对应一个维度',
      confidence: 75,
    }], spyDeps);
    expect(calls).toContain('applyReobservation:r1');
    expect(writes[0].reanchorTo).toBe(misconceptionDedupeAnchor('x', '一个行为只能对应一个维度'));
  });

  it('锚点已命中时不改写（避免无谓写）', async () => {
    const { deps } = makeDeps([]);
    const writes: Array<{ reanchorTo?: string }> = [];
    const spyDeps: MisconceptionLedgerDeps = {
      ...deps,
      applyReobservation: async (write) => { writes.push(write); return {}; },
    };
    const created: string[] = [];
    const createDeps: MisconceptionLedgerDeps = {
      ...spyDeps,
      findByAnchor: async () => ({ id: 'r1', status: 'suspected', occurrenceCount: 1 }),
      insertRow: async (write) => { created.push(write.id); return {}; },
    };
    await recordMisconceptions('u1', 's1', [{ conceptKey: 'KC', hypothesis: 'h', canonicalLabel: 'L', confidence: 50 }], createDeps);
    expect(created).toEqual([]);
    expect(writes[0].reanchorTo).toBeUndefined();
  });

  it('无标签 → hyp: 锚点（不再对原文哈希，标点差异不再造成重复行）', async () => {
    const { deps, calls } = makeDeps([]);
    const created: MisconceptionMergeRow[] = [];
    const spyDeps: MisconceptionLedgerDeps = {
      ...deps,
      insertRow: async (write) => { created.push(write); calls.push('insertRow'); return {}; },
    };
    await recordMisconceptions('u1', 's1', [{ conceptKey: 'KC', hypothesis: '学生误以为A。', confidence: 50 }], spyDeps);
    expect(String(created[0].hypothesisHash).startsWith('hyp:')).toBe(true);
    expect(created[0].hypothesisHash).toBe(misconceptionDedupeAnchor('学生误以为A', null));
    expect(created[0].occurrenceCount).toBe(1);
  });

  it('best-effort：deps 抛错不外抛（不阻断教学回合）', async () => {
    const boom: MisconceptionLedgerDeps = {
      ...makeDeps([]).deps,
      findByAnchor: async () => { throw new Error('db down'); },
    };
    await expect(recordMisconceptions('u1', 's1', [{ conceptKey: 'KC', hypothesis: 'h', confidence: 50 }], boom))
      .resolves.toBeUndefined();
  });
});

describe('consolidateMisconceptions（存量归并执行）', () => {
  const dup = [
    row({ id: 'a', canonicalLabel: 'L', occurrenceCount: 2 }),
    row({ id: 'b', canonicalLabel: 'L' }),
    row({ id: 'c', canonicalLabel: 'L' }),
  ];

  it('observe（默认）只写审计，**不动数据**', async () => {
    const { deps, calls } = makeDeps(dup);
    const plan = await consolidateMisconceptions('u1', { mode: 'observe', deps });
    expect(plan?.deletedCount).toBe(2);
    expect(calls.filter((c) => c.startsWith('deleteRows') || c.startsWith('updateRowFields'))).toEqual([]);
    expect(calls).toContain('writeAudit:preview');
  });

  it('observe 与 apply 写**不同的审计键**（dry-run 不得冲掉回滚凭据）', async () => {
    const { deps, calls } = makeDeps(dup);
    await consolidateMisconceptions('u1', { mode: 'observe', deps });
    await consolidateMisconceptions('u1', { mode: 'apply', deps });
    expect(calls.filter((c) => c.startsWith('writeAudit'))).toEqual(['writeAudit:preview', 'writeAudit:applied']);
    expect(misconceptionConsolidationAuditKey('u1'))
      .not.toBe(misconceptionConsolidationPreviewKey('u1'));
  });

  it('apply 先删后写（winner 要拿的标签锚点可能正被 loser 占着，顺序不能反）', async () => {
    const { deps, calls } = makeDeps(dup);
    const plan = await consolidateMisconceptions('u1', { mode: 'apply', deps });
    expect(plan?.deletedCount).toBe(2);
    const delIdx = calls.findIndex((c) => c.startsWith('deleteRows'));
    const updIdx = calls.findIndex((c) => c.startsWith('updateRowFields'));
    expect(delIdx).toBeGreaterThanOrEqual(0);
    expect(updIdx).toBeGreaterThan(delIdx);
    expect(calls[delIdx]).toBe('deleteRows:b,c');
    expect(calls[updIdx]).toBe('updateRowFields:a');
  });

  it('没有行 → 返回 null（不写空审计）', async () => {
    const { deps, calls } = makeDeps([]);
    expect(await consolidateMisconceptions('u1', { deps })).toBeNull();
    expect(calls).not.toContain('writeAudit:preview');
  });
});
