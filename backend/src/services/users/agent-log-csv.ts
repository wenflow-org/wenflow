/**
 * 用户侧调用日志 CSV 导出（#251②）。
 *
 * 修复前的三个问题（同一份导出在列表与文件之间两套口径）：
 *   1. 只有 7 列（id/agentId/success/durationMs/tokensUsed/error/calledAt），
 *      列表里的「模型」「折叠条数」在导出里不存在——用户拿 CSV 复核页面数字时对不上；
 *   2. `calledAt` 直接写 Date 对象（`join(',')` 调 toString），导出的是
 *      「Wed Nov 05 2026 10:00:00 GMT+0800 (中国标准时间)」这种本地化长串：
 *      Excel 不认、跨时区不可比、也不是列表/接口使用的口径；
 *   3. 列集合是手写数组，与接口返回的字段名各自演进而无人发现（本模块把列清单
 *      钉在一处，测试锁住「列表字段 → CSV 列」的映射）。
 *
 * 口径：列与 GET /me/agent-logs 的折叠行字段同名，时间一律 ISO 8601（UTC），
 * 空值输出空串，含 `"` `,` CR/LF 的字段按 RFC 4180 双引号转义。
 */

/** CSV 列顺序 = 列表可见列的顺序（id/agent/来源/折叠条数/状态/耗时/Token/模型/错误/时间）。 */
export const AGENT_LOG_CSV_HEADERS = [
  'id',
  'agentId',
  'logSource',
  'groupCount',
  'success',
  'durationMs',
  'tokensUsed',
  'model',
  'error',
  'calledAt',
] as const;

/** 单字段序列化：null/undefined → 空串；Date/时间串 → ISO；其余 String()。 */
function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return String(value);
}

/** RFC 4180 转义：字段含逗号/双引号/换行时整体加引号，内部双引号翻倍。 */
function escapeCsvField(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/**
 * 折叠视图行 → CSV 文本（含表头，CRLF 换行；无数据时只有表头）。
 * @param logs collapseAgentLogGroups 的输出（id/agentId/…/model/groupCount/calledAt）
 */
export function buildAgentLogCsv(logs: Array<Record<string, any>>): string {
  const header = AGENT_LOG_CSV_HEADERS.join(',');
  const rows = logs.map((log) =>
    AGENT_LOG_CSV_HEADERS.map((key) => {
      // 未折叠的普通行没有 groupCount 字段，但它本身就代表一次调用——导出按 1 计，
      // 避免同一列在折叠行/普通行之间「有值 / 空串」两态。
      const value = key === 'groupCount' ? (log?.groupCount ?? 1) : log?.[key];
      return escapeCsvField(formatCsvValue(value));
    }).join(',')
  );
  return [header, ...rows].join('\r\n');
}
