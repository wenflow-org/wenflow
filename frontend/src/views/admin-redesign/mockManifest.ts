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
  /** 可选静态徽章；live 模式由 MockShell 用真实计数覆盖 */
  badge?: string
}

export const GLOBAL_STATES: MockStateDef[] = [
  { id: 'normal', label: '正常', hint: '日常运行' },
  { id: 'incident', label: '异常', hint: '429 限流爆发' },
  { id: 'fresh', label: '空', hint: '全新部署' }
]

export const MOCK_SCENES: MockSceneDef[] = [
  { id: 'overview', label: '平台总览', group: '总览', realRoute: '/admin/console' },
  { id: 'users', label: '用户', group: '学习', realRoute: '/admin/console' },
  { id: 'learner-center', label: '学习者中心', group: '学习', realRoute: '/admin/console' },
  { id: 'teaching-sessions', label: '教学会话', group: '学习', realRoute: '/admin/console' },
  { id: 'goal-conversations', label: 'Goal 会话', group: '学习', realRoute: '/admin/console' },
  { id: 'feedback', label: '反馈中心', group: '学习', realRoute: '/admin/console' },
  { id: 'virtual-learners', label: '虚拟学习者', group: '学习', realRoute: '/admin/console' },
  { id: 'skills', label: 'Skill 目录', group: '运行', realRoute: '/admin/console' },
  { id: 'topology', label: 'Agent 拓扑', group: '运行', realRoute: '/admin/console' },
  { id: 'orchestrator', label: '编排结构', group: '运行', realRoute: '/admin/console' },
  { id: 'execution-logs', label: '执行日志', group: '日志', realRoute: '/admin/console' },
  { id: 'prompt-call-logs', label: 'Prompt 调用', group: '日志', realRoute: '/admin/console' },
  { id: 'event-center', label: '事件中心', group: '日志', realRoute: '/admin/console' },
  { id: 'trace-waterfall', label: 'Trace 瀑布', group: '日志', realRoute: '/admin/console' },
  { id: 'api-config', label: '连接与安全', group: '配置', realRoute: '/admin/console' },
  { id: 'announcements', label: '公告', group: '配置', realRoute: '/admin/console' },
  { id: 'addons', label: '外挂组件', group: '配置', realRoute: '/admin/console' },
  { id: 'prompt-workbench', label: 'Prompt 工作台', group: '调试', realRoute: '/admin/console' }
]
