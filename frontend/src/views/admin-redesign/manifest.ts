/**
 * Admin 控制台：场景清单（侧栏/命令面板单一数据源）
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
  // 学习者组：同域双子视图已合并为单页 tab（2026-09-04 导航收敛拍板）——
  // 用户+学习者中心 → 「用户与学习者」（?tab=account|state）；
  // 教学会话+目标对话（含学习路径）→ 「学习会话」（?tab=teaching|conversations|paths）
  { id: 'people', label: '用户与学习者', group: '学习者', glyph: '人' },
  { id: 'sessions', label: '学习会话', group: '学习者', glyph: '会' },
  { id: 'virtual-learners', label: '虚拟学习者', group: '学习者', glyph: '拟' },
  { id: 'orchestrator', label: '编排结构', group: 'Skill 管理', glyph: '流' },
  { id: 'skills', label: 'Skill 运行', group: 'Skill 管理', glyph: '能' },
  { id: 'prompt-eval', label: 'Prompt 评估', group: 'Skill 管理', glyph: '评' },
  { id: 'health-center', label: '健康中心', group: 'Skill 管理', glyph: '健' },
  // 运营组：运营中心为纯工作台（待办指挥中枢）；成就/反馈为独立页（拆分拍板 2026-09-03）；
  // 公告+站内通知合并为「通知与公告」（2026-09-04；数据层仍独立，页面级 tab 收敛双入口）
  { id: 'ops-hub', label: '运营中心', group: '运营', glyph: '营' },
  { id: 'ops-achievements', label: '成就管理', group: '运营', glyph: '勋' },
  { id: 'feedback', label: '反馈中心', group: '运营', glyph: '馈' },
  { id: 'messages', label: '通知与公告', group: '运营', glyph: '信' },
  // 配置组：原「运维中心」改名「系统工具」并移入配置（与「运营中心」一字之差易混淆，2026-09-04）
  { id: 'api-config', label: '模型与接入', group: '配置', glyph: '安' },
  { id: 'addons', label: '外挂能力', group: '配置', glyph: '件' },
  { id: 'session-security', label: '会话安全', group: '配置', glyph: '锁' },
  { id: 'ops-center', label: '系统工具', group: '配置', glyph: '维' },
  // 观测组：Token 成本并入执行日志第三 tab（成本分析，2026-09-04）
  { id: 'execution-logs', label: '执行日志', group: '观测', glyph: '志' },
  { id: 'audit-logs', label: '审计日志', group: '观测', glyph: '审' }
]
