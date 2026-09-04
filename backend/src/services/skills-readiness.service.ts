/**
 * W1-W5 技能 readiness 校验（SKILL_READINESS_SPEC §3）
 *
 * 全 warn 通道，不进 ReadinessResult.checks，不改变 ready 语义：
 * - readiness.service.ts check() 尾部 fire-and-forget 调用（60s 内存缓存，防 /readyz 轮询反复 fs 扫描）
 * - GET /api/admin/skills/readiness 按需重算（skipCache）
 *
 * 结构：analyzeSkillReadiness 纯函数（零 IO，可单测）+ runSkillReadinessChecks DB/fs 装配
 * （对标 check-core-hash-parity 的 analyze/check 双层模式）。
 *
 * 检查项：
 * - W1 ACTIVE 覆盖：户口簿活跃集 vs agent_prompts ACTIVE 双向差集；
 *   noPromptFile=true（handler-only）豁免方向 A；僵尸技能（basic-evaluator /
 *   goal-alignment-checker / course-design，保留注册但零生产调用，RETIRED_SKILLS_FIX_PLAN §4.3）
 *   的 ACTIVE 行视为"保留决策下的必需资产"（handler requireActivePrompt: true），
 *   不计入告警 items，仅保留 zombieSkillActive 数组供审计计数。
 * - W2 注册对账：户口簿活跃集 vs skill_registrations（name 无 skill: 前缀）双向差集；
 *   registrationPoint=agents（learner-model 落 agentHandlers 注册）与 platform-direct
 *   （semantic-freeze-judge 平台守门直调）豁免方向 A（不落 skill_registrations 是预期）。
 * - W3 接线双向：ORCHESTRATOR_RUNTIME_DEFINITIONS steps vs 户口簿 coordinator 块；
 *   方向 A steps 引用不在户口簿 / 方向 B 户口簿登记未进 definition steps；
 *   豁免：steps:[] 三例（W3_STEPS_EMPTY_EXEMPT，notes 注明 service 侧接线）、
 *   platform-direct、无 coordinator 块的 aux/handler-only（service 直调）。
 * - W4 core 漂移：复用 check-core-hash-parity 的 analyzeCoreHashParity/checkCoreHashParity
 *   （同一漂移口径，单一实现）；薄壳过滤：missing-active 归 W1、not-declared 跳过、
 *   不在户口簿活跃集的文件跳过（缺 ACTIVE 由 W1 管）。
 * - W5 dataSource：P4 未定 → TBD 占位（不执行任何数据源存在性断言）。
 */

import {
  loadSkillsBookRaw,
  getActiveSkillIds,
  type SkillsBook,
  type SkillEntry,
} from './skill-registry/skills-file';
import { ORCHESTRATOR_RUNTIME_DEFINITIONS } from '../coordinators/definitions-registry';
import {
  checkCoreHashParity,
  type CoreHashParityActiveRow,
  type CoreHashParityQueryAdapter,
  type CoreHashParityReport,
} from '../scripts/check-core-hash-parity';

/** 僵尸技能：保留注册但零生产调用（skills.yaml notes + RETIRED_SKILLS_FIX_PLAN §4.3）；
 * 其 ACTIVE prompt 为保留决策下的必需资产（handler requireActivePrompt: true），
 * 不计告警（zombieSkillActive 仅作审计计数保留）。 */
export const ZOMBIE_SKILL_IDS = ['basic-evaluator', 'goal-alignment-checker', 'course-design'] as const;

/** W3-B 免检清单：coordinator.steps=[] 条目（notes 注明 service 侧接线，不进主链 steps） */
export const W3_STEPS_EMPTY_EXEMPT: Record<string, string> = {
  'adaptive-guidance-copy': 'dashboard 侧调用（services/learner/DashboardGuidanceSnapshotService），不在 ai-teaching.definition.ts steps 内；contracts 有登记',
  'virtual-learner-persona-designer': '前置配置阶段（routes/admin/virtual-learners.ts），不在 simulation.definition.ts 主链 steps 内',
  'virtual-learner-scenario-designer': '前置配置阶段（同 persona-designer），不在主链 steps 内',
  'path-reviewer': 'service 侧调用（learning.service.ts 内联 CIDDP 评审），非 path.coordinator 编排，不在 path.definition.ts steps 内',
  'kc-mapper': 'service 侧调用（learning.service.ts KC 映射），非 path.coordinator 编排，不在 path.definition.ts steps 内',
  'learning-predictor': 'service 侧调用（ai-teaching/TeachingContextBuilder 任务前预测），非 profile.coordinator 编排',
  'virtual-learner-epistemic-grounding': 'teaching 回合内部辅助（blackbox-runner.ts / simulation.coordinator.ts 认知判决），在 learn-turn-simulator 前调用，不在 simulation.definition.ts 主链 steps 内',
};

export interface ReadinessWarningItem {
  code: 'W1' | 'W2' | 'W3' | 'W4';
  skillId?: string;
  message: string;
  hint?: string;
}

export interface W1Check {
  ok: boolean;
  activeCount: number;
  /** 户口簿登记（noPromptFile !== true）但无 ACTIVE prompt */
  missingActive: string[];
  /** agent_prompts ACTIVE 的 skill:<x> 不在户口簿活跃集（差集僵尸） */
  zombieActive: string[];
  /** 僵尸技能（保留注册零调用）的 ACTIVE 残留（任务指示单列） */
  zombieSkillActive: string[];
  items: ReadinessWarningItem[];
}

export interface W2Check {
  ok: boolean;
  bookCount: number;
  /** 户口簿有登记（非 agents/platform-direct 注册点）但 skill_registrations 无行 */
  missingRegistration: string[];
  /** skill_registrations 行不在户口簿活跃集（幽灵残留） */
  zombieRegistration: string[];
  items: ReadinessWarningItem[];
}

export interface W3Check {
  ok: boolean;
  /** coordinator 定义 steps 引用的 skill 不在户口簿活跃集 */
  stepWithoutBook: string[];
  /** 户口簿 coordinator.steps 非空但对应 definition steps 无该 skill（未接线） */
  bookWithoutStep: string[];
  /** 免检命中（steps:[] 等） */
  exempted: string[];
  items: ReadinessWarningItem[];
}

export interface W4Check {
  ok: boolean;
  /** 参与漂移对账的文件数（户口簿活跃集内且声明 coreHash） */
  scanned: number;
  /** drift / db-mismatch / core-file-missing / invalid-core-file */
  drifted: string[];
  items: ReadinessWarningItem[];
}

export interface W5Check {
  ok: true;
  note: 'TBD dataSource';
}

export interface SkillsReadinessChecks {
  W1: W1Check;
  W2: W2Check;
  W3: W3Check;
  W4: W4Check;
  W5: W5Check;
}

export interface SkillsReadinessReport {
  checks: SkillsReadinessChecks;
  generatedAt: string;
}

export interface SkillsReadinessQueryAdapter extends CoreHashParityQueryAdapter {
  skill_registrations: {
    findMany: (args?: {
      select?: { name: true; updatedAt?: true };
    }) => Promise<Array<{ name: string; updatedAt?: Date | string | null }>>;
  };
}

export interface AnalyzeSkillReadinessInput {
  book: SkillsBook;
  activeRows: CoreHashParityActiveRow[];
  registrations: Array<{ name: string }>;
  parityReport: CoreHashParityReport;
}

function skillIdOf(agentId: string): string {
  return String(agentId || '').replace(/^skill:/, '').trim();
}

function registrationPointOf(entry: SkillEntry): string {
  return entry.registrationPoint || 'skillHandlers';
}

export function analyzeW1(book: SkillsBook, activeRows: CoreHashParityActiveRow[]): W1Check {
  const activeIds = getActiveSkillIds(book);
  const activePromptIds = new Set(activeRows.map((row) => row.agentId));

  const missingActive = book.skills
    .filter((entry) => entry.noPromptFile !== true && !activePromptIds.has(`skill:${entry.skillId}`))
    .map((entry) => entry.skillId)
    .sort();

  const zombieActive = [...activePromptIds]
    .filter((agentId) => agentId.startsWith('skill:'))
    .map(skillIdOf)
    .filter((skillId) => skillId && !activeIds.has(skillId))
    .sort();

  const zombieSkillActive = book.skills
    .filter((entry) => (ZOMBIE_SKILL_IDS as readonly string[]).includes(entry.skillId) && activePromptIds.has(`skill:${entry.skillId}`))
    .map((entry) => entry.skillId)
    .sort();

  // 告警 items：仅缺 ACTIVE（missingActive）与幽灵 ACTIVE（zombieActive）。
  // zombieSkillActive 不进入 items——按 RETIRED_SKILLS_FIX_PLAN §4.3 决策，
  // 三个僵尸项正式保留注册（禁止退役名单），且其 handler requireActivePrompt: true
  // （v4-aux-skills/index.ts:115，admin 测试入口按需执行依赖 ACTIVE prompt），
  // 其 ACTIVE 行为必需资产而非"残留"，报警会把保留决策执行者引向错误清理。
  const items: ReadinessWarningItem[] = [
    ...missingActive.map((skillId) => ({
      code: 'W1' as const,
      skillId,
      message: '户口簿登记但缺"当前生效"的 prompt 版本（有文件未同步）',
      hint: '执行编译 + 同步（prompts:compile-all + prompts:sync）',
    })),
    ...zombieActive.map((skillId) => ({
      code: 'W1' as const,
      skillId,
      message: '数据库有"当前生效"版本但户口簿活跃集已无此技能（幽灵残留）',
      hint: '登记回户口簿或清理残留',
    })),
  ];

  return {
    ok: missingActive.length === 0 && zombieActive.length === 0,
    activeCount: activePromptIds.size,
    missingActive,
    zombieActive,
    zombieSkillActive,
    items,
  };
}

export function analyzeW2(book: SkillsBook, registrations: Array<{ name: string }>): W2Check {
  const activeIds = getActiveSkillIds(book);
  const registeredNames = new Set(registrations.map((row) => row.name.trim()).filter(Boolean));

  const missingRegistration = book.skills
    .filter((entry) => {
      const rp = registrationPointOf(entry);
      // agents（learner-model 落 agentHandlers）/ platform-direct（semantic-freeze-judge 守门直调）
      // 不落 skill_registrations 是预期行为，豁免方向 A
      if (rp === 'agents' || rp === 'platform-direct') return false;
      return !registeredNames.has(entry.skillId);
    })
    .map((entry) => entry.skillId)
    .sort();

  const zombieRegistration = [...registeredNames].filter((name) => !activeIds.has(name)).sort();

  const items: ReadinessWarningItem[] = [
    ...missingRegistration.map((skillId) => ({
      code: 'W2' as const,
      skillId,
      message: '户口簿登记但系统注册表无行（启动注册静默跳过）',
      hint: '注册片段未落 skills/index.ts：补充注册后重启',
    })),
    ...zombieRegistration.map((name) => ({
      code: 'W2' as const,
      skillId: name,
      message: '系统注册表行不在户口簿活跃集（幽灵残留，启动时会重载）',
      hint: '手工清理或纳入退役名单',
    })),
  ];

  return {
    ok: items.length === 0,
    bookCount: book.skills.length,
    missingRegistration,
    zombieRegistration,
    items,
  };
}

export interface W3DefinitionLike {
  id: string;
  steps?: Array<{ agentId?: unknown; [key: string]: unknown }>;
}

export function analyzeW3(
  book: SkillsBook,
  definitions: W3DefinitionLike[] = ORCHESTRATOR_RUNTIME_DEFINITIONS,
): W3Check {
  const activeIds = getActiveSkillIds(book);
  const stepWithoutBook: string[] = [];
  const bookWithoutStep: string[] = [];
  const exempted: string[] = [];

  // 方向 A：coordinator 定义 steps 引用的 skill:<x> 不在户口簿活跃集
  for (const definition of definitions) {
    for (const step of definition.steps || []) {
      const agentId = String((step as { agentId?: unknown }).agentId || '');
      if (!agentId.startsWith('skill:')) continue;
      const skillId = skillIdOf(agentId);
      if (!skillId || activeIds.has(skillId)) continue;
      stepWithoutBook.push(`${definition.id} → ${skillId}`);
    }
  }
  stepWithoutBook.sort();

  // 方向 B：户口簿 coordinator 登记未进对应 definition steps
  for (const entry of book.skills) {
    if (!entry.coordinator) continue; // 无 coordinator 块的 aux/handler-only（service 直调）豁免
    if (registrationPointOf(entry) === 'platform-direct') continue; // 平台守门直调豁免
    if (entry.coordinator.steps.length === 0) {
      // steps:[] 条目：service 侧接线免检（W3_STEPS_EMPTY_EXEMPT 硬编码清单，含 notes 引用）
      if (W3_STEPS_EMPTY_EXEMPT[entry.skillId]) exempted.push(entry.skillId);
      continue;
    }
    const definition = definitions.find(
      (item) => item.id === entry.coordinator!.agentId,
    );
    const wired = definition?.steps?.some(
      (step) => String((step as { agentId?: unknown }).agentId || '') === `skill:${entry.skillId}`,
    );
    if (!wired) bookWithoutStep.push(entry.skillId);
  }
  bookWithoutStep.sort();
  exempted.sort();

  const items: ReadinessWarningItem[] = [
    ...stepWithoutBook.map((target) => ({
      code: 'W3' as const,
      skillId: target.split(' → ')[1],
      message: `coordinator 定义 steps 引用 ${target} 不在户口簿活跃集`,
      hint: '登记回 skills.yaml 或移除 definition steps 引用',
    })),
    ...bookWithoutStep.map((skillId) => ({
      code: 'W3' as const,
      skillId,
      message: '户口簿 coordinator.steps 非空但对应 definition steps 无该 skill（未接线）',
      hint: '在 coordinator definition.ts 补 steps 或改 notes 说明 service 侧接线',
    })),
  ];

  return { ok: items.length === 0, stepWithoutBook, bookWithoutStep, exempted, items };
}

export function analyzeW4(book: SkillsBook, parityReport: CoreHashParityReport): W4Check {
  const activeIds = getActiveSkillIds(book);
  const warnStatuses = new Set(['drift', 'db-mismatch', 'core-file-missing', 'invalid-core-file']);

  const inScope = parityReport.results.filter((result) => {
    const skillId = skillIdOf(result.agentId);
    // 不在户口簿 → 归 W1（缺 ACTIVE 差集）；not-declared（v2 文件）不参与对账
    return skillId && activeIds.has(skillId) && result.status !== 'not-declared';
  });

  const drifted = [...new Set(
    inScope
      .filter((result) => warnStatuses.has(result.status))
      .map((result) => result.agentId),
  )].sort();

  const items: ReadinessWarningItem[] = drifted.map((agentId) => ({
    code: 'W4' as const,
    skillId: skillIdOf(agentId),
    message: '哈希漂移（W4）：核心文件与编译产物、DB ACTIVE 版本三方哈希不一致，文件改了但没"编译+同步"',
    hint: '回补 prompts/core/<id>.yaml 后重新编译核心文件并同步数据库（详见哈希漂移对账明细）',
  }));

  return { ok: items.length === 0, scanned: inScope.length, drifted, items };
}

export function analyzeSkillReadiness(input: AnalyzeSkillReadinessInput): SkillsReadinessReport {
  return {
    checks: {
      W1: analyzeW1(input.book, input.activeRows),
      W2: analyzeW2(input.book, input.registrations),
      W3: analyzeW3(input.book),
      W4: analyzeW4(input.book, input.parityReport),
      W5: { ok: true, note: 'TBD dataSource' },
    },
    generatedAt: new Date().toISOString(),
  };
}

/** DB/fs 装配：读户口簿 + 查 agent_prompts ACTIVE + 查 skill_registrations + 复用 core-hash-parity 全量对账 */
export async function runSkillReadinessChecks(
  systemDb: SkillsReadinessQueryAdapter,
): Promise<SkillsReadinessReport> {
  const book = loadSkillsBookRaw();
  const [activeRows, registrations, parityReport] = await Promise.all([
    systemDb.agent_prompts.findMany({
      where: { status: 'ACTIVE' },
      select: { agentId: true, metadata: true, coreHash: true, coreVersion: true },
    }),
    systemDb.skill_registrations.findMany({
      select: { name: true, updatedAt: true },
    }),
    checkCoreHashParity(systemDb),
  ]);
  return analyzeSkillReadiness({ book, activeRows, registrations, parityReport });
}

const CACHE_TTL_MS = 60_000;
let lastComputedAt = 0;
let cachedReport: SkillsReadinessReport | null = null;

/**
 * 服务接口：60s 内存缓存（防 /readyz 轮询反复 fs 扫描；W4 需 computeCoreHash，非零成本）。
 * skipCache=true 时总是重算（admin 端点按需正确性优先）。
 */
export async function checkSkillsReadiness(
  systemDb: SkillsReadinessQueryAdapter,
  options?: { skipCache?: boolean },
): Promise<SkillsReadinessReport> {
  const now = Date.now();
  if (!options?.skipCache && cachedReport && now - lastComputedAt < CACHE_TTL_MS) {
    return cachedReport;
  }
  const report = await runSkillReadinessChecks(systemDb);
  cachedReport = report;
  lastComputedAt = now;
  return report;
}

/** 清缓存（测试用） */
export function resetSkillsReadinessCache(): void {
  cachedReport = null;
  lastComputedAt = 0;
}
