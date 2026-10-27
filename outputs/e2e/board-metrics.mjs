/**
 * 板书改造读数（确定性，不调模型）：同一个脚本跑改造前后两版运行结果，直接对比。
 *
 * 指标：
 *   leak       提问轮泄题（老师说了本该由学生说的内容）
 *   phantom    指着空气（说了板上不存在的行/帧序号）
 *   restate    复述率（回复与板面文字的二元组重合）
 *   conclusion 结论提前上板（板面含 delta/takeaway/note，而本轮正要学生说这句话）
 *   stale      老师上一轮宣布的数据，这一轮板上还没有（板比老师慢）
 *   sceneLag   老师上一轮换了现场（酒精/水银/盐水…），这一轮板上还写着旧现场
 *   slots      提问态空槽数（0 = 减负板）
 *
 * 用法：node outputs/e2e/board-metrics.mjs <run.json> [<run2.json> ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONC_KEYS = ['delta', 'takeaway', 'note'];
const SCENE_TOKENS = ['酒精', '水银', '盐水', '煤油']; // 够用的现场词；只用于「板有没有跟上」，不做语义判断

const numbersOf = (v, depth = 0) => {
  if (depth > 6) return [];
  if (typeof v === 'number') return [String(v)];
  if (typeof v === 'string') return [...v.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(/,/g, ''));
  if (Array.isArray(v)) return v.flatMap((x) => numbersOf(x, depth + 1));
  if (v && typeof v === 'object') return Object.values(v).flatMap((x) => numbersOf(x, depth + 1));
  return [];
};

const hasConclusion = (spec) => !!spec && CONC_KEYS.some((k) => k in spec);

const analyse = (rows) => {
  const out = { samples: rows.length, turns: 0, leak: 0, phantom: 0, restateMax: 0, conclusion: 0, stale: 0, sceneLag: 0, sameTurnNum: 0, sameTurnScene: 0, slots: 0, ops: [] };
  for (const r of rows) {
    out.slots += r.slots ?? 0;
    out.ops.push(`${r.id}:${(r.boardOps || []).join('→')}`);
    let prevTeacher = null;
    r.turns?.forEach((t) => {
      out.turns += 1;
      out.leak += t.audit?.leakHits?.length ?? 0;
      out.phantom += t.audit?.phantomRefs?.length ?? 0;
      out.restateMax = Math.max(out.restateMax, t.audit?.restateRatio ?? 0);
      if (hasConclusion(t.boardSpec)) out.conclusion += 1;
      if (prevTeacher && t.boardSpec) {
        const onBoard = new Set(numbersOf(t.boardSpec));
        const missing = numbersOf(prevTeacher).filter((n) => !onBoard.has(n) && Number(n) > 31);
        if (missing.length) out.stale += 1;
        const boardText = JSON.stringify(t.boardSpec);
        const missingScene = SCENE_TOKENS.filter((s) => prevTeacher.includes(s) && !boardText.includes(s));
        if (missingScene.length) out.sceneLag += 1;
      }
      // 同轮脱节：老师这一轮说出的新数字/新现场，板还停在旧现场。
      // 与 stale 的区别：stale 看上一轮（板应该已经跟上），sameTurn 看本轮（板画在老师说话之前，
      // 只能由「下一轮换板」补偿）——它衡量的是这套时序还剩多少结构性滞后。
      if (t.teacher && t.boardSpec) {
        const boardText = JSON.stringify(t.boardSpec);
        const onBoard = new Set(numbersOf(t.boardSpec));
        const fresh = numbersOf(t.teacher).filter((n) => !onBoard.has(n) && Number(n) > 31);
        const freshScene = SCENE_TOKENS.filter((s) => t.teacher.includes(s) && !boardText.includes(s));
        if (fresh.length) out.sameTurnNum += 1;
        if (freshScene.length) out.sameTurnScene += 1;
      }
      prevTeacher = t.teacher;
    });
  }
  return out;
};

const files = process.argv.slice(2);
if (!files.length) throw new Error('用法: board-metrics <run.json> [<run2.json> ...]');
const reports = files.map((f) => {
  const p = path.resolve(ROOT, f);
  const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { file: path.basename(p), ...analyse(rows) };
});

const header = ['运行', '轮次', '泄题', '指空', '复述max', '结论上板', '板滞后轮', '现场滞后', '同轮脱节数', '同轮脱节现场', '空槽'];
console.log(header.join('\t'));
for (const r of reports) {
  console.log([r.file, r.turns, r.leak, r.phantom, r.restateMax, r.conclusion, r.stale, r.sceneLag, r.sameTurnNum, r.sameTurnScene, r.slots].join('\t'));
}
if (reports.length === 2) {
  const [a, b] = reports;
  const d = (k) => (a[k] === b[k] ? '持平' : b[k] < a[k] ? `↓ ${a[k]}→${b[k]}` : `↑ ${a[k]}→${b[k]}`);
  console.log(`\n改前 → 改后：泄题 ${d('leak')}｜指空 ${d('phantom')}｜复述 ${d('restateMax')}｜结论上板 ${d('conclusion')}｜板滞后 ${d('stale')}｜现场滞后 ${d('sceneLag')}｜同轮脱节数 ${d('sameTurnNum')}｜同轮脱节现场 ${d('sameTurnScene')}`);
}
