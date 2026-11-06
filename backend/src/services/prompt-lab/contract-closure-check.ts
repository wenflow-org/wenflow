/**
 * 契约闭环对账（#199）：把门禁从**声明层自洽**推进到**声明 ↔ 装配 ↔ 产出**三方对账。
 *
 * 背景（#199 主题）：仓库既有门禁（check-input-handoffs / agent-contract-view /
 * payload-stability / field-routing-drift-probe）都只核对「声明是否指向已登记的名字」，
 * 不对账「装配层实际交付的键」与「产出方契约是否覆盖被消费的字段」。因此
 * 「声明≠载荷」「声明了 handoff 但无装配器」这类结构性缺陷可以长期绿灯。
 *
 * 本模块提供三层纯函数判据（不触库、不读盘，编排/核心文件由调用方注入）：
 *
 * 1. 实参对账（checkSkillInputArgs）
 *    装配层（orchestration routings 的 handoff）交付给某 skill 的字段根，必须出现在该
 *    skill 的 inputs 声明层（输入别名 name 或 ref 的来源根）；差异只能靠
 *    SKILL_INPUT_ARG_EXEMPTIONS 逐条登记豁免。
 *    ⇒ 抓「routing 声明交付 X，但 skill 的输入契约里根本没有 X」。
 *
 * 2. 消费者存在性（checkHandoffConsumers）
 *    每条 routing 声明的 handoff 目标必须能定位到消费者：manifest 里的 agent / skill，
 *    或该阶段的编排 agent（stage 名 → `<stage>-agent` 契约）。目标名字拼错、阶段无编排
 *    agent 都会失败。
 *    ⇒ 抓「声明了 handoff，但目标不是任何可定位的消费者」。
 *
 * 3. 产出-消费闭环（checkProducerContracts）
 *    kind=skill 的 input ref 指向的上游字段，必须在上游 core 的 fields 产出契约中声明。
 *    ⇒ 抓「被下游消费，但产出方契约里没有这个字段」。
 *
 * 注意：第 1 条的「实参」取装配层的声明交付键（routing handoff）。这是仓库当前
 * 唯一的确定性装配来源；运行期遥测（agent_call_logs.input）只覆盖被调用 skill 的
 * 摘要键，且受 10 键截断，不适合作为 CI 判据，故不在此模块使用。
 */
import { getAgentManifest, getCanonicalAgentId } from '../agent-manifest.service';
import type { GateIssue } from './core-compiler';

/** core 文件输入声明的对账所需子集 */
export interface ClosureInputLike {
  /** 原始 ref（形如 skill:X.F / sandbox:<agent>.<key> / user:<path>） */
  ref?: string;
  name?: string;
  kind: string;
  skill: string;
  fieldPath: string;
  sandboxPath: string;
  userPath: string;
}

/** 本判据只依赖 core 文件的对账所需字段（便于测试注入最小对象） */
export interface ClosureCoreLike {
  skillId: string;
  inputs?: ReadonlyArray<ClosureInputLike>;
  fields: ReadonlyArray<{ name: string }>;
}

/** 本判据只依赖编排文件的对账所需字段 */
export interface ClosureStageLike {
  stage: string;
  contracts?: ReadonlyArray<{ agentId: string }>;
  routings: ReadonlyArray<{
    agentId: string;
    fieldId: string;
    handoff?: readonly string[] | null;
  }>;
}

/**
 * 实参对账的豁免登记（#199 验收标准里的「或已登记为豁免」）。
 * 键 = skillId；值 = 允许不出现在 inputs 声明里的交付键根。
 * 新增一条 = 承认「装配层确实交付该键，但它是 skill 的隐式入口，不写进输入契约」，
 * 必须同时给出原因，否则对账会一直拦下它。
 */
export const SKILL_INPUT_ARG_EXEMPTIONS: Readonly<Record<string, readonly string[]>> = {};

/** 输入条目的来源根：skill 取上游字段根，sandbox 取 agent 之后的首段，user 取注入路径根 */
function inputSourceRoot(input: ClosureInputLike): string | null {
  if (input.kind === 'skill') return input.fieldPath.split('.')[0] || null;
  if (input.kind === 'sandbox') {
    const segments = input.sandboxPath.split('.');
    return (segments.length > 1 ? segments[1] : segments[0]) || null;
  }
  if (input.kind === 'user') return input.userPath.split('.')[0] || null;
  return null;
}

/** 某 skill 的输入契约可见键：输入别名 ∪ 每条 ref 的来源根 */
export function declaredInputKeys(core: ClosureCoreLike): Set<string> {
  const keys = new Set<string>();
  for (const input of core.inputs ?? []) {
    if (input.name) keys.add(input.name);
    const root = inputSourceRoot(input);
    if (root) keys.add(root);
  }
  return keys;
}

/** 装配层交付给某 skill 的字段根（routing 行 handoff 命中 skill:<skillId>） */
export function handedFieldRoots(stages: readonly ClosureStageLike[], skillId: string): string[] {
  const target = `skill:${skillId}`;
  const roots = new Set<string>();
  for (const stage of stages) {
    for (const routing of stage.routings) {
      if (!(routing.handoff ?? []).map((value) => getCanonicalAgentId(value)).includes(target)) continue;
      const root = routing.fieldId.split('.')[0];
      if (root) roots.add(root);
    }
  }
  return [...roots].sort();
}

/**
 * 实参对账（验收 1）：对每个 skill，`装配层交付键根 \ 输入声明键 ∪ 豁免 = ∅`。
 * 只核对「交付了但没声明」这一个方向：反方向（声明了但没交付）在编排里是常态
 * （同一输入可能由多个阶段/直接调用注入），不在本判据口径内。
 */
export function checkSkillInputArgs(
  stages: readonly ClosureStageLike[],
  cores: readonly ClosureCoreLike[],
): GateIssue[] {
  const issues: GateIssue[] = [];
  for (const core of cores) {
    const handed = handedFieldRoots(stages, core.skillId);
    if (!handed.length) continue;
    const declared = declaredInputKeys(core);
    const exempt = new Set(SKILL_INPUT_ARG_EXEMPTIONS[core.skillId] ?? []);
    const undeclared = handed.filter((root) => !declared.has(root) && !exempt.has(root));
    if (!undeclared.length) continue;
    issues.push({
      code: 'skill-input-undeclared-arg',
      message:
        `skill:${core.skillId} 装配层向其交付了 [${undeclared.join('、')}]，但该 skill 的 inputs ` +
        `声明层里找不到这些键（声明≠载荷）；请在 core 文件补 inputs 声明，或修正 routing handoff，` +
        `或在 SKILL_INPUT_ARG_EXEMPTIONS 登记豁免`,
    });
  }
  return issues;
}

/** 阶段名 → 该阶段的编排 agent（contracts 里的 `<stage>-agent`，兜底首个 `*-agent`） */
function stageOrchestrator(stage: ClosureStageLike): string | undefined {
  const contracts = (stage.contracts ?? []).map((item) => item.agentId).filter(Boolean);
  return contracts.find((id) => id === `${stage.stage}-agent`) || contracts.find((id) => id.endsWith('-agent'));
}

/**
 * 消费者存在性（验收 2）：每条 routing 的每个 handoff 目标都必须可定位。
 * - manifest 内 agent / skill：可定位；
 * - 阶段名且该阶段存在编排 agent：可定位（编排 agent 读阶段状态）；
 * - 其余（拼错的 agent/skill、无编排 agent 的阶段）：报 handoff-consumer-unresolvable。
 */
export function checkHandoffConsumers(stages: readonly ClosureStageLike[]): GateIssue[] {
  const issues: GateIssue[] = [];
  const stageById = new Map(stages.map((stage) => [stage.stage, stage]));
  for (const stage of stages) {
    for (const routing of stage.routings) {
      for (const target of routing.handoff ?? []) {
        const canonical = getCanonicalAgentId(target);
        if (getAgentManifest(canonical)) continue;
        const targetStage = stageById.get(target);
        if (targetStage && stageOrchestrator(targetStage)) continue;
        issues.push({
          code: 'handoff-consumer-unresolvable',
          message:
            `${stage.stage}: ${routing.agentId}/${routing.fieldId} 声明 handoff→${target}，` +
            `但该目标不是 manifest 里的 agent/skill，也不是存在编排 agent 的阶段 —— 声明了交接却没有可定位的消费者/装配器`,
        });
      }
    }
  }
  return issues;
}

/**
 * 产出-消费闭环（验收 3）：kind=skill 的 input ref 指向的上游字段，必须在上游 core 的
 * fields 产出契约中声明；上游 core 不存在同样报错（消费方在等一个没有产出契约的字段）。
 */
export function checkProducerContracts(cores: readonly ClosureCoreLike[]): GateIssue[] {
  const issues: GateIssue[] = [];
  const byId = new Map(cores.map((core) => [core.skillId, core]));
  for (const core of cores) {
    for (const input of core.inputs ?? []) {
      if (input.kind !== 'skill') continue;
      const upstream = byId.get(input.skill);
      if (!upstream) {
        issues.push({
          code: 'input-producer-core-missing',
          message:
            `skill:${core.skillId} 声明消费 skill:${input.skill}.${input.fieldPath}，但仓库里没有 ` +
            `${input.skill} 的 core 产出契约 —— 被消费的字段无产出方契约`,
        });
        continue;
      }
      const root = input.fieldPath.split('.')[0];
      if (upstream.fields.some((field) => field.name === root)) continue;
      issues.push({
        code: 'input-producer-field-undeclared',
        message:
          `skill:${core.skillId} 声明消费 skill:${input.skill}.${input.fieldPath}，但 ${input.skill} 的 ` +
          `fields 产出契约里没有 ${root} —— 被消费的字段无产出契约`,
      });
    }
  }
  return issues;
}

/** 三层判据合并入口（供 check-input-handoffs 门禁脚本一次跑完） */
export function checkContractClosure(input: {
  stages: readonly ClosureStageLike[];
  cores: readonly ClosureCoreLike[];
}): GateIssue[] {
  return [
    ...checkSkillInputArgs(input.stages, input.cores),
    ...checkHandoffConsumers(input.stages),
    ...checkProducerContracts(input.cores),
  ];
}
