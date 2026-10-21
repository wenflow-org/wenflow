#!/usr/bin/env node
/**
 * measurement:check —— 测量资产预检（2026-10-20）。
 *
 * 目的：在真正跑 `frozen-exam-run.mjs --compare` 之前，先把 `doc/measurement/**` 里的
 * 条件清单和冻结集结构问题找出来。对照门禁本身已经是硬性的，本脚本只是把同样的
 * 校验前移到「准备阶段」，避免跑完两臂才发现清单缺字段。
 *
 * 检查项：
 * 1. 所有 `*condition*.json` 都能通过 normalizeConditionManifest（九个必填字段 + 取值域）；
 * 2. 每个冻结集目录都有 manifest.json，且能通过 parseManifest（结构/路径穿越/sha256 形状）；
 * 3. 示例清单存在（`condition-manifest.example.json`），防止文档与实现脱节。
 *
 * 用法：node backend/scripts/measurement-verify/measurement-check.mjs [--json]
 * 退出码：0 全过；1 有问题；2 未预期异常。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FrozenExamError, normalizeConditionManifest, parseManifest } from './frozen-exam-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const MEASUREMENT_DIR = path.join(REPO_ROOT, 'doc', 'measurement');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(REPO_ROOT, file).replace(/\\/g, '/');
}

function main() {
  const json = process.argv.includes('--json');
  const problems = [];
  const checked = { conditions: 0, frozenSets: 0, example: false };

  const files = walk(MEASUREMENT_DIR);
  for (const file of files) {
    if (!file.toLowerCase().endsWith('.json')) continue;
    const base = path.basename(file).toLowerCase();
    if (base.includes('condition')) {
      checked.conditions += 1;
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        normalizeConditionManifest(raw, rel(file));
      } catch (error) {
        problems.push({
          code: error instanceof FrozenExamError ? error.code : 'JSON_PARSE',
          scope: rel(file),
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      if (base.includes('example')) checked.example = true;
    }
  }

  // 冻结集目录：doc/measurement/frozen-exam-*
  for (const entry of fs.existsSync(MEASUREMENT_DIR) ? fs.readdirSync(MEASUREMENT_DIR, { withFileTypes: true }) : []) {
    if (!entry.isDirectory() || !entry.name.startsWith('frozen-exam-')) continue;
    checked.frozenSets += 1;
    const manifestPath = path.join(MEASUREMENT_DIR, entry.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      problems.push({ code: 'MANIFEST_MISSING', scope: rel(manifestPath), detail: '冻结集缺少 manifest.json' });
      continue;
    }
    try {
      parseManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    } catch (error) {
      problems.push({
        code: error instanceof FrozenExamError ? error.code : 'MANIFEST_PARSE',
        scope: rel(manifestPath),
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!checked.example) {
    problems.push({
      code: 'EXAMPLE_MISSING',
      scope: 'doc/measurement/condition-manifest.example.json',
      detail: '缺少条件清单示例；协议§二.2 的字段说明需要一份可直接复制的模板',
    });
  }

  const ok = problems.length === 0;
  if (json) {
    console.log(JSON.stringify({ ok, checked, problems }, null, 2));
  } else {
    console.log(`measurement:check ${ok ? 'PASS' : 'FAIL'}`);
    console.log(`  条件清单 ${checked.conditions} 份 / 冻结集 ${checked.frozenSets} 个 / 示例 ${checked.example ? '有' : '无'}`);
    for (const p of problems) console.log(`  · [${p.code}] ${p.scope}: ${p.detail}`);
  }
  return ok ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error('measurement:check 未预期异常：', error);
  process.exitCode = 2;
}
