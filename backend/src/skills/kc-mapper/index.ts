import { SkillDefinition, SkillExecutionResult } from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { loadPromptFile } from '../../composers/prompt-files/loader';

export const KC_MAPPER_PROMPT = loadPromptFile('skill:kc-mapper')?.systemPrompt || '';

const KC_TAXONOMY = ['factual', 'conceptual', 'procedural', 'metacognitive'] as const;

export const kcMapperDefinition: SkillDefinition = {
  name: 'kc-mapper',
  displayName: '知识组件映射器',
  version: '1.0.0',
  category: 'analysis',
  description: '将认知概念和子任务分解为细粒度 KC，标注前置依赖',
  inputSchema: {
    type: 'object',
    properties: { cognitiveCore: { type: 'object' }, milestones: { type: 'array' }, subtasks: { type: 'array' }, prerequisiteTree: { type: 'object' } },
  },
  outputSchema: { type: 'object', properties: { conceptKcs: { type: 'array' }, taskKcLinks: { type: 'array' }, kcGraph: { type: 'object' }, gapCoverage: { type: 'object' } } },
  capabilities: ['kc-mapping', 'knowledge-graph'],
  stats: { callCount: 0, successRate: 0, avgLatency: 0 }
};

export function validateKcMapperOutput(parsed: any) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { valid: false as const, failureReason: 'KC_MAPPER_OUTPUT_NOT_OBJECT' };
  if (!Array.isArray(parsed.conceptKcs)) return { valid: false as const, failureReason: 'KC_MAPPER_CONCEPT_KCS_MISSING' };
  return { valid: true as const };
}

/**
 * 契约校验前的等价变体归一（core fields 契约校验用；业务形态仍由 normalizeOutput 决定）。
 *
 * 2026-09-22 事故：core 声明 gapCoverage 为 `object?`，严格 schema 只接受 object/null/缺省；
 * 而模型在**未提供 prerequisiteTree** 时普遍输出 `gapCoverage: []` 或 `{}`，被
 * `gapCoverage(type-mismatch:object)` 判死——两次重试都合规仍失败。这里按语义归一：
 * 空的 gapCoverage（[]、{}、null、无有效键）一律**移除该字段**（"无缺口报告"与缺省等价），
 * 非空对象保留。同理归一 taskKcLinks 的 kcIds/linkedKcIds 别名 → linkedKCs（下游读取侧亦有容错）。
 */
export function coerceKcMapperParsed(parsed: any): any {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;

  const out: any = { ...parsed };

  const gc = out.gapCoverage;
  const gcEmpty = gc === undefined
    || gc === null
    || (Array.isArray(gc) && gc.length === 0)
    || (typeof gc === 'object' && !Array.isArray(gc) && Object.keys(gc).length === 0);
  if (gcEmpty) {
    delete out.gapCoverage;
  } else if (Array.isArray(gc)) {
    // 模型实测形态（2026-09-22）：gapCoverage 被写成"逐概念的覆盖明细"数组
    //   [{ conceptId, coveredByKcs: [...], gaps: [...] }, ...]
    // 与契约 { covered: string[], uncovered: [{concept, reason}] } 不同名。
    // 按语义归一：gaps 非空 → uncovered（有缺口）；否则归入 covered。
    out.gapCoverage = normalizeGapCoverageEntries(gc);
  } else if (typeof gc === 'object') {
    // 也可能只给单条明细对象 { conceptId, gaps: [...], coveredKCs: [...] }，或已是契约形态
    const hasContractShape = Array.isArray((gc as any).covered) || Array.isArray((gc as any).uncovered);
    if (!hasContractShape) {
      out.gapCoverage = normalizeGapCoverageEntries([gc]);
    }
  }

  if (Array.isArray(out.taskKcLinks)) {
    out.taskKcLinks = out.taskKcLinks.map((link: any) => {
      if (!link || typeof link !== 'object') return link;
      if (Array.isArray(link.linkedKCs)) return link;
      const alias = Array.isArray(link.kcIds) ? link.kcIds
        : Array.isArray(link.linkedKcIds) ? link.linkedKcIds
        : Array.isArray(link.kcs) ? link.kcs
        : null;
      return alias ? { ...link, linkedKCs: alias } : link;
    });
  }

  // 边字段名归一：契约 relation，实测模型常写 type，甚至完全省略（2026-09-22）。
  // 本 skill 的边语义唯一（都是前置依赖），缺省即补 "prerequisite"，保证下游按 relation 读取不落空。
  if (out.kcGraph && typeof out.kcGraph === 'object' && Array.isArray((out.kcGraph as any).edges)) {
    (out.kcGraph as any).edges = (out.kcGraph as any).edges.map((e: any) => {
      if (!e || typeof e !== 'object') return e;
      if (e.relation === undefined) return { ...e, relation: typeof e.type === 'string' ? e.type : 'prerequisite' };
      return e;
    });
  }

  // 节点补全：契约要求 { kcId, name, taxonomy }；实测模型会省略 name/taxonomy。
  // 从 conceptKcs 的 KC 明细回填（同名 kcId 的名称/分类），仍缺则给安全默认，避免下游 name 为空。
  if (out.kcGraph && typeof out.kcGraph === 'object' && Array.isArray((out.kcGraph as any).nodes)) {
    const kcDetailById = new Map<string, { name?: string; taxonomy?: string }>();
    for (const item of Array.isArray(out.conceptKcs) ? out.conceptKcs : []) {
      for (const kc of Array.isArray(item?.kcs) ? item.kcs : []) {
        if (!kc || typeof kc !== 'object' || typeof kc.kcId !== 'string') continue;
        kcDetailById.set(kc.kcId, { name: kc.name, taxonomy: kc.taxonomy });
      }
    }
    (out.kcGraph as any).nodes = (out.kcGraph as any).nodes.map((n: any) => {
      // 实测形态：节点可能被写成纯字符串 kcId（而非 { kcId, name, taxonomy } 对象），先归一为对象
      const node = typeof n === 'string' ? { kcId: n } : n;
      if (!node || typeof node !== 'object' || typeof node.kcId !== 'string') return node;
      const detail = kcDetailById.get(node.kcId);
      return {
        ...node,
        name: typeof node.name === 'string' && node.name.trim() ? node.name : (detail?.name || node.kcId),
        taxonomy: typeof node.taxonomy === 'string' && node.taxonomy.trim() ? node.taxonomy : (detail?.taxonomy || 'conceptual'),
      };
    });
  }

  return out;
}

/**
 * 把模型的"逐概念覆盖明细"归一到契约形态 { covered: string[], uncovered: [{concept, reason}] }。
 * 兼容 coveredKCs / coveredByKcs / gaps 等实测字段名（2026-09-22）。
 */
function normalizeGapCoverageEntries(entries: any[]): { covered: string[]; uncovered: Array<{ concept: string; reason: string }> } {
  const covered: string[] = [];
  const uncovered: Array<{ concept: string; reason: string }> = [];
  for (const item of entries) {
    if (!item || typeof item !== 'object') continue;
    const conceptLabel = String((item as any).concept ?? (item as any).conceptId ?? '').trim();
    const gaps = Array.isArray((item as any).gaps) ? (item as any).gaps : [];
    if (gaps.length > 0) {
      for (const g of gaps) {
        uncovered.push({
          concept: String((g as any)?.concept ?? (typeof g === 'string' ? conceptLabel : conceptLabel)),
          reason: String((g as any)?.reason ?? (typeof g === 'string' ? g : '存在未覆盖缺口')),
        });
      }
    } else if (conceptLabel) {
      covered.push(conceptLabel);
    }
  }
  return { covered, uncovered };
}

/**
 * KC 粒度控制（警告级审计，不阻断）：
 * - 每个 coreConcept 的 KC 数应在 2-5 区间（kc-mapper.yaml rule 32）
 * - 每个 subtask 应关联 ≥1 个 KC（kc-mapper.yaml rule 36）
 * 不足时记录 warning 供审计，不打断路径生成（与 hub 复用同理，避免打回破坏生产）。
 */
export function auditKcGranularity(parsed: any, input: any): string[] {
  const warnings: string[] = [];
  const conceptKcs = Array.isArray(parsed?.conceptKcs) ? parsed.conceptKcs : [];
  const taskKcLinks = Array.isArray(parsed?.taskKcLinks) ? parsed.taskKcLinks : [];

  // 每个 coreConcept 的 KC 数
  const concepts = Array.isArray(input?.cognitiveCore?.coreConcepts)
    ? input.cognitiveCore.coreConcepts
    : [];
  const kcByConcept = new Map<string, number>();
  for (const item of conceptKcs) {
    if (!item || typeof item !== 'object') continue;
    const conceptId = item.conceptId;
    const kcs = Array.isArray(item.kcs) ? item.kcs.filter(Boolean) : [];
    kcByConcept.set(conceptId, kcs.length);
  }
  for (const concept of concepts) {
    if (!concept || typeof concept !== 'object') continue;
    const count = kcByConcept.get(concept.id) ?? 0;
    if (count < 2 || count > 5) {
      warnings.push(`KC_GRANULARITY_OUT_OF_RANGE(concept=${concept.id}, kcCount=${count}, expected 2-5)`);
    }
  }

  // 每个 subtask 关联 ≥1 KC
  const subtasks = Array.isArray(input?.subtasks) ? input.subtasks : [];
  const linkedTaskTitles = new Set<string>();
  for (const link of taskKcLinks) {
    if (!link || typeof link !== 'object') continue;
    const title = typeof link.taskTitle === 'string' ? link.taskTitle : null;
    if (title) linkedTaskTitles.add(title);
  }
  for (const task of subtasks) {
    if (!task || typeof task !== 'object') continue;
    const title = typeof task.title === 'string' ? task.title : null;
    if (title && !linkedTaskTitles.has(title)) {
      warnings.push(`KC_TASK_UNLINKED(task=${title.slice(0, 20)}, linkedKCs 缺失)`);
    }
  }

  return warnings;
}

export async function kcMapper(input: any): Promise<SkillExecutionResult<any>> {
  try {
    const result = await callPrompt<any, any>({
      agentId: 'skill:kc-mapper',
      defaultSystemPrompt: KC_MAPPER_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'kc-mapper' },
      buildUserPayload: (payload) => ({
        cognitiveCore: payload.cognitiveCore,
        milestones: payload.milestones || [],
        subtasks: payload.subtasks || [],
        prerequisiteTree: payload.prerequisiteTree || null,
      }),
      normalizeOutput: (parsed) => {
        // 落库前同样走契约归一：否则校验通过、落库的却仍是别名字段（kcIds / type / 逐概念 gapCoverage），
        // 下游按 linkedKCs / relation / {covered,uncovered} 读取会静默读空（2026-09-22 实测）。
        const normalized = coerceKcMapperParsed(parsed);
        const conceptKcs = Array.isArray(normalized?.conceptKcs) ? normalized.conceptKcs : [];
        const taskKcLinks = Array.isArray(normalized?.taskKcLinks) ? normalized.taskKcLinks : [];
        return {
          conceptKcs,
          taskKcLinks,
          kcGraph: normalized?.kcGraph || { nodes: [], edges: [] },
          gapCoverage: normalized?.gapCoverage ?? null,
          // KC 粒度审计（警告级）：每概念 2-5 KC、每任务 ≥1 关联 KC
          audit: auditKcGranularity(normalized, input),
        };
      },
      validateParsedOutput: (parsed) => validateKcMapperOutput(parsed),
      // 契约校验前的等价变体归一（见 coerceKcMapperParsed 头注：空 gapCoverage / kcIds 别名）
      coerceParsedForContract: (parsed) => coerceKcMapperParsed(parsed),
      mapEnvelope: (output, _input, runtimeContract) => adaptToRuntimeEnvelope({
        contract: runtimeContract,
        artifact: output,
        phase: 'kc-mapped',
        status: 'succeeded',
        isTerminal: true,
        nextAction: null,
        nextState: null,
      }),
      retryStrategy: {
        maxAttempts: 2,
        // 重试必须带上失败反馈：2026-09-22 诊断——kc-mapper 此前只有 maxAttempts 而缺本回调，
        // 重试时不告知模型上次哪里不合规，弱模型/漂移模型会原样再犯；对齐 teaching-turn/goal-conversation 的既有做法。
        onValidationFail: ({ failureReason }) =>
          `上一次输出未通过结构化校验，原因：${failureReason || '输出不是合法 JSON 对象'}。`
          + '请直接输出且只输出一个 JSON 对象，不要输出任何解释、标题、markdown 标题或代码块围栏。'
          + '对象必须包含顶层字段 conceptKcs（数组，每项 { conceptId, kcs: [{ kcId, name, taxonomy, prerequisiteKCs }] }），'
          + '并可包含 taskKcLinks、kcGraph、gapCoverage；字段名必须与约定完全一致，不要自创字段、不要返回讲解文字。',
      },
    }, input);

    if (!result.success || !result.output) throw new Error(result.error?.message || 'KC_MAPPER_FAILED');
    return { success: true, output: result.output, duration: result.debug.durationMs };
  } catch (error: any) {
    return { success: false, error: { code: 'KC_MAPPER_FAILED', message: error?.message || 'Unknown error' }, duration: 0 };
  }
}

export default kcMapper;