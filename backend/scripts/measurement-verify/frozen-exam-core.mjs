/**
 * frozen-exam-core.mjs — 冻结考卷 × 双臂协议（issue #85）的纯函数核心
 *
 * 协议：doc/measurement/FROZEN-EXAM-PROTOCOL-2026-10-18.md
 *   §二.1  每次对照前校验冻结集未变（逐文件 sha256 + 基线），有差异即作废本次对照
 *   §二.3  聚合两臂的 wrongAnswerPassed 与四模式率，产出对照表（含样本量）
 *   §二.4  F1-b：错答放行在 B 臂相对 A 臂下降 ≥10 个百分点且样本量 ≥35/臂 → 通过；
 *          未达样本量只登记不裁决
 *   §四    冻结集只读；两臂同源同题；跨纪元不得混算
 *
 * 设计约束：本模块**无 I/O、无网络、无随机、无时间依赖**——全部输入输出都是纯数据，
 * 因此可以脱离仓库/冻结集在任意环境（含 CI）自测。文件系统与参数解析在
 * ./frozen-exam-run.mjs（CLI）。自测夹具见 CLI 的 --selftest。
 */

/** 判据脚本 ab-class-audit.mjs 的五个模式（verdict.patterns 的键集合，顺序固定） */
export const PATTERNS = Object.freeze([
  'progressInflation',
  'loopStuck',
  'summaryMismatch',
  'wrongAnswerPassed',
  'unclosedComplete',
]);

/** F1-b 主指标（协议§二.4） */
export const PRIMARY_PATTERN = 'wrongAnswerPassed';

/** F1-b 判定阈值（协议§二.4 写明，不由调用方随意放宽） */
export const F1B_DEFAULTS = Object.freeze({ minDropPp: 10, minPerArm: 35 });

/** 进程退出码契约（与 frozen-exam-run.mjs 头部注释同源） */
export const EXIT = Object.freeze({
  OK: 0,
  USAGE: 1,
  INTEGRITY: 2,
  UNDECIDED: 3,
  FAIL: 4,
  FATAL: 5,
});

const HEX64 = /^[0-9a-f]{64}$/;
// 冻结集条目只允许单层文件名：既配合 manifest 的扁平布局，也堵住 ../ 路径穿越
const SAFE_FILE = /^[A-Za-z0-9._-]+$/;

/** 校验/聚合类错误：带稳定 code，便于 CLI 映射退出码与自测断言 */
export class FrozenExamError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FrozenExamError';
    this.code = code;
  }
}

/** 四舍五入到固定小数位（走 toFixed，避开二进制浮点尾数毛刺） */
export function roundTo(value, digits = 3) {
  return Number(Number(value).toFixed(digits));
}

/**
 * 命中率（百分比，2 位小数）。n=0 → null（不是 0：无样本 ≠ 零发生）。
 * hits/n 必须是非负整数且 hits ≤ n，否则抛 RATE_INPUT。
 */
export function ratePct(hits, n) {
  assertCounts(hits, n, 'ratePct');
  if (n === 0) return null;
  return roundTo((hits / n) * 100, 2);
}

/** 命中率（小数，3 位小数）——与 manifest.json 的 batch.rate / totals.rate 同口径 */
export function rateFraction(hits, n) {
  assertCounts(hits, n, 'rateFraction');
  if (n === 0) return null;
  return roundTo(hits / n, 3);
}

function assertCounts(hits, n, what) {
  if (!Number.isInteger(hits) || !Number.isInteger(n) || hits < 0 || n < 0 || hits > n) {
    throw new FrozenExamError('RATE_INPUT', `${what}: 计数非法（hits=${hits}, n=${n}）`);
  }
}

/** sha256 归一化：去空白、转小写；不是 64 位十六进制 → null */
export function normalizeSha256(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return HEX64.test(s) ? s : null;
}

/**
 * 解析并规范化冻结集 manifest（结构非法直接抛 MANIFEST_SHAPE，宁可失败也不半信半疑地聚合）。
 * 返回：{ frozenAt, purpose, batches:[{id, source, declared:{files,judged,wrongAnswerPassed,rate}, entries:[{file,sha256,wrongAnswerPassed}]}], totals }
 */
export function parseManifest(raw) {
  if (!isPlainObject(raw)) throw new FrozenExamError('MANIFEST_SHAPE', 'manifest 必须是 JSON 对象');
  if (!Array.isArray(raw.batches) || raw.batches.length === 0) {
    throw new FrozenExamError('MANIFEST_SHAPE', 'manifest.batches 必须是非空数组');
  }
  const batches = raw.batches.map((batch, i) => {
    const where = `batches[${i}]`;
    if (!isPlainObject(batch)) throw new FrozenExamError('MANIFEST_SHAPE', `${where} 必须是对象`);
    const id = typeof batch.id === 'string' && batch.id.trim() ? batch.id.trim() : null;
    if (!id) throw new FrozenExamError('MANIFEST_SHAPE', `${where}.id 缺失或为空`);
    if (!Array.isArray(batch.entries) || batch.entries.length === 0) {
      throw new FrozenExamError('MANIFEST_SHAPE', `${where}.entries 必须是非空数组`);
    }
    const seen = new Set();
    const entries = batch.entries.map((entry, j) => {
      const w = `${where}.entries[${j}]`;
      if (!isPlainObject(entry)) throw new FrozenExamError('MANIFEST_SHAPE', `${w} 必须是对象`);
      const file = typeof entry.file === 'string' ? entry.file.trim() : '';
      if (!file || !SAFE_FILE.test(file)) {
        throw new FrozenExamError('MANIFEST_SHAPE', `${w}.file 非法（只允许单层文件名）：${JSON.stringify(entry.file)}`);
      }
      if (seen.has(file)) throw new FrozenExamError('MANIFEST_SHAPE', `${w}.file 重复登记：${file}`);
      seen.add(file);
      const sha256 = normalizeSha256(entry.sha256);
      if (!sha256) throw new FrozenExamError('MANIFEST_SHAPE', `${w}.sha256 不是 64 位十六进制：${JSON.stringify(entry.sha256)}`);
      if (typeof entry.wrongAnswerPassed !== 'boolean') {
        throw new FrozenExamError('MANIFEST_SHAPE', `${w}.wrongAnswerPassed 必须是布尔`);
      }
      return { file, sha256, wrongAnswerPassed: entry.wrongAnswerPassed };
    });
    return {
      id,
      source: typeof batch.source === 'string' ? batch.source : null,
      declared: {
        files: batch.files,
        judged: batch.judged,
        wrongAnswerPassed: batch.wrongAnswerPassed,
        rate: batch.rate,
      },
      entries,
    };
  });
  const totals = isPlainObject(raw.totals)
    ? { judged: raw.totals.judged, wrong: raw.totals.wrong, rate: raw.totals.rate }
    : null;
  if (!totals) throw new FrozenExamError('MANIFEST_SHAPE', 'manifest.totals 缺失（基线校验依赖它）');
  return {
    frozenAt: typeof raw.frozenAt === 'string' ? raw.frozenAt : null,
    purpose: typeof raw.purpose === 'string' ? raw.purpose : null,
    batches,
    totals,
  };
}

/**
 * 由 entries 复算基线：逐批与合计的 judged / wrong / rate。
 * 这是与 manifest 自述数字比对的「真值」来源（协议§二.1）。
 */
export function computeBaseline(manifest) {
  const batches = manifest.batches.map((batch) => {
    const judged = batch.entries.length;
    const wrong = batch.entries.filter((e) => e.wrongAnswerPassed === true).length;
    return { id: batch.id, judged, wrong, rate: rateFraction(wrong, judged) };
  });
  const judged = batches.reduce((s, b) => s + b.judged, 0);
  const wrong = batches.reduce((s, b) => s + b.wrong, 0);
  return { judged, wrong, rate: rateFraction(wrong, judged), batches };
}

/**
 * 冻结集完整性校验（协议§二.1）——纯逻辑版：文件系统通过 observed 注入。
 * observed: { listBatchFiles(batchId) -> string[]|null, sha256(batchId, file) -> string|null(文件不存在) }
 *
 * 返回 { ok, problems:[{code, scope, detail}], baseline, checked }
 * code ∈ MANIFEST_TOTALS_MISMATCH | MANIFEST_BATCH_MISMATCH | MISSING_FILE | HASH_MISMATCH | EXTRA_FILE
 * rate 比较留 0.0005 容差：manifest 的 rate 只存 3 位小数，容忍不同四舍五入写法，但错基线仍会被抓。
 */
export function verifyFrozenSet({ manifest, observed, allowExtra = false, rateTolerance = 0.0005 }) {
  const problems = [];
  const add = (code, scope, detail) => problems.push({ code, scope, detail });
  const baseline = computeBaseline(manifest);

  for (const batch of baseline.batches) {
    const declared = manifest.batches.find((b) => b.id === batch.id).declared;
    const mismatches = [];
    if (declared.judged !== batch.judged) mismatches.push(`judged 声明 ${declared.judged}，复算 ${batch.judged}`);
    if (declared.files !== batch.judged) mismatches.push(`files 声明 ${declared.files}，复算 ${batch.judged}`);
    if (declared.wrongAnswerPassed !== batch.wrong) {
      mismatches.push(`wrongAnswerPassed 声明 ${declared.wrongAnswerPassed}，复算 ${batch.wrong}`);
    }
    if (typeof declared.rate !== 'number' || Math.abs(declared.rate - batch.rate) > rateTolerance) {
      mismatches.push(`rate 声明 ${declared.rate}，复算 ${batch.rate}`);
    }
    if (mismatches.length) add('MANIFEST_BATCH_MISMATCH', batch.id, mismatches.join('；'));
  }

  const t = manifest.totals;
  const totalsMismatch = [];
  if (t.judged !== baseline.judged) totalsMismatch.push(`judged 声明 ${t.judged}，复算 ${baseline.judged}`);
  if (t.wrong !== baseline.wrong) totalsMismatch.push(`wrong 声明 ${t.wrong}，复算 ${baseline.wrong}`);
  if (typeof t.rate !== 'number' || Math.abs(t.rate - baseline.rate) > rateTolerance) {
    totalsMismatch.push(`rate 声明 ${t.rate}，复算 ${baseline.rate}`);
  }
  if (totalsMismatch.length) add('MANIFEST_TOTALS_MISMATCH', 'totals', totalsMismatch.join('；'));

  let checked = 0;
  for (const batch of manifest.batches) {
    const listed = new Set(batch.entries.map((e) => e.file));
    for (const entry of batch.entries) {
      const actual = observed.sha256(batch.id, entry.file);
      if (actual == null) {
        add('MISSING_FILE', `${batch.id}/${entry.file}`, 'manifest 登记的文件在冻结集中不存在');
        continue;
      }
      checked += 1;
      if (String(actual).trim().toLowerCase() !== entry.sha256) {
        add('HASH_MISMATCH', `${batch.id}/${entry.file}`, `sha256 期望 ${entry.sha256}，实际 ${String(actual).trim().toLowerCase()}`);
      }
    }
    if (typeof observed.listBatchFiles === 'function') {
      const present = observed.listBatchFiles(batch.id) ?? [];
      for (const file of present) {
        if (listed.has(file)) continue;
        if (allowExtra) continue;
        add('EXTRA_FILE', `${batch.id}/${file}`, '冻结集出现 manifest 未登记的文件（协议§四：冻结集只读）');
      }
    }
  }

  return { ok: problems.length === 0, problems, baseline, checked };
}

/**
 * 规范化一条 verdict 记录（判据脚本产物：{pid, topic, arm, verdict:{ok,patterns,problems}}）。
 * 五个模式必须都是布尔——缺键/非布尔一律抛 VERDICT_SHAPE，避免把口径不一致的产物聚合进去。
 */
export function normalizeVerdictRecord(raw, source = '') {
  if (!isPlainObject(raw)) throw new FrozenExamError('VERDICT_SHAPE', `${source}: 记录不是对象`);
  const patternsRaw = isPlainObject(raw.verdict) ? raw.verdict.patterns : null;
  if (!isPlainObject(patternsRaw)) throw new FrozenExamError('VERDICT_SHAPE', `${source}: 缺少 verdict.patterns`);
  const patterns = {};
  for (const p of PATTERNS) {
    const v = patternsRaw[p];
    if (typeof v !== 'boolean') {
      throw new FrozenExamError('VERDICT_SHAPE', `${source}: verdict.patterns.${p} 不是布尔（判据脚本口径不一致，拒绝聚合）`);
    }
    patterns[p] = v;
  }
  return {
    pid: typeof raw.pid === 'string' && raw.pid ? raw.pid : null,
    arm: typeof raw.arm === 'string' && raw.arm ? raw.arm : null,
    topic: typeof raw.topic === 'string' ? raw.topic : null,
    patterns,
    source,
  };
}

/** 是否是 verdict 形状（供 CLI 区分 verdict / 预聚合 summary / 无关 json） */
export function isVerdictShape(raw) {
  return isPlainObject(raw) && isPlainObject(raw.verdict) && isPlainObject(raw.verdict.patterns);
}

/**
 * 读取「预聚合 summary」（臂结果已被上游聚合成计数时用；本脚本不跑模型，只聚合既有产物）。
 * 形状：{ arm?, judged|n, wrong|wrongAnswerPassed, patterns?: { <key>: hits | {hits} } }
 * 不是 summary 形状 → null；是冻结集 manifest 形状 → 抛 ARM_INPUT_SHAPE（免得把 109 条基线当成一臂）。
 */
export function readArmSummary(raw) {
  if (!isPlainObject(raw) || Array.isArray(raw)) return null;
  if (isPlainObject(raw.totals) && Array.isArray(raw.batches)) {
    throw new FrozenExamError('ARM_INPUT_SHAPE', '输入看起来是冻结集 manifest（totals+batches），不是单臂聚合结果');
  }
  if (isVerdictShape(raw) || Array.isArray(raw.records)) return null;
  const judged = Number.isInteger(raw.judged) ? raw.judged : Number.isInteger(raw.n) ? raw.n : null;
  if (judged == null || judged < 0) return null;
  const hits = {};
  const patternsRaw = isPlainObject(raw.patterns) ? raw.patterns : {};
  for (const p of PATTERNS) {
    const v = patternsRaw[p];
    const h = Number.isInteger(v) ? v : isPlainObject(v) && Number.isInteger(v.hits) ? v.hits : null;
    if (h != null) hits[p] = h;
  }
  const primary = Number.isInteger(raw.wrong)
    ? raw.wrong
    : Number.isInteger(raw.wrongAnswerPassed)
      ? raw.wrongAnswerPassed
      : null;
  if (primary != null) hits[PRIMARY_PATTERN] = primary;
  if (!Number.isInteger(hits[PRIMARY_PATTERN])) {
    throw new FrozenExamError('ARM_INPUT_SHAPE', `summary 缺少主指标 ${PRIMARY_PATTERN} 命中数（wrong 或 wrongAnswerPassed）`);
  }
  for (const [p, h] of Object.entries(hits)) {
    if (h < 0 || h > judged) {
      throw new FrozenExamError('ARM_INPUT_SHAPE', `summary 的 ${p} 命中数 ${h} 超出样本量 ${judged}`);
    }
  }
  return { judged, hits, arm: typeof raw.arm === 'string' && raw.arm ? raw.arm : null };
}

/** 逐条 verdict 聚合：{n, patterns:{<p>:{hits,total,rate}}, primary, pids, pidsKnown} */
export function aggregateRecords(records) {
  const n = records.length;
  const patterns = {};
  for (const p of PATTERNS) {
    const hits = records.filter((r) => r.patterns[p] === true).length;
    patterns[p] = { hits, total: n, rate: ratePct(hits, n) };
  }
  return {
    n,
    patterns,
    primary: { pattern: PRIMARY_PATTERN, ...patterns[PRIMARY_PATTERN] },
    pids: records.map((r) => r.pid).filter(Boolean),
    pidsKnown: true,
  };
}

/** 预聚合 summary 聚合（不填充 pids：只有计数，无法做同源配对检查） */
export function aggregateSummaries(summaries) {
  const n = summaries.reduce((s, x) => s + x.judged, 0);
  const patterns = {};
  for (const p of PATTERNS) {
    let total = null;
    for (const s of summaries) {
      const h = s.hits[p];
      if (!Number.isInteger(h)) {
        total = null;
        break;
      }
      total = (total ?? 0) + h;
    }
    patterns[p] = { hits: total, total: n, rate: total == null ? null : ratePct(total, n) };
  }
  if (patterns[PRIMARY_PATTERN].hits == null) {
    throw new FrozenExamError('ARM_INPUT_SHAPE', `summary 汇总缺少主指标 ${PRIMARY_PATTERN}`);
  }
  return { n, patterns, primary: { pattern: PRIMARY_PATTERN, ...patterns[PRIMARY_PATTERN] }, pids: [], pidsKnown: false };
}

/** 单臂聚合入口：逐条 verdict 与预聚合 summary 不得混用（会重复计数） */
export function aggregateArm({ records = [], summaries = [] }) {
  if (records.length > 0 && summaries.length > 0) {
    throw new FrozenExamError('ARM_INPUT_SHAPE', '同一臂不允许混用逐条 verdict 与预聚合 summary');
  }
  if (records.length > 0) return aggregateRecords(records);
  if (summaries.length > 0) return aggregateSummaries(summaries);
  throw new FrozenExamError('ARM_INPUT_SHAPE', '臂为空：没有可聚合的 verdict 或 summary');
}

/**
 * 两臂对照表（协议§二.3）：主指标 + 四模式率的 A/B 值与差值。
 * dropPp > 0 表示 B 臂问题率更低（改进了）。pairing 供「同源同题」（协议§四）人工核对：
 * 只统计逐条 verdict 提供的 pid；预聚合 summary 无 pid，pairing 标为 unknown。
 */
export function compareArms(a, b) {
  const rows = PATTERNS.map((p) => {
    const ra = a.patterns[p];
    const rb = b.patterns[p];
    return {
      pattern: p,
      isPrimary: p === PRIMARY_PATTERN,
      a: ra,
      b: rb,
      dropPp: ra.rate == null || rb.rate == null ? null : roundTo(ra.rate - rb.rate, 2),
    };
  });
  let pairing = { known: a.pidsKnown && b.pidsKnown, aPids: null, bPids: null, common: null, onlyA: null, onlyB: null };
  if (pairing.known) {
    const setA = new Set(a.pids);
    const setB = new Set(b.pids);
    let common = 0;
    for (const pid of setA) if (setB.has(pid)) common += 1;
    pairing = { known: true, aPids: setA.size, bPids: setB.size, common, onlyA: setA.size - common, onlyB: setB.size - common };
  }
  return { rows, primary: rows.find((r) => r.isPrimary), pairing };
}

/**
 * F1-b 判定（协议§二.4）：B 臂错答放行率相对 A 臂下降 ≥10pp **且** 样本量 ≥35/臂 → pass。
 * 未达样本量只登记不裁决 → undecided（不给 pass/fail，避免小样本拍板）。
 * dropPp = A 率 − B 率（正 = B 更好）；负值意味着 B 更差，同样记 fail。
 */
export function decideF1b({ baseArm, variantArm, minDropPp = F1B_DEFAULTS.minDropPp, minPerArm = F1B_DEFAULTS.minPerArm }) {
  const base = baseArm.primary;
  const variant = variantArm.primary;
  const dropPp = base.rate == null || variant.rate == null ? null : roundTo(base.rate - variant.rate, 2);
  const common = { minDropPp, minPerArm, dropPp, base: { n: base.total, hits: base.hits, rate: base.rate }, variant: { n: variant.total, hits: variant.hits, rate: variant.rate } };

  if (base.total < minPerArm || variant.total < minPerArm) {
    return {
      ...common,
      decision: 'undecided',
      reasons: [
        `样本量不足：A ${base.total}/臂、B ${variant.total}/臂（F1-b 要求 ≥${minPerArm}/臂）`,
        '协议§二.4 + §四：未达样本量只登记不裁决，不凭单批拍板',
      ],
    };
  }
  if (dropPp == null) {
    return { ...common, decision: 'undecided', reasons: ['主指标率不可计算（样本为空）'] };
  }
  if (dropPp >= minDropPp) {
    return {
      ...common,
      decision: 'pass',
      reasons: [
        `B 臂错答放行 ${variant.rate}%（${variant.hits}/${variant.total}）较 A 臂 ${base.rate}%（${base.hits}/${base.total}）下降 ${dropPp}pp ≥ ${minDropPp}pp`,
        `样本量 ${base.total}/${variant.total} 达 ≥${minPerArm}/臂`,
      ],
    };
  }
  return {
    ...common,
    decision: 'fail',
    reasons: [
      `B 臂错答放行 ${variant.rate}%（${variant.hits}/${variant.total}）较 A 臂 ${base.rate}%（${base.hits}/${base.total}）变化 ${dropPp}pp，未达下降 ≥${minDropPp}pp 门槛`,
      `样本量满足 ≥${minPerArm}/臂，按 F1-b 判未通过`,
    ],
  };
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}
