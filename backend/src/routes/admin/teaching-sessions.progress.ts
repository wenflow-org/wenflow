// 教学会话列表进度推导（遗留项「教学会话进度列」：后端补字段，不改写入链路、不加表）
// 数据源：仅用现有表 milestones / subtasks 推导——
// - taskIndex / totalTasks：会话当前任务在所在里程碑 subtasks（按 order 升序）中的序号（1-based）/ 总数
// - milestoneIndex / totalMilestones：会话所在里程碑在路径 milestones（按 order 升序）中的序号（1-based）/ 总数
// 会话无里程碑/任务关联（老数据或缺指针）→ null，前端显示 —
import prisma from '../../config/database';

export interface SessionProgress {
  taskIndex: number;
  totalTasks: number;
  milestoneIndex: number;
  totalMilestones: number;
}

export interface ProgressableSession {
  id: string;
  taskId: string | null;
  milestoneId: string | null;
  learningPathId: string | null;
}

interface OrderedRow {
  order: number | null;
  stageNumber?: number | null;
}

const rowOrder = (r: OrderedRow): number => r.order ?? r.stageNumber ?? 0;

/** 按行序把 id 列表排序（用 id → order 查表，避免二次查询） */
function sortIdsById(ids: string[], orderOf: (id: string) => number): string[] {
  return ids.sort((a, b) => orderOf(a) - orderOf(b));
}

/**
 * 批量推导一批教学会话的进度（固定 3~4 条聚合查询，不随行数放大）。
 * 双阶段取任务：先按 taskId/milestoneId 定位，若会话缺 milestoneId 则由任务补出
 * 所属里程碑后补取该里程碑的完整任务序（保证 totalTasks 与位置一致）。
 */
export async function deriveTeachingSessionProgress(
  sessions: ProgressableSession[]
): Promise<Map<string, SessionProgress | null>> {
  const progressById = new Map<string, SessionProgress | null>();
  if (sessions.length === 0) return progressById;

  const milestoneIds = Array.from(new Set(sessions.map((s) => s.milestoneId).filter((x): x is string => !!x)));
  const taskIds = Array.from(new Set(sessions.map((s) => s.taskId).filter((x): x is string => !!x)));
  const pathIds = Array.from(new Set(sessions.map((s) => s.learningPathId).filter((x): x is string => !!x)));

  const [milestoneRows, pathRows, subtaskRows] = await Promise.all([
    milestoneIds.length
      ? prisma.milestones.findMany({ where: { id: { in: milestoneIds } }, select: { id: true, learningPathId: true } })
      : Promise.resolve([]),
    pathIds.length
      ? prisma.milestones.findMany({
          where: { learningPathId: { in: pathIds } },
          select: { id: true, learningPathId: true, order: true, stageNumber: true }
        })
      : Promise.resolve([]),
    taskIds.length || milestoneIds.length
      ? prisma.subtasks.findMany({
          where: { OR: [{ id: { in: taskIds } }, { milestoneId: { in: milestoneIds } }] },
          select: { id: true, milestoneId: true, order: true }
        })
      : Promise.resolve([])
  ]);

  // 任务 → 所属里程碑；里程碑 → 任务 id 列表（order 查表）
  const taskMilestone = new Map<string, string>();
  const milestoneTasks = new Map<string, string[]>();
  const taskOrderOf = new Map<string, number>();
  for (const t of subtaskRows) {
    taskMilestone.set(t.id, t.milestoneId);
    taskOrderOf.set(t.id, t.order ?? 0);
    const list = milestoneTasks.get(t.milestoneId) || [];
    list.push(t.id);
    milestoneTasks.set(t.milestoneId, list);
  }

  // 缺 milestoneId 的会话：由任务补出所属里程碑，再补取该里程碑完整任务序
  const derivedMilestoneIds = Array.from(new Set(
    sessions
      .filter((s) => !s.milestoneId && s.taskId && taskMilestone.has(s.taskId))
      .map((s) => taskMilestone.get(s.taskId as string) as string)
  ));
  const derivedMilestoneIdsSet = new Set(milestoneIds);
  const missingMilestoneIds = derivedMilestoneIds.filter((m) => !derivedMilestoneIdsSet.has(m));
  if (missingMilestoneIds.length > 0) {
    const extraTasks = await prisma.subtasks.findMany({
      where: { milestoneId: { in: missingMilestoneIds } },
      select: { id: true, milestoneId: true, order: true }
    });
    for (const t of extraTasks) {
      taskMilestone.set(t.id, t.milestoneId);
      taskOrderOf.set(t.id, t.order ?? 0);
      const list = milestoneTasks.get(t.milestoneId) || [];
      if (!list.includes(t.id)) list.push(t.id);
      milestoneTasks.set(t.milestoneId, list);
    }
  }

  // 里程碑 → 所属路径
  const milestonePath = new Map<string, string>();
  for (const m of milestoneRows) milestonePath.set(m.id, m.learningPathId);

  // 路径 → 里程碑 id 列表（order 查表）
  const pathMilestones = new Map<string, string[]>();
  const milestoneOrderOf = new Map<string, number>();
  for (const m of pathRows) {
    milestoneOrderOf.set(m.id, rowOrder(m));
    const list = pathMilestones.get(m.learningPathId) || [];
    list.push(m.id);
    pathMilestones.set(m.learningPathId, list);
  }

  for (const list of milestoneTasks.values()) sortIdsById(list, (id) => taskOrderOf.get(id) ?? 0);
  for (const list of pathMilestones.values()) sortIdsById(list, (id) => milestoneOrderOf.get(id) ?? 0);

  for (const session of sessions) {
    const milestoneId =
      session.milestoneId || (session.taskId ? taskMilestone.get(session.taskId) || null : null);
    const pathId =
      (milestoneId ? milestonePath.get(milestoneId) : undefined) || session.learningPathId || null;

    const tasks = milestoneId ? milestoneTasks.get(milestoneId) : undefined;
    const taskPosition = tasks && session.taskId ? tasks.indexOf(session.taskId) : -1;

    const milestones = pathId ? pathMilestones.get(pathId) : undefined;
    const milestonePosition = milestones && milestoneId ? milestones.indexOf(milestoneId) : -1;

    const progress =
      taskPosition >= 0 || milestonePosition >= 0
        ? {
            taskIndex: taskPosition >= 0 ? taskPosition + 1 : 0,
            totalTasks: tasks ? tasks.length : 0,
            milestoneIndex: milestonePosition >= 0 ? milestonePosition + 1 : 0,
            totalMilestones: milestones ? milestones.length : 0
          }
        : null;
    progressById.set(session.id, progress);
  }

  return progressById;
}
