/* eslint-disable no-console -- 一次性语义对齐探针 */
/**
 * 验证「语义挂载」假设（2026-10-17）：
 * 外部方案主张「后段 milestone 的 title+goal 语义上天然对应资料后部，用 Embedding 检索
 * 就能把锚点拉到 s-20~s-24」。本探针不跑生成，只做确定性的语义对齐测量：
 *   1. 取每条已完成路径的 milestone 标题/目标与资料包章节（title+summary）；
 *   2. 用现有 embedding 服务算 cosine，取 top-8（与 stage-designer 载荷同槽位）；
 *   3. 记录 top-8 的章节序号均值/三分位分布，并与当前「按位置切窗」的窗口区间对比。
 *
 * 判读：若后段 milestone 的语义 top-8 明显偏后且三分位覆盖不塌，语义挂载值得上；
 * 若语义 picks 也集中在前部（或覆盖只剩一个三分位），则说明纯语义会丢掉覆盖，
 * 必须做「覆盖约束 + 语义重排」的混合。
 *
 * 用法：npx ts-node --transpile-only src/scripts/verify-semantic-stage-alignment.ts --run=<run.json>
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getLearningPath } from '../services/learning/queries/path-views.queries';
import { buildUploadedMaterialPacksAsync } from '../services/materials/material-pack.builder';
import {
  resolveMaterialWindowRange,
  resolveTertileQuota,
  selectSectionsWithCoverageQuota,
} from '../services/materials/material-prompt-projection';
import { cosineSimilarity, embedTexts } from '../services/embedding';

function argText(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 解析 s-N 序号（不用正则 exec，避免安全扫描误判）。 */
function sectionOrdinal(sectionId: unknown): number | null {
  const raw = String(sectionId || '');
  if (!/^s-\d+$/.test(raw)) return null;
  const value = Number(raw.slice(2));
  return Number.isFinite(value) ? value : null;
}

function milestoneRefs(milestone: unknown): string[] {
  const ids: string[] = [];
  const node = (milestone && typeof milestone === 'object' ? milestone : {}) as Record<string, unknown>;
  for (const ref of Array.isArray(node.materialRefs) ? node.materialRefs : []) {
    if (ref?.sectionId) ids.push(String(ref.sectionId));
  }
  for (const task of Array.isArray(node.subtasks) ? node.subtasks : []) {
    for (const ref of Array.isArray(task?.materialRefs) ? task.materialRefs : []) {
      if (ref?.sectionId) ids.push(String(ref.sectionId));
    }
  }
  return ids;
}

interface SectionRow {
  id: string;
  text: string;
  position: number;
}

async function packSections(userId: string): Promise<SectionRow[]> {
  const packs = await buildUploadedMaterialPacksAsync(userId).catch(() => []);
  const pack = packs.find((entry) => Array.isArray(entry?.pack?.sections) && entry.pack.sections.length > 0)?.pack;
  if (!pack) return [];
  const sections = pack.sections as Array<{ id?: string; title?: string; summary?: string }>;
  const total = sections.length;
  return sections.map((section, index) => ({
    id: String(section?.id || `s-${index + 1}`),
    text: `${String(section?.title || '')}。${String(section?.summary || '')}`,
    position: total > 1 ? index / (total - 1) : 0,
  }));
}

async function main(): Promise<void> {
  const runFile = argText('run');
  if (!runFile) throw new Error('需要 --run=<run.json>');
  const rows = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  const byStage: Record<string, {
    semantic: number[];
    window: number[];
    thirds: number[][];
    quotaThirds: number[][];
    quotaPct: number[];
    refs: Array<{ refMean: number; windowTop8Mean: number; windowAllMean: number; refPct: number }>;
  }> = {};
  const perGoal: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const result = row?.arms?.new;
    if (!result?.pathId) continue;
    const detail: unknown = await getLearningPath(result.pathId).catch(() => null);
    if (!detail) continue;
    const sections = await packSections(result.userId);
    if (sections.length === 0) continue;
    const sectionVectors = await embedTexts({ input: sections.map((section) => section.text) }, { timeoutMs: 60_000 });
    const total = sections.length;
    const root = (detail && typeof detail === 'object' ? detail : {}) as Record<string, unknown>;
    const stageCount = Array.isArray(root.milestones) ? root.milestones.length : 0;

    const goalRow: { goal: unknown; stages: Array<Record<string, unknown>> } = { goal: row.goal, stages: [] };
    const milestones = (Array.isArray(root.milestones) ? root.milestones : []) as Array<Record<string, unknown>>;
    for (const milestone of milestones) {
      const stageNumber = Number(milestone?.stageNumber) || goalRow.stages.length + 1;
      const query = `${String(milestone?.title || '')}。${String(milestone?.goal || '')}`.trim();
      const queryVector = (await embedTexts({ input: [query] }, { timeoutMs: 30_000 })).vectors[0]?.embedding;
      if (!queryVector) continue;
      const scored = sections
        .map((section, index) => ({
          position: section.position,
          score: cosineSimilarity(queryVector, sectionVectors.vectors[index]?.embedding || []),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
      const positions = scored.map((item) => item.position);
      const [windowStart, windowEnd] = resolveMaterialWindowRange(total, 8, stageNumber, stageCount);
      const windowMid = total > 1 ? ((windowStart + windowEnd) / 2 - 1) / (total - 1) : 0;
      const thirds = [0, 0, 0];
      for (const position of positions) thirds[position < 1 / 3 ? 0 : position < 2 / 3 ? 1 : 2] += 1;
      const bucket = byStage[`${stageNumber}/${stageCount}`]
        || (byStage[`${stageNumber}/${stageCount}`] = { semantic: [], window: [], thirds: [], quotaThirds: [], quotaPct: [], refs: [] });
      bucket.semantic.push(mean(positions));
      bucket.window.push(windowMid);
      bucket.thirds.push(thirds);

      // 现有引用在窗口内的语义强度：refMeanCos vs 窗口 top8 / 窗口全量。
      // 若 refMean ≈ 窗口全量均值，说明模型只是在窗口里随便挑（语义重排有增量）；
      // 若 refMean ≈ 窗口 top8，说明它已经在挑相关的，语义层收益有限。
      const cosines = sections.map((_item, index) => cosineSimilarity(queryVector, sectionVectors.vectors[index]?.embedding || []));
      const windowCosines = cosines.slice(windowStart, windowEnd);
      const windowTop8 = [...windowCosines].sort((a, b) => b - a).slice(0, 8);
      // 覆盖约束的语义重排（#119-3）静态臂：配额选节 + 其 cos 在窗口内的分位（预测上限）。
      const rankById = new Map<string, number>();
      sections
        .map((section, index) => ({ id: section.id, index, score: cosines[index] }))
        .sort((left, right) => (right.score - left.score) || (left.index - right.index))
        .forEach((entry, rank) => rankById.set(entry.id, rank));
      const quotaIds = selectSectionsWithCoverageQuota(
        sections.map((section) => ({ id: section.id })),
        8,
        [windowStart, windowEnd],
        rankById
      ).map((section) => section.id);
      const quotaOrdinals = quotaIds
        .map((sectionId) => sectionOrdinal(sectionId))
        .filter((value): value is number => value !== null && value >= 1 && value <= total);
      const quotaThirds = [0, 0, 0];
      for (const ordinal of quotaOrdinals) {
        const position = total > 1 ? (ordinal - 1) / (total - 1) : 0;
        quotaThirds[position < 1 / 3 ? 0 : position < 2 / 3 ? 1 : 2] += 1;
      }
      const quotaMean = mean(quotaOrdinals.map((ordinal) => cosines[ordinal - 1]).filter((value) => Number.isFinite(value)));
      const quotaPctValue = windowCosines.length > 0
        ? windowCosines.filter((value) => value < quotaMean).length / windowCosines.length
        : 0;
      bucket.quotaThirds.push(quotaThirds);
      bucket.quotaPct.push(quotaPctValue);
      const refOrdinals = Array.from(new Set(milestoneRefs(milestone)
        .map((sectionId) => sectionOrdinal(sectionId))
        .filter((value): value is number => value !== null && value >= 1 && value <= total)));
      const refCosines = refOrdinals.map((ordinal) => cosines[ordinal - 1]).filter((value) => Number.isFinite(value));
      const refMean = mean(refCosines);
      const refPct = windowCosines.length > 0
        ? windowCosines.filter((value) => value < refMean).length / windowCosines.length
        : 0;
      bucket.refs.push({ refMean, windowTop8Mean: mean(windowTop8), windowAllMean: mean(windowCosines), refPct });

      goalRow.stages.push({
        stageNumber,
        stageCount,
        sectionCount: total,
        semanticMean: Number(mean(positions).toFixed(3)),
        semanticMax: Number(Math.max(...positions).toFixed(3)),
        windowMid: Number(windowMid.toFixed(3)),
        thirds,
        refs: refOrdinals.length,
        refMeanCos: Number(refMean.toFixed(3)),
        windowTop8Cos: Number(mean(windowTop8).toFixed(3)),
        windowAllCos: Number(mean(windowCosines).toFixed(3)),
        refPct: Number(refPct.toFixed(3)),
        quotaThirds,
        quotaMeanCos: Number(quotaMean.toFixed(3)),
        quotaPct: Number(quotaPctValue.toFixed(3)),
      });
    }
    perGoal.push(goalRow);
    console.log(`\n[${row.goal}] sections ${total}`);
    for (const stage of goalRow.stages) {
      console.log(
        `  stage ${stage.stageNumber}/${stage.stageCount}｜语义 top8 均值 ${stage.semanticMean}（max ${stage.semanticMax}）` +
          `｜位置窗口中点 ${stage.windowMid}｜三分位 ${(stage.thirds as number[]).join('/')}` +
          `｜引用 ${stage.refs} 条 cos ${stage.refMeanCos}（窗口 top8 ${stage.windowTop8Cos} / 全量 ${stage.windowAllCos}，分位 ${stage.refPct}）` +
          `｜配额臂 cos ${stage.quotaMeanCos} 分位 ${stage.quotaPct}（三分位 ${(stage.quotaThirds as number[]).join('/')}）`
      );
    }
  }

  console.log('\n=== 按阶段归一汇总（语义均值 vs 位置窗口中点；三分位=前/中/后各几个） ===');
  for (const key of Object.keys(byStage).sort((a, b) => Number(a.split('/')[0]) - Number(b.split('/')[0]))) {
    const bucket = byStage[key];
    const thirdMean = [0, 1, 2].map((index) => mean(bucket.thirds.map((thirds) => thirds[index])));
    const quotaThirdMean = [0, 1, 2].map((index) => mean((bucket.quotaThirds || []).map((thirds) => thirds[index])));
    const refRows = bucket.refs || [];
    console.log(
      `stage ${key}｜语义均值 ${mean(bucket.semantic).toFixed(3)}｜窗口中点 ${mean(bucket.window).toFixed(3)}` +
        `｜三分位均值 ${thirdMean.map((value) => value.toFixed(1)).join('/')}` +
        `｜引用 cos ${mean(refRows.map((row) => row.refMean)).toFixed(3)}` +
        `（窗口 top8 ${mean(refRows.map((row) => row.windowTop8Mean)).toFixed(3)}` +
        ` / 全量 ${mean(refRows.map((row) => row.windowAllMean)).toFixed(3)}，分位 ${mean(refRows.map((row) => row.refPct)).toFixed(2)}）` +
        `｜配额臂三分位 ${quotaThirdMean.map((value) => value.toFixed(1)).join('/')}` +
        `，预测分位 ${mean(bucket.quotaPct || []).toFixed(2)}`
    );
  }

  const outFile = path.join(path.dirname(runFile), `semantic-alignment-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ runFile, byStage, perGoal }, null, 2), 'utf-8');
  console.log(`\n明细 → ${outFile}`);
}

main()
  .catch((error) => {
    console.error('[semantic-align] 失败', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    const { default: prisma } = await import('../config/database');
    await prisma.$disconnect().catch(() => undefined);
  });
