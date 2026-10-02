#!/usr/bin/env node
/**
 * repair-timeout-cells.mjs — 把「drive 就绪窗超时假失败」的格子按数据库实态改回 done。
 *
 * 背景：drive.mjs 的生成就绪窗原为 8 分钟；网关慢/高并发下 stage 设计（5 次串行 LLM 调用）
 * 整链超过 8 分钟，drive 停止等待并记 failed-gen——但**后端生成继续跑完**（实证多条超时格
 * 的 path 最终 status=active、stageDesign=succeeded）。判定标准不看错误文案（不同时期的
 * 文案不一），只看数据库实态：状态=failed-gen 且该 pathId 在库里满足：
 *   status=active、milestones>0、_generation.stageDesign=succeeded → 改 status=done。
 *
 * 用法：node repair-timeout-cells.mjs [--apply]（默认 dry-run 只报数）
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const APPLY = process.argv.includes('--apply');
const RESULTS = path.resolve(import.meta.dirname, 'results');
const DB = path.resolve(import.meta.dirname, '../../backend/prisma/dev.db');
const db = new DatabaseSync(DB, { readOnly: !APPLY });

let checked = 0, repaired = 0, stillBad = 0;
const report = [];
for (const f of fs.readdirSync(RESULTS)) {
  const m = f.match(/^(rw-[\w-]+)-r(\d+)\.json$/);
  if (!m) continue;
  const [, id, run] = m;
  let st;
  try { st = JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8')); } catch { continue; }
  if (st.status !== 'failed-gen') continue;
  if (!st.pathId) continue;
  checked++;
  const p = db.prepare('SELECT id, status, totalMilestones, aiPromptTemplate FROM learning_paths WHERE id = ?').get(st.pathId);
  if (!p) { stillBad++; report.push(`${id}-r${run}: path 不存在（真失败）`); continue; }
  let lc = {};
  try { lc = JSON.parse(p.aiPromptTemplate || '{}')._generation || {}; } catch { /* ignore */ }
  const ready = p.status === 'active' && p.totalMilestones > 0 && lc.stageDesign === 'succeeded';
  if (!ready) { stillBad++; report.push(`${id}-r${run}: path 未就绪（status=${p.status}, stageDesign=${lc.stageDesign || '-'}）`); continue; }
  repaired++;
  report.push(`${id}-r${run}: 修复 → done（path ${st.pathId.slice(-8)}，${p.totalMilestones} 里程碑，drive 超时假失败）`);
  if (APPLY) {
    st.status = 'done';
    st.error = null;
    st.repaired = 'drive-timeout-false-fail（后端已生成成功，见 repair-timeout-cells.mjs）';
    fs.writeFileSync(path.join(RESULTS, f), JSON.stringify(st, null, 1));
  }
}
db.close();
console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} 超时假失败格 ${checked} 个：可修复 ${repaired}，仍真失败 ${stillBad}`);
for (const r of report.slice(0, 30)) console.log(' ', r);
if (report.length > 30) console.log(` …其余 ${report.length - 30} 条省略`);
if (!APPLY && repaired) console.log('（加 --apply 执行修复）');
