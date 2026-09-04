/**
 * fields-synced 判定：core.yaml 平铺字段 ↔ 编排文件嵌套 fieldId 的首段前缀一致性
 *
 * 一份逻辑两份消费（SKILL_READINESS_SPEC §2）：
 * - 门禁：`npm run prompts:fields-sync:check`（已并入 prompts:check:all 链）
 * - 状态机：fields-synced 档复用 analyzeCoreFieldsSync 纯函数（缺项红、孤儿/类型不阻断）
 *
 * 比较规则（§2.3）：
 * - 只扫编排文件 `agentId === 'skill:<id>'` 的产出行（stage-agent/编排层 agent 的行天然不在范围）
 * - root = fieldId 首段；root ∈ core fields ∪ 豁免清单 → 命中；否则缺项（error 级）
 * - core 字段未出现在任何产出行 root → 孤儿（warn，不阻断）
 * - 仅无点分字段（顶层直配，fieldId === root 精确命中 core name）做 valueType 类型比对：
 *   core type（去 '?' 归一）经 coreTypeToValueType 映射 vs 编排 valueType；不一致即 mismatch
 *   （嵌套 fieldId 与 core object 子字段无一对一类型关系，跳过）
 * - 参与范围仅 mainline；aux/handler-only 豁免（不进字段路由，skills.yaml:254 注释）
 *
 * 豁免清单（EXEMPT_PLATFORM_ROOTS）为 2026-08-10 --report 全量扫描复核后的定稿
 * （目标零 error 零误报），每条含证据与 core 侧等价字段名（孤儿判定过滤用）：
 * - userVisible（goal.yaml:145 对话可见文本，执行信封注入）承载 core `reply`
 * - core（goal.yaml:161-176 平台状态机包装）承载 core `state`
 * - goalConversation（goal.yaml:150-155 旧包装形态）承载 core `nextQuestions`/`quickReplies`
 * - debug（simulation.yaml:54 调试旁路字段）
 * - control（teaching.yaml:60-72 控制信号；兜底条目，实测 teaching-turn core 已覆盖）
 * - path（path.yaml:313-336 core 顶层字段 name/summary/totalMilestones 的编排包装根，
 *   path.id 为平台补 id）
 *
 * 存量孤儿（warn，真实漂移保留报）：
 * - path-planning：estimatedHours / estimatedWeeks / cognitiveDesign（兼容镜像字段未路由）
 * - virtual-learner-scenario-designer：personaSeed / story（core 输出未路由，仅 consistencyNotes 进路由）
 *
 * 2026-08-25 定稿：上述 5 条经逐项证据复核（见 ORPHAN_EXEMPT_FIELDS），均确认
 * "由路由子字段 / 后续阶段 / 退役语义承载"，移入豁免清单不再报孤儿——保留登记而非删除
 * core 声明（删除会对 core 哈希与编译产物产生连锁漂移）。
 *
 * 用法：
 *   ts-node src/scripts/check-core-fields-sync.ts            # --report 全量人审（默认）
 *   ts-node src/scripts/check-core-fields-sync.ts --strict    # 同 exit 规则（缺项/类型不一致 > 0 → 1）
 * 退出码：缺项 > 0 或类型不一致 > 0 为 1；孤儿仅 warn 为 0。
 */

import { loadOrchestrationFiles, type OrchestrationStage } from '../services/field-routing/orchestration-file';
import {
  loadSkillsBookRaw,
  type SkillEntry,
} from '../services/skill-registry/skills-file';
import { loadCoreFile, type CoreFile } from '../services/prompt-lab/core-file-loader';
import { coreTypeToValueType } from '../services/yaml-vocabulary';

export interface ExemptRootSpec {
  root: string;
  /** 平台/控制类（core 侧无同名顶层字段）或 core 顶层字段的编排包装根 */
  kind: 'platform' | 'wrapper';
  /** 该 root 在 core 侧承载的等价顶层字段名（孤儿判定过滤；core 有同名顶层字段时可含自身） */
  coreAliases: string[];
  evidence: string;
  note: string;
}

/** 豁免清单定稿（2026-08-10 --report 全量扫描复核，零 error 零误报） */
export const EXEMPT_PLATFORM_ROOTS: ExemptRootSpec[] = [
  {
    root: 'userVisible',
    kind: 'platform',
    coreAliases: ['reply'],
    evidence: 'goal.yaml:145',
    note: '对话可见文本，执行信封注入，非 LLM 字段；core reply（本轮回复文本）运行时承载于 userVisible',
  },
  {
    root: 'core',
    kind: 'platform',
    coreAliases: ['state'],
    evidence: 'goal.yaml:161-176',
    note: '平台状态机包装字段（core.conversationId/stage/confidence/isCompleted）；core state（回合状态）为同一语义',
  },
  {
    root: 'goalConversation',
    kind: 'platform',
    coreAliases: ['nextQuestions', 'quickReplies'],
    evidence: 'goal.yaml:150-155',
    note: 'nextQuestions/quickReplies 旧包装形态（core 顶层字段被 goalConversation.* 包装）',
  },
  {
    root: 'debug',
    kind: 'platform',
    coreAliases: ['debug'],
    evidence: 'simulation.yaml:54',
    note: '调试旁路字段（internal 仅调试）；simulator 系 core 已声明同名 debug 字段，此条兜底',
  },
  {
    root: 'control',
    kind: 'platform',
    coreAliases: ['control'],
    evidence: 'teaching.yaml:60-72',
    note: '控制信号字段（isCompletionCandidate/shouldTriggerPeer/checkpoint…）；teaching-turn core 已覆盖，兜底保留',
  },
  {
    root: 'path',
    kind: 'wrapper',
    coreAliases: ['name', 'summary', 'totalMilestones'],
    evidence: 'path.yaml:313-336',
    note: 'core 顶层字段（name/summary/totalMilestones）的编排包装根（path.id 为平台补 id）',
  },
];

export const EXEMPT_ROOT_NAMES: ReadonlySet<string> = new Set(EXEMPT_PLATFORM_ROOTS.map((spec) => spec.root));

/** 孤儿判定过滤：exempt root 的 core 侧等价字段名 → 其承载 root（反向映射） */
export const CORE_ALIAS_TO_EXEMPT_ROOT: ReadonlyMap<string, string> = new Map(
  EXEMPT_PLATFORM_ROOTS.flatMap((spec) => spec.coreAliases.map((alias) => [alias, spec.root] as const)),
);

/**
 * 孤儿豁免清单（2026-08-25 定稿）：core 顶层字段、且确认无需独立路由的条目。
 * 豁免原则（与 EXEMPT_PLATFORM_ROOTS 同步维护，每条含证据）：
 * - 顶层声明为兼容镜像，正式数据由路由子字段承载（estimatedHours → milestones.estimatedHours）
 * - 顶层声明为冗余镜像，正式数据走另一路由根（cognitiveDesign = cognitiveCore）
 * - 输出经 handoff 由其他 agent 承接，本 skill 无需路由（personaSeed）
 * - 语义已退役，由下游池承接（story → profileData.storyPool）
 * 保留登记而非删除 core 声明：删除会对 core 哈希 / 编译产物 / DB ACTIVE 产生连锁漂移。
 */
export const ORPHAN_EXEMPT_FIELDS: ReadonlyArray<{ skillId: string; field: string; evidence: string }> = [
  {
    skillId: 'path-planning',
    field: 'estimatedHours',
    evidence: 'path.yaml:377 routing milestones.estimatedHours（顶层为兼容镜像，实际数据以子字段路由交付）',
  },
  {
    skillId: 'path-planning',
    field: 'estimatedWeeks',
    evidence: '顶层冗余声明：周数承载于 milestones 计划与 normalizedInput.planningHints（无独立路由需求）',
  },
  {
    skillId: 'path-planning',
    field: 'cognitiveDesign',
    evidence: 'prompts/core/path-planning.yaml:106 自注"兼容镜像 = cognitiveCore"；正式数据走 cognitiveCore.* 路由（path.yaml:341-351）',
  },
  {
    skillId: 'virtual-learner-scenario-designer',
    field: 'personaSeed',
    evidence: 'simulation.yaml:102 personas:Seed 路由属 persona-designer；scenario-designer 输出经 handoff [simulation-agent] 承接',
  },
  {
    skillId: 'virtual-learner-scenario-designer',
    field: 'story',
    evidence: 'simulation.yaml:35 stories 字段已退役（语义由 profileData.storyPool 承接），core 仍要求输出的故事切片不进数据面路由',
  },
  {
    skillId: 'goal-conversation',
    field: 'proposalQuality',
    evidence: '顶层内部自评（confirmedProposal 的 SMART 分维度），仅驱动 reply 改善提示，不进数据面路由；goal.yaml:125 只路由 confirmedProposal.* 子字段',
  },
];

/** skillId → 已豁免字段名集合（孤儿判定过滤用） */
export const ORPHAN_EXEMPT_BY_SKILL: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  (() => {
    const map = new Map<string, Set<string>>();
    for (const spec of ORPHAN_EXEMPT_FIELDS) {
      const set = map.get(spec.skillId) ?? new Set<string>();
      set.add(spec.field);
      map.set(spec.skillId, set);
    }
    return map;
  })(),
);

export interface FieldsSyncMissingItem {
  fieldId: string;
  root: string;
  detail: string;
}

export interface FieldsSyncOrphanItem {
  coreField: string;
  detail: string;
}

export interface FieldsSyncTypeMismatchItem {
  fieldId: string;
  coreType: string;
  routingValueType: string;
  expectedValueType: string;
}

export interface CoreFieldsSyncSkillReport {
  skillId: string;
  stage: string;
  state: 'ok' | 'missing' | 'no-routings' | 'no-core';
  /** 编排字段首段不在 core fields 且不在豁免清单（error 级，阻断 fields-synced） */
  missing: FieldsSyncMissingItem[];
  /** core 字段未出现在任何产出路由行首段（warn，不阻断） */
  orphan: FieldsSyncOrphanItem[];
  /** 顶层直配字段的 core type ↔ 编排 valueType 不一致（warn，不阻断） */
  typeMismatch: FieldsSyncTypeMismatchItem[];
}

export type CoreFieldsSyncCoreLoader = (skillId: string) => { core: CoreFile | null } | null;

/**
 * 纯函数：对全部 mainline skill 做 core fields ↔ 编排产出行 前缀一致性分析。
 * 零 IO（core 内容经 loadCore 注入；编排 stages 作为输入传入）。
 */
export function analyzeCoreFieldsSync(
  stages: OrchestrationStage[],
  skills: SkillEntry[],
  loadCore: CoreFieldsSyncCoreLoader = (skillId) => loadCoreFile(skillId),
): CoreFieldsSyncSkillReport[] {
  const stageMap = new Map(stages.map((stage) => [stage.stage, stage]));
  const reports: CoreFieldsSyncSkillReport[] = [];

  for (const entry of skills) {
    // 仅 mainline：aux/handler-only 豁免（不进字段路由，skills.yaml:254 注释）
    if (entry.kind !== 'mainline' || entry.stage === undefined) continue;

    const stage = stageMap.get(entry.stage);
    if (!stage) continue; // F3 已保证 mainline 的 stage ∈ 编排 stage 清单

    const loaded = loadCore(entry.skillId);
    const core = loaded?.core ?? null;
    const routingRows = stage.routings.filter((routing) => routing.agentId === `skill:${entry.skillId}`);

    if (core === null) {
      reports.push({
        skillId: entry.skillId,
        stage: entry.stage,
        state: 'no-core',
        missing: [],
        orphan: [],
        typeMismatch: [],
      });
      continue;
    }
    if (routingRows.length === 0) {
      reports.push({
        skillId: entry.skillId,
        stage: entry.stage,
        state: 'no-routings',
        missing: [],
        orphan: [],
        typeMismatch: [],
      });
      continue;
    }

    const coreFieldNames = new Set(core.fields.map((field) => field.name));
    const coreFieldTypes = new Map(core.fields.map((field) => [field.name, field.type]));

    // 缺项（error）：编排 root ∉ core fields ∪ 豁免清单
    const missing: FieldsSyncMissingItem[] = [];
    // 顶层直配类型比对（warn）：fieldId 无点分且精确命中 core name
    const typeMismatch: FieldsSyncTypeMismatchItem[] = [];
    const seenRoots = new Set<string>();

    for (const routing of routingRows) {
      const root = routing.fieldId.split('.')[0];
      seenRoots.add(root);
      if (coreFieldNames.has(root) || EXEMPT_ROOT_NAMES.has(root)) continue;
      missing.push({
        fieldId: routing.fieldId,
        root,
        detail: `编排字段首段 "${root}" 不在 core fields，且不在豁免清单（EXEMPT_PLATFORM_ROOTS）`,
      });
    }

    // 类型比对（仅无点分直配字段；嵌套 fieldId 与 core object 子字段无一对一类型关系，跳过）
    // valueType 声明在编排 fields 段（OrchestrationField），routing 行只有 fieldId 引用
    const routedFieldIds = new Set(routingRows.map((routing) => routing.fieldId));
    for (const field of stage.fields) {
      const { fieldId, valueType } = field;
      if (fieldId.includes('.')) continue;
      if (!routedFieldIds.has(fieldId)) continue;
      const coreType = coreFieldTypes.get(fieldId);
      if (coreType === undefined) continue;
      const expectedValueType = coreTypeToValueType(coreType);
      if (expectedValueType === undefined) continue; // enum 与未知类型：core-only，无编排侧拼写
      if (valueType !== expectedValueType) {
        typeMismatch.push({
          fieldId,
          coreType,
          routingValueType: valueType,
          expectedValueType,
        });
      }
    }

    // 孤儿（warn）：core 字段未出现在任何产出 root，且未被豁免 root 的 core 侧等价名承载
    const orphan: FieldsSyncOrphanItem[] = [];
    const orphanExempt = ORPHAN_EXEMPT_BY_SKILL.get(entry.skillId) ?? new Set<string>();
    for (const field of core.fields) {
      if (seenRoots.has(field.name)) continue;
      if (CORE_ALIAS_TO_EXEMPT_ROOT.has(field.name)) continue;
      if (orphanExempt.has(field.name)) continue; // 豁免台账（ORPHAN_EXEMPT_FIELDS，2026-08-25 定稿）
      orphan.push({
        coreField: field.name,
        detail: `core 字段未出现在任何产出路由行首段；如需豁免请在平台保留根列表中登记（含别名）或补编排路由`,
      });
    }

    reports.push({
      skillId: entry.skillId,
      stage: entry.stage,
      state: missing.length > 0 ? 'missing' : 'ok',
      missing,
      orphan,
      typeMismatch,
    });
  }

  return reports;
}

function formatReport(reports: CoreFieldsSyncSkillReport[]): { lines: string[]; exitCode: number } {
  const lines: string[] = [];
  let missingCount = 0;
  let typeMismatchCount = 0;
  let orphanCount = 0;

  for (const report of reports) {
    missingCount += report.missing.length;
    typeMismatchCount += report.typeMismatch.length;
    orphanCount += report.orphan.length;
    lines.push(`\n[fields-sync] ${report.skillId}（stage=${report.stage}，state=${report.state}）`);
    if (report.missing.length === 0 && report.orphan.length === 0 && report.typeMismatch.length === 0) {
      lines.push('  OK：全部产出字段与 core fields 一致');
      continue;
    }
    for (const item of report.missing) {
      lines.push(`  [error] 缺项 ${item.fieldId}：${item.detail}`);
    }
    for (const item of report.orphan) {
      lines.push(`  [warn]  孤儿 ${item.coreField}：${item.detail}`);
    }
    for (const item of report.typeMismatch) {
      lines.push(
        `  [warn]  类型不一致 ${item.fieldId}：core=${item.coreType} → 期望 ${item.expectedValueType}，编排=${item.routingValueType}`,
      );
    }
  }

  lines.push(
    `\n[fields-sync] 汇总：扫描 ${reports.length} 个 mainline skill，缺项 ${missingCount} / 孤儿 ${orphanCount} / 类型不一致 ${typeMismatchCount}`,
  );
  return {
    lines,
    exitCode: missingCount > 0 || typeMismatchCount > 0 ? 1 : 0,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const mode = args.includes('--strict') ? 'strict' : 'report';

  const book = loadSkillsBookRaw();
  const stages = loadOrchestrationFiles();
  const reports = analyzeCoreFieldsSync(stages, book.skills, (skillId) => loadCoreFile(skillId));

  const { lines, exitCode } = formatReport(reports);
  for (const line of lines) console.log(line);
  console.log(
    `[fields-sync] 模式=${mode}；退出码=${exitCode}（缺项/类型不一致>0 为 1，孤儿仅 warn 为 0）`,
  );
  process.exitCode = exitCode;
}

if (require.main === module) {
  main();
}
