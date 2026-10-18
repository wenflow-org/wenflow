/**
 * 上游模型清单名 ↔ 平台登记 id 的对齐口径（2026-10-16 用户走查「下面那张卡是干嘛的」）。
 *
 * 背景：接入页签同屏有两份模型名字——上游中转站 `/v1/models` 返回的原始清单（存
 * `platform_api_configs.availableModels`，运行期无人消费），和 `llm-providers.json`
 * 里平台真正登记的模型（档位/限额/降级都按它生效）。两份清单数量不一致又都没说关系，
 * 读起来就像重复。这里只负责「名字对齐」，让两侧能各自说清「登记了几个、上游还剩几个」。
 *
 * 口径：上游常给同一个模型两种写法（`deepseek-v4.1-flash` 与 `deepseek/deepseek-v4.1-flash`
 * 同时存在），故取 `vendor/` 之后的尾段、忽略大小写比对。纯函数，可单测。
 */

/** 名字归一：取最后一个 `/` 之后的尾段、去空白、转小写 */
export function normalizeModelName(name: string): string {
  const s = String(name ?? '').trim()
  if (!s) return ''
  const tail = s.includes('/') ? s.slice(s.lastIndexOf('/') + 1) : s
  return tail.trim().toLowerCase()
}

export interface UpstreamSplit {
  /** 上游清单里能对上登记表的（含 vendor 前缀孪生名） */
  registered: string[]
  /** 上游有、平台没登记——列出来但不参与路由 */
  unregistered: string[]
}

/** 把上游清单按「是否已在平台登记」切开。注册侧 id 同样走归一，两侧同口径。 */
export function splitUpstreamByRegistry(upstream: string[], registeredIds: string[]): UpstreamSplit {
  const registered = new Set(registeredIds.map(normalizeModelName).filter(Boolean))
  const out: UpstreamSplit = { registered: [], unregistered: [] }
  for (const name of upstream) {
    const key = normalizeModelName(name)
    if (key && registered.has(key)) out.registered.push(name)
    else out.unregistered.push(name)
  }
  return out
}
