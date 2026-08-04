/**
 * Delta 状态合并器（SKILL_PROTOCOL_V4 §5.4 试验条款）
 *
 * 语义：缺席=不变，null=清空，输出=覆盖（对象深合并、数组替换）。
 * 仅用于 goal-conversation 试点；数组一律替换（append 语义待证据后再引入）。
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DELETE_MARKER: unique symbol = Symbol('delta-delete');

function mergeValue(base: unknown, delta: unknown): unknown {
  if (delta === undefined) return base;
  if (delta === null) return DELETE_MARKER;
  if (Array.isArray(delta)) return delta;
  if (isPlainObject(delta)) {
    const baseObj = isPlainObject(base) ? base : {};
    const out: Record<string, unknown> = { ...baseObj };
    for (const [key, value] of Object.entries(delta)) {
      const merged = mergeValue(baseObj[key], value);
      if (merged === DELETE_MARKER) {
        delete out[key];
      } else {
        out[key] = merged;
      }
    }
    return out;
  }
  return delta;
}

/**
 * 将模型产出的 Delta 增量合并到上一份完整状态：
 * merged = Merge(previous, delta)
 * - delta 中缺席的键保持 previous 原值
 * - delta 中值为 null 的键从结果中删除
 * - 对象深合并，数组与标量整体替换
 */
export function mergeStateDelta<T = Record<string, unknown>>(
  previous: T | undefined | null,
  delta: unknown
): T {
  if (delta === undefined || delta === null) {
    return (isPlainObject(previous) ? { ...(previous as Record<string, unknown>) } : {}) as T;
  }
  const merged = mergeValue(previous ?? {}, delta);
  return (merged === DELETE_MARKER ? {} : merged) as T;
}
