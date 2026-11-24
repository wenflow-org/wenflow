/**
 * 教师补充槽单测（活的 path 批次 E）：promoteSupplementSlot 状态机。
 * 查库/读取走注入或临时目录，专注槽位流转：requested → delivered / expired。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  promoteSupplementSlot,
  supplementStatusForScenario,
  supplementSyncPlan,
  fetchSupplementMaterialSync,
  planStudentLinkRead,
  readStudentLink,
  STUDENT_LINK_MAX_PER_LESSON,
  type SupplementSlot,
} from '../teaching-supplement.service';

let root = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-supplement-'));
  process.env.MATERIAL_UPLOAD_DIR = root;
});

afterEach(() => {
  delete process.env.MATERIAL_UPLOAD_DIR;
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // 清理失败不影响断言
  }
});

/** 经真实入库管线造一条库记录（title 含 topic 关键词，供标题匹配）。 */
async function seedLibrary(userId: string, topic: string): Promise<string> {
  const { ingestWebMaterial } = await import('../../materials/material-web-ingest.service');
  const text = [
    `# ${topic}`,
    '',
    `${topic}的最新官方说法：本标准自发布之日起实施，替代原有规定。`.repeat(10),
  ].join('\n');
  const result = await ingestWebMaterial({ userId, url: `https://supplement.example.com/${encodeURIComponent(topic)}`, title: topic, text });
  return result!.record.id;
}

describe('promoteSupplementSlot 状态机', () => {
  it('requested + 库已入库 → delivered 并携带载荷', async () => {
    const userId = 'user_sup1';
    const materialId = await seedLibrary(userId, '费曼学习法');
    const slot: SupplementSlot = {
      status: 'requested', topic: '费曼学习法', query: '费曼学习法',
      requestedAt: new Date().toISOString(), requestedTurn: 2,
    };
    const { slot: next, payload } = promoteSupplementSlot(slot, userId, 3);
    expect(next?.status).toBe('delivered');
    expect(next?.materialId).toBe(materialId);
    expect(payload?.materialId).toBe(materialId);
    expect(payload!.excerpt.length).toBeGreaterThan(0);
    expect(payload!.excerpt.length).toBeLessThanOrEqual(1200);
  });

  it('requested + 库未命中且未超轮次 → 保持 requested（继续等）', () => {
    const slot: SupplementSlot = {
      status: 'requested', topic: '不存在的东西', query: '不存在的东西',
      requestedAt: new Date().toISOString(), requestedTurn: 2,
    };
    const { slot: next, payload } = promoteSupplementSlot(slot, 'user_sup2', 3);
    expect(next?.status).toBe('requested');
    expect(payload).toBeNull();
  });

  it('requested + 库未命中且超轮次 → expired', () => {
    const slot: SupplementSlot = {
      status: 'requested', topic: '一直没采到', query: '一直没采到',
      requestedAt: new Date().toISOString(), requestedTurn: 10,
    };
    const { slot: next, payload } = promoteSupplementSlot(slot, 'user_sup3', 14);
    expect(next?.status).toBe('expired');
    expect(payload).toBeNull();
  });

  it('无槽位 → 原样返回空', () => {
    const { slot, payload } = promoteSupplementSlot(undefined, 'user_sup4', 1);
    expect(slot).toBeNull();
    expect(payload).toBeNull();
  });

  it('槽位带 materialId（回写命中）→ 按 id 直取，即使标题匹配会命中另一篇（报告 #28）', async () => {
    const userId = 'user_sup5';
    // 诱饵：标题「PLCSIM」是查询词子串，标题匹配本会命中错的一篇；真选中的页标题与查询词毫无交集
    const decoyId = await seedLibrary(userId, 'PLCSIM');
    const { ingestWebMaterial } = await import('../../materials/material-web-ingest.service');
    const chosen = await ingestWebMaterial({
      userId,
      url: 'https://www.reddit.com/r/PLC/comments/xyz',
      title: 'Siemens PLC Software/Hardware Requirements : r/PLC',
      text: '正文内容。'.repeat(80),
    });
    const slot: SupplementSlot = {
      status: 'requested',
      topic: '西门子 TIA Portal / PLCSIM 兼容性对照',
      query: 'TIA Portal PLCSIM compatibility Windows 10 22H2 64-bit official system requirements',
      requestedAt: new Date().toISOString(),
      requestedTurn: 40,
      materialId: chosen!.record.id,
    };
    const { slot: next, payload } = promoteSupplementSlot(slot, userId, 41);
    expect(next?.status).toBe('delivered');
    expect(payload?.materialId).toBe(chosen!.record.id);
    expect(payload?.materialId).not.toBe(decoyId);
  });

  it('槽位无 materialId（回写缺失）→ 退回标题匹配兜底', async () => {
    const userId = 'user_sup6';
    const materialId = await seedLibrary(userId, '费曼学习法');
    const slot: SupplementSlot = {
      status: 'requested', topic: '费曼学习法', query: '费曼学习法',
      requestedAt: new Date().toISOString(), requestedTurn: 2,
    };
    const { slot: next, payload } = promoteSupplementSlot(slot, userId, 3);
    expect(next?.status).toBe('delivered');
    expect(payload?.materialId).toBe(materialId);
  });
});

describe('supplementStatusForScenario · 诚实回执注入判定（2026-11-22 切口 C）', () => {
  it('采集在途（requested、无载荷）→ pending（等待期每轮承接，不装失忆）', () => {
    const slot: SupplementSlot = {
      status: 'requested', topic: '复利公式', query: '复利公式',
      requestedAt: new Date().toISOString(), requestedTurn: 2,
    };
    const status = supplementStatusForScenario({ slot, payload: null }, slot);
    expect(status).toEqual({ status: 'pending', topic: '复利公式' });
  });

  it('刚翻转 expired（对象引用 ≠ artifacts 旧槽位）→ expired（一次性坦白）', () => {
    const oldSlot: SupplementSlot = {
      status: 'requested', topic: '一直没采到', query: '一直没采到',
      requestedAt: new Date().toISOString(), requestedTurn: 10,
    };
    const flipped: SupplementSlot = { ...oldSlot, status: 'expired' };
    const status = supplementStatusForScenario({ slot: flipped, payload: null }, oldSlot);
    expect(status).toEqual({ status: 'expired', topic: '一直没采到' });
  });

  it('已是旧槽位的 expired（引用相同）→ 不注（避免后续轮次反复道歉）', () => {
    const expiredSlot: SupplementSlot = {
      status: 'expired', topic: '一直没采到', query: '一直没采到',
      requestedAt: new Date().toISOString(), requestedTurn: 10,
    };
    expect(supplementStatusForScenario({ slot: expiredSlot, payload: null }, expiredSlot)).toBeNull();
  });

  it('payload 就绪（delivered）→ 不注（走 supplementaryMaterial 载荷）', () => {
    const slot: SupplementSlot = {
      status: 'delivered', topic: '费曼学习法', query: '费曼学习法',
      requestedAt: new Date().toISOString(), requestedTurn: 2, deliveredTurn: 3,
    };
    expect(supplementStatusForScenario({ slot, payload: { excerpt: '…' } }, slot)).toBeNull();
  });

  it('无槽位 → 不注', () => {
    expect(supplementStatusForScenario({ slot: null, payload: null }, undefined)).toBeNull();
  });
});

describe('supplementSyncPlan · 同轮复调触发判定（2026-11-23）', () => {
  const request = { topic: '复利公式', query: '复利公式' };

  it('正常请求 + 无旧槽位 + 未闭卷 → 尝试同步采集', () => {
    expect(supplementSyncPlan(request, undefined, {})).toBe(true);
  });

  it('无请求 / topic 空 → 不试（没有触发就没有复调）', () => {
    expect(supplementSyncPlan(null, undefined, {})).toBe(false);
    expect(supplementSyncPlan({ topic: '  ' }, undefined, {})).toBe(false);
  });

  it('已有旧槽位（在途/已交付/已过期）→ 不试（每 session ≤1 次纪律不变）', () => {
    const slot: SupplementSlot = {
      status: 'requested', topic: '旧的', query: '旧的',
      requestedAt: new Date().toISOString(), requestedTurn: 1,
    };
    expect(supplementSyncPlan(request, slot, {})).toBe(false);
  });

  it('闭卷模式（allowWebSupplement === false）→ 不试（引擎闸第一道）', () => {
    expect(supplementSyncPlan(request, undefined, { allowWebSupplement: false })).toBe(false);
    // 缺省/true = 允许
    expect(supplementSyncPlan(request, undefined, { allowWebSupplement: true })).toBe(true);
    expect(supplementSyncPlan(request, undefined, undefined)).toBe(true);
  });
});

describe('fetchSupplementMaterialSync · 带硬预算同步采集（2026-11-23）', () => {
  it('采集成功 → 透传 outcome + durationMs', async () => {
    const deps = {
      searchWeb: (async () => ({ results: [] })) as never,
      fetchWeb: (async () => ({})) as never,
      ingestWebMaterial: (async () => ({})) as never,
      findWebRecordByTitle: (() => ({ id: 'm_sync', sourceUrl: 'https://example.com/a' })) as never,
    };
    const outcome = await fetchSupplementMaterialSync('user_sync1', '话题', '查询', deps as never);
    expect(outcome.ok).toBe(true);
    expect(outcome.materialId).toBe('m_sync');
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('采集卡死超预算 → ok=false（sync-budget-exceeded），永不抛错', async () => {
    // 预算下限 2000ms（防呆）；2000 预算 vs 3s 挂死 → 超预算胜出
    process.env.MATERIAL_SUPPLEMENT_SYNC_BUDGET_MS = '2000';
    try {
      const deps = {
        searchWeb: (async () => new Promise((_, reject) => setTimeout(() => reject(new Error('hang')), 3000))) as never,
        fetchWeb: (async () => ({})) as never,
        ingestWebMaterial: (async () => ({})) as never,
        findWebRecordByTitle: (() => null) as never,
      };
      const outcome = await fetchSupplementMaterialSync('user_sync2', '话题', '查询', deps as never);
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toBe('sync-budget-exceeded');
      expect(outcome.durationMs).toBeGreaterThanOrEqual(2000);
      expect(outcome.durationMs).toBeLessThan(4000);
    } finally {
      delete process.env.MATERIAL_SUPPLEMENT_SYNC_BUDGET_MS;
    }
  });

  it('采集抛错 → ok=false 带原因，永不向上抛', async () => {
    const deps = {
      searchWeb: (async () => { throw new Error('provider down'); }) as never,
      fetchWeb: (async () => ({})) as never,
      ingestWebMaterial: (async () => ({})) as never,
      findWebRecordByTitle: (() => null) as never,
    };
    const outcome = await fetchSupplementMaterialSync('user_sync3', '话题', '查询', deps as never);
    expect(outcome.ok).toBe(false);
    expect(String(outcome.error)).toContain('provider down');
  });
});

describe('planStudentLinkRead · 学生贴链接回合前判定（2026-11-23）', () => {
  it('有 URL + 未闭卷 + 配额未满 → read 首条', () => {
    const plan = planStudentLinkRead('老师看这个 https://learn.microsoft.com/sql/t-sql', {}, 0);
    expect(plan).toEqual({ action: 'read', url: 'https://learn.microsoft.com/sql/t-sql' });
  });

  it('无 URL → skip no-url（零开销：没链接就不走抓取）', () => {
    expect(planStudentLinkRead('这句话没有任何链接', {}, 0)).toEqual({ action: 'skip', reason: 'no-url' });
  });

  it('闭卷模式 → skip closed-book（不抓但带 url，老师据此让学生贴正文）', () => {
    const plan = planStudentLinkRead(
      '看这个 https://mp.weixin.qq.com/s/abc',
      { allowWebSupplement: false },
      0
    );
    expect(plan).toEqual({ action: 'skip', reason: 'closed-book', url: 'https://mp.weixin.qq.com/s/abc' });
  });

  it('SSRF 闸：localhost/内网地址 → skip unsafe-url（不抓）', () => {
    expect(planStudentLinkRead('http://192.168.1.10/admin 看看', {}, 0))
      .toEqual({ action: 'skip', reason: 'unsafe-url', url: 'http://192.168.1.10/admin' });
  });

  it('每课独立配额：第 N 条超上限 → skip quota-exhausted（不与 supplement 配额混用）', () => {
    const url = 'https://example.com/doc';
    expect(planStudentLinkRead(`看 ${url}`, {}, STUDENT_LINK_MAX_PER_LESSON - 1)).toEqual({ action: 'read', url });
    expect(planStudentLinkRead(`看 ${url}`, {}, STUDENT_LINK_MAX_PER_LESSON))
      .toEqual({ action: 'skip', reason: 'quota-exhausted', url });
  });
});

describe('readStudentLink · 带预算读学生链接（2026-11-23）', () => {
  it('抓到正文 → 章节窗口截 ≤1200 字 + 标题', async () => {
    const deps = {
      fetchWeb: (async () => ({
        results: [{ url: 'https://example.com/a', finalUrl: 'https://example.com/a', title: 'STRING_AGG 官方文档', text: '正文内容足够长可以成为摘录。'.repeat(200), provider: 'tavily' }],
        errors: [],
        provider: 'tavily',
        attempts: ['tavily'],
        latencyMs: 10,
      })) as never,
    };
    const outcome = await readStudentLink('user_link1', 'https://example.com/a', deps as never);
    expect(outcome.ok).toBe(true);
    expect(outcome.title).toBe('STRING_AGG 官方文档');
    expect(outcome.excerpt!.length).toBeLessThanOrEqual(1200);
    expect(outcome.excerpt!.length).toBeGreaterThan(0);
  });

  it('401/403 → login-required（公众号/飞书私有文档的登录墙降级）', async () => {
    const deps = {
      fetchWeb: (async () => ({
        results: [],
        errors: [{ url: 'https://mp.weixin.qq.com/s/abc', message: 'HTTP 403 Forbidden' }],
        provider: 'tavily',
        attempts: ['tavily'],
        latencyMs: 10,
      })) as never,
    };
    const outcome = await readStudentLink('user_link2', 'https://mp.weixin.qq.com/s/abc', deps as never);
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('login-required');
  });

  it('无可读正文 → unreadable；超预算 → timeout；永不抛错', async () => {
    const unreadable = await readStudentLink('user_link3', 'https://example.com/empty', {
      fetchWeb: (async () => ({ results: [], errors: [], provider: 'tavily', attempts: ['tavily'], latencyMs: 5 })) as never,
    } as never);
    expect(unreadable.ok).toBe(false);
    expect(unreadable.code).toBe('unreadable');

    process.env.MATERIAL_SUPPLEMENT_SYNC_BUDGET_MS = '2000';
    try {
      const hanging = await readStudentLink('user_link4', 'https://example.com/hang', {
        fetchWeb: (async () => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout exceeded')), 3500))) as never,
      } as never);
      expect(hanging.ok).toBe(false);
      expect(['timeout', 'unreadable']).toContain(hanging.code);
    } finally {
      delete process.env.MATERIAL_SUPPLEMENT_SYNC_BUDGET_MS;
    }
  });
});

describe('fetchSupplementMaterial 选源（2026-09-26 与备课采集同源）', () => {
  it('黑名单丢弃 + tier 优先 + 同 host ≤2：抓取顺序为 官方域 → 站内第 1 → 站内第 2（第 3 条被 cap 挤掉）', async () => {
    const { fetchSupplementMaterial } = await import('../teaching-supplement.service');
    const attempted: string[] = [];
    const deps = {
      searchWeb: (async () => ({
        query: 'q',
        provider: 'tinyfish',
        attempts: ['tinyfish'],
        latencyMs: 1,
        page: 0,
        results: [
          { position: 1, title: '搬运1', url: 'https://wenku.baidu.com/view/1', snippet: '', provider: 'tinyfish' },
          { position: 2, title: '博客1', url: 'https://blog.example.com/1', snippet: '', provider: 'tinyfish' },
          { position: 3, title: '博客2', url: 'https://blog.example.com/2', snippet: '', provider: 'tinyfish' },
          { position: 4, title: '博客3', url: 'https://blog.example.com/3', snippet: '', provider: 'tinyfish' },
          { position: 5, title: '教育部通知页', url: 'https://www.moe.gov.cn/official', snippet: '', provider: 'tinyfish' },
        ],
      })) as never,
      // 前两条候选抓取失败（含官方页），验证逐条降级；记录全部被尝试的 URL
      fetchWeb: (async (request: { urls: string[] }) => {
        attempted.push(...request.urls);
        if (request.urls[0] !== 'https://blog.example.com/2') {
          throw new Error('boom');
        }
        return {
          results: [{ url: request.urls[0], title: '讲解页', text: '讲解正文。'.repeat(80), provider: 'tinyfish' }],
          errors: [],
          provider: 'tinyfish',
          attempts: ['tinyfish'],
          latencyMs: 1,
        };
      }) as never,
      ingestWebMaterial: (async () => ({ record: { id: 'm_sel', name: '讲解页', charCount: 480 }, deduped: false })) as never,
      findWebRecordByTitle: (() => null) as never,
    };

    const outcome = await fetchSupplementMaterial('user_sel1', '话题', '查询', deps);

    expect(outcome.ok).toBe(true);
    // 官方域优先（tier 排序进入补充链，不再是"按位置抓前 3 条"）
    expect(attempted[0]).toBe('https://www.moe.gov.cn/official');
    // 黑名单域完全不出现
    expect(attempted.some((url) => url.includes('wenku.baidu.com'))).toBe(false);
    // 同 host cap：blog.example.com 只尝试 2 条，第 3 条被挤掉
    expect(attempted.filter((url) => url.startsWith('https://blog.example.com'))).toHaveLength(2);
    expect(attempted).toHaveLength(3);
  });
});
