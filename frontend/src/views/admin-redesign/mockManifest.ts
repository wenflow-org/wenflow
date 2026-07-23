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
  /** 导航徽章（静态演示值） */
  badge?: string
}

export const GLOBAL_STATES: MockStateDef[] = [
  { id: 'normal', label: '正常', hint: '日常运行' },
  { id: 'incident', label: '异常', hint: '429 限流爆发' },
  { id: 'fresh', label: '空', hint: '全新部署' }
]

export const MOCK_SCENES: MockSceneDef[] = [
  { id: 'overview', label: '平台总览', group: '总览', realRoute: '/admin/dashboard' },
  { id: 'users', label: '用户', group: '学习', realRoute: '/admin/users' },
  { id: 'learner-center', label: '学习者中心', group: '学习', realRoute: '/admin/learner-center' },
  { id: 'teaching-sessions', label: '教学会话', group: '学习', realRoute: '/admin/learner-center?tab=sessions' },
  { id: 'virtual-learners', label: '虚拟学习者', group: '学习', realRoute: '/admin/virtual-learners', badge: '3' },
  { id: 'skills', label: 'Skill 目录', group: '运行', realRoute: '/admin/skills', badge: '9' },
  { id: 'topology', label: 'Agent 拓扑', group: '运行', realRoute: '/admin/agents/topology' },
  { id: 'orchestrator', label: '编排结构', group: '运行', realRoute: '/admin/orchestrator-definitions' },
  { id: 'execution-logs', label: '执行日志', group: '日志', realRoute: '/admin/execution-logs' },
  { id: 'prompt-call-logs', label: 'Prompt 调用', group: '日志', realRoute: '/admin/prompt-call-logs' },
  { id: 'event-center', label: '事件中心', group: '日志', realRoute: '/admin/path-generation-events' },
  { id: 'api-config', label: '连接与安全', group: '配置', realRoute: '/admin/api-config' },
  { id: 'announcements', label: '公告', group: '配置', realRoute: '/admin/announcements' },
  { id: 'addons', label: '外挂组件', group: '配置', realRoute: '/admin/skill-model-configs', badge: '6' },
  { id: 'prompt-lab', label: 'Prompt Dry Run', group: '调试', realRoute: '/admin/prompt-lab' }
]
