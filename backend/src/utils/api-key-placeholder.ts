/**
 * API Key 占位值识别（#142）。
 *
 * 为什么需要：backend/.env.example 的默认值是文档占位（AI_API_KEY=sk-your-api-key 等）。
 * 首次部署照抄占位值时，旧判据只看「非空」→ 管理端报已配置、/readyz 报 aiConfiguration ok，
 * 但所有真实 LLM 调用 401。部署实例看起来就绪，AI 主链路全不可用。
 *
 * 口径：空串 / 纯空白 / 已知文档占位（及其大小写变体、`replace-with-` 前缀模板）→
 * 按「未配置」处理；真实 key 一律放行，判断不受影响。
 * 边界（诚实声明）：这只识别**文档已知**的占位值，无法识别任意编造的假 key——
 * 那类错误要靠管理端「测试连通性」/ 上游 401 兜底。
 */

/** .env.example 与文档中出现过的占位值（小写归一后比较；只列文档值，不猜测其它形态）。 */
const KNOWN_PLACEHOLDER_KEYS = new Set([
  'sk-your-api-key',
  'sk-your-key',
  'your-api-key',
  'replace-with-your-tinyfish-search-key',
]);

/** `replace-with-` 前缀是 .env.example 注释里约定的模板句式（如 replace-with-xxx）。 */
const PLACEHOLDER_PREFIXES = ['replace-with-', 'sk-your-'];

/**
 * 是否应按「未配置」处理：空串/纯空白/已知占位值 → true。
 * 绝不回传 key 内容；日志侧也只允许写「检测到占位值」，不得输出 key 本身。
 */
export function isPlaceholderApiKey(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return true;
  if (KNOWN_PLACEHOLDER_KEYS.has(normalized)) return true;
  return PLACEHOLDER_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** 与 isPlaceholderApiKey 互为反口：真实 key（非空且非占位）→ true。 */
export function isConfiguredApiKey(value: unknown): boolean {
  return !isPlaceholderApiKey(value);
}
