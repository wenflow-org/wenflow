/**
 * #47 内容正确性最小闭环：抽样/标注/指标的纯函数口径。
 * 这些量会被写进 issue 证据与运营周报，断言的是"口径本身"，不是某个阈值好不好看。
 */
import {
  CONTENT_REVIEW_SALT,
  collectSampledTurns,
  computeContentReviewMetrics,
  isReviewableTeacherTurn,
  isSampledTurn,
  parseContentReviewLabel,
  parseTeacherTurns,
  serializeContentReviewLabel,
  stableHash,
} from '../content-correctness';

describe('stableHash（确定性抽样底座）', () => {
  it('同输入恒等、不同输入不同', () => {
    expect(stableHash('a')).toBe(stableHash('a'));
    expect(stableHash('a')).not.toBe(stableHash('b'));
    expect(Number.isInteger(stableHash('消息-1'))).toBe(true);
  });
});

describe('isSampledTurn（同一条消息永远得到同一个结论）', () => {
  it('rate<=0 不抽、rate>=1 全抽', () => {
    expect(isSampledTurn(1, 0)).toBe(false);
    expect(isSampledTurn(1, -0.5)).toBe(false);
    expect(isSampledTurn(1, 1)).toBe(true);
    expect(isSampledTurn(1, 2)).toBe(true);
  });

  it('确定性：重复调用结论一致', () => {
    for (const id of [1, 42, 1001, 987654]) {
      expect(isSampledTurn(id, 0.3)).toBe(isSampledTurn(id, 0.3));
    }
  });

  it('抽样比例近似 rate（5000 条，20% ± 3pp）', () => {
    let hit = 0;
    for (let id = 1; id <= 5000; id += 1) if (isSampledTurn(id, 0.2)) hit += 1;
    const ratio = hit / 5000;
    expect(ratio).toBeGreaterThan(0.17);
    expect(ratio).toBeLessThan(0.23);
  });

  it('换盐换抽样集合（不同周/不同频道互不复用）', () => {
    const a = isSampledTurn(123, 0.5, 'salt-a');
    let differs = false;
    for (const id of [123, 124, 125, 126, 127, 128, 129, 130]) {
      if (isSampledTurn(id, 0.5, 'salt-b') !== isSampledTurn(id, 0.5, 'salt-a')) differs = true;
    }
    expect(typeof a).toBe('boolean');
    expect(differs).toBe(true);
    expect(CONTENT_REVIEW_SALT.length).toBeGreaterThan(0);
  });
});

describe('isReviewableTeacherTurn（合成消息不算教师讲错）', () => {
  const base = { role: 'assistant' as const, content: '这是一句教师正文', timestamp: 't' };

  it('教师正文 → 可评审', () => {
    expect(isReviewableTeacherTurn(base)).toBe(true);
  });

  it('学员消息 / 空正文 / 检查点合成 / 伴学消息 → 不进抽检', () => {
    expect(isReviewableTeacherTurn({ ...base, role: 'user' })).toBe(false);
    expect(isReviewableTeacherTurn({ ...base, content: '   ' })).toBe(false);
    expect(isReviewableTeacherTurn({ ...base, checkpoint: true })).toBe(false);
    expect(isReviewableTeacherTurn({ ...base, peer: true })).toBe(false);
    expect(isReviewableTeacherTurn(null)).toBe(false);
  });
});

describe('parseTeacherTurns（侧表行 → 可评审回合）', () => {
  it('只留教师正文，跳过坏 payload 与合成消息', () => {
    const rows = [
      { id: 1, payload: JSON.stringify({ role: 'assistant', content: '定义讲错了', timestamp: 't' }) },
      { id: 2, payload: JSON.stringify({ role: 'user', content: '老师再说一遍', timestamp: 't' }) },
      { id: 3, payload: JSON.stringify({ role: 'assistant', content: '检查点', timestamp: 't', checkpoint: true }) },
      { id: 4, payload: '{broken json' },
      { id: 5, payload: JSON.stringify({ role: 'assistant', content: '  ', timestamp: 't' }) },
    ];
    const turns = parseTeacherTurns(rows);
    expect(turns).toEqual([{ messageId: 1, content: '定义讲错了' }]);
  });
});

describe('标注序列化（留痕可回读）', () => {
  it('往返一致；非法 verdict / 坏 JSON → null', () => {
    const label = { messageId: 7, verdict: 'incorrect' as const, note: '把信度说成效度', reviewerUserId: 'u1' };
    const payload = serializeContentReviewLabel(label);
    expect(parseContentReviewLabel(payload)).toMatchObject(label);
    expect(parseContentReviewLabel(JSON.stringify({ messageId: 7, verdict: 'bogus' }))).toBeNull();
    expect(parseContentReviewLabel('{oops')).toBeNull();
    expect(parseContentReviewLabel(JSON.stringify({ verdict: 'correct' }))).toBeNull();
  });
});

describe('computeContentReviewMetrics（检出率与覆盖率）', () => {
  it('错误率=错/已标注；覆盖率=已标注/抽中；集合外标注单列', () => {
    const metrics = computeContentReviewMetrics({
      sampledIds: [1, 2, 3],
      labels: [
        { messageId: 1, verdict: 'incorrect' },
        { messageId: 2, verdict: 'correct' },
        { messageId: 999, verdict: 'incorrect' },
      ],
    });
    expect(metrics.sampled).toBe(3);
    expect(metrics.labeled).toBe(2);
    expect(metrics.incorrect).toBe(1);
    expect(metrics.correct).toBe(1);
    expect(metrics.errorRate).toBeCloseTo(0.5, 6);
    expect(metrics.coverage).toBeCloseTo(2 / 3, 6);
    expect(metrics.outsideSample).toBe(1);
  });

  it('未标注时错误率是 null（不是 0，避免"零错误"假象）', () => {
    const metrics = computeContentReviewMetrics({ sampledIds: [1, 2], labels: [] });
    expect(metrics.errorRate).toBeNull();
    expect(metrics.coverage).toBe(0);
  });

  it('同一消息重复标注只算一次（历史重复行兜底）', () => {
    const metrics = computeContentReviewMetrics({
      sampledIds: [1],
      labels: [
        { messageId: 1, verdict: 'incorrect' },
        { messageId: 1, verdict: 'correct' },
      ],
    });
    expect(metrics.labeled).toBe(1);
    expect(metrics.correct).toBe(1);
  });
});

describe('collectSampledTurns（#120：窗口计数不随 limit 提前结束变化）', () => {
  // 前 3 个真人会话、后 3 个虚拟学习者会话；limit=1 时只走到第 1 个会话。
  // 旧实现把 virtualSessions 累加放在会 break 的循环里 → 此时虚拟计数为 0。
  const sessions = [
    { id: 's1', userId: 'u1', taskId: 't1', users: { isVirtualLearner: false } },
    { id: 's2', userId: 'u2', taskId: 't1', users: { isVirtualLearner: false } },
    { id: 's3', userId: 'u3', taskId: 't2', users: { isVirtualLearner: false } },
    { id: 's4', userId: 'u4', taskId: 't2', users: { isVirtualLearner: true } },
    { id: 's5', userId: 'u5', taskId: 't2', users: { isVirtualLearner: true } },
    { id: 's6', userId: 'u6', taskId: 't2', users: { isVirtualLearner: true } },
  ];
  const firstMessageId: Record<string, number> = { s1: 1, s2: 11, s3: 21, s4: 31, s5: 41, s6: 51 };
  const loadedSessions: string[] = [];
  const loadMessages = async (sessionId: string) => {
    loadedSessions.push(sessionId);
    const id = firstMessageId[sessionId];
    const payload = (content: string) => JSON.stringify({ role: 'assistant', content, timestamp: 't' });
    return [
      { id, payload: payload(`教师回合 ${id}`) },
      { id: id + 1, payload: payload(`教师回合 ${id + 1}`) },
    ];
  };
  const base = { sessions, loadMessages, sampleRate: 1, perSessionCap: 6 };

  it('limit 提前结束只影响样本量，virtual/real 仍按完整窗口计数', async () => {
    loadedSessions.length = 0;
    const limited = await collectSampledTurns({ ...base, limit: 1 });
    // 确已提前结束：只加载了第 1 个会话，样本也只取 1 条。
    expect(loadedSessions).toEqual(['s1']);
    expect(limited.sampled).toHaveLength(1);

    loadedSessions.length = 0;
    const full = await collectSampledTurns({ ...base, limit: 1000 });
    expect(loadedSessions).toHaveLength(sessions.length);
    expect(full.sampled).toHaveLength(12);

    // 计数口径与 limit 无关：两者都等于完整窗口的 6 会话（真人 3 / 虚拟 3）。
    for (const result of [limited, full]) {
      expect(result.scannedSessions).toBe(6);
      expect(result.realSessions).toBe(3);
      expect(result.virtualSessions).toBe(3);
    }

    // --real-only 只影响取样，计数仍覆盖完整窗口。
    loadedSessions.length = 0;
    const realOnly = await collectSampledTurns({ ...base, limit: 1, realOnly: true });
    expect(realOnly.virtualSessions).toBe(3);
    expect(realOnly.realSessions).toBe(3);
    expect(realOnly.sampled.map((turn) => turn.sessionId)).toEqual(['s1']);
  });
});
