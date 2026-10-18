/**
 * 学习者与会话生命周期：画像归一 / 卡死与暂停口径 helper + 学习者 CRUD、统计、设置、会话详情与投影 token
 *
 * 由 routes/admin/virtual-learners.ts 于 2026-10-19（issue #76）按声明簇纯搬移拆出（L113–L137、L149–L186、L1391–L2209）。
 * 契约不变：路由路径、注册顺序、中间件与处理器代码逐字未改；本文件只导出注册函数，
 * 由 virtual-learners.ts 在**同一个** router 实例上按原顺序调用（Express 顺序匹配语义与拆分前一致）。
 * 为保持逐行可 diff，搬移文本未重新缩进：register 函数体内的路由仍沿用原文件缩进（column 0）。
 */

import { type Router, type Request } from 'express';
import type { goal_conversations } from '../../services/prisma-client-types';
import { randomUUID as uuidv4 } from 'crypto';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { findProfileById, findProfileDetail, findProfileForProjectionToken, updateProfileFields, updateUserName, createVirtualLearnerUser, createVirtualLearnerProfile, listProfilesWithSessionSamples, countProfiles } from '../../services/virtual-lab/virtual-learner-profile.repo';
import { findSessionWithProfileAndUser, findGoalConversationById, getSessionStatusAggregates, getPerProfileStatusAggregates, findStaleSessionsByProfiles, findStaleSessionCandidates, findStaleSessionsForStats, findRunningSessionsByProfiles, findRunningSessionsForStats, findTerminalSessions, countTodayVirtualAgentCalls } from '../../services/virtual-lab/virtual-session.repo';
import { hydrateSessionLogsField as hydrateVirtualSessionLogsField } from '../../services/virtual-lab/virtual-session-log-store';
import { logger } from '../../utils/logger';
import { teachingSessionRepository } from '../../services/ai-teaching/TeachingSessionRepository';
import { findTeachingSessionsByPathId } from '../../services/admin/session-console.repo';
import { teachingSessionHistoryOf } from './session-console';
import { signProjectionToken } from '../../utils/projection-token';
import { autopilotService } from '../../virtual-lab/autopilot.service';
import { virtualSessionReclaimService } from '../../virtual-lab/session-reclaim.service';
import { simulatedDayService } from '../../services/virtual-lab/simulated-day.service';
import { resolveSessionBudget } from '../../virtual-lab/session-budget';
import { getVirtualLabSettings, updateVirtualLabSettings } from '../../services/virtual-lab-settings.service';
import { applyRpmLimitsFromSettings, getRpmLimitStats } from '../../services/rpm-limit-config.service';
import { virtualCleanupService } from '../../services/virtual-lab/virtual-cleanup.service';
import { ensureCardKey } from '../../services/virtual-lab/card-import.service';
import { safeJsonParse } from '../../utils/safe-json';
import type { SimulationLogEntry } from '../../coordinators/simulation.types';
import type { StageResults, VirtualSessionRow } from '../../virtual-lab/vlab-types';
import { parseJson, ensureProfileStoryPool, createSessionForProfile, SIMULATION_FRICTION_BUDGETS } from '../../virtual-lab/session-factory';
import {
  parseStoryContext,
  buildSessionConversations,
  buildSessionBindings,
  buildSessionRuntime,
  buildSessionSummary,
} from './virtual-learners.projections';

// ===== 原 virtual-learners.ts L113–L137 =====
/**
 * 负荷画像字段层级归一（I-13，2026-09-23）：
 * 下游（simulation.path-phase / 负荷收紧）只读 profile **顶层**的 availableTime / cognitiveLoadTolerance。
 * 创建 VL 时人设常塞进 personaSeed（presets.yaml 书写形状） ⇒ 后者静默失效。
 * 本函数：两处都查，顶层优先；顶层缺失时从 personaSeed 提升，避免"配了低耐受但从未收紧"。
 * 调用方对 `POST /` 创建时的 profile 调用即可，不影响已存储的数据（读侧见 resolveLearnerLoadProfile）。
 */
function normalizeVirtualLearnerProfileShape(profile: unknown): Record<string, unknown> {
  const data = profile && typeof profile === 'object' ? { ...(profile as Record<string, unknown>) } : {};
  const nested = (data.personaSeed && typeof data.personaSeed === 'object'
    ? data.personaSeed
    : {}) as Record<string, unknown>;

  const TOLERANCE_KEYS = ['availableTime', 'cognitiveLoadTolerance'] as const;
  for (const key of TOLERANCE_KEYS) {
    if (typeof data[key] !== 'string' || !data[key]) {
      const fallback = typeof nested[key] === 'string' ? nested[key] : null;
      if (fallback) {
        data[key] = fallback;
        logger.info('[vl-create] I-13 归一：将 personaSeed 中的负荷字段提升到 profile 顶层', { field: key });
      }
    }
  }
  return data;
}

// ===== 原 virtual-learners.ts L149–L186 =====
/** 卡死判定阈值（与 reclaim 服务同源：VLAB_STALE_SESSION_HOURS，默认 24h），保证「状态条卡死数 = 可回收清单数」 */
function staleThresholdAt(): Date {
  return new Date(Date.now() - virtualSessionReclaimService.getThresholdMs());
}

/**
 * 管理员暂停的会话（teaching.paused=true）无写入是预期行为：
 * reclaim 服务会跳过（skippedPaused），此处统计口径同源排除，
 * 避免「卡死 N」徽章与回收 dryRun 清单不一致、暂停会话被误标卡死。
 */
function isTeachingPausedSession(stageResults: string | null | undefined): boolean {
  try {
    const parsed = safeJsonParse<{ teaching?: { paused?: boolean } }>(String(stageResults || ''), {});
    return parsed?.teaching?.paused === true;
  } catch {
    return false;
  }
}

/**
 * 自动驾驶已停止（用户暂停）的会话。运行中口径的分界：这类会话不再算「进行中」、
 * 归入「已暂停」——列表逐画像与 /stats 全局必须同口径（F20 第二处，否则同名 running 两处不同值）。
 */
function isAutopilotStoppedSession(stageResults: string | null | undefined): boolean {
  try {
    const parsed = safeJsonParse<{ autopilot?: { status?: string } }>(String(stageResults || ''), {});
    return parsed?.autopilot?.status === 'stopped';
  } catch {
    return false;
  }
}

/** 重试预算数值钳制：非法输入回退默认值，整数化并限制在 [min, max]（与前端输入框 min/max 一致） */
function clampBudgetValue(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

export function registerSessionLifecycleRoutes(router: Router): void {
// ===== 原 virtual-learners.ts L1391–L2209 =====
/**
 * 创建虚拟用户
 * POST /api/admin/virtual-learners
 */
router.post('/', async (req: Request, res) => {
  try {
    const {
      name,
      profile,
      learningGoal,
      knowledgeLevel,
      knownConcepts,
      struggleConcepts,
      simulationPrompt,
      simulationModel,
      simulationTemperature,
      personalityTraits,
      tags,
      notes
    } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: '名称不能为空'
      });
    }

    const normalizedLearningGoal = typeof learningGoal === 'string' ? learningGoal.trim() : '';
    const normalizedKnowledgeLevel = typeof knowledgeLevel === 'string' && knowledgeLevel.trim()
      ? knowledgeLevel.trim()
      : 'beginner';

    // 负荷画像字段层级归一（2026-09-23，I-13）：下游（simulation.path-phase / 负荷收紧）读 profile **顶层**
    // 的 availableTime / cognitiveLoadTolerance，但调用方常把整套人设塞进 personaSeed（presets.yaml 书写形状）
    // ⇒ 收紧静默失效。此处把 personaSeed 里的这两个字段抬到顶层（顶层已有则不覆盖），
    // 使两种写法都生效，避免"看起来配了低耐受、实际从未收紧"。
    const normalizedProfile = normalizeVirtualLearnerProfileShape(profile);
    const profileId = uuidv4();
    // 自建卡也要带 cardKey：没有 key 的卡会被「导出卡库」静默跳过（见 ensureCardKey 注释）。
    // 先定 id 再算 key，保证 key 与档案同生，且同一学习者恒得同一个 key。
    const profileWithCardKey = ensureCardKey(normalizedProfile, profileId, Array.isArray(tags) ? (tags as string[]) : []);

    const email = `virtual_${uuidv4().substring(0, 8)}@test.local`;
    // 虚拟学习者仅供系统编排使用，不提供可共享的登录凭据。
    const hashedPassword = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
    
    const user = await createVirtualLearnerUser({
      data: {
        id: uuidv4(),
        email,
        name,
        password: hashedPassword,
        role: 'user',
        currentLevel: normalizedKnowledgeLevel || 'beginner',
        isAdmin: false,
        // 合成数据标记：生产统计（overview/stats 等）据此排除虚拟学习者
        isVirtualLearner: true,
        updatedAt: new Date()
      }
    });
    
    // student_baselines 已退役（2026-08 M1 认知负荷改造），虚拟学习者不再初始化 EMA 基线
    
    const virtualProfile = await createVirtualLearnerProfile({
      data: {
        id: profileId,
        userId: user.id,
        profile: JSON.stringify(profileWithCardKey),
        learningGoal: normalizedLearningGoal,
        knowledgeLevel: normalizedKnowledgeLevel,
        knownConcepts: knownConcepts ? JSON.stringify(knownConcepts) : null,
        struggleConcepts: struggleConcepts ? JSON.stringify(struggleConcepts) : null,
        simulationPrompt,
        simulationModel,
        simulationTemperature: simulationTemperature || 0.8,
        personalityTraits: personalityTraits ? JSON.stringify(personalityTraits) : null,
        tags: tags ? JSON.stringify(tags) : null,
        notes
      }
    });
    
    logger.info('创建虚拟用户成功', {
      userId: user.id,
      email,
      name,
      createdBy: req.user?.userId
    });
    
    res.json({
      success: true,
      data: {
        ...virtualProfile,
        email,
        profile: JSON.parse(virtualProfile.profile),
        knownConcepts: virtualProfile.knownConcepts ? JSON.parse(virtualProfile.knownConcepts) : [],
        struggleConcepts: virtualProfile.struggleConcepts ? JSON.parse(virtualProfile.struggleConcepts) : [],
        personalityTraits: virtualProfile.personalityTraits ? JSON.parse(virtualProfile.personalityTraits) : {},
        tags: virtualProfile.tags ? JSON.parse(virtualProfile.tags) : []
      }
    });
  } catch (error) {
    logger.error('创建虚拟用户失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '创建虚拟用户失败'
    });
  }
});

/**
 * 获取虚拟用户列表
 * GET /api/admin/virtual-learners
 */
router.get('/', async (req: Request, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;
    
    const [profiles, total] = await Promise.all([
      listProfilesWithSessionSamples(skip, limit),
      countProfiles()
    ]);

    // 全量口径聚合（P1-1/D3）：运行中/失败/卡死分区与状态条不再基于 50 条会话样本
    const profileIds = profiles.map(p => p.id);
    const [statusAgg, perProfileAgg, staleSessions, staleCandidates, runningSessionsAll] = await Promise.all([
      getSessionStatusAggregates(),
      profileIds.length
        ? getPerProfileStatusAggregates(profileIds)
        : Promise.resolve([]),
      profileIds.length
        ? findStaleSessionsByProfiles(profileIds, staleThresholdAt())
        : Promise.resolve([]),
      findStaleSessionCandidates(staleThresholdAt()),
      // 运行中口径细分：会话 status=running 但 autopilot=stopped（用户暂停自动驾驶）不算「正在运行」
      profileIds.length
        ? findRunningSessionsByProfiles(profileIds)
        : Promise.resolve([]),
    ]);
    const countByStatus = (status: string) => statusAgg.find(s => s.status === status)?._count?._all ?? 0;
    const runningByProfile = new Map<string, number>();
    const failedByProfile = new Map<string, number>();
    // F20 口径对齐 /stats（2026-10-15）：系统失败与人为终止分桶输出（failedCount/abandonedCount），
    // 不再合并——合并口径下「1 次系统失败 + 10 次人为终止」与「11 次系统失败」读数相同，
    // 运营信号（人设被反复手动停）与工程信号（系统在坏）无法区分。
    const abandonedByProfile = new Map<string, number>();
    for (const agg of perProfileAgg) {
      const n = agg._count?._all ?? 0;
      if (agg.status === 'running') {
        runningByProfile.set(agg.virtualProfileId, n);
      } else if (agg.status === 'failed') {
        failedByProfile.set(agg.virtualProfileId, n);
      } else if (agg.status === 'abandoned') {
        abandonedByProfile.set(agg.virtualProfileId, n);
      }
    }
    // 运行中扣减：autopilot=stopped（用户暂停自动驾驶）的会话归入「已暂停」，不再算运行中
    const pausedByProfile = new Map<string, number>();
    const isAutopilotStopped = isAutopilotStoppedSession;
    for (const s of runningSessionsAll) {
      if (!isAutopilotStopped(s.stageResults)) continue;
      runningByProfile.set(s.virtualProfileId, Math.max(0, (runningByProfile.get(s.virtualProfileId) ?? 0) - 1));
      pausedByProfile.set(s.virtualProfileId, (pausedByProfile.get(s.virtualProfileId) ?? 0) + 1);
    }
    // 卡死口径与 reclaim 服务同源：管理员暂停的会话（teaching.paused）无写入是预期行为，
    // 不算卡死（否则「卡死 N」与回收 dryRun 清单不一致，且暂停会话会被误标）
    const staleByProfile = new Map<string, number>();
    for (const s of staleSessions) {
      if (isTeachingPausedSession(s.stageResults)) continue;
      staleByProfile.set(s.virtualProfileId, (staleByProfile.get(s.virtualProfileId) ?? 0) + 1);
    }
    const staleTotal = staleCandidates.filter((s) => !isTeachingPausedSession(s.stageResults)).length;
    
    const formattedProfiles = profiles.map(p => {
      const profileData = JSON.parse(p.profile || '{}');
      const storyPool = Array.isArray(profileData?.storyPool) ? profileData.storyPool : [];
      // 运行中信号：列表一屏回答「谁在跑、跑到哪个阶段」（阶段仍取会话样本，计数已全量聚合）
      const sessionSample = Array.isArray(p.sessions) ? p.sessions : [];
      const autopilotStoppedIds = new Set(
        sessionSample
          .filter((s) => {
            try {
              return JSON.parse(String(s.stageResults || '{}'))?.autopilot?.status === 'stopped';
            } catch {
              return false;
            }
          })
          .map((s) => s.id)
      );
      const runningSessions = sessionSample.filter((s) => s.status === 'running' && !autopilotStoppedIds.has(s.id));
      const pausedSessions = sessionSample.filter((s) => s.status === 'running' && autopilotStoppedIds.has(s.id));
      // 阶段进度（轴 B）：从最新会话的 stageResults 推导 Goal/Path/Learn 三态 + 任务进度
      const latestSession = sessionSample[0];
      let stageProgress: { goalReady: boolean; pathReady: boolean; learnStarted: boolean; taskDone: number; taskTotal: number } | null = null;
      if (latestSession) {
        let sr: Record<string, any> = {};
        try { sr = JSON.parse(String(latestSession.stageResults || '{}')); } catch { /* 忽略 */ }
        stageProgress = {
          goalReady: !!(sr?.goal?.converged || sr?.goal?.finalStage || sr?.goal?.stage === 'completed' || latestSession.goalConversationId),
          pathReady: !!(sr?.path?.success || latestSession.learningPathId),
          learnStarted: !!(sr?.teaching?.teachingSessionId || latestSession.currentTaskId || latestSession.currentStage === 'teaching' || latestSession.currentStage === 'learn'),
          taskDone: Number(latestSession.completedTasks) || 0,
          taskTotal: Number(latestSession.totalTasks) || 0,
        };
      }
      // 日期模拟进度（只读）：优先会话时钟，其次画像级；供列表「模拟进度」列
      let simulation: { enabled: boolean; dayIndex: number; baseDate: string | null; autoAdvance: boolean } | null = null;
      {
        let sr: Record<string, any> = {};
        if (latestSession) {
          try { sr = JSON.parse(String(latestSession.stageResults || '{}')); } catch { /* 忽略 */ }
        }
        const clock = sr?.simulationClock || (profileData as Record<string, any>)?.simulationClock || null;
        if (clock && typeof clock === 'object') {
          simulation = {
            enabled: clock.enabled === true,
            dayIndex: Number(clock.dayIndex) || 0,
            baseDate: typeof clock.baseDate === 'string' ? clock.baseDate : null,
            autoAdvance: clock.autoAdvance === true,
          };
        }
      }
      return {
        ...p,
        email: p.users.email,
        userName: p.users.name,
        profile: profileData,
        simulation,
        knownConcepts: p.knownConcepts ? JSON.parse(p.knownConcepts) : [],
        struggleConcepts: p.struggleConcepts ? JSON.parse(p.struggleConcepts) : [],
        personalityTraits: p.personalityTraits ? JSON.parse(p.personalityTraits) : {},
        tags: p.tags ? JSON.parse(p.tags) : [],
        /* 会话样本瘦身（2026-10-04 性能批，浏览器实测抓到）：样本的 stageResults 是列表
           响应 ~17.7MB 的主源（688 条样本合计 7.2MB 原文，JSON 转义后基本翻倍）——paused/
           阶段进度/模拟进度等派生字段均已由本路由全量聚合补齐；前端仅在旧缓存缺字段时兜底
           解析它（live.ts pausedFallback）。样本其余字段保留供一屏信号与兼容。 */
        sessions: sessionSample.map((s) => ({
          id: s.id,
          status: s.status,
          currentStage: s.currentStage,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          completedTasks: s.completedTasks,
          totalTasks: s.totalTasks,
          goalConversationId: s.goalConversationId,
          learningPathId: s.learningPathId,
          currentTaskId: s.currentTaskId,
        })),
        sessionCount: p._count?.sessions ?? sessionSample.length,
        storyCount: storyPool.length,
        runningCount: runningByProfile.get(p.id) ?? 0,
        // 已暂停自动驾驶的会话数（autopilot=stopped，会话数据保留）
        pausedCount: pausedByProfile.get(p.id) ?? 0,
        failedCount: failedByProfile.get(p.id) ?? 0,
        // F20：与 failedCount 分列的人为终止数（/stats 的 abandoned 同口径）
        abandonedCount: abandonedByProfile.get(p.id) ?? 0,
        stalledCount: staleByProfile.get(p.id) ?? 0,
        currentStage: runningSessions[0]?.currentStage || sessionSample[0]?.currentStage || null,
        runningSessionIds: runningSessions.map((s) => s.id),
        pausedSessionIds: pausedSessions.map((s) => s.id),
        // 阶段进度（轴 B）：Goal/Path/Learn 三态 + 任务进度
        stageProgress
      };
    });

    const sessionStats = {
      created: countByStatus('created'),
      running: countByStatus('running'),
      failed: countByStatus('failed'),
      abandoned: countByStatus('abandoned'),
      completed: countByStatus('completed'),
      total: statusAgg.reduce((a, s) => a + (s._count?._all ?? 0), 0)
    };
    // 自动驾驶全局并发（配额条数据：used=内存运行中会话数，limit=env 可配上限）
    const autopilotConcurrency = autopilotService.getConcurrencyStats();

    res.json({
      success: true,
      data: {
        profiles: formattedProfiles,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        sessionStats,
        autopilotConcurrency,
        staleCount: staleTotal,
        reclaimThresholdMs: virtualSessionReclaimService.getThresholdMs()
      }
    });
  } catch (error) {
    logger.error('获取虚拟用户列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取虚拟用户列表失败'
    });
  }
});

/**
 * 虚拟实验运行统计（A5）：总会话/完成/failed/卡死/平均时长/完成率/失败率
 * GET /api/admin/virtual-learners/stats
 * 全量聚合口径（非列表 50 条样本）；卡死阈值与 reclaim 服务同源（VLAB_STALE_SESSION_HOURS）。
 * 注意：必须注册在 GET /:id 之前（Express 顺序匹配，避免 'stats' 被当作 profile id）。
 */
router.get('/stats', async (req: Request, res) => {
  try {
    const [statusAgg, profileCount, staleSessions, terminalSessions, todayVirtualCalls, runningSessionsAll] = await Promise.all([
      getSessionStatusAggregates(),
      countProfiles(),
      findStaleSessionsForStats(staleThresholdAt()),
      findTerminalSessions(),
      // 今日虚拟/测试账号调用数（agent_call_logs）；仿真看板核心指标，与总览页真实口径互斥
      countTodayVirtualAgentCalls(),
      // F20 口径对齐列表（2026-10-15）：running 要扣 autopilot=stopped（已暂停），与逐画像 runningCount 同式
      findRunningSessionsForStats()
    ]);

    const countByStatus = (status: string) => statusAgg.find(s => s.status === status)?._count?._all ?? 0;
    const total = statusAgg.reduce((a, s) => a + (s._count?._all ?? 0), 0);
    const completed = countByStatus('completed');
    const failed = countByStatus('failed');
    const abandoned = countByStatus('abandoned');
    const created = countByStatus('created');
    // 运行中扣减与列表同式：autopilot=stopped（用户暂停自动驾驶）归「已暂停」，不算进行中
    const paused = runningSessionsAll.filter((s) => isAutopilotStoppedSession(s.stageResults)).length;
    const running = Math.max(0, countByStatus('running') - paused);

    // 卡死口径与 reclaim 服务同源：管理员暂停的会话无写入是预期行为，不算卡死
    const staleCandidates = staleSessions.filter((s) => !isTeachingPausedSession(s.stageResults));
    const staleCount = staleCandidates.length;
    const maxStaleMins = staleCandidates.length
      ? Math.max(0, Math.round(Math.max(...staleCandidates.map(s => Date.now() - new Date(s.updatedAt).getTime())) / 60000))
      : 0;

    let avgDurationMs = 0;
    if (terminalSessions.length) {
      const totalMs = terminalSessions.reduce((sum, s) => {
        const end = new Date(s.updatedAt).getTime();
        const start = new Date(s.createdAt).getTime();
        return Number.isFinite(end) && Number.isFinite(start) && end >= start ? sum + (end - start) : sum;
      }, 0);
      avgDurationMs = Math.round(totalMs / terminalSessions.length);
    }

    res.json({
      success: true,
      data: {
        profileCount,
        totalSessions: total,
        created,
        running,
        // 已暂停（autopilot=stopped）的会话数：running 已不含它们，单独给出便于对账
        paused,
        failed,
        abandoned,
        completed,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        // 拍板 2026-08-21：失败口径拆分——failed 只承载系统/上游失败，
        // abandoned 承载人为终止（管理员止停/批量终止/僵尸回收/学习者放弃）
        systemFailureRate: total > 0 ? Math.round((failed / total) * 100) : 0,
        humanTerminatedRate: total > 0 ? Math.round((abandoned / total) * 100) : 0,
        failureRate: total > 0 ? Math.round(((failed + abandoned) / total) * 100) : 0,
        staleCount,
        maxStaleMins,
        avgDurationMs,
        reclaimThresholdMs: virtualSessionReclaimService.getThresholdMs(),
        // 今日虚拟/测试账号调用数（仿真看板；总览页真实口径之外的"另一半"）
        todayCalls: todayVirtualCalls
      }
    });
  } catch (error) {
    logger.error('获取虚拟实验运行统计失败:', error);
    res.status(500).json({ success: false, error: error.message || '获取虚拟实验运行统计失败' });
  }
});

/**
 * 获取虚拟用户详情
 * GET /api/admin/virtual-learners/:id
 */
/**
 * 虚拟学习者专属运行设置（RPM 等）。必须定义在 `/:id` 之前，否则会被当作画像 id。
 * GET 返回设置 + 当前限流器运行态；PUT 更新并即时生效；与「平台全局 RPM」相互独立。
 */
router.get('/settings', async (_req: Request, res) => {
  try {
    const settings = await getVirtualLabSettings();
    const stats = getRpmLimitStats();
    res.json({ success: true, data: { settings, rpm: stats.virtualLearner } });
  } catch (error) {
    logger.error('读取虚拟学习者设置失败:', error);
    res.status(500).json({ success: false, error: error.message || '读取虚拟学习者设置失败' });
  }
});

router.put('/settings', async (req: Request, res) => {
  try {
    const body = req.body || {};
    if (body.virtualLearnerRpmLimit !== undefined && !Number.isInteger(body.virtualLearnerRpmLimit)) {
      return res.status(400).json({ success: false, error: 'virtualLearnerRpmLimit 必须是整数' });
    }
    if (body.autopilotConcurrencyLimit !== undefined && !Number.isInteger(body.autopilotConcurrencyLimit)) {
      return res.status(400).json({ success: false, error: 'autopilotConcurrencyLimit 必须是整数' });
    }
    const settings = await updateVirtualLabSettings(body);
    await applyRpmLimitsFromSettings().catch(() => undefined);
    // 并发上限立即回填自动驾驶闸门（免等 30s 设置缓存，运营改完即时生效）
    autopilotService.setConcurrencyLimit(settings.autopilotConcurrencyLimit);
    const stats = getRpmLimitStats();
    res.json({ success: true, data: { settings, rpm: stats.virtualLearner } });
  } catch (error) {
    logger.error('更新虚拟学习者设置失败:', error);
    res.status(500).json({ success: false, error: error.message || '更新虚拟学习者设置失败' });
  }
});

router.get('/:id', async (req: Request, res) => {
  try {
    const { id } = req.params;
    
    const profile = await findProfileDetail(id);
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: '虚拟用户不存在'
      });
    }

    const { profileData } = await ensureProfileStoryPool(profile);

    // 日志子表水合（列表摘要 roundCount/会话数依赖 logs 字段）
    await Promise.all(
      (Array.isArray(profile.sessions) ? (profile.sessions as VirtualSessionRow[]) : []).map(
        (session) => hydrateVirtualSessionLogsField(session)
      )
    );

    res.json({
      success: true,
      data: {
        ...profile,
        email: profile.users.email,
        userName: profile.users.name,
        profile: profileData,
        knownConcepts: profile.knownConcepts ? JSON.parse(profile.knownConcepts) : [],
        struggleConcepts: profile.struggleConcepts ? JSON.parse(profile.struggleConcepts) : [],
        personalityTraits: profile.personalityTraits ? JSON.parse(profile.personalityTraits) : {},
        tags: profile.tags ? JSON.parse(profile.tags) : [],
        sessions: Array.isArray(profile.sessions) ? profile.sessions.map((session: VirtualSessionRow) => buildSessionSummary(session)) : []
      }
    });
  } catch (error) {
    logger.error('获取虚拟用户详情失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取虚拟用户详情失败'
    });
  }
});

/**
 * 更新虚拟用户画像
 * PUT /api/admin/virtual-learners/:id
 */
router.put('/:id', async (req: Request, res) => {
  try {
    const { id } = req.params;
    
    const profile = await findProfileById(id);
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: '虚拟用户不存在'
      });
    }
    
    const updateData: Record<string, unknown> = {};
    
    if (req.body.profile) {
      const existingProfile = parseJson<Record<string, unknown>>(profile.profile, {});
      updateData.profile = JSON.stringify({ ...existingProfile, ...req.body.profile });
    }
    if (typeof req.body.name === 'string' && req.body.name.trim()) {
      await updateUserName(profile.userId, req.body.name.trim());
    }
    // learningGoal 的产品语义已降为可选长期倾向；请求显式携带空串时也要允许清空。
    if (typeof req.body.learningGoal === 'string') updateData.learningGoal = req.body.learningGoal.trim();
    if (req.body.knowledgeLevel) updateData.knowledgeLevel = req.body.knowledgeLevel;
    if (req.body.knownConcepts) updateData.knownConcepts = JSON.stringify(req.body.knownConcepts);
    if (req.body.struggleConcepts) updateData.struggleConcepts = JSON.stringify(req.body.struggleConcepts);
    if (req.body.simulationPrompt) updateData.simulationPrompt = req.body.simulationPrompt;
    if (req.body.simulationModel) updateData.simulationModel = req.body.simulationModel;
    if (req.body.simulationTemperature) updateData.simulationTemperature = req.body.simulationTemperature;
    if (req.body.personalityTraits) updateData.personalityTraits = JSON.stringify(req.body.personalityTraits);
    if (req.body.tags) updateData.tags = JSON.stringify(req.body.tags);
    if (req.body.notes) updateData.notes = req.body.notes;
    // simulationBudget 写入 profile JSON（以虚拟学习者为单位的 LLM 重试预算）
    // 注意：与 runtimePrefs 共用同一 profile JSON，必须从同一 base 叠加，避免相互覆盖
    let nextProfileJson = profile.profile;
    if (req.body.simulationBudget) {
      const base = parseJson<Record<string, unknown>>(nextProfileJson, {});
      const existingBudget = (base.simulationBudget || {}) as Record<string, unknown>;
      const newBudget = { ...existingBudget, ...req.body.simulationBudget };
      // 钳制数值范围（与前端输入框 min/max 一致），防止手误写入超大值导致近无限重试
      newBudget.maxRetriesPerStep = clampBudgetValue(newBudget.maxRetriesPerStep, 8, 1, 20);
      newBudget.maxRetriesTotal = clampBudgetValue(newBudget.maxRetriesTotal, 600, 1, 1000);
      // 保留已消耗的 consumedRetries（不能被前端覆盖）
      newBudget.consumedRetries = existingBudget.consumedRetries || 0;
      nextProfileJson = JSON.stringify({ ...base, simulationBudget: newBudget });
    }
    // runtimePrefs 写入 profile JSON（虚拟人运行偏好：每课回合上限 / 默认难度；
    // 新会话创建时作为 simulationConfig 初始值，三级驾驶舱可临时覆盖）
    if (req.body.runtimePrefs && typeof req.body.runtimePrefs === 'object') {
      const base = parseJson<Record<string, unknown>>(nextProfileJson, {});
      const existingPrefs = (base.runtimePrefs || {}) as Record<string, unknown>;
      const newPrefs: Record<string, unknown> = { ...existingPrefs, ...req.body.runtimePrefs };
      if (Number.isFinite(Number(newPrefs.turnCapPerLesson))) {
        newPrefs.turnCapPerLesson = Math.min(100, Math.max(1, Math.round(Number(newPrefs.turnCapPerLesson))));
      }
      if (newPrefs.frictionBudget !== undefined) {
        const friction = String(newPrefs.frictionBudget);
        newPrefs.frictionBudget = (SIMULATION_FRICTION_BUDGETS as readonly string[]).includes(friction) ? friction : 'normal';
      }
      nextProfileJson = JSON.stringify({ ...base, runtimePrefs: newPrefs });
    }
    if (nextProfileJson !== profile.profile) updateData.profile = nextProfileJson;
    
    const updated = await updateProfileFields(id, updateData);
    
    res.json({
      success: true,
      data: {
        ...updated,
        profile: JSON.parse(updated.profile || '{}'),
        knownConcepts: updated.knownConcepts ? JSON.parse(updated.knownConcepts) : [],
        struggleConcepts: updated.struggleConcepts ? JSON.parse(updated.struggleConcepts) : [],
        personalityTraits: updated.personalityTraits ? JSON.parse(updated.personalityTraits) : {},
        tags: updated.tags ? JSON.parse(updated.tags) : []
      }
    });
  } catch (error) {
    logger.error('更新虚拟用户画像失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '更新虚拟用户画像失败'
    });
  }
});

/**
 * 删除虚拟用户（R3 级联：会话/教学记录/路径/evidence/projections/日志一并清理 + 审计）
 * DELETE /api/admin/virtual-learners/:id
 * 保护：仅 isVirtualLearner 用户可删（真实用户 409）；级联清单写 admin_audit_logs。
 */
router.delete('/:id', async (req: Request, res) => {
  try {
    const { id } = req.params;
    const manifest = await virtualCleanupService.cascadeDeleteProfile(id, {
      adminId: req.user?.userId ?? null,
      adminName: req.user?.email ?? null
    });

    logger.info('删除虚拟用户成功', {
      profileId: id,
      userId: manifest.userId,
      deletedSessions: manifest.virtualSessions.length,
      deletedTeachingSessions: manifest.teachingSessions,
      deletedBy: req.user?.userId
    });

    res.json({
      success: true,
      message: '虚拟用户已删除',
      data: { cleanup: manifest }
    });
  } catch (error) {
    if (error?.code === 'VIRTUAL_PROFILE_REAL_USER_PROTECTED') {
      logger.warn('拒绝删除非虚拟学习者', {
        profileId: req.params.id,
        operatorId: req.user?.userId ?? null
      });
      return res.status(409).json({
        success: false,
        error: error.message,
        code: error.code
      });
    }
    if (error?.code === 'VIRTUAL_PROFILE_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
    logger.error('删除虚拟用户失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '删除虚拟用户失败'
    });
  }
});

/**
 * 启动模拟会话
 * POST /api/admin/virtual-learners/:id/start-session
 */
router.post('/:id/start-session', async (req: Request, res) => {
  try {
    const { id } = req.params;
    const { storyId, storyIndex, frictionBudget } = req.body || {};
    if (frictionBudget && !SIMULATION_FRICTION_BUDGETS.includes(frictionBudget)) {
      return res.status(400).json({ success: false, error: 'frictionBudget 不合法' });
    }
    const session = await createSessionForProfile(id, { storyId, storyIndex, frictionBudget });
    if (!session) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }
    res.json({ success: true, data: session });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) logger.error('启动模拟会话失败:', error);
    res.status(status).json({
      success: false,
      error: error.message || '启动模拟会话失败',
      ...(error?.code ? { code: error.code } : {})
    });
  }
});

/**
 * 获取模拟会话详情
 * GET /api/admin/virtual-sessions/:sessionId
 */
router.get('/sessions/:sessionId', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await findSessionWithProfileAndUser(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: '模拟会话不存在'
      });
    }

    // 日志子表水合：侧表权威的会话把 logs 字段覆写为侧表内容（旧会话原样读列）
    await hydrateVirtualSessionLogsField(session);

    let logs: SimulationLogEntry[] = [];
    try {
      logs = JSON.parse(session.logs || '[]');
    } catch {
      // ignore malformed logs payload
    }
    
    let stageResults: StageResults = {};
    try {
      stageResults = JSON.parse(session.stageResults || '{}');
    } catch {
      // ignore malformed stageResults payload
    }

    let goalConversation: goal_conversations | null = null;
    if (session.goalConversationId) {
      goalConversation = await findGoalConversationById(session.goalConversationId);
    }

    /* 同路径课堂清单：控制台课程树凭 teachingSessionHistory 把每节课映射到课堂会话 id（点开已上完的课）。
       真实会话由 session-console 现算，虚拟会话此前只读 stageResults.teaching 里的这个字段——
       而逐课推进（start-learning 每课一调）会 removeStageResults:['teaching'] 重置该阶段，
       只会把重置前读到的旧值写回，于是列表恒空：已上完的课没有课堂 id，点它只会落到
       「从该课开始学习」。这里与真实会话同源补算（同一 mapper，形状不分叉）。 */
    if (session.learningPathId) {
      const teaching = (stageResults.teaching = stageResults.teaching || {});
      teaching.teachingSessionHistory = teachingSessionHistoryOf(
        await findTeachingSessionsByPathId(session.learningPathId)
      );
    }

    let teachingSession: Awaited<ReturnType<typeof teachingSessionRepository.getById>> | null = null;
    const teachingSessionId = stageResults?.teaching?.teachingSessionId;
    if (typeof teachingSessionId === 'string' && teachingSessionId.trim()) {
      teachingSession = await teachingSessionRepository.getById(teachingSessionId.trim());
    }

    const conversations = buildSessionConversations(session, logs, goalConversation);
    const runtime = buildSessionRuntime(session, teachingSession);
    const resolvedBudget = resolveSessionBudget({
      stageResults,
      profileData: JSON.parse(session.virtual_learner_profiles.profile || '{}')
    });
    
    res.json({
      success: true,
      data: {
        ...session,
        logs,
        stageResults,
        conversations,
        runtime,
        budget: resolvedBudget,
        bindings: buildSessionBindings(session),
        storyContext: parseStoryContext(session),
        profile: {
          ...session.virtual_learner_profiles,
          profile: JSON.parse(session.virtual_learner_profiles.profile || '{}'),
          email: session.virtual_learner_profiles.users.email,
          userName: session.virtual_learner_profiles.users.name
        }
      }
    });
  } catch (error) {
    logger.error('获取模拟会话详情失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取模拟会话详情失败'
    });
  }
});

/**
 * GET /api/admin/virtual-learners/sessions/:sessionId/simulation-clock
 * 会话的模拟时钟（只读）：默认关（enabled=false，status='disabled'）。
 * 设计：doc/VIRTUAL_LEARNER_SIMULATED_DAY_DESIGN.md §8.2/C2①。
 */
router.get('/sessions/:sessionId/simulation-clock', async (req: Request, res) => {
  try {
    const clock = await simulatedDayService.getSimulationClock(req.params.sessionId);
    if (!clock) {
      return res.status(404).json({ success: false, error: '会话不存在' });
    }
    res.json({ success: true, data: clock });
  } catch (error) {
    logger.error('读取模拟时钟失败:', error);
    res.status(500).json({ success: false, error: error.message || '读取模拟时钟失败' });
  }
});

/**
 * GET /api/admin/virtual-learners/sessions/:sessionId/day-timeline?from=&to=&baseDate=
 * 会话按天时间线（只读聚合）：负担/状态/干预/难度调整/温故额度/记忆，全部按 asOf 读回。
 * 数据源均为已落地读写缝（getAggregatedState / ReviewQuotaService / learner_evidence ...），不新增实体。
 */
router.get('/sessions/:sessionId/day-timeline', async (req: Request, res) => {
  try {
    const fromDay = req.query.from !== undefined ? Number(req.query.from) : undefined;
    const toDay = req.query.to !== undefined ? Number(req.query.to) : undefined;
    const baseDate = typeof req.query.baseDate === 'string' ? req.query.baseDate : undefined;
    if (fromDay !== undefined && !Number.isFinite(fromDay)) {
      return res.status(400).json({ success: false, error: 'from 必须是数字' });
    }
    if (toDay !== undefined && !Number.isFinite(toDay)) {
      return res.status(400).json({ success: false, error: 'to 必须是数字' });
    }
    const timeline = await simulatedDayService.getDayTimeline({
      sessionId: req.params.sessionId,
      baseDate,
      fromDay,
      toDay,
    });
    if (!timeline) {
      return res.status(404).json({ success: false, error: '会话不存在' });
    }
    res.json({ success: true, data: timeline });
  } catch (error) {
    logger.error('读取按天时间线失败:', error);
    res.status(500).json({ success: false, error: error.message || '读取按天时间线失败' });
  }
});

router.post('/:id/projection-token', async (req: Request, res) => {
  try {
    const { id } = req.params;
    const operatorId = req.user?.userId;

    const profile = await findProfileForProjectionToken(id);

    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    const token = signProjectionToken({
      targetUserId: profile.userId,
      sourceProfileId: profile.id,
      issuedByAdminId: operatorId,
      grantSource: 'virtual-learner',
      grantId: null,
      storyId: typeof req.body?.storyId === 'string' && req.body.storyId.trim() ? req.body.storyId.trim() : null,
      virtualSessionId: typeof req.body?.virtualSessionId === 'string' && req.body.virtualSessionId.trim() ? req.body.virtualSessionId.trim() : null,
      scope: req.body?.scope === 'full' ? 'full' : 'dashboard',
      type: 'projection'
    });

    res.json({
      success: true,
      data: {
        token,
        grantSource: 'virtual-learner',
        grantId: null,
        targetUserId: profile.userId,
        profileId: profile.id,
        userName: profile.users.name,
        email: profile.users.email,
        expiresIn: '30m'
      }
    });
  } catch (error) {
    logger.error('创建前台投影 token 失败:', error)
    res.status(500).json({ success: false, error: error.message || '创建前台投影 token 失败' })
  }
})
}
