/**
 * 常量来源登记表检查（审计 §7 P1-2）：`npm run constants:check`
 *
 * 三道校验：
 *  1. 结构：key 唯一非空、source 合法、标「文献」必须给 ref；
 *  2. 防漂移：`value` 必须等于 `resolve()` 的运行时真值；
 *  3. 防分叉：`mirrors`（同一口径的其它实现）必须与主值相等。
 *
 * 失败即非零退出，已接入 check:quality / CI。
 */
import { SCIENTIFIC_CONSTANTS, summarizeConstantSources, type ScientificConstant } from '../../config/constants-provenance';

export interface Problem {
  key: string;
  detail: string;
}
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return a === b;
}

export function checkConstants(constants: ScientificConstant[]): Problem[] {
  const problems: Problem[] = [];
  const seen = new Set<string>();

  for (const c of constants) {
    if (!c.key || typeof c.key !== 'string') {
      problems.push({ key: String(c.key ?? '(missing)'), detail: 'key 缺失或非字符串' });
      continue;
    }
    if (seen.has(c.key)) {
      problems.push({ key: c.key, detail: 'key 重复' });
    }
    seen.add(c.key);

    if (c.source !== '文献' && c.source !== '工程启发式') {
      problems.push({ key: c.key, detail: `source 非法：${String(c.source)}（只能是 文献 | 工程启发式）` });
    }
    if (c.source === '文献' && !(typeof c.ref === 'string' && c.ref.trim())) {
      problems.push({ key: c.key, detail: 'source=文献 但没给 ref（不许把拍的数伪装成有出处）' });
    }

    let resolved: unknown;
    try {
      resolved = c.resolve();
    } catch (error) {
      problems.push({ key: c.key, detail: `resolve() 抛错：${(error as Error).message}` });
      continue;
    }
    if (!sameValue(c.value, resolved)) {
      problems.push({ key: c.key, detail: `标注漂移：登记 value=${String(c.value)}，运行时=${String(resolved)}` });
    }

    for (const m of c.mirrors ?? []) {
      let mirrored: unknown;
      try {
        mirrored = m.resolve();
      } catch (error) {
        problems.push({ key: c.key, detail: `mirror(${m.where}) 抛错：${(error as Error).message}` });
        continue;
      }
      if (!sameValue(c.value, mirrored)) {
        problems.push({
          key: c.key,
          detail: `同口径分叉：主值=${String(c.value)}，但 ${m.where}=${String(mirrored)}（同一个量写两份，必须合并或对齐）`,
        });
      }
    }
  }

  return problems;
}

export function main() {
  const problems = checkConstants(SCIENTIFIC_CONSTANTS);
  const summary = summarizeConstantSources();

  for (const p of problems) console.error(`✖ [${p.key}] ${p.detail}`);

  console.log(
    `[constants:provenance] 登记 ${summary.total} 项：`
    + `文献 ${summary.bySource['文献']}、工程启发式 ${summary.bySource['工程启发式']}；`
    + `违规=${problems.length}`
  );

  if (problems.length > 0) {
    console.error('[constants:provenance] 常量来源登记未通过（见上）');
    process.exit(1);
  }
}

