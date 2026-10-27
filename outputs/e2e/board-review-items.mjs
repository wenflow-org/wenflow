/**
 * 白板两态 → 外部盲评项目（figure-out/board-review-items.json）。
 *
 * 每条带该图实际下发时那轮对话（学生问 + 老师答），盲评模型只看图和那一轮对话，
 * 所以提问态要配建板轮，揭晓态要配揭晓轮——两态在同一句话下分别判「泄题」才不会判错。
 *
 * 用法：node outputs/e2e/board-review-items.mjs <run.json> [out=frontend/figure-out/board-review-items.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [runArg, outArg] = process.argv.slice(2);
if (!runArg) throw new Error('用法: board-review-items <run.json> [out.json]');
const runPath = path.resolve(ROOT, runArg);
const outPath = path.resolve(ROOT, outArg || 'frontend/figure-out/board-review-items.json');

const rows = JSON.parse(fs.readFileSync(runPath, 'utf8')).filter((r) => r.fullSpec);
const items = [];
for (const r of rows) {
  const setup = r.turns.find((t) => t.stage !== 'revealed') ?? r.turns[0];
  const reveal = r.turns.find((t) => t.stage === 'revealed') ?? r.turns[0];
  const ctx = (t) => ({ student: t.studentIn, teacher: t.teacher });
  items.push({ id: r.id, state: 'masked', figure: { kind: r.kind, spec: r.maskedSpec }, user: `${r.id}·提问态`, course: r.course, context: ctx(setup) });
  items.push({ id: r.id, state: 'full', figure: { kind: r.kind, spec: r.fullSpec }, user: `${r.id}·揭晓态`, course: r.course, context: ctx(reveal) });
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(items, null, 1), 'utf8');
console.log(`${items.length} 条 → ${outPath}`);
