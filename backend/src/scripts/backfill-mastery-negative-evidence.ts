/**
 * 掌握度负证据存量回填（#52，**只读默认 / --apply 才写**）
 *
 * 背景：852fadb9（2026-10-17T12:21:59Z）在 KnowledgeStateService.merge 修好了
 * 「code 负证据必须把 mastered / >=80 的目标点降为 learning@79」——但修复前落库的
 * knowledgeState / wrapup.summary.knowledgeItems 仍是旧口径（mastered@100），
 * 读侧与对外展示照旧宣称「已达标」。本脚本只补这些存量行，不改代码语义。
 *
 * 判据（与 merge 的仲裁同口径）：
 *   1. 会话 mode !== 'review'（复习课 allowDegrade 通道，LLM 判定按设计可保留 mastered）；
 *   2. teachingState.checkpointHistory 存在 judgedBy='code' && passed===false 且带 conceptName；
 *   3. knowledgeState 中同名点（normalizeConceptName 折叠空白+小写）status==='mastered'
 *      或（status!=='pending' 且 progress>=COMPLETION_TARGET_PROGRESS_FLOOR）；
 *   4. wrapup.summary.knowledgeItems 同名项同判据（仅这两列会被写）。
 *
 * 写入：status='learning'、progress=min(progress, 79)、evidenceSource='mixed'；保留 kcId。
 * **不碰 updatedAt**（否则会污染「修复前/后」审计口径）。单事务、幂等（回填后判据不再命中）。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/backfill-mastery-negative-evidence.ts          # dry-run（默认）
 *   npx ts-node --transpile-only src/scripts/backfill-mastery-negative-evidence.ts --apply  # 写库
 */
import path from 'node:path';
import { normalizeConceptName } from '../services/ai-teaching/checkpoint-shared';
import { COMPLETION_TARGET_PROGRESS_FLOOR } from '../services/ai-teaching/KnowledgeStateService';

const CAPPED_PROGRESS = COMPLETION_TARGET_PROGRESS_FLOOR - 1;
const DB_PATH = path.resolve(__dirname, '../../prisma/dev.db');
const APPLY = process.argv.includes('--apply');

interface SessionRow {
  id: string;
  mode: string | null;
  knowledgeState: string | null;
  teachingState: string | null;
  wrapup: string | null;
}

interface TeachingStateLike {
  checkpointHistory?: Array<Record<string, unknown>>;
}

interface KnowledgePointLike {
  name?: unknown;
  status?: unknown;
  progress?: unknown;
  [key: string]: unknown;
}

interface WrapupLike {
  summary?: { knowledgeItems?: KnowledgePointLike[]; [key: string]: unknown };
  [key: string]: unknown;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 该会话的 code 失败概念（归一名集合） */
export function failedConceptKeys(teachingState: TeachingStateLike | null): Set<string> {
  const out = new Set<string>();
  for (const h of teachingState?.checkpointHistory || []) {
    if (!h || h.judgedBy !== 'code' || h.passed !== false) continue;
    const key = normalizeConceptName(h.conceptName);
    if (key) out.add(key);
  }
  return out;
}

export function isViolatingPoint(point: KnowledgePointLike, failed: Set<string>): boolean {
  const key = normalizeConceptName(point?.name);
  if (!key || !failed.has(key)) return false;
  if (point.status === 'mastered') return true;
  return point.status !== 'pending' && Number(point.progress) >= COMPLETION_TARGET_PROGRESS_FLOOR;
}

export function capPoint(point: KnowledgePointLike): KnowledgePointLike {
  const progress = Number(point.progress);
  return {
    ...point,
    status: 'learning',
    progress: Math.min(Number.isFinite(progress) ? progress : 0, CAPPED_PROGRESS),
    evidenceSource: 'mixed',
  };
}

export interface SessionBackfillPlan {
  id: string;
  knowledgeState?: string;
  wrapup?: string;
  knowledgePoints: number;
  wrapupItems: number;
}

export function planSession(row: SessionRow): SessionBackfillPlan | null {
  if (row.mode === 'review') return null;
  const failed = failedConceptKeys(parseJson<TeachingStateLike>(row.teachingState, {}));
  if (!failed.size) return null;

  const knowledge = parseJson<KnowledgePointLike[]>(row.knowledgeState, []);
  const violating = Array.isArray(knowledge) ? knowledge.filter((p) => isViolatingPoint(p, failed)) : [];

  const wrapup = parseJson<WrapupLike | null>(row.wrapup, null);
  const wrapupItems = Array.isArray(wrapup?.summary?.knowledgeItems)
    ? wrapup!.summary!.knowledgeItems!.filter((it) => isViolatingPoint(it, failed))
    : [];

  if (!violating.length && !wrapupItems.length) return null;
  const plan: SessionBackfillPlan = {
    id: row.id,
    knowledgePoints: 0,
    wrapupItems: 0,
  };
  if (violating.length) {
    plan.knowledgeState = JSON.stringify(
      (knowledge as KnowledgePointLike[]).map((p) => (isViolatingPoint(p, failed) ? capPoint(p) : p)),
    );
    plan.knowledgePoints = violating.length;
  }
  if (wrapupItems.length && wrapup?.summary) {
    plan.wrapup = JSON.stringify({
      ...wrapup,
      summary: {
        ...wrapup.summary,
        knowledgeItems: wrapup.summary.knowledgeItems!.map((it) =>
          isViolatingPoint(it, failed) ? capPoint(it) : it,
        ),
      },
    });
    plan.wrapupItems = wrapupItems.length;
  }
  return plan;
}

function main(): void {
  // node:sqlite 属 Node 22 实验 API（本仓 @types/node 20.x 未声明），低版本 Node 没有该内建模块。
  // 懒加载：模块级 require 会让任何 import 本文件的测试在 CI 直接套件失败。
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: any };
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA busy_timeout = 5000');
  const rows = db
    .prepare('SELECT id, mode, knowledgeState, teachingState, wrapup FROM teaching_sessions')
    .all() as unknown as SessionRow[];

  const plans: SessionBackfillPlan[] = [];
  for (const row of rows) {
    const plan = planSession(row);
    if (plan) plans.push(plan);
  }
  const knowledgeRows = plans.reduce((n, p) => n + p.knowledgePoints, 0);
  const wrapupRows = plans.reduce((n, p) => n + p.wrapupItems, 0);

  console.log(
    `[backfill-mastery-negative-evidence] 扫描 ${rows.length} 个会话；` +
      `命中 ${plans.length} 个会话 / knowledgeState ${knowledgeRows} 点 / wrapup ${wrapupRows} 项` +
      `${APPLY ? '' : '（dry-run，未写库；加 --apply 写入）'}`,
  );

  if (!APPLY || !plans.length) {
    db.close();
    return;
  }

  const update = db.prepare(
    'UPDATE teaching_sessions SET knowledgeState = COALESCE(?, knowledgeState), wrapup = COALESCE(?, wrapup) WHERE id = ?',
  );
  try {
    db.exec('BEGIN');
    for (const plan of plans) {
      update.run(plan.knowledgeState ?? null, plan.wrapup ?? null, plan.id);
    }
    db.exec('COMMIT');
    console.log(`[backfill-mastery-negative-evidence] 已写入 ${plans.length} 个会话（updatedAt 未改动）`);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main();
}
