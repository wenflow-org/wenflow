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
 * 4. 反向死声明（checkDeclaredInputDelivery）——#199 盲区 1
 *    第 1 条只查「交付了但没声明」；反方向「声明了、routing 也标注为自动链，但该 skill
 *    在装配路径上从不接收」此前无人核对。判据：某输入字段在自动链（reachability 缺省）
 *    上有产出 routing 行，但这些行没有一条 handoff 到该 skill 或其所属 agent（也非该 agent
 *    自己产出）⇒ 该输入声明是永不兑现的死边。
 *    ⇒ 抓「core 声明消费 X，编排的自动链却从没把 X 交给它」。
 *
 * 5. sandbox ref 语义（checkSandboxRefs）——#199 盲区 3
 *    第 3 条只处理 kind=skill 的 ref；`sandbox:` 前缀的 ref 此前只有运行期 DB 视图
 *    （agent-contract-view 的 getAgentRoutings）兜着，没有纯函数判据。判据：sandbox ref
 *    的 agent 必须是顶层 5 agent，键必须能解析到已登记的投影/快照键（routings 推导的
 *    通道/产出键 ∪ 静态登记键 SANDBOX_EXTRA_KEYS）。
 *    ⇒ 抓「引用了一个沙盘里根本不存在（或拼错）的投影/快照键」。
 *
 * 已知 debt（本轮不做，勿误以为已覆盖）：**盲区 2 —— manifest 登记了 agent/skill，
 * 但仓库里没有对应的真实装配代码**。静态判据只能看到「声明→声明」，看不到
 * 「声明→TS 代码」。要覆盖它必须引入代码符号索引（或运行期遥测），后者被 #199
 * 拍板否决（会引入数据依赖与自证回路）；前者属独立单元。
 *
 * 注意：第 1 条的「实参」取装配层的声明交付键（routing handoff）。这是仓库当前
 * 唯一的确定性装配来源；运行期遥测（agent_call_logs.input）只覆盖被调用 skill 的
 * 摘要键，且受 10 键截断，不适合作为 CI 判据，故不在此模块使用。
 */
import {
  getAgentManifest,
  getAgentOfSkill,
  getCanonicalAgentId,
  listTopLevelAgents,
} from '../agent-manifest.service';
import { SANDBOX_EXTRA_KEYS } from '../agent-contract-view';
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
    /** 可达性（#184）：缺省 = 主链自动触发；manual/external = 仅人工/外部入口。
     * 用于反向死声明判据（盲区 1）识别「声明为自动链但从不交付」的边。 */
    reachability?: string | null;
    notes?: string | null;
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

/**
 * 实参对账的反向判据（#199 盲区 1 反向死声明）。
 *
 * checkSkillInputArgs 只查「交付了但没声明」；本判据查反方向：**声明了、routing 也标注为
 * 自动链（reachability 缺省），但该 skill 在装配路径上从不接收**。即：某输入字段（仅 kind=skill，
 * 因为 skill→skill 的交接才由 routing handoff 承载；sandbox/user 由编排层直注，不在 handoff
 * 图上，盲目比对会误报，见下）在自动链上有产出 routing 行，却没有一条 handoff 到该 skill
 * 或其所属 agent ⇒ 该输入声明承诺了一个永不兑现的交接。
 *
 * 为什么只覆盖 kind=skill：
 *   对现网 31 个核心文件做全量扫描，若对所有声明的根做「无自动链 handoff 到该 skill」判定，
 *   adaptive-guidance-copy / learner-progress-report / kc-mapper / learning-predictor /
 *   path-reviewer 等的 sandbox 投影键（snapshot.*、normalizedInput、prerequisiteTree、
 *   learningState、taskContext…）会批量误报——它们由编排层直接注入 DB sandbox，根本不经过
 *   routing handoff。这些「声明但无 handoff」是真实的注入式交付，不是死边。sandbox 键的存在性
 *   由 checkSandboxRefs（盲区 3）负责核对，故此反向判据避开 sandbox，专治 skill→skill 的边。
 *
 * reachability 口径：缺省 = 主链自动触发；显式的 manual/external 是「声明为非自动入口」，
 * 不算自动链。只对「存在自动链产出行、却无一交付到本 skill/所属 agent」的情形报错；若该根
 * 的产出行全是 manual/external（不存在自动链产出），则不属于「自动链从不交付」口径，放行。
 */
export const SKILL_INPUT_DEAD_EDGE_EXEMPTIONS: Readonly<Record<string, readonly string[]>> = {};

/** 装配层把字段根交付给某 skill（canonical 名或所属 agent）的所有自动链 routing 行 */
function inboundAutoRows(
  stages: readonly ClosureStageLike[],
  skillId: string,
): { auto: ReadonlyArray<{ fieldId: string; stage: string }> } {
  const self = `skill:${skillId}`;
  const owner = getAgentOfSkill(self);
  const ownerId = owner ? getCanonicalAgentId(owner.id) : null;
  const targets = new Set([self, ownerId].filter(Boolean) as string[]);
  const auto: { fieldId: string; stage: string }[] = [];
  for (const stage of stages) {
    for (const routing of stage.routings) {
      if (routing.reachability) continue; // 显式 manual/external = 非自动链
      const handed = (routing.handoff ?? []).map((value) => getCanonicalAgentId(value));
      if (!handed.some((target) => targets.has(target))) continue;
      auto.push({ fieldId: routing.fieldId, stage: stage.stage });
    }
  }
  return { auto };
}

/** 字段根是否在自动链（reachability 缺省）上有产出行——用于反向死声明的口径闸门 */
function autoProducerRoots(stages: readonly ClosureStageLike[]): Set<string> {
  const roots = new Set<string>();
  for (const stage of stages) {
    for (const routing of stage.routings) {
      if (routing.reachability) continue; // 显式 manual/external = 非自动链
      roots.add(routing.fieldId.split('.')[0]);
    }
  }
  return roots;
}

export function checkDeclaredInputDelivery(
  stages: readonly ClosureStageLike[],
  cores: readonly ClosureCoreLike[],
): GateIssue[] {
  const issues: GateIssue[] = [];
  const autoRoots = autoProducerRoots(stages);
  for (const core of cores) {
    const exempt = new Set(SKILL_INPUT_DEAD_EDGE_EXEMPTIONS[core.skillId] ?? []);
    const { auto } = inboundAutoRows(stages, core.skillId);
    const inboundRootSet = new Set(auto.map((row) => row.fieldId.split('.')[0]));
    for (const input of core.inputs ?? []) {
      if (input.kind !== 'skill') continue; // 仅 skill→skill 交接受 handoff 图约束
      const root = input.fieldPath.split('.')[0];
      if (!root) continue;
      if (exempt.has(root)) continue;
      if (inboundRootSet.has(root)) continue; // 装配层确实交付了这个根，声明有效
      // 该根在自动链上有产出行、却无一 handoff 给本 skill/所属 agent ⇒ 死边
      if (!autoRoots.has(root)) continue; // 自动链上根本没有该根的产出行（或全是 manual/external），不算自动链死边
      issues.push({
        code: 'skill-input-dead-declaration',
        message:
          `skill:${core.skillId} 声明消费 skill:${input.skill}.${input.fieldPath}（根 ${root}），` +
          `但自动链里产出「${root}」的 routing 行从不 handoff 给该 skill 或其所属 agent —— ` +
          `声明了一个永不兑现的交接（盲区 1 反向死声明）；请修正 routing handoff、` +
          `core inputs ref，或在 SKILL_INPUT_DEAD_EDGE_EXEMPTIONS 登记豁免`,
      });
    }
  }
  return issues;
}

/**
 * sandbox 前缀 ref 语义（#199 盲区 3）：`sandbox:` ref 必须能解析到已登记的投影/快照键。
 *
 * 现有 checkInputHandoffs 里的 checkSandboxPath 依赖运行期 DB 视图（getAgentRoutings），
 * 不是纯函数判据；本判据用编排文件（File-as-Truth）直接推导沙盘键注册表：某顶层 agent 名下
 * 的路由产出键（含其成员 skill 的产出行）+ 静态登记键（agent-contract-view 的
 * SANDBOX_EXTRA_KEYS）。与 validateSandboxPath 同源，但落到确定性文件面，CI 无需 DB。
 *
 * agent 简名（goal/path/teaching/profile/simulation）与 canonical（`*-agent`）都被接受；键以
 * 段为单位精确比对，并允许父/子段关系（如 `snapshot` 命中已登记的 `snapshot.dynamicState`）。
 */
const SANDBOX_PROJECTION_SOURCE = 'agent-contract-view:SANDBOX_EXTRA_KEYS';

/** 顶层 5 agent 的 canonical id；其余（拼写错/非顶层）视为未注册。 */
function topLevelAgentIds(): Set<string> {
  return new Set(listTopLevelAgents().map((agent) => agent.id));
}

/** 把 sandbox 路径首段解析成 canonical agent id（接受简名与 canonical） */
function resolveSandboxAgent(rawAgent: string): string | null {
  const ids = topLevelAgentIds();
  if (ids.has(rawAgent)) return rawAgent;
  const withSuffix = `${rawAgent}-agent`;
  if (ids.has(withSuffix)) return withSuffix;
  return null;
}

/** 从编排文件推导每个 agent 名下可解析的沙盘键（产出键 + 静态补充键） */
export function buildSandboxKeyRegistry(
  stages: readonly ClosureStageLike[],
): Map<string, Set<string>> {
  const registry = new Map<string, Set<string>>();
  for (const agent of listTopLevelAgents()) {
    const agentId = agent.id;
    const members = new Set((agent.agentMembers ?? []).map((skill) => getCanonicalAgentId(skill)));
    const keys = new Set<string>((SANDBOX_EXTRA_KEYS[agentId] ?? []).slice());
    for (const stage of stages) {
      for (const routing of stage.routings) {
        const owner = getCanonicalAgentId(routing.agentId);
        const isOwner = owner === agentId;
        const isMember = members.has(owner);
        // 产出键：该 agent 自身或其成员 skill 的路由产出行
        if (isOwner || isMember) keys.add(routing.fieldId);
      }
    }
    registry.set(agentId, keys);
  }
  return registry;
}

/** 段安全的键归属比对：精确相等（与 validateSandboxPath 同源；沙盘键是扁平登记的投影/快照键） */
function sandboxKeyMatches(declared: string, registered: string): boolean {
  return declared === registered;
}

export function checkSandboxRefs(
  stages: readonly ClosureStageLike[],
  cores: readonly ClosureCoreLike[],
  registry: ReadonlyMap<string, ReadonlySet<string>> = buildSandboxKeyRegistry(stages),
): GateIssue[] {
  const issues: GateIssue[] = [];
  for (const core of cores) {
    for (const input of core.inputs ?? []) {
      if (input.kind !== 'sandbox') continue;
      const path = String(input.sandboxPath || String(input.ref ?? '').replace(/^sandbox:/, ''));
      const [rawAgent, ...rest] = path.split('.');
      const agentId = resolveSandboxAgent(rawAgent);
      if (!agentId) {
        issues.push({
          code: 'sandbox-ref-unregistered',
          message:
            `${core.skillId} 声明 sandbox ref 「${input.ref}」的 agent 段「${rawAgent}」` +
            `不在顶层 5 agent 中（应为 goal/path/teaching/profile/simulation 或 <stage>-agent）——` +
            `指向一个不存在的沙盘（盲区 3）`,
        });
        continue;
      }
      const key = rest.join('.');
      if (!key) {
        issues.push({
          code: 'sandbox-ref-unregistered',
          message:
            `${core.skillId} 声明 sandbox ref 「${input.ref}」缺少沙盘键——` +
            `投影/快照键不可为空（盲区 3）`,
        });
        continue;
      }
      const keys = registry.get(agentId);
      const hit = keys && [...keys].some((registered) => sandboxKeyMatches(key, registered));
      if (!hit) {
        issues.push({
          code: 'sandbox-ref-unregistered',
          message:
            `${core.skillId} 声明 sandbox ref 「${input.ref}」键「${key}」无法解析到 ` +
            `${agentId} 名下已登记的投影/快照键（盲区 3）；合法键见 ` +
            `${SANDBOX_PROJECTION_SOURCE}`,
        });
      }
    }
  }
  return issues;
}

/**
 * 三层（+ 两新增）判据合并入口（供 check-input-handoffs 门禁脚本一次跑完）
 */
export function checkContractClosure(input: {
  stages: readonly ClosureStageLike[];
  cores: readonly ClosureCoreLike[];
}): GateIssue[] {
  return [
    ...checkSkillInputArgs(input.stages, input.cores),
    ...checkHandoffConsumers(input.stages),
    ...checkProducerContracts(input.cores),
    ...checkDeclaredInputDelivery(input.stages, input.cores),
    ...checkSandboxRefs(input.stages, input.cores),
  ];
}
