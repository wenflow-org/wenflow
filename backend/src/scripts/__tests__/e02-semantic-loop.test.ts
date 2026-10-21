/* eslint-disable no-console -- 测试内不打日志 */
import {
  MIN_RUN,
  THRESHOLD,
  checkEmbeddingConfig,
  evaluateSampleGate,
  loopPairCount,
  makeRng,
  readSession,
  runLengths,
  shuffledLoopRate,
  summarize,
} from '../e02-semantic-loop';

const EMBEDDING_KEYS = ['EMBEDDING_API_URL', 'EMBEDDING_API_KEY', 'EMBEDDING_PROVIDER', 'RERANK_API_URL'];

function withEnv(values: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of EMBEDDING_KEYS) saved[key] = process.env[key];
  for (const key of EMBEDDING_KEYS) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    fn();
  } finally {
    for (const key of EMBEDDING_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

describe('runLengths / loopPairCount', () => {
  it('空数组与全 false 无卡环段', () => {
    expect(runLengths([])).toEqual([]);
    expect(runLengths([false, false, false])).toEqual([]);
    expect(loopPairCount([false, false, false])).toBe(0);
  });

  it('只统计段长 >= MIN_RUN-1（=2 个相邻对）的段', () => {
    // 段长 1 不计；段长 2/3/4 计入 → 2+3+4
    const flags = [true, true, false, true, true, true, false, false, true, true, true, true];
    expect(runLengths(flags)).toEqual([2, 3, 4]);
    expect(loopPairCount(flags)).toBe(9);
    expect(loopPairCount([true, false, true, true])).toBe(2);
  });

  it('尾部未闭合段也计入', () => {
    expect(runLengths([false, true, true, true])).toEqual([3]);
    expect(loopPairCount([false, true, true, true])).toBe(3);
  });

  it('MIN_RUN 固定为 3（连续 4 轮 assistant）', () => {
    expect(MIN_RUN).toBe(3);
  });
});

describe('makeRng / shuffledLoopRate', () => {
  it('同种子可复现、不同种子不同', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const c = makeRng(43);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    const seqC = [c(), c(), c()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const v of seqA) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of seqA) expect(v).toBeLessThan(1);
  });

  it('全同向量时零假设卡环率 = 1（任意顺序都越阈）', () => {
    const v = [1, 0, 0];
    const vectors = [v, v, v, v, v];
    expect(shuffledLoopRate(vectors, THRESHOLD, 7, 20)).toBe(1);
  });

  it('两两正交的全异向量时零假设卡环率 = 0', () => {
    // 5 个 1-hot 互不相同 → 任意两两余弦为 0，任何顺序都不会越阈
    const vectors = [
      [1, 0, 0, 0, 0],
      [0, 1, 0, 0, 0],
      [0, 0, 1, 0, 0],
      [0, 0, 0, 1, 0],
      [0, 0, 0, 0, 1],
    ];
    expect(shuffledLoopRate(vectors, THRESHOLD, 7, 20)).toBe(0);
  });

  it('同种子同结果（可复算）', () => {
    const vectors = [
      [1, 0, 0],
      [0.9, 0.1, 0],
      [0, 1, 0],
      [0.1, 0.9, 0],
      [0.8, 0.2, 0],
      [0, 0, 1],
    ];
    const first = shuffledLoopRate(vectors, 0.8, 1234, 50);
    const second = shuffledLoopRate(vectors, 0.8, 1234, 50);
    expect(second).toBe(first);
  });
});

describe('readSession', () => {
  const e1 = [1, 0, 0];
  const e2 = [0, 1, 0];
  // 相邻对：1,1,0,1,1 → 卡环段 [2,2] 共 4 对；非相邻对：(e1,e1),(e1,e2),(e1,e2),(e2,e2)
  const runs = [e1, e1, e1, e2, e2, e2];

  it('阈值取 max(0.70, 非相邻基线+0.05)', () => {
    const reading = readSession('s1', runs);
    expect(reading.adjacentPairs).toBe(5);
    expect(reading.nonAdjacentMean).toBeCloseTo(0.5, 4);
    expect(reading.threshold).toBe(THRESHOLD);
    expect(reading.adjacentMean).toBeCloseTo(0.8, 4);
    expect(reading.loopRate).toBeCloseTo(0.8, 4);
    expect(reading.loopExcess).toBeCloseTo(0.8 - reading.nullLoopRate, 4);
  });

  it('非相邻基线更高时阈值被抬高到基线+0.05（全同向时相邻/基线都=1，阈值 1.05 → 不算卡环）', () => {
    const reading = readSession('s2', [e1, e1, e1, e1]);
    expect(reading.adjacentMean).toBe(1);
    expect(reading.nonAdjacentMean).toBe(1);
    expect(reading.threshold).toBeCloseTo(1.05, 2);
    expect(reading.loopRate).toBe(0);
  });

  it('前后半段按相邻对切分统计', () => {
    // 相邻 5 对：[T,T,F,T,T]，half=2 → 前后各 2 对越阈；first=2/2=1，second=2/3
    const reading = readSession('s3', runs);
    expect(reading.firstHalfLoopRate).toBe(1);
    expect(reading.secondHalfLoopRate).toBeCloseTo(2 / 3, 4);
  });

  it('summarize 输出列名与均值', () => {
    const r1 = readSession('s4', runs);
    const r2 = readSession('s5', runs);
    const s = summarize('VL', [r1, r2]);
    expect(s.column).toBe('VL');
    expect(s.sessions).toBe(2);
    expect(s.meanLoopRate).toBe(0.8);
    expect(s.perSession).toHaveLength(2);
  });
});

describe('evaluateSampleGate', () => {
  it('VL 不足 limit 时不可判', () => {
    const gate = evaluateSampleGate(12, 6, 20);
    expect(gate.vl).toEqual({ eligible: 12, limit: 20, adjudicable: false });
    expect(gate.human.adjudicable).toBe(false);
  });

  it('VL 达到 limit 时可判；真人不足只登记', () => {
    const gate = evaluateSampleGate(20, 6, 20);
    expect(gate.vl.adjudicable).toBe(true);
    expect(gate.human.adjudicable).toBe(false);
  });
});

describe('checkEmbeddingConfig', () => {
  it('缺 EMBEDDING_API_URL / EMBEDDING_API_KEY → not configured（提示两个变量名）', () => {
    withEnv({ EMBEDDING_API_URL: undefined, EMBEDDING_API_KEY: undefined, EMBEDDING_PROVIDER: undefined }, () => {
      const check = checkEmbeddingConfig(null);
      expect(check.ok).toBe(false);
      expect(check.reason).toContain('EMBEDDING_PROVIDER_NOT_CONFIGURED');
      expect(check.reason).toContain('EMBEDDING_API_URL');
      expect(check.reason).toContain('EMBEDDING_API_KEY');
      expect(check.reason).toContain('未找到 backend/.env');
    });
  });

  it('只有 RERANK_API_URL 不算配好（脚本只做向量化）', () => {
    withEnv(
      {
        EMBEDDING_API_URL: undefined,
        EMBEDDING_API_KEY: 'test-key',
        RERANK_API_URL: 'https://example.invalid/v1/rerank',
        EMBEDDING_PROVIDER: undefined,
      },
      () => {
        const check = checkEmbeddingConfig('backend/.env');
        expect(check.ok).toBe(false);
        expect(check.reason).toContain('EMBEDDING_API_URL');
      }
    );
  });

  it('URL + KEY 在位 → ok', () => {
    withEnv(
      {
        EMBEDDING_API_URL: 'https://example.invalid/v1/embeddings',
        EMBEDDING_API_KEY: 'test-key',
        RERANK_API_URL: undefined,
        EMBEDDING_PROVIDER: undefined,
      },
      () => {
        const check = checkEmbeddingConfig('backend/.env');
        expect(check.ok).toBe(true);
        expect(check.envFile).toBe('backend/.env');
      }
    );
  });
});
