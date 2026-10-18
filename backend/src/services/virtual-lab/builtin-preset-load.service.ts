/**
 * 预制虚拟学习者「一键加载」服务（#91 / P-67）
 *
 * 背景：平台预置（`virtual-learners/presets.yaml`，File-as-Truth）自 2026-10-09 起不再随启动
 * 自动同步，唯一入口 `bootstrap/seeds.ts:runBuiltinVirtualLearnersSeed` 仓库内零调用方 ⇒
 * 管理台只有「预置卡」计数，没有任何加载入口。本服务是该入口的 service 层：
 *
 * - `getBuiltinPresetOverview()`：只读总览 —— 定义（文件）逐条 + 对齐到的实例状态
 *   （未加载 / 同版 / 待升级 / 定义回退 / 同版哈希漂移），供 UI 决定要不要点「一键加载」。
 * - `loadBuiltinVirtualLearners()`：执行幂等同步，逻辑完全复用 seeder 的
 *   `ensureBuiltinVirtualLearners`（=`runBuiltinVirtualLearnersSeed` 的内核，保留运行时产物、
 *   绝不删实例、单条失败 best-effort），同步后再回读一次总览返回。
 *
 * 版本关系策略见 `virtual-lab/builtin-learners/seeder.ts` 文件头表；本服务只做展示映射，
 * 不复制判据（展示用的关系判定直接调 `classifyPresetVersion`）。
 *
 * 分层：本文件属 services 层，DB 直连合法；`routes/**` 只能经由本服务取数
 * （backend/scripts/check-route-db-boundary.mjs 的棘轮）。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import {
  BUILTIN_LEARNERS_FILE,
  loadBuiltinLearnerPresets,
  type BuiltinLearnerPresetLoadResult,
} from '../../virtual-lab/builtin-learners/loader';
import {
  classifyPresetVersion,
  ensureBuiltinVirtualLearners,
  type EnsureBuiltinLearnersResult,
  type PresetVersionRelation,
} from '../../virtual-lab/builtin-learners/seeder';
import { parseTags } from '../../virtual-lab/builtin-learners/profile-data';

type PrismaLike = typeof prisma;

/** 定义↔实例的对齐状态（UI 用；`classifyPresetVersion` 只给版本关系，这里再叠哈希漂移） */
export type BuiltinPresetLoadState = 'not-loaded' | 'current' | 'upgradable' | 'rolled-back' | 'drifted';

export interface BuiltinPresetInstanceView {
  profileId: string;
  userId: string;
  presetVersion: number;
  updatedAt: string | null;
  relation: PresetVersionRelation;
  /** 同版本下实例 tags 的 hash 与定义内容哈希不一致（改内容未升版本） */
  contentDrifted: boolean;
}

export interface BuiltinPresetOverviewItem {
  presetKey: string;
  presetVersion: number;
  nameHint: string;
  goal: string;
  scope: string;
  sourceType: string;
  goalType: string;
  coverageAxes: string[];
  fixtureMaterialCount: number;
  state: BuiltinPresetLoadState;
  instance: BuiltinPresetInstanceView | null;
}

export interface BuiltinPresetOverviewSummary {
  definitions: number;
  loaded: number;
  missing: number;
  upgradable: number;
  rolledBack: number;
  drifted: number;
}

export interface BuiltinPresetOverview {
  file: string;
  fileVersion: number;
  loaderDiagnostics: BuiltinLearnerPresetLoadResult['diagnostics'];
  presets: BuiltinPresetOverviewItem[];
  summary: BuiltinPresetOverviewSummary;
}

export interface LoadBuiltinVirtualLearnersResult extends EnsureBuiltinLearnersResult {
  definitionVersion: number;
  /** 同步完成后的定义↔实例快照（直接喂 UI，省一次往返） */
  overview: BuiltinPresetOverview;
}

interface InstanceRow {
  id: string;
  userId: string;
  presetKey: string | null;
  presetVersion: number | null;
  tags: string | null;
  updatedAt: Date | null;
}

async function findBuiltinInstances(client: PrismaLike): Promise<InstanceRow[]> {
  return client.virtual_learner_profiles.findMany({
    where: { source: 'builtin' },
    select: { id: true, userId: true, presetKey: true, presetVersion: true, tags: true, updatedAt: true },
  });
}

function resolveState(relation: PresetVersionRelation, contentDrifted: boolean): BuiltinPresetLoadState {
  if (relation === 'definition-ahead') return 'upgradable';
  if (relation === 'instance-ahead') return 'rolled-back';
  return contentDrifted ? 'drifted' : 'current';
}

/**
 * 预置总览（只读）。`client` 可注入（测试）；`loaded` 可注入以免同一请求里重复读文件。
 */
export async function getBuiltinPresetOverview(
  client: PrismaLike = prisma,
  loaded: BuiltinLearnerPresetLoadResult = loadBuiltinLearnerPresets(),
): Promise<BuiltinPresetOverview> {
  const instances = await findBuiltinInstances(client);
  const byKey = new Map<string, InstanceRow>();
  for (const row of instances) {
    const key = String(row.presetKey || '');
    if (key && !byKey.has(key)) byKey.set(key, row);
  }

  const presets: BuiltinPresetOverviewItem[] = loaded.presets.map((preset) => {
    const row = byKey.get(preset.presetKey);
    if (!row) {
      return {
        presetKey: preset.presetKey,
        presetVersion: preset.presetVersion,
        nameHint: String(preset.personaSeed?.nameHint || preset.presetKey),
        goal: String(preset.story?.goalSeed?.surfaceGoal || '').trim(),
        scope: preset.scope,
        sourceType: preset.sourceType,
        goalType: preset.goalType,
        coverageAxes: preset.coverageAxes,
        fixtureMaterialCount: preset.fixtureMaterials.length,
        state: 'not-loaded',
        instance: null,
      };
    }
    const relation = classifyPresetVersion(row.presetVersion, preset.presetVersion);
    const instanceHash = parseTags(row.tags ?? null).find((t) => t.startsWith('hash:'))?.slice('hash:'.length) || '';
    // 只在同版本下谈「哈希漂移」：版本不同时差异已由 relation 表达（hash 本就该不同）
    const contentDrifted = relation === 'same' && Boolean(instanceHash) && instanceHash !== preset.contentHash;
    return {
      presetKey: preset.presetKey,
      presetVersion: preset.presetVersion,
      nameHint: String(preset.personaSeed?.nameHint || preset.presetKey),
      goal: String(preset.story?.goalSeed?.surfaceGoal || '').trim(),
      scope: preset.scope,
      sourceType: preset.sourceType,
      goalType: preset.goalType,
      coverageAxes: preset.coverageAxes,
      fixtureMaterialCount: preset.fixtureMaterials.length,
      state: resolveState(relation, contentDrifted),
      instance: {
        profileId: row.id,
        userId: row.userId,
        presetVersion: Number(row.presetVersion ?? 0),
        updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
        relation,
        contentDrifted,
      },
    };
  });

  const summary: BuiltinPresetOverviewSummary = {
    definitions: presets.length,
    loaded: presets.filter((p) => p.instance).length,
    missing: presets.filter((p) => p.state === 'not-loaded').length,
    upgradable: presets.filter((p) => p.state === 'upgradable').length,
    rolledBack: presets.filter((p) => p.state === 'rolled-back').length,
    drifted: presets.filter((p) => p.state === 'drifted').length,
  };

  return {
    file: BUILTIN_LEARNERS_FILE,
    fileVersion: loaded.version,
    loaderDiagnostics: loaded.diagnostics,
    presets,
    summary,
  };
}

/**
 * 一键加载：幂等同步定义 → 实例（语义与 `runBuiltinVirtualLearnersSeed` 一致，
 * 只是把 best-effort 结果原样返回给调用方，而不是只写启动日志）。
 */
export async function loadBuiltinVirtualLearners(
  client: PrismaLike = prisma,
): Promise<LoadBuiltinVirtualLearnersResult> {
  const loaded = loadBuiltinLearnerPresets();
  const result = await ensureBuiltinVirtualLearners(client);
  const overview = await getBuiltinPresetOverview(client, loaded);

  logger.info('[builtin-preset-load] 管理台一键加载完成', {
    fileVersion: loaded.version,
    created: result.created.length,
    updated: result.updated.length,
    skipped: result.skipped.length,
    drifted: result.drifted.length,
    versionAhead: result.versionAhead.length,
    errors: result.errors.length,
  });

  return { ...result, definitionVersion: loaded.version, overview };
}
