#!/usr/bin/env node
/** test-run-vl-batch.mjs — run-vl-batch.mjs 三缺陷（R1 A8/A9/A38）修复回归测试。无后端依赖。
 * 用法：node scripts/vlab-eval/test-run-vl-batch.mjs
 * 组1 源级断言：对 run-vl-batch.mjs 源文本取证（修复前必失败——缺陷=能力缺失/公式越界）；
 * 组2 行为断言：spawn `run-vl-batch.mjs --selftest`（错误分类/重试决策/AIMD 界/path 就绪
 *     判定的纯函数用例，退出码必须 0）。
 * 缺陷出处：doc/local/ROUND1-REVIEW-2026-10-05.md:393-395、:424；实败样本
 * doc/local/runs/20261006/vl-evals/vl-r1b-summary.jsonl:1-2。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(HERE, 'run-vl-batch.mjs');
const SRC = fs.readFileSync(TARGET, 'utf8');
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

// ---- [F3-c / R1 A38] CONC_MAX 不得越过操作者指定并发 ----
// 旧公式（修复前在源内）：Math.max(CONC, Math.round(CONC * 1.7))，CONC=2 时=3（越界实测值）。
const OLD_FORMULA = /CONC_MAX\s*=\s*Math\.max\(CONC,\s*Math\.round\(CONC \* 1\.7\)\)/;
const oldHit = SRC.match(OLD_FORMULA);
check('[c] 旧 1.7× 上限公式已移除', !oldHit, oldHit ? `仍在源内: ${oldHit[0]}` : '');
if (oldHit) {
  // 复现数值：对旧公式按操作者指定值求值，证明越界
  for (const conc of [2, 10]) {
    const v = Function(`"use strict";const CONC=${conc};return Math.max(CONC, Math.round(CONC * 1.7))`)();
    check(`[c·repro] 旧公式 CONC=${conc} → CONC_MAX=${v} 越过指定值（> ${conc}）`, v > conc, `got ${v}`);
  }
}
check('[c] 上限改经 concBounds() 推导且尊重操作者指定值', /concBounds\(CONC,\s*CONC_MAX_EXPLICIT\)/.test(SRC) && /function concBounds\(/.test(SRC), '未找到 concBounds 定义/调用');
check('[c] 提供 --conc-max 显式覆盖参数', /arg\('conc-max'/.test(SRC), '未找到 --conc-max 解析');

// ---- [F3-a / R1 A9] 200 包裹上游错误纳入重试 + 池级订阅 403 复活重发 ----
check('[a] 存在 200 包裹上游错误分类函数 classifyWrappedUpstream()', /function classifyWrappedUpstream\(/.test(SRC), '未找到分类函数');
check('[a] api() 错误分支调用该分类（success:false 且 2xx 时）', /json\?\.success === false\)\s*\{\s*const rawMsg[\s\S]{0,1200}classifyWrappedUpstream\(rawMsg\)/.test(SRC), 'api() 未接入分类');
check('[a] 分类不可重试时不盲试（上游 404 直接抛）', /if \(!cls\.retryable\) throw/.test(SRC), '未找到不可重试短路');
check('[a] 池级订阅 403 先复活会话再重发（ad-driver 已验证修法搬移）', /sub403[\s\S]{0,200}revive\(\)/.test(SRC) && /function reviveIfSessionDead\(/.test(SRC), '未找到 revive 接线');

// ---- [F3-b / R1 A8] path-ready 竞态可等待 ----
check('[b] 存在竞态错误识别 isPathTasksNotReadyError()', /function isPathTasksNotReadyError\(/.test(SRC), '未找到识别函数');
check('[b] 存在任务就绪轮询 waitPathTasksReady()（GET /paths/:id 口径）', /function waitPathTasksReady\(/.test(SRC) && /\/api\/admin\/learning-content\/paths\/\$\{/.test(SRC), '未找到轮询实现');
check('[b] start-learning 撞竞态错后转等待并重发开课（不再直接判格失败）', /isPathTasksNotReadyError\([\s\S]{0,300}waitPathTasksReady\(/.test(SRC), 'start-learning 未接等待分支');
check('[b] 就绪判据与后端 waitForPathReady 对齐（非 completed 即可启动）', /pathTasksState\(/.test(SRC), '未找到 pathTasksState');

// ---- 组2：行为断言（--selftest 子进程） ----
if (SRC.includes('--selftest')) {
  const r = spawnSync(process.execPath, [TARGET, '--selftest'], { encoding: 'utf8', timeout: 30000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/selftest: (\d+)\/(\d+) passed/);
  const allPass = r.status === 0 && m && Number(m[1]) === Number(m[2]) && Number(m[2]) > 0;
  check('[selftest] run-vl-batch.mjs --selftest 全过', !!allPass, `exit=${r.status} ${m ? `${m[1]}/${m[2]}` : '无统计行'}\n${out.split('\n').filter((l) => /^FAIL/.test(l)).join('\n')}`);
} else {
  check('[selftest] run-vl-batch.mjs 实现 --selftest 模式', false, '源内无 --selftest（修复前预期失败）');
}

let fail = 0;
for (const { name, ok, detail } of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ' — ' + detail}`);
  if (!ok) fail++;
}
console.log(`test-run-vl-batch: ${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
