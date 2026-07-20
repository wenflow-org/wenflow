/**
 * Admin 重设计实验室：场景清单
 * shell 导航 / 状态 chips / 对比路由 共用此单一来源
 */

export interface MockStateDef {
  id: string
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
  states: MockStateDef[]
}

export const MOCK_SCENES: MockSceneDef[] = [
  {
    id: 'overview',
    label: '平台总览',
    group: '总览',
    realRoute: '/admin/dashboard',
    states: [
      { id: 'normal', label: '日常运行', hint: '有活跃有完成' },
      { id: 'incident', label: '需要关注', hint: '异常 + 活跃为 0' },
      { id: 'fresh', label: '全新部署', hint: '一切为 0' }
    ]
  },
  {
    id: 'users',
    label: '用户',
    group: '学习',
    realRoute: '/admin/users',
    states: [
      { id: 'normal', label: '常规', hint: '12 个用户' },
      { id: 'empty', label: '空', hint: '只有管理员' }
    ]
  },
  {
    id: 'learner-center',
    label: '学习者中心',
    group: '学习',
    realRoute: '/admin/learner-center',
    states: [
      { id: 'normal', label: '常规', hint: '趋势各异' },
      { id: 'risk', label: '风险聚集', hint: '多个下降' },
      { id: 'empty', label: '空', hint: '还没快照' }
    ]
  },
  {
    id: 'virtual-learners',
    label: '虚拟学习者',
    group: '学习',
    realRoute: '/admin/virtual-learners',
    badge: '3',
    states: [
      { id: 'normal', label: '实验进行中', hint: '3 个样本' },
      { id: 'empty', label: '空', hint: '还没样本' }
    ]
  },
  {
    id: 'skills',
    label: 'Skill 目录',
    group: '运行',
    realRoute: '/admin/skills',
    badge: '33',
    states: [
      { id: 'normal', label: '常规', hint: '33 个 Skill' },
      { id: 'attention', label: '需关注', hint: '有异常节点' },
      { id: 'empty', label: '空', hint: '全部未调用' }
    ]
  },
  {
    id: 'topology',
    label: 'Agent 拓扑',
    group: '运行',
    realRoute: '/admin/agents/topology',
    states: [
      { id: 'normal', label: '常规', hint: '5 Agent' },
      { id: 'incident', label: '异常', hint: '教学链失败' }
    ]
  },
  {
    id: 'orchestrator',
    label: '编排结构',
    group: '运行',
    realRoute: '/admin/orchestrator-definitions',
    states: [{ id: 'normal', label: '常规', hint: '5 阶段' }]
  },
  {
    id: 'execution-logs',
    label: '执行日志',
    group: '日志',
    realRoute: '/admin/execution-logs',
    states: [
      { id: 'normal', label: '正常流', hint: '稳定输出' },
      { id: 'incident', label: '异常爆发', hint: '连续失败' },
      { id: 'empty', label: '空', hint: '暂无日志' }
    ]
  },
  {
    id: 'event-center',
    label: '事件中心',
    group: '日志',
    realRoute: '/admin/path-generation-events',
    states: [
      { id: 'normal', label: '常规', hint: '流程 + 调用' },
      { id: 'empty', label: '空', hint: '暂无事件' }
    ]
  },
  {
    id: 'api-config',
    label: '连接与安全',
    group: '配置',
    realRoute: '/admin/api-config',
    states: [
      { id: 'ready', label: '已就绪', hint: '全配置完成' },
      { id: 'incomplete', label: '未完成', hint: '缺模型与密钥' }
    ]
  },
  {
    id: 'addons',
    label: '外挂组件',
    group: '配置',
    realRoute: '/admin/skill-model-configs',
    badge: '6',
    states: [
      { id: 'normal', label: '常规', hint: '6 个组件' },
      { id: 'empty', label: '空', hint: '未配置' }
    ]
  },
  {
    id: 'prompt-lab',
    label: 'Prompt Dry Run',
    group: '调试',
    realRoute: '/admin/prompt-lab',
    states: [{ id: 'normal', label: '差异对比', hint: '+12 −4' }]
  }
]
