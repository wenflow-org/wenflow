/**
 * Admin 运营文案统一术语表（阶段 1D 术语治理单源）
 *
 * 单源约定（doc/ADMIN_TERMINOLOGY_AUDIT.md §4）：
 * - 漂移三义：契约漂移（文件↔DB，主叫法「漂移」）/ 哈希漂移（W4，限定「W4 漂移」）/
 *   遥测漂移（运行时，限定「运行时漂移」）——三个概念不得合并文案
 * - 同步族：文件→DB 生效动作统一「同步」（按钮「同步到 DB」）；「保存到编排文件」「发布」「对账」保留
 * - 健康族：独立页「健康中心」（health-center 场景）；编排结构页内嵌区沿用「健康区」；总览「今日成功率」（原「健康分」撞词，改名处理）
 * - 状态族：缺项（禁用「缺声明」）、孤儿（禁用「未路由」）、字段已同步（禁用「fields-synced」英文徽章）
 *
 * 页面关键文案（按钮/面板标题/徽章/提示）必须引用本表；
 * 守卫测试 backend/src/services/__tests__/terminology-guard.test.ts 断言引用与禁用叫法。
 */

export const TERMS = {
  // ---- 漂移族（三义区分，禁止合并） ----
  /** 主叫法：文件↔DB 不一致（字段路由契约维度） */
  driftContract: '漂移',
  /** 限定词：编排契约 ↔ DB 台账 */
  driftContractQualified: '契约漂移',
  /** W4：核心文件 ↔ 编译产物 ↔ DB 三方哈希不一致 */
  driftHash: 'W4 漂移',
  driftHashQualified: '哈希漂移',
  /** 运行时遥测：每次 LLM 调用比对代码侧 prompt 与 DB ACTIVE 发现不一致 */
  driftRuntime: '运行时漂移',
  driftTab: '漂移与审计',
  driftInSync: '已同步',
  driftValueMismatch: '漂移（文件与数据库不一致）',

  // ---- 同步族（文件→DB 生效动作统一「同步」） ----
  syncToDb: '同步到 DB',
  syncDone: '同步完成',
  saveToFile: '保存到编排文件',
  publish: '发布',
  reconcile: '对账',

  // ---- 状态族 ----
  statusMissing: '缺项',
  statusOrphan: '孤儿',
  fieldsSynced: '字段已同步',

  // ---- 健康族 ----
  healthZone: '健康区',
  healthCenter: '健康中心',
  healthScore: '今日成功率',
  healthScoreTitle: '今日调用成功率',

  // ---- 对账族（W1-W5 编码人话；与 backend glossary-content.ts 词条同语义） ----
  /** W1：户口簿活跃技能 ↔ ACTIVE prompt 双向核对 */
  reconActive: 'ACTIVE 对账',
  /** W2：户口簿 ↔ 系统注册表（skill_registrations）双向核对 */
  reconRegistration: '注册对账',
  /** W3：运行时定义执行步骤 ↔ 户口簿 coordinator 声明 */
  reconWiring: '接线对账',
  /** W4：核心文件 ↔ 编译产物 ↔ DB 三方哈希对账 */
  reconHash: '哈希对账',
  /** W5：dataSource 声明三通道校验（db 声明 / sandbox / 例外账） */
  reconDataSource: '数据源声明对账',

  // ---- 生命周期族 ----
  completion: '完成度',
} as const

export type TermsKey = keyof typeof TERMS

// ============================================================
// 错误码中文映射（执行日志/Trace 直出黑话治理；未知码回退原样）
// ============================================================

export const ERROR_CODE_LABELS: Record<string, string> = {
  RETRY_BUDGET_EXHAUSTED: '重试次数已用尽',
  NON_JSON_RESPONSE: '模型响应不是有效 JSON',
  INVALID_JSON_RESPONSE: '模型响应 JSON 解析失败',
  INVALID_RESPONSE_SCHEMA: '模型响应结构不符合声明',
  INVALID_STREAM_RESPONSE: '流式响应无效',
  RATE_LIMITED: '请求过于频繁，已被限流',
  QUOTA_EXHAUSTED: '调用配额已用尽',
  AUTH_INVALID: '模型服务鉴权失败',
  ATTEMPT_TIMEOUT: '请求超时',
  NETWORK_TRANSIENT: '网络暂时不可用',
  NETWORK_POLICY_BLOCKED: '请求被网络策略拦截',
  RESPONSE_BODY_LIMIT_EXCEEDED: '模型响应体超过大小限制',
  CALLER_ABORTED: '调用已中止',
  API_GATEWAY_INTERNAL_ERROR: '网关内部错误',
  CREDENTIAL_DECRYPTION_REQUIRED: '模型服务密钥未配置',
  PROVIDER_CONFIGURATION_ERROR: '模型服务配置错误',
  GENERATION_FAILED: '内容生成失败',
}

/** errorCode → 中文；未知码返回 undefined（调用方回退原样展示） */
export function errorCodeLabel(code?: string): string | undefined {
  if (!code) return undefined
  if (code.startsWith('UPSTREAM_')) return `上游服务异常（HTTP ${code.slice('UPSTREAM_'.length)}）`
  return ERROR_CODE_LABELS[code]
}

// ============================================================
// 网关错误消息人话化（试跑/执行日志/全局 toast 黑话治理单源）
// ============================================================

/**
 * 传输层错误消息 → 中文人话；不匹配返回 undefined（调用方回退原文）。
 * - HTTP 429：一律「请求过于频繁，请稍后重试」（axios 默认 message 与后端限流同义）
 * - "API request failed with status NNN"（网关 executor 原文）→ 上游服务异常（HTTP NNN），
 *   与 errorCodeLabel 的 UPSTREAM_NNN 映射同语义
 */
export function humanizeHttpError(message: string, status?: number): string | undefined {
  if (status === 429) return '请求过于频繁，请稍后重试'
  // axios 默认错误消息（无 response 体时 status 可能缺失）：按文案模式兜底
  if (/^Request failed with status code 429$/.test(String(message || ''))) return '请求过于频繁，请稍后重试'
  const m = /^API request failed with status (\d+)(?::\s|$)/.exec(String(message || ''))
  if (m) return `上游服务异常（HTTP ${m[1]}）`
  return undefined
}
