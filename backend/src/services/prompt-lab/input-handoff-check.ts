/**
 * inputs 声明 ↔ 字段路由 handoff 对账（§2.5 advisory 守门）
 *
 * 规则：core 声明的每个 input ref skill:Y.F，上游 skill:Y 的路由表中应存在
 * 与 F 前缀匹配的字段行，且 handoff 包含本 skill。
 * 对不上不阻断（路由表可能滞后于业务演进），以 advisory 告警呈现。
 *
 * 另含「声明边 ↔ 抽取器」对账（#189）：配置式跨阶段交接声明的 handoff 行，
 * 必须落在对应抽取器实际读取的 agentId 集合内，否则该声明在运行时永远抽不到值。
 */
import {
  getAgentRoutings,
  listConfigDrivenStageHandoffs,
  type FieldRoutingRow,
} from '../field-dispatcher';
import { getAgentOfSkill, getCanonicalAgentId } from '../agent-manifest.service';
import type { CoreFile, CoreInputRef } from './core-file-loader';
import type { GateIssue } from './core-compiler';

function fieldMatches(routingFieldId: string, refFieldPath: string): boolean {
  return (
    routingFieldId === refFieldPath ||
    routingFieldId.startsWith(`${refFieldPath}.`) ||
    refFieldPath.startsWith(`${routingFieldId}.`)
  );
}

/**
 * 对账单个 input ref（§2.5 三前缀分叉）：
 * - skill:Y.F：校验上游 skill/agent 路由表存在匹配字段且 handoff 包含本 skill
 * - sandbox:<path>：校验沙盘路径注册表（AgentContractView）
 * - user:<path>：绿灯（自文档化，运行时由执行信封承载）
 * 返回 null 表示通过；否则返回告警。
 */
export async function checkInputRefHandoff(
  core: CoreFile,
  input: CoreInputRef
): Promise<GateIssue | null> {
  if (input.kind === 'user') {
    return null; // user: 前缀绿灯
  }
  if (input.kind === 'sandbox') {
    return checkSandboxPath(input.ref.replace(/^sandbox:/, ''), input.ref);
  }
  const upstreamSkillId = `skill:${input.skill}`;
  const downstreamAgentId = `skill:${core.skillId}`;
  // 路由行可能挂在 skill 名下，也可能挂在编排层 agent 名下（如 normalizedInput/previousMilestone
  // 由 path-agent 确定性定帧）——先查 skill 行，再查其所属 agent 行兜底
  const upstreamOwnerIds = [
    upstreamSkillId,
    getAgentOfSkill(upstreamSkillId)?.id || '',
  ].filter(Boolean);
  const routings = (await Promise.all(
    upstreamOwnerIds.map((agentId) => getAgentRoutings(agentId).catch(() => []))
  )).flat() as FieldRoutingRow[];

  if (!routings.length) {
    return {
      code: 'input-upstream-unrouted',
      message: `「${input.ref}」上游 ${upstreamSkillId}（含所属 agent）没有任何字段路由登记，无法核对 handoff（advisory）`,
    };
  }

  const matched = routings.filter((row) => fieldMatches(row.fieldId, input.fieldPath));
  if (!matched.length) {
    return {
      code: 'input-field-unrouted',
      message: `「${input.ref}」上游路由表没有与 ${input.fieldPath} 匹配的字段（advisory）`,
    };
  }

  const handedOff = matched.filter((row) => row.handoff.includes(downstreamAgentId));
  if (!handedOff.length) {
    return {
      code: 'input-no-handoff',
      message:
        `「${input.ref}」上游路由表有该字段，但 handoff 未包含 ${downstreamAgentId}` +
        `（已登记 handoff：${[...new Set(matched.flatMap((r) => r.handoff))].join('、') || '无'}；advisory）`,
    };
  }
  return null;
}

/** sandbox: 路径对账：对照沙盘路径注册表（AgentContractView 动态推导 + 静态补充键） */
async function checkSandboxPath(path: string, ref: string): Promise<GateIssue | null> {
  const { validateSandboxPath } = await import('../agent-contract-view');
  const error = await validateSandboxPath(path);
  if (error) {
    return { code: 'sandbox-path-unregistered', message: `「${ref}」${error}（advisory）` };
  }
  return null;
}

/** 对账 core 的全部 inputs 声明；返回 advisory 告警列表（通过为空数组） */
export async function checkInputHandoffs(core: CoreFile): Promise<GateIssue[]> {
  if (!core.inputs?.length) return [];
  const issues = await Promise.all(core.inputs.map((input) => checkInputRefHandoff(core, input)));
  return issues.filter((issue): issue is GateIssue => issue !== null);
}

/** 编排文件里一张 stage 的路由声明（结构最小化，便于注入测试） */
export interface StageRoutingDecl {
  stage: string;
  routings: ReadonlyArray<{ agentId: string; fieldId: string; handoff?: string[] }>;
}

/**
 * 声明边 ↔ 抽取器对账（#189）：对每个登记在册的配置式跨阶段交接抽取器，
 * 检查其 source 阶段内所有 handoff 指向 target 阶段的行，是否都落在抽取器
 * 实际读取的 agentId 集合内。落在范围外 = 该交接声明运行时不生效（静默失效）。
 */
// ============================================================
// 规则引用键 ↔ inputs 声明对账（#197）
// ============================================================

const RULE_KEY_DOTTED = /\b[a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+\b/g;
/** 代码路径/文件名（如 learning.service、x.yaml）不是数据键 */
const RULE_KEY_CODE_PATH = /\.(ts|js|json|yaml|yml|md|service|coordinator|tsx)$/;
/** 文档自指（core 文件自己的分节名），不是数据键 */
const RULE_KEY_SELF_ROOTS = new Set([
  'fields',
  'rules',
  'inputs',
  'constraints',
  'identity',
  'channels',
  'params',
]);

/**
 * 规则引用键的来源登记（#197 护栏的注释表）。
 *
 * 背景：core 规则里引用的数据键，原则上必须能在本文件 `inputs` 声明里找到根
 * （含声明输入/输出字段下的子键）。但存量里有两类合法简写，靠文本推不出来，
 * 必须逐条登记来源，否则护栏会误报：
 * - 子键简写：规则写 `timeDimensions.deadlineDate`，实际装配位置是 `normalizedInput.timeDimensions`；
 * - 编排注入顶层键：编排层在 executeSkill payload 顶层塞的键（如 visualOpportunity）。
 *
 * 新增一条 = 承认「该键不直接对应一条 inputs 声明，来源如下」；没有登记的键会被护栏拦下。
 */
export interface RuleKeySource {
  /** 规则里引用的根键（简写形式） */
  key: string;
  /** 实际归属：已声明输入/输出字段路径，或 `payload:<key>` 表示编排层注入的顶层载荷键 */
  owner: string;
  /** 证据（仓库相对路径:行，或 core 文件内规则位置） */
  evidence: string;
}

export const RULE_KEY_SOURCES: Readonly<Record<string, readonly RuleKeySource[]>> = {
  'path-planning': [
    {
      key: 'timeDimensions',
      owner: 'normalizedInput',
      evidence:
        'backend/src/services/learning/generation/stage-enrichment.ts:1337（normalizedInput.timeDimensions）；' +
        'backend/src/services/learning/goal-path-visible-summary.ts:326',
    },
  ],
  'stage-designer': [
    {
      key: 'planningHints',
      owner: 'normalizedInput',
      evidence:
        'backend/src/services/learning/generation/path-generation.core.ts:336（buildFramedNormalizedInput 附加 planningHints）',
    },
  ],
  'teaching-opening-generator': [
    {
      key: 'lastLessonRecap',
      owner: 'payload:lastLessonRecap（编排注入顶层键）',
      evidence: 'backend/src/services/ai-teaching/teaching-turn-engine.ts:221',
    },
    {
      key: 'priorLearningContext',
      owner: 'payload:priorLearningContext（编排注入顶层键）',
      evidence: 'backend/src/services/ai-teaching/teaching-turn-engine.ts:222',
    },
    {
      key: 'sameTaskHistory',
      owner: 'lastLessonRecap.sameTaskHistory',
      evidence: 'prompts/core/teaching-opening-generator.yaml 规则「sameTaskHistory.lastUnresolvedPoints」',
    },
  ],
  'teaching-turn': [
    {
      key: 'reliability',
      owner: 'scenario.learnerPrediction',
      evidence: 'backend/src/services/ai-teaching/teaching-turn-shared.ts:96（learnerPredictionPayload.reliability）',
    },
    {
      key: 'sameTaskHistory',
      owner: 'scenario.lastLessonRecap',
      evidence: 'backend/src/services/ai-teaching/teaching-turn-shared.ts:132（lastLessonRecap 原样注入 scenario）',
    },
    {
      key: 'taskDifficulty',
      owner: 'learner（learnerProjection）',
      evidence: 'backend/src/services/ai-teaching/TeachingContextBuilder.ts:134（toTeachingProjection.taskDifficulty）',
    },
    {
      key: 'visualOpportunity',
      owner: 'payload:visualOpportunity（编排注入顶层键）',
      evidence: 'backend/src/services/ai-teaching/teaching-turn-engine.ts:511',
    },
  ],
  'virtual-learner-actor-auditor': [
    {
      key: 'epistemicGrounding',
      owner: 'learnerPrivateState',
      evidence: 'prompts/core/virtual-learner-actor-auditor.yaml 规则「若 learnerPrivateState 里存在 epistemicGrounding」',
    },
  ],
  'virtual-learner-goal-dialogue-simulator': [
    {
      key: 'friction',
      owner: 'frictionBudget',
      evidence: 'backend/src/coordinators/simulation.helpers.ts:895（getSessionFrictionBudget 装配）',
    },
  ],
  'virtual-learner-learn-turn-simulator': [
    {
      key: 'friction',
      owner: 'frictionBudget',
      evidence: 'backend/src/coordinators/simulation.helpers.ts:895（getSessionFrictionBudget 装配）',
    },
  ],
  'virtual-learner-path-evaluator': [
    {
      key: 'friction',
      owner: 'frictionBudget',
      evidence: 'backend/src/coordinators/simulation.helpers.ts:895（getSessionFrictionBudget 装配）',
    },
  ],
};

/**
 * 规则引用键 ↔ inputs 声明对账（#197）：规则正文里以点路径引用的数据键
 * （如 `knowledgeContext.delta`、`sessionStructure.finalClassroomContext`），其根必须
 * 能在本文件声明层定位到 —— 已声明的输入/输出字段、由声明根可推导的子路径
 * （含文件内出现的末段简写），或 RULE_KEY_SOURCES 里登记了来源。
 *
 * 为什么不按「输入提供 X」句式收窄：#197 的两个键出现在「证据优先级」枚举与规则括注里，
 * 不是「输入提供 X」句式；只按条件句式收窄会漏掉 #197 本体（实测）。
 *
 * 未声明任何 inputs 的 core 文件不参与对账（没有声明面可比，如 handler-only / 直调 skill）。
 * 返回值非空 = 规则依赖的键在声明层看不见（与 #197 同类）。
 */
export function checkRuleInputDeclarations(core: CoreFile): GateIssue[] {
  const inputNames = [
    ...new Set((core.inputs ?? []).map((input) => input.name).filter(Boolean) as string[]),
  ];
  if (!inputNames.length) return [];

  const declared = new Set<string>([...inputNames, ...core.fields.map((field) => field.name)]);
  const texts = [
    ...core.rules,
    ...(core.inputs ?? []).map((input) => `${input.name} ${input.desc ?? ''} ${input.note ?? ''} ${input.ref}`),
    ...core.fields.map((field) => `${field.name} ${field.desc}`),
    ...(core.constraints ?? []),
  ];

  // 可达键：声明根 ∪ 文件内以可达前缀出现的子路径 ∪ 这些子路径的末段简写
  // （简写别名支撑 `timeDimensions.deadlineDate` 这类省略父根的行文；有界迭代防抖）
  const reachable = new Set<string>(declared);
  for (let round = 0; round < 8; round += 1) {
    let changed = false;
    for (const text of texts) {
      for (const match of text.matchAll(RULE_KEY_DOTTED)) {
        const segments = match[0].split('.');
        for (let index = 1; index < segments.length; index += 1) {
          if (!reachable.has(segments.slice(0, index).join('.'))) continue;
          const child = segments.slice(0, index + 1).join('.');
          if (!reachable.has(child)) {
            reachable.add(child);
            changed = true;
          }
          if (!reachable.has(segments[index])) {
            reachable.add(segments[index]);
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }

  const docText = [
    ...(core.inputs ?? []).map((input) => `${input.desc ?? ''} ${input.note ?? ''} ${input.ref}`),
    ...core.fields.map((field) => field.desc),
  ].join('\n');
  const documented = (root: string) =>
    new RegExp(`(^|[^A-Za-z0-9_])${root}([^A-Za-z0-9_]|$)`).test(docText);

  const registered = new Set((RULE_KEY_SOURCES[core.skillId] ?? []).map((source) => source.key));

  const issues: GateIssue[] = [];
  const seen = new Set<string>();
  for (const rule of core.rules) {
    for (const match of rule.matchAll(RULE_KEY_DOTTED)) {
      const token = match[0];
      const root = token.split('.')[0];
      if (RULE_KEY_SELF_ROOTS.has(root) || RULE_KEY_CODE_PATH.test(token)) continue;
      if (reachable.has(token) || documented(root) || registered.has(root)) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      issues.push({
        code: 'rule-input-key-undeclared',
        message:
          `规则引用的键「${token}」在本文件 inputs/fields 声明层找不到根，也未登记来源 —— ` +
          `规则依赖的键在声明与文档上都看不见（#197 同类）；请补 inputs 声明，或在 ` +
          `RULE_KEY_SOURCES 登记其归属与证据`,
      });
    }
  }
  return issues;
}

export function checkConfigDrivenStageHandoffCoverage(
  stages: ReadonlyArray<StageRoutingDecl>,
): GateIssue[] {
  const issues: GateIssue[] = [];
  for (const extractor of listConfigDrivenStageHandoffs()) {
    const stage = stages.find((s) => s.stage === extractor.sourceStage);
    if (!stage) {
      issues.push({
        code: 'handoff-extractor-source-stage-missing',
        message:
          `抽取器 ${extractor.extractor} 登记的来源阶段「${extractor.sourceStage}」在编排文件中不存在，` +
          `声明边无法与其对账`,
      });
      continue;
    }
    const scope = new Set(extractor.sourceAgentIds());
    for (const row of stage.routings) {
      if (!(row.handoff || []).includes(extractor.targetStage)) continue;
      if (scope.has(getCanonicalAgentId(row.agentId))) continue;
      issues.push({
        code: 'declared-handoff-not-extractable',
        message:
          `${row.agentId}/${row.fieldId} 声明 handoff→${extractor.targetStage}，` +
          `但抽取器 ${extractor.extractor} 只读 [${[...scope].join('、')}]，该交接声明运行时不生效`,
      });
    }
  }
  return issues;
}
