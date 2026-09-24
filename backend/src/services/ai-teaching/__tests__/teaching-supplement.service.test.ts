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
