// 真实会话控制台同构映射端点（遗留项 1：SessionCockpit 适配真实教学会话）
// GET /api/admin/session-console/:sessionId
// - 只读；按真实 sessionId 解析 teaching_sessions 或 goal_conversations
// - 响应对齐虚拟会话 stageResults/runtime/stageStatus/bindings 契约，前端双模式共用渲染
// - 无 stageResults 字段（blackbox/simulationConfig/评审）给 null → 前端优雅降级隐藏
import { Router } from 'express';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';

const router = Router();

const TERMINAL_TEACHING_STATUSES = new Set(['completed', 'failed', 'timeout', 'superseded', 'discarded', 'finalization_failed']);

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface ConsoleMessage {
  role: 'user' | 'assistant';
  content: string;
  time: string | null;
}

function normalizeRole(role: string | null | undefined): 'user' | 'assistant' {
  const value = String(role || '').toLowerCase();
  return value === 'assistant' || value === 'ai' || value === 'teacher' ? 'assistant' : 'user';
}

/** teaching_sessions.messages → {role,content,time}（只保留最近 limit 条） */
function teachingMessages(raw: string | null | undefined, limit = 60): ConsoleMessage[] {
  const messages = parseJsonSafe<any[]>(raw, []);
  return messages
    .filter((m: any) => typeof m?.content === 'string' && m.content.trim())
    .slice(-limit)
    .map((m: any) => ({
      role: normalizeRole(m.role),
      content: String(m.content).trim(),
      time: typeof m.timestamp === 'string' ? m.timestamp : null,
    }));
}

/** goal_conversations.collectedData.messages → {role,content,time}（role 含 ai，归一为 assistant） */
function goalMessages(conversation: { messages: string | null; collectedData: string | null }): ConsoleMessage[] {
  const data = parseJsonSafe<any>(conversation.collectedData, {});
  const fromCollected = Array.isArray(data.messages) ? data.messages : [];
  const fromColumn = parseJsonSafe<any[]>(conversation.messages, []);
  const messages = fromCollected.length ? fromCollected : fromColumn;
  return messages
    .filter((m: any) => typeof m?.content === 'string' && m.content.trim())
    .map((m: any) => ({
      role: normalizeRole(m.role),
      content: String(m.content).trim(),
      time: typeof m.time === 'string' ? m.time : null,
    }));
}

function goalStageReady(stage: string | null | undefined, status: string | null | undefined): boolean {
  const s = String(stage || '').toLowerCase();
  return ['ready', 'completed'].includes(s)
    || String(status || '').toLowerCase() === 'completed';
}

function goalConfidence(conversation: { collectedData: string | null }): number | null {
  const data = parseJsonSafe<any>(conversation.collectedData, {});
  const value = typeof data.confidence === 'number' ? data.confidence : null;
  return value !== null && Number.isFinite(value) ? value : null;
}

function knowledgePointStates(raw: string | null | undefined): Array<Record<string, unknown>> {
  const list = parseJsonSafe<any[]>(raw, []);
  return list.map((item: any) => ({
    name: item?.name || null,
    status: item?.status || 'unknown',
    progress: typeof item?.progress === 'number' ? item.progress : null,
  }));
}

function wrapupView(raw: string | null | undefined) {
  const wrapup = parseJsonSafe<any>(raw, null);
  if (!wrapup || typeof wrapup !== 'object') return null;
  return {
    status: wrapup.status || null,
    summary: wrapup.summary || null,
    sources: wrapup.sources || null,
    generatedAt: wrapup.generatedAt || null,
  };
}

/** 里程碑/子任务 → 与虚拟 path-status 对齐的里程碑视图 */
function buildMilestonesView(milestones: any[]): Array<Record<string, unknown>> {
  return milestones
    .slice()
    .sort((a, b) => (a.stageNumber || 0) - (b.stageNumber || 0))
    .map((m) => {
      const tasks = (Array.isArray(m.subtasks) ? m.subtasks : [])
        .slice()
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((t: any) => ({
          id: t.id,
          title: t.title || '未命名任务',
          status: t.status || 'todo',
          completed: t.status === 'completed',
          order: t.order || 0,
          completedAt: t.completedAt || null,
        }));
      return {
        stageNumber: m.stageNumber || 0,
        title: m.title || `里程碑 ${m.stageNumber || ''}`.trim(),
        description: m.description || null,
        estimatedHours: m.estimatedHours ?? null,
        status: m.status || 'locked',
        startedAt: m.startedAt || null,
        completedAt: m.completedAt || null,
        tasks,
      };
    });
}

async function resolvePathView(path: any) {
  if (!path) return null;
  const milestones = await prisma.milestones.findMany({
    where: { learningPathId: path.id },
    orderBy: { stageNumber: 'asc' },
    include: { subtasks: { orderBy: { order: 'asc' } } },
  });
  const totalTasks = milestones.reduce((sum, m) => sum + m.subtasks.length, 0);
  const completedTasks = milestones.reduce(
    (sum, m) => sum + m.subtasks.filter((t) => t.status === 'completed').length,
    0
  );
  return {
    id: path.id,
    title: path.title || path.name || null,
    description: path.description || null,
    difficulty: path.difficulty || null,
    estimatedHours: path.estimatedHours ?? null,
    status: path.status || null,
    totalMilestones: path.totalMilestones || milestones.length || 0,
    completedMilestones: path.completedMilestones || 0,
    totalTasks,
    completedTasks,
    milestones: buildMilestonesView(milestones),
    createdAt: path.createdAt || null,
  };
}

/** learner_evidence 质量/评估摘要：按 evidenceType 聚合 + 置信度 + 最近时刻 */
function buildEvaluationSummary(evidence: any[]) {
  if (!evidence.length) return null;
  const byType = new Map<string, { count: number; confidenceSum: number }>();
  for (const item of evidence) {
    const type = item.evidenceType || 'evidence';
    const entry = byType.get(type) || { count: 0, confidenceSum: 0 };
    entry.count += 1;
    entry.confidenceSum += typeof item.confidence === 'number' ? item.confidence : 1;
    byType.set(type, entry);
  }
  const types = [...byType.entries()]
    .map(([type, { count, confidenceSum }]) => ({
      type,
      count,
      avgConfidence: count ? Number((confidenceSum / count).toFixed(3)) : null,
    }))
    .sort((a, b) => b.count - a.count);
  const latest = evidence[evidence.length - 1];
  return {
    total: evidence.length,
    types,
    avgConfidence: evidence.length
      ? Number((evidence.reduce((s, e) => s + (typeof e.confidence === 'number' ? e.confidence : 1), 0) / evidence.length).toFixed(3))
      : null,
    latestAt: latest?.occurredAt || null,
  };
}

/** 时间线合成：goal 消息 / path 里程碑与任务 / teaching 消息 / evidence / wrapup，按时间升序 */
interface TimelineEntry {
  time: string;
  kind: 'goal' | 'path' | 'teaching' | 'evidence';
  title: string;
  detail: string;
}

function pushTimeline(list: TimelineEntry[], entry: TimelineEntry | null) {
  if (!entry) return;
  // 统一归一为 ISO 字符串：prisma Date 对象 String() 是本地时间文本，会破坏字典序
  const parsed = new Date(String(entry.time));
  if (Number.isNaN(parsed.getTime())) return;
  list.push({ ...entry, time: parsed.toISOString() });
}

function buildTimeline(params: {
  goalConversation?: any;
  pathView?: any;
  teachingMessages?: ConsoleMessage[];
  evidence?: any[];
  wrapup?: any;
}): TimelineEntry[] {
  const timeline: TimelineEntry[] = [];
  const { goalConversation, pathView, teachingMessages, evidence, wrapup } = params;

  if (goalConversation) {
    for (const message of goalMessages(goalConversation)) {
      pushTimeline(timeline, {
        time: message.time as string,
        kind: 'goal',
        title: message.role === 'assistant' ? 'Goal 顾问回复' : '学习者目标对话',
        detail: message.content.slice(0, 80),
      });
    }
  }

  if (pathView) {
    pushTimeline(timeline, {
      time: pathView.createdAt,
      kind: 'path',
      title: '学习路径已生成',
      detail: pathView.title || pathView.id,
    });
    for (const milestone of pathView.milestones) {
      pushTimeline(timeline, {
        time: milestone.startedAt,
        kind: 'path',
        title: `M${milestone.stageNumber} 里程碑开始`,
        detail: String(milestone.title || ''),
      });
      pushTimeline(timeline, {
        time: milestone.completedAt,
        kind: 'path',
        title: `M${milestone.stageNumber} 里程碑完成`,
        detail: String(milestone.title || ''),
      });
      for (const task of milestone.tasks as any[]) {
        if (task.completedAt) {
          pushTimeline(timeline, {
            time: task.completedAt,
            kind: 'path',
            title: '任务完成',
            detail: String(task.title || ''),
          });
        }
      }
    }
  }

  for (const message of teachingMessages || []) {
    pushTimeline(timeline, {
      time: message.time as string,
      kind: 'teaching',
      title: message.role === 'assistant' ? '教师回复' : '学习者消息',
      detail: message.content.slice(0, 80),
    });
  }

  for (const item of evidence || []) {
    pushTimeline(timeline, {
      time: item.occurredAt ? item.occurredAt.toISOString() : null,
      kind: 'evidence',
      title: String(item.evidenceType || 'evidence'),
      detail: JSON.stringify(parseJsonSafe<any>(item.payload, {}))?.slice(0, 80) || '',
    });
  }

  if (wrapup?.generatedAt) {
    pushTimeline(timeline, {
      time: wrapup.generatedAt,
      kind: 'teaching',
      title: '会话总结已生成',
      detail: '',
    });
  }

  return timeline
    .filter((entry) => !!entry.time)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)))
    .slice(-200);
}

/** teaching_sessions → 控制台同构载荷 */
async function buildTeachingConsole(session: any) {
  const [goalConversation, path, evidence, task] = await Promise.all([
    session.learningPathId
      ? prisma.goal_conversations.findFirst({
          where: { learningPathId: session.learningPathId },
          orderBy: { createdAt: 'desc' },
        })
      : Promise.resolve(null),
    session.learningPathId
      ? prisma.learning_paths.findUnique({ where: { id: session.learningPathId } })
      : Promise.resolve(null),
    prisma.learner_evidence.findMany({
      where: {
        OR: [
          ...(session.id ? [{ sessionId: session.id }] : []),
          ...(session.taskId ? [{ taskId: session.taskId }] : []),
        ],
      },
      orderBy: { occurredAt: 'asc' },
    }),
    session.taskId
      ? prisma.subtasks.findUnique({ where: { id: session.taskId } })
      : Promise.resolve(null),
  ]);

  const pathView = path ? await resolvePathView(path) : null;
  const messages = teachingMessages(session.messages);
  const wrapup = wrapupView(session.wrapup);
  const knowledgeState = knowledgePointStates(session.knowledgeState);
  const currentTaskTitle = task?.title || null;
  const currentMilestoneTitle = pathView?.milestones.find(
    (m: any) => m.stageNumber === session.milestoneId
  )?.title
    || null;
  const totalMilestones = pathView?.totalMilestones ?? null;

  const stage = goalConversation?.stage || null;
  const ready = goalStageReady(stage, goalConversation?.status);
  const terminal = TERMINAL_TEACHING_STATUSES.has(String(session.status || ''));
  const currentStage = terminal && wrapup ? 'wrapup' : 'teaching';

  const evaluation = buildEvaluationSummary(evidence);
  const timeline = buildTimeline({ goalConversation, pathView, teachingMessages: messages, evidence, wrapup });

  const goalBlock = goalConversation
    ? {
        conversationId: goalConversation.id,
        stage,
        status: goalConversation.status,
        ready,
        confidence: goalConfidence(goalConversation),
        messageCount: goalMessages(goalConversation).length,
      }
    : null;

  return {
    kind: 'teaching' as const,
    sessionId: session.id,
    goal: goalBlock,
    path: pathView,
    teaching: {
      teachingSessionId: session.id,
      taskId: session.taskId,
      taskTitle: currentTaskTitle,
      milestoneId: session.milestoneId,
      milestoneTitle: currentMilestoneTitle,
      subject: session.subject,
      topic: session.topic,
      taskType: session.taskType,
      mode: session.mode,
      status: session.status,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.duration,
      messageCount: messages.filter((m) => m.role === 'user').length,
      knowledgeState,
      wrapup,
      advisory: parseJsonSafe<any>(session.advisory, null),
      messages,
    },
    evaluation,
    timeline,
    runtime: {
      status: session.status,
      currentStage,
      stageStatus: {
        goal: goalBlock,
        path: pathView
          ? {
              learningPathId: pathView.id,
              generated: true,
              totalMilestones: pathView.totalMilestones,
              completedMilestones: pathView.completedMilestones,
            }
          : { learningPathId: null, generated: false, totalMilestones: null, completedMilestones: null },
        learning: {
          teachingSessionId: session.id,
          currentTaskId: session.taskId,
          currentTaskTitle,
          currentMilestone: session.milestoneId,
          currentMilestoneTitle,
          totalMilestones,
          wrapup,
          status: session.status,
          manualStop: false,
        },
      },
      bindings: {
        goalConversationId: goalConversation?.id || null,
        learningPathId: pathView?.id || null,
        teachingSessionId: session.id,
        currentTaskId: session.taskId,
      },
    },
    conversations: {
      goal: { messages: goalConversation ? goalMessages(goalConversation) : [] },
      learning: { messages },
    },
    stageResults: {
      goal: goalBlock,
      path: pathView,
      teaching: {
        teachingSessionId: session.id,
        currentTaskId: session.taskId,
        wrapup,
        taskRuntime: { status: session.status },
      },
      blackbox: null,
    },
  };
}

/** goal_conversations → 控制台同构载荷 */
async function buildGoalConsole(conversation: any) {
  const [path, teachingSessions, evidence] = await Promise.all([
    conversation.learningPathId
      ? prisma.learning_paths.findUnique({ where: { id: conversation.learningPathId } })
      : Promise.resolve(null),
    conversation.learningPathId
      ? prisma.teaching_sessions.findMany({
          where: { learningPathId: conversation.learningPathId, status: { not: 'superseded' } },
          orderBy: { startTime: 'desc' },
          take: 20,
        })
      : Promise.resolve([]),
    prisma.learner_evidence.findMany({
      where: { pathId: conversation.learningPathId || undefined },
      orderBy: { occurredAt: 'asc' },
    }),
  ]);

  const pathView = path ? await resolvePathView(path) : null;
  const latestTeaching = teachingSessions[0] || null;
  const messages = latestTeaching ? teachingMessages(latestTeaching.messages) : [];
  const wrapup = latestTeaching ? wrapupView(latestTeaching.wrapup) : null;
  const stage = conversation.stage || null;
  const ready = goalStageReady(stage, conversation.status);
  const hasTeaching = teachingSessions.length > 0;
  const currentStage = !pathView
    ? 'goal'
    : !hasTeaching
      ? 'path'
      : latestTeaching && TERMINAL_TEACHING_STATUSES.has(String(latestTeaching.status || '')) && wrapup
        ? 'wrapup'
        : 'teaching';

  const evaluation = buildEvaluationSummary(evidence);
  const timeline = buildTimeline({
    goalConversation: conversation,
    pathView,
    teachingMessages: messages,
    evidence,
    wrapup,
  });

  const goalBlock = {
    conversationId: conversation.id,
    description: conversation.description || null,
    stage,
    status: conversation.status,
    ready,
    confidence: goalConfidence(conversation),
    messageCount: goalMessages(conversation).length,
  };

  return {
    kind: 'goal' as const,
    sessionId: conversation.id,
    goal: goalBlock,
    path: pathView,
    teaching: latestTeaching
      ? {
          teachingSessionId: latestTeaching.id,
          taskId: latestTeaching.taskId,
          taskTitle: null,
          milestoneId: latestTeaching.milestoneId,
          milestoneTitle: null,
          subject: latestTeaching.subject,
          topic: latestTeaching.topic,
          taskType: latestTeaching.taskType,
          mode: latestTeaching.mode,
          status: latestTeaching.status,
          startTime: latestTeaching.startTime,
          endTime: latestTeaching.endTime,
          duration: latestTeaching.duration,
          messageCount: messages.filter((m) => m.role === 'user').length,
          knowledgeState: knowledgePointStates(latestTeaching.knowledgeState),
          wrapup,
          advisory: parseJsonSafe<any>(latestTeaching.advisory, null),
          messages,
          sessionCount: teachingSessions.length,
        }
      : null,
    evaluation,
    timeline,
    runtime: {
      status: conversation.status,
      currentStage,
      stageStatus: {
        goal: goalBlock,
        path: pathView
          ? {
              learningPathId: pathView.id,
              generated: true,
              totalMilestones: pathView.totalMilestones,
              completedMilestones: pathView.completedMilestones,
            }
          : { learningPathId: null, generated: false, totalMilestones: null, completedMilestones: null },
        learning: latestTeaching
          ? {
              teachingSessionId: latestTeaching.id,
              currentTaskId: latestTeaching.taskId,
              currentTaskTitle: null,
              currentMilestone: latestTeaching.milestoneId,
              currentMilestoneTitle: null,
              totalMilestones: pathView?.totalMilestones ?? null,
              wrapup,
              status: latestTeaching.status,
              manualStop: false,
            }
          : { teachingSessionId: null, currentTaskId: null, wrapup: null, status: null, manualStop: false },
      },
      bindings: {
        goalConversationId: conversation.id,
        learningPathId: pathView?.id || null,
        teachingSessionId: latestTeaching?.id || null,
        currentTaskId: latestTeaching?.taskId || null,
      },
    },
    conversations: {
      goal: { messages: goalMessages(conversation) },
      learning: { messages },
    },
    stageResults: {
      goal: goalBlock,
      path: pathView,
      teaching: latestTeaching
        ? {
            teachingSessionId: latestTeaching.id,
            currentTaskId: latestTeaching.taskId,
            wrapup,
            taskRuntime: { status: latestTeaching.status },
          }
        : { teachingSessionId: null, currentTaskId: null, wrapup: null },
      blackbox: null,
    },
  };
}

router.get('/:sessionId', async (req: any, res) => {
  try {
    const { sessionId } = req.params;

    const [teachingSession, goalConversation] = await Promise.all([
      prisma.teaching_sessions.findUnique({
        where: { id: sessionId },
        include: { users: { select: { id: true, name: true, email: true } } },
      }),
      prisma.goal_conversations.findUnique({
        where: { id: sessionId },
        include: { users: { select: { id: true, name: true, email: true } } },
      }),
    ]);

    let data: Record<string, unknown>;
    if (teachingSession) {
      data = await buildTeachingConsole(teachingSession);
    } else if (goalConversation) {
      data = await buildGoalConsole(goalConversation);
    } else {
      return res.status(404).json({
        success: false,
        error: { message: '会话不存在（非教学会话或目标对话）', status: 404 },
      });
    }

    res.json({ success: true, data });
  } catch (error: any) {
    logger.error('[admin-session-console] 获取真实会话控制台数据失败', { error });
    res.status(500).json({
      success: false,
      error: { message: error.message || '获取真实会话控制台数据失败', status: 500 },
    });
  }
});

export { buildTeachingConsole, buildGoalConsole, buildTimeline };
export default router;
