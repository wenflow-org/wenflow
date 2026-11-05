import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { conceptRegistryService } from './concept-registry.service';
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';
import { conceptGraphService } from './concept-graph.service';
// 注册表口径的归一化（比本文件的本地 normalizeConceptKey 更强：还去引号/冒号从句/尾部标点）。
// 查别名表必须用它，否则会 miss——本文件那个本地版只做 trim+空白压缩。
import { normalizeConceptKey as normalizeConceptKeyCanonical } from '../memory/concept-key';
import type {
  LearnerBackgroundConceptLedgerItem,
  LearnerGlobalBackgroundKnowledge,
  LearnerConceptState,
  LearnerKnowledgeMemory,
  LearnerPathKnowledgeMemory,
  LearnerRecentEvidence,
  LearnerRecurringConfusion,
  LearnerTaskMastery,
  LearnerTransferSignal,
} from '../../agents/learner-model-agent/types';

type BuildInput = {
  userId: string;
  learningPathId?: string;
  milestoneId?: string;
  taskId?: string;
};

type ConceptSignal = {
  score: number;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  stability: 'unknown' | 'fragile' | 'developing' | 'stable';
  sourceType: 'task-label' | 'session-knowledge' | 'derived' | 'memory-trace';
  taskId?: string;
  milestoneId?: string;
  /** 信号来源路径。缺省 = 用户级（记忆痕迹），当前路径视图里始终保留。 */
  pathId?: string;
  seenAt?: string;
  label: string;
  /** 概念身份（canonical）。痕迹来源直接带；其它来源在聚合后统一解析（只读，不创建）。 */
  conceptId?: string;
};

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * 占位概念键不是概念身份：克隆源路径会把本地序号（`concept-4`）带进 `coreConcept`，痕迹表里也有
 * 同形键。它们一旦进概念集合，就会以内部 id 形态漏进用户可见文案（2026-10-15 P0-2 实测：
 * fragile 名单与 advisory 正文出现「concept-4」）。
 */
const PLACEHOLDER_CONCEPT_KEY_RE = /^concept-\d+$/i;

/**
 * 机器 slug 不是概念身份（#59/#60 第 4 条）：模型常把分析用语写成
 * `rubric_document_alignment` / `reliability_vs_validity` / `intrinsic-vs-extrinsic-motivation`
 * 这类全 ASCII + 下划线/连字符的键，它们在名单里既不可读也无法与中文概念归并。
 * 只过滤「全 ASCII 且带分隔符」的形态：人类英文概念名通常带空格（`supply and demand`），不受影响。
 */
const MACHINE_SLUG_RE = /^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)+$/;
const NAMESPACED_KEY_RE = /^[A-Za-z0-9]+(?::[A-Za-z0-9_-]+)+$/;

/** 卡点判定线（2026-10-15 F3/F4 定档）：证据均分低于它算「卡点」。 */
export const STRUGGLING_MASTERY_THRESHOLD = 0.55;
/** 高严重度卡点线：低于它才允许触发「压缩/加速」这类减法动作（struggling 常态档挡不住它们）。 */
export const SEVERE_STRUGGLING_MASTERY_THRESHOLD = 0.3;
/**
 * 前置缺口掌握线（图法与旧口径回落共用，此前散落两处裸 0.45）：低于它算「掌握不稳、阻塞当前任务」。
 * 与 STRUGGLING_MASTERY_THRESHOLD(0.55) 的分工：0.55 管「学习中的概念算不算卡点」（名单/文案），
 * 0.45 管「已接触过的前置概念算不算缺口」（缺口判定）——两线不同不是笔误，缺口判定更保守。
 */
export const PREREQUISITE_GAP_MASTERY_THRESHOLD = 0.45;

/**
 * build 实际消费的 learner_evidence 类型（查询级过滤，与证据循环的分支一一对应）。
 * 其余类型（checkpoint 结果等）此前被整行取回后逐行 JSON.parse 再丢弃，白占 take 名额。
 */
const CONSUMED_EVIDENCE_TYPES = [
  'session-knowledge-distilled',
  'dialogue-concepts-extracted',
  'task:completed',
  'lesson:completed',
] as const;

/**
 * fragile 证据门（#59/#60 第 1 条，2026-10-17）：
 * `masteryScore < 0.5` 单独不再构成「脆弱」——它曾让「刚学一半」与「真卡住」共用同一名单，
 * fragile 恒大于 0 又反过来焊死难度升档口。现在低分要配合**真实提取证据**：
 * 至少 3 次提取，且最近一次已过去 7 天（遗忘窗口），或 FSRS 已标 fragile / 间隔因子 >4。
 */
export const FRAGILE_MIN_EXTRACTIONS = 3;
export const FRAGILE_STALE_DAYS = 7;

function isRealConceptKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (PLACEHOLDER_CONCEPT_KEY_RE.test(trimmed)) return false;
  if (MACHINE_SLUG_RE.test(trimmed)) return false;
  if (NAMESPACED_KEY_RE.test(trimmed)) return false;
  return true;
}

function normalizeConceptKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized ? normalized : null;
}

/**
 * 前置缺口（L3 · S4b）：当前任务的**上游前置**里未掌握的那些。
 *
 * 链路：当前任务 canonical（优先用 subtask.conceptId，回落按名字只读解析）
 * → `upstreamClosure`（prerequisite 上游，maxDepth 2）→ 用 `conceptStates`（已带 conceptId）判掌握
 * → 未掌握者按深度定 severity（一跳 = 直接阻塞 → high；两跳 = medium）。
 *
 * 返回空数组 = 无图/无上游/全部已掌握，调用方回落旧口径（保证未回填路径零行为变化）。
 * 读侧纪律：只读解析（`createIfMissing:false`），不写库。
 */
async function buildUpstreamPrerequisiteGaps(params: {
  userId: string;
  pathId: string;
  currentTask: { conceptId?: string | null; linkedConceptName?: string | null; coreConcept?: string | null } | null;
  conceptStates: LearnerConceptState[];
}): Promise<Array<{ conceptKey: string; label: string; reason: string; severity: 'high' | 'medium'; source: 'graph' }>> {
  const { userId, pathId, currentTask, conceptStates } = params;
  if (!userId || !currentTask) return [];
  try {
    let conceptId = currentTask.conceptId ?? null;
    if (!conceptId) {
      const name = currentTask.linkedConceptName || currentTask.coreConcept;
      if (!name) return [];
      const resolved = await conceptRegistryService.resolveConcept(userId, name, { createIfMissing: false });
      conceptId = resolved?.conceptId ?? null;
    }
    if (!conceptId) return [];

    const upstream = await conceptGraphService.upstreamClosure(userId, conceptId, { maxDepth: 2, pathId });
    if (upstream.length === 0) return [];

    const stateByConceptId = new Map<string, LearnerConceptState>();
    for (const state of conceptStates) {
      if (state.conceptId && !stateByConceptId.has(state.conceptId)) stateByConceptId.set(state.conceptId, state);
    }
    return upstream
      .map((item) => {
        const state = stateByConceptId.get(item.conceptId);
        const weak = !state
          || state.stability === 'fragile'
          || state.status === 'review'
          || state.masteryScore < PREREQUISITE_GAP_MASTERY_THRESHOLD;
        if (!weak) return null;
        return {
          conceptKey: state?.conceptKey || item.conceptId,
          label: state?.label || item.label || item.conceptId,
          reason: item.depth === 1
            ? '当前任务直接依赖该前置知识点，但历史证据显示尚未掌握。'
            : '该知识点是当前任务的间接前置（上游两跳），掌握不稳定会影响后续推进。',
          severity: (item.depth === 1 ? 'high' : 'medium') as 'high' | 'medium',
          source: 'graph' as const,
        };
      })
      .filter((gap): gap is { conceptKey: string; label: string; reason: string; severity: 'high' | 'medium'; source: 'graph' } => !!gap)
      .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1))
      .slice(0, 4);
  } catch (error) {
    logger.warn('[learner-knowledge] 上游前置缺口计算失败（best-effort，回落旧口径）', {
      userId,
      pathId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function parseLearningObjectives(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const parsed = parseJsonSafe<any>(raw, null);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof parsed === 'string') {
    return [parsed.trim()].filter(Boolean);
  }
  if (typeof raw === 'string') {
    return [raw.trim()].filter(Boolean);
  }
  return [];
}

function dedupe(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => normalizeConceptKey(value)).filter(Boolean) as string[]));
}

/**
 * 概念身份键（P1-16 修复，2026-10-06 审计）。
 *
 * 确定性台账的键是**中文 label**（task.linkedConceptName / 会话知识点名；displayLabel 兜底文案
 * 自 2026-10-15 起不进概念集合——它是显示文案不是概念身份），
 * 而 lesson-knowledge-enricher 的模型行自拟 `conceptKey`（实测 67/120 为英文 slug，如
 * `hand-over-choice` 对应 label「交出选择权降低开场抵触」）。两套键空间按精确 conceptKey
 * 永不 join → 同一概念「确定性一行 + 模型一行」并存，经 toTeachingProjection 注入课堂 prompt
 * 后，下一个授课模型看到互相矛盾的状态。
 *
 * 归并键改为：**中文 label 优先**（label 才是课堂可读身份，也是确定性台账的既有键），
 * label 缺失时才回落 conceptKey；再做机械归一化（去空白/引号/冒号从句/尾标点，与
 * 记忆层 `normalizeConceptKey` 同口径）。这样英文 slug 行与中文 label 行在同一概念上
 * 收敛为一行，杜绝双行矛盾。
 */
export function conceptIdentityKey(item: { conceptKey?: string | null; label?: string | null }): string | null {
  const label = typeof item?.label === 'string' ? item.label.trim() : '';
  const raw = label || (typeof item?.conceptKey === 'string' ? item.conceptKey.trim() : '');
  if (!raw) return null;
  return normalizeConceptKeyCanonical(raw) || raw;
}

/**
 * 台账聚合分组（读取侧 conceptId 优先 · 设计 doc/KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md §3.4 #8
 * 「按 conceptId 聚合，label 保留展示」）。
 *
 * 分组键（kcid 域，2026-10-07）：
 * - **conceptId 优先**：行可解析出身份（identityOf）时，归到该 canonical 身份名下既有的组——
 *   同一概念经注册表归并后的不同写法/键空间（痕迹键 vs 任务标签键）收敛为一行；
 * - **名字键兜底**：未挂靠行（解析不出身份）按 conceptIdentityKey（P1-16 label 优先归一化）
 *   归组——**未挂靠键的旧行为逐字兼容**；
 * - 只认「身份精确相等」或「名字键精确相等」，不做任何模糊匹配——宁缺勿错，不误并。
 *
 * 不变式：同名字键、不同 conceptId 的双锚行在本数据流中不可构造（带身份的确定性行与
 * conceptStates 一一同名且键唯一；模型行恒无身份），名字兜底归并不会越过身份边界。
 */
function groupItemsByConceptIdentity<T extends { conceptKey?: string | null; label?: string | null }>(
  items: readonly T[],
  identityOf: (item: T) => string | undefined,
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  const groupKeyById = new Map<string, string>();
  for (const item of items) {
    if (!item?.conceptKey) continue; // 旧行为：无 conceptKey 的行不进台账
    const nameKey = conceptIdentityKey(item) ?? item.conceptKey;
    const conceptId = identityOf(item);
    let key = nameKey;
    if (conceptId) {
      const owner = groupKeyById.get(conceptId);
      if (owner) key = owner; // conceptId 优先：并到同身份既有组
      else groupKeyById.set(conceptId, key); // 首见身份：以名字键建组
    }
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()];
}

function signalFromProgress(progress: number, status: 'pending' | 'learning' | 'mastered' | 'review') {
  const score = clamp(progress / 100, 0, 1);
  const stability = status === 'mastered'
    ? 'stable'
    : status === 'review'
      ? 'fragile'
      : status === 'learning'
        ? 'developing'
        : 'unknown';

  return { score, stability } as const;
}

/** 知识状态行 → 证据信号：review→struggle、mastered→mastery、其余（含 learning）→incomplete，不再把「仍在学」当掌握。 */
function signalFromKnowledgeState(items: Array<{ status?: string | null }>): LearnerRecentEvidence['signal'] {
  if (items.some((item) => item?.status === 'review')) return 'struggle';
  if (items.some((item) => item?.status === 'mastered')) return 'mastery';
  return 'incomplete';
}

/**
 * 会话评估 → 记忆信号（2026-09-22 档位化修正）。
 *
 * LLM 现在只输出档位（low/mid/high），0-10 数值是**档位区间中点**（mid=6）。
 * 继续用 `>= 6` 会把整个 mid 档（锚点定义："有明显吃力/疲劳但引导下仍能推进"）
 * 误判成 fatigue/mastery/struggle —— 等于把"正常摩擦"升级成"异常信号"。
 * 因此改为**按档位判定**（只有 high = 8-10 才进这些桶）；legacy 数值（无档位）仍走 >= 6。
 * 判据来源：session-wrapup 的评分参考（三个阈值参数的唯一定义在 session-evaluation-scale）。
 */
function resolveEvaluationSignal(evaluation: {
  sessionLf?: number | null;
  sessionKtl?: number | null;
  sessionLss?: number | null;
  metricTiers?: { sessionLf?: string; sessionKtl?: string; sessionLss?: string } | null;
}): 'fatigue' | 'mastery' | 'struggle' | 'incomplete' {
  const tiers = evaluation?.metricTiers || null;
  const isHigh = (tier: string | undefined, value: number | null | undefined): boolean =>
    tier ? tier === 'high' : (typeof value === 'number' && Number.isFinite(value) && value >= 6);
  if (isHigh(tiers?.sessionLf, evaluation?.sessionLf)) return 'fatigue';
  if (isHigh(tiers?.sessionKtl, evaluation?.sessionKtl)) return 'mastery';
  if (isHigh(tiers?.sessionLss, evaluation?.sessionLss)) return 'struggle';
  return 'incomplete';
}

export class LearnerKnowledgeMemoryService {
  async build(input: BuildInput): Promise<LearnerKnowledgeMemory> {
    const resolvedPath = input.learningPathId
      ? await prisma.learning_paths.findUnique({
          where: { id: input.learningPathId },
          include: {
            milestones: {
              orderBy: { stageNumber: 'asc' },
              include: {
                subtasks: {
                  orderBy: { order: 'asc' },
                },
              },
            },
          },
        })
      : // 无 pathId（如 admin 证据端点场景）时自动定位用户最新 active 路径，
        // 否则 currentPath 恒空、recentEvidence/conceptLedger 等画像数据前端永远看不到
        await prisma.learning_paths.findFirst({
          where: { userId: input.userId, status: 'active' },
          orderBy: { updatedAt: 'desc' },
          include: {
            milestones: {
              orderBy: { stageNumber: 'asc' },
              include: {
                subtasks: {
                  orderBy: { order: 'asc' },
                },
              },
            },
          },
        });

    // #155：无 active 路径（路径已完成/归档）或路径不属于本用户时，不再整体清零。
    // globalSignals / globalBackground 是**用户级**画像（按 userId 聚合痕迹与各路径证据），
    // 不依赖具体路径；只有 currentPath 依赖它。此前这里直接 return 空结构，导致路径完成或
    // 归档后管理端 / learner-center 的已掌握、脆弱名单凭空归零（连用户级 memory_traces 都不读）。
    const path = resolvedPath && resolvedPath.userId === input.userId ? resolvedPath : null;

    // #93：globalSignals / globalBackground 是**用户级**画像，不能只从当前路径取数——
    // 多路径学习者的跨路径概念信号、反复误解、迁移信号此前全部漏掉。
    // 取最近若干条路径参与聚合（有界，避免老路径的行数和查询成本无限增长）；
    // 当前路径若不在最近 N 条里也会被显式并入（allPaths 首位）。
    const OTHER_PATHS_LIMIT = 8;
    const otherPaths = (await prisma.learning_paths.findMany({
      where: {
        userId: input.userId,
        // #155：状态白名单——被放弃（abandoned）的路径不是用户的学习证据，不参与用户级并集；
        // active/completed/archived 仍参与（#93「完成/换目标后不失忆」）。
        status: { not: 'abandoned' },
        ...(path ? { id: { not: path.id } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: OTHER_PATHS_LIMIT,
      include: {
        milestones: {
          orderBy: { stageNumber: 'asc' },
          include: {
            subtasks: {
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    })) ?? [];
    const allPaths = path ? [path, ...otherPaths] : otherPaths;
    const pathIds = allPaths.map((item) => item.id);
    const currentPathTaskIds = new Set(
      (path?.milestones ?? []).flatMap((milestone) => (milestone.subtasks || []).map((task) => task.id))
    );

    const [allSessions, allPersistedEvidence, memoryTraces] = await Promise.all([
      prisma.teaching_sessions.findMany({
        where: {
          userId: input.userId,
          learningPathId: { in: pathIds },
        },
        orderBy: { startTime: 'desc' },
        take: 30 * pathIds.length,
        select: {
          id: true,
          learningPathId: true,
          taskId: true,
          milestoneId: true,
          knowledgeState: true,
          wrapup: true,
          endTime: true,
          updatedAt: true,
        },
      }),
      prisma.learner_evidence.findMany({
        // 查询级类型过滤 + 列裁剪：本函数只消费 CONSUMED_EVIDENCE_TYPES 四种，
        // 旧口径取全量行后逐行 JSON.parse 再在内存丢弃，无关类型白占 take 名额与传输量。
        where: {
          userId: input.userId,
          pathId: { in: pathIds },
          evidenceType: { in: [...CONSUMED_EVIDENCE_TYPES] },
        },
        orderBy: { occurredAt: 'desc' },
        take: 50 * pathIds.length,
        select: {
          pathId: true,
          evidenceType: true,
          payload: true,
          taskId: true,
          sessionId: true,
          confidence: true,
          occurredAt: true,
        },
      }),
      // 记忆引擎 M2 读侧并轨：memory_traces（ACT-R 痕迹）并入概念信号，脆弱/到期概念显式标记
      prisma.memory_traces.findMany({
        where: { userId: input.userId },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      })
    ]);

    // issue #156（复核补修）：蒸馏/对话证据的取胜时间必须取所属会话的**业务 endTime**
    // （与确定性通道 :615-617 同源：模拟/回填链路经 simulatedNowOr 落模拟日），
    // 而不是 learner_evidence.occurredAt——它由 createDomainEvent 缺省 new Date() 生成
    // （teaching-session-lifecycle.ts:1064 未传值）＝真墙钟，与本文件 :550-552 / :615-617
    // 及 anchor-probe 守卫禁止的跨时钟域比较同源违规。
    const sessionEndTimeById = new Map<string, string>();
    for (const session of allSessions) {
      if (session.endTime) sessionEndTimeById.set(session.id, session.endTime.toISOString());
    }

    const conceptSignals = new Map<string, ConceptSignal[]>();
    const recentEvidence: LearnerRecentEvidence[] = [];
    // 用户级证据（跨路径）：只喂 globalBackground 台账聚合；currentPath.recentEvidence 仍按路径取。
    const globalRecentEvidence: LearnerRecentEvidence[] = [];
    const enrichedLedger: LearnerBackgroundConceptLedgerItem[] = [];
    const enrichedConfusions: LearnerRecurringConfusion[] = [];
    const enrichedReusableFoundations: string[] = [];
    const enrichedBlockedFoundations: string[] = [];
    const enrichedTransferSignals: LearnerTransferSignal[] = [];
    // issue #194：knowledgeStateSummary 曾只写进 learner_evidence、从不进快照。
    // 证据按 occurredAt desc 取，首个非空摘要即最新一次课后状态摘要。
    // issue #198：摘要是**自由文本**，可命名其它路径的概念。它随 globalBackground 进入
    // 教学上下文并作为 learning-predictor 的输入（TeachingContextBuilder:446），而预测器按
    // pathId/taskId 计算——若取到别的路径的摘要，别的路径的概念会无声渗入当前路径的教学场景
    // （focusConcepts 回写 prediction_records）。故摘要必须按**当前路径**取；其它路径的摘要
    // 不参与（跨路径概念仍以 conceptLedger/recurringConfusions 等结构化字段用户级聚合）。
    let enrichedKnowledgeStateSummary: string | undefined;

    for (const evidence of allPersistedEvidence) {
      const evidencePathId = evidence.pathId ?? undefined;
      const isCurrentPath = evidencePathId === path?.id;
      // payload 只在确认要消费该类型后才解析（旧口径对每行先 parse 再判类型）
      if (evidence.evidenceType === 'session-knowledge-distilled') {
        const payload = parseJsonSafe<any>(evidence.payload, {});
        // issue #156（复核补修）：概念台账「最旧证据覆盖最新证据」。模型行本身不带时间戳
        // （lesson-knowledge-enricher 输出无 lastSeenAt），需用**同源业务时间**补齐才能按证据
        // 新旧取胜；此处取所属会话的 endTime（确定性通道用的是同一个 session.endTime），
        // 不用证据墙钟 occurredAt——否则与确定性通道跨时钟域比较，模拟/回填链路下回退到旧课
        // 掌握度仍可复现。查不到业务时间（会话未结束/未加载）就**不记**时间，绝不回退墙钟。
        const businessAtIso = evidence.sessionId ? sessionEndTimeById.get(evidence.sessionId) : undefined;
        if (Array.isArray(payload.conceptLedger)) {
          enrichedLedger.push(...payload.conceptLedger.map((item: any) => businessAtIso
            ? { ...item, firstSeenAt: item?.firstSeenAt ?? businessAtIso, lastSeenAt: businessAtIso }
            : item));
        }
        if (Array.isArray(payload.reusableFoundations)) enrichedReusableFoundations.push(...payload.reusableFoundations);
        if (Array.isArray(payload.blockedFoundations)) enrichedBlockedFoundations.push(...payload.blockedFoundations);
        if (Array.isArray(payload.transferSignals)) enrichedTransferSignals.push(...payload.transferSignals);
        if (!enrichedKnowledgeStateSummary
          && isCurrentPath
          && typeof payload.knowledgeStateSummary === 'string'
          && payload.knowledgeStateSummary.trim()) {
          enrichedKnowledgeStateSummary = payload.knowledgeStateSummary.trim();
        }
        continue;
      }
      if (evidence.evidenceType === 'dialogue-concepts-extracted') {
        const payload = parseJsonSafe<any>(evidence.payload, {});
        if (Array.isArray(payload.recurringConfusions)) {
          // 同上：recurringConfusions 的 lastSeenAt 取所属会话业务 endTime，不用证据墙钟 occurredAt。
          const businessAtIso = evidence.sessionId ? sessionEndTimeById.get(evidence.sessionId) : undefined;
          enrichedConfusions.push(...payload.recurringConfusions.map((item: any) => businessAtIso
            ? { ...item, lastSeenAt: businessAtIso }
            : item));
        }
        if (Array.isArray(payload.transferSignals)) enrichedTransferSignals.push(...payload.transferSignals);
        continue;
      }
      if (evidence.evidenceType !== 'task:completed' && evidence.evidenceType !== 'lesson:completed') {
        continue;
      }
      const payload = parseJsonSafe<any>(evidence.payload, {});
      const conceptKeys = dedupe([
        payload.linkedConceptName,
        ...(Array.isArray(payload.conceptKeys) ? payload.conceptKeys : []),
        ...(Array.isArray(payload.knowledgeState) ? payload.knowledgeState.map((item: any) => item?.name) : [])
      ]);
      const type: LearnerRecentEvidence['type'] = evidence.evidenceType === 'task:completed'
        ? 'task-completed'
        : 'teaching-session';
      const signal: LearnerRecentEvidence['signal'] = evidence.evidenceType === 'lesson:completed'
        ? signalFromKnowledgeState(Array.isArray(payload.knowledgeState) ? payload.knowledgeState : [])
        : 'mastery';
      const recent = {
        type,
        taskId: evidence.taskId || undefined,
        sessionId: evidence.sessionId || undefined,
        conceptKeys,
        signal,
        score: evidence.confidence,
        happenedAt: evidence.occurredAt.toISOString()
      } satisfies LearnerRecentEvidence;
      globalRecentEvidence.push(recent);
      if (isCurrentPath) recentEvidence.push(recent);
    }

    // 证据倒排索引（一次 O(E×k) 预构建）：替代台账/反复误解聚合里对每个概念的全量嵌套扫描
    // （旧口径 O(概念数×证据数×includes)。key → 命中该键的证据行下标集合，Set 保证同一条
    // 证据同时含 label 与 conceptKey 时只计一次；struggle 计数按 (证据行, 键) 记账，与旧口径一致。
    const evidenceIndicesByKey = new Map<string, Set<number>>();
    const struggleCountByKey = new Map<string, number>();
    for (let i = 0; i < globalRecentEvidence.length; i += 1) {
      const item = globalRecentEvidence[i];
      for (const key of item.conceptKeys) {
        if (!key) continue;
        let indices = evidenceIndicesByKey.get(key);
        if (!indices) {
          indices = new Set<number>();
          evidenceIndicesByKey.set(key, indices);
        }
        indices.add(i);
        if (item.signal === 'struggle') {
          struggleCountByKey.set(key, (struggleCountByKey.get(key) ?? 0) + 1);
        }
      }
    }

    const allTasks = (path?.milestones ?? []).flatMap((milestone) =>
      (milestone.subtasks || []).map((task) => ({ milestone, task }))
    );
    // 其它路径的任务只作为用户级概念台账/前置的排期事实（task-label），
    // 不进 currentPath.taskMastery / 里程碑进度。
    const otherPathTasks = otherPaths.flatMap((otherPath) =>
      otherPath.milestones.flatMap((milestone) =>
        (milestone.subtasks || []).map((task) => ({ pathId: otherPath.id, milestone, task }))
      )
    );

    for (const { milestone, task } of allTasks) {
      const objectiveConcepts = parseLearningObjectives(task.learningObjectives);
      // displayLabel 是 DISPLAY_LABEL_MAP 的兜底文案（「理解核心原理」这类认知层级 × 领域组合词），
      // 是任务的**显示文案**不是概念身份——进集合后会以同名词目的形态落进 fragile/struggling 并被
      // advisory 正文原样打印（2026-10-15 P0-2 实测：52 条 advisory 里 40 条正文含这类兜底词）。
      const conceptCandidates = dedupe(
        [task.linkedConceptName || task.coreConcept, ...objectiveConcepts].filter(isRealConceptKey)
      );

      for (const conceptKey of conceptCandidates) {
        const current = conceptSignals.get(conceptKey) || [];
        current.push({
          score: task.status === 'completed' ? 0.45 : task.status === 'in_progress' ? 0.25 : 0.1,
          status: task.status === 'completed' ? 'learning' : task.status === 'in_progress' ? 'learning' : 'pending',
          stability: task.status === 'completed' ? 'developing' : 'unknown',
          sourceType: 'task-label',
          taskId: task.id,
          milestoneId: milestone.id,
          pathId: path?.id,
          // 时钟域：只用业务写入的 completedAt（模拟链路经 simulatedNowOr/asOf 落模拟日）；
          // 绝不回退 Prisma @updatedAt（真墙钟基础设施列）——否则真/模拟时间混入 lastSeenAt，
          // 使延迟锚题跨域比较。无 completedAt = 无"接触"证据，宁可不记时间。
          seenAt: task.completedAt ? task.completedAt.toISOString() : undefined,
          label: conceptKey,
        });
        conceptSignals.set(conceptKey, current);
      }

      if (task.status === 'completed') {
        recentEvidence.push({
          type: 'task-completed',
          taskId: task.id,
          conceptKeys: conceptCandidates,
          signal: 'mastery',
          score: 0.5,
          happenedAt: (task.completedAt || task.updatedAt).toISOString(),
        });
      }
    }

    // 其它路径：只补 task-label 信号（用于用户级台账的存在性与排期事实），
    // 不进 currentPath 的 recentEvidence / taskMastery。
    for (const { pathId, milestone, task } of otherPathTasks) {
      const conceptCandidates = dedupe(
        [
          task.linkedConceptName || task.coreConcept,
          ...parseLearningObjectives(task.learningObjectives),
        ].filter(isRealConceptKey)
      );
      for (const conceptKey of conceptCandidates) {
        const current = conceptSignals.get(conceptKey) || [];
        current.push({
          score: task.status === 'completed' ? 0.45 : task.status === 'in_progress' ? 0.25 : 0.1,
          status: task.status === 'completed' ? 'learning' : task.status === 'in_progress' ? 'learning' : 'pending',
          stability: task.status === 'completed' ? 'developing' : 'unknown',
          sourceType: 'task-label',
          taskId: task.id,
          milestoneId: milestone.id,
          pathId,
          seenAt: task.completedAt ? task.completedAt.toISOString() : undefined,
          label: conceptKey,
        });
        conceptSignals.set(conceptKey, current);
      }
    }

    // #195（复核补修）：把「同一课双通道」的去重从**原始名字级**提到**概念身份级**。
    // 结构看板名与可靠摘要的知识点名先经注册表解析 canonical 身份（只读，createIfMissing:false，
    // 读侧绝不创建概念），名字不同但归并到同一 conceptId 的同一概念据此在会话内只计一次；
    // 解析不到身份时退回原有名字键比较（旧行为逐字兼容）。批量解析一次，避免逐条往返。
    const sessionConceptNames: string[] = [];
    for (const session of allSessions) {
      const rawKnowledgeState = parseJsonSafe<Array<{ name?: string }>>(session.knowledgeState, []);
      for (const point of rawKnowledgeState) if (point?.name) sessionConceptNames.push(point.name);
      const rawWrapup = parseJsonSafe<any>(session.wrapup, null);
      // 与下方 `summaryIsReliable` 同口径：降级摘要不进掌握证据，其知识点名也无需解析。
      if (rawWrapup?.status !== 'summary-only' && rawWrapup?.sources?.summary !== 'fallback') {
        const items = rawWrapup?.summary?.knowledgeItems;
        if (Array.isArray(items)) for (const item of items) if (item?.name) sessionConceptNames.push(item.name);
      }
    }
    const sessionIdentityByNorm = new Map<string, string>();
    if (sessionConceptNames.length > 0) {
      try {
        const resolved = await conceptRegistryService.resolveMany(input.userId, sessionConceptNames, { createIfMissing: false });
        for (const [norm, conceptId] of resolved) sessionIdentityByNorm.set(norm, conceptId);
      } catch (error) {
        logger.warn('[learner-knowledge] 会话概念身份解析失败（只读，best-effort）', {
          userId: input.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const sessionIdentityOf = (name: string | null | undefined): string | undefined => {
      const key = normalizeConceptKeyCanonical(name);
      return key ? sessionIdentityByNorm.get(key) : undefined;
    };

    for (const session of allSessions) {
      const sessionPathId = session.learningPathId ?? undefined;
      const isCurrentPath = sessionPathId === path?.id;
      const pushEvidence = (entry: LearnerRecentEvidence) => {
        globalRecentEvidence.push(entry);
        if (isCurrentPath) recentEvidence.push(entry);
      };
      const knowledgeState = parseJsonSafe<Array<{ name: string; status: 'pending' | 'learning' | 'mastered' | 'review'; progress: number }>>(
        session.knowledgeState,
        []
      );
      const wrapup = parseJsonSafe<any>(session.wrapup, null);
      const summaryPayload = wrapup?.summary || null;
      const evaluationPayload = wrapup?.evaluation || null;
      // 降级总结不得进掌握证据（#70 P-45）：summary-only / summarySource=fallback 是模板兜底产物，
      // 它的 knowledgeItems 不是模型对学习结果的判断。知识状态行（session.knowledgeState）仍保留。
      const summaryIsReliable = wrapup?.status !== 'summary-only' && wrapup?.sources?.summary !== 'fallback';
      const happenedAt = (session.endTime || session.updatedAt).toISOString();
      // 时钟域：概念"最近可见"只用会话业务结束时间 endTime（模拟链路经 simulatedNowOr 落模拟日）。
      // 会话未结束（endTime=null）时不回退 updatedAt（真墙钟）——无结束时间 = 不记 seenAt。
      const sessionSeenAt = session.endTime ? session.endTime.toISOString() : undefined;

      // #195：同一课同一概念的掌握贡献只计一次。session.knowledgeState（结构化看板）是权威源，
      // wrapup.summary.knowledgeItems（LLM 摘要）按提示词规则 6「优先复用输入 knowledgePoints 的
      // 名称/状态/progress」——二者同名时本会各推一条信号、等权落进同一个 mastery 均值（一课双计、
      // 且摘要受 ≤5 项预算截断会让同名概念权重不一致）。这里以结构化信号为准跳过同名项；
      // 摘要独有的概念在下方的「幽灵概念」判定里另行排除出掌握均值。
      // #195（复核补修）：去重键除名字外再并一层 canonical 身份（见上 `sessionIdentityOf`），
      // 覆盖「模型把看板概念改写成别名/不同写法」的名字键失配情形。
      const structuredConceptKeys = new Set<string>();
      const structuredConceptIds = new Set<string>();

      for (const point of knowledgeState) {
        const conceptKey = normalizeConceptKey(point.name);
        if (!conceptKey) continue;
        structuredConceptKeys.add(conceptKey);
        const structuredIdentity = sessionIdentityOf(point.name);
        if (structuredIdentity) structuredConceptIds.add(structuredIdentity);
        const { score, stability } = signalFromProgress(point.progress, point.status);
        const current = conceptSignals.get(conceptKey) || [];
        current.push({
          score,
          status: point.status,
          stability,
          sourceType: 'session-knowledge',
          taskId: session.taskId,
          milestoneId: session.milestoneId,
          pathId: sessionPathId,
          seenAt: sessionSeenAt,
          label: point.name,
        });
        conceptSignals.set(conceptKey, current);
      }

      if (knowledgeState.length > 0) {
      pushEvidence({
        type: 'teaching-session',
        taskId: session.taskId,
        sessionId: session.id,
        conceptKeys: knowledgeState.map((item) => item.name).filter(Boolean),
        signal: signalFromKnowledgeState(knowledgeState),
        score: knowledgeState.reduce((sum, item) => sum + item.progress, 0) / Math.max(1, knowledgeState.length) / 100,
        happenedAt,
      });
    }

      if (summaryIsReliable && Array.isArray(summaryPayload?.knowledgeItems)) {
        for (const item of summaryPayload.knowledgeItems) {
          const conceptKey = normalizeConceptKey(item?.name);
          if (!conceptKey) continue;
          // #195：本课已在结构化看板里记过的概念不再由摘要重复计一次。
          if (structuredConceptKeys.has(conceptKey)) continue;
          // #195（复核补修）：名字不同但 canonical 身份与看板某项相同（别名/改写）仍算同一概念。
          const itemIdentity = sessionIdentityOf(item?.name);
          if (itemIdentity && structuredConceptIds.has(itemIdentity)) continue;
          const score = typeof item.progress === 'number' ? clamp(item.progress / 100, 0, 1) : 0.5;
          const status = item.status === 'mastered' || item.status === 'review' || item.status === 'learning'
            ? item.status
            : 'learning';
          const current = conceptSignals.get(conceptKey) || [];
          current.push({
            score,
            status,
            stability: status === 'mastered' ? 'stable' : status === 'review' ? 'fragile' : 'developing',
            sourceType: 'derived',
            taskId: session.taskId,
            milestoneId: session.milestoneId,
            pathId: sessionPathId,
            // 与 session-knowledge 同源同口径：只认会话业务结束时间，不回退 updatedAt（真墙钟）
            seenAt: sessionSeenAt,
            label: item.name,
          });
          conceptSignals.set(conceptKey, current);
        }

        pushEvidence({
          type: 'summary',
          taskId: session.taskId,
          sessionId: session.id,
          conceptKeys: summaryPayload.knowledgeItems.map((item: any) => item?.name).filter(Boolean),
          signal: signalFromKnowledgeState(summaryPayload.knowledgeItems),
          happenedAt,
        });
      }

      if (evaluationPayload) {
        pushEvidence({
          type: 'evaluation',
          taskId: session.taskId,
          sessionId: session.id,
          conceptKeys: knowledgeState.map((item) => item.name).filter(Boolean),
          signal: resolveEvaluationSignal(evaluationPayload),
          score: typeof evaluationPayload.sessionKtl === 'number' ? clamp(evaluationPayload.sessionKtl / 10, 0, 1) : undefined,
          happenedAt,
        });
      }
    }

    // 记忆引擎 M2 读侧并轨：memory_traces 痕迹注入概念信号（sourceType: memory-trace）
    // 脆弱（stability=fragile）或低掌握（masteryScore<0.5）或高间隔因子（即将到期）→ review/fragile 信号
    //
    // ⚠️ 位置修正（2026-09-23）：本循环此前被写在上面 `for (const session of sessions)` 的**循环体内**
    // （brace 深度实测 337→409 均在会话循环里），导致两个后果：
    //   ① **门控错误**：该路径没有教学会话时，用户级痕迹信号**完全不参与**概念状态
    //      （痕迹是用户级、天然跨 path，不该被"这条路径有没有会话"门控）；
    //   ② **重复注入**：N 个会话就把同一条痕迹推 N 次。
    // 痕迹派生自 `memoryTraces`（与 session 无关），故移出到会话循环之后、与 tasks/sessions 平级。
    const traceNow = simulatedNowOr().getTime();
    for (const trace of memoryTraces) {
      const conceptKey = normalizeConceptKey(trace.conceptKey);
      if (!isRealConceptKey(conceptKey)) continue;
      // #59/#60 第 1/3 条：KT 幽灵痕（applyKtEstimate 创建、从未真正提取过）没有资格进掌握判定。
      // 它承载的是模型估计而非学习证据；此前以 masteryScore=0.3 冒充「学过一半」，直接制造 fragile。
      const isKtGhost = trace.source === 'kt-estimate' && (Number(trace.extractionCount) || 0) === 0;
      if (isKtGhost) continue;
      const mastery = trace.masteryScore ?? 0.5;
      const extractionCount = Number(trace.extractionCount) || 0;
      const lastSeenMs = trace.lastSeenAt ? new Date(trace.lastSeenAt).getTime() : null;
      const staleForgetting = lastSeenMs !== null
        && traceNow - lastSeenMs >= FRAGILE_STALE_DAYS * 86400000;
      // 低分只有在「有足够提取次数 + 已过遗忘窗口」时才算脆弱证据；否则只是「还没学完」。
      const lowMasteryWithEvidence = mastery < 0.5
        && extractionCount >= FRAGILE_MIN_EXTRACTIONS
        && staleForgetting;
      const fragile = trace.stability === 'fragile'
        || (trace.intervalFactor ?? 1) > 4
        || lowMasteryWithEvidence;
      const mastered = !fragile && (trace.stability === 'stable' || mastery >= 0.8);
      const current = conceptSignals.get(conceptKey) || [];
      current.push({
        score: trace.masteryScore ?? 0.5,
        status: mastered ? 'mastered' : fragile ? 'review' : 'learning',
        stability: mastered ? 'stable' : fragile ? 'fragile' : 'developing',
        sourceType: 'memory-trace',
        taskId: undefined,
        milestoneId: undefined,
        // 时钟域：只用记忆引擎写入的业务 lastSeenAt（simulatedNowOr 落模拟日）。
        // KT-only 痕迹（applyKtEstimate 创建）lastSeenAt=null 表示"从未提取/从未真正见过"，
        // 不回退 updatedAt（真墙钟），否则会给已掌握概念注入未来时间戳。无 lastSeenAt = 不记时间。
        seenAt: trace.lastSeenAt ? trace.lastSeenAt.toISOString() : undefined,
        label: trace.label || trace.conceptKey,
        // 概念身份（canonical）：memory_traces 写入侧已双写，直接带过来
        conceptId: trace.conceptId ?? undefined,
      });
      conceptSignals.set(conceptKey, current);
    }

    // 用户级概念状态（全部路径 + 用户级痕迹）；currentPath.conceptStates 是它的路径子集。
    const conceptStateRows = Array.from(conceptSignals.entries()).map(([conceptKey, allSignals]) => {
      const labels = allSignals.map((signal) => signal.label).filter(Boolean);
      const relatedTaskIds = Array.from(new Set(allSignals.map((signal) => signal.taskId).filter(Boolean) as string[]));
      const relatedMilestoneIds = Array.from(new Set(allSignals.map((signal) => signal.milestoneId).filter(Boolean) as string[]));
      const lastSeenAt = allSignals.reduce<string | undefined>((latest, signal) => {
        const seenAt = signal.seenAt;
        return seenAt && (!latest || seenAt > latest) ? seenAt : latest;
      }, undefined);
      // 掌握判定只认「真实接触证据」（会话知识 / 摘要 / 记忆痕迹）。任务标签（task-label）只是
      // "这条任务涉及此概念"的排期事实，不是学习证据：它给**全路径所有任务**（含 todo）推
      // 0.45/0.25/0.1 分值，一旦参与均分，"被后续未开课任务再提一次"就能把从未教过的概念
      // 拉破 0.55 落进 struggling——"没学过"被当成"没掌握"（2026-10-15 P0-2 实测：struggling
      // 名单里混着纯任务标签与 DISPLAY_LABEL_MAP 兜底词；口径与下方 prerequisiteGaps 回落
      // 过滤的「只认接触过且证据为负」一致）。只有标签信号的概念 = 未评估 → pending。
      const evidence = allSignals.filter((signal) => signal.sourceType !== 'task-label');
      // #195：仅由 LLM 摘要（derived）、无任何结构化看板 / 记忆痕迹接触证据的概念 = 幽灵概念。
      // session-wrapup 的 knowledgeItems 是模型对课堂的判断，可能造出看板里不存在的知识点。
      // 复核补修：这类概念**不再对外暴露 state**（下方 globalConceptStates / conceptStates 过滤
      // 掉 isGhost 行），因此既不入掌握均值、也不进 mastered / struggling / fragile 名单，
      // 更不会被任务级 confidence 计入（taskMastery 从 conceptStates 建倒排）。
      // 有真实接触证据（session-knowledge / memory-trace）在场时，可靠摘要仍按 #70 P-45
      // 作为补充证据参与（沿用原口径，不改 task-label/memory-trace 的既有行为）。
      const isDerivedOnly = evidence.length > 0
        && evidence.every((signal) => signal.sourceType === 'derived');
      const masteryEvidence = isDerivedOnly ? [] : evidence;

      // #59/#60 第 2 条：消灭 OR 吸收——此前任一条历史 review 会永久压住后来的 mastered。
      // 现改为「最近一条有业务时间的证据说了算」，让后来真的掌握能翻案；
      // 全部无时间戳（旧数据/测试桩）时退回保守 OR 口径（行为不变）。
      const hasReview = masteryEvidence.some((signal) => signal.status === 'review' || signal.stability === 'fragile');
      const hasMastery = masteryEvidence.some((signal) => signal.status === 'mastered' || signal.stability === 'stable');
      const hasLearning = masteryEvidence.some((signal) => signal.status === 'learning' || signal.stability === 'developing');
      const latestTimed = masteryEvidence
        .filter((signal) => typeof signal.seenAt === 'string' && signal.seenAt.length > 0)
        .sort((a, b) => String(b.seenAt).localeCompare(String(a.seenAt)))[0];

      // #195（复核补修 · 跨会话去等权）：masteryScore 与 status 同源——都取「最近一条有业务时间的
      // 证据」（同一个 latestTimed，含同一套排序与并列规则：业务时间 seenAt 字符串降序、稳定排序
      // 同时间取先入者；绝不用墙钟 occurredAt）。此前 masteryScore 是 masteryEvidence 全量信号的
      // 等权算术平均，同一概念在会话 1=0.4、会话 2=1.0 会得 0.7——与 status 的「最近一条说了算」
      // 判据不一致（旧课稀释新课），正是本条要消除的失真。无任何带业务时间的证据时（旧数据/测试桩）
      // 退回原等权均值，与上方 status 的 OR 回退口径配套，行为不变。
      const masteryScore = latestTimed
        ? clamp(latestTimed.score, 0, 1)
        : masteryEvidence.length > 0
          ? clamp(masteryEvidence.reduce((sum, signal) => sum + signal.score, 0) / masteryEvidence.length, 0, 1)
          : 0;

      const statusFromLatest: 'pending' | 'learning' | 'mastered' | 'review' | null = latestTimed
        ? latestTimed.status === 'review' || latestTimed.stability === 'fragile'
          ? 'review'
          : latestTimed.status === 'mastered' || latestTimed.stability === 'stable'
            ? 'mastered'
            : latestTimed.status === 'learning' || latestTimed.stability === 'developing'
              ? 'learning'
              : 'pending'
        : null;

      const status: 'pending' | 'learning' | 'mastered' | 'review' = statusFromLatest
        ?? (hasReview
          ? 'review'
          : hasMastery
            ? 'mastered'
            : hasLearning
              ? 'learning'
              : 'pending');

      const stability: 'unknown' | 'fragile' | 'developing' | 'stable' = status === 'review'
        ? 'fragile'
        : status === 'mastered'
          ? 'stable'
          : status === 'learning'
            ? 'developing'
            : 'unknown';

      const sourceType = evidence.some((signal) => signal.sourceType === 'session-knowledge')
        ? 'session-knowledge'
        : evidence.some((signal) => signal.sourceType === 'memory-trace')
          ? 'memory-trace'
          : evidence.some((signal) => signal.sourceType === 'derived')
            ? 'derived'
            : 'task-label';

      const state: LearnerConceptState = {
        conceptKey,
        label: labels[0] || conceptKey,
        // 概念身份（canonical）：优先取信号自带的（痕迹来源），缺失时由聚合后的统一解析补齐
        conceptId: allSignals.map((signal) => signal.conceptId).find(Boolean),
        sourceType,
        masteryScore,
        stability,
        status,
        relatedTaskIds,
        relatedMilestoneIds,
        lastSeenAt,
      };
      return { state, allSignals, isGhost: isDerivedOnly };
    });

    // #195（复核补修）：幽灵概念（仅由 LLM 摘要支撑、无结构化接触证据）不对外暴露 state——
    // globalConceptStates / conceptStates 均剔除，故 taskMastery 倒排、globalSignals 名单、
    // 确定性概念台账都不会再出现它们（task 级 confidence 也因此不再把幽灵计入）。
    const globalConceptStates: LearnerConceptState[] = conceptStateRows
      .filter((row) => !row.isGhost)
      .map((row) => row.state);
    // 当前路径视图：本路径产出的信号 + 用户级痕迹（pathId 缺省）参与过的概念；
    // 只在其它路径出现过的概念不进 currentPath（不影响 taskMastery / 前置缺口）。
    const conceptStates: LearnerConceptState[] = conceptStateRows
      .filter((row) => !row.isGhost && row.allSignals.some((signal) => signal.pathId === undefined || signal.pathId === path?.id))
      .map((row) => row.state);

    // #195（复核补修）：幽灵名此前会经 currentPath.recentEvidence[].conceptKeys 漏出（摘要证据
    // 条目原样携带 knowledgeItems 名），等于绕过上面 state 的过滤。按同一幽灵名单剔除：事件条目
    // 本身保留（它确实发生过），只去掉幽灵概念名。归一化口径与 conceptKey 一致。
    const ghostConceptKeys = new Set(
      conceptStateRows.filter((row) => row.isGhost).map((row) => row.state.conceptKey)
    );
    const stripGhostConceptKeys = (conceptKeys: string[]): string[] =>
      conceptKeys.filter((key) => {
        const normalized = normalizeConceptKey(key);
        return !normalized || !ghostConceptKeys.has(normalized);
      });

    // 概念身份补齐（只读）：来源不含痕迹的信号（会话知识/摘要/任务标签）没有 conceptId，
    // 用注册表按归一化键解析一次（`createIfMissing:false` —— **读侧绝不创建概念**）。
    // 解析失败/未命中一律留 undefined，读侧各处「conceptId 优先，空则回落 conceptKey」。
    // 身份补齐跑在用户级集合上（globalConceptStates 是 conceptStates 的超集），
    // 路径子集共享同一批 state 对象，补一次两边都生效。
    const missingIdentity = globalConceptStates.filter((state) => !state.conceptId).map((state) => state.label || state.conceptKey);
    if (missingIdentity.length > 0) {
      try {
        const resolved = await conceptRegistryService.resolveMany(input.userId, missingIdentity, { createIfMissing: false });
        if (resolved.size > 0) {
          for (const state of globalConceptStates) {
            if (state.conceptId) continue;
            state.conceptId = resolved.get(normalizeConceptKeyCanonical(state.label || state.conceptKey)) ?? undefined;
          }
        }
      } catch (error) {
        logger.warn('[learner-knowledge] 概念身份补齐失败（只读，best-effort）', {
          userId: input.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 任务→概念倒排索引（一次预构建）：taskMastery 旧口径对每个任务全量扫描 conceptStates
    // （O(任务数×概念数×includes)），现在按 taskId / conceptKey 两次 Map 命中完成匹配。
    const conceptsByTaskId = new Map<string, LearnerConceptState[]>();
    const conceptStateByKey = new Map<string, LearnerConceptState>();
    for (const concept of conceptStates) {
      conceptStateByKey.set(concept.conceptKey, concept);
      for (const taskId of concept.relatedTaskIds) {
        const list = conceptsByTaskId.get(taskId);
        if (list) list.push(concept);
        else conceptsByTaskId.set(taskId, [concept]);
      }
    }

    const taskMastery: LearnerTaskMastery[] = allTasks.map(({ milestone, task }) => {
      const objectiveConcepts = parseLearningObjectives(task.learningObjectives);
      const conceptCandidates = dedupe(
        [task.linkedConceptName || task.coreConcept, ...objectiveConcepts].filter(isRealConceptKey)
      );

      const matched = new Map<string, LearnerConceptState>();
      for (const concept of conceptsByTaskId.get(task.id) ?? []) matched.set(concept.conceptKey, concept);
      for (const key of conceptCandidates) {
        const concept = conceptStateByKey.get(key);
        if (concept) matched.set(concept.conceptKey, concept);
      }
      const matchingConcepts = Array.from(matched.values());

      const avgScore = matchingConcepts.length > 0
        ? clamp(matchingConcepts.reduce((sum, concept) => sum + concept.masteryScore, 0) / matchingConcepts.length, 0, 1)
        : task.status === 'completed'
          ? 0.5
          : task.status === 'in_progress'
            ? 0.3
            : 0.1;

      const hasFragile = matchingConcepts.some((concept) => concept.stability === 'fragile');
      const hasStable = matchingConcepts.some((concept) => concept.stability === 'stable');
      const hasDeveloping = matchingConcepts.some((concept) => concept.stability === 'developing');

      const masteryState: 'unknown' | 'learning' | 'developing' | 'stable' | 'fragile' = task.status === 'completed'
        ? hasFragile
          ? 'fragile'
          : hasStable
            ? 'stable'
            : hasDeveloping
              ? 'developing'
              : 'developing'
        : task.status === 'in_progress'
          ? 'learning'
          : 'unknown';

      return {
        taskId: task.id,
        milestoneId: milestone.id,
        title: task.title,
        status: task.status as 'todo' | 'in_progress' | 'completed',
        masteryState,
        confidence: avgScore,
        lastEvidenceAt: matchingConcepts.reduce<string | undefined>((latest, concept) => {
          const seenAt = concept.lastSeenAt;
          return seenAt && (!latest || seenAt > latest) ? seenAt : latest;
        }, undefined),
      };
    });

    const milestoneProgress = (path?.milestones ?? []).map((milestone) => {
      const tasks = taskMastery.filter((task) => task.milestoneId === milestone.id);
      const completedTasks = tasks.filter((task) => task.status === 'completed').length;
      const fragileCount = tasks.filter((task) => task.masteryState === 'fragile').length;
      const stableCount = tasks.filter((task) => task.masteryState === 'stable').length;

      const masteryState: 'unknown' | 'partial' | 'stable' | 'at-risk' = tasks.length === 0
        ? 'unknown'
        : fragileCount > 0
          ? 'at-risk'
          : stableCount >= Math.max(1, Math.ceil(tasks.length / 2))
            ? 'stable'
            : completedTasks > 0
              ? 'partial'
              : 'unknown';

      return {
        milestoneId: milestone.id,
        stageNumber: milestone.stageNumber,
        title: milestone.title,
        goal: milestone.goal,
        totalTasks: tasks.length,
        completedTasks,
        masteryState,
      };
    });

    const currentMilestone = path
      ? path.milestones.find((milestone) => milestone.id === input.milestoneId)
        || path.milestones.find((milestone) => milestone.subtasks.some((task) => task.id === input.taskId))
        || path.milestones.find((milestone) => milestone.status === 'active')
        || path.milestones[0]
      : undefined;

    const currentTask = currentMilestone?.subtasks.find((task) => task.id === input.taskId);
    const currentTaskOrder = currentTask ? currentMilestone.subtasks.findIndex((task) => task.id === currentTask.id) + 1 : undefined;

    const completedPrerequisiteTasks = allTasks
      .filter(({ milestone, task }) => {
        if (!input.taskId) return task.status === 'completed';
        if (!currentMilestone) return task.status === 'completed';
        if (milestone.stageNumber < currentMilestone.stageNumber) return task.status === 'completed';
        if (milestone.id === currentMilestone.id && currentTask && task.order < currentTask.order) return task.status === 'completed';
        return false;
      })
      .map(({ task }) => task.title)
      .slice(-5);

    // #93：globalSignals 是用户级视角（跨路径并集），不用 currentPath 子集。
    const masteredConcepts = globalConceptStates
      .filter((concept) => concept.stability === 'stable' || concept.status === 'mastered')
      .map((concept) => concept.label);
    const fragileConcepts = globalConceptStates
      .filter((concept) => concept.stability === 'fragile' || concept.status === 'review')
      .map((concept) => concept.label);
    // 卡点两档（2026-10-15 P0-2 F3/F4）：<0.55 = 卡点（名单/文案用）；<0.3 = 高严重度卡点
    //（加速/压缩这类"减法"动作的判据用——刚学完的概念天然 <0.55，只挡真没学会的）。
    const strugglingConcepts = globalConceptStates
      .filter((concept) => concept.status === 'learning' && concept.masteryScore < STRUGGLING_MASTERY_THRESHOLD)
      .map((concept) => concept.label);
    const severeStrugglingConcepts = globalConceptStates
      .filter((concept) => concept.status === 'learning' && concept.masteryScore < SEVERE_STRUGGLING_MASTERY_THRESHOLD)
      .map((concept) => concept.label);

    const currentTaskConcepts = currentTask
      ? dedupe(
          [
            currentTask.linkedConceptName || currentTask.coreConcept,
            ...parseLearningObjectives(currentTask.learningObjectives),
          ].filter(isRealConceptKey)
        )
      : [];

    // 前置缺口（L3 接入，语义修正）：
    // 旧口径算的是"**当前概念自己**没掌握"，那不是缺口——缺口是"**当前任务依赖的上游前置**没掌握"。
    // 新口径：当前任务的 canonical → 沿 prerequisite 边向上游闭包 → 取其中未掌握者。
    // **图缺失/无上游时回落旧口径**，保证未回填路径行为与改造前逐字一致。
    const graphGaps = path
      ? await buildUpstreamPrerequisiteGaps({
          userId: input.userId,
          pathId: path.id,
          currentTask: currentTask ?? null,
          conceptStates,
        })
      : [];
    const prerequisiteGaps = graphGaps.length > 0
      ? graphGaps
      : currentTaskConcepts
        .map((conceptKey) => conceptStates.find((concept) => concept.conceptKey === conceptKey || concept.label === conceptKey))
        // 只认「接触过且证据为负」的概念。反例（2026-09-29 全库实测 242/242 完课建议恒为
        // priority=high + resequence 的根因之一）：
        //   - 任务概念标签signal 会给**每个任务**（含 todo）推一条 score=0.1/status=pending 的记录，
        //     于是"这课还没上"被当成"前置没掌握"，缺口恒非空；
        //   - 上游结构里 `!state` 也曾被算缺口，等于"没见过"=没掌握。
        // status==='pending' 表示没有任何接触证据（无会话、无痕迹、无完成记录），那不是缺口，是没开始。
        .filter((concept) => concept && concept.status !== 'pending'
          && (concept.stability === 'fragile' || concept.status === 'review' || concept.masteryScore < PREREQUISITE_GAP_MASTERY_THRESHOLD))
        .slice(0, 4)
        .map((concept) => ({
          conceptKey: concept?.conceptKey || 'unknown',
          label: concept?.label || '未识别知识点',
          reason: '当前任务依赖该知识点，但历史证据显示掌握仍不稳定或掌握度偏低。',
          severity: concept?.stability === 'fragile' ? 'high' as const : 'medium' as const,
          source: 'fallback' as const,
        }));

    const currentPath: LearnerPathKnowledgeMemory | undefined = path
      ? {
          learningPathId: path.id,
          pathTitle: path.title || path.name || '未命名路径',
          pathSummary: null,
          // P1.6 落后触发器的时间判据输入：外部截止（L1 硬锚）与路径起点（时间进度分母）。
          // 无 deadline 的路径 deadline=null，判据整体不启用（行为与原先一致）。
          deadline: path.deadline ? new Date(path.deadline).toISOString() : null,
          startedAt: path.createdAt ? new Date(path.createdAt).toISOString() : null,
          progress: {
            totalMilestones: path.milestones.length,
            completedMilestones: milestoneProgress.filter((milestone) => milestone.completedTasks === milestone.totalTasks && milestone.totalTasks > 0).length,
            totalTasks: taskMastery.length,
            completedTasks: taskMastery.filter((task) => task.status === 'completed').length,
          },
          currentPosition: {
            milestoneId: currentMilestone?.id || '',
            stageNumber: currentMilestone?.stageNumber || 1,
            milestoneTitle: currentMilestone?.title || '当前阶段',
            milestoneGoal: currentMilestone?.goal,
            taskId: currentTask?.id,
            taskTitle: currentTask?.title,
            taskOrder: currentTaskOrder || 1,
            totalTasksInMilestone: currentMilestone?.subtasks.length || 0,
            completedTasksInMilestone: currentMilestone?.subtasks.filter((task) => task.status === 'completed').length || 0,
          },
          milestoneProgress,
          taskMastery,
          conceptStates,
          prerequisiteGaps,
          recentEvidence: Array.from(new Map(
            recentEvidence
              .map((item) => ({ ...item, conceptKeys: stripGhostConceptKeys(item.conceptKeys) }))
              .sort((a, b) => new Date(b.happenedAt).getTime() - new Date(a.happenedAt).getTime())
              .map((item) => [`${item.type}:${item.sessionId || item.taskId || item.happenedAt}`, item])
          ).values()).slice(0, 20),
        }
      : undefined;

    // 概念 → 出现过的路径（globalBackground 是用户级台账，sourcePaths 必须如实跨路径）。
    const pathIdsByConceptKey = new Map<string, string[]>();
    for (const [conceptKey, signals] of conceptSignals.entries()) {
      pathIdsByConceptKey.set(
        conceptKey,
        dedupe(signals.map((signal) => signal.pathId).filter(Boolean) as string[]),
      );
    }

    const deterministicConceptLedger: LearnerBackgroundConceptLedgerItem[] = globalConceptStates
      .map((concept) => {
        const familiarity: LearnerBackgroundConceptLedgerItem['familiarity'] = concept.status === 'mastered'
          ? 'stable'
          : concept.status === 'review'
            ? 'understood'
            : concept.status === 'learning'
              ? 'practiced'
              : 'seen';
        const transferReadiness: LearnerBackgroundConceptLedgerItem['transferReadiness'] = concept.stability === 'stable'
          ? 'high'
          : concept.stability === 'developing'
            ? 'medium'
            : 'low';
        const misconceptionRisk: LearnerBackgroundConceptLedgerItem['misconceptionRisk'] = concept.stability === 'fragile'
          ? 'high'
          : concept.status === 'learning'
            ? 'medium'
            : 'low';
        // 证据计数走倒排索引（label 与 conceptKey 命中的下标并集去重，等价于旧的
        // globalRecentEvidence.filter(item => conceptKeys.includes(label) || includes(key)).length）
        const evidenceCount = new Set<number>([
          ...(evidenceIndicesByKey.get(concept.label) ?? []),
          ...(evidenceIndicesByKey.get(concept.conceptKey) ?? []),
        ]).size;
        return {
          conceptKey: concept.conceptKey,
          label: concept.label,
          familiarity,
          transferReadiness,
          misconceptionRisk,
          firstSeenAt: concept.lastSeenAt,
          lastSeenAt: concept.lastSeenAt,
          sourcePaths: pathIdsByConceptKey.get(concept.conceptKey)?.length
            ? pathIdsByConceptKey.get(concept.conceptKey) as string[]
            : path ? [path.id] : [],
          sourceTasks: concept.relatedTaskIds,
          evidenceCount,
        };
      });
    // issue #156：此处旧实现 `.slice(0, 40)` 在**合并前**截断确定性台账，模型独有概念只能吃
    // 60 条里剩余的 20 个额度，且排序是任务插入序而非证据新旧。改为不截断，交给合并后的
    // 「按 lastSeenAt 排序 + slice(0,60)」（见下方 conceptLedger），口径统一为「越新越优先」。

    const deterministicConfusions: LearnerRecurringConfusion[] = fragileConcepts.slice(0, 12).map((label) => ({
      conceptKey: label,
      label,
      pattern: '近期多次出现 review / fragile 信号，后续新目标与新路径中应视为不稳定前置。',
      confidence: 0.7,
      count: struggleCountByKey.get(label) || 1,
      lastSeenAt: globalConceptStates.find((concept) => concept.label === label)?.lastSeenAt,
    }));

    const deterministicTransferSignals: LearnerTransferSignal[] = deterministicConceptLedger
      .filter((concept) => concept.transferReadiness !== 'low')
      .slice(0, 20)
      .map((concept) => ({
        conceptKey: concept.conceptKey,
        label: concept.label,
        readiness: concept.transferReadiness,
        confidence: concept.transferReadiness === 'high' ? 0.8 : 0.6,
        lastSeenAt: concept.lastSeenAt,
      }));

    // 概念身份反查表（只读、精确等值）：台账行 → 注册表 conceptId。
    // 确定性行由 **globalConceptStates** 派生（2026-10-24 修正：旧实现从路径子集 conceptStates
    // 建表，而台账行来自全局超集——只在其它路径出现过的概念即使已解析出 conceptId 也查不到
    // 身份，conceptId 优先归并静默退化为名字键），反查表必须从同一超集构建；
    // 模型行（learner_evidence payload）不带身份 → undefined = 未挂靠 → 聚合退回名字键（旧行为）。
    const conceptIdByLedgerKey = new Map<string, string>();
    for (const state of globalConceptStates) {
      if (!state.conceptId) continue;
      if (!conceptIdByLedgerKey.has(state.conceptKey)) conceptIdByLedgerKey.set(state.conceptKey, state.conceptId);
      if (state.label && !conceptIdByLedgerKey.has(state.label)) conceptIdByLedgerKey.set(state.label, state.conceptId);
    }
    const identityOfLedgerItem = (item: { conceptKey?: string | null; label?: string | null }): string | undefined =>
      (item?.conceptKey ? conceptIdByLedgerKey.get(item.conceptKey) : undefined)
      ?? (item?.label ? conceptIdByLedgerKey.get(item.label) : undefined);

    // 台账聚合：conceptId 优先归并（同一 canonical 的痕迹键/任务标签键收敛为一行），名字键兜底
    const seenMs = (value?: string): number | null => {
      if (!value) return null;
      const ms = new Date(value).getTime();
      return Number.isFinite(ms) ? ms : null;
    };
    const ledgerMap = new Map<string, LearnerBackgroundConceptLedgerItem>();
    // issue #156（复核补修）：`familiarity/transferReadiness/misconceptionRisk` 必须由**证据时间最新**
    // 的那一行决定，而不是数组位置。旧合并体把 deterministicConceptLedger 恒排在前、模型行恒在后 →
    // 模型行无条件覆盖确定性行，于是「更新的 session knowledgeState / memory_trace」反被「更旧的
    // 模型蒸馏行」改写（新课 mastered→stable 被旧课 seen 覆盖，lastSeenAt 却取新课 → 自相矛盾）。
    // 组内按 lastSeenAt 选赢家（无任何时间戳时退回数组末位 = 既有「模型行优先」口径），
    // firstSeenAt 取最早、lastSeenAt 取最晚；比较的 lastSeenAt 全部是**业务时间**（确定性行=
    // session.endTime/trace.lastSeenAt、模型行=所属会话 endTime），同源可比较，不含墙钟。
    // label/conceptKey 仍走原有身份归并口径（P1-16 契约：
    // 合并后保留模型 slug 键），集合字段两侧求并、evidenceCount 取大。
    const enrichedLedgerAsc = [...enrichedLedger].sort(
      (a, b) => (seenMs(a.lastSeenAt) ?? Number.NEGATIVE_INFINITY) - (seenMs(b.lastSeenAt) ?? Number.NEGATIVE_INFINITY),
    );
    for (const [key, group] of groupItemsByConceptIdentity<LearnerBackgroundConceptLedgerItem>(
      [...deterministicConceptLedger, ...enrichedLedgerAsc],
      identityOfLedgerItem,
    )) {
      let merged = group[0];
      let firstSeenAt = group[0].firstSeenAt;
      let lastSeenAt = group[0].lastSeenAt;
      for (let i = 1; i < group.length; i += 1) {
        const item = group[i];
        merged = {
          ...merged,
          ...item,
          sourcePaths: dedupe([...(merged.sourcePaths || []), ...(item.sourcePaths || [])]),
          sourceTasks: dedupe([...(merged.sourceTasks || []), ...(item.sourceTasks || [])]),
          evidenceCount: Math.max(merged.evidenceCount || 0, item.evidenceCount || 0),
        };
        const curFirst = seenMs(firstSeenAt);
        const itemFirst = seenMs(item.firstSeenAt);
        if (itemFirst !== null && (curFirst === null || itemFirst < curFirst)) firstSeenAt = item.firstSeenAt;
        const curLast = seenMs(lastSeenAt);
        const itemLast = seenMs(item.lastSeenAt);
        if (itemLast !== null && (curLast === null || itemLast > curLast)) lastSeenAt = item.lastSeenAt;
      }
      // 赢家：时间戳最大者；并列取数组靠后者（保持「无时间戳时模型行优先」的既有口径）。
      let winner = group[group.length - 1];
      for (const item of group) {
        const winnerLast = seenMs(winner.lastSeenAt);
        const itemLast = seenMs(item.lastSeenAt);
        if (itemLast !== null && (winnerLast === null || itemLast >= winnerLast)) winner = item;
      }
      merged = {
        ...merged,
        familiarity: winner.familiarity ?? merged.familiarity,
        transferReadiness: winner.transferReadiness ?? merged.transferReadiness,
        misconceptionRisk: winner.misconceptionRisk ?? merged.misconceptionRisk,
        firstSeenAt,
        lastSeenAt,
      };
      ledgerMap.set(key, merged);
    }
    // issue #156：确定性台账此前在合并前就 slice(0,40)，模型独有概念只能吃 60 条里剩余的额度，
    // 且排序是任务插入序而非证据新旧。改为先合并、再按 lastSeenAt（越新越靠前）排序截断到 60
    // ——注意：无 lastSeenAt 的行排在最末，>60 时可能被挤出（旧实现靠 slice(0,40) 保确定性行）。
    const conceptLedger = Array.from(ledgerMap.values())
      .sort((a, b) => (seenMs(b.lastSeenAt) ?? Number.NEGATIVE_INFINITY) - (seenMs(a.lastSeenAt) ?? Number.NEGATIVE_INFINITY))
      .slice(0, 60);

    // 反复误解聚合：与台账同口径（conceptId 优先归并，名字键兜底；pattern 同样取最新证据）
    const confusionMap = new Map<string, LearnerRecurringConfusion>();
    const enrichedConfusionsAsc = [...enrichedConfusions].sort(
      (a, b) => (seenMs(a.lastSeenAt) ?? Number.NEGATIVE_INFINITY) - (seenMs(b.lastSeenAt) ?? Number.NEGATIVE_INFINITY),
    );
    for (const [key, group] of groupItemsByConceptIdentity<LearnerRecurringConfusion>(
      [...deterministicConfusions, ...enrichedConfusionsAsc],
      identityOfLedgerItem,
    )) {
      let merged = group[0];
      let lastSeenAt = group[0].lastSeenAt;
      for (let i = 1; i < group.length; i += 1) {
        const item = group[i];
        merged = {
          ...merged,
          ...item,
          confidence: Math.max(merged.confidence || 0, item.confidence || 0),
          count: Math.max(merged.count || 0, item.count || 0),
        };
        const curLast = seenMs(lastSeenAt);
        const itemLast = seenMs(item.lastSeenAt);
        if (itemLast !== null && (curLast === null || itemLast > curLast)) lastSeenAt = item.lastSeenAt;
      }
      // issue #156：pattern 同样取最新证据、lastSeenAt 取 max，别停在旧课。
      let winner = group[group.length - 1];
      for (const item of group) {
        const winnerLast = seenMs(winner.lastSeenAt);
        const itemLast = seenMs(item.lastSeenAt);
        if (itemLast !== null && (winnerLast === null || itemLast >= winnerLast)) winner = item;
      }
      confusionMap.set(key, {
        ...merged,
        pattern: winner.pattern ?? merged.pattern,
        lastSeenAt,
      });
    }
    const recurringConfusions = Array.from(confusionMap.values()).slice(0, 20);

    // 迁移信号聚合：与台账同口径（conceptId 优先归并，名字键兜底；组内仍按置信度/就绪度取优替换）
    const readinessRank = { low: 0, medium: 1, high: 2 } as const;
    const transferMap = new Map<string, LearnerTransferSignal>();
    for (const [key, group] of groupItemsByConceptIdentity<LearnerTransferSignal>(
      [...deterministicTransferSignals, ...enrichedTransferSignals],
      identityOfLedgerItem,
    )) {
      let merged = group[0];
      for (let i = 1; i < group.length; i += 1) {
        const item = group[i];
        if ((item.confidence || 0) > merged.confidence || readinessRank[item.readiness] > readinessRank[merged.readiness]) {
          merged = item;
        }
      }
      transferMap.set(key, merged);
    }
    const transferSignals = Array.from(transferMap.values()).slice(0, 30);

    const globalBackground: LearnerGlobalBackgroundKnowledge = {
      conceptLedger,
      recurringConfusions,
      reusableFoundations: dedupe([
        ...conceptLedger.filter((concept) => concept.transferReadiness === 'high').map((concept) => concept.label),
        ...enrichedReusableFoundations
      ]).slice(0, 20),
      blockedFoundations: dedupe([
        ...conceptLedger.filter((concept) => concept.misconceptionRisk === 'high').map((concept) => concept.label),
        ...enrichedBlockedFoundations
      ]).slice(0, 20),
      transferSignals,
      ...(enrichedKnowledgeStateSummary ? { knowledgeStateSummary: enrichedKnowledgeStateSummary } : {}),
    };

    return {
      ...(currentPath ? { currentPath } : {}),
      globalSignals: {
        masteredConcepts,
        fragileConcepts,
        strugglingConcepts,
        severeStrugglingConcepts,
      },
      globalBackground,
    };
  }
}

export const learnerKnowledgeMemoryService = new LearnerKnowledgeMemoryService();
