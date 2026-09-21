/**
 * Admin 控制台：场景清单（侧栏单一数据源）
 *
 * 导航一级收敛（阶段 1，2026-09-19）：低频页折入 tab 宿主，侧栏由 19 项/6 组收敛为 14 项/6 组。
 * - 运营中心（ops-hub）成为 tab 宿主：运营待办 · 反馈 · 成就 · 公告 · 站内通知；
 *   feedback / ops-achievements / messages 场景下线（其 URL 重定向到对应 tab）。
 * - 模型与接入（api-config）成为 tab 宿主：接入与模型 · 外挂能力；addons 场景下线。
 * - 系统工具（ops-center）成为 tab 宿主：运维工具 · 数据导出 · 会话安全；session-security 场景下线。
 * - 记忆与复习（memory-review）由「观测」移入「教学」；Skill 组本阶段保持不变。
 *
 * 阶段 2（2026-09-19）：虚拟学习者独立成组（个体实验 / 规模实验）；
 * 2026-09-22：组名「虚拟实验」→「虚拟学习者」（组名跟随主页面，消除命名错位），
 * 「批量实验」由 virtual-learners 的 tab 提升为独立场景；侧栏 15 项/7 组。
 *
 * 阶段 3（2026-09-19）：健康中心折入「Skill 运行」（skills）宿主 tab：
 * Skill 运行 · 健康检查 · 漂移 · 对账；health-center 场景下线（URL 重定向到 ?tab=health）；
 * 侧栏由 15 项/7 组收敛为 14 项/7 组。
 */

export interface MockSceneDef {
  id: string
  label: string
  group: string
  /** 窄屏（≤860px）折叠为 64px 图标栏时显示的单字图标 */
  glyph: string
  /** 可选静态徽章；live 模式由 Shell 用真实计数覆盖 */
  badge?: string
  /** 置顶独立入口（D5 导航优化）：渲染在分组上方（如平台总览=驾驶舱入口） */
  pinned?: boolean
}

export const MOCK_SCENES: MockSceneDef[] = [
  { id: 'overview', label: '平台总览', group: '总览', glyph: '览', pinned: true },
  // 教学组：真实学习者 / 会话 / 复习（虚拟学习者已独立成组）
  { id: 'people', label: '用户与学习者', group: '教学', glyph: '人' },
  { id: 'sessions', label: '学习会话', group: '教学', glyph: '会' },
  { id: 'memory-review', label: '记忆与复习', group: '教学', glyph: '忆' },
  // 虚拟学习者组：个体实验 / 规模实验
  { id: 'virtual-learners', label: '虚拟学习者', group: '虚拟学习者', glyph: '拟' },
  { id: 'batch-experiments', label: '批量实验', group: '虚拟学习者', glyph: '批' },
  // Skill 组：阶段 3 收敛——健康中心折入「Skill 运行」宿主 tab（?tab=health/drift/recon），
  // 场景下线，Skill 组由 4 项收敛为 3 项（orchestrator · skills · prompt-eval）
  { id: 'orchestrator', label: '编排结构', group: 'Skill', glyph: '流' },
  { id: 'skills', label: 'Skill 运行', group: 'Skill', glyph: '能' },
  { id: 'prompt-eval', label: 'Prompt 评估', group: 'Skill', glyph: '评' },
  // 观测组：Token 成本并入执行日志第三 tab（成本分析）；记忆与复习移出后只剩日志双子页
  { id: 'execution-logs', label: '执行日志', group: '观测', glyph: '志' },
  { id: 'audit-logs', label: '审计日志', group: '观测', glyph: '审' },
  // 系统组：原「配置」组改名；模型与接入成为 tab 宿主（接入与模型 · 外挂能力）；
  // 系统工具成为 tab 宿主（运维工具 · 数据导出 · 会话安全）
  { id: 'api-config', label: '模型与接入', group: '系统', glyph: '安' },
  { id: 'ops-center', label: '系统工具', group: '系统', glyph: '维' },
  // 运营组：运营中心为 tab 宿主（运营待办 · 反馈 · 成就 · 公告 · 站内通知）
  { id: 'ops-hub', label: '运营中心', group: '运营', glyph: '营' }
]
