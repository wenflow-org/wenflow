/* eslint-disable @typescript-eslint/no-explicit-any -- 边界解析 LLM/JSON 动态载荷，形状由上游契约与运行时校验兜底 */
/**
 * Referee 人工锚点抽样导出（2026-11-19，P2 效度闭环）。
 *
 * 用法：
 *   npx ts-node src/scripts/export-referee-anchor.ts --limit=20
 *   npx ts-node src/scripts/export-referee-anchor.ts --limit=20 --labels=.runtime/referee-anchor/labels.jsonl
 *
 * 输出 JSONL 每行一条 referee 报告（含 verdict/scores/findings/evidence 与空 human 槽）；
 * 人工复核后把 { sessionId, human: { verdict, overall, reviewer, reviewedAt } } 写进 labels 文件，
 * 再次运行 --labels 即可打印 verdict 一致率与 overall MAE。
 */
import fs from 'node:fs';
import path from 'node:path';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { safeJsonParse } from '../utils/safe-json';
import {
  selectRefereeAnchorSample,
  summarizeRefereeAnchorAgreement,
  type RefereeAnchorSample,
} from '../services/virtual-lab/referee-anchor';

function arg(name: string, fallback = ''): string {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function readJsonl(file: string): Array<Record<string, any>> {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeJsonParse<Record<string, any>>(line, {}));
}

function collectSamples(rows: Array<{ id: string; stageResults: string | null }>): RefereeAnchorSample[] {
  const samples: RefereeAnchorSample[] = [];
  for (const row of rows) {
    const state = safeJsonParse<Record<string, any>>(row.stageResults, {});
    const reports = Array.isArray(state?.blackbox?.refereeReports) ? state.blackbox.refereeReports : [];
    for (const record of reports) {
      const report = record?.report || {};
      samples.push({
        sessionId: row.id,
        runId: String(record?.runId || state?.experiment?.runId || ''),
        reportId: String(record?.id || ''),
        verdict: String(report?.verdict || ''),
        overall: typeof report?.scores?.overall === 'number' ? report.scores.overall : null,
        scores: report?.scores && typeof report.scores === 'object' ? report.scores : {},
        findings: Array.isArray(report?.findings) ? report.findings : [],
        reportVersion: typeof record?.reportVersion === 'string' ? record.reportVersion : undefined,
        inputFingerprint: typeof record?.inputFingerprint === 'string' ? record.inputFingerprint : undefined,
        evaluatedAt: typeof record?.evaluatedAt === 'string' ? record.evaluatedAt : undefined,
      });
    }
  }
  return samples;
}

async function main() {
  const limit = Math.max(1, Number(arg('limit', '20')) || 20);
  const out = arg('out', path.join('.runtime', 'referee-anchor', `${new Date().toISOString().slice(0, 10)}.jsonl`));
  const labelsPath = arg('labels');

  const rows = await prisma.virtual_sessions.findMany({
    where: { stageResults: { contains: 'refereeReports' } },
    select: { id: true, stageResults: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const all = collectSamples(rows);
  const sample = selectRefereeAnchorSample(all, limit);
  if (sample.length === 0) {
    logger.warn('[referee-anchor] 没有可抽样的 referee 报告');
    return;
  }

  if (labelsPath) {
    const labels = readJsonl(labelsPath);
    const bySession = new Map(labels.map((item) => [String(item.sessionId || ''), item.human]));
    for (const item of sample) {
      const human = bySession.get(item.sessionId);
      if (human) item.human = human;
    }
    const agreement = summarizeRefereeAnchorAgreement(sample);
    console.log('[referee-anchor] 一致性', JSON.stringify(agreement, null, 2));
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, sample.map((item) => JSON.stringify(item)).join('\n') + '\n', 'utf8');
  console.log(`[referee-anchor] 已导出 ${sample.length}/${all.length} 条 → ${out}`);
}

main()
  .catch((error) => {
    console.error('[referee-anchor] 导出失败:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
