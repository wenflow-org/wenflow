/**
 * 记忆痕迹服务（记忆引擎 M2）
 *
 * 持久化层：memory_traces 表（userId × conceptKey 唯一）承载 ACT-R 幂律衰减模型。
 * - recordExtraction：每次提取/复习/课后评估更新痕迹（extractionCount+1、lastSeenAt、masteryScore）
 * - recordSessionOutcome：endSession 后按知识看板状态确定性回写内化强度（零 LLM）
 * - getDueTraces：惰性检查到期复习点（保留率阈值 / 计划间隔）
 * - getRetentionSnapshot：读取时计算保留率快照
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { findTestAccountUserIds } from '../../utils/test-account';
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';
import { conceptRegistryService } from '../learner/concept-registry.service';
import {
  reviewIntervalDays,
  clamp01,
  DEFAULT_RETENTION_THRESHOLD,
} from './actr';
import {
  fsrsSchedule,
  fsrsStateFromLegacy,
  fsrsEmptyState,
  fsrsRetrievability,
  fsrsGradeFromOutcome,
  type FsrsGradeCode,
  type FsrsMemoryState,
} from './fsrs';

/**
 * 概念身份解析（best-effort）与「未挂靠」语义 —— memory_traces 写入侧键控契约（kcid 域，2026-10-07）
 *
 * 身份链：模型自由措辞的 conceptKey → normalizeConceptKey → aliasNorm
 *   → concept_aliases @@unique([userId, aliasNorm]) 一次索引命中 → concepts.id（canonical conceptId）。
 * 零 LLM、零 LIKE 扫描：解析是 O(1) 唯一索引点查 + 进程内 LRU（concept-registry.service），
 * 不构成大表聚合查询（Admin 性能批次的 AVG 无索引教训在此路径不存在）。
 *
 * 落库契约（本文件所有写入路径共用；设计：doc/KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md §3.4）：
 * - **解析成功 → conceptId 必填**：未命中按设计新建身份（createIfMissing=true，write_time 源），
 *   所以"成功"覆盖命中与新建两种情形；create 直接落，update 只在成功时写入——这既是
 *   「未挂靠 → 锚定」的增量补全通道，也是 alias 归并后把旧锚重指到新 canonical 的唯一通道。
 * - **解析失败 → 明确落「未挂靠」**：失败模式唯一 = 注册表故障（抛错）。此时 create 落
 *   conceptId=null，update 不触碰既有值（绝不把已锚定的行写回 null）。**该列 null 即「未挂靠」
 *   的现有列表达**（schema 注释同口径），不新增迁移、不加新列；痕迹本身照常落库（键控退回
 *   conceptKey 名字键），注册表故障不得阻断记忆写入。
 * - **读侧配套契约**：一律「conceptId 优先，空则回落 conceptKey/label」——未挂靠键按名字键的
 *   旧行为逐字兼容（宁缺勿错，不误并）。
 *
 * 语义近义（"判断对齐关系" vs "识别对齐关系"）解析不到同一身份，不在写入侧处理——留给
 * ConceptConsolidatorService 的 LLM 建议 + outlet 域 apply 路径；写入侧只做机械归一同形。
 *
 * kcId 锚定（#94 写入侧稳定键，2026-10-19）：模型自由措辞是漂移的根因，而 kcId
 * （scenario.taskKcs[].kcId，模型在 knowledge.points / ktEstimate.conceptMastery 回填）
 * 在同一路径内是稳定的 KC 局部序号。解析顺序改为**先稳定键、后文本名**：
 *   ① kcId 锚定：`kc:<pathId>:<kcId>` 已在别名表里有归属 → 直接命中，措辞怎么变都不分叉；
 *   ② 未命中（该 kcId 首次出现，或整条链路没带 kcId）→ 回落到原文本名解析，**行为与引入前
 *      逐字一致**（未命中按设计新建身份）；首次解析成功后把稳定键登记为该身份的别名，
 *      此后同名异写收敛到同一身份。
 * 纪律：锚定与登记都是 best-effort（失败只告警、不阻断写入，更不改回落语义）；
 * 没有 kcId 时**一次额外的表访问都不发生**（旧行为零开销）。
 */
/** kcId 锚键：`kc:<pathId>:<kcId>`（无 pathId 时 `kc:<kcId>`）——path 前缀不可省：kcId 是路径内局部序号 */
export function kcAnchorKey(kcId: unknown, pathId?: string | null): string {
  const id = typeof kcId === 'string' ? kcId.trim() : '';
  if (!id) return '';
  const path = typeof pathId === 'string' ? pathId.trim() : '';
  return path ? `kc:${path}:${id}` : `kc:${id}`;
}

export async function resolveConceptIdSafe(
  userId: string,
  conceptKey: string,
  pathId?: string | null,
  kcId?: string | null,
): Promise<string | null> {
  const anchorKey = kcAnchorKey(kcId, pathId);
  if (anchorKey) {
    try {
      const anchored = await conceptRegistryService.resolveConcept(userId, anchorKey, {
        createIfMissing: false,
        source: 'write_time',
      });
      if (anchored?.conceptId) return anchored.conceptId;
    } catch (error) {
      logger.warn('[memory-trace] kcId 锚定解析失败（回落文本名）', {
        userId,
        kcId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  try {
    const resolved = await conceptRegistryService.resolveConcept(userId, conceptKey, {
      source: 'write_time',
      originPathId: pathId ?? null,
    });
    const conceptId = resolved?.conceptId ?? null;
    // 首次相遇：把稳定键登记为该身份的别名（此后措辞漂移也命中同一身份）。
    // best-effort：登记失败只告警，本次写入与回落语义不受影响（下次再登记）。
    if (conceptId && anchorKey) {
      try {
        await conceptRegistryService.registerAlias({
          userId,
          conceptId,
          aliasRaw: anchorKey,
          source: 'write_time',
          confidence: 1,
        });
      } catch (error) {
        logger.warn('[memory-trace] kcId 锚键登记失败（不影响本次写入）', {
          userId,
          kcId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return conceptId;
  } catch (error) {
    logger.warn('[memory-trace] 概念身份解析失败（best-effort，conceptId 留空）', {
      userId,
      conceptKey: conceptKey.slice(0, 40),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** FSRS 统一保留率（#8 legacy 退役）：trace 有 FSRS 状态用 FSRS，否则 fsrsStateFromLegacy 推导 */
function fsrsRetentionOfTrace(
  trace: {
    fsrsStability: number | null;
    fsrsDifficulty: number | null;
    fsrsLapses: number | null;
    masteryScore: number;
    extractionCount: number;
    lastSeenAt: Date | null;
  },
  now: Date,
): number {
  if (!trace.lastSeenAt) return 1;
  const state: FsrsMemoryState = trace.fsrsStability !== null && trace.fsrsStability !== undefined
    ? {
        stability: trace.fsrsStability,
        difficulty: trace.fsrsDifficulty ?? 5,
        reps: trace.extractionCount,
        // 失误次数落库后（2026-09-17）从列里读：它是 `State.Relearning` 的唯一判据（fsrs.ts）
        lapses: trace.fsrsLapses ?? 0,
        lastReviewAt: trace.lastSeenAt,
      }
    : fsrsStateFromLegacy(trace.masteryScore, trace.extractionCount, trace.lastSeenAt);
  return fsrsRetrievability(state, now);
}

/** FSRS 间隔展示（#8 legacy 退役）：stability 天（有 FSRS 状态用 FSRS，否则 legacy 推导） */
function fsrsIntervalDaysOfTrace(
  trace: { fsrsStability: number | null; masteryScore: number; extractionCount: number; lastSeenAt: Date | null },
): number {
  if (trace.fsrsStability !== null && trace.fsrsStability !== undefined) {
    return Math.max(1, Math.round(trace.fsrsStability));
  }
  const state = fsrsStateFromLegacy(trace.masteryScore, trace.extractionCount, trace.lastSeenAt);
  return Math.max(1, Math.round(state.stability));
}

/**
 * 知识点键归一化（幂等）：conceptKey 直接取模型生成的知识点名字，模型换一种说法就多一条，
 * 导致同一概念被记成多条痕迹（实测「离开前翻页立好」被记成 5 条），复习清单因此爆炸。
 * 写入与查询都过这里，保证同一概念只占一条 trace。
 *
 * 实现已抽到 `./concept-key`（供 ConceptRegistryService 共用同口径，避免循环依赖）；
 * 此处 re-export 保持既有 import 路径不变。
 */
import { isPlaceholderConceptKey, normalizeConceptKey } from './concept-key';
export { normalizeConceptKey };

export type MemoryStability = 'unknown' | 'fragile' | 'developing' | 'stable';

const ALLOWED_STABILITY: MemoryStability[] = ['unknown', 'fragile', 'developing', 'stable'];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MemoryTraceInput {
  userId: string;
  conceptKey: string;
  label?: string | null;
  masteryScore: number;
  stability?: MemoryStability;
  source?: string;
  /** 来源路径（首次出现的路径；已有值不覆盖——originPathTitle 的语义是"最早出现"） */
  pathId?: string | null;
  /**
   * 可选稳定身份键（#94 写入侧稳定键）：模型从 scenario.taskKcs 回填的 KC 局部序号。
   * 提供时优先按 kcId 锚定概念身份，未命中/缺失回落自由文本名（见 resolveConceptIdSafe）。
   */
  kcId?: string | null;
  /** 下次到期时间（物化 dueAt；缺省按 ACT-R 间隔规则计算） */
  dueAt?: Date | null;
  /** 复习间隔因子（用于计算 dueAt；默认沿用现有 intervalFactor 语义） */
  intervalFactor?: number;
  /** FSRS 复习成绩（Again/Hard/Good/Easy）；提供时走 FSRS-6 DSR 调度，否则走 legacy ACT-R */
  fsrsGrade?: FsrsGradeCode;
}

export interface SessionKnowledgeOutcome {
  name: string;
  /** 可选稳定身份键（KC 身份）：看板项透传，写入侧据此锚定（缺失回落文本名） */
  kcId?: string | null;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  progress: number;
}

/** knowledgeState 状态 → 内化强度（确定性映射，零 LLM；与 LearnerKnowledgeMemoryService 语义对齐） */
export function mapKnowledgeStatusToMastery(
  status: SessionKnowledgeOutcome['status'],
  progress: number,
  calibrationBias: 'overconfident' | 'accurate' | 'underconfident' = 'accurate',
): { masteryScore: number; stability: MemoryStability } {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
  let score: number;
  let stability: MemoryStability;
  switch (status) {
    case 'mastered':
      score = p >= 100 ? 0.9 : 0.85;
      stability = 'stable';
      break;
    case 'review':
      score = 0.5;
      stability = 'fragile';
      break;
    case 'learning':
      score = 0.35;
      stability = 'developing';
      break;
    case 'pending':
      score = 0.2;
      stability = 'unknown';
      break;
    default:
      score = 0.3;
      stability = 'developing';
      break;
  }
  // 元认知校准闭环：overconfident → 降权（自报掌握度不可信），underconfident → 微升
  if (calibrationBias === 'overconfident') score = Math.max(0.1, score - 0.1);
  else if (calibrationBias === 'underconfident') score = Math.min(0.95, score + 0.05);
  return { masteryScore: score, stability };
}

class MemoryTraceService {
  /** 默认睡眠窗口（保守估计：23:00-07:00），dueAt 不落在该区间内 */
  private static readonly SLEEP_START_HOUR = 23;
  private static readonly SLEEP_END_HOUR = 7;
  /** 活跃窗口起始（上午 9 点），dueAt 过早时锚定到此 */
  private static readonly ACTIVE_START_HOUR = 9;

  /** 将 dueAt 锚定到活跃窗口：跳过睡眠区间（23-07），不足 1 天时保证至少跨 1 个睡眠周期 */
  private snapToActiveWindow(dueAt: Date, now: Date, isFirstExtraction: boolean): Date {
    const due = new Date(dueAt);
    const hour = due.getHours();
    // 落在睡眠窗口 → 推到次日早晨
    if (hour >= MemoryTraceService.SLEEP_START_HOUR || hour < MemoryTraceService.SLEEP_END_HOUR) {
      due.setHours(MemoryTraceService.ACTIVE_START_HOUR, 0, 0, 0);
      if (hour >= MemoryTraceService.SLEEP_START_HOUR) {
        due.setDate(due.getDate() + 1);
      }
    }
    // 首次提取：确保至少跨 1 个睡眠周期（Rasch & Born 2013, Gais 2006）
    if (isFirstExtraction) {
      const minDue = new Date(now);
      minDue.setDate(minDue.getDate() + 1);
      minDue.setHours(MemoryTraceService.ACTIVE_START_HOUR, 0, 0, 0);
      if (due < minDue) return minDue;
    }
    return due;
  }

  /** 计算下次到期时间：now + intervalDays（ACT-R Cepeda 15% × factor），加睡眠窗口锚定 */
  private computeDueAt(input: MemoryTraceInput, now: Date, isFirstExtraction = false): Date | null {
    if (input.dueAt) return input.dueAt;
    const factor = Number.isFinite(input.intervalFactor) && (input.intervalFactor as number) > 0
      ? (input.intervalFactor as number)
      : 1;
    const intervalDays = reviewIntervalDays(DEFAULT_RETENTION_TARGET_DAYS, factor);
    const rawDue = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
    return this.snapToActiveWindow(rawDue, now, isFirstExtraction);
  }

  /** 记录一次提取/评估：upsert 痕迹并累计提取次数；提供 fsrsGrade 时走 FSRS-6 DSR 调度 */
  async recordExtraction(input: MemoryTraceInput): Promise<void> {
    const conceptKey = normalizeConceptKey(input.conceptKey);
    if (!conceptKey) return;
    // #109：路径骨架 concept-N 不是概念身份——不 upsert 痕迹、不建概念。
    // 本守卫同时覆盖 recordSessionOutcome（它经由本方法落痕）；改挂/丢弃由调用方
    // （teaching-turn-engine ktEstimate 分流）负责，这里只做最后一道防线。
    if (isPlaceholderConceptKey(conceptKey)) {
      logger.warn('[memory-trace] 占位概念键被最后一道防线丢弃（不建痕/不建概念）', { site: 'upsertTrace', conceptKey });
      return;
    }
    const masteryScore = clamp01(input.masteryScore);
    const stability = ALLOWED_STABILITY.includes(input.stability as MemoryStability)
      ? (input.stability as MemoryStability)
      : 'developing';
    const now = simulatedNowOr();
    // 先读旧痕迹：既供 FSRS 调度使用，也用于判定"该概念是否已有 FSRS 排程"
    //（决定 update 能否覆盖 dueAt——见下方 preserveDueAt，18 号报告 N5）。
    const existing = await this.getTrace(input.userId, conceptKey);
    let dueAt = this.computeDueAt(input, now, false);  // legacy: 保守不判首次
    let fsrsStability: number | null = null;
    let fsrsDifficulty: number | null = null;
    let fsrsLapses: number | null = null;
    let fsrsReps: number | null = null;

    if (input.fsrsGrade !== undefined) {
      const isFirstExtraction = !existing || existing.extractionCount === 0;
      const prev: FsrsMemoryState | null = existing
        ? (existing.fsrsStability !== null && existing.fsrsStability !== undefined
          ? {
              stability: existing.fsrsStability,
              difficulty: existing.fsrsDifficulty ?? 5,
              // reps 用真列（历史行回退 extractionCount：口径不同但总比没有好，见迁移注释）
              reps: existing.fsrsReps ?? existing.extractionCount,
              lapses: existing.fsrsLapses ?? 0,
              lastReviewAt: existing.lastSeenAt,
            }
          : fsrsStateFromLegacy(existing.masteryScore, existing.extractionCount, existing.lastSeenAt))
        : fsrsEmptyState();
      const result = fsrsSchedule(prev, input.fsrsGrade, now);
      fsrsStability = result.state.stability;
      fsrsDifficulty = result.state.difficulty;
      fsrsLapses = result.state.lapses;
      fsrsReps = result.state.reps;
      const rawDue = new Date(now.getTime() + result.intervalDays * DAY_MS);
      dueAt = this.snapToActiveWindow(rawDue, now, isFirstExtraction);
    }

    // 已按 FSRS 排程过的概念，在"没有新评级"的普通课里保持其 dueAt 不变
    //（首次创建仍写 legacy dueAt，保证新概念有初始排程）。
    const preserveDueAt = input.fsrsGrade === undefined
      && existing !== null && existing !== undefined
      && existing.fsrsStability !== null && existing.fsrsStability !== undefined;

    // 概念身份（canonical）——键控契约见 resolveConceptIdSafe：
    // kcId 提供时先按稳定键锚定（措辞漂移不分叉）；未命中/缺失回落文本名解析。
    // 解析成功 → conceptId 必填（create 落 / update 覆盖为最新解析，含增量补全与归并重锚）；
    // 解析失败 → create 落 null（=「未挂靠」，现有列表达）、update 不触碰既有值（不回退为 null）。
    const conceptId = await resolveConceptIdSafe(input.userId, conceptKey, input.pathId ?? null, input.kcId ?? null);

    await prisma.memory_traces.upsert({
      where: {
        userId_conceptKey: { userId: input.userId, conceptKey },
      },
      create: {
        id: `mt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        userId: input.userId,
        conceptKey,
        // 解析失败时为 null = 「未挂靠」（现有列表达；读侧「conceptId 优先，空则回落 conceptKey」）
        conceptId,
        label: input.label ?? null,
        masteryScore,
        stability,
        lastSeenAt: now,
        extractionCount: 1,
        source: input.source ?? 'derived',
        dueAt,
        fsrsStability,
        fsrsDifficulty,
        fsrsLapses,
        fsrsReps,
        // 来源路径只在**首次创建**时写；update 不碰（originPathTitle 的语义是"最早出现"）
        pathId: input.pathId ?? null,
      },
      update: {
        label: input.label ?? undefined,
        masteryScore,
        stability,
        lastSeenAt: now,
        extractionCount: { increment: 1 },
        source: input.source ?? undefined,
        // 补齐身份：已解析出 conceptId 才覆盖（解析失败时保留原值，不回退为 null）
        ...(conceptId !== null ? { conceptId } : {}),
        // 无显式评级时**不覆盖**已有 FSRS 排程的 dueAt（18 号报告 N5）：
        // 普通课（recordSessionOutcome 不传 fsrsGrade）只更新掌握度/内化强度，
        // 不应把 FSRS 的长间隔压回 ~1 天（旧实现每节课都写 dueAt=now+1d）。
        ...(preserveDueAt ? {} : { dueAt }),
        ...(fsrsStability !== null ? { fsrsStability } : {}),
        ...(fsrsDifficulty !== null ? { fsrsDifficulty } : {}),
        ...(fsrsLapses !== null ? { fsrsLapses } : {}),
        ...(fsrsReps !== null ? { fsrsReps } : {}),
      },
    });
  }

  /**
   * endSession 后按知识看板状态确定性回写内化强度。
   *
   * 概念键控：本方法只是 recordExtraction 的**确定性映射漏斗**（状态→掌握度/内化强度），
   * conceptKey 与 label 同取看板项名，身份解析/落库/「未挂靠」语义全部由 recordExtraction
   * 的键控契约统一保证（见 resolveConceptIdSafe）——此处不重复解析。
   *
   * FSRS 通电（2026-10-07，P1-10 根因）：看板项带证据时**同时**传 `fsrsGrade`，
   * 经现有 `fsrsSchedule` 写原生四元组（fsrsStability/Difficulty/Lapses/Reps + FSRS dueAt）。
   * 此前只写掌握度 → derived 源的 4909 条痕迹仅 4 条有原生 fsrsStability，
   * 预测侧被迫用 `fsrsStateFromLegacy` 代理（R4 §3-4）。
   *
   * 宁缺勿滥：证据门与映射表见 `fsrsGradeFromOutcome`（fsrs.ts）——无状态（非法/缺失）、
   * pending、review、以及无进度（progress≤0）的项一律不传 grade，行为与旧实现逐字一致
   * （recordExtraction 的「无 grade 路径」= preserveDueAt，单测钉死）。
   *
   * B2 第二步·证据补齐（收尾批 C6，2026-10-08）：直写路径此前完全无证据痕迹
   * （FORGETTING-CURVE day7-14「55 对真实作答 vs learner_evidence 仅 19 行」的直写侧残缺，
   * 测量面只见温故不见普通课）——逐项落 `session:outcome` 证据（confidence 0.6=看板派生
   * 非独立信号，与 model-reference 同档；sessionId 由调用方透传）。落库失败只告警不阻断
   * 痕迹回写。注意这不是完全事件链化（直写仍是单一写入者，无 outbox 事件）——那一步
   * 动 FSRS 时序，风险大，仍挂下版本。
   */
  async recordSessionOutcome(
    userId: string,
    items: SessionKnowledgeOutcome[],
    source = 'derived',
    calibrationBias: 'overconfident' | 'accurate' | 'underconfident' = 'accurate',
    pathId: string | null = null,
    sessionId: string | null = null,
  ): Promise<number> {
    let count = 0;
    const at = simulatedNowOr();
    const outcomeEventId = `session-outcome:${userId}:${at.getTime()}:${Math.random().toString(36).slice(2, 8)}`;
    // 同一调用内同名概念去重（recordExtraction 靠 upsert 幂等；证据的唯一键是 (eventId, evidenceKey)）
    const evidenceRows = new Map<string, {
      id: string; eventId: string; evidenceKey: string; userId: string;
      pathId: string | null; sessionId: string | null; evidenceType: string;
      payload: string; confidence: number; occurredAt: Date;
    }>();
    for (const item of items) {
      if (!item?.name || !String(item.name).trim()) continue;
      // #109：占位键连证据行也不落（证据的 conceptKey 会被下游当作概念身份回源）。
      if (isPlaceholderConceptKey(normalizeConceptKey(item.name))) {
        logger.warn('[memory-trace] 占位概念键被丢弃（不落证据行）', { site: 'recordSessionOutcome', conceptKey: String(item.name).slice(0, 60) });
        continue;
      }
      const conceptKey = String(item.name).trim();
      const { masteryScore, stability } = mapKnowledgeStatusToMastery(item.status, item.progress, calibrationBias);
      // 证据门：有证据 → 原生 FSRS 排程；无证据 → 不传 grade（走 recordExtraction 既有无 grade 路径）
      const fsrsGrade = fsrsGradeFromOutcome(item.status, item.progress);
      await this.recordExtraction({
        userId,
        conceptKey,
        label: String(item.name).trim(),
        masteryScore,
        stability,
        source,
        pathId,
        // #94 写入侧稳定键：看板项带的 kcId 一路带到记录提取（缺失即不写键，回落文本名）
        ...(typeof item.kcId === 'string' && item.kcId.trim() ? { kcId: item.kcId.trim() } : {}),
        // 键存在性即语义：无证据时不写 fsrsGrade 键（undefined 会走 legacy 分支）
        ...(fsrsGrade !== null ? { fsrsGrade } : {}),
      });
      count += 1;
      evidenceRows.set(conceptKey, {
        id: `lev_out_${at.getTime()}_${conceptKey.slice(0, 32)}_${evidenceRows.size}`,
        eventId: outcomeEventId,
        evidenceKey: `session:outcome:${conceptKey}`,
        userId,
        pathId: pathId ?? null,
        sessionId: sessionId ?? null,
        evidenceType: 'session:outcome',
        payload: JSON.stringify({
          conceptKey,
          status: item.status,
          progress: item.progress,
          masteryScore,
          fsrsGrade: fsrsGrade ?? null,
          calibrationBias,
          source,
          // #94：稳定键随证据留痕（可回溯"这条掌握度是按哪个 KC 锚定的"）
          ...(typeof item.kcId === 'string' && item.kcId.trim() ? { kcId: item.kcId.trim() } : {}),
        }),
        confidence: 0.6,
        occurredAt: at,
      });
    }
    if (evidenceRows.size > 0) {
      try {
        // 幂等键控（2026-10-13 真机实锤）：证据 id 是确定性构造（at+conceptKey+序），同一会话
        // 结果被重处理（restart-learning 复活后续跑/重放）时部分 id 已存在。此前**一条冲突会让
        // createMany 整批失败**（8 条证据静默全丢，只留一条 warn），新概念的证据被旧冲突连坐。
        // 先剔除已存在的 id 再插，保住「已存在=跳过、新证据=落库」的语义。
        const rows = [...evidenceRows.values()];
        const existing = await prisma.learner_evidence.findMany({
          where: { id: { in: rows.map((row) => row.id) } },
          select: { id: true },
        });
        const existingIds = new Set(existing.map((row) => row.id));
        const fresh = rows.filter((row) => !existingIds.has(row.id));
        if (fresh.length > 0) {
          await prisma.learner_evidence.createMany({ data: fresh });
        }
        if (fresh.length < rows.length) {
          logger.info('[memory-trace] session:outcome 证据去重（已存在跳过）', {
            userId,
            skipped: rows.length - fresh.length,
            inserted: fresh.length,
          });
        }
      } catch (error) {
        logger.warn('[memory-trace] session:outcome 证据落库失败（不阻断痕迹回写）', {
          userId,
          rows: evidenceRows.size,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return count;
  }

  /** 惰性检查：返回当前到期的复习痕迹（保留率升序，最紧急在前） */
  async getDueTraces(
    userId: string,
    options: {
      retentionTargetDays?: number;
      retentionThreshold?: number;
      now?: Date;
      limit?: number;
    } = {},
  ): Promise<Array<{
    conceptKey: string;
    label: string | null;
    masteryScore: number;
    stability: MemoryStability;
    lastSeenAt: Date | null;
    extractionCount: number;
    retention: number;
    intervalDays: number;
    reason: 'below-threshold' | 'interval-elapsed' | 'never-seen' | 'not-due';
    pathId: string | null;
  }>> {
    const now = options.now ?? simulatedNowOr();
    const retentionTargetDays = Number.isFinite(options.retentionTargetDays)
      ? (options.retentionTargetDays as number)
      : DEFAULT_RETENTION_TARGET_DAYS;
    const threshold = Number.isFinite(options.retentionThreshold)
      ? clamp01(options.retentionThreshold!)
      : DEFAULT_RETENTION_THRESHOLD;
    const limit = Number.isInteger(options.limit) && (options.limit as number) > 0 ? options.limit : 20;

    // 断链修复 P0-6：优先 SQL 直查 dueAt <= now（物化到期），解决全表扫；
    // 老数据（dueAt 为 null）在下方按 FSRS 保留率跌破阈值惰性判定，而非 SQL 物化到期。
    const [materialized, legacy] = await Promise.all([
      prisma.memory_traces.findMany({
        // KT 幽灵痕（source=kt-estimate、extractionCount=0）即使已 seed dueAt，
        // 也从未被真正提取过，不得进入复习队列（否则学习者会看到「没学过却该复习」）。
        where: { userId, dueAt: { lte: now }, extractionCount: { gt: 0 } },
        orderBy: { dueAt: 'asc' },
      }),
      prisma.memory_traces.findMany({
        // 同一道防线覆盖惰性判定分支：从未提取的 KT 幽灵痕不参与到期复习。
        where: { userId, dueAt: null, extractionCount: { gt: 0 } },
        orderBy: { lastSeenAt: 'desc' },
      }),
    ]);

    const due = [
      ...materialized.map((trace) => ({
        conceptKey: trace.conceptKey,
        label: trace.label,
        masteryScore: trace.masteryScore,
        stability: trace.stability as MemoryStability,
        lastSeenAt: trace.lastSeenAt,
        extractionCount: trace.extractionCount,
        retention: fsrsRetentionOfTrace(trace, now),
        intervalDays: fsrsIntervalDaysOfTrace(trace),
        reason: 'interval-elapsed' as const,
        pathId: trace.pathId ?? null,
      })),
      ...legacy
        .map((trace) => {
          const retention = fsrsRetentionOfTrace(trace, now);
          if (!trace.lastSeenAt) return null; // never-seen：从未提取不判到期
          if (retention >= threshold) return null; // 保留率未跌破阈值
          return {
            conceptKey: trace.conceptKey,
            label: trace.label,
            masteryScore: trace.masteryScore,
            stability: trace.stability as MemoryStability,
            lastSeenAt: trace.lastSeenAt,
            extractionCount: trace.extractionCount,
            retention,
            intervalDays: fsrsIntervalDaysOfTrace(trace),
            reason: 'below-threshold' as const,
            pathId: trace.pathId ?? null,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    ]
      .sort((a, b) => a.retention - b.retention)
      .slice(0, limit);

    return due;
  }

  /** 保留率快照（读取时计算，不落库） */
  async getRetentionSnapshot(
    userId: string,
    now: Date = simulatedNowOr(),
  ): Promise<Array<{
    conceptKey: string;
    label: string | null;
    masteryScore: number;
    stability: MemoryStability;
    lastSeenAt: Date | null;
    extractionCount: number;
    retention: number;
  }>> {
    const traces = await prisma.memory_traces.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
    });
    return traces.map((trace) => ({
      conceptKey: trace.conceptKey,
      label: trace.label,
      masteryScore: trace.masteryScore,
      stability: trace.stability as MemoryStability,
      lastSeenAt: trace.lastSeenAt,
      extractionCount: trace.extractionCount,
      retention: fsrsRetentionOfTrace(trace, now),
    }));
  }

  async getTrace(userId: string, conceptKey: string) {
    const key = normalizeConceptKey(conceptKey);
    if (!key) return null;
    return prisma.memory_traces.findUnique({
      where: { userId_conceptKey: { userId, conceptKey: key } },
    });
  }

  /**
   * θ−d 知识状态 EMA：将 teaching-turn 的 ktEstimate.conceptMastery 以 α=0.2 滑动平均
   * 累积进 memory_traces.ktMasteryEma（跨会话知识状态的确定性通道，替代每轮 LLM 独立估计）。
   * 只更新 ktMasteryEma，不触碰 extractionCount/lastSeenAt/FSRS 状态（不干扰复习调度）。
   *
   * 概念键控：同样走 resolveConceptIdSafe 的键控契约——解析成功 → update 补齐 conceptId /
   * create 直接落；解析失败 → 「未挂靠」（create 落 null、update 不触碰既有值）。
   * #94：item.kcId（模型回填的稳定键）优先锚定，未命中回落 conceptKey 文本名。
   */
  async applyKtEstimate(
    userId: string,
    items: Array<{ conceptKey: string; kcId?: string | null; mastery: number; evidence?: string | null }>,
    pathId: string | null = null,
  ): Promise<void> {
    if (!items || items.length === 0) return;
    const ALPHA = 0.2;
    const now = simulatedNowOr();
    for (const item of items) {
      const key = normalizeConceptKey(item.conceptKey);
      if (!key) continue;
      // #109：占位键既不建痕也不建概念（模型把路径骨架序号回填进 ktEstimate 的历史缺口）。
      if (isPlaceholderConceptKey(key)) {
        logger.warn('[memory-trace] 占位概念键被丢弃（ktEstimate 不建痕/不建概念）', { site: 'applyKtEstimate', conceptKey: key });
        continue;
      }
      const mastery = Number.isFinite(item.mastery) ? Math.max(0, Math.min(1, item.mastery)) : null;
      if (mastery === null) continue;
      // #133（2026-10-22）：模型自报证据窗随 EMA 落库（此前在 engine 已被丢弃，检查器
      // 只能拿二手转述核对）。与 ktMasteryEma 同口径=只留最新一次估计的证据，不累积历史。
      const evidence = typeof item.evidence === 'string' && item.evidence.trim()
        ? item.evidence.trim().slice(0, 200)
        : null;
      const conceptId = await resolveConceptIdSafe(userId, key, pathId, item.kcId ?? null);
      const existing = await this.getTrace(userId, key);
      if (existing) {
        const prev = existing.ktMasteryEma ?? existing.masteryScore;
        const ema = Number.isFinite(prev) ? ALPHA * mastery + (1 - ALPHA) * (prev as number) : mastery;
        // KT 幽灵痕（extractionCount=0 且从未排程）补一次初始 FSRS 状态：
        // 此前这类行 fsrsStability/dueAt 均为 null，既不在任何排程里、首次真实提取时
        // 也只能回退 fsrsStateFromLegacy 代理。只补空值——已排程的痕迹一律不动，
        // 不覆盖真实复习算出的间隔。
        const isUnscheduledGhost = (Number(existing.extractionCount) || 0) === 0
          && (existing.fsrsStability === null || existing.fsrsStability === undefined);
        const ghostSeed = isUnscheduledGhost ? this.seedKtInitialSchedule(mastery, now) : null;
        await prisma.memory_traces.updateMany({
          where: { userId, conceptKey: key },
          data: {
            ktMasteryEma: ema,
            ...(conceptId !== null ? { conceptId } : {}),
            ktEvidence: evidence,
            ...(ghostSeed ?? {}),
          },
        });
      } else {
        // 无痕迹也记录 EMA（独立于 ACT-R/FSRS 调度的知识状态通道）。
        // #59/#60 第 3 条：masteryScore 不再硬编码 0.3（会把「没学过」冒充成「学过一半」，
        // 并被 fragile 判定当成低分证据）——落 KT 估计值本身；extractionCount=0 仍如实标着
        // 「从未提取」，读侧据此把他当幽灵痕排除在掌握聚合外。
        // 2026-10-21：幽灵痕同样写入初始 FSRS 状态与 dueAt（估算即排程基线），
        // 但 extractionCount 保持 0——复习队列仍只收「真正提取过」的点。
        const initialSchedule = this.seedKtInitialSchedule(mastery, now);
        await prisma.memory_traces.create({
          data: {
            id: `mt_${now.getTime()}_${Math.random().toString(36).slice(2, 10)}`,
            userId,
            conceptKey: key,
            conceptId,
            masteryScore: mastery,
            stability: 'unknown',
            ktMasteryEma: mastery,
            ktEvidence: evidence,
            extractionCount: 0,
            source: 'kt-estimate',
            pathId,
            ...initialSchedule,
          },
        });
      }
    }
  }

  /**
   * 为 KT 估算痕迹生成初始 FSRS 排程（纯确定性，无 LLM）：
   * stability = mastery × 10 天（下限 1 天，fsrsStateFromLegacy 口径），difficulty 中性 5，
   * reps/lapses 从 0 起；dueAt 走与 recordExtraction 相同的活跃窗口锚定。
   */
  private seedKtInitialSchedule(mastery: number, now: Date): {
    fsrsStability: number; fsrsDifficulty: number; fsrsLapses: number; fsrsReps: number; dueAt: Date;
  } {
    const initial = fsrsStateFromLegacy(mastery, 0, now);
    const rawDue = new Date(now.getTime() + initial.stability * DAY_MS);
    return {
      fsrsStability: initial.stability,
      fsrsDifficulty: initial.difficulty,
      fsrsLapses: initial.lapses,
      fsrsReps: initial.reps,
      dueAt: this.snapToActiveWindow(rawDue, now, false),
    };
  }

  // 注：复习结果的 FSRS 写入自 2026-09-17 起是**单一写入者** = `ReviewCompletedConsumer`
  // （含误解干扰 ×0.85）。此前的 `bumpReviewInterval` 已删除：它与 `recordExtraction(fsrsGrade)`
  // 在同一条收束路径上把同一成绩应用两次，再叠加事件消费者 → 间隔被过度拉长、计数重复自增。
}

/** 管理端「记忆痕迹」列表查询参数（memory-traces 路由下沉） */
export interface AdminMemoryTraceListQuery {
  userId?: string;
  includeVirtual: boolean;
  /** 测试视角：只看虚拟学习者 + 测试/审计账号（优先于 includeVirtual 的排除逻辑） */
  testOnly?: boolean;
  limit: number;
}

/**
 * 管理端「记忆痕迹」列表：默认排除虚拟学习者。
 *
 * memory_traces.userId 是纯字符串列、无 user 关系，不能写 where: { user: {...} }（Prisma 直接抛错 → 500）。
 * 默认排除虚拟学习者：先取虚拟 id 集合，再用 userId.notIn；与指定 userId 用 AND 组合（避免键覆盖）。
 */
export async function listAdminMemoryTraces(query: AdminMemoryTraceListQuery) {
  /* 测试视角（2026-10-10 用户拍板「真实/测试」互斥视角）：testOnly=true 时只看
     虚拟学习者 + 测试/审计账号的痕迹（正向 in，判据同源 findTestAccountUserIds） */
  let testOnlyIds: string[] | null = null;
  if (query.testOnly) {
    testOnlyIds = await findTestAccountUserIds();
  }
  const virtualIds = query.includeVirtual
    ? []
    : (await prisma.users.findMany({
        where: { isVirtualLearner: true },
        select: { id: true },
      })).map((u) => u.id);

  return prisma.memory_traces.findMany({
    where: {
      AND: [
        ...(query.userId ? [{ userId: query.userId }] : []),
        ...(testOnlyIds
          ? [testOnlyIds.length ? { userId: { in: testOnlyIds } } : { userId: { in: ['__none__'] } }]
          : virtualIds.length
            ? [{ userId: { notIn: virtualIds } }]
            : []),
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: query.limit,
    select: {
      id: true,
      userId: true,
      conceptKey: true,
      label: true,
      masteryScore: true,
      stability: true,
      extractionCount: true,
      lastSeenAt: true,
      fsrsStability: true,
      fsrsDifficulty: true,
      fsrsLapses: true,
      fsrsReps: true,
      ktMasteryEma: true,
      dueAt: true,
      updatedAt: true,
    },
  });
}

/** 默认复习目标保留时间（天）：路径跨度的保守估计，调用方可按路径时长覆盖 */
export const DEFAULT_RETENTION_TARGET_DAYS = 7;

export const memoryTraceService = new MemoryTraceService();
