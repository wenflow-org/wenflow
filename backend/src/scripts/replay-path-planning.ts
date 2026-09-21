/* eslint-disable no-console -- 一次性诊断 CLI：面向人读的输出，不需要 logger */
/**
 * **只重放 path 一步**（复用历史 Goal 产出，跳过 Goal 对话）——只读、**不落库**。
 *
 * 为什么需要它：
 *   VL 全流程（Goal 对话 → Path）一轮要 3–5 分钟，且 Goal 对话段实测常以
 *   `fetch failed` 超时收场（2026-09-21：连续 3 位学习者都在 304s 前后失败）。
 *   而"路径名称/体量/结构"这类改动**只受 path-planning 影响**，重放这一步即可验收：
 *   单次 LLM 调用、秒到分钟级、零写入、且与历史输入**配对**（同输入同模型，单变量）。
 *
 * 输入来源：`path_generation_runs.inputSnapshot`（= 生成时的完整 GeneratePathData，
 *   由生产链路落库），其中 `userProfile.normalizedInput` 正是 path-planning 要的整份输入。
 *
 * 与生产的同源性：复用生产函数 `buildPathAgentInput` + `buildFramedNormalizedInput`
 *   （不做第二套组装），并走同一个 `executeSkill(pathAgentDefinition)`。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/replay-path-planning.ts --latest=2
 *   npx ts-node --transpile-only src/scripts/replay-path-planning.ts --path=lp_xxx
 *   npx ts-node --transpile-only src/scripts/replay-path-planning.ts --latest=2 --keyword=入门
 */
import 'dotenv/config';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { executeSkill } from '../skills';
import { pathAgentDefinition } from '../skills/path-planning';
import { normalizeAgentOutput } from '../agents/output-normalizer';
import { buildFramedNormalizedInput } from '../services/learning/path-planning-hints';
import { buildPathAgentInput } from '../services/learning/generation/path-generation.core';
import { stripDeliveryLevelWords } from '../services/learning/path-naming';

const DB_PATH = path.resolve(__dirname, '..', '..', 'prisma', 'dev.db');

function arg(name: string, fallback: string | null = null): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

interface SnapshotRow {
  learningPathId: string;
  inputSnapshot: string;
  createdAt: number;
}

function pickSnapshots(limit: number, onlyPathId: string | null): SnapshotRow[] {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const base = `
      SELECT r.learningPathId, r.inputSnapshot, r.createdAt, u.name AS owner
        FROM path_generation_runs r
        JOIN learning_paths lp ON lp.id = r.learningPathId
        JOIN users u ON u.id = lp.userId
       WHERE r.phase = 'core' AND r.status = 'succeeded' AND r.inputSnapshot IS NOT NULL
    `;
    const rows = onlyPathId
      ? db.prepare(`${base} AND r.learningPathId = ? ORDER BY r.createdAt DESC LIMIT 1`).all(onlyPathId)
      : db.prepare(`${base} ORDER BY r.createdAt DESC LIMIT 40`).all();
    // 同一学习者只取最新一条，保证样本多样（否则会被同一个人的多次重跑占满）
    const seen = new Set<string>();
    const picked: Array<SnapshotRow & { owner: string }> = [];
    for (const row of rows as any[]) {
      const key = String(row.owner);
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(row);
      if (picked.length >= limit) break;
    }
    return picked as any;
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const limit = Number(arg('latest', '2')) || 2;
  const onlyPathId = arg('path');
  const expectKeyword = arg('keyword');   // 可选：断言旧口径关键词（如"入门"）是否已被消除
  const rows = pickSnapshots(limit, onlyPathId);
  if (rows.length === 0) {
    console.error('[replay] 没找到可重放的 inputSnapshot');
    process.exitCode = 1;
    return;
  }
  console.log(`[replay] 重放 ${rows.length} 例（同输入、单变量、不落库）\n`);

  for (const row of rows) {
    const data = JSON.parse(row.inputSnapshot);
    const agentInput = buildPathAgentInput(data);
    const framedRaw = data.userProfile?.normalizedInput || null;
    const framed = buildFramedNormalizedInput(framedRaw);
    agentInput.metadata = { ...(agentInput.metadata || {}), normalizedInput: framed };

    const goalText = String(agentInput.goal || '').replace(/\s+/g, ' ').slice(0, 56);
    const startedAt = Date.now();
    const result = await executeSkill(pathAgentDefinition, {
      input: agentInput,
      context: { userId: data.userId },
    });
    const normalized = normalizeAgentOutput('skill:path-planning', result);
    const payload = (normalized as any)?.internal?.ext?.path?.path
      || (normalized as any)?.internal?.path
      || (result as any)?.path;
    const ms = Date.now() - startedAt;

    if (!payload?.name) {
      console.log(`✗ ${row.owner} | ${ms}ms | 无输出：${JSON.stringify(normalized?.error || result).slice(0, 160)}\n`);
      continue;
    }
    const strip = stripDeliveryLevelWords(String(payload.name));
    const milestones = Array.isArray(payload.milestones) ? payload.milestones.length : 0;
    const flag = strip.stripped.length ? `⚠ 仍含水平词（剔除层兜住：${strip.stripped.join('/')}）` : '✓ 无水平词';
    console.log(`【${row.owner}】${ms}ms  输入目标：${goalText}…`);
    console.log(`  原始 name : ${payload.name}`);
    console.log(`  落库后 name: ${strip.title}   ${flag}`);
    console.log(`  段数 ${milestones} | 学时 ${payload.estimatedHours ?? '-'} | 周 ${payload.estimatedWeeks ?? '-'}`);
    if (expectKeyword) {
      const hit = String(payload.name).includes(expectKeyword);
      console.log(`  断言「原始 name 含 ${expectKeyword}」: ${hit ? '仍含 ✗' : '已消除 ✓'}`);
    }
    console.log();
  }
}

void main().catch((error) => {
  console.error('[replay] 失败', error);
  process.exitCode = 1;
});
