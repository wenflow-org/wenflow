/**
 * 白板评审项目（两种取法）：
 *   --turns  按「每轮实际下发的板面」取（减负模式会换板，每轮都算一条，配该轮对话）
 *   默认     按两态取（提问态 / 揭晓态，各配建板轮与揭晓轮）
 *
 * 盲评模型只看图和那一轮对话，所以配错轮次就会得出「板不对应当前问题」的假结论。
 *
 * 用法：node outputs/e2e/board-review-items.mjs <run.json> [out.json] [--turns]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const turnsMode = process.argv.includes('--turns');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [runArg, outArg] = args;
if (!runArg) throw new Error('用法: board-review-items <run.json> [out.json] [--turns]');
const runPath = path.resolve(ROOT, runArg);
const outPath = path.resolve(ROOT, outArg || 'frontend/figure-out/board-review-items.json');

const rows = JSON.parse(fs.readFileSync(runPath, 'utf8')).filter((r) => r.turns?.length);
const items = [];
for (const r of rows) {
  const ctx = (t) => ({ student: t.studentIn, teacher: t.teacher });
  if (turnsMode) {
    for (const t of r.turns) {
      if (!t.boardSpec) continue;
      items.push({
        id: r.id,
        state: `t${t.n}`,
        figure: { kind: r.kind, spec: t.boardSpec },
        user: `${r.id}·第${t.n}轮`,
        course: r.course,
        context: ctx(t),
      });
    }
    continue;
  }
  if (!r.fullSpec) continue;
  const setup = r.turns.find((t) => t.stage !== 'revealed') ?? r.turns[0];
  const reveal = r.turns.find((t) => t.stage === 'revealed') ?? r.turns[0];
  items.push({ id: r.id, state: 'masked', figure: { kind: r.kind, spec: r.maskedSpec }, user: `${r.id}·提问态`, course: r.course, context: ctx(setup) });
  items.push({ id: r.id, state: 'full', figure: { kind: r.kind, spec: r.fullSpec }, user: `${r.id}·揭晓态`, course: r.course, context: ctx(reveal) });
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(items, null, 1), 'utf8');
console.log(`${items.length} 条（${turnsMode ? '逐轮' : '两态'}）→ ${outPath}`);
console.log(items.map((i) => `  ${i.user} ${i.figure.kind}`).join('\n'));
