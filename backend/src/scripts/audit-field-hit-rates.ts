/**
 * 字段级运行时命中率审计（**只读**：不写库、不迁移、不调 LLM）—— Q9 后半程
 *
 * 回答：每个 skill 在 `prompts/core/<skillId>.yaml` 声明的字段，哪些真的在运行时被产出、
 * 哪些是死字段、哪些是契约漂移；以及 `prompts/orchestration/*.yaml` routing 里声明、
 * 但对应字段从未被产出的边（死边候选）。
 *
 * 数据列（核对 prisma/schema.prisma:87 `model prompt_call_logs`）：
 *   - agentId      技能调用形如 `skill:<skillId>`（编排 agent / 网关行会被跳过）
 *   - extractedJson 解析后的结构化输出；**顶层键即该次调用的产出字段**（校验/归一化前）
 *   - createdAt    时间窗口
 *   写入点：backend/src/composers/prompt-composer.ts:548（成功）、:594（失败）
 *
 * 声明源（只读）：
 *   - 字段：`prompts/core/<skillId>.yaml` → `fields[].name`（core-file-loader）
 *   - routing：`prompts/orchestration/*.yaml` → routings（orchestration-file）
 *
 * ⚠ CAVEAT（结果解读前必读）：
 *   1) 媒体产物：`outputMedia: markdown/text` 时 extractedJson 复用为原始文本，
 *      无法解析为对象 → 该 skill 全部字段会计为"未产出"，命中率不可采信；
 *   2) `deltaOutput: true`：只输出变化字段，命中率系统性偏低（字段并非不存在）；
 *   3) 校验归一化：extractedJson 是 `coerceParsedForContract` / `normalizeOutput` 之前的
 *      原始解析，重命名/补齐（acceptanceHint→acceptanceCriteria、cognitiveDesign 等）
 *      会让死字段/漂移成为误报；
 *   4) 包装根：routing 的包装根（path/userVisible/core/goalConversation/debug/control）
 *      按平台豁免根处理，不计入死边；
 *   5) 分母：命中率 = 出现该键的调用 / 该 skill 全部调用（含失败行与解析失败行）。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/audit-field-hit-rates.ts [--days=30] [--skill=<id>] [--stage=<name>] [--limit=200000] [--json]
 */
import 'dotenv/config';
import prisma from '../config/database';
import { loadCoreFile, scanCoreFiles, type CoreOutputMedia } from '../services/prompt-lab/core-file-loader';
import {
  loadOrchestrationFiles,
  type OrchestrationStage,
} from '../services/field-routing/orchestration-file';
import { EXEMPT_ROOT_NAMES } from './check-core-fields-sync';
import {
  aggregateFieldHitRates,
  skillIdFromAgentId,
  type FieldHitRateEntry,
  type FieldHitLogRow,
  type SkillFieldHitRates,
} from '../services/topology/field-hit-rates';

const DAY_MS = 24 * 60 * 60 * 1000;

interface Args {
  days: number;
  limit: number;
  top: number;
  skill: string | null;
  stage: string | null;
  json: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { days: 30, limit: 200000, top: 50, skill: null, stage: null, json: false };
  for (const raw of argv) {
    const [key, value] = raw.split('=');
    if (key === '--days' && value) args.days = Math.max(1, Number(value) || 30);
    if (key === '--limit' && value) args.limit = Math.max(1, Number(value) || 200000);
    if (key === '--top' && value) args.top = Math.max(1, Number(value) || 50);
    if (key === '--skill' && value) args.skill = value.replace(/^skill:/, '').trim() || null;
    if (key === '--stage' && value) args.stage = value.trim() || null;
    if (raw === '--json') args.json = true;
  }
  return args;
}

interface CoreMeta {
  deltaOutput: boolean;
  outputMedia: CoreOutputMedia;
  fieldNames: string[];
}

interface DeclaredCore {
  declaredFieldsBySkill: Record<string, string[]>;
  meta: Map<string, CoreMeta>;
  missingCore: string[];
}

/** 读盘加载声明字段（只读）。skillIds=null 时扫描全部 core 文件 */
function loadDeclaredCore(skillIds: string[] | null): DeclaredCore {
  const declaredFieldsBySkill: Record<string, string[]> = {};
  const meta = new Map<string, CoreMeta>();

  if (skillIds === null) {
    const { files } = scanCoreFiles();
    for (const core of files) {
      const names = core.fields.map((field) => field.name);
      declaredFieldsBySkill[core.skillId] = names;
      meta.set(core.skillId, { deltaOutput: core.deltaOutput, outputMedia: core.outputMedia, fieldNames: names });
    }
    return { declaredFieldsBySkill, meta, missingCore: [] };
  }

  const missingCore: string[] = [];
  for (const skillId of skillIds) {
    const loaded = loadCoreFile(skillId);
    if (!loaded || !loaded.core) {
      missingCore.push(skillId);
      declaredFieldsBySkill[skillId] = [];
      continue;
    }
    const names = loaded.core.fields.map((field) => field.name);
    declaredFieldsBySkill[skillId] = names;
    meta.set(skillId, {
      deltaOutput: loaded.core.deltaOutput,
      outputMedia: loaded.core.outputMedia,
      fieldNames: names,
    });
  }
  return { declaredFieldsBySkill, meta, missingCore };
}

/** 从编排 stage 契约/路由收集 skillId（可选按 stage 过滤） */
function collectSkillIdsFromStages(stages: OrchestrationStage[], stageName: string | null): string[] {
  const ids = new Set<string>();
  for (const stage of stages) {
    if (stageName && stage.stage !== stageName) continue;
    for (const contract of stage.contracts) {
      const skillId = skillIdFromAgentId(contract.agentId);
      if (skillId) ids.add(skillId);
    }
    for (const routing of stage.routings) {
      const skillId = skillIdFromAgentId(routing.agentId);
      if (skillId) ids.add(skillId);
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

interface RoutingRowForAudit {
  skillId: string;
  fieldId: string;
  root: string;
  handoff: string[];
  stage: string;
}

type DeadEdgeReason = 'declared-field-zero-hits' | 'routing-root-not-observed';

interface DeadRoutingEdge {
  skillId: string;
  agentId: string;
  fieldId: string;
  root: string;
  handoff: string[];
  stage: string;
  reason: DeadEdgeReason;
}

/** 收集 `skill:*` 的 routing 行（只读，来自编排 YAML） */
function buildRoutingIndex(stages: OrchestrationStage[]): Map<string, RoutingRowForAudit[]> {
  const index = new Map<string, RoutingRowForAudit[]>();
  for (const stage of stages) {
    for (const routing of stage.routings) {
      const skillId = skillIdFromAgentId(routing.agentId);
      if (!skillId) continue;
      const root = routing.fieldId.split('.')[0].replace(/\[\]$/, '');
      const list = index.get(skillId) ?? [];
      list.push({
        skillId,
        fieldId: routing.fieldId,
        root,
        handoff: [...routing.handoff],
        stage: stage.stage,
      });
      index.set(skillId, list);
    }
  }
  return index;
}

/**
 * 死边候选判定（启发式，需结合 caveat 解读）：
 * - root 出现在观测产出键中 → 存活
 * - root 是 core 声明字段但零命中 → 死字段驱动的死边（declared-field-zero-hits）
 * - root 是平台/包装豁免根（path/userVisible/core/goalConversation/debug/control）→ 跳过
 * - 其余 → routing 引用了该 skill 从未产出的根（routing-root-not-observed）
 */
function findDeadRoutingEdges(skill: SkillFieldHitRates, routings: RoutingRowForAudit[]): DeadRoutingEdge[] {
  const producedRoots = new Set(skill.fields.filter((entry) => entry.hits > 0).map((entry) => entry.field));
  const declaredFields = new Set(skill.declaredFields);
  const edges: DeadRoutingEdge[] = [];
  for (const routing of routings) {
    if (producedRoots.has(routing.root)) continue;
    let reason: DeadEdgeReason | null = null;
    if (declaredFields.has(routing.root)) reason = 'declared-field-zero-hits';
    else if (!EXEMPT_ROOT_NAMES.has(routing.root)) reason = 'routing-root-not-observed';
    if (!reason) continue;
    edges.push({
      skillId: skill.skillId,
      agentId: skill.agentId,
      fieldId: routing.fieldId,
      root: routing.root,
      handoff: routing.handoff,
      stage: routing.stage,
      reason,
    });
  }
  return edges.sort((a, b) => a.fieldId.localeCompare(b.fieldId) || a.stage.localeCompare(b.stage));
}

const CAVEATS: string[] = [
  '媒体产物：outputMedia ∈ {markdown,text} 的 skill，extractedJson 存原始文本，无法解析为对象 → 全部字段会计为"未产出"，命中率不可采信。',
  'deltaOutput: true：只输出变化字段，命中率系统性偏低（字段并非不存在）。',
  '校验归一化：extractedJson 为校验/归一化前的原始解析；coerce/normalize 可能重命名或补齐（acceptanceHint→acceptanceCriteria、cognitiveDesign 等）→ 死字段/漂移可能是误报。',
  '包装根：routing 的包装根（path/userVisible/core/goalConversation/debug/control）按平台豁免根处理，不计入死边。',
  '分母口径：命中率 = 出现该键的调用 / 该 skill 全部调用（含失败行与解析失败行）；小样本波动大。',
];

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function fmtEntry(entry: FieldHitRateEntry, totalCalls: number): string {
  return `${entry.field.padEnd(28)} 命中 ${String(entry.hits).padStart(6)}/${String(totalCalls).padEnd(6)} = ${fmtPct(entry.hitRate).padStart(7)}`;
}

function buildJsonOutput(
  args: Args,
  since: Date,
  stages: OrchestrationStage[],
  declared: DeclaredCore,
  rows: ReadonlyArray<{ agentId: string; createdAt: Date; success: boolean }>,
  aggregation: ReturnType<typeof aggregateFieldHitRates>,
  deadRoutingEdges: DeadRoutingEdge[],
): unknown {
  const nonJsonMediaSkills = [...declared.meta.entries()]
    .filter(([, meta]) => meta.outputMedia !== 'json')
    .map(([skillId]) => skillId)
    .sort((a, b) => a.localeCompare(b));
  const deltaOutputSkills = [...declared.meta.entries()]
    .filter(([, meta]) => meta.deltaOutput)
    .map(([skillId]) => skillId)
    .sort((a, b) => a.localeCompare(b));

  const skills = aggregation.skills.map((skill) => ({
    ...skill,
    deadRoutingEdges: deadRoutingEdges.filter((edge) => edge.skillId === skill.skillId),
  }));

  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    window: { days: args.days, since: since.toISOString() },
    scope: { skill: args.skill, stage: args.stage, skills: Object.keys(declared.declaredFieldsBySkill).sort((a, b) => a.localeCompare(b)) },
    columns: {
      agentId: 'prompt_call_logs.agentId',
      extractedJson: 'prompt_call_logs.extractedJson',
      createdAt: 'prompt_call_logs.createdAt',
    },
    stages: stages.map((stage) => stage.stage),
    caveats: CAVEATS,
    caveatDetails: { nonJsonMediaSkills, deltaOutputSkills, missingCoreSkills: declared.missingCore },
    totals: {
      rows: rows.length,
      consideredRows: aggregation.consideredRows,
      skills: aggregation.skills.length,
      deadFields: aggregation.skills.reduce((sum, skill) => sum + skill.deadFields.length, 0),
      driftFields: aggregation.skills.reduce((sum, skill) => sum + skill.driftFields.length, 0),
      deadRoutingEdges: deadRoutingEdges.length,
      skippedMissingAgent: aggregation.skippedMissingAgent,
      skippedNonSkillAgent: aggregation.skippedNonSkillAgent,
    },
    skills,
    deadRoutingEdges,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const since = new Date(Date.now() - args.days * DAY_MS);
  const stages = loadOrchestrationFiles();

  let scopeSkillIds: string[] | null;
  if (args.skill) {
    scopeSkillIds = [args.skill];
  } else if (args.stage) {
    scopeSkillIds = collectSkillIdsFromStages(stages, args.stage);
    if (scopeSkillIds.length === 0) {
      console.error(`[audit-field-hit-rates] 未找到 stage=${args.stage} 的 skill 契约（可用 stage：${stages.map((stage) => stage.stage).join(' / ')}）`);
      process.exitCode = 1;
      return;
    }
  } else {
    scopeSkillIds = null;
  }

  const declared = loadDeclaredCore(scopeSkillIds);

  const where = args.skill
    ? { createdAt: { gte: since }, agentId: `skill:${args.skill}` }
    : scopeSkillIds && scopeSkillIds.length > 0
      ? { createdAt: { gte: since }, agentId: { in: scopeSkillIds.map((skillId) => `skill:${skillId}`) } }
      : { createdAt: { gte: since }, agentId: { startsWith: 'skill:' } };

  const rows = await prisma.prompt_call_logs.findMany({
    where,
    select: { agentId: true, extractedJson: true, createdAt: true, success: true },
    orderBy: { createdAt: 'desc' },
    take: args.limit,
  });

  const logRows: FieldHitLogRow[] = rows.map((entry) => ({
    agentId: entry.agentId,
    extractedJson: entry.extractedJson,
  }));

  const aggregation = aggregateFieldHitRates(logRows, {
    declaredFieldsBySkill: declared.declaredFieldsBySkill,
  });

  const routingIndex = buildRoutingIndex(stages);
  const deadRoutingEdges: DeadRoutingEdge[] = [];
  for (const skill of aggregation.skills) {
    deadRoutingEdges.push(...findDeadRoutingEdges(skill, routingIndex.get(skill.skillId) ?? []));
  }
  deadRoutingEdges.sort((a, b) => a.skillId.localeCompare(b.skillId) || a.fieldId.localeCompare(b.fieldId));

  if (args.json) {
    console.log(JSON.stringify(buildJsonOutput(args, since, stages, declared, rows, aggregation, deadRoutingEdges), null, 2));
    return;
  }

  const nonJsonMediaSkills = [...declared.meta.entries()].filter(([, meta]) => meta.outputMedia !== 'json').map(([skillId]) => skillId);
  const deltaOutputSkills = [...declared.meta.entries()].filter(([, meta]) => meta.deltaOutput).map(([skillId]) => skillId);
  const deadFieldCount = aggregation.skills.reduce((sum, skill) => sum + skill.deadFields.length, 0);
  const driftFieldCount = aggregation.skills.reduce((sum, skill) => sum + skill.driftFields.length, 0);

  console.log(`== 字段级运行时命中率审计（近 ${args.days} 天）==`);
  console.log('声明源：prompts/core/<skillId>.yaml（fields）+ prompts/orchestration/*.yaml（routing）｜只读，未写入任何数据');
  console.log('数据列：agentId=prompt_call_logs.agentId｜字段=extractedJson 顶层键｜时间=createdAt');
  console.log(
    `窗口：since=${since.toISOString()}｜DB 返回 ${rows.length} 行｜纳入 skill 行 ${aggregation.consideredRows}` +
    `（跳过缺 agentId ${aggregation.skippedMissingAgent} / 非 skill ${aggregation.skippedNonSkillAgent}）`,
  );
  if (args.skill) console.log(`范围：--skill=${args.skill}`);
  if (args.stage) console.log(`范围：--stage=${args.stage}（skill：${scopeSkillIds?.join(', ') ?? '-'}）`);

  console.log('\n⚠ CAVEAT（解读前必读）');
  for (const line of CAVEATS) console.log(`  - ${line}`);
  if (nonJsonMediaSkills.length) console.log(`  本次媒体产物 skill：${nonJsonMediaSkills.join(', ')}`);
  if (deltaOutputSkills.length) console.log(`  本次 deltaOutput=true skill：${deltaOutputSkills.join(', ')}`);
  if (declared.missingCore.length) console.log(`  缺 core.yaml（声明字段视为空）：${declared.missingCore.join(', ')}`);

  console.log('\n-- 汇总 --');
  console.log(
    `  技能 ${aggregation.skills.length} 个｜死字段 ${deadFieldCount}｜契约漂移字段 ${driftFieldCount}｜死边候选 ${deadRoutingEdges.length}` +
    `｜minCalls 过滤 ${aggregation.skippedBelowMinCalls} 个 skill`,
  );

  console.log('\n-- 各 skill 产出率（命中率 = 出现该键的调用 / 总调用）--');
  const shownSkills = aggregation.skills.slice(0, args.top);
  if (shownSkills.length === 0) {
    console.log('  (无)');
  }
  for (const skill of shownSkills) {
    console.log(`\n[${skill.agentId}] 调用 ${skill.totalCalls} 次（解析成功 ${skill.parsedCalls}｜未产出 ${skill.unparsedCalls}）`);
    if (skill.fields.length === 0) {
      console.log('  声明字段：无（core.yaml 缺失或未声明 fields）');
    } else {
      console.log('  产出率：');
      for (const entry of skill.fields) console.log(`    ${fmtEntry(entry, skill.totalCalls)}`);
    }
    if (skill.deadFields.length > 0) {
      console.log(`  死字段（声明但从未产出）：${skill.deadFields.join(', ')}`);
    }
    if (skill.driftFields.length > 0) {
      console.log(`  契约漂移字段（产出但 core 未声明）：${skill.driftFields.map((entry) => entry.field).join(', ')}`);
    }
    const skillDeadEdges = deadRoutingEdges.filter((edge) => edge.skillId === skill.skillId);
    if (skillDeadEdges.length > 0) {
      console.log(`  死边候选（routing 声明但从未产出）${skillDeadEdges.length} 条：`);
      for (const edge of skillDeadEdges) {
        console.log(`    · ${edge.agentId} / ${edge.fieldId} → [${edge.handoff.join(', ')}]（${edge.reason}，stage=${edge.stage}）`);
      }
    }
  }
  if (aggregation.skills.length > shownSkills.length) {
    console.log(`\n  … 其余 ${aggregation.skills.length - shownSkills.length} 个 skill 未展示（--top=${args.top}）`);
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('[audit-field-hit-rates] 失败：', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
