#!/usr/bin/env node
/**
 * frozen-exam-run.mjs — 冻结考卷 × 双臂协议常设化 runner（issue #85；冻结集来自 #84）
 *
 * 协议：doc/measurement/FROZEN-EXAM-PROTOCOL-2026-10-18.md（2026-10-19 起随冻结语料入库；旧位置 doc/local/ 为本地镜像，不再维护）
 *   §二.1 校验冻结集未变（逐文件 sha256 + 基线），有差异即作废本次对照 → 本脚本 --verify（不符非零退出）
 *   §二.3 聚合两臂 wrongAnswerPassed 与四模式率，产出对照表（含样本量）→ 本脚本 --compare
 *   §二.4 F1-b：错答放行在 B 臂相对 A 臂下降 ≥10pp 且样本量 ≥35/臂 → 通过；未达样本量只登记不裁决
 *   §四   冻结集只读；两臂同源同题；跨纪元不得混算
 * 依据：doc/local/ISSUE-RECON-20261019.md「### #85」一节（脚本化常设化，零模型额度）
 *
 * 用法（本脚本不调用任何模型、不写库；除 --out 外不落盘）：
 *   node backend/scripts/measurement-verify/frozen-exam-run.mjs
 *   node backend/scripts/measurement-verify/frozen-exam-run.mjs --verify [--frozen-dir <dir>] [--json] [--allow-extra]
 *       默认模式：校验 doc/measurement/frozen-exam-2026-10-18 的 manifest（逐文件 sha256 + 逐批/合计基线）；
 *       仓内目录不存在时回退旧本地位置 doc/local/frozen-eval-2026-10-18（兼容未同步的本地工作树/工具）。
 *   node backend/scripts/measurement-verify/frozen-exam-run.mjs --compare --arm-a <dir|file> --arm-b <dir|file> \
 *        --verify-frozen --arm-a-conditions <a.json> --arm-b-conditions <b.json> \
 *        [--arm-a-filter <arm>] [--arm-b-filter <arm>] [--min-per-arm 35] [--min-drop-pp 10] \
 *        [--judge-version <v>] [--skip-unknown] [--json] [--out <file>]
 *       聚合两臂既有 verdict（{pid,arm,verdict.patterns} 逐条，或 {judged,wrong,patterns} 预聚合），按 F1-b 判定。
 *       2026-10-20 起 --verify-frozen 与两臂条件清单为**硬门禁**（协议§二.1/§二.2）：
 *       冻结集有变即作废；judgeVersion/生成参数必须一致，覆盖不足或两臂无处理变量一律拒绝。
 *   node backend/scripts/measurement-verify/frozen-exam-run.mjs --selftest
 *       纯函数/完整性校验自测（合成夹具，不读真实冻结集、不联网、零额度；CI 包装测试跑的就是它）。
 *   node backend/scripts/measurement-verify/frozen-exam-run.mjs --help
 *
 * 退出码：0 通过 ｜ 1 用法·输入错误 ｜ 2 冻结集完整性不符 ｜ 3 样本量不足（未裁决）｜ 4 F1-b 未达标 ｜ 5 未预期异常
 *
 * 边界：双臂实跑（需模型额度与待拍板的变体）不在本脚本职责内；本脚本只做「校验 + 聚合 + 判定」，
 * 纯函数在 ./frozen-exam-core.mjs（无 I/O），本文件只负责参数解析、文件系统适配与输出。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  EXIT,
  F1B_DEFAULTS,
  FrozenExamError,
  PATTERNS,
  PRIMARY_PATTERN,
  aggregateArm,
  compareArms,
  compareConditionManifests,
  computeBaseline,
  decideF1b,
  isVerdictShape,
  normalizeConditionManifest,
  normalizeVerdictRecord,
  parseManifest,
  rateFraction,
  ratePct,
  readArmSummary,
  verifyFrozenSet,
} from './frozen-exam-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
// 2026-10-19（#85 收口）：冻结语料入库 doc/measurement/。旧位置 doc/local/frozen-eval-2026-10-18
// 作为 fallback 保留（doc/local 不入库，他处本地工具/未同步工作树可能只留旧目录）。
const FROZEN_DIR_IN_REPO = path.join(REPO_ROOT, 'doc', 'measurement', 'frozen-exam-2026-10-18');
const FROZEN_DIR_LEGACY = path.join(REPO_ROOT, 'doc', 'local', 'frozen-eval-2026-10-18');
const DEFAULT_FROZEN_DIR =
  fs.existsSync(FROZEN_DIR_IN_REPO) || !fs.existsSync(FROZEN_DIR_LEGACY) ? FROZEN_DIR_IN_REPO : FROZEN_DIR_LEGACY;
const PROTOCOL_REF = 'doc/measurement/FROZEN-EXAM-PROTOCOL-2026-10-18.md';
const PATCHES = { ...F1B_DEFAULTS };

const USAGE = [
  '用法：',
  '  frozen-exam-run.mjs --verify [--frozen-dir <dir>] [--json] [--allow-extra]',
  '  frozen-exam-run.mjs --compare --arm-a <dir|file> --arm-b <dir|file> --verify-frozen \\',
  '      --arm-a-conditions <a.json> --arm-b-conditions <b.json> [--arm-a-filter <arm>] [--arm-b-filter <arm>]',
  '      [--min-per-arm 35] [--min-drop-pp 10] [--judge-version <v>] [--skip-unknown] [--json] [--out <file>]',
  '      --verify-frozen 与两份条件清单均为必填（协议§二.1/§二.2；条件清单缺字段即拒绝对照）',
  '  frozen-exam-run.mjs --selftest | --help',
  `协议：${PROTOCOL_REF}（F1-b：B 臂错答放行下降 ≥${PATCHES.minDropPp}pp 且样本量 ≥${PATCHES.minPerArm}/臂；未达样本量只登记不裁决）`,
].join('\n');

// ---------------------------------------------------------------------------
// 参数解析（纯函数，--selftest 里有用例）
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    mode: null,
    frozenDir: DEFAULT_FROZEN_DIR,
    armA: null,
    armB: null,
    armAFilter: null,
    armBFilter: null,
    armAConditions: null,
    armBConditions: null,
    minPerArm: PATCHES.minPerArm,
    minDropPp: PATCHES.minDropPp,
    minCoverage: 0.95,
    maxCoverageGap: 0.02,
    judgeVersion: null,
    out: null,
    json: false,
    allowExtra: false,
    skipUnknown: false,
    verifyFrozen: false,
  };
  const takesValue = {
    '--frozen-dir': (v) => (opts.frozenDir = v),
    '--arm-a': (v) => (opts.armA = v),
    '--arm-b': (v) => (opts.armB = v),
    '--arm-a-filter': (v) => (opts.armAFilter = v),
    '--arm-b-filter': (v) => (opts.armBFilter = v),
    '--arm-a-conditions': (v) => (opts.armAConditions = v),
    '--arm-b-conditions': (v) => (opts.armBConditions = v),
    '--out': (v) => (opts.out = v),
    '--judge-version': (v) => (opts.judgeVersion = v),
    '--min-per-arm': (v) => (opts.minPerArm = parseThreshold(v, '--min-per-arm', PATCHES.minPerArm)),
    '--min-drop-pp': (v) => (opts.minDropPp = parseThreshold(v, '--min-drop-pp', PATCHES.minDropPp)),
    '--min-coverage': (v) => (opts.minCoverage = parseFraction(v, '--min-coverage')),
    '--max-coverage-gap': (v) => (opts.maxCoverageGap = parseFraction(v, '--max-coverage-gap')),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--verify' || arg === '--compare' || arg === '--selftest' || arg === '--help' || arg === '-h') {
      const mode = arg === '-h' ? '--help' : arg;
      if (opts.mode && opts.mode !== mode) throw new FrozenExamError('USAGE', `模式互斥：${opts.mode} 与 ${mode}`);
      opts.mode = mode;
      continue;
    }
    if (arg === '--json') {
      opts.json = true;
      continue;
    }
    if (arg === '--allow-extra') {
      opts.allowExtra = true;
      continue;
    }
    if (arg === '--skip-unknown') {
      opts.skipUnknown = true;
      continue;
    }
    if (arg === '--verify-frozen') {
      opts.verifyFrozen = true;
      continue;
    }
    const setter = takesValue[arg];
    if (setter) {
      const value = argv[i + 1];
      if (value == null || value.startsWith('--')) throw new FrozenExamError('USAGE', `${arg} 缺少取值`);
      setter(value);
      i += 1;
      continue;
    }
    throw new FrozenExamError('USAGE', `未知参数：${arg}`);
  }
  if (!opts.mode) opts.mode = '--verify';
  if (opts.mode === '--compare') {
    if (!opts.armA || !opts.armB) {
      throw new FrozenExamError('USAGE', '--compare 需要 --arm-a 与 --arm-b 各一个路径');
    }
    // 协议§二.1：有差异即作废本次对照——校验不是可选项，必须在对账前强制跑。
    if (!opts.verifyFrozen) {
      throw new FrozenExamError(
        'USAGE',
        '--compare 必须先校验冻结集：请加 --verify-frozen（协议§二.1；--allow-extra 只放宽新增文件，不放宽校验本身）',
      );
    }
    // 协议§二.2：没有条件清单的对照无法证明「同条件」，一律拒绝。
    if (!opts.armAConditions || !opts.armBConditions) {
      throw new FrozenExamError(
        'USAGE',
        '--compare 需要 --arm-a-conditions 与 --arm-b-conditions（每臂一份 JSON，必填 modelSnapshot/promptHash/temperature/topP/maxTokens/seed/k/coverage/judgeVersion）',
      );
    }
  }
  return opts;
}

/**
 * 阈值覆盖只允许「更严格」：F1-b 的 ≥10pp / ≥35 臂来自协议，放宽会让判定失真。
 */
function parseThreshold(value, flag, floor) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new FrozenExamError('USAGE', `${flag} 需要正数，收到 ${value}`);
  if (n < floor) {
    throw new FrozenExamError('USAGE', `${flag} 不得低于协议 F1-b 底线 ${floor}（只允许更严格；收到 ${value}）`);
  }
  return n;
}

/** 覆盖率阈值/容差：0..1 的有限小数。 */
function parseFraction(value, flag) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new FrozenExamError('USAGE', `${flag} 需要 0..1 的小数，收到 ${value}`);
  }
  return n;
}

// ---------------------------------------------------------------------------
// 文件系统适配（verify 模式）
// ---------------------------------------------------------------------------

function fsObserved(rootDir) {
  const dirFor = (batchId) => {
    for (const candidate of [path.join(rootDir, 'verdicts', batchId), path.join(rootDir, batchId)]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    }
    return null;
  };
  return {
    listBatchFiles(batchId) {
      const dir = dirFor(batchId);
      if (!dir) return [];
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .sort();
    },
    sha256(batchId, file) {
      const dir = dirFor(batchId);
      if (!dir) return null;
      const filePath = path.join(dir, file);
      if (!fs.existsSync(filePath)) return null;
      return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    },
  };
}

function readManifestFile(frozenDir) {
  const manifestPath = path.join(frozenDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new FrozenExamError('INTEGRITY', `冻结集 manifest 不存在：${manifestPath}`);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    throw new FrozenExamError('INTEGRITY', `${manifestPath} JSON 解析失败：${e.message}`);
  }
  return parseManifest(raw);
}

// ---------------------------------------------------------------------------
// 臂结果装载（compare 模式）
// ---------------------------------------------------------------------------

function listJsonFiles(dir) {
  const out = [];
  const walk = (d) => {
    const entries = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new FrozenExamError('ARM_INPUT_SHAPE', `${filePath}: JSON 解析失败：${e.message}`);
  }
}

/**
 * 装载一臂：目录（递归 *.json）或单个 JSON 文件。支持逐条 verdict 与预聚合 summary，
 * 两者混用直接报错（会重复计数）。多臂混装时要求用 --arm-*-filter 指定。
 */
function loadArm(inputPath, { filter, label, skipUnknown }) {
  if (!fs.existsSync(inputPath)) throw new FrozenExamError('USAGE', `${label} 路径不存在：${inputPath}`);
  const stat = fs.statSync(inputPath);
  const files = stat.isDirectory() ? listJsonFiles(inputPath) : [inputPath];
  if (files.length === 0) throw new FrozenExamError('ARM_INPUT_SHAPE', `${label}: ${inputPath} 下没有 *.json`);

  const records = [];
  const summaries = [];
  const skipped = [];
  for (const file of files) {
    const raw = readJson(file);
    const items = Array.isArray(raw) ? raw : Array.isArray(raw?.records) ? raw.records : [raw];
    for (const item of items) {
      const summary = readArmSummary(item);
      if (summary) {
        if (filter && summary.arm && summary.arm !== filter) continue;
        summaries.push({ ...summary, source: file });
        continue;
      }
      if (isVerdictShape(item)) {
        records.push(normalizeVerdictRecord(item, file));
        continue;
      }
      if (skipUnknown) {
        skipped.push(file);
        continue;
      }
      throw new FrozenExamError(
        'ARM_INPUT_SHAPE',
        `${file}: 既不是 verdict（{verdict:{patterns}}）也不是预聚合 summary；确认可忽略请加 --skip-unknown`,
      );
    }
  }

  const armsInInput = [...new Set(records.filter((r) => r.arm).map((r) => r.arm))];
  let selected = records;
  if (filter) {
    selected = records.filter((r) => r.arm === filter);
    if (selected.length === 0 && summaries.length === 0) {
      throw new FrozenExamError(
        'ARM_INPUT_SHAPE',
        `${label}: 过滤 ${filter} 后无样本（输入内臂：${armsInInput.join(', ') || '无 arm 字段'}）`,
      );
    }
  } else if (armsInInput.length > 1) {
    throw new FrozenExamError(
      'ARM_INPUT_SHAPE',
      `${label}: 输入含多臂（${armsInInput.join(', ')}），请用 --arm-a-filter / --arm-b-filter 指定`,
    );
  }

  const aggregate = aggregateArm({ records: selected, summaries });
  const armsSelected = [...new Set(selected.filter((r) => r.arm).map((r) => r.arm))];
  return { label, source: inputPath, arms: armsSelected, armsInInput, skipped, aggregate };
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

function fmtRate(block) {
  return block.rate == null ? '—' : `${block.rate}%（${block.hits}/${block.total}）`;
}

function renderVerifyReport(frozenDir, result) {
  const lines = [`冻结集完整性校验（${path.relative(REPO_ROOT, frozenDir) || frozenDir}）`];
  lines.push(`  逐文件 sha256：校验 ${result.checked} 个文件`);
  lines.push(`  基线复算：${result.baseline.judged} 条已判 / 错答放行 ${result.baseline.wrong}（${result.baseline.rate}）`);
  for (const batch of result.baseline.batches) {
    lines.push(`    ${batch.id}：${batch.judged} 条 / 放行 ${batch.wrong}（${batch.rate}）`);
  }
  if (result.ok) {
    lines.push(`  ✔ 通过：${PROTOCOL_REF} §二.1（冻结集未变，可用于本次对照）`);
  } else {
    lines.push(`  ✘ 不符：${result.problems.length} 处`);
    for (const p of result.problems) lines.push(`    [${p.code}] ${p.scope}：${p.detail}`);
    lines.push('  协议§二.1：有差异即作废本次对照；§四：冻结集只读，修改必须新建 frozen-exam-<date>/');
  }
  return lines.join('\n');
}

function compareNotes(comparison, a, b) {
  const notes = [];
  const pairing = comparison.pairing;
  if (pairing.known && pairing.common === 0 && a.aggregate.n > 0 && b.aggregate.n > 0) {
    notes.push('两臂无共同 pid：若本次是同源同题 A/B，说明两臂课堂清单不同源，结论不可归因于改动（协议§四）');
  }
  if (!pairing.known) {
    notes.push('预聚合 summary 不含 pid：同源同题（协议§四）需人工核对课堂清单');
  }
  return notes;
}

function renderCompareReport({ a, b, comparison, decision, judgeVersion, verified }) {
  const lines = [`冻结考卷 A/B 对照（F1-b 主指标 = ${PRIMARY_PATTERN}）`];
  lines.push(`  判据版本：${judgeVersion ?? '未提供（--judge-version；协议§二.2 要求版本号写进产物）'}`);
  if (decision.minDropPp !== F1B_DEFAULTS.minDropPp || decision.minPerArm !== F1B_DEFAULTS.minPerArm) {
    lines.push(
      `  阈值已收紧：minDropPp=${decision.minDropPp}、minPerArm=${decision.minPerArm}` +
        `（协议默认 ${F1B_DEFAULTS.minDropPp}/${F1B_DEFAULTS.minPerArm}；只允许更严格）`,
    );
  }
  lines.push(`  A 臂（基线）：${a.label}（${a.source}）n=${a.aggregate.n}${a.arms.length ? ` arm=${a.arms.join('|')}` : ''}`);
  lines.push(`  B 臂（变体）：${b.label}（${b.source}）n=${b.aggregate.n}${b.arms.length ? ` arm=${b.arms.join('|')}` : ''}`);
  if (verified) lines.push('  已先验冻结集完整性（--verify-frozen）：通过');
  const pairing = comparison.pairing;
  lines.push(
    pairing.known
      ? `  同源同题核对（协议§四）：共同 pid ${pairing.common} / 仅 A ${pairing.onlyA} / 仅 B ${pairing.onlyB}`
      : '  同源同题核对：不可用（预聚合 summary 无 pid）',
  );
  for (const note of compareNotes(comparison, a, b)) lines.push(`  ⚠ ${note}`);
  lines.push('');
  lines.push('| 模式 | A 臂 | B 臂 | B−A（pp） |');
  lines.push('|---|---|---|---|');
  for (const row of comparison.rows) {
    const mark = row.isPrimary ? '**主指标** ' : '';
    const delta =
      row.dropPp == null ? '—' : `${row.dropPp < 0 ? '+' : row.dropPp > 0 ? '-' : ''}${Math.abs(row.dropPp).toFixed(2)}`;
    lines.push(`| ${mark}${row.pattern} | ${fmtRate(row.a)} | ${fmtRate(row.b)} | ${delta} |`);
  }
  lines.push('（主指标一栏 B−A < 0 = B 臂错答放行更低；F1-b 要求下降 ≥10pp）');
  lines.push('');
  const verdictText = decision.decision === 'pass' ? '通过' : decision.decision === 'fail' ? '未通过' : '待样本（不裁决）';
  lines.push(`判定：${verdictText}`);
  for (const reason of decision.reasons) lines.push(`  · ${reason}`);
  lines.push(`  协议§四：结论只在样本量与协议都满足时给；跨纪元（epoch-1 vs epoch-2）数据不得混算`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 模式实现
// ---------------------------------------------------------------------------

function runVerify(opts) {
  const manifest = readManifestFile(opts.frozenDir);
  const result = verifyFrozenSet({
    manifest,
    observed: fsObserved(opts.frozenDir),
    allowExtra: opts.allowExtra,
  });
  if (opts.json) {
    console.log(JSON.stringify({ mode: 'verify', frozenDir: opts.frozenDir, protocol: PROTOCOL_REF, ...result }, null, 2));
  } else {
    console.log(renderVerifyReport(opts.frozenDir, result));
  }
  return result.ok ? EXIT.OK : EXIT.INTEGRITY;
}

function runCompare(opts) {
  // 硬门禁（协议§二.1）：parseArgs 已保证 --verify-frozen 存在；这里仍然复算，确保
  // 「校验通过」不是调用方声称的，而是本次进程实测的。
  const manifest = readManifestFile(opts.frozenDir);
  const check = verifyFrozenSet({ manifest, observed: fsObserved(opts.frozenDir), allowExtra: opts.allowExtra });
  if (!check.ok) {
    console.log(renderVerifyReport(opts.frozenDir, check));
    return EXIT.INTEGRITY;
  }
  const conditionsA = normalizeConditionManifest(readJson(opts.armAConditions), 'A 臂条件清单');
  const conditionsB = normalizeConditionManifest(readJson(opts.armBConditions), 'B 臂条件清单');
  if (opts.judgeVersion && opts.judgeVersion !== conditionsA.judgeVersion) {
    throw new FrozenExamError(
      'USAGE',
      `--judge-version ${opts.judgeVersion} 与 A 臂条件清单的 ${conditionsA.judgeVersion} 不一致`,
    );
  }
  const judgeVersion = opts.judgeVersion || conditionsA.judgeVersion;
  const conditionCheck = compareConditionManifests(conditionsA, conditionsB, {
    minCoverage: opts.minCoverage,
    maxCoverageGap: opts.maxCoverageGap,
  });
  if (!conditionCheck.ok) {
    console.log('对照条件不成立，拒绝判定（协议§二.2）：');
    for (const problem of conditionCheck.problems) console.log(`  · [${problem.code}] ${problem.detail}`);
    return EXIT.USAGE;
  }

  const a = loadArm(opts.armA, { filter: opts.armAFilter, label: 'A 臂', skipUnknown: opts.skipUnknown });
  const b = loadArm(opts.armB, { filter: opts.armBFilter, label: 'B 臂', skipUnknown: opts.skipUnknown });
  const comparison = compareArms(a.aggregate, b.aggregate);
  const decision = decideF1b({
    baseArm: a.aggregate,
    variantArm: b.aggregate,
    minDropPp: opts.minDropPp,
    minPerArm: opts.minPerArm,
  });

  const notes = compareNotes(comparison, a, b);
  const conditions = { a: conditionsA, b: conditionsB, differing: conditionCheck.differing, judgeVersion };
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          mode: 'compare',
          protocol: PROTOCOL_REF,
          judgeVersion,
          frozenVerified: true,
          conditions,
          f1b: decision,
          rows: comparison.rows,
          pairing: comparison.pairing,
          notes,
          arms: {
            a: { label: a.label, source: a.source, arms: a.arms, ...a.aggregate },
            b: { label: b.label, source: b.source, arms: b.arms, ...b.aggregate },
          },
        },
        null,
        2,
      ),
    );
  } else {
    console.log(renderCompareReport({ a, b, comparison, decision, judgeVersion, verified: true }));
    console.log(
      `  条件清单：A ${conditionsA.modelSnapshot} / prompt ${conditionsA.promptHash}` +
        ` ｜ B ${conditionsB.modelSnapshot} / prompt ${conditionsB.promptHash}` +
        ` ｜ 判据 ${judgeVersion}`,
    );
    console.log(
      `  生成参数：temperature=${conditionsA.temperature} topP=${conditionsA.topP} maxTokens=${conditionsA.maxTokens}` +
        ` seed=${conditionsA.seed} k=${conditionsA.k} 覆盖 A=${conditionsA.coverage}/B=${conditionsB.coverage}`,
    );
    console.log(`  处理变量：${conditionCheck.differing.join(' + ')}`);
    if (a.skipped.length || b.skipped.length) {
      console.log(`  已跳过非 verdict json ${a.skipped.length + b.skipped.length} 个（--skip-unknown）`);
    }
  }
  if (opts.out) {
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    fs.writeFileSync(
      opts.out,
      JSON.stringify({ mode: 'compare', protocol: PROTOCOL_REF, judgeVersion, frozenVerified: true, conditions, f1b: decision, rows: comparison.rows, pairing: comparison.pairing, notes, arms: { a: a.aggregate, b: b.aggregate } }, null, 2),
      'utf8',
    );
    console.log(`对照结果已写出：${opts.out}`);
  }

  if (decision.decision === 'pass') return EXIT.OK;
  if (decision.decision === 'undecided') return EXIT.UNDECIDED;
  return EXIT.FAIL;
}

// ---------------------------------------------------------------------------
// 自测（--selftest）：合成夹具，零额度，不读真实冻结集
// ---------------------------------------------------------------------------

function runSelftest() {
  const cases = [];
  const check = (name, fn) => {
    try {
      fn();
      cases.push({ name, ok: true });
    } catch (e) {
      cases.push({ name, ok: false, error: `${e && e.message ? e.message : e}` });
    }
  };

  // --- 口径与结构 ---
  check('ratePct/rateFraction 与 manifest 口径一致', () => {
    assertEq(ratePct(35, 109), 32.11, 'ratePct(35,109)');
    assertEq(rateFraction(35, 109), 0.321, 'rateFraction(35,109)');
    assertEq(rateFraction(7, 16), 0.438, 'rateFraction(7,16)');
    assertEq(rateFraction(9, 35), 0.257, 'rateFraction(9,35)');
    assertEq(ratePct(0, 5), 0, 'ratePct(0,5)');
    assertEq(ratePct(0, 0), null, 'ratePct(0,0) 无样本不是 0');
    assertThrows(() => ratePct(3, 2), 'RATE_INPUT', 'hits>n 应报错');
  });

  check('parseManifest 拒绝非法结构（含 ../ 路径穿越）', () => {
    assertThrows(() => parseManifest({}), 'MANIFEST_SHAPE', '空对象');
    assertThrows(
      () => parseManifest({ batches: [], totals: { judged: 0, wrong: 0, rate: 0 } }),
      'MANIFEST_SHAPE',
      '空 batches',
    );
    const base = {
      batches: [{ id: 'b1', files: 1, judged: 1, wrongAnswerPassed: 0, rate: 0, entries: [entry('ok.json', 'a'.repeat(64), false)] }],
      totals: { judged: 1, wrong: 0, rate: 0 },
    };
    assertThrows(() => parseManifest({ ...base, batches: [{ ...base.batches[0], entries: [{ ...base.batches[0].entries[0], file: '../escape.json' }] }] }), 'MANIFEST_SHAPE', '路径穿越');
    assertThrows(() => parseManifest({ ...base, batches: [{ ...base.batches[0], entries: [{ ...base.batches[0].entries[0], sha256: 'not-hex' }] }] }), 'MANIFEST_SHAPE', 'sha256 非法');
    assertThrows(() => parseManifest({ ...base, batches: [{ ...base.batches[0], entries: [{ ...base.batches[0].entries[0], wrongAnswerPassed: 'yes' }] }] }), 'MANIFEST_SHAPE', '非布尔判定');
    assertThrows(() => parseManifest({ batches: base.batches }), 'MANIFEST_SHAPE', '缺 totals');
  });

  check('computeBaseline 复算真实冻结集三批 → 109/35/0.321', () => {
    const manifest = parseManifest(fixtureManifest(rowsOf([35, 9], [16, 7], [58, 19]), {}));
    const baseline = computeBaseline(manifest);
    assertEq(baseline.judged, 109, 'judged');
    assertEq(baseline.wrong, 35, 'wrong');
    assertEq(baseline.rate, 0.321, 'rate');
    assertEq(baseline.batches.map((b) => b.rate).join(','), '0.257,0.438,0.328', '逐批 rate');
  });

  // --- 冻结集完整性（真实文件 + 临时目录）---
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frozen-exam-selftest-'));
  try {
    const files = { 'b1/a.json': '{"v":1}', 'b1/b.json': '{"v":2}' };
    const manifest = buildOnDiskFixture(tmpRoot, files, ['a.json']);
    const observed = fsObserved(tmpRoot);

    check('verifyFrozenSet：sha256 与基线全符 → ok', () => {
      const res = verifyFrozenSet({ manifest, observed });
      assertEq(res.ok, true, 'ok');
      assertEq(res.checked, 2, 'checked');
      assertEq(res.problems.length, 0, 'problems');
      assertEq(res.baseline.wrong, 1, 'baseline.wrong');
    });

    check('verifyFrozenSet：文件被改 → HASH_MISMATCH（协议§二.1 作废）', () => {
      fs.writeFileSync(path.join(tmpRoot, 'verdicts', 'b1', 'a.json'), '{"v":1,"tampered":true}');
      const res = verifyFrozenSet({ manifest, observed });
      assertEq(res.ok, false, 'ok');
      assertEq(res.problems.map((p) => p.code).join(','), 'HASH_MISMATCH', 'codes');
      assertEq(res.problems[0].scope, 'b1/a.json', 'scope');
      fs.writeFileSync(path.join(tmpRoot, 'verdicts', 'b1', 'a.json'), '{"v":1}');
    });

    check('verifyFrozenSet：文件缺失 → MISSING_FILE', () => {
      fs.rmSync(path.join(tmpRoot, 'verdicts', 'b1', 'b.json'));
      const res = verifyFrozenSet({ manifest, observed });
      assertEq(res.problems.map((p) => p.code).join(','), 'MISSING_FILE', 'codes');
      assertEq(res.checked, 1, 'checked 只数存在的');
      fs.writeFileSync(path.join(tmpRoot, 'verdicts', 'b1', 'b.json'), '{"v":2}');
    });

    check('verifyFrozenSet：出现未登记文件 → EXTRA_FILE，--allow-extra 可放行', () => {
      fs.writeFileSync(path.join(tmpRoot, 'verdicts', 'b1', 'c.json'), '{"v":3}');
      const res = verifyFrozenSet({ manifest, observed });
      assertEq(res.problems.map((p) => p.code).join(','), 'EXTRA_FILE', 'codes');
      assertEq(verifyFrozenSet({ manifest, observed, allowExtra: true }).ok, true, 'allowExtra');
      fs.rmSync(path.join(tmpRoot, 'verdicts', 'b1', 'c.json'));
    });

    check('verifyFrozenSet：manifest 自述基线被改 → MANIFEST_TOTALS_MISMATCH', () => {
      const bad = parseManifest(fixtureManifest(rowsOf([2, 1]), { judged: 2, wrong: 5, rate: 0.5 }));
      const res = verifyFrozenSet({ manifest: bad, observed: fsObserved(tmpRoot) });
      assertEq(res.ok, false, 'ok');
      assertEq(res.problems[0].code, 'MANIFEST_TOTALS_MISMATCH', '首个问题应是基线不符');
      assertEq(res.problems.some((p) => p.code === 'MANIFEST_TOTALS_MISMATCH'), true, '含基线不符');
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  // --- 对照条件清单（协议§二.2）---
  const cond = (over = {}) => ({
    modelSnapshot: 'deepseek-v4.1-flash@2026-10-17',
    promptHash: 'sha256:aaa',
    temperature: 0.7,
    topP: null,
    maxTokens: 64000,
    seed: null,
    k: 1,
    coverage: 1,
    judgeVersion: 'judge-v3',
    ...over,
  });

  check('normalizeConditionManifest：缺字段/非法值拒绝，null 的 topP/seed 合法', () => {
    const ok = normalizeConditionManifest(cond(), 'A');
    assertEq(ok.topP, null, 'topP null 保留');
    assertEq(ok.seed, null, 'seed null 保留');
    const missing = cond();
    delete missing.maxTokens;
    assertThrows(() => normalizeConditionManifest(missing, 'A'), 'CONDITION_SHAPE', '缺 maxTokens');
    assertThrows(() => normalizeConditionManifest(cond({ temperature: 3 }), 'A'), 'CONDITION_SHAPE', '温度越界');
    assertThrows(() => normalizeConditionManifest(cond({ k: 0 }), 'A'), 'CONDITION_SHAPE', 'k 非正');
    assertThrows(() => normalizeConditionManifest(cond({ coverage: 1.2 }), 'A'), 'CONDITION_SHAPE', '覆盖率越界');
    assertThrows(() => normalizeConditionManifest([], 'A'), 'CONDITION_SHAPE', '非对象');
  });

  check('compareConditionManifests：只换 promptHash 是合法处理变量', () => {
    const res = compareConditionManifests(cond(), cond({ promptHash: 'sha256:bbb' }));
    assertEq(res.ok, true, 'ok');
    assertEq(res.differing.join(','), 'promptHash', 'differing');
  });

  check('compareConditionManifests：judgeVersion / 生成参数不一致一律拒绝', () => {
    const judge = compareConditionManifests(cond(), cond({ promptHash: 'b', judgeVersion: 'judge-v2' }));
    assertEq(judge.ok, false, 'judge ok');
    assertEq(judge.problems.map((p) => p.code).join(','), 'JUDGE_VERSION_MISMATCH', 'judge codes');
    const param = compareConditionManifests(cond(), cond({ promptHash: 'b', temperature: 0.2 }));
    assertEq(param.ok, false, 'param ok');
    assertEq(param.problems.map((p) => p.code).join(','), 'PARAM_MISMATCH', 'param codes');
  });

  check('compareConditionManifests：覆盖不足 / 两臂无处理变量拒绝', () => {
    const low = compareConditionManifests(cond({ coverage: 0.9 }), cond({ promptHash: 'b' }));
    assertEq(low.ok, false, 'low ok');
    assertEq(low.problems.some((p) => p.code === 'COVERAGE_BELOW_FLOOR'), true, 'low 含覆盖不足');
    const same = compareConditionManifests(cond(), cond());
    assertEq(same.ok, false, 'same ok');
    assertEq(same.problems.map((p) => p.code).join(','), 'NO_TREATMENT', 'same codes');
  });

  // --- 聚合与判定 ---
  check('normalizeVerdictRecord 拒绝缺模式的 verdict', () => {
    const rec = { pid: 'p1', arm: 'evig1', verdict: { patterns: { progressInflation: false, loopStuck: false } } };
    assertThrows(() => normalizeVerdictRecord(rec, 'x.json'), 'VERDICT_SHAPE', '缺模式');
    const ok = normalizeVerdictRecord({ pid: 'p1', arm: 'evig1', verdict: { patterns: allPatterns(true) } }, 'x.json');
    assertEq(ok.patterns[PRIMARY_PATTERN], true, 'patterns 透传');
  });

  check('aggregateRecords 五模式计数与率', () => {
    const records = [
      recordOf(true, false),
      recordOf(false, false),
      recordOf(true, false),
      recordOf(false, true),
    ];
    const agg = aggregateArm({ records });
    assertEq(agg.n, 4, 'n');
    assertEq(agg.primary.hits, 2, 'primary.hits');
    assertEq(agg.primary.rate, 50, 'primary.rate');
    assertEq(agg.patterns.loopStuck.hits, 1, 'loopStuck.hits');
    assertEq(agg.patterns.loopStuck.rate, 25, 'loopStuck.rate');
    assertEq(agg.primary.pattern, PRIMARY_PATTERN, 'primary.pattern');
  });

  check('预聚合 summary：读取、汇总、混用报错', () => {
    const s = readArmSummary({ arm: 'B', judged: 10, wrong: 2, patterns: { loopStuck: { hits: 3 } } });
    assertEq(s.judged, 10, 'judged');
    assertEq(s.hits[PRIMARY_PATTERN], 2, 'wrong → 主指标');
    assertThrows(() => readArmSummary({ totals: { judged: 1 }, batches: [] }), 'ARM_INPUT_SHAPE', 'manifest 当 summary');
    assertThrows(() => readArmSummary({ judged: 10, wrong: 11 }), 'ARM_INPUT_SHAPE', 'hits>judged');
    const agg = aggregateArm({ summaries: [s, readArmSummary({ judged: 10, wrong: 3 })] });
    assertEq(agg.n, 20, 'n');
    assertEq(agg.primary.hits, 5, 'hits 相加');
    assertEq(agg.primary.rate, 25, 'rate');
    assertEq(agg.patterns.loopStuck.hits, null, '部分 summary 缺该模式 → 不冒充 0');
    assertThrows(
      () => aggregateArm({ records: [recordOf(true, false)], summaries: [s] }),
      'ARM_INPUT_SHAPE',
      '逐条与 summary 混用',
    );
  });

  check('compareArms：主/次指标差值与同源配对统计', () => {
    const a = aggregateArm({ records: [recordOf(true, false, 'p1'), recordOf(true, false, 'p2'), recordOf(false, false, 'p3')] });
    const b = aggregateArm({ records: [recordOf(true, false, 'p1'), recordOf(false, false, 'p2')] });
    const cmp = compareArms(a, b);
    assertEq(cmp.primary.pattern, PRIMARY_PATTERN, 'primary');
    assertEq(cmp.primary.a.rate, 66.67, 'A 主指标率');
    assertEq(cmp.primary.b.rate, 50, 'B 主指标率');
    assertEq(cmp.primary.dropPp, 16.67, 'dropPp');
    assertEq(cmp.pairing.common, 2, 'common');
    assertEq(cmp.pairing.onlyA, 1, 'onlyA');
    assertEq(cmp.pairing.onlyB, 0, 'onlyB');
    const summaryCmp = compareArms(aggregateArm({ summaries: [readArmSummary({ judged: 5, wrong: 1 })] }), b);
    assertEq(summaryCmp.pairing.known, false, 'summary 无 pid → 配对不可用');
  });

  check('decideF1b：样本不足（<35/臂）→ undecided，即便差值很大', () => {
    const d = decideF1b({
      baseArm: aggregateArm({ records: recordsWith(20, 10) }),
      variantArm: aggregateArm({ records: recordsWith(20, 2) }),
    });
    assertEq(d.decision, 'undecided', 'decision');
    assertEq(d.dropPp, 40, 'dropPp');
    assertEq(d.minPerArm, 35, 'minPerArm');
  });

  check('decideF1b：≥35/臂且下降 ≥10pp → pass（含 10.00pp 边界）', () => {
    const pass = decideF1b({
      baseArm: aggregateArm({ records: recordsWith(40, 20) }),
      variantArm: aggregateArm({ records: recordsWith(40, 12) }),
    });
    assertEq(pass.decision, 'pass', '50%→30%');
    assertEq(pass.dropPp, 20, 'dropPp');
    const edge = decideF1b({
      baseArm: aggregateArm({ records: recordsWith(35, 18) }),
      variantArm: aggregateArm({ records: recordsWith(35, 14) }),
    });
    assertEq(edge.decision, 'pass', 'n=35 恰好达标，51.43%→40% = 11.43pp');
  });

  check('decideF1b：样本够但差值不足 → fail；B 更差也 fail', () => {
    const fail = decideF1b({
      baseArm: aggregateArm({ records: recordsWith(40, 20) }),
      variantArm: aggregateArm({ records: recordsWith(40, 18) }),
    });
    assertEq(fail.decision, 'fail', '5pp');
    const worse = decideF1b({
      baseArm: aggregateArm({ records: recordsWith(40, 10) }),
      variantArm: aggregateArm({ records: recordsWith(40, 20) }),
    });
    assertEq(worse.decision, 'fail', 'B 更差');
    assertEq(worse.dropPp, -25, 'dropPp 为负');
  });

  check('parseArgs：模式互斥、缺值、未知参数都报 USAGE', () => {
    assertEq(parseArgs([]).mode, '--verify', '默认 verify');
    const full = ['--compare', '--verify-frozen', '--arm-a', 'a', '--arm-b', 'b', '--arm-a-conditions', 'ca.json', '--arm-b-conditions', 'cb.json'];
    assertEq(parseArgs(full).armB, 'b', '取值解析');
    assertEq(parseArgs(['--min-per-arm', '40']).minPerArm, 40, '阈值可收紧');
    assertEq(parseArgs(['--min-drop-pp', '15']).minDropPp, 15, '差值阈值可收紧');
    assertThrows(() => parseArgs(['--verify', '--selftest']), 'USAGE', '模式互斥');
    assertThrows(() => parseArgs(['--compare', '--arm-a', 'a']), 'USAGE', '缺 arm-b');
    assertThrows(() => parseArgs(full.filter((x) => x !== '--verify-frozen')), 'USAGE', '--compare 必须带 --verify-frozen');
    assertThrows(
      () => parseArgs(full.filter((x) => x !== '--arm-a-conditions' && x !== 'ca.json')),
      'USAGE',
      '--compare 必须带条件清单',
    );
    assertThrows(() => parseArgs(['--frozen-dir']), 'USAGE', '缺取值');
    assertThrows(() => parseArgs(['--nope']), 'USAGE', '未知参数');
    assertThrows(() => parseArgs(['--min-per-arm', '0']), 'USAGE', '非正数');
    assertThrows(() => parseArgs(['--min-per-arm', '10']), 'USAGE', '不得放宽协议底线 35/臂');
    assertThrows(() => parseArgs(['--min-drop-pp', '5']), 'USAGE', '不得放宽协议底线 10pp');
  });

  const failed = cases.filter((c) => !c.ok);
  for (const c of cases) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : ` → ${c.error}`}`);
  if (failed.length === 0) {
    console.log(`SELFTEST PASS ${cases.length}/${cases.length}（合成夹具；未读真实冻结集、未联网、零模型额度）`);
    return EXIT.OK;
  }
  console.log(`SELFTEST FAIL ${failed.length}/${cases.length}`);
  return EXIT.USAGE;
}

// --selftest 专用小工具（放在 CLI 内，保持 core 无 I/O）
function entry(file, sha256, wrongAnswerPassed) {
  return { file, sha256, wrongAnswerPassed };
}
function rowsOf(...pairs) {
  return pairs.map(([n, wrong]) => ({ n, wrong }));
}
function allPatterns(value) {
  const out = {};
  for (const p of PATTERNS) out[p] = value;
  return out;
}
function recordOf(wrongAnswerPassed, loopStuck, pid = null) {
  const patterns = allPatterns(false);
  patterns[PRIMARY_PATTERN] = wrongAnswerPassed;
  patterns.loopStuck = loopStuck;
  return { pid, arm: 'selftest', patterns };
}
function recordsWith(n, wrong) {
  return Array.from({ length: n }, (_, i) => recordOf(i < wrong, false, `pid-${i}`));
}
/** 合成 manifest 结构（sha256 用占位值，仅用于基线与结构用例；文件级校验用 buildOnDiskFixture） */
function fixtureManifest(rows, totalsOverride) {
  const totalJudged = rows.reduce((s, r) => s + r.n, 0);
  const totalWrong = rows.reduce((s, r) => s + r.wrong, 0);
  return {
    frozenAt: '2026-10-19T00:00:00.000Z',
    purpose: 'selftest fixture',
    batches: rows.map((r, i) => ({
      id: `b${i + 1}`,
      source: 'selftest',
      files: r.n,
      judged: r.n,
      wrongAnswerPassed: r.wrong,
      rate: rateFraction(r.wrong, r.n),
      entries: Array.from({ length: r.n }, (_, j) => entry(`f${i + 1}-${j + 1}.json`, 'a'.repeat(64), j < r.wrong)),
    })),
    totals: { judged: totalJudged, wrong: totalWrong, rate: rateFraction(totalWrong, totalJudged), ...totalsOverride },
  };
}
/** 在本地临时目录落一个磁盘夹具，返回带真实 sha256 的 manifest（通过 parseManifest 校验） */
function buildOnDiskFixture(rootDir, files, wrongFiles = []) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(rootDir, 'verdicts', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  const names = Object.keys(files);
  const isWrong = (rel) => wrongFiles.includes(path.basename(rel));
  const sha = (rel) => crypto.createHash('sha256').update(files[rel]).digest('hex');
  const wrong = names.filter(isWrong).length;
  return parseManifest({
    frozenAt: '2026-10-19T00:00:00.000Z',
    purpose: 'selftest fixture',
    batches: [
      {
        id: 'b1',
        source: 'selftest',
        files: names.length,
        judged: names.length,
        wrongAnswerPassed: wrong,
        rate: rateFraction(wrong, names.length),
        entries: names.map((rel) => entry(path.basename(rel), sha(rel), isWrong(rel))),
      },
    ],
    totals: { judged: names.length, wrong, rate: rateFraction(wrong, names.length) },
  });
}
function assertEq(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function assertThrows(fn, code, label) {
  try {
    fn();
  } catch (e) {
    if (e instanceof FrozenExamError && e.code === code) return;
    throw new Error(`${label}: 期望 FrozenExamError(${code})，实际 ${e && e.name}(${e && e.code}): ${e && e.message}`);
  }
  throw new Error(`${label}: 期望抛错 ${code}，但没有抛`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    return EXIT.USAGE;
  }
  if (opts.mode === '--help') {
    console.log(USAGE);
    return EXIT.OK;
  }
  try {
    if (opts.mode === '--selftest') return runSelftest();
    if (opts.mode === '--compare') return runCompare(opts);
    return runVerify(opts);
  } catch (e) {
    const code = e instanceof FrozenExamError ? e.code : 'UNEXPECTED';
    console.error(`✘ ${opts.mode}: ${e && e.message ? e.message : e}`);
    if (code === 'USAGE' || code === 'ARM_INPUT_SHAPE' || code === 'VERDICT_SHAPE') return EXIT.USAGE;
    if (code === 'INTEGRITY' || code === 'MANIFEST_SHAPE') return EXIT.INTEGRITY;
    return EXIT.FATAL;
  }
}

process.exit(main());
