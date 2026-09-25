/**
 * 教师补充槽单测（活的 path 批次 E）：promoteSupplementSlot 状态机。
 * 查库/读取走注入或临时目录，专注槽位流转：requested → delivered / expired。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { promoteSupplementSlot, type SupplementSlot } from '../teaching-supplement.service';

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
