/**
 * 白板两态 → 渲染项目（frontend/figure-out/board-items.json）。
 *
 * 顺序约定（figure-pages / board-demo 都依赖它）：每个案例两条，先提问态、后揭晓态，
 * 文件按 0..5 编号，即 0=masked 1=full，2=masked 3=full…
 *
 * `--renormalize`：把记录下来的**完整板**再过一遍当前的归一化，并按派生规则重出提问态
 * （纯函数、不调模型）。归一化规则修好后（例如 delta 结论上限放宽、标签落点覆盖 at），
 * 用它重放旧运行结果，不必为了一条规则再花一次模型调用；差异全部打印，不静默改内容。
 *
 * 注意：只能重放 fullSpec。提问态是**派生结果**（答案位挖空、副标注撤掉），
 * 直接对 maskedSpec 再归一化会把一排「？」当成重复行合并掉（实测 3 行 → 1 行）。
 *
 * 用法（在 backend 下）：
 *   npx ts-node --transpile-only scripts/board-items.ts ../frontend/figure-out/board-v5.json
 *   npx ts-node --transpile-only scripts/board-items.ts ../frontend/figure-out/board-v5.json ../frontend/figure-out/board-items.json --renormalize
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { normalizeTeachingFigureForProbe } from '../src/skills/teaching-turn';
import { deriveBoardFigure } from '../src/services/ai-teaching/board-state';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const renormalize = process.argv.includes('--renormalize');
const [runArg, outArg] = args;
if (!runArg) throw new Error('用法: board-items <run.json> [out.json] [--renormalize]');

const runPath = resolve(process.cwd(), runArg);
const outPath = resolve(process.cwd(), outArg || '../frontend/figure-out/board-items.json');

type Row = { id: string; kind: string; maskedSpec: unknown; fullSpec: unknown };
const rows = (JSON.parse(readFileSync(runPath, 'utf8')) as Row[]).filter((r) => r.fullSpec);

let changed = 0;
const build = (r: Row) => {
  if (!renormalize) return { kind: r.kind, masked: r.maskedSpec, full: r.fullSpec };
  const out = normalizeTeachingFigureForProbe({ kind: r.kind, spec: r.fullSpec });
  if (!out.figure) {
    console.log(`  [${r.id}] 重放被拒（${out.reason}），保留原 spec`);
    return { kind: r.kind, masked: r.maskedSpec, full: r.fullSpec };
  }
  const board = deriveBoardFigure(out.figure as { kind?: string; spec?: unknown });
  const before = JSON.stringify(r.fullSpec);
  const after = JSON.stringify(board.fullSpec);
  if (before !== after) {
    changed += 1;
    console.log(`  [${r.id}] 揭晓态差异：${before} → ${after}`);
  }
  const maskedBefore = JSON.stringify(r.maskedSpec);
  const maskedAfter = JSON.stringify(board.maskedSpec);
  if (maskedBefore !== maskedAfter) {
    changed += 1;
    console.log(`  [${r.id}] 提问态（派生）差异：${maskedBefore} → ${maskedAfter}`);
  }
  return { kind: board.kind, masked: board.maskedSpec, full: board.fullSpec };
};

const items = rows.flatMap((r) => {
  const b = build(r);
  return [
    { id: r.id, state: 'masked', figure: { kind: b.kind, spec: b.masked } },
    { id: r.id, state: 'full', figure: { kind: b.kind, spec: b.full } },
  ];
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(items, null, 1), 'utf8');
console.log(
  `${items.length} 条（${rows.length} 案例 × 提问/揭晓）→ ${outPath}` +
    (renormalize ? `｜重放改动 ${changed} 处` : ''),
);
