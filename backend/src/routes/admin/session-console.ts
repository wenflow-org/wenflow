// 真实会话控制台同构映射端点（遗留项 1：SessionCockpit 适配真实教学会话）
// GET /api/admin/session-console/:sessionId
// - 只读；按真实 sessionId 解析 teaching_sessions 或 goal_conversations
// - 响应对齐虚拟会话 stageResults/runtime/stageStatus/bindings 契约，前端双模式共用渲染
// - 无 stageResults 字段（blackbox/simulationConfig/评审）给 null → 前端优雅降级隐藏
import { Router } from 'express';
import {
  findLearningPathById,
  findMilestonesByPathId,
  findLatestGoalConversationByPathId,
  findSessionEvidence,
  findSubtaskById,
  findTeachingSessionsByPathId,
  findPathEvidence,
  findTeachingSessionWithUser,
  findGoalConversationWithUser,
} from '../../services/admin/session-console.repo';
import { logger } from '../../utils/logger';
import { hydrateTeachingSessionMessages } from '../../services/ai-teaching/teaching-session-message-store';
import { listMaterials, readMaterial } from '../../services/materials/material-store';

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

/** teaching_sessions.messages → {role,content,time}（只保留最近 limit 条）
 *
 *  两种形态都要吃（2026-10-11 走查）：本文件两个 builder 都先调 hydrateTeachingSessionMessages，
 *  侧表有行时 messages 已被覆写成**解析好的数组**，旧会话仍是 JSON 字符串。
 *  只按字符串解析时 `JSON.parse(数组)` 抛错并被兜底吞成 []，于是侧表权威的会话课堂消息恒为 0 条：
 *  监控页「Learn 课堂」恒显示「该课堂暂未记录可展示消息」、回合记录只剩 Goal 半边、时间线缺课堂条目。
 *  全库 827/827 会话都有侧表行（10788 条消息），即修复前这条读法对**所有**有消息的会话都是假的。 */
function teachingMessages(raw: unknown, limit = 60): ConsoleMessage[] {
  const messages = Array.isArray(raw)
    ? (raw as any[])
    : parseJsonSafe<any[]>(raw as string | null | undefined, []);
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
  const milestones = await findMilestonesByPathId(path.id);
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

/** 学习者资料投影（上传附件 + 联网采集）：列表级字段 + brief 摘要节点，正文不进载荷。
 *  brief 是资料理解的一次性结构化产物（Document Summary Index），goal 与 path 生成复用同一份。 */
function materialSummaries(userId: string | null | undefined) {
  if (!userId) return [];
  try {
    return listMaterials(userId).map((m) => {
      const brief = m.brief || null;
      return {
        id: m.id,
        name: m.name,
        origin: m.origin === 'web' ? ('web' as const) : ('upload' as const),
        charCount: m.charCount || 0,
        headingCount: m.structure?.headingCount || 0,
        anchorCount: Array.isArray(m.anchors) ? m.anchors.length : 0,
        warningCount: Array.isArray(m.warnings) ? m.warnings.length : 0,
        createdAt: m.createdAt || null,
        fetchedAt: m.fetchedAt || null,
        sourceUrl: m.sourceUrl || null,
        brief: brief
          ? {
              docType: brief.docType || null,
              subject: brief.subject || null,
              audience: brief.audience || null,
              overview: brief.overview || null,
              coreConcepts: Array.isArray(brief.coreConcepts) ? brief.coreConcepts : [],
              naturalDivisions: Array.isArray(brief.naturalDivisions) ? brief.naturalDivisions : [],
              tocCount: Array.isArray(brief.toc) ? brief.toc.length : 0,
            }
          : null,
      };
    });
  } catch (error) {
    logger.warn('[admin-session-console] 学习者资料读取失败，控制台按无资料渲染', { userId, error });
    return [];
  }
}

/** teaching_sessions → 控制台同构载荷 */
async function buildTeachingConsole(session: any) {
  // 消息子表水合：侧表权威的会话覆写内存 messages 字段（旧会话原样读列）
  await hydrateTeachingSessionMessages(session);
  const [goalConversation, path, evidence, task] = await Promise.all([
    session.learningPathId
      ? findLatestGoalConversationByPathId(session.learningPathId)
      : Promise.resolve(null),
    session.learningPathId
      ? findLearningPathById(session.learningPathId)
      : Promise.resolve(null),
    findSessionEvidence(session.id, session.taskId),
    session.taskId
      ? findSubtaskById(session.taskId)
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
        /* 同路径课堂清单（2026-10-12 走查：Learn 页签要能就地切换课堂看）：
           前端课程树凭它把每节课映射到课堂会话 id（teachingSessionHistory 契约，
           与虚拟会话 stageResults.teaching 同形）。 */
        teachingSessionHistory: teachingSessionHistoryOf(
          session.learningPathId ? await findTeachingSessionsByPathId(session.learningPathId) : []
        ),
      },
      blackbox: null,
    },
  };
}

/** goal_conversations → 控制台同构载荷 */

/** 同路径课堂清单 → 前端 teachingSessionHistory 契约（课程树把每节课映射到课堂会话 id）。
 *  只取定位所需字段：单课正文不进清单（点开时由 /:sessionId 按需取）。 */
function teachingSessionHistoryOf(sessions: any[]) {
  return (sessions || []).map((s: any) => ({
    teachingSessionId: s.id,
    taskId: s.taskId,
    taskTitle: null,
    status: s.status,
  }));
}

async function buildGoalConsole(conversation: any) {
  const [path, teachingSessions, evidence] = await Promise.all([
    conversation.learningPathId
      ? findLearningPathById(conversation.learningPathId)
      : Promise.resolve(null),
    conversation.learningPathId
      ? findTeachingSessionsByPathId(conversation.learningPathId)
      : Promise.resolve([]),
    findPathEvidence(conversation.learningPathId),
  ]);

  const pathView = path ? await resolvePathView(path) : null;
  const latestTeaching = teachingSessions[0] || null;
  if (latestTeaching) await hydrateTeachingSessionMessages(latestTeaching);
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
    /* 学习者资料（2026-10-11 走查）：goal 阶段会把学习者**携带的资料**（上传附件）与**系统联网采集**
       的资料一起纳入上下文，path 生成也复用它们。这些结果此前在任何管理页都看不到 —— 落盘在
       data/uploads/materials/<userId>/，只在管线内部被读。此处按用户投影一份列表级摘要（不含正文：
       单份正文可达 100k 字符）。取数失败不阻断控制台（fail-open 空列表）。 */
    materials: materialSummaries(conversation.userId),
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
            /* 同路径课堂清单：前端课程树据此映射每节课的课堂会话 id（Learn 就地切换 / 单课总结） */
            teachingSessionHistory: teachingSessionHistoryOf(teachingSessions),
          }
        : { teachingSessionId: null, currentTaskId: null, wrapup: null },
      blackbox: null,
    },
  };
}

// GET /api/admin/session-console/material/:sessionId/:materialId —— 单份学习者资料全文。
// 列表载荷刻意不含正文（单份可达 10 万字），全文点开才读：按会话反查归属用户后再读盘，
// 不接受任意 userId 入参（资料读权限收在会话边界内）；store 内已有 userId 清洗与资料 id
// UUID 校验（防目录穿越）。超长截断并标记，前端提示。
router.get('/material/:sessionId/:materialId', async (req: any, res) => {
  try {
    const { sessionId, materialId } = req.params;
    const [teachingSession, goalConversation] = await Promise.all([
      findTeachingSessionWithUser(sessionId),
      findGoalConversationWithUser(sessionId),
    ]);
    const owner = teachingSession || goalConversation;
    if (!owner) {
      return res.status(404).json({
        success: false,
        error: { message: '会话不存在（非教学会话或目标对话）', status: 404 },
      });
    }
    const found = readMaterial(String(owner.userId || ''), String(materialId || ''));
    if (!found) {
      return res.status(404).json({
        success: false,
        error: { message: '资料不存在或不属于该会话的学习者', status: 404 },
      });
    }
    const MAX_MATERIAL_CHARS = 200_000;
    const full = found.markdown;
    const truncated = full.length > MAX_MATERIAL_CHARS;
    return res.json({
      success: true,
      data: {
        id: found.record.id,
        name: found.record.name,
        origin: found.record.origin === 'web' ? 'web' : 'upload',
        charCount: found.record.charCount || full.length,
        markdown: truncated ? full.slice(0, MAX_MATERIAL_CHARS) : full,
        truncated,
      },
    });
  } catch (error: any) {
    logger.error('[admin-session-console] 读取学习者资料全文失败', { error });
    return res.status(500).json({
      success: false,
      error: { message: error.message || '读取学习者资料全文失败', status: 500 },
    });
  }
});

router.get('/:sessionId', async (req: any, res) => {
  try {
    const { sessionId } = req.params;

    const [teachingSession, goalConversation] = await Promise.all([
      findTeachingSessionWithUser(sessionId),
      findGoalConversationWithUser(sessionId),
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
