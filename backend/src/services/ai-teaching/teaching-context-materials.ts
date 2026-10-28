/**
 * 教学上下文 · 策略指引 / 学校锚 / 资料投影与原文窗口（2026-10-24 架构优化批 1 迁出，逐字未改）。
 */
import { getSceneFramingNormalizedInput, resolveNormalizedInputSnapshot, resolvePersistedNormalizedInput } from '../learning/learning.helpers';
import { extractPromptMaterials, TEACHING_MATERIAL_LIMITS, type PromptMaterial } from '../materials/material-prompt-projection';
import { extractSectionWindow, type ActiveTaskMaterialExcerpt } from '../materials/material-sections';
import { isMaterialSemanticEnabled, recallMaterialChunks } from '../materials/material-semantic.service';
import { findWebRecordBySourceUrl } from '../materials/material-web-ingest.service';
import { readMaterial } from '../materials/material-store';
import { teachingStrategyConfig } from '../../config/pedagogy.config';
import { logger } from '../../utils/logger';
import { parsePathPromptTemplate } from './teaching-context-knowledge';
import type { TeachingScenarioContext } from './teaching-context-types';


export function buildTeachingStrategyGuidance(taskProfile: TeachingScenarioContext['taskProfile']) {  const knowledgeType = taskProfile.knowledgeType;
  const cognitiveLevel = taskProfile.cognitiveLevel;
  const objectiveFocus = taskProfile.learningObjectives.slice(0, 4);
  const coreConcept = taskProfile.coreConcept;

  const knowledgeGuidance = knowledgeType && teachingStrategyConfig.byKnowledgeType[knowledgeType]
    ? teachingStrategyConfig.byKnowledgeType[knowledgeType]
    : {
        explanationStyle: teachingStrategyConfig.defaults.explanationStyle,
        interactionPattern: teachingStrategyConfig.defaults.interactionPattern,
        preferredStrategies: teachingStrategyConfig.defaults.preferredStrategies,
        responseConstraints: [] as string[],
      };

  const levelGuidance = cognitiveLevel && teachingStrategyConfig.byCognitiveLevel[cognitiveLevel]
    ? teachingStrategyConfig.byCognitiveLevel[cognitiveLevel]
    : {
        targetDepth: teachingStrategyConfig.defaults.targetDepth,
        responseConstraints: [] as string[],
      };

  return {
    knowledgeType,
    cognitiveLevel,
    objectiveFocus,
    coreConcept,
    explanationStyle: knowledgeGuidance.explanationStyle,
    interactionPattern: knowledgeGuidance.interactionPattern,
    targetDepth: levelGuidance.targetDepth,
    preferredStrategies: knowledgeGuidance.preferredStrategies,
    responseConstraints: [
      ...knowledgeGuidance.responseConstraints,
      ...levelGuidance.responseConstraints,
    ],
  };
}

/**
 * 学校体系锚（2026-09-30 实测驱动）：教材版本/考纲/在校进度在人设与 goal 提取里给得很具体
 * （「同济版教材，期末闭卷」「统编版教材，考试为新高考卷题型」「第 10 周讲到向量组」），
 * 但教学对话 0 引用——线代 64 回合、语文 25 回合实测均为 0。数据在持久化 normalizedInput
 * 的 learnerProfile 自由文本里，教学层从不读取。
 * 这里随 pathBackgroundContext 进 teaching-turn 载荷（scenario 稳定块，整课恒定、可缓存）。
 * 无数据 → null（提示词里不出现该键，课堂行为与原先完全一致）。
 */
export function resolveSchoolAnchorForTeaching(
  aiPromptTemplate: string | null | undefined,
): { background: string | null; baselineEvidence: string | null } | null {
  const parsed = parsePathPromptTemplate(aiPromptTemplate || null);
  if (!parsed) return null;
  const snapshot = resolveNormalizedInputSnapshot(parsed);
  const candidates: unknown[] = [
    getSceneFramingNormalizedInput(parsed.sceneFraming),
    resolvePersistedNormalizedInput(parsed),
    snapshot,
    (snapshot as any)?.normalizedInput,
  ];
  for (const candidate of candidates) {
    const lp = (candidate as any)?.learnerProfile;
    if (!lp || typeof lp !== 'object') continue;
    const background = typeof lp.backgroundExperience === 'string' && lp.backgroundExperience.trim()
      ? lp.backgroundExperience.trim() : null;
    const baselineEvidence = typeof lp.currentBaseline?.evidence === 'string' && lp.currentBaseline.evidence.trim()
      ? lp.currentBaseline.evidence.trim() : null;
    if (background || baselineEvidence) return { background, baselineEvidence };
  }
  return null;
}

/**
 * 从路径模板（`learning_paths.aiPromptTemplate`）里取回该路径关联的资料，并投影成课堂用的最小集合。
 *
 * 数据位置：`sceneFraming.normalizedInput.resources.materials`（优先），回退持久化快照。
 * 无资料 → null（提示词里不出现该键，课堂行为与原先完全一致）。
 */
export function resolvePathMaterialsForTeaching(aiPromptTemplate: string | null | undefined): PromptMaterial[] | null {
  const parsed = parsePathPromptTemplate(aiPromptTemplate || null);
  if (!parsed) return null;
  // 持久化形态有三种（历史演进）：sceneFraming.normalizedInput / 顶层 normalizedInput /
  // normalizedInputSnapshot.normalizedInput。逐个尝试，命中即返回（都拿不到 → null）。
  const snapshot = resolveNormalizedInputSnapshot(parsed);
  const candidates: unknown[] = [
    getSceneFramingNormalizedInput(parsed.sceneFraming),
    resolvePersistedNormalizedInput(parsed),
    snapshot,
    (snapshot as any)?.normalizedInput,
  ];
  for (const candidate of candidates) {
    const materials = extractPromptMaterials({ normalizedInput: candidate }, TEACHING_MATERIAL_LIMITS);
    if (materials) return materials;
  }
  return null;
}

/**
 * 当前任务 materialRefs 的章节原文窗口（按章节取回，2026-09-24）。
 *
 * 讲到某条引用时，课堂上下文应能看到**该章节的原文**，而不是只有打包投影里的
 * ≤4 条引文——这是 parent-child 检索的「取大」半边（无向量、标题/引文锚定）。
 * 任一环失败 fail-open：返回 null，课堂行为与原先完全一致。
 */
/**
 * 任务级迷思预判读侧（课前注入半条链，2026-09-26）：从 aiPromptTemplate.misconceptionHints.byTask[taskId]
 * 读回 stage-designer 的课前预判。与 resolveActiveTaskMaterialExcerpts 同款 sidecar 模式；失败 fail-open 返回 null。
 */
export function resolveTaskMisconceptionHints(params: {
  aiPromptTemplate: string | null | undefined;
  taskId: string;
}): Array<{ conceptKey: string; label: string; why: string }> | null {
  try {
    const parsed = parsePathPromptTemplate(params.aiPromptTemplate || null);
    const byTask = parsed?.misconceptionHints && typeof parsed.misconceptionHints === 'object'
      ? (parsed.misconceptionHints as Record<string, unknown>).byTask
      : null;
    const hints: unknown[] = byTask && typeof byTask === 'object' ? ((byTask as Record<string, unknown>)[params.taskId] as unknown[]) || [] : [];
    if (!Array.isArray(hints) || hints.length === 0) return null;
    const rows = hints
      .map((hint) => {
        const record = (hint && typeof hint === 'object' ? hint : {}) as Record<string, unknown>;
        return {
          conceptKey: String(record.conceptKey ?? '').trim(),
          label: String(record.label ?? '').trim(),
          why: String(record.why ?? '').trim(),
        };
      })
      .filter((hint) => hint.conceptKey && hint.label)
      .slice(0, 3);
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

/**
 * 台账行（已观察）与课前预判行合成 priorMisconceptions：planned 行带 source='planned'，
 * teaching-turn 据此区分话术（预判=设计诊断性提问；已观察=可引用过往错误）。
 */
export function buildPlannedMisconceptionRows(
  hints: Array<{ conceptKey: string; label: string; why: string }> | null
): Array<{
  conceptKey: string;
  hypothesis: string;
  canonicalLabel: string;
  confidence: number;
  status: string;
  occurrenceCount: number;
  why: string | null;
  source: 'planned';
}> {
  if (!hints || hints.length === 0) return [];
  return hints.map((hint) => ({
    conceptKey: hint.conceptKey,
    hypothesis: hint.label,
    canonicalLabel: hint.label,
    confidence: 25,
    status: 'suspected',
    occurrenceCount: 0,
    why: hint.why || null,
    source: 'planned' as const,
  }));
}

export async function resolveActiveTaskMaterialExcerpts(params: {
  aiPromptTemplate: string | null | undefined;
  taskId: string;
  userId: string;
  /** 语义召回的查询词（任务标题/描述）；缺省时不做语义兜底，行为与旧版一致。 */
  query?: string | null;
  maxExcerpts?: number;
  maxCharsPerExcerpt?: number;
}): Promise<ActiveTaskMaterialExcerpt[] | null> {
  const maxExcerpts = params.maxExcerpts ?? 2;
  const maxCharsPerExcerpt = params.maxCharsPerExcerpt ?? 4000;
  try {
    const parsed = parsePathPromptTemplate(params.aiPromptTemplate || null);
    const byTask = parsed?.materialRefs && typeof parsed.materialRefs === 'object'
      ? (parsed.materialRefs as Record<string, any>).byTask
      : null;
    const refs: any[] = byTask && typeof byTask === 'object' ? (byTask[params.taskId] || []) : [];

    // 无任何结构化引用：交给语义召回兜底（仅当启用 + 有查询词），否则维持旧行为返回 null
    if (!Array.isArray(refs) || refs.length === 0) {
      return await resolveSemanticExcerpts({
        userId: params.userId,
        query: params.query,
        maxExcerpts,
        maxCharsPerExcerpt,
      });
    }

    const excerpts: ActiveTaskMaterialExcerpt[] = [];
    const seenMaterials = new Set<string>();
    for (const ref of refs) {
      if (excerpts.length >= maxExcerpts) break;
      let materialId = typeof ref?.materialId === 'string' ? ref.materialId : '';
      // 批次 C：联网引用（materialId=null）按 sourceUrl 反查用户库——批次 A 入库/备课补采的
      // 联网资料全文已落库，可像附件一样取章节窗口（存量纯联网路径的引用从此可取回）
      if (!materialId && typeof ref?.sourceUrl === 'string' && ref.sourceUrl.trim()) {
        const webRecord = findWebRecordBySourceUrl(params.userId, ref.sourceUrl);
        if (webRecord) materialId = webRecord.id;
      }
      if (!materialId || seenMaterials.has(materialId)) continue;
      seenMaterials.add(materialId);
      const found = readMaterial(params.userId, materialId);
      if (!found) continue;
      let window = extractSectionWindow(
        found.markdown,
        { sectionTitle: ref.sectionTitle || null, quote: ref.quote || null },
        maxCharsPerExcerpt
      );
      // 结构化取回退化到「全文开头」= 标题/引文都没在这份资料里命中 →
      // 用语义召回在同一份资料里找最相关的块，替代无信息量的头部窗口（fail-open 保留原窗口）
      if (window.anchor === 'none' && params.query && isMaterialSemanticEnabled()) {
        try {
          const semantic = await recallMaterialChunks({
            userId: params.userId,
            query: params.query,
            materialIds: [materialId],
            topK: 1,
            records: [found.record],
          });
          if (semantic.length > 0 && semantic[0].text.trim()) {
            window = { excerpt: semantic[0].text.slice(0, maxCharsPerExcerpt), anchor: 'semantic' };
            // 可观测性（2026-10-17）：成功路径原本静默，"语义层到底有没有进课堂"只能靠读代码推断。
            // 教学链路的每一次兜底命中都留痕（score 是余弦分，仅作观测）。
            logger.info('[teaching-context] 单资料语义兜底命中', {
              taskId: params.taskId,
              materialId,
              chunkId: semantic[0].chunkId,
              score: Number(semantic[0].score.toFixed(4)),
            });
          }
        } catch (error) {
          // 单份资料的语义兜底失败不能吞掉整批（保留结构化窗口继续）
          logger.warn('[teaching-context] 语义兜底失败（保留头部窗口）', {
            taskId: params.taskId,
            materialId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (!window.excerpt) continue;
      excerpts.push({
        materialId,
        materialName: found.record.name,
        sectionTitle: typeof ref.sectionTitle === 'string' ? ref.sectionTitle : null,
        quote: typeof ref.quote === 'string' ? ref.quote : null,
        anchor: window.anchor,
        excerpt: window.excerpt,
      });
    }
    return excerpts.length ? excerpts : null;
  } catch (error) {
    logger.warn('[teaching-context] 章节原文取回失败（fail-open）', {
      taskId: params.taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * 任务**没有**结构化资料引用时的语义兜底：按任务查询词在该用户资料库里召回最相关的原文块。
 * 每份资料最多取一块（保证跨资料多样），最多 maxExcerpts 块。未启用/无查询/无命中 → null。
 */
async function resolveSemanticExcerpts(params: {
  userId: string;
  query?: string | null;
  maxExcerpts: number;
  maxCharsPerExcerpt: number;
}): Promise<ActiveTaskMaterialExcerpt[] | null> {
  const query = String(params.query || '').trim();
  if (!query || !isMaterialSemanticEnabled()) return null;
  const hits = await recallMaterialChunks({
    userId: params.userId,
    query,
    topK: params.maxExcerpts * 2,
    // 跨资料候选池较大（≤8 份资料 × 若干块），精排在此有实质增益：
    // 真机抽样 40 份长文档自检，余弦 top3 命中 108/111 → rerank top3 命中 111/111（2026-10-16）
    rerank: true,
  });
  logger.info('[teaching-context] 跨资料语义兜底', { userId: params.userId, hits: hits.length });
  if (!hits.length) return null;

  const excerpts: ActiveTaskMaterialExcerpt[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (excerpts.length >= params.maxExcerpts) break;
    if (seen.has(hit.materialId)) continue;
    seen.add(hit.materialId);
    const text = String(hit.text || '').trim();
    if (!text) continue;
    excerpts.push({
      materialId: hit.materialId,
      materialName: hit.materialName,
      sectionTitle: hit.title || null,
      quote: null,
      anchor: 'semantic',
      excerpt: text.slice(0, params.maxCharsPerExcerpt),
    });
  }
  return excerpts.length ? excerpts : null;
}

/**
 * 课堂快照取数口（#52 P-26 ①）。
 * 常规回合用 getLatest（5 分钟内存 + 10 分钟投影陈旧窗口，避免每回合重建）；
 * 收束终评用 refresh 强制按收束时刻的事实重算，避免复用判完成时的旧快照。
 */

