/**
 * 行内「测试」失败的短判词（2026-11-11 用户评审：只显示「连接失败」没有诊断价值）。
 * 行内只放一个可行动的结论，完整报文仍进 title；不解析上游业务语义，只认确定性信号。
 */
export function testFailureReason(message: string): string {
  const s = String(message || '')
  const code = s.match(/\b(4\d{2}|5\d{2})\b/)
  if (code) return code[1]
  if (/does not exist|not found|no such model|unsupported model|invalid model/i.test(s)) return '无此模型'
  if (/insufficient|quota|欠费|余额|额度/i.test(s)) return '额度不足'
  if (/unauthori[sz]ed|invalid.*key|api.?key|密钥|鉴权/i.test(s)) return 'Key 无效'
  if (/超时|timeout|ETIMEDOUT/i.test(s)) return '超时'
  if (/fetch|network|ECONN|ENOTFOUND|socket|无法连接|连不上/i.test(s)) return '连不上'
  /* 认不出的报文不硬猜：行内只留「连接失败」，完整原文在 title 里 */
  return ''
}
