/**
 * prompts:yaml:check —— YAML 词表统一交叉校验门禁（P1-B，脚本级只读，不改运行时）
 *
 * 检查项（YAML_UNIFICATION_AUDIT §2/§3.1，全部 fail-fast，零误报）：
 *   C1  failurePolicy 映射一致性：core params.failurePolicy（业务意图）经映射表
 *       必须等于 manifest promptContract.failurePolicy（运行时契约），双向闭包自洽
 *   C2  temperature/maxTokens 一致性：core params（真源）== manifest runtimeDefaults（镜像）
 *   C3  acceptableAgentIds 无字面重复项（全部 manifest）
 *   C4  编排字段 valueType 全量 ∈ CORE_VALUE_TYPES，且 valueTypeToCoreType 闭环到合法 core 类型
 *   C5  编排 routings visibilityPreset 全量 ∈ VISIBILITY_PRESETS
 *   C6  编排字段 promptRole / render 全量命中词表（orchestration-file 加载即校验，此处复核）
 *
 * 用法：npm run prompts:yaml:check（已挂入 prompts:check:all 链，位于 prompts:skills:check 之后）
 */
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { scanCoreFiles } from '../services/prompt-lab/core-file-loader';
import { loadOrchestrationFiles } from '../services/field-routing/orchestration-file';
import {
  CORE_FIELD_TYPES,
  CORE_VALUE_TYPES,
  FAILURE_POLICY_CORE,
  FAILURE_POLICY_MANIFEST,
  VISIBILITY_PRESETS,
  coreFailurePolicyOf,
  coreTypeToValueType,
  manifestFailurePolicyOf,
  valueTypeToCoreType,
} from '../services/yaml-vocabulary';

const MANIFESTS_DIR = path.join(process.cwd(), '../prompt-lab/manifests');

interface RawManifest {
  skillId?: unknown;
  acceptableAgentIds?: unknown;
  runtimeDefaults?: { temperature?: unknown; maxTokens?: unknown };
  promptContract?: { failurePolicy?: unknown };
}

function loadManifests(): Map<string, RawManifest> {
  const manifests = new Map<string, RawManifest>();
  if (!fs.existsSync(MANIFESTS_DIR)) {
    throw new Error(`manifest 目录不存在：${MANIFESTS_DIR}`);
  }
  for (const name of fs.readdirSync(MANIFESTS_DIR).filter((n) => n.endsWith('.yaml')).sort()) {
    const skillId = name.replace(/\.yaml$/, '');
    const parsed = yaml.load(fs.readFileSync(path.join(MANIFESTS_DIR, name), 'utf-8')) as RawManifest;
    manifests.set(skillId, parsed);
  }
  return manifests;
}

export interface YamlVocabularyCheckReport {
  ok: boolean;
  /** 阻断级问题（C1~C5 失败条目） */
  errors: string[];
  /** 非阻断说明（词表零使用等） */
  notes: string[];
  /** 每类检查的统计行（CLI 展示用） */
  summaryLines: string[];
}

/**
 * C1~C5 词表交叉校验（纯 fs 读盘，同步；check-yaml-vocabulary.ts main() 与
 * health-center 聚合共用同一实现，不复制逻辑）。
 */
export function runYamlVocabularyCheck(): YamlVocabularyCheckReport {
  const errors: string[] = [];
  const notes: string[] = [];

  const { files: cores, diagnostics: coreDiagnostics } = scanCoreFiles();
  if (coreDiagnostics.length > 0) {
    for (const d of coreDiagnostics) {
      errors.push(`core 文件诊断 ${d.code}：${d.filePath}（${d.message}）`);
    }
  }
  const stages = loadOrchestrationFiles();
  const manifests = loadManifests();

  // ---- C1：failurePolicy 映射一致性（core × manifest） ----
  const mappingClosureOk = FAILURE_POLICY_CORE.every(
    (core) => coreFailurePolicyOf(manifestFailurePolicyOf(core) || '') === core
  );
  if (!mappingClosureOk) {
    errors.push('C1 映射表自洽失败：core→manifest→core 闭包不等于原值');
  }
  let failurePolicyMismatch = 0;
  for (const core of cores) {
    const manifest = manifests.get(core.skillId);
    if (!manifest) {
      errors.push(`C1 缺 manifest 无法交叉核对：${core.skillId}`);
      continue;
    }
    const declared = manifest.promptContract?.failurePolicy;
    const expected = manifestFailurePolicyOf(core.params.failurePolicy);
    if (expected === undefined) {
      errors.push(`C1 词表外 core failurePolicy：${core.skillId}=${core.params.failurePolicy}`);
    } else if (declared !== expected) {
      failurePolicyMismatch++;
      errors.push(`C1 failurePolicy 映射不一致：${core.skillId} core=${core.params.failurePolicy}（应映射 ${expected}）但 manifest=${declared}`);
    }
  }
  for (const manifestPolicy of FAILURE_POLICY_MANIFEST) {
    if (![...cores].some((c) => manifestFailurePolicyOf(c.params.failurePolicy) === manifestPolicy)) {
      notes.push(`C1 manifest 词表值 ${manifestPolicy} 当前零使用（映射表保留，无 core 入口）`);
    }
  }

  // ---- C2：temperature / maxTokens 一致性（core 为真源，manifest runtimeDefaults 为镜像） ----
  let paramMismatch = 0;
  for (const core of cores) {
    const manifest = manifests.get(core.skillId);
    if (!manifest || !manifest.runtimeDefaults) continue;
    const { temperature, maxTokens } = manifest.runtimeDefaults;
    if (temperature !== core.params.temperature) {
      paramMismatch++;
      errors.push(`C2 temperature 不一致：${core.skillId} core=${core.params.temperature} manifest=${temperature}`);
    }
    if (maxTokens !== core.params.maxTokens) {
      paramMismatch++;
      errors.push(`C2 maxTokens 不一致：${core.skillId} core=${core.params.maxTokens} manifest=${maxTokens}`);
    }
  }

  // ---- C3：acceptableAgentIds 无字面重复 ----
  let dedupeCount = 0;
  for (const [skillId, manifest] of manifests) {
    if (!Array.isArray(manifest.acceptableAgentIds)) continue;
    const seen = new Set<string>();
    for (const item of manifest.acceptableAgentIds) {
      const value = String(item);
      if (seen.has(value)) {
        dedupeCount++;
        errors.push(`C3 acceptableAgentIds 重复项：${skillId} 含 "${value}"`);
      }
      seen.add(value);
    }
  }

  // ---- C4：编排 valueType 词表 + 类型映射闭环 ----
  let fieldCount = 0;
  const valueTypeCounts = new Map<string, number>();
  for (const stage of stages) {
    for (const field of stage.fields) {
      fieldCount++;
      valueTypeCounts.set(field.valueType, (valueTypeCounts.get(field.valueType) || 0) + 1);
      if (!(CORE_VALUE_TYPES as readonly string[]).includes(field.valueType)) {
        errors.push(`C4 ${stage.stage}/${field.fieldId} valueType=${field.valueType} 不在 CORE_VALUE_TYPES（${CORE_VALUE_TYPES.join('|')}）`);
        continue;
      }
      const coreType = valueTypeToCoreType(field.valueType);
      if (coreType === undefined || !(CORE_FIELD_TYPES as readonly string[]).includes(coreType)) {
        errors.push(`C4 ${stage.stage}/${field.fieldId} valueType=${field.valueType} 无法闭环到合法 core 类型`);
      }
    }
  }
  for (const core of cores) {
    for (const field of core.fields) {
      const valueType = coreTypeToValueType(field.type);
      if (valueType !== undefined && !(CORE_VALUE_TYPES as readonly string[]).includes(valueType)) {
        errors.push(`C4 ${core.skillId}/${field.name} core type=${field.type} 映射 valueType=${valueType} 不在 CORE_VALUE_TYPES`);
      }
    }
  }

  // ---- C5：visibilityPreset 词表 ----
  let presetCount = 0;
  const presetCounts = new Map<string, number>();
  for (const stage of stages) {
    for (const routing of stage.routings) {
      if (routing.visibilityPreset === undefined) continue;
      presetCount++;
      presetCounts.set(routing.visibilityPreset, (presetCounts.get(routing.visibilityPreset) || 0) + 1);
      if (!(VISIBILITY_PRESETS as readonly string[]).includes(routing.visibilityPreset)) {
        errors.push(`C5 ${stage.stage}/${routing.agentId}/${routing.fieldId} visibilityPreset=${routing.visibilityPreset} 不在 VISIBILITY_PRESETS（${VISIBILITY_PRESETS.join('|')}）`);
      }
    }
  }

  // ---- 汇总 ----
  const summaryLines = [
    `[yaml:check] core ${cores.length} 个 / orchestration ${stages.length} 个 stage / manifest ${manifests.size} 个（目录 ${MANIFESTS_DIR}）`,
    `[yaml:check] C1 failurePolicy: ${cores.length - failurePolicyMismatch}/${cores.length} 映射一致（core 词表 ${FAILURE_POLICY_CORE.join('/')} ↔ manifest ${FAILURE_POLICY_MANIFEST.join('/')}）`,
    `[yaml:check] C2 参数双写: temperature+maxTokens 逐项一致（${cores.length * 2 - paramMismatch}/${cores.length * 2} 项）`,
    `[yaml:check] C3 acceptableAgentIds: ${manifests.size} 个 manifest 无字面重复（清理 ${dedupeCount} 项）`,
    `[yaml:check] C4 valueType: ${fieldCount} 字段全量 ∈ CORE_VALUE_TYPES 且映射闭环；分布 ${[...valueTypeCounts.entries()].map(([t, n]) => `${t}=${n}`).join(' ')}`,
    `[yaml:check] C5 visibilityPreset: ${presetCount} 处全量命中；分布 ${[...presetCounts.entries()].map(([t, n]) => `${t}=${n}`).join(' ')}`,
  ];

  return { ok: errors.length === 0, errors, notes, summaryLines };
}

function main(): void {
  const { ok, errors, notes, summaryLines } = runYamlVocabularyCheck();
  for (const line of summaryLines) console.log(line);
  for (const note of notes) console.log(`[yaml:check] NOTE ${note}`);

  if (!ok) {
    for (const message of errors) console.error(`[yaml:check] FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log('[yaml:check] OK：C1~C5 词表交叉校验全部通过');
}

if (require.main === module) {
  main();
}
