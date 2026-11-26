import {
  SkillDefinition,
  SkillExecutionResult,
} from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import { normalizeMaterialRefs } from '../../services/materials/material-refs';
import {
  assessStageMaterialCompleteness,
  assessStageMaterialCompletenessByModel,
} from '../../services/materials/subtask-material-completeness';
import { assessStageMetaLessons, assessStageNarration } from '../../services/learning/generation/stage-subtask-quality';
import { assessMaterialRefCoverage } from '../../services/materials/material-ref-coverage.service';
import type { PromptMaterial } from '../../services/materials/material-prompt-projection';
import { logger } from '../../utils/logger';

const STAGE_DESIGNER_MAX_TOKENS = 64000;
const STAGE_DESIGNER_TEMPERATURE = 0.3;

// File-as-Truth：systemPrompt 以 prompts/skill.path-task-design.md 为唯一事实源（与其他 skill 一致），
// 避免代码内嵌副本与文件/DB 漂移导致 drift 检测永久误报。
export const STAGE_DESIGNER_PROMPT = loadPromptFile('skill:path-task-design')?.systemPrompt || '';

export const stageDesignerDefinition: SkillDefinition = {
  name: 'path-task-design',
  displayName: '阶段任务设计器',
  version: '1.0.0',
  category: 'generation',
  description: '为单个 milestone 生成 subtasks 与轻量任务标记',
  inputSchema: {
    type: 'object',
    properties: {
      milestone: { type: 'object', required: true },
      cognitiveCore: { type: 'object', required: true },
      normalizedInput: { type: 'object' },
      repairHints: { type: 'object' },
      previousStageOutcome: { type: 'object' },
      supplementRequest: { type: 'object' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      subtasks: { type: 'array' },
    },
  },
  capabilities: ['stage-task-design', 'task-light-tagging'],
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0,
  }
};

function normalizeString(value: any): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeTaskType(value: any): 'acquire' | 'deconstruct' | 'model' | 'execute' | 'diagnose' | 'refine' | 'consolidate' {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (
    normalized === 'acquire'
    || normalized === 'deconstruct'
    || normalized === 'model'
    || normalized === 'execute'
    || normalized === 'diagnose'
    || normalized === 'refine'
    || normalized === 'consolidate'
  ) {
    return normalized;
  }
  return 'execute';
}

function normalizeAdjustability(value: any, taskType: ReturnType<typeof normalizeTaskType>): 'core' | 'flexible' {
  if (value === 'core' || value === 'flexible') return value;
  // 未标注时的确定性兜底：交付/收口/应用类任务是骨干，建立/拆解/诊断类可被压缩。
  // 兜底与提示词规则同口径，保证旧输出（无 adjustability）也有可用的重排语义。
  return taskType === 'acquire' || taskType === 'deconstruct' || taskType === 'diagnose'
    ? 'flexible'
    : 'core';
}

export function normalizeSubtasks(raw: any, fallbackConcept: string | null) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item: any) => {
      const taskType = normalizeTaskType(item?.type);
      return {
      title: normalizeString(item?.title) || '阶段学习任务',
      type: taskType,
      // 下沿取 10：path-planning-hints 对"一节课量级"的路径给的是 subtaskMinutesRange=[10,15]，
      // 而规则 49 要求此时 estimatedMinutes 取该区间下沿——此前硬抬到 15，等于静默覆盖规则
      // （审计 P2「下沿不一致」）。地板仍保留，用来挡模型给出的荒谬小值。
      estimatedMinutes: Number.isFinite(Number(item?.estimatedMinutes)) ? Math.max(10, Number(item.estimatedMinutes)) : 30,
      description: normalizeString(item?.description) || '',
      acceptanceHint: normalizeString(item?.acceptanceHint) || '',
      linkedConcept: normalizeString(item?.linkedConcept) || fallbackConcept,
      knowledgeType: ['factual', 'conceptual', 'procedural', 'metacognitive'].includes(item?.knowledgeType)
        ? item.knowledgeType
        : null,
      cognitiveLevel: ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'].includes(item?.cognitiveLevel)
        ? item.cognitiveLevel
        : null,
      // ICAP 收 2 档（2026-11-22）：1:1 平台 interactive 不可达（并入 constructive）、
      // passive 永不产出——历史输出的 interactive 按 1:1 口径降级为 constructive，passive 归 active。
      icapLevel: (() => {
        const raw = item?.icapLevel;
        if (raw === 'constructive' || raw === 'interactive') return 'constructive';
        if (raw === 'active' || raw === 'passive') return 'active';
        return null;
      })(),
      transferable: !!item?.transferable,
      // 动态规划（2026-10-17）：任务级可调整性，重排压缩时据此保护骨干（core）、
      // 优先删减 flexible。白名单归一必须带上，否则模型输出会被剥掉（与 materialRefs 同坑）。
      adjustability: normalizeAdjustability(item?.adjustability, taskType),
      // 课堂材料本体（2026-11-18）：与 description 分离——description 给人读，materialPayload 给课堂用。
      // 白名单归一必须带上，否则模型输出会被剥掉（与 materialRefs 同坑）。
      materialPayload: normalizeString(item?.materialPayload)
        ? normalizeString(item?.materialPayload).slice(0, 6000)
        : undefined,
      // 白名单归一**必须带上** materialRefs，否则任务级资料引用在此被丢掉
      // （随后由 withMaterialRefs 逐字核对；核对不过会在那里被删除）
      materialRefs: Array.isArray(item?.materialRefs) ? item.materialRefs : undefined,
      // 同理必须带上 anticipatedMisconceptions（2026-09-26 课前注入）：白名单归一没带 =
      // 模型输出了也被剥掉（真实 LLM 端到端实测：原始输出含键、sidecar 空）
      anticipatedMisconceptions: Array.isArray(item?.anticipatedMisconceptions)
        ? item.anticipatedMisconceptions
            .map((hint: any) => ({
              conceptKey: normalizeString(hint?.conceptKey) || '',
              label: normalizeString(hint?.label) || '',
              why: normalizeString(hint?.why) || '',
            }))
            .filter((hint: { conceptKey: string; label: string }) => hint.conceptKey && hint.label)
            .slice(0, 2)
        : undefined,
      };
    })
    .filter((item) => !!item.title);
}

export function validateStageDesignerOutput(parsed: any) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false as const, failureReason: 'STAGE_DESIGNER_OUTPUT_NOT_OBJECT' };
  }

  if (!Array.isArray(parsed.subtasks)) {
    return { valid: false as const, failureReason: 'STAGE_DESIGNER_SUBTASKS_MISSING' };
  }

  return { valid: true as const };
}

/**
 * subject（教材/多单元）阶段的小节覆盖审计（2026-11-25）。
 *
 * 实证：八年级上册第一阶段 description 明写「第一章 1.1–1.4」，第一节任务却只给了
 * 绪言 / 读数 / 误差 / 参照物四节，1.3 运动的快慢与 1.4 测量平均速度整节消失——
 * 阶段 goal 还承诺了平均速度判断。prompt 规则管不住时，至少要在任务层看见缺口。
 *
 * 只认**区间写法**（1.1–1.4 / 4.1–4.5），不做单点数字匹配：教材正文里的「1.5 倍」
 * 只认**列表/区间写法**，不扫全文小数：教材正文里的「1.5 倍」「2.5 米」会被误判成小节号。
 * 支持两种清单：
 *   ① 区间：`1.1–1.4`、`4.1–4.5`
 *   ② 逐条列举：`本章小节：1.1 集合的概念；1.2 集合间的基本关系；…`（2026-11-25 数学实跑——
 *      模型按「节号+小节名」列举而不是区间，旧解析器返回空，覆盖门静默失效，1.5 量词整节消失）
 */
export function extractStageSections(milestone: any): string[] {
  const text = [milestone?.title, milestone?.description, milestone?.goal]
    .filter((item) => typeof item === 'string' && item)
    .join('\n');
  if (!text) return [];
  const found = new Set<string>();
  const rangeRe = /(\d+)\.(\d+)\s*[–—\-~～至到]\s*(?:(\d+)\.)?(\d+)/g;
  for (const match of text.matchAll(rangeRe)) {
    const chapter = match[1];
    const from = Number(match[2]);
    const toChapter = match[3] ?? chapter;
    const to = Number(match[4]);
    if (toChapter !== chapter) continue;
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    if (hi - lo > 15) continue;
    for (let i = lo; i <= hi; i += 1) found.add(`${chapter}.${i}`);
  }
  if (found.size === 0) {
    // 列举式清单：优先取「小节清单/本章小节/本章主干：」后的清单段（可能不在第一句——
    // 数学路径首句是章名，清单在第二句）；没有标记时退回第一句。
    // 至少出现 2 个小节号才认——单个小数（「放大 1.5 倍」）不会被当成章节清单。
    const checklist = text.match(/(?:小节清单|本章小节|本章主干)[：:]([^。]*)/)?.[1]
      ?? text.split('。')[0]
      ?? '';
    const singles = [...checklist.matchAll(/(\d+)\.(\d+)/g)]
      .map((match) => ({ chapter: Number(match[1]), section: Number(match[2]) }))
      .filter((item) => item.chapter >= 1 && item.chapter <= 30 && item.section >= 1 && item.section <= 40);
    const unique = new Map(singles.map((item) => [`${item.chapter}.${item.section}`, item]));
    if (unique.size >= 2) {
      for (const key of unique.keys()) found.add(key);
    }
  }
  return [...found].sort((a, b) => {
    const [ac, as] = a.split('.').map(Number);
    const [bc, bs] = b.split('.').map(Number);
    return ac - bc || as - bs;
  });
}

/**
 * 本阶段的「单元清单」：优先取 ①②③ 形式的条目，其次取节号清单（1.1–1.4 / 列举）。
 * 清单是**结构化契约**的锚点：任务用 `covers: [序号]` 声明自己覆盖了哪几条，
 * 覆盖校验只看序号，不做「任务文本里有没有出现某关键词」的模糊匹配。
 */
export function extractStageChecklist(milestone: any): string[] {
  const text = [milestone?.title, milestone?.description, milestone?.goal]
    .filter((item) => typeof item === 'string' && item)
    .join('\n');
  if (!text) return [];
  // ①②③ 只有出现在**教材语境**里才当单元清单：builder/diagnostic 的阶段描述也常用
  // ①②③ 列工作步骤，那不是在讲“这一个单元有哪几节”，不能据此要求 covers。
  const unitContext = /(本章|这一章|单元|小节|教材|第\s*[0-9一二三四五六七八九十]+\s*章)/.test(text);
  const circle = unitContext
    ? [...text.matchAll(/([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])([^①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]*)/g)]
      .map((match) => match[2].replace(/^[：:、\s]+/u, '').split('。')[0].trim())
      .filter(Boolean)
    : [];
  if (circle.length >= 2) return circle;
  return extractStageSections(milestone);
}

/**
 * 阶段清单覆盖校验（2026-11-25 结构化收口）。
 *
 * 任务输出 `covers: number[]`（清单序号，1 起）声明覆盖；本函数只核对序号集合，
 * 不再从任务文案里正则找小节号/关键词——那样既会漏（文案不写节号就静默失效），
 * 又无法区分「提了一句」和「真的教了」。
 */
export function validateStageChecklistCoverage(parsed: any, input: any) {
  const checklist = extractStageChecklist(input?.milestone);
  if (checklist.length === 0) return { valid: true as const };
  const subtasks = Array.isArray(parsed?.subtasks) ? parsed.subtasks : [];
  if (subtasks.length === 0) return { valid: true as const };

  const covered = new Set<number>();
  let declaresCovers = false;
  for (const task of subtasks) {
    const list = Array.isArray(task?.covers) ? task.covers : [];
    for (const value of list) {
      const index = Number(value);
      if (Number.isFinite(index) && index >= 1) {
        covered.add(Math.floor(index));
        declaresCovers = true;
      }
    }
  }

  const missing = checklist
    .map((label, index) => ({ index: index + 1, label }))
    .filter((item) => !covered.has(item.index));
  if (missing.length === 0) return { valid: true as const };

  const labels = missing
    .map((item) => `${item.index}. ${item.label}`.slice(0, 40))
    .join('；');
  return {
    valid: false as const,
    failureReason: declaresCovers
      ? `STAGE_CHECKLIST_UNCOVERED(missing=${missing.map((item) => item.index).join(',')}): `
        + `本阶段清单里这些条目没有任务认领：${labels}。`
        + '请补任务或在现有任务的 covers 里补上对应序号（清单条目不得整条丢掉）。'
      : 'STAGE_CHECKLIST_COVERS_MISSING: 任务没有输出 covers 数组。'
        + '本阶段 description 列出了单元清单，每个 subtask 必须用 covers: [序号] 声明覆盖了哪几条（1 起），'
        + '并保证清单每一条至少被一个任务覆盖。',
    violations: missing.map((item) => `checklist_uncovered:${item.index}`),
  };
}

/**
 * 规则 39 以 `milestone.loadTarget` 为键，但 path 层只把它写在
 * `cognitiveCore.loadProfile.stageLoadDistribution[]`（按 stageNumber 索引）里——
 * 此前两个调用点都不注入该键 ⇒ 规则永不生效（审计 §3.19 P1⑤）。
 * 这里按 stageNumber 取回并挂到 milestone 上；找不到就不加（规则文本本就写"若输入提供"）。
 */
export function withLoadTargetForMilestone(milestone: any, cognitiveCore: any): any {
  if (!milestone || typeof milestone !== 'object') return milestone;
  if (normalizeString(milestone.loadTarget)) return milestone; // 已提供则不覆盖
  const distribution = cognitiveCore?.loadProfile?.stageLoadDistribution;
  const stageNumber = Number(milestone.stageNumber ?? milestone.stage);
  if (!Array.isArray(distribution) || !Number.isFinite(stageNumber)) return milestone;
  const hit = distribution.find((item: any) => Number(item?.stageNumber) === stageNumber);
  const loadTarget = normalizeString(hit?.loadTarget);
  return loadTarget ? { ...milestone, loadTarget } : milestone;
}

/**
 * materialRefs：任务 → 资料条目（**逐字核对**，编造的引用丢弃）。
 * 输入里带了投影后的 materials（由 stage-enrichment 注入）。
 *
 * 无资料时**也要走核对**：`normalizeMaterialRefs` 对空资料一律返回 []，于是模型编造的引用被删除。
 * 此前直接 `return list`，等于放行编造引用落库给学习者看（违反"宁缺勿编"），
 * 也与 path-planning 的口径不一致（审计 P1 §2.3b）。
 */
export function withMaterialRefs(subtasks: any[], materials: unknown): any[] {
  const list = Array.isArray(subtasks) ? subtasks : [];
  const normalizedMaterials = Array.isArray(materials) ? (materials as PromptMaterial[]) : null;
  return list.map((task) => {
    if (!task || typeof task !== 'object') return task;
    const refs = normalizeMaterialRefs(task.materialRefs, normalizedMaterials);
    const next = { ...task };
    if (refs.length) next.materialRefs = refs;
    else delete next.materialRefs;
    return next;
  });
}

/**
 * 资料只从顶层 `materials`（投影后）投递。`normalizedInput.resources.materials` 是**全量原文**，
 * 与顶层投影同进载荷既浪费 token，又制造"模型看到投影外内容、却被逐字核对丢弃"的口径不一致
 * （审计 P1 §2.3c）。这里在投递前剥掉嵌套的那份，保持单一投递点。
 */
export function stripNestedMaterials(normalizedInput: any): any {
  if (!normalizedInput || typeof normalizedInput !== 'object') return normalizedInput ?? null;
  const resources = normalizedInput.resources;
  if (!resources || typeof resources !== 'object' || resources.materials === undefined) return normalizedInput;
  const { materials: _dropped, ...restResources } = resources;
  return { ...normalizedInput, resources: restResources };
}

export async function stageDesigner(input: any): Promise<SkillExecutionResult<any>> {
  try {
    const milestone = input?.milestone && typeof input.milestone === 'object' ? input.milestone : null;
    if (!milestone) {
      throw new Error('STAGE_DESIGNER_INVALID_INPUT: milestone is required');
    }
    const fallbackConcept = normalizeString(milestone?.coreConcept);
    const stageMaterials = Array.isArray(input?.materials) ? (input.materials as PromptMaterial[]) : [];
    const coverageNodes = (subtasks: any[]) => (Array.isArray(subtasks) ? subtasks : []).map((task: any, index: number) => ({
      label: `任务 ${index + 1}「${normalizeString(task?.title) || '未命名'}」`,
      refs: task?.materialRefs,
    }));
    const coverageText = (subtasks: any[]) => [
      milestone.title,
      milestone.goal,
      milestone.description,
      milestone.coreConcept,
      ...(Array.isArray(subtasks) ? subtasks : []).map((task: any) => (
        [task?.title, task?.description, task?.acceptanceHint].filter(Boolean).join(' ')
      )),
    ].filter(Boolean).join(' ');
    // 生成一次（repairHintsOverride 非空时把它并进 repairHints；供材料语义判定失败后的带反馈重试）
    const callStagePrompt = (repairHintsOverride: Record<string, unknown> | null = null) => callPrompt<any, { subtasks: any[] }>({
      agentId: 'skill:path-task-design',
      defaultSystemPrompt: STAGE_DESIGNER_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'path-task-design' },
      // 稳定前缀（默认启用；PAYLOAD_STABLE_PREFIX=0 回退旧序）：cognitiveCore/normalizedInput 跨里程碑稳定，前置；
      // milestone/previousMilestone/repairHints 逐次变化，后置。
      buildUserPayload: (payload) => (process.env.PAYLOAD_STABLE_PREFIX !== '0'
        ? {
            cognitiveCore: payload.cognitiveCore,
            normalizedInput: stripNestedMaterials(payload.normalizedInput),
            materials: payload.materials || null,
            milestone: withLoadTargetForMilestone(payload.milestone, payload.cognitiveCore),
            previousMilestone: payload.previousMilestone || null,
            pathStageMap: payload.pathStageMap || null,
            schoolAnchor: payload.schoolAnchor || null,
            firstDeliverable: payload.firstDeliverable || null,
            successCriteria: payload.successCriteria || null,
            repairHints: payload.repairHints || null,
            // 拓扑（2026-11-18 引入，2026-11-19 审计修复）：yaml 声明 sandbox:path.pathTopology，
            // 规则「按拓扑定任务形态」直接读它；本白名单漏带 ⇒ 编排层传了也在边界被裁掉。
            pathTopology: payload.pathTopology || null,
            // 动态规划信号（2026-10-17）：上一阶段真实学习结果。此前 progressive 模式在
            // stage-enrichment 里算出了 previousStageOutcome，但 skill 的载荷白名单没带它 →
            // 信号在边界被静默丢弃（提示词侧从未见过）。同理补上 supplementRequest——
            // 补课调用一直在传，提示词的 supplementRequest 规则却永远拿不到输入。
            previousStageOutcome: payload.previousStageOutcome || null,
            supplementRequest: payload.supplementRequest || null,
            // 跨阶段去重事实源（2026-11-05 #249）：编排层 stage-enrichment 在 stageIndex>1 时注入并
            // 打「已注入」日志，但本白名单此前未带 ⇒ 键在 skill 边界被静默丢弃，模型侧从未见过它。
            // 与 previousStageOutcome 同型写成恒发键：未注入时发 null，便于从载荷直方图核对是否为空。
            allPreviousStageTasks: payload.allPreviousStageTasks || null,
          }
        : {
            milestone: withLoadTargetForMilestone(payload.milestone, payload.cognitiveCore),
            previousMilestone: payload.previousMilestone || null,
            pathStageMap: payload.pathStageMap || null,
            schoolAnchor: payload.schoolAnchor || null,
            firstDeliverable: payload.firstDeliverable || null,
            successCriteria: payload.successCriteria || null,
            cognitiveCore: payload.cognitiveCore,
            normalizedInput: stripNestedMaterials(payload.normalizedInput),
            materials: payload.materials || null,
            pathTopology: payload.pathTopology || null,
            repairHints: payload.repairHints || null,
            previousStageOutcome: payload.previousStageOutcome || null,
            supplementRequest: payload.supplementRequest || null,
            allPreviousStageTasks: payload.allPreviousStageTasks || null,
          }),
      normalizeOutput: (parsed, payload) => {
        const subtasks = withMaterialRefs(
          normalizeSubtasks(parsed?.subtasks, normalizeString(payload?.milestone?.coreConcept)),
          payload?.materials,
        );
        if (stageMaterials.length) {
          const coverage = assessMaterialRefCoverage({
            materials: stageMaterials,
            nodes: coverageNodes(subtasks),
            text: coverageText(subtasks),
            scope: 'STAGE',
          });
          logger.info('[path-task-design] materialRefs 覆盖度', {
            milestone: milestone.title,
            materials: stageMaterials.length,
            subtasks: subtasks.length,
            relevant: coverage.relevant,
            covered: coverage.covered,
            coverageRatio: `${coverage.covered}/${coverage.total}`,
          });
          if (coverage.relevant && coverage.covered === 0) {
            logger.warn('[path-task-design] 相关资料但零引用（软校验重试后仍未通过）', {
              milestone: milestone.title,
              materials: stageMaterials.length,
              subtasks: subtasks.length,
            });
          }
        }
        return { subtasks };
      },
      validateParsedOutput: (parsed) => validateStageDesignerOutput(parsed),
      // 软校验：三关都查——① 「承诺了材料却没给本体」（2026-11-02 实测：写「给你 6 个句子」
      // 却只给特征词，课堂与白板都拿不到材料）；② 「伪课」（只有整理/合并/归因/写卡、无新知识点）；
      // ③ 「相关资料却零引用」。命中任意一关 → 带反馈重试一次，仍失败按当前输出继续。
      // 三关**并列收集**而非首关即返回（2026-11-02 实测缺陷）：此前一旦材料本体不过就 early return，
      // 同一阶段里成片的伪课（M1 两节「整理判别卡 / 归因修订判别卡」）根本没机会被判定，反馈里
      // 也永远只字不提。并列后一次重试能拿到全部问题。
      // 注意：本回调是**同步契约**，全仓有同步消费方（见 teaching-turn board-deixis-guard 测试）。
      // 「材料语义判定」（2026-11-07）是一次模型调用，不能塞进来——它放在下方生成流程的异步段里。
      softValidateParsedOutput: (parsed, input) => {
        const subtasks = Array.isArray(parsed?.subtasks) ? parsed.subtasks : [];
        const problems: Array<{ failureReason: string; violations?: string[] }> = [];
        const materialBody = assessStageMaterialCompleteness(subtasks);
        if (!materialBody.valid) {
          problems.push({ failureReason: materialBody.failureReason as string, violations: materialBody.violations });
        }
        const metaLessons = assessStageMetaLessons(subtasks);
        if (!metaLessons.valid) {
          problems.push({ failureReason: metaLessons.failureReason as string, violations: metaLessons.violations });
        }
        // 题面叙事护栏（2026-11-12 实测「这种问出现了非常多次」）：题面泄露答案 / 无来源称真实 /
        // 定位题超频——「先找出这些信息最早出现在哪一轮」一类问法多批次复现，软校验不过 → 带反馈重试。
        const narration = assessStageNarration(subtasks, { hasMaterials: stageMaterials.length > 0 });
        if (!narration.valid) {
          problems.push({ failureReason: narration.failureReason as string, violations: narration.violations });
        }
        const coverage = assessMaterialRefCoverage({
          materials: stageMaterials,
          nodes: coverageNodes(subtasks),
          text: coverageText(subtasks),
          scope: 'STAGE',
        });
        if (!coverage.valid) {
          problems.push({ failureReason: coverage.failureReason, violations: coverage.violations });
        }
        // 单元清单覆盖（2026-11-25）：阶段清单（小节号或 ①②③ 条目）必须被任务的 covers 认领。
        const checklistCoverage = validateStageChecklistCoverage(parsed, input);
        if (!checklistCoverage.valid) {
          problems.push({
            failureReason: checklistCoverage.failureReason as string,
            violations: checklistCoverage.violations,
          });
        }
        if (problems.length === 0) return { valid: true };
        return {
          valid: false,
          failureReason: problems.map((problem) => problem.failureReason).join(' | '),
          violations: problems.flatMap((problem) => problem.violations || []),
        };
      },
      mapEnvelope: (output, _input, runtimeContract) => adaptToRuntimeEnvelope({
        contract: runtimeContract,
        artifact: output,
        phase: 'stage-designed',
        status: 'succeeded',
        isTerminal: true,
        nextAction: null,
        nextState: null,
      }),
      retryStrategy: {
        maxAttempts: 2,
        // failureReason 可能是多关并列（用 ' | ' 连接），逐关匹配并拼出对应改法，
        // 让一次重试能收到全部问题，而不是只有第一关。
        onValidationFail: ({ failureReason, violations }) => {
          const blocks: string[] = ['请只输出一个阶段任务 JSON 对象，必须包含 subtasks 数组。'];
          if (failureReason.includes('MATERIAL_BODY_MISSING_')) {
            blocks.push([
              '上一个版本里有任务**承诺了具体材料却没给材料本体**（例如「给你 6 个句子」却只列了 already、yesterday 这类特征词）。',
              '改法（任选其一）：① 把材料本体写进 materialPayload——句子/题面/数据值按 1. 2. 3. 编号列全，description 只留 1-2 句简介（不要把本体搬回 description）；',
              '② 引用 materials 里真实存在的小节（sectionId + 逐字 quote 写进 materialPayload，并保留 materialRefs）；③ 材料本来就属于学习者手头或前序任务产出时，在 description 里写明来源（「用你手上的 X」「用任务 2 产出的 Y」）。',
              '不许保留「给你 N 个句子/道题」却不写出这些句子/题目的写法。',
            ].join('\n'));
          }
          if (failureReason.includes('META_ONLY_LESSONS_STAGE')) {
            blocks.push([
              '上一个版本里有**伪课**：把「整理卡片 / 合并清单 / 错题归因 / 写自检卡」这类收尾动作单独做成了 40 分钟的课。',
              '这些动作属于一次练习内部的收尾，必须并进它所属的那节课（写在 description 里作为该课的产出之一），不能单独成课。',
              '改法：把这些任务合并进产生素材的那节课（如「做完 10 道题并逐题写明排除理由、错因归入四类」），或换成有独占能力增量的新任务；',
              '阶段尾部最多保留 1 节收口课（收拢成果/错因回收），且它必须有自己的产出物。',
            ].join('\n'));
          }
          if (failureReason.includes('STAGE_CHECKLIST_')) {
            blocks.push([
              '上一个版本没有把 milestone 列出的单元清单认领完整。',
              '改法：给每个 subtask 加 `covers` 数组（清单序号，1 起）；清单里每一条至少被一个任务覆盖，',
              '两节合并成一课时把两个序号都写进同一个 covers；不要删清单条目、不要把清单条目并进“综合”却不写序号。',
              'covers 的序号必须与 milestone description 里的清单顺序一致。',
            ].join(String.fromCharCode(10)));
          }
          if (failureReason.includes('MATERIAL_REFS_MISSING_')) {
            blocks.push('本阶段资料与目标相关时，每个 subtask 至少给 1 条 materialRefs：sectionId 取自资料 sections[].id，quote 逐字复制该章节标题或 keyPoints[].cite；不得改写、不得编造。与目标明显无关的资料可以整体不引用。');
          }
          if (failureReason.includes('TASK_NARRATION_GUARD')) {
            blocks.push([
              '上一个版本里有任务的**题面泄了答案或违反叙事纪律**：',
              '① description/acceptanceHint 直接给出结论或对比提示（如「注意第 X 轮说的不是 Y 而是 Z」）——题面只描述学生要做的动作与观察对象，结论一个字都不能出现；acceptanceHint 写可观察的验收动作，不得硬编码答案；',
              '② 「先找出/最早出现在第几轮/哪一轮」这类定位问句整条路径最多 1 个——多余的改成让学生复述、应用、对比、解释因果的问法；',
              '③ 没有材料本体时不得宣称「真实对话/真实记录/真实案例」——要么引用 materials 里真实存在的小节，要么写明「示例对话」。',
            ].join('\n'));
          }
          if (Array.isArray(violations) && violations.length) {
            blocks.push(`具体问题：${violations.join('；')}`);
          }
          blocks.push(`上次失败原因：${failureReason}`);
          return blocks.filter(Boolean).join('\n\n');
        },
      },
    }, repairHintsOverride
      ? {
          ...input,
          repairHints: {
            ...(input && typeof input === 'object' && input.repairHints && typeof input.repairHints === 'object'
              ? input.repairHints
              : {}),
            ...repairHintsOverride,
          },
        }
      : input);

    let result = await callStagePrompt();

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'STAGE_DESIGNER_INVALID');
    }

    // 材料自足性的**语义判定**（2026-11-07）：正则认不出「几件 AI 教育事件」「给你二十一个句子」
    // 这类中文数词/不定量词悬空引用，改由模型判。这一步刻意放在**本来就异步的生成流程**里，
    // 而不是塞进同步的 softValidateParsedOutput——后者有同步消费方（teaching-turn），
    // 把它的返回类型放宽成 Promise 等于逼全仓做一次同步→异步迁移。
    // 命中则把 violations 作为 repairHints 带反馈重试一次；仍失败保留首轮输出（不阻塞）。
    const generatedSubtasks = Array.isArray(result.output.subtasks) ? result.output.subtasks : [];
    if (generatedSubtasks.length > 0) {
      const semanticMaterial = await assessStageMaterialCompletenessByModel(generatedSubtasks, {
        stageTitle: milestone.title,
      });
      if (!semanticMaterial.valid) {
        logger.warn('[path-task-design] 材料语义判定命中，带反馈重试一次', {
          milestone: milestone.title,
          violations: semanticMaterial.violations,
        });
        const retry = await callStagePrompt({ materialBodyViolations: semanticMaterial.violations });
        if (retry.success && retry.output) {
          result = retry;
        } else {
          logger.warn('[path-task-design] 材料语义判定重试未成功，保留首轮输出', { milestone: milestone.title });
        }
      }
    }

    return {
      success: true,
      output: {
        subtasks: result.output.subtasks,
        runtimeEnvelope: result.runtimeEnvelope,
        _debug: {
          rawModelOutput: result.debug.rawModelOutput,
          extractedJson: result.debug.extractedJson,
          userPayload: result.debug.userPayload,
          systemPromptVersion: result.debug.systemPromptVersion,
        },
      },
      duration: result.debug.durationMs,
    };
  } catch (error: any) {
    return {
      success: false,
      error: {
        code: 'STAGE_DESIGNER_FAILED',
        message: error?.message || 'Unknown error'
      },
      duration: 0,
    };
  }
}

export default stageDesigner;
