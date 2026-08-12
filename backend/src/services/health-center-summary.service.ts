/**
 * 巡检聚合服务（G1 一页式巡检工作台后端，ADMIN_RECONSTRUCTION_MASTERPLAN 阶段 2）
 *
 * GET /api/admin/health-center/summary —— 一次请求返回巡检需要的全部数据：
 * - health：健康检查 13 项全量（含 base/semantics 语义，与 /health-center 同一实现）
 * - drift：漂移分维度计数（契约漂移 / W4 哈希漂移 / 运行时漂移）
 * - reconciliation：对账摘要（W1-W5 简版：缺注册/幽灵注册/缺 ACTIVE/幽灵 ACTIVE/接线差集）
 * - completion：各 skill 完成度五档分布计数（明细仍走 /skills/reconciliation）
 * - global：skill 总数 / aux 数 / mainline 数 / 异常 skill 数（任一完成度检查不过）
 *
 * 复用：collectHealthCenterScan + assembleHealthCenterItems（与 /health-center 同一单次扫描），
 * 完成度分布复用 getSkillCompletion（同一完成度状态机），全部沿用既有纯函数，禁止复制逻辑。
 */

import {
  collectHealthCenterScan,
  assembleHealthCenterItems,
  type HealthCenterDbAdapter,
  type HealthCenterItem,
  type HealthCenterSummary,
} from './health-center.service';
import {
  getSkillCompletion,
  type CompletionState,
} from './skill-registry/skill-completion.service';
import { loadCoreFile } from './prompt-lab/core-file-loader';
import { listRawManifestEntries } from './agent-manifest.service';
import type { SkillsBook } from './skill-registry/skills-file';

// ============================================================
// 类型（响应契约：分组清晰、计数字段稳定，前端一页式工作台直接可用）
// ============================================================

/** 漂移摘要：三种漂移语义各自独立计数（术语统一，ADMIN_IA_AUDIT §3.2） */
export interface HealthDriftSummary {
  /** 契约漂移（编排契约声明 vs DB，health item field-routing-contract） */
  contract: number;
  /** W4 哈希漂移（core → 产物 → DB 哈希，health item w4-corehash） */
  hash: number;
  /** 运行时漂移（遥测 promptDrift 观测，health item runtime-prompt） */
  runtime: number;
}

/** 对账摘要：W1-W5 简版计数（与 skills-readiness 同一报告派生） */
export interface HealthReconciliationSummary {
  /** 户口簿活跃 skill 总数（对账对象） */
  total: number;
  /** W2 缺注册：户口簿登记但 skill_registrations 无行 */
  missingRegistration: number;
  /** W2 幽灵注册：注册表行不在户口簿活跃集 */
  zombieRegistration: number;
  /** W1 缺 ACTIVE：户口簿登记（有 prompt 文件）但无 ACTIVE prompt */
  missingActive: number;
  /** W1 幽灵 ACTIVE：agent_prompts ACTIVE 的 skill 不在户口簿活跃集 */
  zombieActive: number;
  /** W1 僵尸技能 ACTIVE 残留（保留注册零调用） */
  zombieSkillActive: number;
  /** W3 接线差集：steps 引用缺户口簿登记 + 户口簿登记缺 steps 引用 */
  unwired: number;
}

/** 完成度摘要：五档分布计数（明细仍走 /skills/reconciliation） */
export interface HealthCompletionSummary {
  distribution: Record<CompletionState, number>;
  /** 已达 live 档的 skill 数 */
  live: number;
}

/**
 * 参与"异常 skill"判定的完成度检查项（全部为会被实际评估的检查）：
 * wired / recentCalls 为仅展示项（未注入 wiredCheck 时恒 false，不参与异常判定）；
 * checksGreen 仅在注入结果时评估（聚合场景未注入 → null，不参与）。
 */
export const ABNORMAL_CHECK_ITEM_IDS: readonly string[] = [
  'manifest',
  'handler',
  'registered',
  'core',
  'fieldsSynced',
  'promptActive',
  'checksGreen',
];

/** 全局统计 */
export interface HealthGlobalSummary {
  /** skill 总数（户口簿活跃集） */
  total: number;
  aux: number;
  mainline: number;
  handlerOnly: number;
  /** 异常 skill 数：任一已评估的完成度检查项不过（ABNORMAL_CHECK_ITEM_IDS 中任一 ok=false） */
  abnormalSkills: number;
}

export interface HealthCenterSummaryReport {
  generatedAt: string;
  health: {
    summary: HealthCenterSummary;
    items: HealthCenterItem[];
    /** 异常检查项数（severity=error/warn，不含 info 观测项） */
    abnormal: number;
  };
  drift: HealthDriftSummary;
  reconciliation: HealthReconciliationSummary;
  completion: HealthCompletionSummary;
  global: HealthGlobalSummary;
}

// ============================================================
// 聚合
// ============================================================

export async function buildHealthCenterSummaryReport(
  db: HealthCenterDbAdapter,
  options?: { book?: SkillsBook },
): Promise<HealthCenterSummaryReport> {
  // 与 /health-center 共用单次扫描（一次 fs 扫描 + 一次 DB 查询 + 一轮纯函数分析）
  const data = await collectHealthCenterScan(db, options);
  const items = assembleHealthCenterItems(data);
  const byItemId = new Map(items.map((item) => [item.id, item]));

  const healthSummary: HealthCenterSummary = {
    total: items.length,
    baselineDrift: items.filter((item) => item.semantics === 'baseline-drift').length,
    consistency: items.filter((item) => item.semantics === 'consistency').length,
    overrideRecord: items.filter((item) => item.semantics === 'override-record').length,
    fixable: items.filter((item) => item.action === 'fixable' && item.severity !== 'ok').length,
  };

  // 漂移分维度计数：直接取自同一批健康清单项（同一检测口径，不重复检测）
  const drift: HealthDriftSummary = {
    contract: byItemId.get('field-routing-contract')?.count ?? 0,
    hash: byItemId.get('w4-corehash')?.count ?? 0,
    runtime: byItemId.get('runtime-prompt')?.count ?? 0,
  };

  // 对账摘要：skills-readiness 同报告的结构化计数（W1/W2/W3）
  const w1 = data.readiness.checks.W1;
  const w2 = data.readiness.checks.W2;
  const w3 = data.readiness.checks.W3;
  const reconciliation: HealthReconciliationSummary = {
    total: data.book.skills.length,
    missingRegistration: w2.missingRegistration.length,
    zombieRegistration: w2.zombieRegistration.length,
    missingActive: w1.missingActive.length,
    zombieActive: w1.zombieActive.length,
    zombieSkillActive: w1.zombieSkillActive.length,
    unwired: w3.stepWithoutBook.length + w3.bookWithoutStep.length,
  };

  // 完成度分布：单遍户口簿，共享扫描中间产物（activeRows / orchestrationStages / manifest）
  const activePromptIds = new Set(data.activeRows.map((row) => row.agentId));
  const manifestSkillIds = new Set(
    listRawManifestEntries()
      .filter((item) => item.kind === 'skill' && item.id.startsWith('skill:'))
      .map((item) => item.id.slice('skill:'.length)),
  );

  const distribution: Record<CompletionState, number> = {
    draft: 0,
    'handler-ready': 0,
    'core-ready': 0,
    'fields-synced': 0,
    live: 0,
  };
  let aux = 0;
  let mainline = 0;
  let handlerOnly = 0;
  let abnormalSkills = 0;

  for (const entry of data.book.skills) {
    const completion = await getSkillCompletion(entry.skillId, {
      book: data.book,
      orchestrationStages: data.orchestrationStages,
      activePromptIds,
      inManifest: (skillId) => manifestSkillIds.has(skillId),
    });
    distribution[completion.status] = (distribution[completion.status] || 0) + 1;

    if (entry.kind === 'aux') aux += 1;
    else if (entry.kind === 'mainline') mainline += 1;
    else if (entry.kind === 'handler-only') handlerOnly += 1;

    // 异常 skill：任一已评估的完成度检查项不过（wired/checksGreen 等仅展示项不参与）
    if (
      completion.items.some(
        (item) => ABNORMAL_CHECK_ITEM_IDS.includes(item.id) && item.ok === false,
      )
    ) {
      abnormalSkills += 1;
    }
  }

  const global: HealthGlobalSummary = {
    total: data.book.skills.length,
    aux,
    mainline,
    handlerOnly,
    abnormalSkills,
  };

  return {
    generatedAt: new Date().toISOString(),
    health: {
      summary: healthSummary,
      items,
      abnormal: items.filter((item) => item.severity === 'error' || item.severity === 'warn').length,
    },
    drift,
    reconciliation,
    completion: { distribution, live: distribution.live },
    global,
  };
}

// ============================================================
// 60s 内存缓存（与 /health-center 同策略；?refresh=1 强制重算）
// ============================================================

const CACHE_TTL_MS = 60_000;
let lastComputedAt = 0;
let cachedReport: HealthCenterSummaryReport | null = null;

export async function getHealthCenterSummaryReport(
  db: HealthCenterDbAdapter,
  options?: { skipCache?: boolean },
): Promise<HealthCenterSummaryReport> {
  const now = Date.now();
  if (!options?.skipCache && cachedReport && now - lastComputedAt < CACHE_TTL_MS) {
    return cachedReport;
  }
  const report = await buildHealthCenterSummaryReport(db);
  cachedReport = report;
  lastComputedAt = now;
  return report;
}

/** 清缓存（测试用） */
export function resetHealthCenterSummaryCache(): void {
  cachedReport = null;
  lastComputedAt = 0;
}
