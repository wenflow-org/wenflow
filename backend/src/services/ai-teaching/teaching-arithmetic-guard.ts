/**
 * 教学回复算式自检（2026-10-08 内容正确性专项第一刀）。
 *
 * 背景：宽域 A 轨裁判判 3/10 课 P0 知识性错误，其中回乘演示是「明知 728÷26 真实商
 * 非 130 仍用错数据」——算式写错是**可确定性检出**的一类（其余两类：幻觉纠正、条件
 * 讲解混乱，只能靠提示词契约+裁判尺）。本模块只做一件事：从教师回复里抽
 * 「a op b = c」形态的算式并复算，返回不匹配清单。是否重试/打标由调用方（引擎）决定。
 *
 * 精度优先（误报会触发无谓重试）：
 * - 只认 + ＋ × * ÷ / 与「两侧留白的 x/X」；**故意不收 -**（日期 2026-10、区间 3-5 人全是误报源）；
 * - 除法只在「两操作数均为整数且整除」时判定（不整除时 余数表述/四舍五入写法太多样）；
 * - 容差：0.5 绝对 或 0.5% 相对（整数书写的四舍五入、小数截断不算错）；
 * - `≈`/`~` 结尾接等式的跳过（诚实的近似表述）。
 */

export interface ArithmeticMismatch {
  /** 原文匹配到的完整算式（含等号与声称值） */
  expr: string;
  /** 等号后声称的值 */
  stated: number;
  /** 复算得到的值 */
  actual: number;
}

// 单字符紧邻算子（x/X 不在此列——必须两侧留白才视为乘号，见 RE_SPACED_X）
const EXPR_RE = /(\d[\d,，]*(?:\.\d+)?)\s*([+＋×*÷/])\s*(\d[\d,，]*(?:\.\d+)?)\s*[=＝]\s*(-?\d[\d,，]*(?:\.\d+)?)/g;
// 两侧留白的字母乘号：3 x 4 = 12
const EXPR_SPACED_X_RE = /(\d[\d,，]*(?:\.\d+)?)\s+[xX]\s+(\d[\d,，]*(?:\.\d+)?)\s*[=＝]\s*(-?\d[\d,，]*(?:\.\d+)?)/g;
const APPROX_PREFIX_RE = /[≈~～]\s*$/;

function parseNumber(raw: string): number {
  return Number(raw.replace(/[,，]/g, ''));
}

function withinTolerance(stated: number, actual: number): boolean {
  if (Math.abs(stated - actual) <= 0.5) return true;
  const relative = Math.abs(actual) > 0 ? Math.abs(stated - actual) / Math.abs(actual) : Infinity;
  return relative <= 0.005;
}

/** 判定单个「a op b = stated」是否成立；不成立返回 actual，成立/不判定返回 null */
function judgeExpression(a: number, op: string, b: number, stated: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(stated)) return null;
  let actual: number;
  switch (op) {
    case '+':
    case '＋':
      actual = a + b;
      break;
    case '×':
    case 'x':
    case 'X':
    case '*':
      actual = a * b;
      break;
    case '÷':
    case '/':
      if (b === 0) return null;
      if (!Number.isInteger(a) || !Number.isInteger(b) || a % b !== 0) return null;
      actual = a / b;
      break;
    default:
      return null;
  }
  return withinTolerance(stated, actual) ? null : actual;
}

function scan(text: string, re: RegExp, defaultOp?: string): ArithmeticMismatch[] {
  const out: ArithmeticMismatch[] = [];
  for (const match of text.matchAll(re)) {
    const [expr, aRaw, opRaw, bRaw, statedRaw] = defaultOp
      ? [match[0], match[1], defaultOp, match[2], match[3]]
      : [match[0], match[1], match[2], match[3], match[4]];
    // ≈ / ~ 结尾接等式 = 诚实近似，不判
    const index = match.index ?? 0;
    if (APPROX_PREFIX_RE.test(text.slice(Math.max(0, index - 2), index))) continue;
    const actual = judgeExpression(parseNumber(aRaw), opRaw, parseNumber(bRaw), parseNumber(statedRaw));
    if (actual === null) continue;
    out.push({ expr, stated: parseNumber(statedRaw), actual });
  }
  return out;
}

/** 扫描教师回复里的算式，返回计算不匹配清单（原文出现顺序，按算式去重） */
export function findArithmeticMismatches(text: string | null | undefined): ArithmeticMismatch[] {
  const value = String(text ?? '');
  if (!value) return [];
  const merged = [...scan(value, EXPR_RE), ...scan(value, EXPR_SPACED_X_RE, 'x')];
  const seen = new Set<string>();
  return merged.filter((m) => (seen.has(m.expr) ? false : (seen.add(m.expr), true)));
}

/** 把不匹配清单整理成给模型的修复指令正文 */
export function describeMismatchesForRepair(mismatches: ArithmeticMismatch[]): string {
  return mismatches
    .map((m) => `「${m.expr}」——正确结果应为 ${Number.isInteger(m.actual) ? m.actual : m.actual.toFixed(2)}`)
    .join('；');
}
