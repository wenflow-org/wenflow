/**
 * n+1 备课编排（活的 path 批次 C，2026-09-24）。
 *
 * 结课之后、下一课开始之前的「备课」概念——只负责**资料腿**：
 * 解析下一任务的 materialRefs，把 materialId=null 的联网引用**定向补采入库**
 * （单 URL fetch + ingestWebMaterial，无搜索环节，秒级、确定性、fail-open）。
 * 入库后这些引用在下一课即可取回章节原文（resolveActiveTaskMaterialExcerpts 按
 * sourceUrl 反查库记录）。
 *
 * 认知腿**不在此处**：概念负荷预热（conceptLoadService.warmInBackground）、学习者
 * 快照/insights 刷新、记忆回写已由结课 post-commit 块的 refreshInBackground 链承担
 * （学习者 agent 的账本管线）；本服务与其并列挂载，互不重复触发。
 *
 * 明确不做：章节窗口结果缓存（提取毫秒级；真正的延迟在补采，入库一次即永久就绪）。
 */
import { logger } from '../../utils/logger';
import { prisma } from '../../config/database';
import { fetchWeb } from '../fetch';
import { findWebRecordBySourceUrl, ingestWebMaterial } from '../materials/material-web-ingest.service';

/** 单次备课最多补采几条联网引用（refs 上限本来就是 3 条）。 */
const MAX_WEB_REF_FETCHES = 3;
/** 定向抓取单 URL 超时（毫秒）。 */
const FETCH_TIMEOUT_MS = 20_000;

/** 下一任务解析用的路径快照（纯数据，测试可直造）。 */
export interface PrepTaskSnapshot {
  id: string;
  status: string;
  order: number;
}
export interface PrepMilestoneSnapshot {
  stageNumber: number;
  subtasks: PrepTaskSnapshot[];
}

/** 引用形状（materialRefs.byTask 的元素，结构化引用的公共字段）。 */
export interface PrepMaterialRef {
  materialId?: string | null;
  sourceUrl?: string | null;
  sectionTitle?: string | null;
  quote?: string | null;
}

/**
 * 解析下一任务：同阶段先取 order 更大的未完成任务；跨阶段取 stageNumber 更大的
 * 里程碑里第一个未完成任务。找不到（结业/找不到当前任务）返回 null。
 */
export function pickNextTask(
  milestones: PrepMilestoneSnapshot[],
  completedTaskId: string
): PrepTaskSnapshot | null {
  const current = milestones.find((milestone) => milestone.subtasks.some((task) => task.id === completedTaskId));
  if (!current) return null;
  const currentTask = current.subtasks.find((task) => task.id === completedTaskId);
  const inStage = current.subtasks
    .filter((task) => task.id !== completedTaskId && task.order > currentTask.order && task.status !== 'completed')
    .sort((a, b) => a.order - b.order);
  if (inStage[0]) return inStage[0];
  const laterStages = milestones
    .filter((milestone) => milestone.stageNumber > current.stageNumber)
    .sort((a, b) => a.stageNumber - b.stageNumber);
  for (const milestone of laterStages) {
    const first = milestone.subtasks
      .filter((task) => task.status !== 'completed')
      .sort((a, b) => a.order - b.order)[0];
    if (first) return first;
  }
  return null;
}

/** 可注入依赖（测试不打真网络/不落真盘）。ingest/lookup 只消费 id，按最小结构约定。 */
export interface LessonPrepDeps {
  fetchWeb: typeof fetchWeb;
  ingestWebMaterial: (
    input: { userId: string; url: string; title: string; text: string }
  ) => Promise<{ record: { id: string; name?: string; charCount?: number }; deduped?: boolean } | null>;
  findWebRecordBySourceUrl: (userId: string, url: string) => { id: string } | null;
}

/**
 * 备课资料腿：把引用里未入库的联网来源定向补采入库。
 * 返回 { fetched: 本次补采的 URL, reused: 库中已就绪的 URL }。
 */
export async function ensureWebRefsInLibrary(
  userId: string,
  refs: PrepMaterialRef[],
  deps: LessonPrepDeps
): Promise<{ fetched: string[]; reused: string[] }> {
  const fetched: string[] = [];
  const reused: string[] = [];
  for (const ref of refs) {
    if (fetched.length + reused.length >= MAX_WEB_REF_FETCHES) break;
    // 已是库资料引用（materialId 有值）无需处理；无 sourceUrl 的旧引用无从补采
    if (typeof ref?.materialId === 'string' && ref.materialId) continue;
    const sourceUrl = typeof ref?.sourceUrl === 'string' ? ref.sourceUrl.trim() : '';
    if (!sourceUrl) continue;
    if (deps.findWebRecordBySourceUrl(userId, sourceUrl)) {
      reused.push(sourceUrl);
      continue;
    }
    try {
      const response = await deps.fetchWeb({
        urls: [sourceUrl],
        format: 'markdown',
        // 不带 query：备课要整页原文（章节窗口的原料），不是查询相关片段
        extractDepth: 'advanced',
        perUrlTimeoutMs: FETCH_TIMEOUT_MS,
        purpose: 'n+1 备课定向补采（下一任务引用的联网资料入库）',
      });
      const item = (response?.results || []).find(
        (candidate) => !candidate.suspicious && typeof candidate.text === 'string' && candidate.text.trim().length > 0
      );
      if (!item) {
        logger.warn('[lesson-prep] 定向补采无可取正文，跳过（fail-open）', { sourceUrl });
        continue;
      }
      const ingested = await deps.ingestWebMaterial({
        userId,
        url: item.finalUrl || sourceUrl,
        title: item.title || sourceUrl,
        text: String(item.text),
      });
      if (ingested?.record?.id) fetched.push(sourceUrl);
    } catch (error) {
      logger.warn('[lesson-prep] 定向补采失败（fail-open）', {
        sourceUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { fetched, reused };
}

export interface LessonPrepOutcome {
  status: 'no-next-task' | 'no-path' | 'no-refs' | 'prepared' | 'partial';
  nextTaskId?: string;
  fetched: string[];
  reused: string[];
}

/**
 * 备课入口（结课 post-commit fire-and-forget 调用）：为下一任务把联网引用就绪。
 * 永不抛错——任何失败记 warn 后返回 fail-open 结果。
 */
export async function prepareNextLesson(
  input: { userId: string; pathId?: string | null; completedTaskId?: string | null },
  deps: LessonPrepDeps = { fetchWeb, ingestWebMaterial, findWebRecordBySourceUrl }
): Promise<LessonPrepOutcome> {
  const userId = String(input?.userId || '').trim();
  const pathId = String(input?.pathId || '').trim();
  const completedTaskId = String(input?.completedTaskId || '').trim();
  if (!userId || !pathId || !completedTaskId) {
    return { status: 'no-path', fetched: [], reused: [] };
  }
  try {
    const path = await prisma.learning_paths.findFirst({
      where: { id: pathId, userId },
      select: {
        aiPromptTemplate: true,
        milestones: {
          orderBy: { stageNumber: 'asc' },
          select: {
            stageNumber: true,
            subtasks: { orderBy: { order: 'asc' }, select: { id: true, status: true, order: true } },
          },
        },
      },
    });
    if (!path) return { status: 'no-path', fetched: [], reused: [] };

    const nextTask = pickNextTask(path.milestones as PrepMilestoneSnapshot[], completedTaskId);
    if (!nextTask) return { status: 'no-next-task', fetched: [], reused: [] };

    const template = parseTemplate(path.aiPromptTemplate);
    const byTask = template?.materialRefs?.byTask;
    const refs: PrepMaterialRef[] = Array.isArray(byTask?.[nextTask.id]) ? (byTask[nextTask.id] as PrepMaterialRef[]) : [];
    const webRefs = refs.filter((ref) => !(typeof ref?.materialId === 'string' && ref.materialId) && ref?.sourceUrl);
    if (webRefs.length === 0) {
      return { status: 'no-refs', nextTaskId: nextTask.id, fetched: [], reused: [] };
    }

    const { fetched, reused } = await ensureWebRefsInLibrary(userId, refs, deps);
    const status: LessonPrepOutcome['status'] = fetched.length > 0 ? 'prepared' : reused.length > 0 ? 'prepared' : 'partial';
    if (fetched.length > 0) {
      logger.info('[lesson-prep] 下一任务联网引用已就绪（n+1 备课）', {
        userId, pathId, nextTaskId: nextTask.id, fetched: fetched.length, reused: reused.length,
      });
    }
    return { status, nextTaskId: nextTask.id, fetched, reused };
  } catch (error) {
    logger.warn('[lesson-prep] 备课失败（fail-open，不影响结课）', {
      pathId,
      completedTaskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 'partial', fetched: [], reused: [] };
  }
}

interface ParsedPrepTemplate {
  materialRefs?: { byTask?: Record<string, unknown> | null } | null;
}

function parseTemplate(raw: string | null | undefined): ParsedPrepTemplate | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export const lessonPrepService = { prepareNextLesson };
