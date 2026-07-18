<template>
  <div class="admin-page admin-overview">
    <AdminPageHeader
      title="平台运行总览"
      :icon="DataAnalysis"
    >
      <template #actions>
        <el-button @click="refreshAll" :loading="refreshing">
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          ><path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /></svg>
          刷新数据
        </el-button>
      </template>
    </AdminPageHeader>

    <section class="overview-hero-grid">
      <article class="insight-card insight-card--primary">
        <div class="hero-kpi__copy">
          <h2>{{ overviewHeadline.title }}</h2>
        </div>

        <div class="health-list health-list--inline">
          <div class="health-item" :class="healthSummary.successRate.tone">
            <span class="health-item__dot"></span>
            <div>
              <strong>{{ healthSummary.successRate.title }}</strong>
              <p>{{ healthSummary.successRate.description }}</p>
            </div>
          </div>
          <div class="health-item" :class="healthSummary.timeout.tone">
            <span class="health-item__dot"></span>
            <div>
              <strong>{{ healthSummary.timeout.title }}</strong>
              <p>{{ healthSummary.timeout.description }}</p>
            </div>
          </div>
          <div class="health-item" :class="healthSummary.activity.tone">
            <span class="health-item__dot"></span>
            <div>
              <strong>{{ healthSummary.activity.title }}</strong>
              <p>{{ healthSummary.activity.description }}</p>
            </div>
          </div>
        </div>

        <div class="overview-action-bar">
          <router-link to="/admin/execution-logs" class="overview-action-link">排查执行日志</router-link>
          <router-link to="/admin/prompt-call-logs" class="overview-action-link">核对 Prompt 调用</router-link>
          <router-link to="/admin/agents/topology" class="overview-action-link">检查 Agent 拓扑</router-link>
          <router-link to="/admin/learner-center" class="overview-action-link">处理学习者状态</router-link>
        </div>
      </article>
    </section>

    <section class="dashboard-grid">
      <div class="dashboard-main">
        <section class="section panel-card">
          <div class="section-head">
            <div>
              <h3 class="section-title">
                <el-icon><DataAnalysis /></el-icon>
                学习主链
              </h3>
            </div>
          </div>

          <div class="overview-kpi-strip">
            <article v-for="item in overviewKpiItems" :key="item.label" class="overview-kpi-chip">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </article>
          </div>
        </section>

        <section class="section panel-card">
          <div class="section-head">
            <div>
              <h3 class="section-title">
                <el-icon><Cpu /></el-icon>
                待处理事项
              </h3>
            </div>
            <span class="section-note">{{ priorityQueue.length }} 项</span>
          </div>

          <div v-if="priorityQueue.length" class="priority-list">
            <article v-for="item in priorityQueue" :key="item.id" class="priority-card">
              <div class="priority-card__head">
                <div class="priority-card__title-wrap">
                  <span :class="['priority-pill', `is-${item.tone}`]">{{ item.level }}</span>
                  <strong>{{ item.title }}</strong>
                </div>
                <span class="priority-card__meta">{{ item.meta }}</span>
              </div>

              <p class="priority-card__description">{{ item.description }}</p>

              <div class="priority-card__actions">
                <router-link :to="item.primaryTo" class="overview-inline-link">{{ item.primaryLabel }}</router-link>
                <router-link v-if="item.secondaryTo" :to="item.secondaryTo" class="overview-inline-link">{{ item.secondaryLabel }}</router-link>
              </div>
            </article>
          </div>
          <el-empty v-else description="暂无需要立即处理的事项" />
        </section>

        <section class="section panel-card">
          <div class="section-head">
            <div>
              <h3 class="section-title">
                <el-icon><TrendCharts /></el-icon>
                24h 调用概览
              </h3>
            </div>
          </div>

          <div class="trend-summary" v-if="activeTrendPoints.length > 0">
            <article class="trend-summary-card">
              <span>24h 总调用</span>
              <strong>{{ totalTrendCalls }}</strong>
              <em>最近 {{ activeTrendPoints.length }} 个活跃时段</em>
            </article>
            <article class="trend-summary-card">
              <span>整体异常率</span>
              <strong>{{ overallIssueRateLabel }}</strong>
              <em>{{ totalTrendIssues }} 次异常 / 超时</em>
            </article>
            <article class="trend-summary-card">
              <span>调用高峰</span>
              <strong>{{ peakTrendLabel }}</strong>
              <em>{{ peakTrendPoint ? `${peakTrendPoint.total} 次调用` : '暂无数据' }}</em>
            </article>
          </div>

          <div class="trend-panel" v-if="activeTrendPoints.length > 0">
            <div class="trend-row trend-row--head">
              <span class="trend-time">时间</span>
              <span class="trend-bars-label">调用量 / 异常率</span>
              <span class="trend-values">结论</span>
            </div>
            <div class="trend-row" v-for="point in activeTrendPoints" :key="point.time">
              <span class="trend-time">{{ point.label }}</span>
              <div class="trend-bars">
                <div class="trend-bar-track">
                  <div class="trend-bar trend-bar--calls" :style="{ width: `${(point.total / maxCalls) * 100}%` }"></div>
                </div>
                <div class="trend-meta-line">
                  <span>{{ point.total }} 次调用</span>
                  <span :class="['trend-rate-badge', point.issueRate > 0 ? 'is-warning' : 'is-good']">
                    {{ formatRate(point.issueRate) }} 异常率
                  </span>
                </div>
              </div>
              <span class="trend-values">{{ point.summary }}</span>
            </div>
          </div>
          <el-empty v-else description="暂无 24 小时调用趋势数据" />
        </section>
      </div>

      <aside class="dashboard-side">
        <section class="section panel-card">
          <div class="section-head">
            <h3 class="section-title">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="10" /></svg>
              活动记录
            </h3>
            <span class="section-note">最近 {{ recentActivitySummary.length }} 条</span>
          </div>

          <div class="activity-feed" v-if="recentActivitySummary.length > 0">
            <article v-for="activity in recentActivitySummary" :key="activity.id" class="activity-card">
              <div class="activity-card__head">
                <strong>{{ activity.title }}</strong>
                <span>{{ formatTime(activity.createdAt) }}</span>
              </div>
              <p>{{ activity.description }}</p>
            </article>
          </div>
          <el-empty v-else description="暂无最近活动" />
        </section>

        <section class="section panel-card">
          <div class="section-head">
            <h3 class="section-title">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z" /><path d="M9.5 12.5l1.8 1.8 3.7-3.8" /></svg>
              协助许可
            </h3>
            <span class="section-note">活跃 {{ activeProjectionGrantCount }} 份</span>
          </div>

          <div class="activity-feed" v-if="recentProjectionGrantSummary.length > 0">
            <article v-for="grant in recentProjectionGrantSummary" :key="grant.id" class="activity-card">
              <div class="activity-card__head">
                <strong>{{ grant.title }}</strong>
                <span>{{ formatTime(grant.createdAt) }}</span>
              </div>
              <p>{{ grant.description }}</p>
            </article>
          </div>
          <el-empty v-else description="暂无最近协助许可使用记录" />
        </section>
      </aside>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { adminDashboardApi, adminAgentsApi } from '@/api/adminApi'
import { Cpu, TrendCharts, DataAnalysis } from '@element-plus/icons-vue'
import AdminPageHeader from './components/AdminPageHeader.vue'
import { toast } from '../../utils/toast'

interface TrendPoint {
  time?: string
  label?: string
  total?: number
  error?: number
  timeout?: number
  [key: string]: unknown
}

interface AgentStatusItem {
  name?: string
  status?: string
  successRate?: number
  errorCalls?: number
  totalCalls?: number
  avgDuration?: number
  timeoutCalls?: number
  timeouts?: number
  lastActivity?: string
  [key: string]: unknown
}

interface ActivityItem {
  id: string
  type: string
  title: string
  description: string
  createdAt?: string
}

interface ProjectionGrantUse {
  id: string
  adminUser?: { name?: string; [key: string]: unknown }
  user?: { name?: string; [key: string]: unknown }
  scope?: string
  purpose?: string
  useCount?: number
  lastUsedAt?: string
  createdAt?: string
  [key: string]: unknown
}

interface OverviewStats {
  users?: { total?: number; activeToday?: number; [key: string]: unknown }
  learning?: { totalPaths?: number; activePaths?: number; totalTasks?: number; completionRate?: number; completedTasks?: number; [key: string]: unknown }
  conversations?: { total?: number; active?: number; [key: string]: unknown }
  agents?: { last24h?: TrendPoint[]; todayTimeouts?: number; successRate?: number; todayCalls?: number; [key: string]: unknown }
  [key: string]: unknown
}

const stats = ref<OverviewStats>({})
// 服务端概览统计是否可用；不可用时统计区显示 '--'，避免缺省值（0 / 100%）冒充真实统计
const statsAvailable = ref(false)
const agentStatuses = ref<AgentStatusItem[]>([])
const recentActivities = ref<ActivityItem[]>([])
const recentProjectionGrantUses = ref<ProjectionGrantUse[]>([])
const activeProjectionGrantCount = ref(0)
const refreshing = ref(false)

const recentActivitySummary = computed(() => recentActivities.value.slice(0, 5))
const recentProjectionGrantSummary = computed(() => recentProjectionGrantUses.value.slice(0, 5).map((grant) => ({
  id: grant.id,
  title: `${grant.adminUser?.name || '管理员'} 使用了 ${grant.user?.name || '用户'} 的开发视角`,
  description: [
    grant.scope === 'full' ? '完整开发视角' : '学习台视角',
    grant.purpose ? `说明：${grant.purpose}` : '',
    typeof grant.useCount === 'number' ? `累计 ${grant.useCount} 次` : ''
  ].filter(Boolean).join(' · '),
  createdAt: grant.lastUsedAt || grant.createdAt
})))
const overviewKpiItems = computed(() => {
  if (!statsAvailable.value) {
    return ['用户', '今日活跃', 'Goal', '活跃 Goal', '路径', '活跃路径', '任务', '完成率']
      .map((label) => ({ label, value: '--' }))
  }
  const users: NonNullable<OverviewStats['users']> = stats.value?.users || {}
  const learning: NonNullable<OverviewStats['learning']> = stats.value?.learning || {}
  const conversations: NonNullable<OverviewStats['conversations']> = stats.value?.conversations || {}

  return [
    { label: '用户', value: String(users.total || 0) },
    { label: '今日活跃', value: String(users.activeToday || 0) },
    { label: 'Goal', value: String(conversations.total || 0) },
    { label: '活跃 Goal', value: String(conversations.active || 0) },
    { label: '路径', value: String(learning.totalPaths || 0) },
    { label: '活跃路径', value: String(learning.activePaths || 0) },
    { label: '任务', value: String(learning.totalTasks || 0) },
    { label: '完成率', value: `${learning.completionRate || 0}%` }
  ]
})

const trendPoints = computed(() => {
  const points = stats.value?.agents?.last24h || []
  return points
})

const activeTrendPoints = computed(() => {
  return trendPoints.value
    .filter((point) => (point.total || 0) > 0 || (point.error || 0) + (point.timeout || 0) > 0)
    .map((point) => {
      const issueCount = Number(point.error || 0) + Number(point.timeout || 0)
      const total = Number(point.total || 0)
      const issueRate = total > 0 ? issueCount / total : 0

      return {
        ...point,
        total,
        issueCount,
        issueRate,
        summary: issueCount > 0 ? `${issueCount} 次异常/超时` : '运行稳定'
      }
    })
})

const maxCalls = computed(() => {
  const max = activeTrendPoints.value.reduce((acc: number, item) => Math.max(acc, item.total || 0), 0)
  return max > 0 ? max : 1
})

const totalTrendCalls = computed(() => {
  return activeTrendPoints.value.reduce((sum: number, item) => sum + Number(item.total || 0), 0)
})

const totalTrendIssues = computed(() => {
  return activeTrendPoints.value.reduce((sum: number, item) => sum + Number(item.issueCount || 0), 0)
})

const overallIssueRate = computed(() => {
  return totalTrendCalls.value > 0 ? totalTrendIssues.value / totalTrendCalls.value : 0
})

const overallIssueRateLabel = computed(() => formatRate(overallIssueRate.value))

const peakTrendPoint = computed(() => {
  if (!activeTrendPoints.value.length) return null

  return activeTrendPoints.value.reduce<(typeof activeTrendPoints.value)[number] | null>((peak, point) => {
    if (!peak) return point
    return point.total > peak.total ? point : peak
  }, null)
})

const peakTrendLabel = computed(() => {
  return peakTrendPoint.value?.label || '暂无数据'
})

const totalIssueCount = computed(() => {
  const timeoutCount = Number(stats.value?.agents?.todayTimeouts || 0)
  const errorCount = agentStatuses.value.reduce((sum, item) => sum + Number(item.errorCalls || 0), 0)
  return timeoutCount + errorCount
})

const attentionAgentStatuses = computed(() => {
  const items = agentStatuses.value.map((item) => {
    const successRate = Number(item.successRate || 0)
    const errorCalls = Number(item.errorCalls || 0)
    const totalCalls = Number(item.totalCalls || 0)
    const avgDuration = Number(item.avgDuration || 0)
    const timeoutCount = Number(item.timeoutCalls || item.timeouts || 0)
    const severity =
      item.status === 'error'
        ? 3
        : errorCalls > 0 || timeoutCount > 0
          ? 2
          : successRate < 90
            ? 1
            : 0

    let summary = '运行平稳'
    let detail = `成功率 ${successRate}%`

    if (item.status === 'error') {
      summary = '节点状态异常'
      detail = '最近一次执行失败'
    } else if (errorCalls > 0 || timeoutCount > 0) {
      summary = `${errorCalls + timeoutCount} 次失败 / 超时`
      detail = `失败 ${errorCalls} 次，超时 ${timeoutCount} 次。`
    } else if (successRate < 90) {
      summary = '成功率偏低'
      detail = `成功率 ${successRate}%`
    }

    return {
      ...item,
      successRate,
      totalCalls,
      avgDuration,
      errorCalls,
      timeoutCount,
      severity,
      summary,
      detail,
      executionLogsLink: {
        path: '/admin/execution-logs',
        query: item.name ? { agentName: item.name } : undefined
      },
      promptLogsLink: {
        path: '/admin/prompt-call-logs',
        query: item.name ? { agentId: item.name } : undefined
      }
    }
  })

  return items
    .filter((item) => item.severity > 0)
    .sort((a, b) => {
      if (b.severity !== a.severity) return b.severity - a.severity
      if (b.errorCalls !== a.errorCalls) return b.errorCalls - a.errorCalls
      return a.successRate - b.successRate
    })
    .slice(0, 5)
})

const healthSummary = computed(() => {
  if (!statsAvailable.value) {
    const unavailable = { tone: 'is-neutral', title: '统计不可用', description: '概览统计未返回，请刷新重试' }
    return {
      successRate: { ...unavailable },
      timeout: { ...unavailable },
      activity: { ...unavailable }
    }
  }
  const successRate = Number(stats.value?.agents?.successRate || 100)
  const timeouts = Number(stats.value?.agents?.todayTimeouts || 0)
  const activeUsers = Number(stats.value?.users?.activeToday || 0)

  return {
    successRate: {
      tone: successRate >= 90 ? 'is-good' : 'is-warning',
      title: successRate >= 90 ? '成功率稳定' : '成功率需要关注',
      description: `${successRate}% · 今日 ${stats.value?.agents?.todayCalls || 0} 次调用`
    },
    timeout: {
      tone: timeouts === 0 ? 'is-good' : 'is-warning',
      title: timeouts === 0 ? '超时正常' : '存在超时',
      description: `${timeouts} 次超时 · 24h ${totalTrendIssues.value} 次异常`
    },
    activity: {
      tone: activeUsers > 0 ? 'is-neutral' : 'is-warning',
      title: activeUsers > 0 ? '学习侧有活跃' : '学习活跃偏低',
      description: `${activeUsers} 人活跃 · ${stats.value?.learning?.completedTasks || 0} 项完成`
    }
  }
})

const overviewHeadline = computed(() => {
  if (!statsAvailable.value) {
    return {
      title: '平台统计暂不可用'
    }
  }
  const activeUsers = Number(stats.value?.users?.activeToday || 0)
  const successRate = Number(stats.value?.agents?.successRate || 100)
  const issueCount = totalIssueCount.value

  if (issueCount > 0) {
    return {
      title: '调用状态异常'
    }
  }

  if (activeUsers === 0) {
    return {
      title: '学习活跃为 0'
    }
  }

  if (successRate >= 90) {
    return {
      title: '运行平稳'
    }
  }

  return {
    title: '成功率偏低'
  }
})

const priorityQueue = computed(() => {
  const items: Array<{
    id: string
    level: string
    tone: 'danger' | 'warning' | 'info' | 'neutral'
    title: string | undefined
    description: string
    meta: string
    primaryLabel: string
    primaryTo: string | { path: string; query?: Record<string, string> }
    secondaryLabel?: string
    secondaryTo?: string | { path: string; query?: Record<string, string> }
    score: number
  }> = []

  const activeUsers = Number(stats.value?.users?.activeToday || 0)
  const successRate = Number(stats.value?.agents?.successRate || 100)
  const timeoutCount = Number(stats.value?.agents?.todayTimeouts || 0)
  const completedTasks = Number(stats.value?.learning?.completedTasks || 0)

  attentionAgentStatuses.value.forEach((item) => {
    const issueTotal = Number(item.errorCalls || 0) + Number(item.timeoutCount || 0)
    items.push({
      id: `agent-${item.name}`,
      level: item.severity >= 3 ? '高优先级' : '处理中',
      tone: item.severity >= 3 ? 'danger' : 'warning',
      title: getAgentDisplayName(item.name),
      description: item.detail,
      meta: `${formatTime(item.lastActivity)} · 成功率 ${item.successRate}% · ${issueTotal} 次失败/超时`,
      primaryLabel: '排查执行日志',
      primaryTo: item.executionLogsLink,
      secondaryLabel: '核对 Prompt 调用',
      secondaryTo: item.promptLogsLink,
      score: 100 + item.severity * 10 + issueTotal
    })
  })

  if (statsAvailable.value && activeUsers === 0) {
    items.push({
      id: 'learning-activity',
      level: '学习侧关注',
      tone: 'warning',
      title: '今日学习活跃为 0',
      description: '',
      meta: `完成任务 ${completedTasks} 项`,
      primaryLabel: '处理学习者状态',
      primaryTo: '/admin/learner-center',
      secondaryLabel: '启动虚拟学习者',
      secondaryTo: '/admin/virtual-learners',
      score: 85
    })
  }

  if (statsAvailable.value && (timeoutCount > 0 || successRate < 90)) {
    items.push({
      id: 'runtime-trend',
      level: timeoutCount > 0 ? '风险趋势' : '稳定性关注',
      tone: timeoutCount > 0 ? 'danger' : 'warning',
      title: timeoutCount > 0 ? '调用异常仍在发生' : '整体成功率偏低',
      description: timeoutCount > 0
        ? `${timeoutCount} 次超时`
        : `成功率 ${successRate}%`,
      meta: `24h 异常 ${totalTrendIssues.value} 次`,
      primaryLabel: '排查执行日志',
      primaryTo: '/admin/execution-logs',
      secondaryLabel: '检查 Agent 拓扑',
      secondaryTo: '/admin/agents/topology',
      score: timeoutCount > 0 ? 92 : 74
    })
  }

  return items.sort((a, b) => b.score - a.score).slice(0, 5)
})

const refreshAll = async () => {
  refreshing.value = true
  try {
    await Promise.all([loadOverview(), loadAgentStatus(), loadActivity()])
  } finally {
    refreshing.value = false
  }
}

const loadOverview = async () => {
  try {
    const response = await adminDashboardApi.getStats()
    const data = response.data.data || {}
    stats.value = data
    statsAvailable.value = Object.keys(data).length > 0
  } catch (error) {
    stats.value = {}
    statsAvailable.value = false
    console.error('加载概览数据失败:', error)
    toast.error('加载概览数据失败')
  }
}

const loadAgentStatus = async () => {
  try {
    const response = await adminAgentsApi.status()
    agentStatuses.value = response.data.data?.agents || []
  } catch (error) {
    console.error('加载 Agent 状态失败:', error)
  }
}

const loadActivity = async () => {
  try {
    const response = await adminDashboardApi.getActivity(20)
    const data = response.data.data || {}

    const activities: ActivityItem[] = []

    if (data.recentSessions) {
      data.recentSessions.forEach((session: { id: string; task?: { title?: string }; topic?: string; taskId?: string; user?: { name?: string }; users?: { name?: string }; startTime?: string }) => {
        const taskTitle = session.task?.title || session.topic || session.taskId || '未知任务'
        activities.push({
          id: session.id,
          type: 'success',
          title: '学习会话',
          description: `${session.user?.name || session.users?.name || '用户'} 开始了任务 "${taskTitle}"`,
          createdAt: session.startTime
        })
      })
    }

    if (data.recentUsers) {
      data.recentUsers.forEach((user: { id: string; name?: string; email?: string; createdAt?: string }) => {
        activities.push({
          id: user.id,
          type: 'primary',
          title: '新用户注册',
          description: `${user.name || user.email} 加入了平台`,
          createdAt: user.createdAt
        })
      })
    }

    if (data.completedTasks) {
      data.completedTasks.forEach((task: { id: string; user?: { name?: string }; title?: string; completedAt?: string }) => {
        activities.push({
          id: task.id,
          type: 'warning',
          title: '任务完成',
          description: `${task.user?.name || '用户'} 完成了任务 "${task.title}"`,
          createdAt: task.completedAt
        })
      })
    }

    activities.sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
    recentActivities.value = activities.slice(0, 50)
    recentProjectionGrantUses.value = data.recentProjectionGrantUses || []
    activeProjectionGrantCount.value = Number(data.activeProjectionGrantCount || 0)
  } catch (error) {
    console.error('加载活动日志失败:', error)
  }
}

const getAgentDisplayName = (name: string | undefined) => {
  const map: Record<string, string> = {
    RequirementCollection: '需求收集',
    PathPlanning: '路径规划',
    Teaching: '教学执行',
    TeachingOrchestration: '教学编排',
    LearningCompanion: '伴学介入',
    SessionWrapup: '课后产出'
  }

  return map[name || ''] || name
}

const formatTime = (time: string | number | Date | null | undefined) => {
  if (!time) return '暂无数据'
  const date = new Date(time)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  return `${days}天前`
}

const formatRate = (value: number) => {
  return `${(value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0)}%`
}

onMounted(async () => {
  await refreshAll()
})
</script>

<style scoped>
.admin-overview {
  display: grid;
  gap: 16px;
}

.panel-card,
.insight-card {
  border: var(--admin-border);
  border-radius: var(--admin-radius-card);
  background: var(--admin-bg-surface);
  box-shadow: var(--admin-shadow-xs);
}

.overview-hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}

.insight-card {
  padding: 22px 24px;
}

.insight-card--primary {
  display: grid;
  gap: 18px;
}

.hero-kpi__copy {
  display: grid;
  gap: 4px;
}

.hero-kpi__copy h2 {
  margin: 0;
  font-size: 1.35rem;
  color: var(--admin-text-primary);
}

.health-list {
  display: grid;
  gap: 12px;
}

.health-list--inline {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.overview-action-link:hover,
.overview-inline-link:hover {
  border-color: rgba(52, 120, 246, 0.18);
  background: rgba(244, 248, 255, 0.95);
  transform: translateY(-1px);
}

.priority-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 700;
}

.priority-pill.is-info {
  background: var(--admin-color-success-bg);
  color: var(--admin-color-success);
}

.priority-pill.is-warning {
  background: var(--admin-color-warning-bg);
  color: var(--admin-color-warning);
}

.priority-pill.is-danger {
  background: var(--admin-color-error-bg);
  color: var(--admin-color-error);
}

.section-head--embedded {
  margin-bottom: 0;
}

.health-item {
  display: grid;
  grid-template-columns: 12px 1fr;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--admin-radius-card);
  border: var(--admin-border);
  background: var(--admin-bg-surface-alt);
}

.health-item__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: 6px;
  background: var(--admin-text-secondary);
}

.health-item strong {
  color: var(--admin-text-primary);
  font-size: 0.92rem;
}

.health-item p {
  margin: 4px 0 0;
  font-size: 0.84rem;
  color: var(--admin-text-muted);
  line-height: 1.55;
}

.health-item.is-good {
  border-color: var(--admin-color-success-border);
  background: var(--admin-color-success-bg);
}

.health-item.is-good .health-item__dot {
  background: var(--admin-color-success);
}

.health-item.is-warning {
  border-color: var(--admin-color-warning-border);
  background: var(--admin-color-warning-bg);
}

.health-item.is-warning .health-item__dot {
  background: var(--admin-color-warning);
}

.health-item.is-neutral .health-item__dot {
  background: var(--admin-color-info);
}

.overview-action-bar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.overview-action-link,
.overview-inline-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: var(--admin-border);
  background: var(--admin-bg-surface-alt);
  color: var(--admin-text-primary);
  text-decoration: none;
  font-size: 0.84rem;
  font-weight: 600;
  transition: all 180ms ease;
}

.priority-list {
  display: grid;
  gap: 12px;
}

.overview-kpi-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.overview-kpi-chip {
  display: grid;
  gap: 6px;
  padding: 16px;
  border-radius: var(--admin-radius-card);
  border: var(--admin-border);
  background: var(--admin-bg-surface-alt);
}

.overview-kpi-chip span {
  color: var(--admin-text-secondary);
  font-size: 0.78rem;
}

.overview-kpi-chip strong {
  color: var(--admin-text-primary);
  font-size: 1.2rem;
  line-height: 1.1;
}

.priority-card {
  display: grid;
  gap: 10px;
  padding: 16px;
  border-radius: var(--admin-radius-card);
  border: var(--admin-border);
  background: var(--admin-bg-surface-alt);
}

.priority-card__head,
.priority-card__actions,
.priority-card__title-wrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.priority-card__title-wrap {
  justify-content: flex-start;
}

.priority-card__title-wrap strong {
  color: var(--admin-text-primary);
  font-size: 0.94rem;
}

.priority-card__meta,
.priority-card__description {
  color: var(--admin-text-secondary);
  font-size: 0.84rem;
}

.priority-card__description {
  margin: 0;
  line-height: 1.6;
}

.attention-list {
  display: grid;
  gap: 12px;
}

.attention-card {
  display: grid;
  gap: 10px;
  padding: 16px;
  border-radius: var(--admin-radius-card);
  border: var(--admin-border);
  background: var(--admin-bg-surface-alt);
}

.attention-card__head,
.attention-card__meta,
.attention-card__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.attention-card__time,
.attention-card__meta {
  color: var(--admin-text-secondary);
  font-size: 0.8rem;
}

.attention-card__summary {
  display: grid;
  gap: 4px;
}

.attention-card__summary strong {
  color: var(--admin-text-primary);
  font-size: 0.92rem;
}

.attention-card__summary p {
  margin: 0;
  color: var(--admin-text-muted);
  font-size: 0.84rem;
  line-height: 1.55;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(320px, 0.9fr);
  gap: 16px;
  align-items: start;
}

.dashboard-main,
.dashboard-side {
  display: grid;
  gap: 14px;
}

.dashboard-side {
  align-content: start;
}

.section {
  padding: 20px 22px;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.section-head--tight {
  margin-bottom: 12px;
}

.section-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 1.02rem;
  color: var(--admin-text-primary);
}

.section-subtitle {
  margin: 6px 0 0;
  font-size: 0.84rem;
  color: var(--admin-text-secondary);
  line-height: 1.55;
}

.section-link {
  color: var(--admin-color-info);
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
}

.section-note {
  color: var(--admin-text-muted);
  font-size: 0.82rem;
  font-weight: 600;
}

.agent-name {
  display: flex;
  align-items: center;
  gap: 10px;
}

.agent-name-text {
  color: var(--admin-text-primary);
  font-weight: 600;
}

.trend-panel {
  display: grid;
  gap: 2px;
}

.trend-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.trend-summary-card {
  display: grid;
  gap: 6px;
  padding: 16px 18px;
  border-radius: var(--admin-radius-card);
  border: var(--admin-border);
  background: var(--admin-bg-surface-alt);
}

.trend-summary-card span {
  font-size: 0.8rem;
  color: var(--admin-text-secondary);
}

.trend-summary-card strong {
  font-size: 1.5rem;
  line-height: 1.1;
  color: var(--admin-text-primary);
}

.trend-summary-card em {
  font-style: normal;
  font-size: 0.82rem;
  color: var(--admin-text-muted);
}

.trend-row {
  align-items: center;
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) 92px;
  gap: 14px;
  padding: 10px 0;
  border-bottom: var(--admin-border-subtle);
}

.trend-row:last-child {
  border-bottom: none;
}

.trend-row--head {
  padding-top: 0;
  color: var(--admin-text-secondary);
  font-size: 0.75rem;
  font-weight: 700;
}

.trend-time {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.82rem;
  color: var(--admin-text-primary);
}

.trend-bars {
  display: grid;
  gap: 8px;
}

.trend-meta-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--admin-text-muted);
  font-size: 0.8rem;
}

.trend-bar-track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--admin-bg-muted);
}

.trend-bar {
  height: 100%;
  border-radius: inherit;
  min-width: 2px;
  transition: width 0.35s ease;
}

.trend-bar--calls {
  background: linear-gradient(90deg, #3d7cff, #6aa0ff);
}

.trend-bars-label,
.trend-values {
  color: var(--admin-text-muted);
  font-size: 0.82rem;
}

.trend-rate-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 700;
}

.trend-rate-badge.is-good {
  background: var(--admin-color-success-bg);
  color: var(--admin-color-success);
}

.trend-rate-badge.is-warning {
  background: var(--admin-color-warning-bg);
  color: var(--admin-color-warning);
}

.activity-feed {
  display: grid;
  gap: 10px;
}

.activity-card {
  padding: 14px 16px;
  border-radius: var(--admin-radius-card);
  border: var(--admin-border);
  background: var(--admin-bg-surface-alt);
}

.activity-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.activity-card__head strong {
  color: var(--admin-text-primary);
  font-size: 0.92rem;
}

.activity-card__head span {
  color: var(--admin-text-secondary);
  font-size: 0.76rem;
  white-space: nowrap;
}

.activity-card p {
  margin: 0;
  font-size: 0.84rem;
  color: var(--admin-text-secondary);
  line-height: 1.6;
}

@media (max-width: 1280px) {
  .health-list--inline {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .trend-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .overview-kpi-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .overview-hero-grid,
  .dashboard-grid {
    grid-template-columns: 1fr;
  }

}

@media (max-width: 768px) {
  .admin-overview {
    gap: 14px;
  }

  .insight-card,
  .section {
    padding: 16px;
  }

  .health-list--inline,
  .trend-summary {
    grid-template-columns: 1fr;
  }

  .overview-kpi-strip {
    grid-template-columns: 1fr;
  }

  .priority-card__head,
  .priority-card__actions {
    display: grid;
    justify-items: start;
  }

  .trend-row {
    grid-template-columns: 62px minmax(0, 1fr) 72px;
    gap: 10px;
  }
}
</style>
