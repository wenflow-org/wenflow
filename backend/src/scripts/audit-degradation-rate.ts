/**
 * 降级率（DNR）回看（**只读**，不写库、不调 LLM）—— Wave1 · Track B / Q3 真实侧最小可观测
 *
 * ⚠️ **这是近似，不是真 SLO**（务必在解读/对外时保留此声明）：
 *   1. `snapshotDegradationCounters()` 是**进程内**计数：本脚本独立运行时通常为 0 ——
 *      只有在同一进程内（health-center 等只读消费方）读取才有意义；
 *   2. 历史值只能从结构化日志 `[degradation]` 行回看（默认 `backend/logs/combined.log*`）；
 *   3. 日志按 20MB×5 轮转、可能被清理，分母（总调用数）也不在本脚本里 ——
 *      因此本脚本给出的是"按 source 的降级次数与占比（占已记录降级）"，**不是**降级率 SLO。
 *
 * 约定：「允许降级，不允许未打标的降级」——`recordDegradation` 统一出口见
 * `backend/src/skills/degradation-telemetry.ts`。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/audit-degradation-rate.ts [--log=<file>] [--days=7]
 */
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { snapshotDegradationCounters } from '../skills/degradation-telemetry';

export interface DegradationLogRecord {
  source: string;
  faultCategory: string | null;
  severity: string | null;
  at: string | null;
}

export interface DegradationSourceStat {
  source: string;
  count: number;
  /** 占已记录降级总数的比例（0-1） */
  share: number;
  /** 该 source 的故障类别分布 */
  categories: Record<string, number>;
  severities: Record<string, number>;
}

export interface DegradationReport {
  total: number;
  bySource: DegradationSourceStat[];
}

function tally(bucket: Record<string, number>, key: string | null): void {
  const safe = key && key.trim() ? key.trim() : '(unknown)';
  bucket[safe] = (bucket[safe] ?? 0) + 1;
}

/**
 * 解析一行 winston JSON 日志；非 `[degradation]` 行返回 null。
 * 注意：只支持 JSON 格式（文件 transport 恒为 JSON）；开发态彩色 console 行不会被解析。
 */
export function parseDegradationLogLine(line: string): DegradationLogRecord | null {
  const trimmed = String(line ?? '').trim();
  if (!trimmed || !trimmed.includes('[degradation]')) return null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const message = typeof obj.message === 'string' ? obj.message : '';
    if (!message.includes('[degradation]')) return null;
    const source = typeof obj.source === 'string' && obj.source.trim() ? obj.source.trim() : '(unknown)';
    return {
      source,
      faultCategory: typeof obj.faultCategory === 'string' ? obj.faultCategory : null,
      severity: typeof obj.severity === 'string' ? obj.severity : null,
      at: typeof obj.timestamp === 'string'
        ? obj.timestamp
        : (typeof obj.at === 'string' ? obj.at : null),
    };
  } catch {
    return null;
  }
}

/** 把日志记录聚合成"按 source 的次数/占比/类别分布"，按次数降序。 */
export function aggregateDegradationRecords(records: DegradationLogRecord[]): DegradationReport {
  const map = new Map<string, { count: number; categories: Record<string, number>; severities: Record<string, number> }>();
  for (const record of records) {
    const source = record.source || '(unknown)';
    const bucket = map.get(source) ?? { count: 0, categories: {}, severities: {} };
    bucket.count += 1;
    tally(bucket.categories, record.faultCategory);
    tally(bucket.severities, record.severity);
    map.set(source, bucket);
  }
  const total = records.length;
  const bySource = [...map.entries()]
    .map(([source, bucket]) => ({
      source,
      count: bucket.count,
      share: total > 0 ? bucket.count / total : 0,
      categories: bucket.categories,
      severities: bucket.severities,
    }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  return { total, bySource };
}

/** 把进程内计数快照聚合成同构报告（无类别/严重度信息）。 */
export function aggregateCounterSnapshot(counters: Record<string, number>): DegradationReport {
  const entries = Object.entries(counters ?? {})
    .map(([source, raw]) => [source, Math.max(0, Number(raw) || 0)] as const)
    .filter(([, count]) => count > 0);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const bySource = entries
    .map(([source, count]) => ({
      source,
      count,
      share: total > 0 ? count / total : 0,
      categories: {} as Record<string, number>,
      severities: {} as Record<string, number>,
    }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  return { total, bySource };
}

/** 纯格式化：生成可打印的报告行（不含任何 I/O）。 */
export function formatDegradationReport(report: DegradationReport, heading: string): string[] {
  const lines: string[] = [heading];
  if (!report || report.total === 0) {
    lines.push('  （无记录）');
    return lines;
  }
  lines.push(`  合计 ${report.total} 次降级`);
  lines.push('  source                                次数    占比   主要故障类别');
  for (const stat of report.bySource) {
    const topCategory = Object.entries(stat.categories).sort((a, b) => b[1] - a[1])[0];
    lines.push(
      `  ${stat.source.padEnd(36)} ${String(stat.count).padStart(5)}  ${(stat.share * 100).toFixed(1).padStart(5)}%   ` +
        `${topCategory ? `${topCategory[0]}×${topCategory[1]}` : '-'}`,
    );
  }
  return lines;
}

function arg(name: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function defaultLogDir(): string {
  const configured = (process.env.LOG_DIR || '').trim();
  if (configured) return path.isAbsolute(configured) ? configured : path.resolve(__dirname, '..', '..', configured);
  return path.resolve(__dirname, '..', '..', 'logs');
}

/** 读取日志目录下所有 `combined.log*`（含轮转文件），逐行解析出降级记录。 */
async function readLogRecords(logDir: string): Promise<DegradationLogRecord[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(logDir);
  } catch {
    return [];
  }
  const records: DegradationLogRecord[] = [];
  for (const name of entries.filter((entry) => entry.startsWith('combined.log'))) {
    const content = await fs.readFile(path.join(logDir, name), 'utf-8').catch(() => '');
    for (const line of content.split(/\r?\n/)) {
      const record = parseDegradationLogLine(line);
      if (record) records.push(record);
    }
  }
  return records;
}

function withinDays(record: DegradationLogRecord, since: number): boolean {
  if (!record.at) return true; // 无时间戳的旧/异常行仍计入，避免漏统计
  const parsed = new Date(record.at.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return true;
  return parsed.getTime() >= since;
}

async function main(): Promise<void> {
  const days = Math.max(1, Number(arg('days')) || 7);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const explicitLog = arg('log');
  const logDir = explicitLog ? path.dirname(path.resolve(explicitLog)) : defaultLogDir();

  console.log('[dnr] ⚠️ 近似口径：进程内计数 + 日志回看，不等于真 SLO（日志会轮转/清理，分母不在本脚本）。');

  const counterEntries = snapshotDegradationCounters();
  for (const line of formatDegradationReport(
    aggregateCounterSnapshot(counterEntries),
    '[dnr] 当前进程计数（独立运行通常为 0；仅同进程消费方有意义）',
  )) {
    console.log(line);
  }

  const records = (await readLogRecords(logDir)).filter((record) => withinDays(record, since));
  for (const line of formatDegradationReport(
    aggregateDegradationRecords(records),
    `[dnr] 日志回看（近 ${days} 天｜${logDir}｜combined.log*）`,
  )) {
    console.log(line);
  }

  console.log('[dnr] 说明：计数按 source 聚合；占比分母是"已记录的降级次数"，不是总调用数 → 不是降级率 SLO。');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
