#!/usr/bin/env node
/**
 * long-run.mjs —— 跨日长程推进编排器（遗忘曲线实验）
 *
 * 用法：node long-run.mjs --from=7 --to=14 [--base=http://127.0.0.1:3011]
 * 行为：
 *   - 逐日调用 r4-cal-collect.mjs day<N>（复用其推进+取证+成对样本逻辑）
 *   - 每天结束后读 day JSON，把「clockAfter.dayIndex 未变」（path 失/空日）的 VL 移出后续名单
 *   - 汇总日志写 out/long-run-<from>-<to>.log，逐日 JSON 照常落 out/r4-cal-day<N>.json
 * 目的：把 FSRS 遗忘曲线拉长到 10+ 天跨度，并观察监测面（温故计划/额度/投影）是否跟着记忆状态走。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve('D:/wenflow/wenflow');
const HERE = path.join(ROOT, 'backend', 'scripts', 'measurement-verify');
const OUT = path.join(HERE, 'out');
const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=').slice(1).join('=') : d; };

const FROM = Number(arg('from', '7'));
const TO = Number(arg('to', '14'));
const BASE = arg('base', 'http://127.0.0.1:3011');
const LOG = path.join(OUT, `long-run-${FROM}-${TO}.log`);
const LOGF = (m) => { const line = `[${new Date().toISOString()}] ${m}`; fs.appendFileSync(LOG, line + '\n'); console.log(line); };

const COLLECTOR = path.join(HERE, 'r4-cal-collect.mjs');

/** 初始名单：全部 R4 VL（day6 后由存活检测自动收缩）。 */
let live = ['rw-school6-01', 'rw-school6-09', 'rw-school6-21', 'rw-exam6-08', 'rw-acad6-03', 'rw-career6-05', 'rw-life6-06'];
// rw-school6-28 已知 path 失失（每次 advance 回滚），直接排除

const summary = [];

for (let day = FROM; day <= TO; day += 1) {
  if (live.length === 0) { LOGF('存活名单为空，提前结束'); break; }
  LOGF(`=== day${day} 开始：${live.length} 个 VL (${live.join(',')})`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [COLLECTOR, `day${day}`, `--vl=${live.join(',')}`, `--base=${BASE}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 4 * 3600 * 1000 });
  fs.appendFileSync(path.join(OUT, `long-run-day${day}.stdout.log`), (r.stdout || '') + '\n--- STDERR ---\n' + (r.stderr || ''));
  LOGF(`day${day} 结束 exit=${r.status} 耗时=${((Date.now() - t0) / 60000).toFixed(1)}min`);

  // 读当日 JSON，收缩存活名单 + 摘要
  const dayFile = path.join(OUT, `r4-cal-day${day}.json`);
  let pairs = 0;
  try {
    const j = JSON.parse(fs.readFileSync(dayFile, 'utf8'));
    const next = [];
    for (const v of j.vls || []) {
      const before = v.clockBefore ? v.clockBefore.dayIndex : -1;
      const after = v.clockAfter ? v.clockAfter.dayIndex : -1;
      const advanced = after > before;
      pairs += (v.warmupPairs || []).length;
      if (advanced) next.push(v.vlKey);
      else LOGF(`  [淘汰] ${v.vlKey}（dayIndex ${before}→${after}，无推进）`);
    }
    live = next;
    summary.push({ day, pairs, alive: next.length });
    LOGF(`day${day} 摘要：成对样本 ${pairs}，存活 ${next.length}/${(j.vls || []).length}`);
  } catch (e) {
    LOGF(`day${day} JSON 解析失败：${e.message}（保留现有名单继续）`);
    summary.push({ day, pairs: -1, alive: live.length });
  }
  fs.writeFileSync(path.join(OUT, `long-run-summary.json`), JSON.stringify(summary, null, 1));
}

LOGF(`=== 长程推进完成：${JSON.stringify(summary)}`);
// 末尾合并校准
try {
  const asm = spawnSync(process.execPath, [COLLECTOR, 'assemble', `--base=${BASE}`], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  LOGF(`assemble：${(asm.stdout || '').trim().split('\n').slice(-1)[0]}`);
} catch (e) { LOGF(`assemble 失败：${e.message}`); }
void pathToFileURL;
