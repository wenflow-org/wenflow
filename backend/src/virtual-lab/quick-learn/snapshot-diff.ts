/**
 * Snapshot Diff 工具
 *
 * Quick Learn Propagation Report 的纯函数 diff 层：
 * 对 Learner Snapshot / Teaching Projection 做字段级对比，
 * 全部确定性计算，不引入任何 AI 判断。
 */

export interface StringSetDiff {
  added: string[];
  removed: string[];
}

export interface MetricsDelta {
  before: Record<string, number | null>;
  after: Record<string, number | null>;
  changed: string[];
}

function toComparableKey(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toLabel(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['label', 'name', 'conceptKey', 'concept', 'title']) {
      if (typeof record[key] === 'string' && record[key]) return record[key] as string;
    }
  }
  return toComparableKey(value).slice(0, 120);
}

/** 数组集合 diff：元素可以是字符串或对象，按内容指纹比较，返回人类可读标签 */
export function diffCollection(before: unknown, after: unknown): StringSetDiff {
  const beforeItems = Array.isArray(before) ? before : [];
  const afterItems = Array.isArray(after) ? after : [];
  const beforeKeys = new Set(beforeItems.map(toComparableKey));
  const afterKeys = new Set(afterItems.map(toComparableKey));
  return {
    added: afterItems.filter((item) => !beforeKeys.has(toComparableKey(item))).map(toLabel),
    removed: beforeItems.filter((item) => !afterKeys.has(toComparableKey(item))).map(toLabel),
  };
}

/** 数值字段 diff：只报告真正变化的字段 */
export function diffMetrics(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  fields: string[]
): MetricsDelta {
  const result: MetricsDelta = { before: {}, after: {}, changed: [] };
  for (const field of fields) {
    const beforeValue = typeof before?.[field] === 'number' ? (before[field] as number) : null;
    const afterValue = typeof after?.[field] === 'number' ? (after[field] as number) : null;
    result.before[field] = beforeValue;
    result.after[field] = afterValue;
    if (beforeValue !== afterValue) result.changed.push(field);
  }
  return result;
}

/** 浅层对象 diff：返回值发生变化的字段名（JSON 语义比较） */
export function changedShallowFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): string[] {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changed: string[] = [];
  for (const key of keys) {
    if (toComparableKey(before?.[key]) !== toComparableKey(after?.[key])) changed.push(key);
  }
  return changed.sort();
}

/** 深层对象按顶层字段 diff：报告哪个顶层字段的内容发生了变化 */
export function changedTopLevelFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): string[] {
  return changedShallowFields(before, after);
}
