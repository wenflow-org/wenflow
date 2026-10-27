/**
 * 路径结构确定性审计（2026-10-24，离线评审基线：前置缺失 30%、重复任务 20%）
 *
 * 只做机械可判的三件事，不调用模型：
 * 1. 前置缺口：`kcGraph.edges` 的 from 是 to 的前置；若某个后继 KC 已被任务使用，
 *    而前置 KC 从未被任何任务引入，或首次出现的任务晚于后继 → 缺口。
 * 2. 重复任务：任务标题归一后重复。
 * 3. 课时偏差：任务总分钟与「守恒后计划 after」明显不符，且没有交付缩水声明。
 *
 * 输出写入 `aiPromptTemplate.pathAudit`（JSON，无需迁移），供离线评审与后续生成修复消费。
 * 不删除/重排任何任务——自动修复要等这批审计数据确认误报率后再做。
 */
export interface PathAuditKcAnnotation {
  conceptKcs?: Array<{ conceptId?: unknown; kcs?: Array<{ kcId?: unknown; name?: unknown }> }>;
  kcGraph?: {
    nodes?: Array<{ kcId?: unknown; name?: unknown }>;
    edges?: Array<{ from?: unknown; to?: unknown; relation?: unknown }>;
  };
  taskKcLinks?: Array<{ taskTitle?: unknown; linkedKCs?: unknown; kcIds?: unknown; linkedKcIds?: unknown; kcs?: unknown }>;
  [key: string]: unknown;
}

export interface PathAuditTask {
  title: string;
  stageNumber: number;
  order: number;
  /** 任务说明（可判定「前置 KC 是否在前序任务里被隐式引入」） */
  description?: string;
}

export type PathAuditIssueKind = 'prerequisite-gap' | 'duplicate-task' | 'budget-mismatch';

export interface PathAuditIssue {
  kind: PathAuditIssueKind;
  severity: 'low' | 'medium' | 'high';
  detail: string;
}

export interface PathAuditResult {
  issues: PathAuditIssue[];
  stats: {
    tasks: number;
    linkedTasks: number;
    kcs: number;
    prerequisiteEdges: number;
    missingPrerequisiteKcs: number;
    latePrerequisiteEdges: number;
    /** 同阶段内「前置任务排在后继之后」的条数（可直接重排修复） */
    lateWithinStage: number;
    /** 跨阶段「前置任务排在后继之后」的条数（需移动任务/阶段，暂只审计） */
    lateCrossStage: number;
    duplicateTitles: number;
    budgetRatio: number | null;
  };
}

const norm = (s: unknown): string => String(s ?? '').replace(/\s+/g, '').toLowerCase();

interface TaskKcLinkLike {
  taskTitle?: unknown;
  linkedKCs?: unknown;
  kcIds?: unknown;
  linkedKcIds?: unknown;
  kcs?: unknown;
}

function linkedKcIds(link: TaskKcLinkLike | undefined): string[] {
  if (!link) return [];
  const raw = link.linkedKCs ?? link.kcIds ?? link.linkedKcIds ?? link.kcs;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item ?? '').trim()).filter(Boolean);
}

export function auditPathStructure(input: {
  kcAnnotation: PathAuditKcAnnotation | null | undefined;
  tasks: PathAuditTask[];
  totalMinutes?: number;
  afterHours?: number | null;
  /** 守恒层交付声明；'none' = 未声明缩水 */
  delivery?: string | null;
}): PathAuditResult {
  const issues: PathAuditIssue[] = [];
  const ann = input.kcAnnotation || {};
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const normalizedTaskTitle = new Map<string, number>();
  tasks.forEach((task, index) => {
    const key = norm(task.title);
    if (key && !normalizedTaskTitle.has(key)) normalizedTaskTitle.set(key, index);
  });

  const links = Array.isArray(ann.taskKcLinks) ? ann.taskKcLinks : [];
  const kcFirstTask = new Map<string, number>();
  const kcTaskTitle = new Map<string, string>();
  let linkedTasks = 0;
  for (const link of links) {
    const taskIndex = normalizedTaskTitle.get(norm(link?.taskTitle));
    const kcIds = linkedKcIds(link);
    if (taskIndex === undefined || kcIds.length === 0) continue;
    linkedTasks += 1;
    for (const kcId of kcIds) {
      const prior = kcFirstTask.get(kcId);
      if (prior === undefined || taskIndex < prior) {
        kcFirstTask.set(kcId, taskIndex);
        kcTaskTitle.set(kcId, tasks[taskIndex].title);
      }
    }
  }

  const groups = Array.isArray(ann.conceptKcs) ? ann.conceptKcs : [];
  const kcs = groups.reduce((sum, group) => sum + (Array.isArray(group?.kcs) ? group.kcs.length : 0), 0);
  // KC 名称（用于「前序任务是否已隐式引入」判定）：概念组内的 kcs[].name 优先，
  // 缺失时回退 kcGraph.nodes[].name。
  const kcNameById = new Map<string, string>();
  for (const group of groups) {
    for (const kc of Array.isArray(group?.kcs) ? group.kcs : []) {
      const kcId = String(kc?.kcId ?? '').trim();
      const name = String(kc?.name ?? '').trim();
      if (kcId && name) kcNameById.set(kcId, name);
    }
  }
  for (const node of Array.isArray(ann.kcGraph?.nodes) ? ann.kcGraph!.nodes! : []) {
    const kcId = String(node?.kcId ?? '').trim();
    const name = String(node?.name ?? '').trim();
    if (kcId && name && !kcNameById.has(kcId)) kcNameById.set(kcId, name);
  }
  /**
   * 前置 KC 是否在 `beforeIndex` 之前的任务里被隐式引入（标题/说明提到 KC 名）。
   * 只靠 taskKcLinks 会把「任务顺带讲了前置概念但没显式挂链接」误报成缺口。
   */
  const mentionedBefore = (kcId: string, beforeIndex: number): boolean => {
    const name = kcNameById.get(kcId);
    if (!name) return false;
    const needle = norm(name);
    if (!needle) return false;
    return tasks.slice(0, beforeIndex).some((task) => norm(`${task.title} ${task.description || ''}`).includes(needle));
  };
  const edges = Array.isArray(ann.kcGraph?.edges) ? ann.kcGraph.edges : [];
  const prerequisiteEdges = edges.filter((edge) => {
    const relation = String(edge?.relation ?? 'prerequisite');
    return relation === 'prerequisite';
  });
  let missingPrerequisiteKcs = 0;
  let latePrerequisiteEdges = 0;
  let lateWithinStage = 0;
  let lateCrossStage = 0;
  for (const edge of prerequisiteEdges) {
    const from = String(edge?.from ?? '').trim();
    const to = String(edge?.to ?? '').trim();
    if (!from || !to || from === to) continue;
    const toIndex = kcFirstTask.get(to);
    if (toIndex === undefined) continue; // 后继 KC 没被任何任务使用，不构成路径缺口
    const fromIndex = kcFirstTask.get(from);
    if (fromIndex === undefined) {
      if (mentionedBefore(from, toIndex)) continue;
      missingPrerequisiteKcs += 1;
      issues.push({
        kind: 'prerequisite-gap',
        severity: 'medium',
        detail: `前置 KC ${from} 未被任何任务引入，但任务「${tasks[toIndex].title}」已依赖 ${to}`,
      });
      continue;
    }
    if (fromIndex > toIndex) {
      if (mentionedBefore(from, toIndex)) continue;
      latePrerequisiteEdges += 1;
      if (tasks[fromIndex].stageNumber === tasks[toIndex].stageNumber) lateWithinStage += 1;
      else lateCrossStage += 1;
      issues.push({
        kind: 'prerequisite-gap',
        // 2026-10-26 降噪（外部评审悖论2）：前置边来自 kc-mapper 事后自画（temperature 0.3，
        // 重跑就变），「首次引入点」判定与任务顺序冲突是系统性现象——最近 40/40 条路径
        // 全报本类 issue（109 条），severity=high 已无信号价值。降为 low 留观测，
        // 待审计对齐 cognitiveCore 概念级前置（真正的修复）后再恢复。
        severity: 'low',
        detail: `前置 KC ${from} 首次出现在任务「${kcTaskTitle.get(from)}」（第 ${fromIndex + 1} 个），`
          + `晚于依赖它的任务「${tasks[toIndex].title}」（第 ${toIndex + 1} 个）`,
      });
    }
  }

  const titleCounts = new Map<string, number>();
  for (const task of tasks) {
    const key = norm(task.title);
    if (!key) continue;
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  }
  const duplicateTitles = [...titleCounts.values()].filter((count) => count > 1).length;
  for (const [key, count] of titleCounts.entries()) {
    if (count <= 1) continue;
    const sample = tasks.find((task) => norm(task.title) === key)?.title || key;
    issues.push({
      kind: 'duplicate-task',
      severity: 'low',
      detail: `任务标题重复 ${count} 次：「${sample}」`,
    });
  }

  const totalMinutes = Number(input.totalMinutes);
  const afterMinutes = Number(input.afterHours) > 0 ? Number(input.afterHours) * 60 : null;
  const budgetRatio = afterMinutes && totalMinutes > 0 ? totalMinutes / afterMinutes : null;
  if (budgetRatio !== null && (budgetRatio < 0.5 || budgetRatio > 2) && input.delivery !== 'path' && input.delivery !== 'stage') {
    issues.push({
      kind: 'budget-mismatch',
      severity: budgetRatio > 3 || budgetRatio < 0.25 ? 'high' : 'medium',
      detail: `任务总分钟 ${totalMinutes} 与守恒后计划 ${Math.round(afterMinutes!)} 分钟比值 ${budgetRatio.toFixed(2)}，且无交付缩水声明`,
    });
  }

  return {
    issues: issues.slice(0, 50),
    stats: {
      tasks: tasks.length,
      linkedTasks,
      kcs,
      prerequisiteEdges: prerequisiteEdges.length,
      missingPrerequisiteKcs,
      latePrerequisiteEdges,
      lateWithinStage,
      lateCrossStage,
      duplicateTitles,
      budgetRatio: budgetRatio === null ? null : Math.round(budgetRatio * 100) / 100,
    },
  };
}

/**
 * 同阶段内按 KC 前置关系稳定重排（生成期使用）。
 *
 * 只处理「前置 KC 与本任务在同一阶段」的边：把前置任务挪到依赖它的任务之前。
 * 跨阶段依赖不在这里动（移动任务会改变阶段语义，留审计）。
 * 有环/无法排序时保持原顺序，绝不丢任务。
 */
export function reorderTasksForPrerequisites<T extends { title?: unknown; type?: unknown }>(
  tasks: T[],
  kcAnnotation: PathAuditKcAnnotation | null | undefined,
): { tasks: T[]; changed: boolean; reorderedEdges: number } {
  const ann = kcAnnotation || {};
  const original = Array.isArray(tasks) ? tasks : [];
  if (original.length < 2) return { tasks: original, changed: false, reorderedEdges: 0 };

  // 认知动作权重守卫（2026-10-27 R7-1）：本重排在 orderStageTasksByTopology 之后运行，
  // 而 KC 边只表达知识依赖、不表达「收束动作的宾语由应用档产出」这一物理事实。
  // 无守卫时 R6 实测 14/14 条路径的收束档（refine/consolidate）被边重排又拉回建立档之前。
  // 只拦一个方向：收束档不得被前移到建立/应用档之前；反向（建立档前移）照常放行。
  const closingRank = (task: T): number =>
    ['refine', 'consolidate'].includes(String((task as any)?.type || '').trim()) ? 1 : 0;

  const taskIndexByTitle = new Map<string, number>();
  original.forEach((task, index) => {
    const key = norm(task?.title);
    if (key && !taskIndexByTitle.has(key)) taskIndexByTitle.set(key, index);
  });
  const kcToTask = new Map<string, number>();
  for (const link of Array.isArray(ann.taskKcLinks) ? ann.taskKcLinks : []) {
    const index = taskIndexByTitle.get(norm(link?.taskTitle));
    if (index === undefined) continue;
    for (const kcId of linkedKcIds(link)) {
      if (!kcToTask.has(kcId)) kcToTask.set(kcId, index);
    }
  }

  const constraints: Array<[string, string]> = [];
  const keyOfKc = new Map<string, string>();
  for (const [kcId, index] of kcToTask) {
    const key = norm(original[index]?.title);
    if (key) keyOfKc.set(kcId, key);
  }
  let reorderedEdges = 0;
  for (const edge of Array.isArray(ann.kcGraph?.edges) ? ann.kcGraph!.edges! : []) {
    const from = String(edge?.from ?? '').trim();
    const to = String(edge?.to ?? '').trim();
    if (!from || !to || from === to) continue;
    const fromIndex = kcToTask.get(from);
    const toIndex = kcToTask.get(to);
    if (fromIndex === undefined || toIndex === undefined || fromIndex === toIndex) continue;
    const fromKey = keyOfKc.get(from);
    const toKey = keyOfKc.get(to);
    if (!fromKey || !toKey || fromKey === toKey) continue;
    // R7-1 守卫：收束档（refine/consolidate）不得被前移到建立/应用档之前。
    if (closingRank(original[fromIndex]) > closingRank(original[toIndex])) continue;
    constraints.push([fromKey, toKey]);
    if (fromIndex > toIndex) reorderedEdges += 1;
  }
  if (reorderedEdges === 0 || constraints.length === 0) {
    return { tasks: original, changed: false, reorderedEdges: 0 };
  }

  // 「前移到依赖之前」而非全量拓扑：保持无关任务的相对顺序，改动面最小。
  const list = [...original];
  const maxPasses = Math.max(4, original.length);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let moved = false;
    for (const [fromKey, toKey] of constraints) {
      const fromIndex = list.findIndex((task) => norm(task?.title) === fromKey);
      const toIndex = list.findIndex((task) => norm(task?.title) === toKey);
      if (fromIndex < 0 || toIndex < 0 || fromIndex < toIndex) continue;
      const [item] = list.splice(fromIndex, 1);
      list.splice(toIndex, 0, item);
      moved = true;
    }
    if (!moved) break;
  }
  const satisfied = constraints.every(([fromKey, toKey]) => {
    const fromIndex = list.findIndex((task) => norm(task?.title) === fromKey);
    const toIndex = list.findIndex((task) => norm(task?.title) === toKey);
    return fromIndex < 0 || toIndex < 0 || fromIndex < toIndex;
  });
  if (!satisfied) {
    // 有环：保持原顺序（不丢任务、不制造新的前后矛盾）
    return { tasks: original, changed: false, reorderedEdges: 0 };
  }
  const changed = list.some((task, index) => task !== original[index]);
  return { tasks: list, changed, reorderedEdges };
}
