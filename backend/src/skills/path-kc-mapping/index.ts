import { SkillDefinition, SkillExecutionResult } from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import { logger } from '../../utils/logger';

export const KC_MAPPER_PROMPT = loadPromptFile('skill:path-kc-mapping')?.systemPrompt || '';

const KC_TAXONOMY = ['factual', 'conceptual', 'procedural', 'metacognitive'] as const;

export const kcMapperDefinition: SkillDefinition = {
  name: 'path-kc-mapping',
  displayName: '知识组件映射器',
  version: '1.0.0',
  category: 'analysis',
  description: '将认知概念和子任务分解为细粒度 KC，标注前置依赖',
  inputSchema: {
    type: 'object',
    properties: { cognitiveCore: { type: 'object' }, milestones: { type: 'array' }, subtasks: { type: 'array' }, prerequisiteTree: { type: 'object' } },
  },
  outputSchema: { type: 'object', properties: { conceptKcs: { type: 'array' }, taskKcLinks: { type: 'array' }, kcGraph: { type: 'object' } } },
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
 * 归一 taskKcLinks 的 kcIds/linkedKcIds/linkedKC/kcs 别名 → linkedKCs；
 * kcGraph **不再由模型输出**（2026-11-18）：统一从 conceptKcs 的 prerequisiteKCs 派生，
 * 避免同一个 JSON 里手抄两份边、方向写反或漏节点。
 */
export function coerceKcMapperParsed(parsed: any): any {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;

  const out: any = { ...parsed };

  // #193：gapCoverage 已不是契约字段；模型若残留该键，一律丢弃，避免非契约字段流入落库产物。
  delete out.gapCoverage;

  if (Array.isArray(out.taskKcLinks)) {
    out.taskKcLinks = out.taskKcLinks.map((link: any) => {
      if (!link || typeof link !== 'object') return link;
      if (Array.isArray(link.linkedKCs)) return link;
      // linkedKC（单数）曾在 rules 里被写错，历史/漂移模型仍可能输出；与 kcIds 等同级归一。
      const alias = Array.isArray(link.linkedKC) ? link.linkedKC
        : Array.isArray(link.kcIds) ? link.kcIds
        : Array.isArray(link.linkedKcIds) ? link.linkedKcIds
        : Array.isArray(link.kcs) ? link.kcs
        : null;
      return alias ? { ...link, linkedKCs: alias } : link;
    });
  }

  const derived = deriveKcGraph(out.conceptKcs, parsed?.kcGraph);
  out.kcGraph = { nodes: derived.nodes, edges: derived.edges };
  return out;
}

interface DerivedKcGraph {
  nodes: Array<{ kcId: string; name: string; taxonomy: string }>;
  edges: Array<{ from: string; to: string; relation: 'prerequisite' }>;
  /** 被 prerequisiteKCs 引用、但概念树里没有完整定义的 kcId（旧实现会静默丢边）。 */
  danglingKcIds: string[];
}

/**
 * 从 conceptKcs 派生 KC 依赖图（单一真相源：prerequisiteKCs 是子→父，派生成 from=前置→to=后继）。
 * 兼容旧载荷：模型若仍带 kcGraph，只把它当补充节点/边；方向仍按本函数的 from=前置解释。
 */
export function deriveKcGraph(
  conceptKcs: unknown,
  legacyGraph?: { nodes?: unknown[]; edges?: unknown[] } | null,
): DerivedKcGraph {
  const nodes = new Map<string, { kcId: string; name: string; taxonomy: string }>();
  const edgeKeys = new Set<string>();
  const edges: DerivedKcGraph['edges'] = [];
  const referenced = new Set<string>();

  const addNode = (kcId: string, name?: unknown, taxonomy?: unknown) => {
    if (!kcId) return;
    const prev = nodes.get(kcId);
    const nextName = typeof name === 'string' && name.trim() ? name : prev?.name || kcId;
    const nextTax = typeof taxonomy === 'string' && taxonomy.trim() ? taxonomy : prev?.taxonomy || 'conceptual';
    nodes.set(kcId, { kcId, name: nextName, taxonomy: nextTax });
  };

  for (const item of Array.isArray(conceptKcs) ? conceptKcs : []) {
    for (const kc of Array.isArray(item?.kcs) ? item.kcs : []) {
      if (!kc || typeof kc !== 'object' || typeof kc.kcId !== 'string') continue;
      addNode(kc.kcId, kc.name, kc.taxonomy);
    }
  }
  // 旧载荷补充节点（只补 kcId 已知、概念树里没定义的）
  for (const raw of Array.isArray(legacyGraph?.nodes) ? legacyGraph.nodes : []) {
    const node = typeof raw === 'string' ? { kcId: raw } : raw;
    if (!node || typeof node !== 'object' || typeof (node as any).kcId !== 'string') continue;
    const n = node as { kcId: string; name?: unknown; taxonomy?: unknown };
    if (!nodes.has(n.kcId)) addNode(n.kcId, n.name, n.taxonomy);
  }

  for (const item of Array.isArray(conceptKcs) ? conceptKcs : []) {
    for (const kc of Array.isArray(item?.kcs) ? item.kcs : []) {
      if (!kc || typeof kc !== 'object' || typeof kc.kcId !== 'string') continue;
      for (const prereq of Array.isArray(kc.prerequisiteKCs) ? kc.prerequisiteKCs : []) {
        const from = typeof prereq === 'string' ? prereq : '';
        if (!from || from === kc.kcId) continue;
        referenced.add(from);
        const key = `${from}->${kc.kcId}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push({ from, to: kc.kcId, relation: 'prerequisite' });
      }
    }
  }
  // 旧载荷边：两端已定义才并入（方向沿用 from=前置）
  for (const raw of Array.isArray(legacyGraph?.edges) ? legacyGraph.edges : []) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as { from?: unknown; to?: unknown };
    const from = typeof e.from === 'string' ? e.from : '';
    const to = typeof e.to === 'string' ? e.to : '';
    if (!from || !to || from === to) continue;
    const key = `${from}->${to}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ from, to, relation: 'prerequisite' });
  }

  const danglingKcIds = [...new Set([
    ...[...referenced].filter((id) => !nodes.has(id)),
    ...edges.flatMap((e) => [e.from, e.to]).filter((id) => !nodes.has(id)),
  ])];
  return {
    nodes: [...nodes.values()],
    // 悬空端点的边不落图：下游 materialize 会静默 skip，这里提前过滤并留审计
    edges: edges.filter((e) => nodes.has(e.from) && nodes.has(e.to)),
    danglingKcIds,
  };
}

/**
 * KC 粒度控制（警告级审计，不阻断）：
 * - 每个 coreConcept 的 KC 数应在 2-5 区间（path-kc-mapping.yaml rule 32）
 * - 每个 subtask 应关联 ≥1 个 KC（path-kc-mapping.yaml rule 36）
 * 不足时记录 warning 供审计，不打断路径生成（与 hub 复用同理，避免打回破坏生产）。
 */
export function auditKcGranularity(parsed: any, input: any): string[] {
  const warnings: string[] = [];
  const conceptKcs = Array.isArray(parsed?.conceptKcs) ? parsed.conceptKcs : [];
  const taskKcLinks = Array.isArray(parsed?.taskKcLinks) ? parsed.taskKcLinks : [];

  // 悬空前置：被 prerequisiteKCs 引用、但 conceptKcs 里没有完整定义的 kcId。
  // 旧实现只在物化时静默 skip，等于把依赖边悄悄丢掉；这里显式告警。
  const { danglingKcIds } = deriveKcGraph(conceptKcs);
  if (danglingKcIds.length > 0) {
    warnings.push(`KC_DANGLING_PREREQ(ids=${danglingKcIds.slice(0, 8).join(',')})`);
  }

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

  // 每个 subtask 关联 ≥1 KC（2026-11-19：优先按 taskKey 对齐；标题只作无 key 时的回退，
  // 同阶段同名任务不会再把另一条 link 当成自己的关联）
  const subtasks = Array.isArray(input?.subtasks) ? input.subtasks : [];
  const linkedTaskTitles = new Set<string>();
  const linkedTaskKeys = new Set<string>();
  for (const link of taskKcLinks) {
    if (!link || typeof link !== 'object') continue;
    const title = typeof link.taskTitle === 'string' ? link.taskTitle : null;
    const taskKey = typeof link.taskKey === 'string' ? link.taskKey : null;
    if (title) linkedTaskTitles.add(title);
    if (taskKey) linkedTaskKeys.add(taskKey);
  }
  for (const task of subtasks) {
    if (!task || typeof task !== 'object') continue;
    const title = typeof task.title === 'string' ? task.title : null;
    const taskKey = typeof task.taskKey === 'string' ? task.taskKey : null;
    const linked = taskKey
      ? linkedTaskKeys.has(taskKey)
      : (title ? linkedTaskTitles.has(title) : false);
    if (!linked) {
      const label = taskKey ? `taskKey=${taskKey.slice(0, 24)}` : `task=${(title || '').slice(0, 20)}`;
      warnings.push(`KC_TASK_UNLINKED(${label}, linkedKCs 缺失)`);
    }
  }

  return warnings;
}

export async function kcMapper(input: any): Promise<SkillExecutionResult<any>> {
  try {
    const result = await callPrompt<any, any>({
      agentId: 'skill:path-kc-mapping',
      defaultSystemPrompt: KC_MAPPER_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'path-kc-mapping' },
      buildUserPayload: (payload) => ({
        cognitiveCore: payload.cognitiveCore,
        milestones: payload.milestones || [],
        subtasks: payload.subtasks || [],
        prerequisiteTree: payload.prerequisiteTree || null,
      }),
      normalizeOutput: (parsed) => {
        // 落库前同样走契约归一：否则校验通过、落库的却仍是别名字段（kcIds / type 形态），
        // 下游按 linkedKCs / relation 读取会静默读空（2026-09-22 实测）。
        const normalized = coerceKcMapperParsed(parsed);
        const conceptKcs = Array.isArray(normalized?.conceptKcs) ? normalized.conceptKcs : [];
        const taskKcLinks = Array.isArray(normalized?.taskKcLinks) ? normalized.taskKcLinks : [];
        // KC 粒度审计（警告级）：每概念 2-5 KC、每任务 ≥1 关联 KC。此前作为 audit 字段随产物落库、
        // 全仓无读取（issue #193）——它本就只是告警，改为直接进日志（消费方=可观测性），不再进产物。
        const auditWarnings = auditKcGranularity(normalized, input);
        if (auditWarnings.length > 0) {
          logger.warn('[path-kc-mapping] KC 粒度审计告警', { warnings: auditWarnings });
        }
        return {
          conceptKcs,
          taskKcLinks,
          kcGraph: normalized?.kcGraph || { nodes: [], edges: [] },
        };
      },
      validateParsedOutput: (parsed) => validateKcMapperOutput(parsed),
      // 契约校验前的等价变体归一（见 coerceKcMapperParsed 头注：kcIds 别名 / kcGraph 补全）
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
        // 重试必须带上失败反馈：2026-09-22 诊断——path-kc-mapping 此前只有 maxAttempts 而缺本回调，
        // 重试时不告知模型上次哪里不合规，弱模型/漂移模型会原样再犯；对齐 teaching-turn/goal-conversation 的既有做法。
        onValidationFail: ({ failureReason }) =>
          `上一次输出未通过结构化校验，原因：${failureReason || '输出不是合法 JSON 对象'}。`
          + '请直接输出且只输出一个 JSON 对象，不要输出任何解释、标题、markdown 标题或代码块围栏。'
          + '对象必须包含顶层字段 conceptKcs（数组，每项 { conceptId, kcs: [{ kcId, name, taxonomy, prerequisiteKCs }] }），'
          + '并可包含 taskKcLinks、kcGraph；字段名必须与约定完全一致，不要自创字段、不要返回讲解文字。',
      },
    }, input);

    if (!result.success || !result.output) throw new Error(result.error?.message || 'KC_MAPPER_FAILED');
    return { success: true, output: result.output, duration: result.debug.durationMs };
  } catch (error: any) {
    return { success: false, error: { code: 'KC_MAPPER_FAILED', message: error?.message || 'Unknown error' }, duration: 0 };
  }
}

export default kcMapper;