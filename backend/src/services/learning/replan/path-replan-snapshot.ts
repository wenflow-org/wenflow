/**
 * 重排快照与回退（2026-09-29，R8 / 用户拍板选项 B：快照 + 一键回退）
 *
 * 背景：重规划此前只有 overwrite 模式（new_version 抛 PATH_VERSIONING_NOT_SUPPORTED），
 * 调整后旧安排永久消失——用户无法对比、无法后悔（doc/local/overnight-20260928 审核实证）。
 * 完整路径版本化（版本链/进度迁移/前后对比 UI）成本高且引入指针与统计口径难题；
 * 本模块提供轻量替代：重排前把**范围内阶段的完整内容**存成快照（含任务原文），
 * 用户可一键回退到重排前。
 *
 * 存储：写进 learning_paths.aiPromptTemplate.replanSnapshots（LIFO，最多 KEEP_LATEST_SNAPSHOTS 条）。
 * 理由：① 免 schema 迁移；② 与重排同一 JSON 列，写路径已在维护该列，读取方对未知键宽容；
 * ③ 快照体量与模板同量级（只存被重排阶段，不含全部路径）。
 *
 * 回退语义（保守优先，不倒退学习进度）：
 * - 删除：当前存在但快照没有的任务（= 重排新增）；
 * - 恢复：快照里的任务按原 id upsert（原文/分钟/顺序/概念绑定全部回原值）；
 * - **进度保护**：若某任务现在是 completed，回退不把它退回 todo（学过的不倒退）；
 * - 阶段元数据（title/description/goal/estimatedHours/概念绑定）回原值；
 * - 路径总时按回退后任务分钟重新汇总。
 */

/** 宽松行类型：入参来自 Prisma 查询结果与 JSON 模板，字段按需取值并显式收敛 */
type LooseRow = Record<string, unknown>;

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}
function asNumberOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function asNumberOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function asIsoOrNull(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 快照里的任务原文（还原所需全部字段；与 subtasks 表列对齐） */
export interface ReplanTaskSnapshot {
  id: string;
  title: string;
  description: string | null;
  taskType: string;
  estimatedMinutes: number;
  acceptanceCriteria: string | null;
  order: number;
  status: string;
  completedAt: string | null;
  rating: number | null;
  feedback: string | null;
  cognitiveLoad: string;
  cognitiveLevel: string | null;
  icapLevel: string | null;
  coreConcept: string | null;
  linkedConceptId: string | null;
  linkedConceptName: string | null;
  conceptId: string | null;
  knowledgeType: string | null;
  displayLabel: string | null;
  transferable: boolean | null;
  learningObjectives: string | null;
  annotationConfidence: number | null;
}

export interface ReplanMilestoneSnapshot {
  id: string;
  stageNumber: number;
  title: string;
  description: string | null;
  goal: string | null;
  estimatedHours: number | null;
  status: string;
  order: number;
  coreConceptId: string | null;
  coreConceptName: string | null;
  conceptId: string | null;
  subtasks: ReplanTaskSnapshot[];
}

export interface PathReplanContentSnapshot {
  id: string;
  pathId: string;
  createdAt: string;
  reason: string | null;
  triggerSource: string | null;
  mode: string;
  fromStageNumber: number | null;
  stageNumbers: number[];
  /** 重排前的任务 id 全集（回退时判定「哪些是新增」的基准） */
  priorTaskIds: string[];
  pathEstimatedHours: number | null;
  milestones: ReplanMilestoneSnapshot[];
}

/** 模板里保留的快照条数上限（LIFO，防 JSON 列无限膨胀） */
export const KEEP_LATEST_SNAPSHOTS = 5;

function toTaskSnapshot(t: LooseRow): ReplanTaskSnapshot {
  return {
    id: String(t.id ?? ''),
    title: asString(t.title) ?? '',
    description: asString(t.description),
    taskType: asString(t.taskType) ?? 'practice',
    estimatedMinutes: asNumberOr(t.estimatedMinutes, 0),
    acceptanceCriteria: asString(t.acceptanceCriteria),
    order: asNumberOr(t.order, 0),
    status: asString(t.status) ?? 'todo',
    completedAt: asIsoOrNull(t.completedAt),
    rating: asNumberOrNull(t.rating),
    feedback: asString(t.feedback),
    cognitiveLoad: asString(t.cognitiveLoad) ?? 'medium',
    cognitiveLevel: asString(t.cognitiveLevel),
    icapLevel: asString(t.icapLevel),
    coreConcept: asString(t.coreConcept),
    linkedConceptId: asString(t.linkedConceptId),
    linkedConceptName: asString(t.linkedConceptName),
    conceptId: asString(t.conceptId),
    knowledgeType: asString(t.knowledgeType),
    displayLabel: asString(t.displayLabel),
    transferable: typeof t.transferable === 'boolean' ? t.transferable : null,
    learningObjectives: asString(t.learningObjectives),
    annotationConfidence: asNumberOrNull(t.annotationConfidence),
  };
}

function toMilestoneSnapshot(m: LooseRow): ReplanMilestoneSnapshot {
  const subtasks = Array.isArray(m.subtasks) ? (m.subtasks as LooseRow[]) : [];
  return {
    id: String(m.id ?? ''),
    stageNumber: asNumberOr(m.stageNumber, 0),
    title: asString(m.title) ?? '',
    description: asString(m.description),
    goal: asString(m.goal),
    estimatedHours: asNumberOrNull(m.estimatedHours),
    status: asString(m.status) ?? 'locked',
    order: asNumberOr(m.order, 0),
    coreConceptId: asString(m.coreConceptId),
    coreConceptName: asString(m.coreConceptName),
    conceptId: asString(m.conceptId),
    subtasks: subtasks.map(toTaskSnapshot),
  };
}

/** 构建内容快照：milestones 需含 subtasks（按 order 升序读入） */
export function buildReplanContentSnapshot(input: {
  pathId: string;
  milestones: LooseRow[];
  reason?: string | null;
  triggerSource?: string | null;
  mode?: string | null;
  fromStageNumber?: number | null;
  pathEstimatedHours?: number | null;
  snapshotId?: string;
  now?: Date;
}): PathReplanContentSnapshot {
  const milestones = (input.milestones || []).map(toMilestoneSnapshot);
  const now = input.now || new Date();
  return {
    id: input.snapshotId || `rps_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
    pathId: input.pathId,
    createdAt: now.toISOString(),
    reason: input.reason ?? null,
    triggerSource: input.triggerSource ?? null,
    mode: input.mode || 'overwrite',
    fromStageNumber: input.fromStageNumber ?? null,
    stageNumbers: milestones.map((m) => m.stageNumber).sort((a, b) => a - b),
    priorTaskIds: milestones.flatMap((m) => m.subtasks.map((t) => t.id)).sort(),
    pathEstimatedHours: asNumberOrNull(input.pathEstimatedHours),
    milestones,
  };
}

/** 读取模板里的快照列表（宽容：非数组/坏条目一律忽略） */
export function readReplanSnapshots(
  parsedTemplate: Record<string, unknown> | null | undefined,
): PathReplanContentSnapshot[] {
  const raw = parsedTemplate?.replanSnapshots;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is PathReplanContentSnapshot =>
      !!s && typeof s === 'object'
      && typeof (s as { id?: unknown }).id === 'string'
      && Array.isArray((s as { milestones?: unknown }).milestones),
  );
}

/** 追加快照（LIFO 截断），返回新模板对象（不改入参） */
export function appendReplanSnapshot(
  parsedTemplate: Record<string, unknown> | null | undefined,
  snapshot: PathReplanContentSnapshot,
): Record<string, unknown> {
  const existing = readReplanSnapshots(parsedTemplate);
  const next = [snapshot, ...existing].slice(0, KEEP_LATEST_SNAPSHOTS);
  return { ...(parsedTemplate || {}), replanSnapshots: next };
}

/** 取最新快照（可选按 id） */
export function latestReplanSnapshot(
  parsedTemplate: Record<string, unknown> | null | undefined,
  snapshotId?: string | null,
): PathReplanContentSnapshot | null {
  const all = readReplanSnapshots(parsedTemplate);
  if (!all.length) return null;
  if (snapshotId) return all.find((s) => s.id === snapshotId) || null;
  return all[0];
}

/** 回退计划（纯函数，供 service 执行） */
export interface RollbackPlan {
  /** 需删除的任务 id（重排新增的） */
  taskIdsToDelete: string[];
  /** 需恢复/重建的快照任务（含进度保护后的最终 status） */
  tasksToRestore: ReplanTaskSnapshot[];
  /** 阶段元数据恢复目标 */
  milestonesToRestore: Array<
    Pick<ReplanMilestoneSnapshot, 'id' | 'title' | 'description' | 'goal' | 'estimatedHours' | 'coreConceptId' | 'coreConceptName' | 'conceptId'>
  >;
  /** 回退后路径总时（按恢复后任务分钟汇总） */
  pathEstimatedHoursAfter: number | null;
  warnings: string[];
}

/**
 * 计算回退计划。
 * @param snapshot          目标快照
 * @param currentMilestones 当前路径的阶段（含 subtasks）
 */
export function buildRollbackPlan(
  snapshot: PathReplanContentSnapshot,
  currentMilestones: LooseRow[],
): RollbackPlan {
  const warnings: string[] = [];
  const snapshotStageNumbers = new Set(snapshot.stageNumbers);
  const snapshotTaskIds = new Set(snapshot.priorTaskIds);

  const currentByStage = new Map<number, LooseRow>();
  for (const m of currentMilestones || []) currentByStage.set(asNumberOr(m?.stageNumber, 0), m);

  // 删除：当前阶段里不在快照 priorTaskIds 中的任务（= 本次重排新增）
  const taskIdsToDelete: string[] = [];
  for (const stageNumber of [...snapshotStageNumbers].sort((a, b) => a - b)) {
    const current = currentByStage.get(stageNumber);
    if (!current) {
      warnings.push(`阶段 ${stageNumber} 当前不存在，跳过其任务清理`);
      continue;
    }
    const tasks = Array.isArray(current.subtasks) ? (current.subtasks as LooseRow[]) : [];
    for (const t of tasks) {
      const id = String(t?.id ?? '');
      if (id && !snapshotTaskIds.has(id)) taskIdsToDelete.push(id);
    }
  }

  // 进度保护：现任务 completed 而快照非 completed → 保留 completed（不倒退）
  const liveStatusById = new Map<string, { status: string; completedAt: string | null }>();
  for (const m of currentMilestones || []) {
    const tasks = Array.isArray(m?.subtasks) ? (m.subtasks as LooseRow[]) : [];
    for (const t of tasks) {
      const id = String(t?.id ?? '');
      if (!id) continue;
      liveStatusById.set(id, { status: String(t.status ?? ''), completedAt: asIsoOrNull(t.completedAt) });
    }
  }
  let progressLocked = 0;
  const tasksToRestore = snapshot.milestones.flatMap((m) =>
    m.subtasks.map((t) => {
      const live = liveStatusById.get(t.id);
      if (live && live.status === 'completed' && t.status !== 'completed') {
        progressLocked += 1;
        return { ...t, status: 'completed', completedAt: live.completedAt || t.completedAt };
      }
      return t;
    }),
  );

  const milestonesToRestore = snapshot.milestones.map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    goal: m.goal,
    estimatedHours: m.estimatedHours,
    coreConceptId: m.coreConceptId,
    coreConceptName: m.coreConceptName,
    conceptId: m.conceptId,
  }));

  const totalMinutes = tasksToRestore.reduce((sum, t) => sum + (Number(t.estimatedMinutes) || 0), 0);
  const pathEstimatedHoursAfter = totalMinutes > 0 ? Math.ceil(totalMinutes / 60) : snapshot.pathEstimatedHours;

  if (progressLocked > 0) {
    warnings.push(`${progressLocked} 个任务已开始学习，回退保留其完成进度`);
  }

  return { taskIdsToDelete, tasksToRestore, milestonesToRestore, pathEstimatedHoursAfter, warnings };
}
