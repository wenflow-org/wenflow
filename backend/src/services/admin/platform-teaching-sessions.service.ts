import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { isTestAccountUser } from '../../utils/test-account';
import { buildNonVirtualUserWhere } from '../../utils/test-account';
import { deriveTeachingSessionProgress } from '../teaching-session-progress.service';
import { parseClosureObservation, type ClosureObservation } from '../learning/closure-observability';

/**
 * 教学会话调试视图（GET /api/admin/teaching-sessions 的数据层）。
 * 由 routes/admin/platform.ts 下沉：聚焦 wrapup / advisory，列表进度由 milestones/subtasks 现表推导。
 */

/** 行级收束观测（#105 读侧接入）：轨道 + 通道，来自统一收束事件（learner_evidence 已投影行） */
export interface SessionClosureObservation {
  track: ClosureObservation['track'];
  completionSource: string;
}

/**
 * #105 读侧接入：按会话任务批量取收束事件（task:completed 的 learner_evidence 行）。
 * 事件写入侧见 task-completion.service.ts（payload 带 track/completionSource/sessionId），
 * 解析口径单点在 closure-observability.ts——本函数只做 taskId 关联，不在此处解释语义。
 * 一个任务只结算一次（completeTask 幂等），多行时取最新一条；查无记录返回 null
 * （前端按「无收束记录」中性呈现，不用用户 isVirtualLearner 回填、不猜）。
 */
async function loadClosureByTaskId(taskIds: string[]): Promise<Map<string, SessionClosureObservation>> {
  const byTaskId = new Map<string, SessionClosureObservation>();
  if (taskIds.length === 0) return byTaskId;
  const rows = await prisma.learner_evidence.findMany({
    where: { evidenceType: 'task:completed', taskId: { in: taskIds } },
    orderBy: { occurredAt: 'desc' },
    select: { taskId: true, payload: true },
  });
  for (const row of rows) {
    if (!row.taskId || byTaskId.has(row.taskId)) continue; // 最新一条为准
    const observed = parseClosureObservation('task:completed', row.payload);
    if (!observed) continue;
    byTaskId.set(row.taskId, { track: observed.track, completionSource: observed.completionSource });
  }
  return byTaskId;
}

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * 列表用到的两个「库里算」事实：
 *  - userCount：只数用户消息（口径与改造前逐字一致）
 *  - endReason：收束原因（manual-end / task-completed / learner-abandoned，老会话为 null）
 *
 * 原实现为消息数把 `messages` 整列 JSON 读进 Node 再 JSON.parse 过滤：该列合计 **197.7MB**
 * （单行最大 3.3MB），而列表页请求的是 `limit=1000`（真实用户 215 行 / 含测试 472 行），
 * 2026-09-29 实测 2.4s / 4.4s。计数搬进库后这 197MB 不再出库。
 *
 * endReason 同理：它在 teachingState.sessionArtifacts 里，teachingState 是 10~20KB 的大 JSON 列，
 * 整列进 Node 没有意义；这里只用 JSON1 取一个标量（`json_extract`），与消息计数共用一次扫描。
 * schema 里不新增列，历史会话也能直接读到，无需回填。
 *
 * 口径沿用双读过渡（见 schema `teaching_session_messages` 注释）：**侧表有行即权威**；
 * 无侧表行的历史会话回退 `messages` 列，回退分支用 json_each 在库内解析，同样不出库。
 */
interface SessionFacts {
  userCount: number;
  endReason: string | null;
}

async function sessionFactsById(ids: string[]): Promise<Map<string, SessionFacts>> {
  const facts = new Map<string, SessionFacts>();
  if (ids.length === 0) return facts;
  const rows = await prisma.$queryRaw<Array<{ id: string; userCount: number | bigint; endReason: string | null }>>`
    SELECT s.id AS id,
      CASE
        WHEN EXISTS (SELECT 1 FROM teaching_session_messages m WHERE m.sessionId = s.id)
          THEN (SELECT COUNT(*) FROM teaching_session_messages m
                WHERE m.sessionId = s.id AND json_valid(m.payload)
                  AND json_extract(m.payload, '$.role') = 'user')
        WHEN json_valid(s.messages) AND json_type(s.messages) = 'array'
          THEN (SELECT COUNT(*) FROM json_each(s.messages)
                WHERE json_extract(value, '$.role') = 'user')
        ELSE 0
      END AS userCount,
      CASE
        WHEN json_valid(s.teachingState)
          THEN json_extract(s.teachingState, '$.sessionArtifacts.endReason')
        ELSE NULL
      END AS endReason
    FROM teaching_sessions s
    WHERE s.id IN (${Prisma.join(ids)})
  `;
  for (const row of rows) {
    facts.set(row.id, {
      userCount: Number(row.userCount),
      endReason: typeof row.endReason === 'string' && row.endReason ? row.endReason : null,
    });
  }
  return facts;
}

export async function listTeachingSessionsDebug(params: {
  page: number;
  limit: number;
  userId?: string;
  /** 按路径收窄（学习者详情页的路径作用域选择器）：teaching_sessions.learningPathId 单列直连，无需 join */
  pathId?: string;
  status?: string;
  /** 课堂类型（tutor/review/extension）：复习课与延伸课不结算任务，列表需按类型可辨、可筛 */
  mode?: string;
  onlyWithAdvisory: boolean;
  onlyMissingWrapup: boolean;
  /** 按 id 直查虚拟账号时置 true（学习者详情），不是页面视角 */
  includeTest: boolean;
}): Promise<unknown> {
  const { page, limit, userId, pathId, status, mode, onlyWithAdvisory, onlyMissingWrapup, includeTest } = params;
  const where: any = {
    ...(userId ? { userId } : {}),
    ...(pathId ? { learningPathId: pathId } : {}),
    ...(status ? { status } : {}),
    ...(mode ? { mode } : {}),
    ...(onlyWithAdvisory ? { advisory: { not: null } } : {}),
    // wrapup 为 JSON 文本列：缺失 = 无记录或内容中不含 topicSummary
    ...(onlyMissingWrapup
      ? { OR: [{ wrapup: null }, { NOT: { wrapup: { contains: 'topicSummary' } } }] }
      : {}),
    ...(includeTest ? {} : { users: await buildNonVirtualUserWhere() }),
  };

  const [total, sessions] = await Promise.all([
    prisma.teaching_sessions.count({ where }),
    // select 而非 include：**排除 messages / teachingState 大 JSON 列**（前者 197.7MB，是这一页
    // 的唯一性能黑洞；消息数与 endReason 改由 sessionFactsById 在库里各取一个标量）
    prisma.teaching_sessions.findMany({
      where,
      orderBy: { startTime: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        userId: true,
        taskId: true,
        learningPathId: true,
        milestoneId: true,
        subject: true,
        topic: true,
        taskType: true,
        mode: true,
        status: true,
        startTime: true,
        endTime: true,
        duration: true,
        knowledgeState: true,
        wrapup: true,
        advisory: true,
        users: {
          select: { id: true, name: true, email: true, isVirtualLearner: true }
        }
      }
    })
  ]);

  const [progressById, factsById] = await Promise.all([
    deriveTeachingSessionProgress(sessions),
    sessionFactsById(sessions.map((s) => s.id)),
  ]);
  /* #105 读侧接入：行级收束观测（轨道 / 通道）。失败不吞错——读侧观测由本列承载，
     坏掉要显式可见（与既有 messageCount / progress 的失败语义一致）。 */
  const closureByTaskId = await loadClosureByTaskId(
    sessions.map((s) => s.taskId).filter((id): id is string => !!id)
  );

  const items = sessions.map((session) => {
    const wrapup = parseJsonSafe<any>(session.wrapup, null);
    const advisory = parseJsonSafe<any>(session.advisory, null);
    const knowledgePoints = parseJsonSafe<any[]>(session.knowledgeState, []);
    const facts = factsById.get(session.id);
    const endReason = facts?.endReason ?? null;

    return {
      id: session.id,
      userId: session.userId,
      userName: session.users?.name || null,
      email: session.users?.email || null,
      /** 数据隔离标记（includeTest=true 时供前端灰标：虚拟学习者 / 测试账号） */
      isVirtualLearner: !!session.users?.isVirtualLearner,
      isTestAccount: isTestAccountUser(session.users),
      taskId: session.taskId,
      learningPathId: session.learningPathId,
      milestoneId: session.milestoneId,
      subject: session.subject,
      topic: session.topic,
      taskType: session.taskType,
      /** 课堂类型：tutor=正课 / review=复习课 / extension=延伸课（后两者不结算任务） */
      mode: session.mode,
      status: session.status,
      /** 收束原因：manual-end（用户主动结束）/ task-completed / learner-abandoned；老会话 null */
      endReason,
      startTime: session.startTime,
      endTime: session.endTime,
      /* 历史超时会话的 duration 列是空的（超时收尾此前只把活跃时长写进 wrapup.duration），
         列上留空会让「停在 x/y」旁边显示「—」。列优先，缺了再取兜底总结里的同口径读数。 */
      duration: session.duration || (typeof wrapup?.duration === 'number' ? wrapup.duration : 0),
      messageCount: facts?.userCount ?? 0,
      knowledgePointCount: Array.isArray(knowledgePoints) ? knowledgePoints.length : 0,
      progress: progressById.get(session.id) || null,
      /** #105：该会话任务的统一收束观测（轨道/通道）；null = 尚无收束记录（未完成或事件未投影） */
      closure: closureByTaskId.get(session.taskId) ?? null,
      wrapup,
      advisory,
    };
  });

  return { page, limit, total, items };
}
