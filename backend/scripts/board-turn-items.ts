/**
 * 把「每轮实际下发的板面」摊平成渲染项目（frontend/figure-out/board-turn-items.json）。
 *
 * 为什么需要它：减负模式下白板会随老师换例子而刷新（setup → update），
 * 只看运行结果的最终态会丢掉「老师换题、板跟着换」这一段证据。
 *
 * 同一案例里相邻两轮板面完全相同的，只保留第一张（避免重复渲染同一张图）。
 *
 * 用法（在 backend 下）：
 *   npx ts-node --transpile-only scripts/board-turn-items.ts ../frontend/figure-out/board-show2.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deriveBoardFigure, type BoardConcealMode } from '../src/services/ai-teaching/board-state';

type Turn = { n: number; boardOp?: string; boardSpec?: unknown; teacher?: string };
type Row = { id: string; kind: string; mode?: BoardConcealMode; turns: Turn[] };

const [, , runArg, outArg, ...flags] = process.argv;
if (!runArg) throw new Error('用法: board-turn-items <run.json> [out.json] [--all] [--conceal=none|takeaway|full]');
// 默认只保留「板面真变了」的轮次；--all 给盲评用——图文按索引一一对应，条目数必须与轮次数一致
const keepAll = flags.includes('--all');
// --conceal 用同一批板面重出另一种口径，方便「同一堂课、三种藏法」并排比（不调模型）
const concealFlag = flags.find((f) => f.startsWith('--conceal='));
const concealOverride = concealFlag ? (concealFlag.split('=')[1] as BoardConcealMode) : null;
const runPath = resolve(process.cwd(), runArg);
const outPath = resolve(process.cwd(), outArg || '../frontend/figure-out/board-turn-items.json');

const rows = JSON.parse(readFileSync(runPath, 'utf8')) as Row[];
const items: Array<{ case: string; kind: string; turn: number; op: string; figure: unknown }> = [];
for (const r of rows) {
  let last = '';
  for (const t of r.turns) {
    if (!t.boardSpec) continue;
    // 过一遍派生：减负口径会在这里删掉模型自己留的占位行，并打上 placeholder:'none'
    const derived = deriveBoardFigure(
      { kind: r.kind, spec: t.boardSpec },
      { conceal: concealOverride ?? r.mode ?? 'takeaway' },
    );
    const spec = derived.maskedSpec;
    const json = JSON.stringify(spec);
    if (json === last && !keepAll) continue;
    last = json;
    items.push({ case: r.id, kind: r.kind, turn: t.n, op: t.boardOp ?? '', figure: { kind: r.kind, spec } });
  }
}
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(items, null, 1), 'utf8');
console.log(`${items.length} 张（${rows.length} 案例，仅保留板面变化的轮次）→ ${outPath}`);
items.forEach((i) => console.log(`  ${i.case} T${i.turn} ${i.op} ${i.kind}`));
