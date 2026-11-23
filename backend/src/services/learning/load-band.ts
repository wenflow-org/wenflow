/**
 * 回合级认知负荷档位（loadBand）——2026-11-23 P1-5。
 *
 * 为什么不再让模型输出 0-1 浮点：
 * - 回合级的 0.73 / 0.74 没有心理测量意义，只会制造"伪精确"；
 * - 真正被消费的只有四个区间（<0.3 无聊 / 0.3-0.6 正常 / 0.6-0.8 愤悱带 / >0.8 过载），
 *   以及"本轮没有证据"这一状态。
 *
 * 因此模型只输出五档枚举，数值由本模块**唯一**映射；旧会话/旧夹具里的 numeric loadIndex
 * 仍可读取（保持行为不变），新输出以 loadBand 为权威。
 *
 * 关键不变量：`unknown` 只表示「无证据」，映射到 0.5（中性），**永远不落到 under/hint**，
 * 避免把"没看见"误判成"无聊"或"愤悱"。
 */
export type LoadBand = 'under' | 'flow' | 'hint' | 'overload' | 'unknown';

export const LOAD_BANDS: readonly LoadBand[] = ['under', 'flow', 'hint', 'overload', 'unknown'];

/**
 * 档位 → 数值（仅用于兼容既有 numeric 契约；新消费方应优先读档位）。
 * - unknown 必须落 0.5：与 teaching-turn.yaml 的「无证据取 0.5 / loadBasis absent」一致。
 */
export const LOAD_BAND_INDEX: Record<LoadBand, number> = {
  unknown: 0.5,
  under: 0.15,
  flow: 0.45,
  hint: 0.7,
  overload: 0.9,
};

export function isLoadBand(value: unknown): value is LoadBand {
  return typeof value === 'string' && (LOAD_BANDS as readonly string[]).includes(value);
}

/** legacy numeric → 档位（阈值与 teaching-turn.yaml 三路由一致；0.8 本身仍属 hint）。 */
export function loadBandFromIndex(value: unknown): LoadBand {
  const hasValue = typeof value === 'number'
    ? Number.isFinite(value)
    : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
  if (!hasValue) return 'unknown';
  const clamped = Math.max(0, Math.min(1, Number(value)));
  if (clamped < 0.3) return 'under';
  if (clamped < 0.6) return 'flow';
  if (clamped <= 0.8) return 'hint';
  return 'overload';
}

/**
 * 解析模型输出：优先认 loadBand；缺省/非法时回落到 legacy loadIndex 推导；两者都没有 → unknown。
 * 返回值是**权威档位**，调用方据此再决定 numeric（LOAD_BAND_INDEX）与 loadBasis。
 */
export function resolveLoadBand(rawBand: unknown, rawIndex: unknown): LoadBand {
  if (isLoadBand(rawBand)) return rawBand;
  const hasIndex = typeof rawIndex === 'number'
    ? Number.isFinite(rawIndex)
    : typeof rawIndex === 'string' && rawIndex.trim() !== '' && Number.isFinite(Number(rawIndex));
  if (hasIndex) return loadBandFromIndex(rawIndex);
  return 'unknown';
}
