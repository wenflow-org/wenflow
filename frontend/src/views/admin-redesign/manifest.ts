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
}

export const MOCK_SCENES: MockSceneDef[] = [
  { id: 'overview', label: '平台总览', group: '总览', glyph: '览' },
  { id: 'users', label: '用户', group: '学习者', glyph: '人' },
  { id: 'learner-center', label: '学习者中心', group: '学习者', glyph: '习' },
  { id: 'teaching-sessions', label: '教学会话', group: '学习者', glyph: '课' },
  { id: 'goal-conversations', label: '目标对话', group: '学习者', glyph: '标' },
  { id: 'feedback', label: '反馈中心', group: '学习者', glyph: '馈' },
  { id: 'virtual-learners', label: '虚拟学习者', group: '学习者', glyph: '拟' },
  { id: 'skills', label: 'Skill 目录', group: '运行', glyph: '能' },
  { id: 'topology', label: 'Agent 拓扑', group: '运行', glyph: '络' },
  { id: 'orchestrator', label: '编排结构', group: '运行', glyph: '流' },
  { id: 'execution-logs', label: '执行日志', group: '观测', glyph: '志' },
  { id: 'trace-waterfall', label: 'Trace 瀑布', group: '观测', glyph: '溯' },
  { id: 'audit-logs', label: '审计日志', group: '观测', glyph: '审' },
  { id: 'api-config', label: '模型与接入', group: '配置', glyph: '安' },
  { id: 'announcements', label: '公告', group: '配置', glyph: '告' },
  { id: 'addons', label: '外挂能力', group: '配置', glyph: '件' },
  { id: 'session-security', label: '会话安全', group: '配置', glyph: '锁' },
  { id: 'prompt-workbench', label: '核心文件同步', group: '配置', glyph: '台' }
]
