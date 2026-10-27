/**
 * 阶段任务设计（Anderson enrichment）执行体（架构审计 §5 行动 #2：learning.service.ts 拆分——生成域）
 *
 * 职责：认领 stageDesign run → 并发（限 2 路）逐阶段 stage-designer 生成任务 →
 * KC 映射（kc-mapper，best-effort）→ 事务落库子任务与估时回写 → 事件发出。
 * 追加模式（appendOnly）只对空白阶段生成，不删除/覆盖既有任务。
 * 行为与拆分前 learning.service 同名私有方法逐一等价（P1-8 事务事故即发生在此链路，
 * 事务统一走 withTransaction 封装）。
 */
import prisma from '../../../config/database';
import { logger } from '../../../utils/logger';
import { withTransaction } from '../../../utils/with-transaction';
import { executeSkill } from '../../../skills';
import { getRequestContext, runWithContext } from '../../../gateway/api-gateway/context';
import { stageDesignerDefinition } from '../../../skills/stage-designer';
import {
  clampHintsToOneSitting,
  clampStageMinutesToBudget,
  clampStageTasksToHints,
  ONE_SITTING_MAX_HOURS,
  orderStageTasksByTopology,
  remapStageTaskReferences,
} from '../path-planning-hints';
import {
  appendDescriptionNote,
  buildPathFillNote,
  reconcileDeliveryConservation,
} from './path-fill-note';
import { auditStageBudget } from './stage-budget-invariant';
import { auditGeneratedPath, reorderStageTasks } from './path-structure-integration';
import { sanitizeUserFacingText } from '../user-facing-text';
import { detectStageFiller, isStageFiller, detectCrossStageFiller, isCrossStageFiller } from './stage-filler';
import { buildSupplementRequest, mergeSupplementTasks, needsLessonSupplement } from './stage-task-supplement';
import {
  supplementZeroRefStage,
  createZeroRefSupplementGate,
  type ZeroRefSupplementAudit,
} from './stage-material-supplement';
import { schoolAnchorCoverage, type PathSchoolAnchor } from './school-anchor';
import { buildAnchorGoalNote } from './school-anchor-goal';
import { mapAndPersistKcAnnotation, mergeKcStageAnnotation, type KcAnnotation } from './kc-annotation';
import { assembleStageDesignerChannels } from '../../field-dispatcher';
import { extractPromptMaterials, STAGE_MATERIAL_LIMITS, collectMaterialSectionRefs } from '../../materials/material-prompt-projection';
import { buildSectionSemanticOrder } from '../../materials/material-semantic-order';
import { summarizeSectionRefPositions, assessMaterialCoverage } from '../../materials/material-refs';
import type { PreviousStageOutcome } from './progressive-design';
import {
  assertGenerationRunFence,
  assertStageTasksPresent,
  calculateStageProgress,
} from '../path-generation-status';
import { assertPathMutationSafe, isPathMutationConflictError } from '../path-mutation-safety';
import { conceptRegistryService } from '../../learner/concept-registry.service';
import { conceptGraphService } from '../../learner/concept-graph.service';
import { normalizeConceptKey } from '../../memory/concept-key';
import {
  buildConceptMap,
  generateDisplayLabel,
  getSceneFramingNormalizedInput,
  normalizePathTaskType,
  parsePathCognitiveDesign,
  parsePathPromptTemplate,
  resolvePersistedNormalizedInput,
  resolveTaskConcept,
} from '../learning.helpers';
import type { GeneratePathData } from '../learning.types';
import { createDomainEvent } from '../../../events/contracts';
import { enqueueDomainEvent } from '../../../events/outbox.repository';
import { dashboardGuidanceSnapshotService } from '../../learner/DashboardGuidanceSnapshotService';
import {
  claimQueuedGenerationRun,
  failGenerationRun,
  getActiveGenerationRun,
  heartbeatGenerationRun,
  recordPathGenerationStageLog,
  restorePathAfterMutationConflict,
  startGenerationHeartbeat,
  updatePathGenerationStatus,
  createGenerationId,
} from './run-lifecycle';
import { listEmptyMilestoneIds } from './retry-policy';

/** 只依赖 deleteMany 的最小客户端面（便于单测注入假实现） */
export interface StageItemPruneClient {
  path_generation_stage_items: {
    deleteMany: (args: {
      where: { run: { learningPathId: string }; runId: { not: string } };
    }) => Promise<unknown>;
  };
}

/**
 * 清理被取代 run 遗留的 stage items（重试不留脏行）。
 *
 * 背景：`path_generation_stage_items` 的唯一约束是 `[runId, stageNumber]`，
 * 而一次 stageDesign 失败后重试会产生**新的 runId**，两轮的 stage items 并存 ⇒
 * 同阶段出现互相矛盾的状态行（`succeeded/4` 与 `succeeded/6`）与永不解决的
 * `processing/0` 废弃行（实测 74 个「路径×阶段」组合、20/118 条路径受影响）。
 *
 * 语义：replace 模式下本轮 run 取代此前所有尝试，故清掉非本轮 run 的行
 * （与 `path-generation.core.ts` 的孤儿清理同口径）；
 * **append 模式不清**——其行是既有阶段的追加记录，不是被取代的尝试。
 */
export async function pruneSupersededStageItems(
  client: StageItemPruneClient,
  pathId: string,
  runId: string,
  options: { appendOnly?: boolean } = {},
): Promise<number> {
  if (options.appendOnly) return 0;
  const result: any = await client.path_generation_stage_items.deleteMany({
    where: { run: { learningPathId: pathId }, runId: { not: runId } },
  });
  return Number(result?.count) || 0;
}

/**
 * not_judgeable 验收越界检测（2026-10-26 外部评审悖论/吉他 5 条越界实证）。
 * 词表只抓「要求确认声音/动作属性达标」的判据形态，不抓「描述练习事实 + 自述归因」
 * （「反复出现闷音，判断问题出在指法」是合法自述；「声音清晰无闷响」才是越界达标断言）。
 * 保守优先：误伤的代价只是多一次修复重调，漏检的代价是下游判官永远放水。
 */
const UNJUDGEABLE_ACCEPTANCE_RE = new RegExp(
  [
    '声音清晰', '无闷响', '没有闷音', '不出现闷音', '无杂音', '没有杂音',
    '听不出', '看不出', '录回来听', '录下来听', '回放听',
    '[弹画唱吹跳奏拉]得?(干净|清晰|标准|到位|准确|流畅|均匀|稳定|好听)',
    '(手型|指法|姿势|握拍|握笔|动作|坐姿|站姿)(正确|标准|到位|规范|标准)',
    '逐根拨响', '逐根发声', '都能发声', '都能按响', '能按响', '能拨响',
    '节奏稳', '不抢拍', '不拖拍', '音准',
  ].join('|'),
);

export interface UnjudgeableAcceptanceViolation {
  taskTitle: string;
  acceptanceHint: string;
  matchedTerms: string[];
}

export function detectUnjudgeableAcceptance<T extends Record<string, unknown>>(tasks: T[]): UnjudgeableAcceptanceViolation[] {
  const violations: UnjudgeableAcceptanceViolation[] = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const hint = typeof task?.acceptanceHint === 'string'
      ? task.acceptanceHint
      : typeof task?.acceptanceCriteria === 'string'
        ? String(task.acceptanceCriteria)
        : '';
    if (!hint) continue;
    const matchedTerms = (hint.match(new RegExp(UNJUDGEABLE_ACCEPTANCE_RE.source, 'g')) || [])
      .filter((term, index, all) => all.indexOf(term) === index);
    if (matchedTerms.length > 0) {
      violations.push({
        taskTitle: String(task?.title || ''),
        acceptanceHint: hint,
        matchedTerms,
      });
    }
  }
  return violations;
}

export async function enrichLearningPathWithAnderson(
  pathId: string,
  runId: string,
  data: GeneratePathData,
  analysis: any,
  options: {
    appendOnly?: boolean;
    /** 渐进式（批次 D）：restrict 到指定阶段（stage N 完成后只设计 N+1）；
     * true 时 designer 输入带学习者信号、kc 走增量合并、template 记 _generation.progressive。
     */
    progressive?: boolean;
    restrictMilestoneIds?: string[];
    previousStageOutcome?: PreviousStageOutcome | null;
  } = {}
): Promise<void> {
  // 【A/B 归因修复 2026-10-01】后台生成链路原本没有 userId 请求上下文 → callPrompt 的
  // 变体分流键缺失（恒走基线，实测 44% stage-designer 调用如此）且 prompt_call_logs.userId
  // 空缺。此处用路径属主补齐上下文（保留既有字段），stage-designer/kc-mapper/补课全部继承。
  return runWithContext({ ...getRequestContext(), userId: data.userId }, () =>
    enrichLearningPathWithAndersonInner(pathId, runId, data, analysis, options)
  );
}

async function enrichLearningPathWithAndersonInner(
  pathId: string,
  runId: string,
  data: GeneratePathData,
  analysis: any,
  options: {
    appendOnly?: boolean;
    /**
     * 渐进式（批次 D）：restrict 到指定阶段（stage N 完成后只设计 N+1）；
     * true 时 designer 输入带学习者信号、kc 走增量合并、template 记 _generation.progressive。
     */
    progressive?: boolean;
    restrictMilestoneIds?: string[];
    previousStageOutcome?: PreviousStageOutcome | null;
  } = {}
): Promise<void> {
  const startTime = Date.now();
  const triggerSource = data.sourceConversationId ? 'goal-conversation' : 'api';
  const progressive = options.progressive === true;
  let stopHeartbeat = () => undefined;
  let inFlightStageItemIds: Set<string> | null = null;

  try {
    const persistedRun = await getActiveGenerationRun(pathId, runId);
    const run = persistedRun?.phase === 'stageDesign'
      ? persistedRun.status === 'queued'
        ? await claimQueuedGenerationRun(pathId, runId)
        : persistedRun
      : null;
    if (!run || run.status !== 'processing') throw new Error('GENERATION_RUN_FENCED');
    // 追加模式：只对"空白阶段"生成任务（不删除、不覆盖）→ 走 append-tasks 契约。
    const appendOnly = options.appendOnly === true;
    // 渐进 restrict（批次 D）：显式指定目标阶段（跳过 listEmptyMilestoneIds 的全量空白枚举——
    // 渐进语义是「到哪设计哪」，不是「一次补齐所有空白」）。仍过滤掉非空阶段防御重复设计。
    const restrictMilestoneIds = Array.isArray(options.restrictMilestoneIds) ? options.restrictMilestoneIds : null;
    let appendMilestoneIds = appendOnly ? await listEmptyMilestoneIds(pathId) : [];
    if (restrictMilestoneIds) {
      const emptySet = new Set(appendOnly ? appendMilestoneIds : await listEmptyMilestoneIds(pathId));
      appendMilestoneIds = restrictMilestoneIds.filter((id) => emptySet.has(id));
    }
    if (appendOnly && appendMilestoneIds.length === 0) throw new Error('PATH_APPEND_NO_EMPTY_STAGE');
    await assertGenerationRunFence(prisma, pathId, runId);
    await assertPathMutationSafe(
      prisma,
      pathId,
      appendOnly ? 'append-tasks' : 'replace-tasks',
      appendOnly ? { milestoneIds: appendMilestoneIds } : {}
    );
    // 重试不留脏行：replace 语义下本轮 run 取代此前所有 stageDesign 尝试，
    // 但 stage items 的唯一约束是 [runId, stageNumber]，两轮 runId 不同故并存——
    // 导致同阶段出现互相矛盾的状态行（succeeded/4 与 succeeded/6）与永不解决的
    // processing/0 废弃行（实测 74 个「路径×阶段」组合、20/118 条路径受影响）。
    // 与 path-generation.core.ts 的孤儿清理同口径。
    await pruneSupersededStageItems(prisma, pathId, runId, { appendOnly });
    stopHeartbeat = startGenerationHeartbeat(pathId, runId);

    await recordPathGenerationStageLog({
      userId: data.userId,
      pathId,
      sourceConversationId: data.sourceConversationId,
      triggerSource,
      phase: 'stageDesign',
      status: 'started',
      input: { goal: data.description }
    });

    await updatePathGenerationStatus(pathId, {
      stageDesign: 'processing',
      lastError: null,
      sourceConversationId: data.sourceConversationId || null,
      triggerSource,
      updatedAt: new Date().toISOString()
    }, runId);

    logger.info('开始阶段任务设计...', { userId: data.userId, pathId });

    const learningPath = await prisma.learning_paths.findUnique({
      where: { id: pathId },
      include: {
        milestones: {
          orderBy: { stageNumber: 'asc' },
          include: {
            subtasks: {
              orderBy: { order: 'asc' }
            }
          }
        }
      }
    });

    if (!learningPath) {
      throw new Error('PATH_ENRICHMENT_TARGET_NOT_FOUND');
    }
    if (appendOnly || restrictMilestoneIds) {
      // 追加/渐进 restrict：只处理目标阶段，其余阶段一概不碰（不删除、不覆盖任何既有任务）。
      learningPath.milestones = learningPath.milestones.filter(
        (milestone) => appendMilestoneIds.includes(milestone.id)
      );
      if (learningPath.milestones.length === 0) throw new Error('PATH_APPEND_NO_EMPTY_STAGE');
    }
    if (learningPath.milestones.length === 0) {
      throw new Error('PATH_STAGE_DESIGN_HAS_NO_STAGES');
    }
    await heartbeatGenerationRun(pathId, runId, {
      totalItems: learningPath.milestones.length,
      completedItems: 0,
      progress: 0
    });

    const pathCognitiveDesign = parsePathCognitiveDesign(learningPath.aiPromptTemplate || null);
    const parsedTemplate = parsePathPromptTemplate(learningPath.aiPromptTemplate || null);
    const sceneFraming = parsedTemplate?.sceneFraming && typeof parsedTemplate.sceneFraming === 'object'
      ? parsedTemplate.sceneFraming
      : null;
    const normalizedInput = getSceneFramingNormalizedInput(sceneFraming)
      || resolvePersistedNormalizedInput(parsedTemplate)
      || null;
    // 出口不变量 B 的**下游一半**（2026-09-21）：Path 层已自检为"一次性操作"时，
    // 它产出的路径总量 ≤ 1 小时（见 path-planning 的"一次性操作"规则）。若不在这里
    // 把 hints 一起收紧，stage-designer 会按 standard 档默认 30–90 分钟/任务把学时撑回 7 小时
    // ——「学时 = 阶段数 × 每段任务数 × 单任务分钟」这条链必须两端都收。
    const oneSittingPath = Number.isFinite(Number(learningPath.estimatedHours))
      && Number(learningPath.estimatedHours) > 0
      && Number(learningPath.estimatedHours) <= ONE_SITTING_MAX_HOURS;
    if (oneSittingPath && normalizedInput && (normalizedInput as any).planningHints) {
      const before = (normalizedInput as any).planningHints;
      (normalizedInput as any).planningHints = clampHintsToOneSitting(before);
      logger.info('[stage-enrichment] 一次性操作：hints 收紧到一节课量级', {
        pathId: learningPath.id,
        estimatedHours: learningPath.estimatedHours,
        milestoneRange: (normalizedInput as any).planningHints.milestoneRange,
        subtasksPerStageRange: (normalizedInput as any).planningHints.subtasksPerStageRange,
        subtaskMinutesRange: (normalizedInput as any).planningHints.subtaskMinutesRange,
      });
    }
    const stageDesignerBaseInput = {
      cognitiveCore: pathCognitiveDesign,
      normalizedInput,
      // 终点交付物与验收口径（2026-10-03 审计模式1 实证：真实交付任务占比 0.5-8.3%，
      // 「每阶段 1-2 个真实交付物」规则因模型看不见终点而执行率低）：把 goal 确认提案的
      // firstDeliverable 与 successCriteria 注入每个阶段的调用——不是只有首阶段规则 52 用它，
      // 后续阶段做中间产出/验收演练时同样需要对着终点校准。
      firstDeliverable: (normalizedInput as any)?.confirmedProposal?.firstDeliverable || null,
      successCriteria: (normalizedInput as any)?.successCriteria || null,
      // 资料 → 任务（下游 learn 的第一段）：把附件/联网资料**投影后**交给 stage-designer，
      // 让任务长在资料的具体章节/条目上，而不是只长在里程碑标题上。
      ...(extractPromptMaterials(normalizedInput, STAGE_MATERIAL_LIMITS)
        ? { materials: extractPromptMaterials(normalizedInput, STAGE_MATERIAL_LIMITS) }
        : {}),
    };
    const stageDesignRawOutputs: Record<string, any> = {};
    // 资料覆盖审计（2026-10-17）：每阶段「几条引用、覆盖到第几节」。
    // 20 goal 复核发现 cpa/mbsr 的末阶段有资料却零引用，而旧日志只在有引用时输出，
    // 缺口完全不可见。这里落进模板 _generation.materialCoverage，供运维/复算直接读取。
    const stageMaterialAudit: Array<{
      stageNumber: number;
      refs: number;
      minSection: number | null;
      maxSection: number | null;
      /**
       * 里程碑级引用数（#119 口径拆分，2026-10-20）。
       * `refs` 只数**任务级**（subtasks[].materialRefs）——零引用守卫/补课的对象就是它；
       * 而「后半引用」「refPct」等度量把里程碑级也算进 combinedRefs，
       * 两条口径此前混用（20 goal 实测 task=233 / combined=338，zeroRef 3 vs 0）。
       * 两个数字都落库，引用时必须写明 refScope。
       */
      milestoneRefs: number;
      combinedRefs: number;
      /** 本字段的 refs 口径：固定为任务级。 */
      refScope: 'task';
      /** 零引用补课结果（#119 优化项 1）：仅在该阶段首轮零引用时出现。 */
      materialSupplement?: ZeroRefSupplementAudit;
    }> = [];
    // 零引用补课闸（#119 优化项 1）：run 作用域共享，本次路径生成最多 1 次补课调用
    //（阶段设计并发 2 路，取闸是同步 check-and-set，先到先得——闸是路径级预算；
    // 全量生成=每路径 1 次；渐进/追加每次 run 各有一份额度）。
    const zeroRefSupplementGate = createZeroRefSupplementGate();
    const stageDesignOutputs: Array<{
      milestoneId: string;
      stageNumber: number;
      subtasks: any[];
    }> = [];
    let designedTaskCount = 0;

    // 校内锚（2026-09-30 维度 G 评审 → 用户拍板改 LLM 口径）：锚由 goal-conversation 的
    // understanding.school_anchor（模型自己判断学习者是否身处某套教材/考试体系）经定帧层
    // 透传到这里；非校内学习者该键不出现，stage-designer 行为与原先完全一致。
    const pathSchoolAnchor = (normalizedInput as any)?.schoolAnchor
      ? ((normalizedInput as any).schoolAnchor as PathSchoolAnchor)
      : null;
    let anchorGoalNotes = 0;
    if (pathSchoolAnchor) {
      logger.info('[school-anchor] 校内锚已解析，注入 stage-designer', {
        runId,
        textbook: pathSchoolAnchor.textbook,
        hasExamScope: !!pathSchoolAnchor.examScope,
        hasPace: !!pathSchoolAnchor.schoolPace,
      });
    }

    // 阶段任务设计并发度：2026-10-26 起固定为 1（串行）——外部评审悖论1实证：
    // 上一阶段真实任务清单（previousMilestone.tasks）只有在前一阶段**完成后**才存在，
    // 并行批次里 Stage 2 拿不到 Stage 1 的产物，跨阶段衔接/去重规则形同虚设
    // （power-train 三阶段连排「下周强度表」即此因）。单阶段 10-90 秒，串行总时长
    // ≈ 阶段数 × 单阶段时长，可接受；进度心跳照常逐阶段上报。
    const STAGE_DESIGN_CONCURRENCY = 1;
    inFlightStageItemIds = new Set<string>();
    let completedStageCount = 0;
    // 已完成阶段的任务摘要（按 stageIndex，2026-10-26 幽灵通道修复）：提示词规则 13 承诺
    // 「上一阶段的产物作为本阶段首个操作任务的输入上下文」，但代码从未注入过任务清单
    // （旧 previousMilestone 只有 title/coreConcept 两个骨架字段，previousMilestoneContext
    // 这个键在代码里根本不存在）——跨阶段衔接与去重规则长期空转。串行下 Stage N 完成后
    // 存摘要，Stage N+1 注入 previousMilestone.tasks。
    const stageTaskSummaries = new Map<number, Array<{ title: string; type: string | null; estimatedMinutes: number | null }>>();

    /**
     * 逐阶段任务锚（2026-09-28 去等分）：按**本阶段实际学时**反推该阶段该出几个任务，
     * 注入 planningHints.targetSubtasksForStage（stage-designer 规则 8 优先采用）。
     * 全局 targetSubtasksPerStage 按总学时均摊，配合「恰好 N 课」强规则会把路径切成
     * 5×10 式等分（真实案例：90h 预算 → 5×10，且单课分钟被扩容块顶穿会话档）。
     * 锚分钟取 targetMinutesPerTask（已被会话档钳过），缺省退分钟上界 / 60。
     */
    const buildStageHints = (milestone: { estimatedHours: number | null }): any | null => {
      const baseHints = (normalizedInput as any)?.planningHints || null;
      if (!baseHints) return null;
      const stageHours = Number(milestone.estimatedHours);
      if (!Number.isFinite(stageHours) || stageHours <= 0) return { ...baseHints };
      const anchorMinutes = Number(baseHints.targetMinutesPerTask)
        || Number(baseHints.subtaskMinutesRange?.[1])
        || 60;
      const cap = Number(baseHints.subtasksPerStageRange?.[1]) || 14;
      const stageAnchorMinutes = Math.round(stageHours * 60);
      // 阶段分钟上界（2026-10-25 方向改造：uqcit3l 实证承诺为顶把 target 压到 2h 后，
      // 阶段锚 0.6h/36 分钟仍被 max(2,...) 抬成 2 个任务 × 30 分钟 = 60 分钟（1.67×），
      // 四阶段累计 227 分钟 vs 计划 132 分钟，承诺在 stageDesign 层二次违约）。
      // 传给 stage-designer 一个显式上限：本阶段任务分钟总和不得超过阶段锚的 1.25 倍
      // （超出部分说明该阶段装不下，应减任务/缩分钟，而不是把承诺撑破）。
      const targetSubtasks = Math.max(2, Math.min(cap, Math.round(stageAnchorMinutes / anchorMinutes)));
      // 预算下限必须 ≥ 最小任务数 × 单任务下限，否则「预算比最小任务量还小」——
      // 模型只能二选一：超预算或把任务缩到不可执行（2026-10-26 迭代 2 实证 phil-sci：
      // 阶段锚 0.5h → 预算 20 分钟，但 2 个任务 × 9 分钟下限 = 18 分钟起，
      // 模型给 2×15=30 分钟即超预算 50%，最终实排/标称比值掉到 0.51）。
      const minTaskMinutes = Number(baseHints.subtaskMinutesRange?.[0]) || 9;
      const stageMinutesBudget = Math.max(
        Math.round(stageAnchorMinutes * 1.25),
        targetSubtasks * minTaskMinutes,
      );
      return {
        ...baseHints,
        targetSubtasksForStage: targetSubtasks,
        stageMinutesBudget,
      };
    };

    const processStageDesign = async (stageIndex: number): Promise<void> => {
      const milestone = learningPath.milestones[stageIndex];
      const stageStartedAt = new Date();
      const stageItemId = createGenerationId('pgsi');
      inFlightStageItemIds.add(stageItemId);
      await prisma.path_generation_stage_items.create({
        data: {
          id: stageItemId,
          runId,
          milestoneId: milestone.id,
          stageNumber: milestone.stageNumber,
          status: 'processing',
          heartbeatAt: stageStartedAt,
          startedAt: stageStartedAt
        }
      });
      const previousMilestone = stageIndex > 0 ? learningPath.milestones[stageIndex - 1] : null;
      // 配置式跨轮上下文（第三条链）：routings 表 path-agent 注入行抽值优先，回退手拼
      const { channels: designerChannels, skipped: designerSkipped } =
        await assembleStageDesignerChannels({
          previousMilestone: previousMilestone ? {
            stageNumber: previousMilestone.stageNumber,
            title: previousMilestone.title,
            coreConcept: previousMilestone.coreConceptId || null,
          } : null,
        }).catch(() => ({ channels: {}, skipped: [] }));
      if (designerSkipped.length > 0) {
        logger.warn('[path-generation] stage-designer channels skipped (config-driven extraction)', {
          runId,
          milestoneId: milestone.id,
          skipped: designerSkipped,
        });
      }
      // 逐阶段任务锚（2026-09-28 去等分）：按本阶段实际学时反推 targetSubtasksForStage，
      // 替换共享 baseInput 里的全局 planningHints（全局锚按总学时均摊 + 「恰好 N 课」规则
      // = 5×10 式等分的来源）。clamp 用同一份逐阶段 hints，保证锚与硬上界一致。
      const stageHints = buildStageHints(milestone);
      const stageNormalizedInput = stageHints && (normalizedInput as any)
        ? { ...(normalizedInput as any), planningHints: stageHints }
        : normalizedInput;
      // 资料章节按阶段位次分配（2026-10-17）：任务层每阶段只带 8 段，此前恒取前 8 段 ⇒
      // 24 章节的包里后 2/3 永远不可见，路径引用恒落原文前部（20 goal A/B：后半引用 9%）。
      // 按阶段位次切连续窗口：首阶段看头、末阶段看尾，整条路径才有机会覆盖全文。
      const materialWindow = {
        stageNumber: milestone.stageNumber,
        stageCount: learningPath.milestones.length,
      };
      // 窗口内语义排序（#119 优化项 2）：只重排同一窗口里的顺序（成员/数量不变），
      // 实证依据=现有引用语义分位 0.54–0.69、模型偏爱先出现的资料。
      // fail-open：embedding 不可用/报错/章节不足时返回 null，按原顺序喂（生成链不受影响）。
      // kill switch：STAGE_MATERIAL_SEMANTIC_ORDER=0。
      let stageSectionOrder: Map<string, number> | null = null;
      if (process.env.STAGE_MATERIAL_SEMANTIC_ORDER !== '0') {
        try {
          const refs = collectMaterialSectionRefs(normalizedInput);
          if (refs.length >= 2) {
            stageSectionOrder = await buildSectionSemanticOrder({
              query: [milestone.title, milestone.goal, milestone.description]
                .map((part) => String(part || '').trim())
                .filter(Boolean)
                .join('；'),
              sections: refs,
            });
          }
        } catch (error) {
          // buildSectionSemanticOrder 自身已 fail-open；这里兜底防将来改动把异常抛出来打断生成
          logger.warn('[path-generation] 阶段资料语义排序失败（按原位次继续）', {
            runId,
            milestoneId: milestone.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const stageMaterials = extractPromptMaterials(
        normalizedInput,
        STAGE_MATERIAL_LIMITS,
        materialWindow,
        stageSectionOrder,
        // 覆盖约束的语义重排（#119 优化项 3，2026-10-19）：候选放开到全文、
        // 按「窗口分布三分位配额（前/中/后各≥1）+ 语义名次」选节——引用语义分位向窗口内上限
        // 靠拢的同时，后半覆盖不低于窗口方案。fail-open：无名次映射（embedding 不可用）时
        // 自动退回窗口切片路径。kill switch：STAGE_MATERIAL_QUOTA_RERANK=0。
        process.env.STAGE_MATERIAL_QUOTA_RERANK !== '0'
      );
      const stageDesignerInput = {
        milestone: {
          stageNumber: milestone.stageNumber,
          title: milestone.title,
          coreConcept: milestone.coreConceptId || null,
          description: milestone.description || null,
          goal: milestone.goal || null,
          estimatedHours: milestone.estimatedHours || null,
        },
        ...(designerChannels['previousMilestone'] || previousMilestone ? {
          previousMilestone: designerChannels['previousMilestone'] || (previousMilestone ? {
            stageNumber: previousMilestone.stageNumber,
            title: previousMilestone.title,
            coreConcept: previousMilestone.coreConceptId || null,
            // 幽灵通道修复（2026-10-26）：上一阶段真实任务清单（串行生成后才存在）。
            // 提示词规则 13 的「previousMilestoneContext」从来不存在，跨阶段衔接/去重
            // 规则此前只能靠阶段标题猜；现在首操作任务能真正「用上一阶段刚产出的东西」。
            ...(stageTaskSummaries.get(stageIndex - 1) ? { tasks: stageTaskSummaries.get(stageIndex - 1) } : {}),
          } : null),
        } : {}),
        ...stageDesignerBaseInput,
        ...(stageMaterials ? { materials: stageMaterials } : {}),
        normalizedInput: stageNormalizedInput,
        // 全路径阶段地图（2026-10-03 A/B 审计实证：stage-designer 逐阶段调用只见当前阶段，
        // 「真实动作前两个阶段」「跨阶段去重」类规则因看不见全局而无法执行——
        // 前置真实动作任务占比 A/B 实测 0.3%→1.4% 几乎未动）。注入全部阶段标题与当前位次，
        // 让单阶段调用具备全局视野；数据来自内存中的 milestones，无额外查询。
        pathStageMap: {
          stageCount: learningPath.milestones.length,
          currentStageNumber: milestone.stageNumber,
          stages: learningPath.milestones.map((m) => ({
            stageNumber: m.stageNumber,
            title: m.title,
            estimatedHours: m.estimatedHours || null,
          })),
        },
        // 全部前序阶段任务标题（2026-10-27 R1 夜批实证：previousMilestone.tasks 只给上一阶段，
        // 阶段 N≥3 看不到更早阶段，跨阶段重复仍占 12/95（duplicateTask 第二大 flag；
        // D14 三个阶段各排一次「回放被岔开的对话」）。标题体积小（≤60 条），全量注入。
        ...(stageIndex > 1 ? {
          allPreviousStageTasks: (() => {
            const stages = learningPath.milestones
              .slice(0, stageIndex)
              .map((m, i) => ({
                stageNumber: m.stageNumber,
                tasks: (stageTaskSummaries.get(i) || []).map((t) => t.title),
              }))
              .filter((s) => s.tasks.length > 0);
            // 注入留痕（2026-10-27）：agent_call_logs 输入截断无法验证，显式打日志供夜批核对
            logger.info('[stage-dedup-source] allPreviousStageTasks 已注入', {
              pathId: learningPath.id,
              stageNumber: milestone.stageNumber,
              sourceStages: stages.length,
              sourceTasks: stages.reduce((n, s) => n + s.tasks.length, 0),
            });
            return stages;
          })(),
        } : {}),
        // 渐进式（批次 D）：上一阶段的学习者账本信号——脆弱/挣扎概念、先修缺口、
        // wrapup 里仍未掌握的点。stage-designer 据此调整下一阶段的坡度与回补任务。
        ...(progressive && options.previousStageOutcome
          ? { previousStageOutcome: options.previousStageOutcome }
          : {}),
        repairHints: null,
        ...(pathSchoolAnchor ? { schoolAnchor: pathSchoolAnchor } : {}),
      };
      const stageResult = await executeSkill(stageDesignerDefinition, stageDesignerInput);

      const rawStageTasks = Array.isArray(stageResult?.subtasks) ? stageResult.subtasks : [];
      // hints 硬执行：模型把 subtasksPerStageRange 当软参考（实测 hints=[2,2] 仍给 5 任务/段），
      // 这里按上界兜底裁剪，否则体量锚在上端失效（输出不随锚变化 ⇒ 连校准都测不了）。
      let stageTasks = clampStageTasksToHints(rawStageTasks, stageHints || (normalizedInput as any)?.planningHints);
      if (stageTasks.length !== rawStageTasks.length) {
        logger.warn(`[stage-hints-clamp] 任务数按 hints 兜底裁剪：stage${milestone.stageNumber} ${rawStageTasks.length} → ${stageTasks.length}`);
      }
      // 补课（2026-09-30）：targetSubtasksForStage 是**下限**（提示词规则 30 早已写明），
      // 但模型惯性仍用长课时顶掉课数（法考案例：每阶段要 30 课、8 阶段 7 个只给 5-10 课，
      // 实交付 0.18×自述预算）。不足锚的 70% 时做**一次**补课调用，补的是清单外的新方向；
      // 同阶段标题近似的换皮课一律丢弃（评审实证：强填产同质化）。补不齐留缺口账，不硬塞。
      // 2026-10-26 双条件（外部评审悖论4）：课数不足**且**分钟未饱和（<75% 预算）才补——
      // 2×30 分钟扎实装满 60 分钟预算而锚是 3 课时，强补只会压薄每课或产凑数任务。
      const wantedLessons = Number((stageHints as any)?.targetSubtasksForStage);
      let supplementAudit: Record<string, unknown> | null = null;
      if (needsLessonSupplement(stageTasks, wantedLessons, (stageHints as any)?.stageMinutesBudget)) {
        const initialCount = stageTasks.length;
        const supplementRequest = buildSupplementRequest(
          stageTasks,
          wantedLessons,
          milestone.stageNumber,
          ((stageHints as any)?.subtaskMinutesRange as [number, number]) || null,
        );
        const supplementResult = await executeSkill(stageDesignerDefinition, {
          ...stageDesignerInput,
          supplementRequest,
        }).catch((error: unknown) => {
          logger.warn(`[stage-supplement] 补课调用失败，保留原产出：stage${milestone.stageNumber}`, {
            runId,
            milestoneId: milestone.id,
            error: String(error).slice(0, 200),
          });
          return null;
        });
        const incoming = Array.isArray((supplementResult as any)?.subtasks)
          ? (supplementResult as any).subtasks
          : [];
        if (incoming.length > 0) {
          const { merged, added, dropped, dropReasons } = mergeSupplementTasks(stageTasks, incoming, {
            upper: Number((stageHints as any)?.subtasksPerStageRange?.[1]) || null,
            // 只补首轮缺失的动作族：新增课若把首轮整个认知弧原样重跑，学习者感知到的
            // 就是「同一件事换说法」（评审实证：类型分布逐族重复，字面相似度却 <0.5）。
            requireTypeNovelty: 'taskType',
          });
          if (added.length > 0) {
            stageTasks = clampStageTasksToHints(merged, stageHints || (normalizedInput as any)?.planningHints);
          }
          supplementAudit = {
            requested: wantedLessons,
            initial: initialCount,
            incoming: incoming.length,
            added: added.length,
            dropped: dropped.length,
            dropReasons,
            final: stageTasks.length,
          };
          logger.warn(`[stage-supplement] stage${milestone.stageNumber} 补课：要 ${wantedLessons} 首轮 ${initialCount} → 新增 ${added.length}（丢弃 ${dropped.length}：近重复${dropReasons.duplicate}/同动作族${dropReasons.typeRepeat}/无类型${dropReasons.noType}/脏数据${dropReasons.invalid}）→ ${stageTasks.length}`, {
            runId,
            milestoneId: milestone.id,
          });
        }
      }
      assertStageTasksPresent(milestone.stageNumber, stageTasks);
      // 验收越界拦截（2026-10-26 外部评审 #4/#5）：platformJudgment=not_judgeable 时，
      // 验收词必须落在「学习者文字自述 + 可记录练习事实」上——平台是纯文本的，琴声/手型
      // 进不了系统，「声音清晰无闷响」「手型标准」这类判据给了下游 teaching 判官一个
      // 永远无法执行的标准，只能放水（学习者复述形容词即通关）。这里确定性检测越界验收，
      // 命中则带 repairHints.acceptanceFixes 重调**一次**；重调仍越界则放行并留审计
      // （不阻塞、不改写文本——自动拼接前缀会改写语义，比越界更糟）。
      const stagePlatformJudgment = (stageNormalizedInput as any)?.learnerProfile?.platformJudgment;
      if (stagePlatformJudgment === 'not_judgeable') {
        const violations = detectUnjudgeableAcceptance(stageTasks as Array<Record<string, unknown>>);
        if (violations.length > 0) {
          logger.warn('[stage-judgeability] not_judgeable 验收越界，带修复提示重调一次', {
            pathId: learningPath.id,
            stageNumber: milestone.stageNumber,
            violations: violations.map((v) => v.taskTitle),
          });
          const retryResult = await executeSkill(stageDesignerDefinition, {
            ...stageDesignerInput,
            repairHints: {
              acceptanceFixes: {
                reason: '以下任务的验收标准要求平台判定它看不到/听不到的身体动作或声音属性，平台只能依据学习者的文字记录判断',
                rules: '验收必须改写为「学习者在对话框提交的文字记录」可判定的形式：写了什么练习事实（练了几遍/录了音/哪里卡）、自评归因（可能是什么原因）、下一步改哪一处；禁止把声音/动作质量（干净、清晰、标准、不闷）作为达标判据',
                tasks: violations,
              },
            },
          } as any).catch((error: unknown) => {
            logger.warn('[stage-judgeability] 验收修复重调失败，保留原产出', {
              pathId: learningPath.id,
              stageNumber: milestone.stageNumber,
              error: String(error).slice(0, 200),
            });
            return null;
          });
          const retryTasks = Array.isArray((retryResult as any)?.subtasks) ? (retryResult as any).subtasks as Array<Record<string, unknown>> : [];
          if (retryTasks.length > 0) {
            const remaining = detectUnjudgeableAcceptance(retryTasks);
            if (remaining.length < violations.length) {
              stageTasks = clampStageTasksToHints(retryTasks, stageHints || (normalizedInput as any)?.planningHints);
              logger.warn('[stage-judgeability] 验收修复重调采纳', {
                pathId: learningPath.id,
                stageNumber: milestone.stageNumber,
                before: violations.length,
                after: remaining.length,
              });
            }
          }
        }
      }
      // 阶段内认知动作拓扑序（2026-10-25 外部评审实证）：prompt 规则 65 要求
      // 「建立 → 应用 → 收束」，但只是软约束。实证倒挂：py-clean S5 先 refine(复查脚本)
      // 后 model(写脚本)、eng-syntax S4 先 consolidate(产出流程卡) 后 model(才练嵌套句)、
      // power-train S1 先 execute(踩五档功率) 后 diagnose(定恢复放行判据，用户腿酸未恢复)。
      // 稳定排序，同档内保留模型给的相对顺序；已是正序时恒等变换（零行为变化）。
      const orderedTasks = orderStageTasksByTopology(stageTasks as Array<{ type?: string }>);
      if (orderedTasks.some((task, index) => task !== stageTasks[index])) {
        logger.warn('[stage-topology] 阶段内认知动作顺序倒挂，已确定性重排', {
          pathId: learningPath.id,
          stageNumber: milestone.stageNumber,
          before: (stageTasks as any[]).map((t) => String(t?.type || '?')),
          after: orderedTasks.map((t) => String(t?.type || '?')),
        });
        // 重排必须同步改写描述里的「任务 N」引用，否则原「沿用任务 1」会变成自指
        // （2026-10-26 实测：重排后 5/10 条路径被判 prerequisiteGap，根因全是编号失配）。
        stageTasks = remapStageTaskReferences(stageTasks as any[], orderedTasks as any[]) as typeof stageTasks;
      }
      // 阶段分钟预算确定性夹（2026-10-25 承诺二次违约修复）：模型对 hints 的分钟锚
      // 遵从率低（实证 uqcit3l：hints 全对——总量 2h/阶段 0.7h/每任务 20 分钟/区间 9-30，
      // 模型仍排出 80+60+113=253 分钟 ≈ 承诺 2.1 倍）。提示词规则之外再加一道代码夹，
      // 在所有补课/置换之后、落库之前执行；只治注水方向，未超预算零变化。
      const stageBudgetMinutes = Number((stageHints as any)?.stageMinutesBudget);
      if (Number.isFinite(stageBudgetMinutes) && stageBudgetMinutes > 0) {
        const beforeMinutes = stageTasks.reduce((sum: number, t: any) => sum + (Number(t?.estimatedMinutes) || 0), 0);
        const clampedTasks = clampStageMinutesToBudget(stageTasks, stageBudgetMinutes, {
          minMinutes: Number((stageHints as any)?.subtaskMinutesRange?.[0]) || 5,
          maxMinutes: Number((stageHints as any)?.subtaskMinutesRange?.[1]) || 30,
        });
        const afterMinutes = clampedTasks.reduce((sum: number, t: any) => sum + (Number(t?.estimatedMinutes) || 0), 0);
        if (afterMinutes !== beforeMinutes || clampedTasks.length !== stageTasks.length) {
          logger.warn('[stage-budget-clamp] 阶段分钟超承诺预算，已确定性压缩', {
            pathId: learningPath.id,
            stageNumber: milestone.stageNumber,
            budgetMinutes: stageBudgetMinutes,
            beforeMinutes,
            afterMinutes,
            tasksBefore: stageTasks.length,
            tasksAfter: clampedTasks.length,
          });
        }
        stageTasks = clampedTasks;
      }
      // 引用覆盖守卫（2026-10-17）：有资料却零引用 = 本阶段任务没有长在资料上
      //（20 goal 复核实证：cpa/mbsr 末阶段）。缺口可见化之后**定向补课**（#119 优化项 1，2026-10-19）：
      // 在路径级闸（每路径最多 1 次调用）下再调一次 stage-designer，只收「带引用且 sectionId
      // 命中本阶段窗口」的新任务；阶段已满（真实跑批常态：任务数被裁到 subtasksPerStageRange
      // 上界）时改为**等量置换**至多 2 条无引用旧任务，阶段任务数不变；闸用完/补不来则维持
      // 原状（只告警，见下方）。
      // 纪律不变：**绝不自动补引用**——引用必须由模型给出并经 skill 侧逐字核对（withMaterialRefs），
      // 系统替模型绑一条不可核对的引用，比缺引用更糟（学习者点开原文会发现对不上）。
      let materialSupplement: ZeroRefSupplementAudit | null = null;
      if (stageMaterials) {
        let stageMaterialSummary = summarizeSectionRefPositions(
          stageTasks.flatMap((task: any) => (Array.isArray(task?.materialRefs) ? task.materialRefs : [])),
        );
        // kill switch：STAGE_MATERIAL_ZERO_REF_SUPPLEMENT=0 关闭补课（A/B 的 old 臂用）。
        // 只关「补课调用」，覆盖审计照常落库——否则 old 臂连缺口都看不见。
        if (stageMaterialSummary.count === 0 && process.env.STAGE_MATERIAL_ZERO_REF_SUPPLEMENT !== '0') {
          const outcome = await supplementZeroRefStage({
            stageNumber: milestone.stageNumber,
            materials: stageMaterials,
            stageTasks,
            designerInput: stageDesignerInput,
            hints: stageHints || (normalizedInput as any)?.planningHints || null,
            gate: zeroRefSupplementGate,
            // 与首轮同一条 skill 调用链（含逐字核对引用、白名单归一），补课只是多带一个 supplementRequest
            callDesigner: (input) => executeSkill(stageDesignerDefinition, input),
          });
          if (outcome.applied) {
            stageTasks = outcome.tasks;
            stageMaterialSummary = summarizeSectionRefPositions(
              stageTasks.flatMap((task: any) => (Array.isArray(task?.materialRefs) ? task.materialRefs : [])),
            );
          }
          materialSupplement = {
            attempted: outcome.attempted,
            applied: outcome.applied,
            reason: outcome.reason,
            mode: outcome.mode,
            needed: outcome.needed,
            incoming: outcome.incoming,
            accepted: outcome.accepted,
            replaced: outcome.replaced,
            rejected: outcome.rejected,
          };
          const supplementLogPayload = {
            runId,
            pathId,
            stageNumber: milestone.stageNumber,
            stageCount: learningPath.milestones.length,
            ...materialSupplement,
            refsAfter: stageMaterialSummary.count,
          };
          if (materialSupplement.attempted && !materialSupplement.applied) {
            // 调了模型仍没拿到带引用的任务：缺口保留，如实告警（不硬塞）
            logger.warn('[stage-material-supplement] 零引用补课未补成（缺口保留）', supplementLogPayload);
          } else {
            logger.info('[stage-material-supplement] 零引用阶段定向补课', supplementLogPayload);
          }
        }
        // 里程碑级引用与任务级分开计数（见 stageMaterialAudit 字段注释）：只读，不参与补课决策。
        const milestoneRefsRaw = (milestone as any)?.materialRefs;
        const stageMilestoneSummary = summarizeSectionRefPositions(
          Array.isArray(milestoneRefsRaw) ? milestoneRefsRaw : [],
        );
        stageMaterialAudit.push({
          stageNumber: milestone.stageNumber,
          refs: stageMaterialSummary.count,
          minSection: stageMaterialSummary.minSection,
          maxSection: stageMaterialSummary.maxSection,
          milestoneRefs: stageMilestoneSummary.count,
          combinedRefs: stageMaterialSummary.count + stageMilestoneSummary.count,
          refScope: 'task',
          ...(materialSupplement ? { materialSupplement } : {}),
        });
        if (stageMaterialSummary.count === 0) {
          logger.warn('[stage-material-window] 本阶段有资料但零引用（任务未长在资料上）', {
            runId,
            pathId,
            stageNumber: milestone.stageNumber,
            stageCount: learningPath.milestones.length,
            materials: stageMaterials.length,
            taskCount: stageTasks.length,
          });
        } else {
          logger.info('[stage-material-window] 本阶段资料引用位置', {
            runId,
            pathId,
            stageNumber: milestone.stageNumber,
            stageCount: learningPath.milestones.length,
            refs: stageMaterialSummary.count,
            minSection: stageMaterialSummary.minSection,
            maxSection: stageMaterialSummary.maxSection,
          });
        }
      }
      // 校内锚覆盖观测（只 warn 不阻断）：阶段目标+课标题是否真的引用了教材册次/考试范围。
      // 评审实证：锚传进上下文却没落进任何阶段——这里把它变成可复盘的事实。
      if (pathSchoolAnchor) {
        const coverage = schoolAnchorCoverage(pathSchoolAnchor, [
          milestone.goal || milestone.title || '',
          ...stageTasks.map((t: any) => String(t?.title || '')),
        ]);
        if (!coverage.referenced) {
          logger.warn(`[school-anchor] stage${milestone.stageNumber} 阶段目标未引用锚要素：${coverage.missing.join('/')}`, {
            runId,
            milestoneId: milestone.id,
            textbook: pathSchoolAnchor.textbook,
          });
        }
      }
      stageDesignRawOutputs[`stage-${milestone.stageNumber}`] = {
        inputPayload: stageDesignerInput,
        rawModelOutput: stageResult?._debug?.rawModelOutput || null,
        extractedJson: stageResult?._debug?.extractedJson || null,
        normalizedOutput: {
          subtasks: stageTasks,
        },
        ...(supplementAudit ? { supplement: supplementAudit } : {}),
        // 零引用补课审计（#119 优化项 1）：原始产出里留档，复算时可对照 prompt_call_logs 复核
        ...(materialSupplement ? { materialSupplement } : {}),
      };
      stageDesignOutputs.push({
        milestoneId: milestone.id,
        stageNumber: milestone.stageNumber,
        subtasks: stageTasks,
      });
      // 幽灵通道修复：记录本阶段任务摘要，供下一阶段 previousMilestone.tasks 注入
      stageTaskSummaries.set(stageIndex, stageTasks.slice(0, 12).map((task: any) => ({
        title: String(task?.title || '').slice(0, 80),
        type: typeof task?.type === 'string' ? task.type : null,
        estimatedMinutes: Number.isFinite(Number(task?.estimatedMinutes)) ? Number(task.estimatedMinutes) : null,
      })));
      const stageFinishedAt = new Date();
      await prisma.path_generation_stage_items.update({
        where: { id: stageItemId },
        data: {
          status: 'succeeded',
          taskCount: stageTasks.length,
          heartbeatAt: stageFinishedAt,
          finishedAt: stageFinishedAt,
          errorCode: null,
          errorMessage: null
        }
      });
      inFlightStageItemIds.delete(stageItemId);
      completedStageCount += 1;
      await heartbeatGenerationRun(
        pathId,
        runId,
        calculateStageProgress(completedStageCount, learningPath.milestones.length)
      );
    };

    for (let batchStart = 0; batchStart < learningPath.milestones.length; batchStart += STAGE_DESIGN_CONCURRENCY) {
      const batchIndexes = learningPath.milestones
        .map((_, index) => index)
        .slice(batchStart, batchStart + STAGE_DESIGN_CONCURRENCY);
      await Promise.all(batchIndexes.map(processStageDesign));
    }

    // 全路径覆盖体检（只告警）：阶段数 ≥3、资料 ≥9 节，但所有引用都停在文档前半，
    // 或存在零引用阶段 ⇒ 生成当下就能看见缺口（报告里「后半引用 0」的运行期对应物），
    // 而不是等 A/B 复算才发现。不阻断、不改写模型输出。
    if (stageMaterialAudit.length >= 3) {
      const primarySectionTotal = Number(
        (normalizedInput as any)?.resources?.materials?.[0]?.pack?.sections?.length
        || (normalizedInput as any)?.materials?.[0]?.pack?.sections?.length
        || 0,
      );
      const coverage = assessMaterialCoverage(stageMaterialAudit, primarySectionTotal);
      if (coverage.lowCoverage) {
        logger.warn('[stage-material-window] 全路径引用未覆盖资料后半', {
          pathId,
          primarySectionTotal,
          maxSection: coverage.maxSection,
          stages: stageMaterialAudit.length,
        });
      }
      if (coverage.zeroRefStages.length > 0) {
        logger.warn('[stage-material-window] 存在零引用阶段', {
          pathId,
          zeroRefStages: coverage.zeroRefStages,
          stageCount: stageMaterialAudit.length,
        });
      }
    }

    // KC 映射（kc-mapper）：stage-designer 全部完成后，将概念与子任务分解为知识组件 + 依赖图，
    // 写回 aiPromptTemplate.kcAnnotation，结束"写后无读者"，供 teaching-turn 按 KC 粒度消费。
    // 契约收口在 kc-annotation 模块（executeSkillWithResult；2026-09-22 判空错配事故修复见该文件头注）。
    // 渐进式（批次 D）：单阶段输出走 **增量合并**（mergeKcStageAnnotation，v2 顶层与 v1 同形、
    // byStage 存阶段快照）——整包调用会把单阶段输出当全量覆写、抹掉其他阶段的 KC。
    // persist 注入 no-op：合并结果经本函数返回值交给下方 final 事务统一写 template（避免双写竞争）。
    let kcAnnotation: KcAnnotation | null;
    if (progressive) {
      const { executeSkillWithResult } = await import('../../../skills');
      const { kcMapperDefinition } = await import('../../../skills/kc-mapper');
      const kcParams = {
        pathId,
        userId: data.userId,
        template: parsedTemplate,
        milestones: learningPath.milestones.map((m) => ({
          stageNumber: m.stageNumber,
          title: m.title,
          coreConcept: m.coreConceptName || m.coreConceptId,
          description: m.description,
          goal: m.goal,
        })),
        subtasks: stageDesignOutputs.flatMap((s) => s.subtasks.map((t: any) => ({
          title: t.title,
          type: t.type,
          linkedConcept: t.linkedConcept,
          knowledgeType: t.knowledgeType,
          cognitiveLevel: t.cognitiveLevel,
        }))),
      };
      let stageKc: KcAnnotation | null = null;
      try {
        const kcResult = await executeSkillWithResult(kcMapperDefinition, {
          cognitiveCore: parsedTemplate?.cognitiveCore || parsedTemplate?.cognitiveDesign || null,
          milestones: kcParams.milestones,
          subtasks: kcParams.subtasks,
          prerequisiteTree: parsedTemplate?.cognitiveCore?.prerequisiteTree
            || parsedTemplate?.cognitiveDesign?.prerequisiteTree
            || null,
        });
        stageKc = kcResult?.success && kcResult?.output ? kcResult.output : null;
      } catch (kcError) {
        logger.warn('[stage-enrichment] 渐进 KC 映射失败（best-effort）', {
          pathId,
          error: kcError instanceof Error ? kcError.message : String(kcError),
        });
      }
      if (stageKc) {
        const currentTemplate = parsePathPromptTemplate(
          (await prisma.learning_paths.findUnique({
            where: { id: pathId },
            select: { aiPromptTemplate: true },
          }))?.aiPromptTemplate || null
        );
        kcAnnotation = mergeKcStageAnnotation(
          currentTemplate?.kcAnnotation as KcAnnotation | null,
          learningPath.milestones[0]?.stageNumber ?? 1,
          stageKc
        );
        try {
          await conceptGraphService.materializePathGraph({
            userId: data.userId,
            pathId,
            kcAnnotation,
            cognitiveCore: parsedTemplate?.cognitiveCore || parsedTemplate?.cognitiveDesign || null,
          });
        } catch (graphError) {
          logger.warn('[stage-enrichment] 渐进概念图物化失败（best-effort）', {
            pathId,
            error: graphError instanceof Error ? graphError.message : String(graphError),
          });
        }
      } else {
        kcAnnotation = null;
      }
    } else {
    kcAnnotation = await mapAndPersistKcAnnotation({
      pathId,
      userId: data.userId,
      template: parsePathPromptTemplate(learningPath.aiPromptTemplate || null),
      milestones: learningPath.milestones.map((m) => ({
        stageNumber: m.stageNumber,
        title: m.title,
        coreConcept: m.coreConceptName || m.coreConceptId,
        description: m.description,
        goal: m.goal,
      })),
      subtasks: stageDesignOutputs.flatMap((s) => s.subtasks.map((t: any) => ({
        title: t.title,
        type: t.type,
        linkedConcept: t.linkedConcept,
        knowledgeType: t.knowledgeType,
        cognitiveLevel: t.cognitiveLevel,
      }))),
    });
    }

    // 同阶段前置重排（2026-10-24）：只把同阶段内排在后继之后的前置任务稳定前移。
    if (kcAnnotation) {
      const reorderedEdges = reorderStageTasks(stageDesignOutputs, kcAnnotation);
      if (reorderedEdges > 0) logger.info('[stage-enrichment] 同阶段前置任务已重排', { pathId, reorderedEdges });
    }

    // 任务级资料引用收集（key = subtaskId；写进模板 JSON，不新增表列）
    const materialRefsByTask: Record<string, any[]> = {};
    // 任务级迷思预判收集（key = subtaskId；同 sidecar 模式，2026-09-26 课前注入）
    const misconceptionHintsByTask: Record<string, any[]> = {};
    // 任务级可调整性收集（key = subtaskId；动态规划，2026-10-17）：
    // 重排/压缩时据此保护核心骨干（core）、优先删减可调整任务（flexible）。
    const adjustabilityByTask: Record<string, 'core' | 'flexible'> = {};

    // 概念身份预解析（canonical，best-effort）：**必须在事务外**——SQLite 下事务持有写锁，
    // 事务内再写 concepts/aliases 会撞锁。设计：doc/KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md §3.4
    //
    // 概念 Map 建一次，供本函数全部 resolveTaskConcept 调用复用（旧口径每任务重建整张 Map）
    const taskConceptMap = buildConceptMap(pathCognitiveDesign);
    //
    // 键必须与写入侧一致：写入用的是 `resolveTaskConcept(...).linkedConceptName`（命中认知设计时
    // 取**设计里的概念名**，非原始 linkedConcept 文本），故这里复用同一个解析函数取同一个值。
    // （首版误用原始文本做键 → 实测子任务 6/0 全部落空。）
    //
    // 只收 `conceptSource === 'linked-concept'`：回退文本（'fallback-text'）可能是 path 内局部序号
    // `concept-N`，把它当 canonical 注册会重造"同键不同义"污染（实测别名表出现 aliasRaw="concept-1"）。
    const subtaskConceptIds = new Map<string, string>();
    try {
      const names = stageDesignOutputs
        .flatMap((s) => s.subtasks)
        .map((t: any) => {
          const linked = typeof t?.linkedConcept === 'string' ? t.linkedConcept : null;
          const resolved = resolveTaskConcept(linked, pathCognitiveDesign, linked, taskConceptMap);
          return resolved.conceptSource === 'linked-concept' ? resolved.linkedConceptName : null;
        })
        .filter((name): name is string => !!name && !!name.trim());
      if (names.length > 0) {
        const resolved = await conceptRegistryService.resolveMany(data.userId, names, {
          source: 'write_time', level: 'concept', originPathId: pathId,
        });
        for (const [key, conceptId] of resolved) subtaskConceptIds.set(key, conceptId);
      }
    } catch (error) {
      logger.warn('[stage-enrichment] 子任务概念身份预解析失败（best-effort，conceptId 留空）', {
        pathId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await withTransaction(async (tx) => {
      // 事务可能因瞬时冲突整体重试：计数必须随每次尝试重置，避免重复累加
      designedTaskCount = 0;
      // 同理：资料引用收集器声明在事务外，重试不清空会把上一次尝试的条目累加进模板
      for (const key of Object.keys(materialRefsByTask)) delete materialRefsByTask[key];
      for (const key of Object.keys(misconceptionHintsByTask)) delete misconceptionHintsByTask[key];
      for (const key of Object.keys(adjustabilityByTask)) delete adjustabilityByTask[key];
      await assertGenerationRunFence(tx, pathId, runId);
      const lockedPath = await tx.learning_paths.updateMany({
        where: { id: pathId, activeGenerationRunId: runId },
        data: { updatedAt: new Date() }
      });
      if (lockedPath.count !== 1) throw new Error('GENERATION_RUN_FENCED');
      await assertPathMutationSafe(
        tx,
        pathId,
        appendOnly ? 'append-tasks' : 'replace-tasks',
        appendOnly ? { milestoneIds: appendMilestoneIds } : {}
      );
      for (const milestone of learningPath.milestones) {
        if (!appendOnly) {
          await tx.subtasks.deleteMany({ where: { milestoneId: milestone.id } });
        }
        const stageOutput = stageDesignOutputs.find((item) => item.milestoneId === milestone.id);
        const stageTasks = stageOutput?.subtasks || [];
        // R6-1 filler 观测（只观测不阻断）：R5 容量扩容后评审实证 filler ~10-15%
        //（同对象第三遍、同卡三遍、循环多跑轮次、回锅填空四模式）。强删会误伤合法
        // consolidation（同对象第二遍整合是设计内），故只落 log 供后续决策。
        const fillerReport = detectStageFiller(stageTasks as Array<{ title?: string }>);
        if (isStageFiller(fillerReport)) {
          logger.warn('[stage-enrichment] 阶段任务检出 filler 形态（观测，不阻断）', {
            pathId: learningPath.id,
            milestoneId: milestone.id,
            stageNumber: milestone.stageNumber,
            tasks: stageTasks.length,
            duplicatePairs: fillerReport.duplicatePairs.slice(0, 3).map((p) => `${p.a.slice(0, 18)}≈${p.b.slice(0, 18)}`),
            repeatedObjects: fillerReport.repeatedObjects.slice(0, 4).map((o) => `${o.object}×${o.hits}`),
          });
        }
        // 阶段估时回写：以本阶段任务分钟汇总为准（ceil 到整小时），供各处展示与路径汇总使用
        const stageTotalMinutes = (stageTasks as Array<{ estimatedMinutes?: number }>)
          .reduce((sum, t) => sum + (Number(t?.estimatedMinutes) || 0), 0);
        // 2026-10-26 迭代 1：ceil 改保留一位小数（见下方 stageHours 同源修复说明）；
        // 下限同为 0.1 而非 1（短课路径不该被抬到 1 小时，见下方说明）。
        const stageNormalizedHours = stageTasks.length > 0
          ? Math.max(0.1, Math.round((stageTotalMinutes / 60) * 10) / 10)
          : null;

        for (let j = 0; j < stageTasks.length; j++) {
          const taskData = stageTasks[j];
          const resolvedConcept = resolveTaskConcept(
            typeof taskData.linkedConcept === 'string' ? taskData.linkedConcept : null,
            pathCognitiveDesign,
            typeof taskData.linkedConcept === 'string' ? taskData.linkedConcept : null,
            taskConceptMap,
          );
          const displayLabel = generateDisplayLabel(taskData.knowledgeType || null, taskData.cognitiveLevel || null)
            || (taskData.knowledgeType && taskData.cognitiveLevel ? `${taskData.knowledgeType} + ${taskData.cognitiveLevel}` : null);

          const subtaskId = `st_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${milestone.stageNumber}_${j}`;
          // 任务 → 可调整性（动态规划）：skill 侧已归一为 core|flexible，未给值时按 core 保守处理
          adjustabilityByTask[subtaskId] = (taskData as any).adjustability === 'flexible' ? 'flexible' : 'core';
          // 任务 → 资料条目（skill 侧已逐字核对）：按 subtaskId 落进 aiPromptTemplate.materialRefs.byTask
          if (Array.isArray((taskData as any).materialRefs) && (taskData as any).materialRefs.length) {
            materialRefsByTask[subtaskId] = (taskData as any).materialRefs;
          }
          // 任务 → 迷思预判（课前注入半条链）：规范化后按 subtaskId 落进 aiPromptTemplate.misconceptionHints.byTask
          if (Array.isArray((taskData as any).anticipatedMisconceptions) && (taskData as any).anticipatedMisconceptions.length) {
            misconceptionHintsByTask[subtaskId] = (taskData as any).anticipatedMisconceptions
              .map((hint: any) => ({
                conceptKey: typeof hint?.conceptKey === 'string' ? hint.conceptKey.trim() : '',
                label: typeof hint?.label === 'string' ? hint.label.trim() : '',
                why: typeof hint?.why === 'string' ? hint.why.trim() : '',
              }))
              .filter((hint: { conceptKey: string; label: string }) => hint.conceptKey && hint.label)
              .slice(0, 2);
          }
          // 用户可见文本收口（2026-10-12）：任务标题/描述不得含内部流程术语（如「回捞」）——
          // 任务标题在学习路径页直接渲染，实测「回捞学科全景框架并校准理论映射」漏出过
          const taskTitle = sanitizeUserFacingText(taskData.title || `任务${j + 1}`);
          const taskDescription = sanitizeUserFacingText(taskData.description || '');
          if (taskTitle.replaced.length > 0 || taskDescription.replaced.length > 0) {
            logger.warn('[stage-enrichment] 任务文本含内部流程术语，已替换为学习者语言', {
              pathId: learningPath.id,
              stageNumber: milestone.stageNumber,
              title: taskData.title,
              replaced: [...new Set([...taskTitle.replaced, ...taskDescription.replaced])],
            });
          }
          await tx.subtasks.create({
            data: {
              id: subtaskId,
              milestoneId: milestone.id,
              userId: data.userId,
              title: taskTitle.text || `任务${j + 1}`,
              description: taskDescription.text,
              taskType: normalizePathTaskType(taskData.type),
              estimatedMinutes: taskData.estimatedMinutes || 30,
              acceptanceCriteria: taskData.acceptanceHint || '',
              coreConcept: resolvedConcept.linkedConceptName || null,
              linkedConceptId: resolvedConcept.linkedConceptId || null,
              linkedConceptName: resolvedConcept.linkedConceptName || null,
              // canonical 身份（事务外预解析；未命中留 null，回填脚本可补）
              conceptId: subtaskConceptIds.get(normalizeConceptKey(resolvedConcept.linkedConceptName)) ?? null,
              knowledgeType: taskData.knowledgeType || null,
              cognitiveLevel: taskData.cognitiveLevel || null,
              icapLevel: taskData.icapLevel || null,
              displayLabel,
              learningObjectives: null,
              transferable: taskData.transferable ?? false,
              annotationConfidence: null,
              order: j,
              status: 'todo',
              updatedAt: new Date()
            }
          });
          designedTaskCount += 1;
        }
      }

      // 阶段/路径估时回写：任务分钟汇总（ceil 整小时）覆盖骨架期 LLM 粗估
      let pathTotalMinutes = 0;
      let pathNormalizedHours = 0;
      // #56：逐阶段记录回写后的学时，供收尾的不变量审计使用（回写前是骨架粗估，判不出退化）
      const stageHoursForAudit: Array<{ stageNumber: number; title: string | null; estimatedHours: number | null }> = [];
      // #55：路径级对账要的是「计划」而不是回写后的任务汇总——必须在循环前从骨架锚取
      // （循环内 tx.milestones.update 之后 learningPath.milestones 仍是旧值，语义上也是锚）。
      const plannedAnchorHours = learningPath.milestones.reduce(
        (sum, milestone) => sum + (Number(milestone.estimatedHours) || 0),
        0,
      );
      for (const milestone of learningPath.milestones) {
        const stageOutput = stageDesignOutputs.find((item) => item.milestoneId === milestone.id);
        const stageTasks = stageOutput?.subtasks || [];
        const stageTotalMinutes = (stageTasks as Array<{ estimatedMinutes?: number }>)
          .reduce((sum, t) => sum + (Number(t?.estimatedMinutes) || 0), 0);
        pathTotalMinutes += stageTotalMinutes;
        // 阶段学时回写（2026-10-26 迭代 1）：此前用 Math.ceil 向上取整，N 个阶段各取整一次，
        // 累积误差让「路径标称」永远比「任务实排」高 5–13%（20 条实测：中位比值 0.90，
        // eng-syntax 最差 0.61——标 10h 实排 6.1h）。改为保留一位小数，标称与实排同口径；
        // 展示层如需整数由前端格式化，不在数据层制造偏差。
        // 下限（2026-10-26 修复 5 副作用）：原为硬编码 1 小时，对「一次 20 分钟」的短课路径
        // 会把每阶段 0.3-0.6h 抬到 1h，5 个阶段累计虚增 3h（实测 phil-sci 标 5h 实排 2.1h，
        // 比值 0.43）。下限应服从单次可用时间：锚到本阶段任务的真实分钟，仅保留「不能为 0」
        // 这一条底线。
        const stageHours = stageTasks.length > 0
          ? Math.max(0.1, Math.round((stageTotalMinutes / 60) * 10) / 10)
          : null;
        stageHoursForAudit.push({
          stageNumber: milestone.stageNumber,
          title: milestone.title ?? null,
          estimatedHours: stageHours,
        });
        if (stageHours !== null) {
          pathNormalizedHours += stageHours;
          // 阶段级「时间说明」拼接已下线（2026-10-25 方向改造）：实证它把内部预算口径差
          // （锚 13h vs 任务 6h）裸露给学习者；预算链「承诺为顶」重锚后锚≈任务，触发源
          // 消失。真欠交付由路径级 buildPathFillNote 声明 + delivery 审计对账（delivery-ratio
          // 仍识别存量行的时间说明/容量说明）。存量数据不改写。
          // 阶段目标锚补齐（b3 评审）：模型自发引用率 ~30%（抽签），缺锚时确定性追加对照括注
          const anchorNote = buildAnchorGoalNote(pathSchoolAnchor, String(milestone.goal || ''));
          const anchorGoalBase = anchorNote
            ? String(milestone.goal || '').replace(/[。.;；\s]+$/, '') // 收掉句尾标点，避免「。（月考前）」
            : null;
          if (anchorNote) {
            anchorGoalNotes += 1;
          }
          await tx.milestones.update({
            where: { id: milestone.id },
            data: {
              estimatedHours: stageHours,
              ...(anchorNote && anchorGoalBase !== null ? { goal: `${anchorGoalBase}${anchorNote}` } : {}),
              updatedAt: new Date(),
            }
          });
        }
      }
      // 容量对表（2026-09-30 b3 评审实证：rw-school5-62 每天 60 分钟 × 25 天 = 25h 容量，
      // 路径却排了 41h——总量超容量 1.64 倍且没有任何环节拦截，学习者问「每天一小时够吗」
      // 时平台给的是排不完的计划）。结构化容量（sessionsLengthMin × totalSessions）存在时
      // 如实记账并 warn：优先保证可执行性口径，裁剪策略留给后续决策（本轮先让事实可见）。
      const capacityMinutes = (() => {
        const td = (normalizedInput as any)?.timeDimensions;
        const len = Number(td?.sessionsLengthMin);
        const sessions = Number(td?.totalSessions);
        if (Number.isFinite(len) && len > 0 && Number.isFinite(sessions) && sessions > 0) return len * sessions;
        const weeks = Number(td?.totalWeeks);
        const perWeek = Number(td?.sessionsPerWeek);
        if (Number.isFinite(len) && len > 0 && Number.isFinite(weeks) && weeks > 0 && Number.isFinite(perWeek) && perWeek > 0) return len * weeks * perWeek;
        return null;
      })();
      const capacityOverload = capacityMinutes !== null && pathTotalMinutes > capacityMinutes * 1.05
        ? {
            pathMinutes: pathTotalMinutes,
            capacityMinutes,
            ratio: Math.round((pathTotalMinutes / capacityMinutes) * 100) / 100,
          }
        : null;
      if (capacityOverload) {
        logger.warn('[stage-enrichment] 路径总量超出学习者时间容量（计划排不完）', {
          pathId: learningPath.id,
          ...capacityOverload,
        });
      }
      // 超载对外声明（2026-10-02 小陈案例 P0-2）：60h 预算排出 101h 只留在内部日志，
      // 学习者看到的是一份排不完的计划且无任何提示。追加到 description（前端路径详情直接读），
      // 事实口径、不擅自裁剪——裁剪策略（缩范围 vs 摊长期限）是产品拍板项。
      const overloadDeclaration = capacityOverload
        ? `【时间预算提示】按你当前的学习节奏，这份路径全部学完约需 ${Math.round(pathTotalMinutes / 60)} 小时，超出你可用时间的约 ${Math.round((capacityOverload.ratio - 1) * 100)}%。目标本身不受影响，但按原节奏会超出期限：可以先专注前几个阶段，学完再续后面的，或适当增加每周学习时间。`
        : null;
      const existingDescription = String(learningPath.description || '');
      // #55 路径级欠交付声明：计划→实际这一跳此前完全静默（阶段级只覆盖低于自身锚 70% 的阶段，
      // 路径级只有「超容量」一个方向）。计划优先取守恒层 after（容量夹取后的真实计划），无则退骨架锚。
      // 只在**全路径生成**时评估：追加/渐进模式的本轮任务只是片段，用它算路径交付会把
      // 「只做了第 3 阶段」误判成「整条路径只交付 23%」。
      const fullPathRun = !appendOnly && !progressive && !restrictMilestoneIds;
      const plannedAfterHours = Number((parsedTemplate as any)?.budgetConservation?.after) > 0
        ? Number((parsedTemplate as any)?.budgetConservation?.after)
        : plannedAnchorHours;
      const pathFillNote = fullPathRun
        ? buildPathFillNote({
            plannedHours: plannedAfterHours,
            deliveredHours: pathNormalizedHours,
            existingDescription,
          })
        : null;
      if (pathFillNote) {
        logger.warn('[stage-enrichment] 路径实际交付低于计划，已追加路径级课时说明', {
          pathId: learningPath.id,
          plannedHours: plannedAfterHours,
          deliveredHours: pathNormalizedHours,
          ratio: plannedAfterHours > 0
            ? Math.round((pathNormalizedHours / plannedAfterHours) * 100) / 100
            : null,
        });
      }
      // 两个方向的声明可同时成立（计划很宽、交付已超容量但仍低于计划 70%），各自按标记幂等追加
      const descriptionNotes: string[] = [];
      if (overloadDeclaration && !existingDescription.includes('【时间预算提示】')) {
        descriptionNotes.push(overloadDeclaration);
      }
      if (pathFillNote) descriptionNotes.push(pathFillNote);
      const descriptionWithNotes = descriptionNotes.reduce<string | null>(
        (description, note) => appendDescriptionNote(description ?? existingDescription, note),
        null,
      );
      // 实际交付落库：审计脚本据此区分「已声明缩水」与「静默缺陷」（存量路径无此字段时回退读描述标记）。
      // 同样只在全路径生成时写——部分片段写进去会被读成整条路径的交付量。
      const reconciledConservation = fullPathRun
        ? reconcileDeliveryConservation({
            conservation: (parsedTemplate as any)?.budgetConservation,
            deliveredHours: pathNormalizedHours,
            // 阶段级声明已下线（2026-10-25）：仅路径级【课时说明】计 path，其余 none；
            // 存量行的阶段级声明由 delivery-ratio 审计侧识别，不在此重复记账
            declaration: pathFillNote ? 'path' : 'none',
          })
        : null;
      if (pathSchoolAnchor && anchorGoalNotes > 0) {
        logger.info('[school-anchor] 阶段目标缺锚，已按确定性括注补齐', {
          runId,
          pathId: learningPath.id,
          stagesPatched: anchorGoalNotes,
          totalStages: learningPath.milestones.length,
        });
      }
      // 浮点收尾（2026-10-27 R8 冒烟实证 A13=6.600000000000001）：阶段小时逐项累加会带 IEEE754 尾巴，
      // 写路径总学时前统一保留一位小数（下界 0.1），与标称/展示口径一致。
      const pathHoursToWrite = pathNormalizedHours > 0
        ? Math.max(0.1, Math.round(pathNormalizedHours * 10) / 10)
        : undefined;

      // #56 阶段预算不变量：阶段预算必须按内容反推，不能恒等复制上游总量（等分/全等于总量
      // 都是退化形态）。这里只做可见化：判成 violations → warn + 落 aiPromptTemplate，
      // 由 `npx ts-node --transpile-only scripts/audit-stage-budget.ts` 汇总存量比例。怎么重新分配是产品决策，不在此处擅自裁剪。
      const stageBudgetAudit = auditStageBudget({
        pathEstimatedHours: pathNormalizedHours || null,
        upstreamBudgetHours: Number((analysis as any)?.estimatedTotalHours) || Number(learningPath.estimatedHours) || null,
        stages: stageHoursForAudit,
        capacityMinutes,
      });
      if (!stageBudgetAudit.ok) {
        logger.warn('[stage-enrichment] 阶段预算不变量未通过（阶段预算可能退化成复制/等分）', {
          runId,
          pathId: learningPath.id,
          violations: stageBudgetAudit.violations.map((violation) => violation.kind),
          detail: stageBudgetAudit.violations.map((violation) => violation.detail).join('；'),
        });
      }

      // 结构确定性审计（2026-10-24）：前置缺口 / 重复任务 / 课时偏差。只记录不重排，
      // 写入 aiPromptTemplate.pathAudit 供离线评审与后续生成修复消费。
      // 2026-10-25 排序修复：stageDesignOutputs 按批次并发完成序 push（并发=2），
      // 直接喂审计会把 stage-1 任务编到 stage-2 之后，制造虚假 lateCrossStage 告警
      // （离线评审实证：uqcit3l/yng73ae/n9qzgpm 的「前置 KC 第 N 个」编号全部错位）。
      // 审计与消费方一律按 stageNumber 排序，DB 里程碑顺序不受影响。
      const stagesInOrder = [...stageDesignOutputs].sort((a, b) => a.stageNumber - b.stageNumber);
      const structureAudit = kcAnnotation
        ? auditGeneratedPath({
            stages: stagesInOrder,
            kcAnnotation,
            totalMinutes: pathTotalMinutes,
            afterHours: Number((parsedTemplate as any)?.budgetConservation?.after) || null,
            delivery: (reconciledConservation as { delivery?: string } | null)?.delivery ?? null,
          })
        : null;
      // kc-mapper 失败此前静默降级（kcAnnotation=null → 审计整个不跑，路径照样 success，
      // 离线评审才发现 3 条路径 KC/审计双双丢失）。落显式标记：可见、可统计、可告警。
      const auditDisabledReason = kcAnnotation
        ? null
        : (progressive ? 'kc-mapper-failed' : 'kc-mapper-persist-failed');
      if (structureAudit && structureAudit.issues.length > 0) {
        logger.warn('[stage-enrichment] 路径结构审计发现问题（只记录，不重排）', {
          pathId: learningPath.id,
          issues: structureAudit.issues.slice(0, 8).map((issue) => issue.kind),
          stats: structureAudit.stats,
        });
      }

      await tx.learning_paths.update({
        where: { id: learningPath.id },
        data: {
          ...(pathHoursToWrite !== undefined ? { estimatedHours: pathHoursToWrite } : {}),
          ...(descriptionWithNotes ? { description: descriptionWithNotes } : {}),
          aiPromptTemplate: JSON.stringify({
            ...parsedTemplate,
            stageDesigns: stageDesignRawOutputs,
            kcAnnotation,
            ...(capacityOverload ? { capacityOverload } : {}),
            ...(reconciledConservation ? { budgetConservation: reconciledConservation } : {}),
            ...(stageBudgetAudit.ok ? {} : { stageBudgetAudit: stageBudgetAudit.violations }),
            ...(structureAudit && structureAudit.issues.length > 0 ? { pathAudit: structureAudit } : {}),
            ...(auditDisabledReason ? { pathAuditDisabled: auditDisabledReason } : {}),
            ...(Object.keys(materialRefsByTask).length
              ? {
                  materialRefs: {
                    ...(parsedTemplate?.materialRefs && typeof parsedTemplate.materialRefs === 'object' ? parsedTemplate.materialRefs : {}),
                    // 追加/渐进设计**合并**既有 byTask（否则 stage N+1 的设计会抹掉 stage N 的
                    // 引用——append 不删既有任务，refs 也不能丢）；eager replace 保持整体替换
                    // （旧 subtaskId 已随 replace 失效，合并只会留垃圾键）。
                    byTask: (appendOnly || progressive)
                      ? {
                          ...((parsedTemplate?.materialRefs as any)?.byTask && typeof (parsedTemplate as any).materialRefs.byTask === 'object'
                            ? (parsedTemplate as any).materialRefs.byTask
                            : {}),
                          ...materialRefsByTask,
                        }
                      : materialRefsByTask,
                  },
                }
              : {}),
            ...(Object.keys(misconceptionHintsByTask).length
              ? {
                  // 迷思预判 sidecar：合并语义与 materialRefs 相同（append/progressive 保留旧任务）
                  misconceptionHints: {
                    ...(parsedTemplate?.misconceptionHints && typeof parsedTemplate.misconceptionHints === 'object' ? parsedTemplate.misconceptionHints : {}),
                    byTask: (appendOnly || progressive)
                      ? {
                          ...((parsedTemplate?.misconceptionHints as any)?.byTask && typeof (parsedTemplate as any).misconceptionHints.byTask === 'object'
                            ? (parsedTemplate as any).misconceptionHints.byTask
                            : {}),
                          ...misconceptionHintsByTask,
                        }
                      : misconceptionHintsByTask,
                  },
                }
              : {}),
            ...(Object.keys(adjustabilityByTask).length
              ? {
                  // 可调整性 sidecar：合并语义与 materialRefs 相同（append/progressive 保留旧任务）
                  taskAdjustability: {
                    ...(parsedTemplate?.taskAdjustability && typeof parsedTemplate.taskAdjustability === 'object' ? parsedTemplate.taskAdjustability : {}),
                    byTask: (appendOnly || progressive)
                      ? {
                          ...((parsedTemplate?.taskAdjustability as any)?.byTask && typeof (parsedTemplate as any).taskAdjustability.byTask === 'object'
                            ? (parsedTemplate as any).taskAdjustability.byTask
                            : {}),
                          ...adjustabilityByTask,
                        }
                      : adjustabilityByTask,
                  },
                }
              : {}),
            _generation: {
              ...(parsedTemplate?._generation && typeof parsedTemplate._generation === 'object' ? parsedTemplate._generation : {}),
              stageDesign: 'succeeded',
              kcMapping: kcAnnotation ? 'succeeded' : 'skipped',
              lastError: null,
              sourceConversationId: data.sourceConversationId || null,
              triggerSource,
              ...(progressive ? { progressive: true } : {}),
              ...(stageMaterialAudit.length
                ? {
                    // 资料覆盖审计（2026-10-17）：逐阶段引用条数与章节序号范围 + 零引用阶段。
                    // 与 A/B 的「后半引用」同源，运维/复算可直接读，不需再跑探针。
                    // 2026-10-19（#119 优化项 1）：零引用阶段经定向补课后 refs 已按补后清单重算，
                    // `zeroRefStages` 即补后缺口（下降幅度 = 补课效果）。
                    materialCoverage: {
                      // 口径声明（2026-10-20，#119）：stages[].refs / zeroRefStages = **任务级**；
                      // 需要与「后半引用 / refPct」同口径时读 combinedRefs / zeroCombinedRefStages。
                      refScope: 'task',
                      stages: [...stageMaterialAudit].sort((a, b) => a.stageNumber - b.stageNumber),
                      zeroRefStages: stageMaterialAudit
                        .filter((item) => item.refs === 0)
                        .map((item) => item.stageNumber)
                        .sort((a, b) => a - b),
                      // 里程碑级 + 任务级（与 collectRefs / milestoneRefs 度量同口径）的零引用阶段。
                      // 旧读数只报任务级，复算时误以为能从路径对象对出 issue 里的 3/74——见 #119。
                      zeroCombinedRefStages: stageMaterialAudit
                        .filter((item) => item.combinedRefs === 0)
                        .map((item) => item.stageNumber)
                        .sort((a, b) => a - b),
                      // 零引用补课审计（#119 优化项 1）：闸是否被消耗 + 逐阶段补课结果。
                      // `attempted=false` 表示未发起调用（无窗口章节/已满/闸已耗尽），
                      // `gateUsed=false` 表示本路径的补课额度未被消耗（下次生成还有机会）。
                      ...(stageMaterialAudit.some((item) => item.materialSupplement)
                        ? {
                            zeroRefSupplement: {
                              gateUsed: zeroRefSupplementGate.used,
                              stages: stageMaterialAudit.flatMap((item) => (item.materialSupplement
                                ? [{ stageNumber: item.stageNumber, ...item.materialSupplement }]
                                : [])),
                            },
                          }
                        : {}),
                    },
                  }
                : {}),
              updatedAt: new Date().toISOString()
            }
          }),
          updatedAt: new Date(),
        }
      });
      await tx.path_generation_runs.update({
        where: { id: runId },
        data: {
          status: 'succeeded',
          retryAllowed: false,
          completedItems: learningPath.milestones.length,
          totalItems: learningPath.milestones.length,
          progress: 100,
          heartbeatAt: new Date(),
          leaseExpiresAt: new Date(),
          finishedAt: new Date(),
          errorCode: null,
          errorMessage: null
        }
      });
      await enqueueDomainEvent(tx, createDomainEvent({
        type: 'path:generated',
        aggregateType: 'path',
        aggregateId: pathId,
        userId: data.userId,
        source: 'learning-service',
        data: {
          pathId,
          taskCount: designedTaskCount,
          milestoneCount: learningPath.milestones.length,
          sourceConversationId: data.sourceConversationId || null,
          triggerSource
        }
      }));
    });

    logger.info('阶段任务设计完成', {
      pathId,
      userId: data.userId,
      taskCount: designedTaskCount,
      milestoneCount: learningPath.milestones.length,
    });

    // 跨阶段复读观测（2026-09-29 实测驱动，只观测不阻断）：单阶段检测看不见「同一节课排在
    // 相邻两个阶段」（实测 pe-rw-acad-05：M1-2 与 M2-1 相似度 0.739，两节课产出同一知识点）。
    // 渐进模式（每次只设计一个阶段）下也成立——这里读的是**库里全部阶段**的现状，不是本轮的产物。
    try {
      const stages = await prisma.milestones.findMany({
        where: { learningPathId: pathId },
        select: {
          stageNumber: true,
          subtasks: { select: { title: true }, orderBy: { order: 'asc' } },
        },
        orderBy: { stageNumber: 'asc' },
      });
      const crossReport = detectCrossStageFiller(
        stages.map((s: any) => ({ stageNumber: s.stageNumber, tasks: s.subtasks || [] })),
      );
      if (isCrossStageFiller(crossReport)) {
        logger.warn('[stage-enrichment] 跨阶段检出 filler 形态（观测，不阻断）', {
          pathId,
          pairs: crossReport.pairs.slice(0, 4).map((p) => `M${p.stageA}「${p.a.slice(0, 14)}」≈M${p.stageB}「${p.b.slice(0, 14)}」${p.similarity}`),
          repeatedObjects: crossReport.repeatedObjects.slice(0, 4).map((o) => `${o.object}×${o.hits}(M${o.stages.join(',')})`),
        });
      }
    } catch (error) {
      logger.warn('[stage-enrichment] 跨阶段 filler 观测失败（best-effort）', {
        pathId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await recordPathGenerationStageLog({
      userId: data.userId,
      pathId,
      sourceConversationId: data.sourceConversationId,
      triggerSource,
      phase: 'stageDesign',
      status: 'succeeded',
      durationMs: Date.now() - startTime,
      output: {
        taskCount: designedTaskCount,
        designedStages: learningPath.milestones.length
      }
    });
    dashboardGuidanceSnapshotService.refreshInBackground(data.userId, 'path-created');
  } catch (andersonError: any) {
    if (andersonError instanceof Error && andersonError.message === 'GENERATION_RUN_FENCED') {
      logger.info('忽略已失效阶段生成任务', { pathId, runId });
      return;
    }
    if (isPathMutationConflictError(andersonError)) {
      await restorePathAfterMutationConflict(pathId, runId, andersonError);
      logger.info('阶段任务生成因学习已开始而取消', {
        pathId,
        runId,
        code: andersonError.code
      });
      return;
    }

    logger.warn('阶段任务设计失败，路径保持骨架可用', {
      pathId,
      userId: data.userId,
      error: andersonError?.message || String(andersonError)
    });

    if (inFlightStageItemIds && inFlightStageItemIds.size > 0) {
      const failedAt = new Date();
      await prisma.path_generation_stage_items.updateMany({
        where: { id: { in: [...inFlightStageItemIds] }, runId, status: 'processing' },
        data: {
          status: 'failed',
          heartbeatAt: failedAt,
          finishedAt: failedAt,
          errorCode: 'PATH_STAGE_DESIGN_ITEM_FAILED',
          errorMessage: andersonError?.message || String(andersonError)
        }
      });
    }
    await recordPathGenerationStageLog({
      userId: data.userId,
      pathId,
      sourceConversationId: data.sourceConversationId,
      triggerSource,
      phase: 'stageDesign',
      status: 'failed',
      durationMs: Date.now() - startTime,
      error: andersonError?.message || String(andersonError),
      errorCode: 'PATH_ENRICHMENT_FAILED'
    });
    try {
      await updatePathGenerationStatus(pathId, {
        stageDesign: 'failed',
        lastError: andersonError?.message || String(andersonError),
        sourceConversationId: data.sourceConversationId || null,
        triggerSource,
        updatedAt: new Date().toISOString()
      }, runId);
      await failGenerationRun(
        pathId,
        runId,
        andersonError,
        andersonError?.message?.includes('EMPTY_TASKS') ? 'PATH_STAGE_DESIGN_ZERO_TASKS' : 'PATH_ENRICHMENT_FAILED',
        'stageDesign'
      );
    } catch (fenceError) {
      if (!(fenceError instanceof Error) || fenceError.message !== 'GENERATION_RUN_FENCED') throw fenceError;
      logger.info('忽略已失效阶段生成任务的迟到失败', { pathId, runId });
    }
  } finally {
    stopHeartbeat();
  }
}

