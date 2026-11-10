/**
 * judge-stage-quality.ts —— 阶段设计质量判官（第三刀，2026-11-11）
 *
 * 为什么要有它：第一刀把「阶段=认知盲区、结束节点定界、Meno 闸、间隔迁移」写进了提示词，
 * 但提示词合规 ≠ 产出合格。是否「把老师原话换个说法当任务」（复述）、是否在学员仍在挣扎时
 * 抬难度（负荷反着用）、是否对准真实盲区（干预合理），都是**语义判断**，只能交给独立判官。
 *
 * 判官材料四块（与 docs/EXTERNAL_REVIEW_BRIEF_2026-11-10.md §9 第三刀一致）：
 *   ① 课堂真相：personaSeed + visibleDialogueContext（虚拟学习者会话可用时）
 *   ② lesson-knowledge-enricher 产出：blockedFoundations / recurringConfusions / knowledgeStateSummary
 *      （无 enricher 日志时回退到 path-planning prerequisiteTree.unknownConcepts，并在 provenance 标注）
 *   ③ previousStageOutcome + replan-attribution 归因理由
 *   ④ stage-designer 下一阶段 subtasks（缺失时可用 --dry-run-stage 现场补跑一次）
 *
 * 校准门（放行硬条件）：3 份黄金负样本（全抄原话 / 反向乱报 / 高负荷加难）必须全部 verdict=fail
 * 且 score ≤ 2，否则脚本退出码 1，禁止进入 50 份批跑。
 *
 * 用法：
 *   npx ts-node --transpile-only scripts/judge-stage-quality.ts --calibrate
 *   npx ts-node --transpile-only scripts/judge-stage-quality.ts --path lp_xxx --dry-run-stage
 *   npx ts-node --transpile-only scripts/judge-stage-quality.ts --session <virtualSessionId>
 *   npx ts-node --transpile-only scripts/judge-stage-quality.ts --payload case.json
 *   npx ts-node --transpile-only scripts/judge-stage-quality.ts --batch --limit 20
 *
 * 异构模型：判官与被评模型必须不同源。用 STAGE_JUDGE_MODEL 指定（如另一家 provider 的模型 id）；
 * 未设置时沿用平台默认模型，并在报告里标 homogeneous=true（校准仍跑，但不作为最终放行依据）。
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { getAPIGateway } from '../src/gateway/api-gateway';

const db = new PrismaClient();
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = process.env.STAGE_JUDGE_OUT_DIR
  || path.join(REPO_ROOT, 'qa-reports', 'stage-quality-judge', new Date().toLocaleDateString('sv-SE'));
const JUDGE_MODEL = process.env.STAGE_JUDGE_MODEL || '';

// ────────────────────────────── 类型 ──────────────────────────────

interface DialogueTurn {
  turn: number;
  learner: string;
  teacher: string;
  checkpoint?: string;
}

interface JudgePayload {
  caseId: string;
  source: { kind: 'path' | 'session' | 'file' | 'synthetic'; pathId?: string | null; sessionId?: string | null };
  provenance: Record<string, string>;
  A: {
    personaSeed: Record<string, unknown>;
    visibleDialogueContext: DialogueTurn[];
    visibleDialogueNote?: string;
  };
  B: {
    lessonKnowledge: {
      blockedFoundations: string[];
      recurringConfusions: Array<{ concept: string; note?: string; count?: number }>;
      knowledgeStateSummary?: string;
      reusableFoundations?: string[];
    };
    previousStageOutcome: {
      strugglingConcepts: string[];
      recommendation: string;
      reason?: string;
      claim?: string;
      evidenceRefs?: string[];
    } | null;
  };
  C: {
    nextStage: { stageNumber: number; title: string; goal?: string; coreConcept?: string } | null;
    subtasks: Array<Record<string, unknown>>;
    generatedBy?: 'db' | 'dry-run' | 'missing';
  };
}

interface JudgeVerdict {
  verdict: 'pass' | 'fail';
  score: number;
  hallucination?: { pass?: boolean; evidenceQuote?: string; note?: string };
  repetition?: { pass?: boolean; evidenceQuote?: string; note?: string };
  load?: { pass?: boolean; evidenceQuote?: string; note?: string };
  intervention?: { pass?: boolean; evidenceQuote?: string; note?: string };
  topIssue?: string;
}

// ────────────────────────────── 判官提示词（研究线版本） ──────────────────────────────

const JUDGE_SYSTEM_PROMPT = [
  '你是课程设计流水线的外部质量判官。你只依据材料判断，不脑补材料之外的事实。',
  '',
  '材料分四块：',
  '①A 课堂真相：personaSeed（学习者真实画像/目标/起点）+ visibleDialogueContext（真实课堂逐轮对话；为空表示备课期尚无课堂记录）。',
  '②A 备课产出：lesson-knowledge-enricher 的 blockedFoundations / recurringConfusions / knowledgeStateSummary（缺日志时可能回退到路径规划识别出的未知概念，provenance 会标注）。',
  '③B 阶段复盘：previousStageOutcome（strugglingConcepts / recommendation）+ replan-attribution 的归因理由。',
  '④C 下一阶段设计：stage-designer 产出的 subtasks（标题/类型/时长/描述/验收/预期误区）。',
  '',
  '你要执行三条铁律，逐条给结论：',
  '1) 幻觉/复读审计：C 的任务是否只是让学习者复述 A/B 已给的原话、定义或课堂结论（换个说法也算复述）？是否编造了 A/B 中不存在的事实、数字、概念或材料？有效任务必须让学习者在新情境里做一次判断或产出，而不是回忆标签。',
  '2) 负荷升降审计：结合 B 的 strugglingConcepts/recommendation 与 A 的课堂表现，C 的难度、新概念数量、任务时长是升还是降？学习者仍在挣扎（recommendation=reinforce 或 struggling 非空）却抬难度/堆新概念 = 违规；已掌握却原地重复 = 空转。',
  '3) 干预合理性审计：每条任务是否对准 A 暴露的真实盲区（B 的 blockedFoundations / recurringConfusions），是否有可验证的 acceptanceHint；与目标无关、无证据支撑、或要求平台无法承接的现实条件，判为不合理。',
  '',
  '判定口径：三律全部通过才 verdict=pass；任一违规 verdict=fail。score 为 0-5 整数：',
  '5=三律全过且任务有迁移价值；4=全过但有可优化点；3=有瑕疵但可修；2=至少一条铁律明确违规；1=多条铁律违规；0=整体不可用。',
  '备课期口径：visibleDialogueContext 为空、previousStageOutcome 为 null、或 B 块 provenance 标注 path-planning-fallback 时，表示该阶段尚无课堂数据——这些「缺失」本身不是缺陷，不要因缺失扣分；只依据已给材料判定。',
  '跨阶段口径：C 任务引用前序阶段学过的方法/链条（如「回顾第一块那条链」）是合理的教学铺垫，不得仅因 A 块没有课堂逐字记录就判为幻觉；只有 C 编造了材料中不存在的具体数字、法条、事实或材料时才算幻觉。',
  '若某条任务因材料缺失无法验证，在该律 note 写「证据不足」，不要直接判违规。',
  '输出纪律：只输出判定结论，不写推理过程、不自我辩论；每条 note 不超过 2 句。',
  'evidenceQuote 必须逐字引自材料（找不到就写「材料未提供」）。',
  '',
  '严格只输出一个 JSON 对象，不要解释文字、不要代码围栏。字段：',
  '{"verdict":"pass|fail","score":0,"hallucination":{"pass":true,"evidenceQuote":"","note":""},',
  ' "load":{"pass":true,"evidenceQuote":"","note":""},"intervention":{"pass":true,"evidenceQuote":"","note":""},',
  ' "topIssue":"最该改的一处"}',
].join('\n');

// ────────────────────────────── 工具 ──────────────────────────────

const clip = (value: unknown, max: number) => {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const parseJsonLoose = (raw: unknown): any => {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch {
      return null;
    }
  }
};

const parsePayload = (row: { userPayload?: string | null } | null | undefined): any => {
  const parsed = parseJsonLoose(row?.userPayload);
  if (parsed && parsed.__slim && parsed.head) return parseJsonLoose(parsed.head) || parsed;
  return parsed;
};

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const uniq = (list: string[]) => Array.from(new Set(list.map((x) => x.trim()).filter(Boolean)));

// ────────────────────────────── ①A 课堂 / persona ──────────────────────────────

async function buildDialogueFromVirtualSession(sessionId: string): Promise<{
  personaSeed: Record<string, unknown>;
  turns: DialogueTurn[];
  note?: string;
}> {
  const vs = await db.virtual_sessions.findUnique({ where: { id: sessionId } });
  if (!vs) throw new Error(`VIRTUAL_SESSION_NOT_FOUND: ${sessionId}`);
  const stage = parseJsonLoose(vs.stageResults) || {};
  const story = stage.story && typeof stage.story === 'object' ? stage.story : {};
  const learnerContext = stage.learnerContext && typeof stage.learnerContext === 'object' ? stage.learnerContext : {};
  const personaSeed = {
    story: {
      storyId: story.storyId,
      title: story.title,
      visibleOpening: clip(story.visibleOpening, 500),
      triggerEvent: clip(story.triggerEvent, 300),
      hiddenDetails: asArray(story.hiddenDetails).slice(0, 5),
      pressurePoints: asArray(story.pressurePoints).slice(0, 5),
    },
    learnerContext: {
      nameHint: learnerContext.nameHint,
      age: learnerContext.age,
      occupation: learnerContext.occupation,
      background: clip(learnerContext.background, 400),
      knownConcepts: asArray(learnerContext.knownConcepts).slice(0, 12),
    },
  };
  const logs = await db.virtual_session_logs.findMany({
    where: { sessionId, phase: { in: ['teaching-reply', 'teaching-response'] } },
    orderBy: { id: 'asc' },
  });
  const turns: DialogueTurn[] = [];
  let pendingLearner = '';
  for (const log of logs) {
    const payload = parseJsonLoose(log.payload) || {};
    const output = payload?.details?.output || {};
    if (log.phase === 'teaching-reply') {
      pendingLearner = str(output.reply);
    } else if (log.phase === 'teaching-response') {
      const teacher = str(output.aiResponse);
      const checkpoint = output?.promptDebug?.checkpoint?.question
        || output?.checkpoint?.question
        || '';
      if (pendingLearner || teacher) {
        turns.push({
          turn: turns.length + 1,
          learner: clip(pendingLearner, 600),
          teacher: clip(teacher, 1200),
          ...(checkpoint ? { checkpoint: clip(checkpoint, 400) } : {}),
        });
        pendingLearner = '';
      }
    }
  }
  return {
    personaSeed,
    turns: turns.slice(-12),
    note: turns.length ? undefined : '该会话没有课堂对话日志（仅有目标/路径阶段）。',
  };
}

async function buildPersonaFromGoalSession(goalSessionId: string): Promise<Record<string, unknown>> {
  const rows = await db.prompt_call_logs.findMany({
    where: { sessionId: goalSessionId, agentId: 'skill:goal-conversation' },
    orderBy: { createdAt: 'asc' },
  });
  const first = rows.find((row) => parsePayload(row));
  const payload = parsePayload(first);
  const final = payload?.collectedData?.goalFinalPayload
    || payload?.goalFinalPayload
    || payload?.goal
    || null;
  return {
    goalSessionId,
    surfaceGoal: clip(final?.surfaceGoal || final?.goal || payload?.surface_goal || '', 500),
    realProblem: clip(final?.realProblem || payload?.real_problem || '', 500),
    constraints: clip(final?.constraintsAndBoundaries || payload?.constraints_and_boundaries || '', 400),
    sourceNote: rows.length ? 'goal-conversation 首轮 payload' : 'goal 会话日志缺失，persona 仅含路径标题',
  };
}

// ────────────────────────────── ②B 备课 / 复盘 ──────────────────────────────

async function buildLessonKnowledge(scope: { pathId?: string | null; sessionId?: string | null; since?: Date | null }) {
  const where: any = { agentId: 'skill:lesson-knowledge-enricher', success: true };
  if (scope.pathId) where.pathId = scope.pathId;
  else if (scope.sessionId) where.sessionId = scope.sessionId;
  else if (scope.since) where.createdAt = { gte: scope.since };
  const row = await db.prompt_call_logs.findFirst({ where, orderBy: { createdAt: 'desc' } });
  const out = parseJsonLoose(row?.extractedJson || row?.normalizedOutput || row?.rawModelOutput);
  if (out) {
    return {
      provenance: 'lesson-knowledge-enricher',
      lessonKnowledge: {
        blockedFoundations: asArray<string>(out.blockedFoundations),
        recurringConfusions: asArray<any>(out.recurringConfusions).map((x) => ({
          concept: str(x?.concept),
          note: clip(x?.note, 200),
          count: Number(x?.count) || undefined,
        })),
        knowledgeStateSummary: clip(out.knowledgeStateSummary, 800),
        reusableFoundations: asArray<string>(out.reusableFoundations).slice(0, 8),
      },
    };
  }
  return null;
}

async function buildLessonKnowledgeFallback(pathId: string) {
  const run = await db.path_generation_runs.findFirst({
    where: { learningPathId: pathId },
    orderBy: { createdAt: 'desc' },
  });
  const template = parseJsonLoose(run?.rollbackSnapshot ? parseJsonLoose(run.rollbackSnapshot)?.path?.aiPromptTemplate : null) || {};
  const unknown = asArray<any>(template?.cognitiveCore?.prerequisiteTree?.unknownConcepts);
  const reviewer = await db.prompt_call_logs.findFirst({
    where: { pathId, agentId: 'skill:path-reviewer', success: true },
    orderBy: { createdAt: 'desc' },
  });
  const review = parseJsonLoose(reviewer?.extractedJson);
  const reviewIssues = asArray<any>(review?.issues).map((issue) => ({
    concept: str(issue?.dimension) || '路径评审',
    note: clip(issue?.description, 240),
  }));
  return {
    provenance: 'path-planning-fallback',
    lessonKnowledge: {
      blockedFoundations: uniq(unknown.map((item) => str(item?.concept || item?.name || item)).filter(Boolean)),
      recurringConfusions: reviewIssues,
      knowledgeStateSummary: clip(unknown.map((item) => str(item?.concept || item?.name || item)).join('；'), 800),
      reusableFoundations: asArray<string>(template?.cognitiveCore?.prerequisiteTree?.knownConcepts).slice(0, 8),
    },
  };
}

async function buildPreviousStageOutcome(scope: { pathId?: string | null; sessionId?: string | null; since?: Date | null }) {
  const where: any = { agentId: 'skill:replan-attribution', success: true };
  if (scope.pathId) where.pathId = scope.pathId;
  if (scope.sessionId) where.sessionId = scope.sessionId;
  if (!scope.pathId && !scope.sessionId && scope.since) where.createdAt = { gte: scope.since };
  const row = await db.prompt_call_logs.findFirst({ where, orderBy: { createdAt: 'desc' } });
  if (!row) return { provenance: 'missing', previousStageOutcome: null };
  const input = parsePayload(row);
  const output = parseJsonLoose(row.extractedJson || row.normalizedOutput || row.rawModelOutput) || {};
  const evidence = asArray<any>(input?.evidence);
  const struggling = evidence
    .filter((item) => ['struggling_concepts', 'blocked_foundations', 'session_summary'].includes(str(item?.kind)))
    .map((item) => str(item?.text));
  return {
    provenance: 'replan-attribution',
    previousStageOutcome: {
      strugglingConcepts: uniq(struggling),
      recommendation: str(output.recommendation || input?.recall?.recommendation),
      reason: clip(output.reason || input?.recall?.rationale, 600),
      claim: clip(output.claim, 400),
      evidenceRefs: asArray<string>(output.evidenceRefs).slice(0, 6),
    },
  };
}

// ────────────────────────────── ④C 下一阶段 ──────────────────────────────

function compactSubtask(task: any) {
  // 兼容两种来源：stage-designer 输出（acceptanceHint/type/linkedConcept）与 DB subtasks 行
  // （acceptanceCriteria/taskType/linkedConceptName）——后者不落 anticipatedMisconceptions。
  return {
    title: str(task?.title),
    type: str(task?.type || task?.taskType),
    estimatedMinutes: Number(task?.estimatedMinutes) || undefined,
    description: clip(task?.description, 600),
    acceptanceHint: clip(task?.acceptanceHint || task?.acceptanceCriteria, 400),
    linkedConcept: task?.linkedConcept || task?.linkedConceptName || task?.linkedConceptId,
    cognitiveLevel: task?.cognitiveLevel,
    knowledgeType: task?.knowledgeType,
    anticipatedMisconceptions: asArray<any>(task?.anticipatedMisconceptions).slice(0, 2).map((m) => ({
      conceptKey: m?.conceptKey,
      label: clip(m?.label, 160),
      why: clip(m?.why, 240),
    })),
  };
}

async function buildNextStage(pathId: string): Promise<JudgePayload['C'] & { provenance?: string }> {
  const pathRow = await db.learning_paths.findUnique({ where: { id: pathId } });
  if (!pathRow) return { nextStage: null, subtasks: [], generatedBy: 'missing' };
  const milestones = await db.milestones.findMany({ where: { learningPathId: pathId }, orderBy: { stageNumber: 'asc' } });
  // 「下一阶段」= 第一个 locked 阶段（stage-designer 尚待/刚生成）；没有 locked 时取第一个未完成阶段。
  // 不把当前 active 阶段当被评对象：它已被课堂消费，评它等于评旧设计（2026-11-11 校准首跑实证）。
  let target: any = null;
  for (const milestone of milestones) {
    if (milestone.status === 'completed') continue;
    if (milestone.status !== 'locked') continue;
    const count = await db.subtasks.count({ where: { milestoneId: milestone.id } });
    target = { milestone, count };
    break;
  }
  if (!target) {
    for (const milestone of milestones) {
      if (milestone.status === 'completed') continue;
      const count = await db.subtasks.count({ where: { milestoneId: milestone.id } });
      target = { milestone, count };
      break;
    }
  }
  if (!target) return { nextStage: null, subtasks: [], generatedBy: 'missing' };
  const { milestone, count } = target;
  const nextStage = {
    stageNumber: Number(milestone.stageNumber),
    title: milestone.title,
    goal: clip(milestone.goal, 500),
    coreConcept: clip(milestone.coreConceptName, 300),
    estimatedHours: milestone.estimatedHours ?? undefined,
    pathTotalHours: pathRow.estimatedHours ?? undefined,
  };
  if (count > 0) {
    const rows = await db.subtasks.findMany({ where: { milestoneId: milestone.id }, orderBy: { order: 'asc' } });
    return { nextStage, subtasks: rows.map(compactSubtask), generatedBy: 'db' };
  }
  return { nextStage, subtasks: [], generatedBy: 'missing' };
}

/**
 * 渐进式备课对策：只生成了 Stage 1 时，用已有 previousStageOutcome 对下一阶段做一次
 * stage-designer dry-run，凑齐 payload ④（跑 1 堂课而不是整阶段，省 ~75% 样本成本）。
 */
async function dryRunNextStage(pathId: string, previousStageOutcome: JudgePayload['B']['previousStageOutcome']) {
  const { stageDesigner } = await import('../src/skills/stage-designer');
  const run = await db.path_generation_runs.findFirst({ where: { learningPathId: pathId }, orderBy: { createdAt: 'desc' } });
  const rollback = parseJsonLoose(run?.rollbackSnapshot);
  const template = parseJsonLoose(rollback?.path?.aiPromptTemplate) || {};
  const cognitiveCore = template.cognitiveCore;
  const normalizedInput = template.normalizedInput || template.normalizedInputSnapshot || null;
  if (!cognitiveCore) throw new Error('DRY_RUN_NO_COGNITIVE_CORE');
  const milestones = await db.milestones.findMany({ where: { learningPathId: pathId }, orderBy: { stageNumber: 'asc' } });
  const target = milestones.find((m) => m.status === 'locked')
    || milestones.find((m) => m.status !== 'completed');
  if (!target) throw new Error('DRY_RUN_NO_NEXT_STAGE');
  const previousMilestone = milestones.find((m) => Number(m.stageNumber) === Number(target.stageNumber) - 1) || null;
  const milestoneInput = {
    id: target.id,
    stageNumber: Number(target.stageNumber),
    title: target.title,
    description: target.description,
    goal: target.goal,
    coreConcept: target.coreConceptName,
    estimatedHours: target.estimatedHours,
  };
  const result: any = await stageDesigner({
    milestone: milestoneInput,
    previousMilestone: previousMilestone
      ? {
        stageNumber: Number(previousMilestone.stageNumber),
        title: previousMilestone.title,
        coreConcept: previousMilestone.coreConceptName,
      }
      : null,
    cognitiveCore,
    normalizedInput,
    materials: [],
    previousStageOutcome,
    pathStageMap: asArray<any>(template?.suggestedMilestones).map((m) => ({
      stageNumber: m?.stageNumber ?? m?.stage,
      title: m?.title,
      coreConcept: m?.coreConcept,
    })),
  });
  const subtasks = asArray<any>(result?.output?.subtasks || result?.subtasks);
  return { nextStage: {
    stageNumber: Number(target.stageNumber),
    title: target.title,
    goal: clip(target.goal, 500),
    coreConcept: clip(target.coreConceptName, 300),
    estimatedHours: target.estimatedHours ?? undefined,
    pathTotalHours: undefined,
  }, subtasks: subtasks.map(compactSubtask), generatedBy: 'dry-run' as const };
}

// ────────────────────────────── case 构建 ──────────────────────────────

async function findTranscriptSessionForPath(createdAt: Date): Promise<string | null> {
  const rows = await db.virtual_sessions.findMany({
    where: { createdAt: { gte: new Date(createdAt.getTime() - 36 * 3600 * 1000), lte: new Date(createdAt.getTime() + 36 * 3600 * 1000) } },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  for (const row of rows) {
    const has = await db.virtual_session_logs.count({
      where: { sessionId: row.id, phase: { in: ['teaching-reply', 'teaching-response'] } },
    });
    if (has > 0) return row.id;
  }
  return null;
}

async function buildCaseFromPath(pathId: string, opts: { dryRunStage?: boolean }): Promise<JudgePayload> {
  const pathRow = await db.learning_paths.findUnique({ where: { id: pathId } });
  if (!pathRow) throw new Error(`PATH_NOT_FOUND: ${pathId}`);
  const provenance: Record<string, string> = {};
  const sessionId = await findTranscriptSessionForPath(pathRow.createdAt);
  let personaSeed: Record<string, unknown> = {
    pathTitle: pathRow.title,
    subject: pathRow.subject,
    deadlineText: pathRow.deadlineText,
    sourceNote: '路径标题/学科（无 goal 会话可得）',
  };
  let turns: DialogueTurn[] = [];
  let dialogueNote = '路径生成后尚无课堂记录（备课期判定，A 块以路径目标为准）。';
  if (sessionId) {
    const sessionData = await buildDialogueFromVirtualSession(sessionId);
    personaSeed = { ...personaSeed, ...sessionData.personaSeed, sameTimeWindowSession: sessionId };
    turns = sessionData.turns;
    dialogueNote = sessionData.note || '按路径创建时间窗最近虚拟会话的课堂日志拼装（非同一条目，provenance 标注）。';
    provenance.dialogue = `virtual_session:${sessionId}`;
  } else {
    provenance.dialogue = 'none';
  }
  provenance.A = turns.length ? 'virtual-session-logs' : 'path-only';

  const enricher = await buildLessonKnowledge({ pathId });
  const lesson = enricher || await buildLessonKnowledgeFallback(pathId);
  provenance.B_lesson = lesson.provenance;
  const replan = await buildPreviousStageOutcome({ pathId, since: pathRow.createdAt });
  provenance.B_outcome = replan.provenance;

  let C = await buildNextStage(pathId);
  let provenanceC: string = C.generatedBy || 'missing';
  if ((!C.subtasks || C.subtasks.length === 0) && opts.dryRunStage && C.nextStage) {
    try {
      const dry = await dryRunNextStage(pathId, replan.previousStageOutcome);
      C = dry;
      provenanceC = 'dry-run';
    } catch (error: any) {
      provenanceC = `dry-run-failed:${error?.message || error}`;
    }
  }

  return {
    caseId: `path:${pathId}`,
    source: { kind: 'path', pathId },
    provenance: { ...provenance, C: provenanceC },
    A: { personaSeed, visibleDialogueContext: turns, visibleDialogueNote: dialogueNote },
    B: { lessonKnowledge: lesson.lessonKnowledge, previousStageOutcome: replan.previousStageOutcome },
    C,
  };
}

async function buildCaseFromSession(sessionId: string): Promise<JudgePayload> {
  const vs = await db.virtual_sessions.findUnique({ where: { id: sessionId } });
  if (!vs) throw new Error(`VIRTUAL_SESSION_NOT_FOUND: ${sessionId}`);
  const { personaSeed, turns, note } = await buildDialogueFromVirtualSession(sessionId);
  const stage = parseJsonLoose(vs.stageResults) || {};
  const pathId = str(vs.learningPathId) || str(stage?.path_review?.reviewedPathId) || null;
  const since = vs.createdAt;
  const enricher = await buildLessonKnowledge({ pathId, sessionId, since });
  const lesson = enricher || {
    provenance: 'none',
    lessonKnowledge: { blockedFoundations: [], recurringConfusions: [], knowledgeStateSummary: '', reusableFoundations: [] },
  };
  const replan = await buildPreviousStageOutcome({ pathId, sessionId, since });
  const C = pathId ? await buildNextStage(pathId) : { nextStage: null, subtasks: [], generatedBy: 'missing' as const };
  return {
    caseId: `session:${sessionId}`,
    source: { kind: 'session', pathId, sessionId },
    provenance: { dialogue: 'virtual-session-logs', B_lesson: lesson.provenance, B_outcome: replan.provenance, C: C.generatedBy || 'missing' },
    A: { personaSeed, visibleDialogueContext: turns, visibleDialogueNote: note },
    B: { lessonKnowledge: lesson.lessonKnowledge, previousStageOutcome: replan.previousStageOutcome },
    C,
  };
}

// ────────────────────────────── 判官调用 ──────────────────────────────

function buildJudgeUserMessage(payload: JudgePayload): string {
  return [
    `caseId: ${payload.caseId}`,
    `provenance: ${JSON.stringify(payload.provenance)}`,
    '',
    '【①A 课堂真相 · personaSeed】',
    JSON.stringify(payload.A.personaSeed, null, 1),
    '',
    '【①A 课堂真相 · visibleDialogueContext】',
    payload.A.visibleDialogueContext.length
      ? payload.A.visibleDialogueContext.map((turn) => [
        `--- 回合 ${turn.turn} ---`,
        `学习者：${turn.learner}`,
        `教师：${turn.teacher}`,
        turn.checkpoint ? `【卡片】${turn.checkpoint}` : '',
      ].filter(Boolean).join('\n')).join('\n')
      : `（空：${payload.A.visibleDialogueNote || '无课堂记录'}）`,
    '',
    '【②A 备课产出 · lesson-knowledge】',
    JSON.stringify(payload.B.lessonKnowledge, null, 1),
    '',
    '【③B 阶段复盘 · previousStageOutcome + replan-attribution】',
    JSON.stringify(payload.B.previousStageOutcome, null, 1),
    '',
    '【④C 下一阶段设计 · stage-designer subtasks】',
    payload.C.nextStage ? `下一阶段：${JSON.stringify(payload.C.nextStage)}` : '下一阶段信息缺失',
    JSON.stringify(payload.C.subtasks, null, 1),
    '',
    '请按三铁律判定并只输出 JSON。',
  ].join('\n');
}

async function judgePayload(payload: JudgePayload): Promise<JudgeVerdict> {
  const response: any = await getAPIGateway().execute(
    {
      ...(JUDGE_MODEL ? { model: JUDGE_MODEL } : {}),
      temperature: 0,
      max_tokens: 1800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: JUDGE_SYSTEM_PROMPT },
        { role: 'user', content: buildJudgeUserMessage(payload) },
      ],
    } as never,
    { skillId: 'qa-stage-quality-judge', action: 'judge' } as never,
    { requestPath: 'qa/stage-quality-judge' } as never,
  );
  const content = String(response?.choices?.[0]?.message?.content || '');
  const parsed = parseJsonLoose(content);
  if (!parsed) throw new Error(`JUDGE_OUTPUT_NOT_JSON: ${clip(content, 300)}`);
  const score = Number(parsed.score);
  return {
    verdict: parsed.verdict === 'pass' ? 'pass' : 'fail',
    score: Number.isFinite(score) ? score : (parsed.verdict === 'pass' ? 5 : 0),
    hallucination: parsed.hallucination || parsed.repetition,
    repetition: parsed.repetition,
    load: parsed.load,
    intervention: parsed.intervention,
    topIssue: clip(parsed.topIssue, 400),
  };
}

// ────────────────────────────── 黄金负样本（校准） ──────────────────────────────

function firstQuote(payload: JudgePayload): string {
  const turn = payload.A.visibleDialogueContext.find((item) => item.teacher && item.teacher.length > 20);
  if (turn) return clip(turn.teacher, 80);
  const base = payload.B.lessonKnowledge.blockedFoundations[0]
    || payload.B.previousStageOutcome?.strugglingConcepts[0]
    || '本阶段的核心概念';
  return clip(base, 80);
}

function mutateVerbatimCopy(base: JudgePayload): JudgePayload {
  const quote = firstQuote(base);
  return {
    ...base,
    caseId: `${base.caseId}#fake-verbatim-copy`,
    C: {
      ...base.C,
      subtasks: (base.C.subtasks.length ? base.C.subtasks : [{}]).slice(0, 3).map((task, index) => ({
        ...task,
        title: `复述老师讲过的「${clip(quote, 24)}」（第 ${index + 1} 遍）`,
        type: 'acquire',
        estimatedMinutes: 10,
        description: `把课堂上老师说的原话一字不差地背下来并写出来：「${quote}」。不需要换例子，也不需要判断新情况。`,
        acceptanceHint: '能一字不差复述老师原话即为通过。',
        anticipatedMisconceptions: [],
      })),
    },
  };
}

function mutateInvertedReport(base: JudgePayload): JudgePayload {
  // 黄金负样本「反向乱报」：B 的 blockedFoundations 明明白白列着未闭环的盲区，
  // previousStageOutcome 却反着报「已完全掌握、无需补强」，同时 C 抬难度——内部自相矛盾。
  return {
    ...base,
    caseId: `${base.caseId}#fake-inverted-report`,
    B: {
      ...base.B,
      previousStageOutcome: {
        strugglingConcepts: [],
        recommendation: 'keep',
        reason: '学习者已完全掌握，无任何遗留问题，可直接进入更高强度内容。',
        claim: '无需补强，直接跳级。',
        evidenceRefs: [],
      },
    },
    C: {
      ...base.C,
      subtasks: (base.C.subtasks.length ? base.C.subtasks : [{}]).slice(0, 3).map((task) => ({
        ...task,
        title: `直接上强度：${str(task.title) || '综合迁移任务'}`,
        estimatedMinutes: 45,
        cognitiveLevel: 'evaluate',
        description: `${clip(task.description, 300)}（不再铺垫，直接按已完全掌握处理，新增 3 个未讲过的概念。）`,
        anticipatedMisconceptions: [],
      })),
    },
  };
}

function mutateLoadSpike(base: JudgePayload): JudgePayload {
  const seed = base.C.subtasks[0] || {};
  const tasks = Array.from({ length: 6 }, (_, index) => ({
    title: `高强度综合任务 ${index + 1}：一次处理两个新概念`,
    type: 'execute',
    estimatedMinutes: 90,
    description: '不铺垫、不给例子，直接把两个未讲过的概念放进复杂情境里完成综合任务；做完再讲。',
    acceptanceHint: '',
    linkedConcept: `concept-new-${index + 1}`,
    knowledgeType: 'procedural',
    cognitiveLevel: 'evaluate',
    anticipatedMisconceptions: [],
    _seedTitle: str(seed.title),
  }));
  return {
    ...base,
    caseId: `${base.caseId}#fake-load-spike`,
    C: { ...base.C, subtasks: tasks },
  };
}

async function runCalibration(base: JudgePayload) {
  const fakes = [
    { name: 'verbatim-copy', label: '全抄原话（复述当迁移）', payload: mutateVerbatimCopy(base) },
    { name: 'inverted-report', label: '反向乱报（挣扎说成已掌握）', payload: mutateInvertedReport(base) },
    { name: 'load-spike', label: '高负荷加难（挣扎时堆 6×90 分钟新概念）', payload: mutateLoadSpike(base) },
  ];
  const results: any[] = [];
  let gate = true;
  for (const fake of fakes) {
    const verdict = await judgePayload(fake.payload);
    const caught = verdict.verdict === 'fail' && verdict.score <= 2;
    if (!caught) gate = false;
    results.push({ sample: fake.name, label: fake.label, caught, verdict });
    console.log(`[calibration] ${fake.name}: verdict=${verdict.verdict} score=${verdict.score} caught=${caught} issue=${verdict.topIssue || ''}`);
  }
  return { gate, results };
}

// ────────────────────────────── 主流程 ──────────────────────────────

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function selectBatchCases(limit: number): Promise<JudgePayload[]> {
  const paths = await db.learning_paths.findMany({ orderBy: { createdAt: 'desc' }, take: Math.max(limit, 1) });
  const cases: JudgePayload[] = [];
  for (const row of paths) {
    try {
      cases.push(await buildCaseFromPath(row.id, { dryRunStage: false }));
    } catch (error: any) {
      console.warn(`[batch] skip path ${row.id}: ${error?.message || error}`);
    }
  }
  return cases;
}

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function writeReport(name: string, data: unknown) {
  const target = path.join(OUT_DIR, name);
  fs.writeFileSync(target, `${JSON.stringify(data, null, 1)}\n`, 'utf8');
  console.log(`[report] ${target}`);
  return target;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const homogeneous = !JUDGE_MODEL;
  if (homogeneous) {
    console.warn('[judge] STAGE_JUDGE_MODEL 未设置：判官与平台默认模型同源（homogeneous=true）；校准可跑，但不作为最终放行依据。');
  }
  ensureOutDir();

  let basePayload: JudgePayload | null = null;
  if (typeof args['payload'] === 'string') {
    basePayload = JSON.parse(fs.readFileSync(args['payload'] as string, 'utf8')) as JudgePayload;
  } else if (typeof args['path'] === 'string') {
    basePayload = await buildCaseFromPath(args['path'] as string, { dryRunStage: Boolean(args['dry-run-stage']) });
  } else if (typeof args['session'] === 'string') {
    basePayload = await buildCaseFromSession(args['session'] as string);
  } else if (args['calibrate'] || args['batch']) {
    const latest = await db.learning_paths.findFirst({
      where: { totalMilestones: { gte: 2 } },
      orderBy: { createdAt: 'desc' },
    });
    if (latest) basePayload = await buildCaseFromPath(latest.id, { dryRunStage: Boolean(args['dry-run-stage']) });
  }

  if (!basePayload) {
    console.error('用法: --calibrate | --batch [--limit N] | --path <pathId> [--dry-run-stage] | --session <id> | --payload <file>');
    process.exitCode = 1;
    return;
  }

  if (args['calibrate']) {
    console.log(`[calibrate] base=${basePayload.caseId} provenance=${JSON.stringify(basePayload.provenance)}`);
    writeReport('calibration-base.json', basePayload);
    const calibration = await runCalibration(basePayload);
    writeReport('calibration.json', { judgeModel: JUDGE_MODEL || 'platform-default', homogeneous, ...calibration });
    if (!calibration.gate) {
      console.error('[calibrate] GATE FAILED：黄金负样本未全部被识别（需 verdict=fail 且 score≤2），禁止批跑。');
      process.exitCode = 1;
      return;
    }
    console.log('[calibrate] GATE PASSED：3 份黄金负样本全部判 fail 且 ≤2 分。');
    if (!args['batch']) return;
  }

  if (args['batch']) {
    const limit = Number(args['limit']) || 20;
    const cases = await selectBatchCases(limit);
    const results: any[] = [];
    for (const payload of cases) {
      if (!payload.C.subtasks.length) {
        results.push({ caseId: payload.caseId, skipped: true, reason: 'C 块缺失（下一阶段任务尚未生成；可加 --dry-run-stage）' });
        continue;
      }
      console.log(`[batch] judging ${payload.caseId} …`);
      try {
        const verdict = await judgePayload(payload);
        results.push({ caseId: payload.caseId, provenance: payload.provenance, verdict });
      } catch (error: any) {
        results.push({ caseId: payload.caseId, error: error?.message || String(error) });
      }
    }
    const judged = results.filter((item) => item.verdict);
    const passed = judged.filter((item) => item.verdict.verdict === 'pass').length;
    const summary = {
      judgeModel: JUDGE_MODEL || 'platform-default',
      homogeneous,
      total: results.length,
      judged: judged.length,
      passed,
      failed: judged.length - passed,
      passRate: judged.length ? Number((passed / judged.length).toFixed(3)) : null,
      results,
    };
    writeReport('batch.json', summary);
    console.log(`[batch] judged=${judged.length} passed=${passed} failed=${judged.length - passed}`);
    return;
  }

  // 单 case 模式
  writeReport('case-payload.json', basePayload);
  const verdict = await judgePayload(basePayload);
  writeReport('case-verdict.json', { judgeModel: JUDGE_MODEL || 'platform-default', homogeneous, caseId: basePayload.caseId, verdict });
  console.log(JSON.stringify(verdict, null, 1));
}

main()
  .catch((error) => {
    console.error('JUDGE_ERROR', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
