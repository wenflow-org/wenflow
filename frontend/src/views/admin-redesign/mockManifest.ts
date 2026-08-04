/**
 * Admin 重设计实验室：场景清单
 * 状态全局统一为 normal / incident / fresh（mockStore.labState 驱动，全站一致）
 */

export interface MockStateDef {
  id: 'normal' | 'incident' | 'fresh'
  label: string
  hint: string
}

export interface MockSceneDef {
  id: string
  label: string
  group: string
  /** 对比模式 iframe 加载的现有页面 */
  realRoute: string
  /** 窄屏（≤860px）折叠为 64px 图标栏时显示的单字图标 */
  glyph: string
  /** 可选静态徽章；live 模式由 MockShell 用真实计数覆盖 */
  badge?: string
}

export const GLOBAL_STATES: MockStateDef[] = [
  { id: 'normal', label: '正常', hint: '日常运行' },
  { id: 'incident', label: '异常', hint: '429 限流爆发' },
  { id: 'fresh', label: '空', hint: '全新部署' }
]

export const MOCK_SCENES: MockSceneDef[] = [
  { id: 'overview', label: '平台总览', group: '总览', realRoute: '/admin/console', glyph: '览' },
  { id: 'users', label: '用户', group: '学习者', realRoute: '/admin/console', glyph: '人' },
  { id: 'learner-center', label: '学习者中心', group: '学习者', realRoute: '/admin/console', glyph: '习' },
  { id: 'teaching-sessions', label: '教学会话', group: '学习者', realRoute: '/admin/console', glyph: '课' },
  { id: 'goal-conversations', label: '目标对话', group: '学习者', realRoute: '/admin/console', glyph: '标' },
  { id: 'feedback', label: '反馈中心', group: '学习者', realRoute: '/admin/console', glyph: '馈' },
  { id: 'virtual-learners', label: '虚拟学习者', group: '学习者', realRoute: '/admin/console', glyph: '拟' },
  { id: 'skills', label: 'Skill 目录', group: '运行', realRoute: '/admin/console', glyph: '能' },
  { id: 'topology', label: 'Agent 拓扑', group: '运行', realRoute: '/admin/console', glyph: '络' },
  { id: 'orchestrator', label: '编排结构', group: '运行', realRoute: '/admin/console', glyph: '流' },
  { id: 'execution-logs', label: '执行日志', group: '观测', realRoute: '/admin/console', glyph: '志' },
  { id: 'prompt-call-logs', label: 'Prompt 调用', group: '观测', realRoute: '/admin/console', glyph: '提' },
  { id: 'event-center', label: '事件中心', group: '观测', realRoute: '/admin/console', glyph: '事' },
  { id: 'trace-waterfall', label: 'Trace 瀑布', group: '观测', realRoute: '/admin/console', glyph: '溯' },
  { id: 'api-config', label: '模型与接入', group: '配置', realRoute: '/admin/console', glyph: '安' },
  { id: 'announcements', label: '公告', group: '配置', realRoute: '/admin/console', glyph: '告' },
  { id: 'addons', label: '外挂组件', group: '配置', realRoute: '/admin/console', glyph: '件' },
  { id: 'prompt-workbench', label: '核心文件同步', group: '配置', realRoute: '/admin/console', glyph: '台' }
]
