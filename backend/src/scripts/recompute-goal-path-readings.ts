/* eslint-disable no-console -- 只读复算 CLI */
/**
 * goal→path 读数的**离线复算**（#119，2026-10-20）。
 *
 * 背景：2026-10-19 的验收读数（zeroRef、后半引用、refPct）此前只能靠
 * 「DB + 本地 104 份 web 材料库 + 重跑生成」复现，外部复核拿不到。本脚本只读
 * `doc/measurement/119/` 里的固化工件，不连 DB、不走网络，重算三组读数：
 *
 *   1. zeroRefStages —— task（任务级，materialCoverage.refs 同口径）与
 *      combined（里程碑级+任务级，后半引用/refPct 同口径）两个口径；
 *   2. 后半引用 —— chunk 分位 / section 分位（逐 ref 明细复算，与 dual-metric 汇总对账）；
 *   3. refPct —— 逐阶段「引用 cos 在窗口内分位」的均值。
 *
 * 口径陷阱（#119 根因）：旧报告把 task 级 zeroRef 与 combined 级 late/refPct 混着引用，
 * 于是「从路径对象复算 zeroRef」得 0/74 而不是 3/74。本脚本两个口径都打印，并标 refScope。
 *
 * 用法（backend 目录）：
 *   npx ts-node --transpile-only src/scripts/recompute-goal-path-readings.ts --bundle=../doc/measurement/119
 * 退出码：0 = 复算完成且与工件的 totals / manifest.expected 全部对上；1 = 对不上；2 = 工件缺失。
 */
import fs from 'node:fs';
import path from 'node:path';

function argText(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

interface CoverageStage {
  stageNumber: number;
  refs: number;
  milestoneRefs: number;
  combinedRefs: number;
}

interface CoverageFile {
  totals?: { stages?: number; taskRefs?: number; milestoneRefs?: number; combinedRefs?: number };
  paths: Array<{ goal: string; stages: CoverageStage[] }>;
}

interface DualMetricRef {
  sectionId: string | null;
  chunkPos: number | null;
  sectionPos: number | null;
  lateChunk?: boolean;
  lateSection?: boolean;
}

interface DualMetricFile {
  refScope?: string;
  totals: {
    refs: number;
    lateChunk: number;
    lateSection: number;
    sectionOnly: number;
    neither: number;
    goalsWithLateChunk: number;
    goalsWithLateSection: number;
  };
  perGoal: Array<{
    goal: string;
    refs: number;
    lateChunk: number;
    lateSection: number;
    sectionOnly: number;
    detail?: DualMetricRef[];
  }>;
}

interface SemanticAlignmentFile {
  refScope?: string;
  perGoal: Array<{ goal: string; stages: Array<{ stageNumber: number; refs: number; refPct: number }> }>;
}

interface BundleManifest {
  commitSha?: string | null;
  model?: { ai?: string; reasoning?: string };
  files?: Record<string, { sha256?: string; refScope?: string }>;
  expected?: {
    zeroRefTask?: number;
    zeroRefCombined?: number;
    stages?: number;
    refs?: number;
    lateChunk?: number;
    lateSection?: number;
    sectionOnly?: number;
    refPct?: number;
  };
}

function pickFile(dir: string, prefix: string, manifest: BundleManifest | null): string {
  const named = manifest?.files
    ? Object.keys(manifest.files).find((name) => name.startsWith(prefix) && name.endsWith('.json'))
    : undefined;
  if (named) {
    const candidate = path.join(dir, named);
    if (!fs.existsSync(candidate)) throw new Error(`manifest 指向的文件不存在：${named}`);
    return candidate;
  }
  const hit = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json') && !name.includes('.vectors.'))
    .sort()
    .pop();
  if (!hit) throw new Error(`bundle 缺 ${prefix}*.json：${dir}`);
  return path.join(dir, hit);
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

function recomputeLate(dual: DualMetricFile) {
  const hasDetail = dual.perGoal.every((goal) => Array.isArray(goal.detail));
  if (!hasDetail) {
    // 旧工件（只有 perGoal 汇总）：直接按 goal 相加，标注 mode 供读者判断证据强度
    const sums = dual.perGoal.reduce(
      (acc, goal) => {
        acc.refs += Number(goal.refs || 0);
        acc.lateChunk += Number(goal.lateChunk || 0);
        acc.lateSection += Number(goal.lateSection || 0);
        acc.sectionOnly += Number(goal.sectionOnly || 0);
        if (Number(goal.lateChunk) > 0) acc.goalsWithLateChunk += 1;
        if (Number(goal.lateSection) > 0) acc.goalsWithLateSection += 1;
        return acc;
      },
      { refs: 0, lateChunk: 0, lateSection: 0, sectionOnly: 0, neither: 0, goalsWithLateChunk: 0, goalsWithLateSection: 0 }
    );
    sums.neither = sums.refs - sums.lateChunk - sums.sectionOnly - (sums.lateSection - sums.sectionOnly);
    return { mode: 'perGoal' as const, ...sums };
  }
  const totals = { refs: 0, lateChunk: 0, lateSection: 0, sectionOnly: 0, neither: 0, goalsWithLateChunk: 0, goalsWithLateSection: 0 };
  for (const goal of dual.perGoal) {
    let goalLateChunk = 0;
    let goalLateSection = 0;
    for (const ref of goal.detail || []) {
      const isLateChunk = ref.chunkPos !== null && ref.chunkPos >= 0.5;
      const isLateSection = ref.sectionPos !== null && ref.sectionPos >= 0.5;
      totals.refs += 1;
      if (isLateChunk) {
        totals.lateChunk += 1;
        goalLateChunk += 1;
      }
      if (isLateSection) {
        totals.lateSection += 1;
        goalLateSection += 1;
      }
      if (!isLateChunk && isLateSection) totals.sectionOnly += 1;
      if (!isLateChunk && !isLateSection) totals.neither += 1;
    }
    if (goalLateChunk > 0) totals.goalsWithLateChunk += 1;
    if (goalLateSection > 0) totals.goalsWithLateSection += 1;
  }
  return { mode: 'detail' as const, ...totals };
}

function main(): number {
  const bundle = path.resolve(argText('bundle') || path.resolve(__dirname, '../../../doc/measurement/119'));
  if (!fs.existsSync(bundle)) {
    console.error(`bundle 不存在：${bundle}`);
    return 2;
  }
  const manifestPath = path.join(bundle, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? readJson<BundleManifest>(manifestPath) : null;

  let coverage: CoverageFile;
  let dual: DualMetricFile;
  let dualFile: string;
  let alignment: SemanticAlignmentFile;
  try {
    coverage = readJson<CoverageFile>(pickFile(bundle, 'coverage-', manifest));
    dualFile = pickFile(bundle, 'dual-metric-', manifest);
    dual = readJson<DualMetricFile>(dualFile);
    alignment = readJson<SemanticAlignmentFile>(pickFile(bundle, 'semantic-alignment-', manifest));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  // 1) zeroRef 双口径
  const zeroTask: string[] = [];
  const zeroCombined: string[] = [];
  let stages = 0;
  let taskRefs = 0;
  let milestoneRefs = 0;
  let combinedRefs = 0;
  for (const goal of coverage.paths) {
    for (const stage of goal.stages) {
      stages += 1;
      taskRefs += stage.refs;
      milestoneRefs += stage.milestoneRefs;
      combinedRefs += stage.combinedRefs;
      if (stage.refs === 0) zeroTask.push(`${goal.goal}:s${stage.stageNumber}`);
      if (stage.combinedRefs === 0) zeroCombined.push(`${goal.goal}:s${stage.stageNumber}`);
    }
  }
  const zeroRef = {
    stages,
    task: { refs: taskRefs, zero: zeroTask.length, items: zeroTask },
    combined: { refs: combinedRefs, milestoneRefs, zero: zeroCombined.length, items: zeroCombined },
  };

  // 2) 后半引用（逐 ref 明细）
  const late = recomputeLate(dual);
  const latePct = {
    chunk: late.lateChunk / Math.max(1, late.refs),
    section: late.lateSection / Math.max(1, late.refs),
    sectionOnly: late.sectionOnly,
  };
  const lateMatchesTotals =
    late.refs === dual.totals.refs &&
    late.lateChunk === dual.totals.lateChunk &&
    late.lateSection === dual.totals.lateSection &&
    late.sectionOnly === dual.totals.sectionOnly &&
    late.neither === dual.totals.neither;

  // 3) refPct
  let stageRows = 0;
  let refPctSum = 0;
  for (const goal of alignment.perGoal) {
    for (const stage of goal.stages) {
      stageRows += 1;
      refPctSum += Number(stage.refPct || 0);
    }
  }
  const refPct = { stages: stageRows, mean: refPctSum / Math.max(1, stageRows) };

  const expected = manifest?.expected || null;
  const near = (a: number, b: number | undefined, digits = 4) =>
    typeof b === 'number' ? Math.abs(a - b) < 0.5 * 10 ** -digits : null;
  const matches = expected
    ? {
        zeroRefTask: eqInt(zeroRef.task.items.length, expected.zeroRefTask),
        zeroRefCombined: eqInt(zeroRef.combined.items.length, expected.zeroRefCombined),
        stages: eqInt(zeroRef.stages, expected.stages),
        refs: eqInt(late.refs, expected.refs),
        lateChunk: eqInt(late.lateChunk, expected.lateChunk),
        lateSection: eqInt(late.lateSection, expected.lateSection),
        sectionOnly: eqInt(late.sectionOnly, expected.sectionOnly),
        refPct: near(refPct.mean, expected.refPct),
      }
    : null;
  const allMatch = matches ? Object.values(matches).every((value) => value !== false) : true;

  console.log(
    JSON.stringify(
      {
        bundle,
        commitSha: manifest?.commitSha ?? null,
        model: manifest?.model ?? null,
        zeroRef: {
          refScopeTask: 'task（subtasks[].materialRefs；与 materialCoverage.refs 同口径）',
          refScopeCombined: 'combined（milestone.materialRefs + subtasks[].materialRefs；与 late/refPct 同口径）',
          ...zeroRef,
        },
        late: {
          refScope: dual.refScope || manifest?.files?.[path.basename(dualFile)]?.refScope || 'unknown',
          mode: late.mode,
          refs: late.refs,
          lateChunk: late.lateChunk,
          lateSection: late.lateSection,
          sectionOnly: late.sectionOnly,
          neither: late.neither,
          chunkPct: Number(latePct.chunk.toFixed(4)),
          sectionPct: Number(latePct.section.toFixed(4)),
          matchesArtifactTotals: lateMatchesTotals,
          artifactTotals: dual.totals,
        },
        refPct: {
          refScope: alignment.refScope || 'combined',
          stages: refPct.stages,
          mean: Number(refPct.mean.toFixed(4)),
        },
        expected,
        matches,
        allMatch,
      },
      null,
      1
    )
  );

  if (!lateMatchesTotals) {
    console.error('复算与 dual-metric 工件 totals 不一致——工件可能被改动或口径变了');
    return 1;
  }
  return allMatch ? 0 : 1;
}

/** 与 expected 的整数比较；expected 缺省时返回 null（不参与判定）。 */
function eqInt(actual: number, expected: number | undefined): boolean | null {
  return typeof expected === 'number' ? actual === expected : null;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  }
}
