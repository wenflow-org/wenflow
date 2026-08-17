/**
 * 容错 JSON 解析（带类型参数）。
 * 与各处手写 try/catch + JSON.parse 语义一致：
 * - 空值/非法 JSON 返回 fallback
 * - 解析结果为 falsy（null/0/''/false）时同样返回 fallback（对齐既有 parseJson 行为）
 */
export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (value == null || value === '') return fallback;
  try {
    const parsed: unknown = JSON.parse(value);
    return (parsed || fallback) as T;
  } catch {
    return fallback;
  }
}
