<template>
  <div class="admin-overview">
    <section class="page-hero">
      <div class="page-hero__copy">
        <span class="page-hero__eyebrow">Admin Overview</span>
        <h1 class="page-hero__title">平台运行总览</h1>
        <p class="page-hero__subtitle">聚焦今日活跃、Agent 运行健康度与最近平台动态。</p>

        <div class="page-hero__highlights">
          <span class="hero-pill">最近刷新 {{ lastRefreshLabel }}</span>
          <span class="hero-pill">今日调用 {{ stats.agents?.todayCalls || 0 }}</span>
          <span class="hero-pill">24h 异常 {{ totalTrendIssues }}</span>
        </div>
      </div>

      <div class="page-hero__actions">
        <el-button class="page-hero__refresh" @click="refreshAll" :loading="refreshing">
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
      </div>
    </section>

    <section class="summary-grid summary-grid--headline">
      <article class="summary-card summary-card--primary">
        <div class="summary-card__header">
          <span class="summary-card__label">活跃用户</span>
          <span class="summary-card__caption">今日学习活跃</span>
        </div>
        <div class="summary-card__value-row">
          <strong>{{ stats.users?.activeToday || 0 }}</strong>
          <span class="summary-card__hint">{{ stats.users?.activeRate || 0 }}% 活跃率</span>
        </div>
      </article>

      <article class="summary-card summary-card--highlight">
        <div class="summary-card__header">
          <span class="summary-card__label">Agent 成功率</span>
          <span class="summary-card__caption">24h 调用健康</span>
        </div>
        <div class="summary-card__value-row">
          <strong>{{ stats.agents?.successRate || 100 }}%</strong>
          <span class="summary-card__hint">今日调用 {{ stats.agents?.todayCalls || 0 }}</span>
        </div>
      </article>

      <article class="summary-card">
        <div class="summary-card__header">
          <span class="summary-card__label">风险告警</span>
          <span class="summary-card__caption">异常与超时</span>
        </div>
        <div class="summary-card__value-row">
          <strong>{{ totalIssueCount }}</strong>
          <span class="summary-card__hint">今日超时 {{ stats.agents?.todayTimeouts || 0 }} 次</span>
        </div>
      </article>

      <article class="summary-card">
        <div class="summary-card__header">
          <span class="summary-card__label">任务完成</span>
          <span class="summary-card__caption">学习进度</span>
        </div>
        <div class="summary-card__value-row">
          <strong>{{ stats.learning?.completedTasks || 0 }}</strong>
          <span class="summary-card__hint">{{ stats.learning?.completionRate || 0 }}% 完成率</span>
        </div>
      </article>
    </section>

    <section class="insight-grid">
      <article class="insight-card insight-card--primary">
        <div class="hero-kpi__copy">
          <span class="hero-kpi__eyebrow">业务概览</span>
          <h2>{{ overviewHeadline.title }}</h2>
          <p>
            {{ overviewHeadline.description }}
          </p>
        </div>

        <div class="hero-kpi__facts">
          <div class="hero-kpi__fact">
            <span>总用户数</span>
            <strong>{{ stats.users?.total || 0 }}</strong>
            <em>今日新增 {{ stats.users?.newToday || 0 }}</em>
          </div>
          <div class="hero-kpi__fact">
            <span>学习路径</span>
            <strong>{{ stats.learning?.totalPaths || 0 }}</strong>
            <em>{{ stats.learning?.activePaths || 0 }} 条活跃</em>
          </div>
          <div class="hero-kpi__fact">
            <span>目标对话</span>
            <strong>{{ stats.conversations?.total || 0 }}</strong>
            <em>{{ stats.conversations?.active || 0 }} 进行中</em>
          </div>
        </div>
      </article>

      <article class="insight-card insight-card--secondary">
        <div class="section-head section-head--tight">
          <div>
            <h3 class="section-title">运行健康摘要</h3>
            <p class="section-subtitle">把首页重点放在健康度和需要处理的风险上。</p>
          </div>
        </div>

        <div class="health-list">
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
      </article>
    </section>

    <section class="dashboard-grid">
      <div class="dashboard-main">
        <section class="section panel-card">
          <div class="section-head">
            <div>
              <h3 class="section-title">
                <el-icon><Cpu /></el-icon>
                Agent / 编排器 运行状态
              </h3>
              <p class="section-subtitle">聚焦成功率、平均耗时与最近活跃时间，首页仅保留核心观测信息。</p>
            </div>
          </div>

          <el-table :data="agentStatuses" stripe class="agent-status-table">
            <el-table-column prop="name" label="Agent" min-width="180">
              <template #default="{ row }">
                <div class="agent-name">
                  <el-tag :type="getAgentTagType(row.status)" size="small" class="agent-tag">
                    {{ row.status }}
                  </el-tag>
                  <span class="agent-name-text">{{ getAgentDisplayName(row.name) }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="successRate" label="成功率" width="170">
              <template #default="{ row }">
                <div class="table-progress-cell">
                  <el-progress
                    :percentage="parseFloat(row.successRate)"
                    :status="parseFloat(row.successRate) >= 90 ? 'success' : 'warning'"
                  />
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="avgDuration" label="平均耗时" width="120" align="center">
              <template #default="{ row }">
                {{ row.avgDuration }}ms
              </template>
            </el-table-column>
            <el-table-column prop="totalCalls" label="总调用" width="96" align="center" />
            <el-table-column label="成功 / 失败" width="120" align="center">
              <template #default="{ row }">
                <div class="call-metrics">
                  <span class="success-count">{{ row.successCalls }}</span>
                  <span class="call-metrics__divider">/</span>
                  <span class="error-count">{{ row.errorCalls }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="lastActivity" label="最后活跃" width="140">
              <template #default="{ row }">
                {{ formatTime(row.lastActivity) }}
              </template>
            </el-table-column>
          </el-table>
        </section>

        <section class="section panel-card">
          <div class="section-head">
            <div>
              <h3 class="section-title">
                <el-icon><TrendCharts /></el-icon>
                最近 24 小时调用概览
              </h3>
              <p class="section-subtitle">聚焦调用高峰、异常率与最近活跃时段，给首页一个更清晰的运行结论。</p>
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
              最近活动
            </h3>
            <router-link class="section-link" to="/admin/activity-stream">查看全部活动</router-link>
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
      </aside>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { adminDashboardApi, adminAgentsApi } from '@/api/adminApi'
import { Cpu, TrendCharts } from '@element-plus/icons-vue'
import { toast } from '../../utils/toast'

const stats = ref<any>({})
const agentStatuses = ref<any[]>([])
const recentActivities = ref<any[]>([])
const refreshing = ref(false)
const lastRefreshAt = ref<Date | null>(null)

const recentActivitySummary = computed(() => recentActivities.value.slice(0, 5))

const trendPoints = computed(() => {
  const points = stats.value?.agents?.last24h || []
  return points.slice(-12)
})

const activeTrendPoints = computed(() => {
  return trendPoints.value
    .filter((point: any) => (point.total || 0) > 0 || (point.error || 0) + (point.timeout || 0) > 0)
    .map((point: any) => {
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
  const max = activeTrendPoints.value.reduce((acc: number, item: any) => Math.max(acc, item.total || 0), 0)
  return max > 0 ? max : 1
})

const totalTrendCalls = computed(() => {
  return activeTrendPoints.value.reduce((sum: number, item: any) => sum + Number(item.total || 0), 0)
})

const totalTrendIssues = computed(() => {
  return activeTrendPoints.value.reduce((sum: number, item: any) => sum + Number(item.issueCount || 0), 0)
})

const overallIssueRate = computed(() => {
  return totalTrendCalls.value > 0 ? totalTrendIssues.value / totalTrendCalls.value : 0
})

const overallIssueRateLabel = computed(() => formatRate(overallIssueRate.value))

const peakTrendPoint = computed(() => {
  if (!activeTrendPoints.value.length) return null

  return activeTrendPoints.value.reduce((peak: any, point: any) => {
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

const latestAgentActivityLabel = computed(() => {
  const times = agentStatuses.value
    .map((item) => item.lastActivity)
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())

  if (!times.length) return '暂无数据'
  return formatTime(times[0])
})

const lastRefreshLabel = computed(() => {
  if (!lastRefreshAt.value) return '尚未刷新'
  return formatTime(lastRefreshAt.value)
})

const healthSummary = computed(() => {
  const successRate = Number(stats.value?.agents?.successRate || 100)
  const timeouts = Number(stats.value?.agents?.todayTimeouts || 0)
  const activeUsers = Number(stats.value?.users?.activeToday || 0)

  return {
    successRate: {
      tone: successRate >= 90 ? 'is-good' : 'is-warning',
      title: successRate >= 90 ? '成功率稳定' : '成功率需要关注',
      description: `当前 Agent 成功率 ${successRate}%`
    },
    timeout: {
      tone: timeouts === 0 ? 'is-good' : 'is-warning',
      title: timeouts === 0 ? '暂无超时告警' : '存在超时调用',
      description: `今日超时 ${timeouts} 次`
    },
    activity: {
      tone: activeUsers > 0 ? 'is-neutral' : 'is-warning',
      title: activeUsers > 0 ? '今日有学习活跃' : '学习活跃偏低',
      description: `当前活跃学习用户 ${activeUsers} 人`
    }
  }
})

const overviewHeadline = computed(() => {
  const activeUsers = Number(stats.value?.users?.activeToday || 0)
  const successRate = Number(stats.value?.agents?.successRate || 100)
  const issueCount = totalIssueCount.value

  if (issueCount > 0) {
    return {
      title: '今天平台整体可用，但有风险点需要关注',
      description: '当前仍有稳定调用产出，但出现了异常或失败调用，建议优先查看运行状态中的风险项。'
    }
  }

  if (activeUsers === 0) {
    return {
      title: '平台运行稳定，但今日学习活跃偏低',
      description: '系统侧暂无明显异常，当前更值得关注的是学习活跃和用户转化，而不是运行故障。'
    }
  }

  if (successRate >= 90) {
    return {
      title: '今天平台整体运行平稳',
      description: '学习活跃、路径推进与 Agent 成功率都处在可接受区间，首页重点放在业务进展和异常趋势。'
    }
  }

  return {
    title: '平台有运行负载，成功率需要继续观察',
    description: '系统仍在持续提供服务，但成功率已有下滑迹象，建议结合调用趋势和运行状态继续检查。'
  }
})

const refreshAll = async () => {
  refreshing.value = true
  try {
    await Promise.all([loadOverview(), loadAgentStatus(), loadActivity()])
    lastRefreshAt.value = new Date()
  } finally {
    refreshing.value = false
  }
}

const loadOverview = async () => {
  try {
    const response: any = await adminDashboardApi.getStats()
    stats.value = response.data.data || {}
  } catch (error: any) {
    console.error('加载概览数据失败:', error)
    toast.error('加载概览数据失败')
  }
}

const loadAgentStatus = async () => {
  try {
    const response: any = await adminAgentsApi.status()
    agentStatuses.value = response.data.data?.agents || []
  } catch (error: any) {
    console.error('加载 Agent 状态失败:', error)
  }
}

const loadActivity = async () => {
  try {
    const response: any = await adminDashboardApi.getActivity(20)
    const data = response.data.data || {}

    const activities: any[] = []

    if (data.recentSessions) {
      data.recentSessions.forEach((session: any) => {
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
      data.recentUsers.forEach((user: any) => {
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
      data.completedTasks.forEach((task: any) => {
        activities.push({
          id: task.id,
          type: 'warning',
          title: '任务完成',
          description: `${task.user?.name || '用户'} 完成了任务 "${task.title}"`,
          createdAt: task.completedAt
        })
      })
    }

    activities.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    recentActivities.value = activities.slice(0, 50)
  } catch (error: any) {
    console.error('加载活动日志失败:', error)
  }
}

const getAgentTagType = (status: string) => {
  switch (status) {
    case 'success':
      return 'success'
    case 'running':
      return 'warning'
    case 'error':
      return 'danger'
    default:
      return 'info'
  }
}

const getAgentDisplayName = (name: string) => {
  const map: Record<string, string> = {
    RequirementCollection: '需求收集',
    PathPlanning: '路径规划',
    Teaching: '教学执行',
    TeachingOrchestration: '教学编排',
    LearningCompanion: '伴学介入',
    SessionWrapup: '课后产出'
  }

  return map[name] || name
}

const formatTime = (time: any) => {
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
  padding-bottom: 24px;
}

.page-hero,
.panel-card,
.insight-card {
  border: 1px solid rgba(205, 216, 238, 0.9);
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 255, 0.94));
  box-shadow: 0 16px 42px rgba(42, 72, 128, 0.08);
}

.page-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 24px 28px;
  margin-bottom: 2px;
}

.page-hero__copy {
  display: grid;
  gap: 12px;
}

.page-hero__eyebrow {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: #2d6df2;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.page-hero__title {
  margin: 0;
  font-size: 2rem;
  line-height: 1.1;
  letter-spacing: -0.04em;
  color: #23344d;
}

.page-hero__subtitle {
  margin: 0;
  font-size: 0.95rem;
  color: #64748b;
  max-width: 760px;
}

.page-hero__highlights {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.hero-pill {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(244, 247, 254, 0.92);
  border: 1px solid rgba(216, 224, 238, 0.92);
  color: #5f738f;
  font-size: 0.82rem;
  font-weight: 600;
}

.page-hero__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
}

.page-hero__refresh {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 16px;
  border-radius: 14px;
  border: 1px solid rgba(52, 120, 246, 0.14);
  background: rgba(255, 255, 255, 0.9);
  color: #2d6df2;
  font-weight: 700;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.summary-grid--headline {
  margin-bottom: 2px;
}

.summary-card {
  min-height: 138px;
  padding: 18px 20px;
  border: 1px solid rgba(209, 218, 235, 0.92);
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 249, 255, 0.96));
  box-shadow: 0 14px 34px rgba(57, 85, 138, 0.08);
  display: grid;
  align-content: space-between;
  gap: 18px;
}

.summary-card--primary {
  background: linear-gradient(180deg, rgba(246, 250, 255, 0.98), rgba(237, 244, 255, 0.98));
}

.summary-card--highlight {
  background: linear-gradient(180deg, rgba(248, 249, 255, 0.98), rgba(239, 243, 255, 0.98));
}

.summary-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.summary-card__label {
  font-size: 0.9rem;
  font-weight: 700;
  color: #2f4059;
}

.summary-card__caption {
  font-size: 0.75rem;
  color: #8b9ab0;
}

.summary-card__value-row {
  display: grid;
  gap: 6px;
}

.summary-card__value-row strong {
  font-size: 2rem;
  line-height: 1;
  letter-spacing: -0.04em;
  color: #21354f;
}

.summary-card__hint {
  font-size: 0.875rem;
  color: #697a91;
}

.insight-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(320px, 0.9fr);
  gap: 16px;
}

.insight-card {
  padding: 22px 24px;
}

.insight-card--primary {
  display: grid;
  gap: 20px;
}

.hero-kpi__copy {
  display: grid;
  gap: 8px;
}

.hero-kpi__eyebrow {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7b8ba3;
}

.hero-kpi__copy h2 {
  margin: 0;
  font-size: 1.35rem;
  color: #21344b;
}

.hero-kpi__copy p {
  margin: 0;
  color: #64748b;
  line-height: 1.65;
}

.hero-kpi__facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.hero-kpi__fact {
  padding: 16px;
  border-radius: 18px;
  background: rgba(244, 247, 254, 0.88);
  border: 1px solid rgba(215, 224, 241, 0.94);
  display: grid;
  gap: 6px;
}

.hero-kpi__fact span,
.stat-card__label {
  font-size: 0.8rem;
  color: #7a899f;
}

.hero-kpi__fact strong,
.stat-card__value {
  font-size: 1.9rem;
  line-height: 1;
  letter-spacing: -0.04em;
  color: #1f314b;
}

.hero-kpi__fact em,
.stat-card__meta {
  font-style: normal;
  color: #5f738f;
  font-size: 0.86rem;
}

.health-list {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.health-item {
  display: grid;
  grid-template-columns: 12px 1fr;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid rgba(215, 224, 241, 0.94);
  background: rgba(248, 250, 255, 0.9);
}

.health-item__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: 6px;
  background: #94a3b8;
}

.health-item strong {
  color: #27374f;
  font-size: 0.92rem;
}

.health-item p {
  margin: 4px 0 0;
  font-size: 0.84rem;
  color: #697a91;
  line-height: 1.55;
}

.health-item.is-good {
  border-color: rgba(93, 195, 128, 0.3);
  background: rgba(244, 251, 246, 0.96);
}

.health-item.is-good .health-item__dot {
  background: #3db36d;
}

.health-item.is-warning {
  border-color: rgba(244, 170, 70, 0.3);
  background: rgba(255, 249, 241, 0.96);
}

.health-item.is-warning .health-item__dot {
  background: #f0a13b;
}

.health-item.is-neutral .health-item__dot {
  background: #5a94f8;
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
  color: #1f3857;
}

.section-subtitle {
  margin: 6px 0 0;
  font-size: 0.84rem;
  color: #73839a;
  line-height: 1.55;
}

.section-link {
  color: #2d6df2;
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
}

.agent-name {
  display: flex;
  align-items: center;
  gap: 10px;
}

.agent-name-text {
  color: #23344d;
  font-weight: 600;
}

.table-progress-cell {
  padding-right: 10px;
}

.call-metrics {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
}

.call-metrics__divider {
  color: #90a0b6;
  font-weight: 500;
}

.success-count {
  color: #2f9a58;
}

.error-count {
  color: #d36a54;
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
  border-radius: 18px;
  border: 1px solid rgba(216, 224, 238, 0.94);
  background: rgba(247, 250, 255, 0.9);
}

.trend-summary-card span {
  font-size: 0.8rem;
  color: #78889f;
}

.trend-summary-card strong {
  font-size: 1.5rem;
  line-height: 1.1;
  color: #23344d;
}

.trend-summary-card em {
  font-style: normal;
  font-size: 0.82rem;
  color: #62758f;
}

.trend-row {
  align-items: center;
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) 92px;
  gap: 14px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(226, 232, 244, 0.86);
}

.trend-row:last-child {
  border-bottom: none;
}

.trend-row--head {
  padding-top: 0;
  color: #7b8ba3;
  font-size: 0.75rem;
  font-weight: 700;
}

.trend-time {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.82rem;
  color: #33465f;
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
  color: #6e8099;
  font-size: 0.8rem;
}

.trend-bar-track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(216, 224, 238, 0.55);
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
  color: #6e8099;
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
  background: rgba(233, 248, 238, 0.95);
  color: #2f9a58;
}

.trend-rate-badge.is-warning {
  background: rgba(255, 242, 234, 0.96);
  color: #d98252;
}

.activity-feed {
  display: grid;
  gap: 12px;
}

.activity-card {
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid rgba(215, 224, 241, 0.94);
  background: rgba(249, 251, 255, 0.92);
}

.activity-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.activity-card__head strong {
  color: #243750;
  font-size: 0.92rem;
}

.activity-card__head span {
  color: #8696ab;
  font-size: 0.76rem;
  white-space: nowrap;
}

.activity-card p {
  margin: 0;
  font-size: 0.84rem;
  color: #64748b;
  line-height: 1.6;
}

:deep(.agent-status-table) {
  --el-table-border-color: rgba(223, 230, 242, 0.9);
  --el-table-header-bg-color: rgba(244, 247, 252, 0.92);
  --el-table-row-hover-bg-color: rgba(244, 248, 255, 0.8);
  border-radius: 18px;
  overflow: hidden;
}

:deep(.agent-status-table .el-table__cell) {
  padding-top: 12px;
  padding-bottom: 12px;
}

:deep(.el-progress-bar__outer) {
  background-color: rgba(215, 224, 241, 0.8);
}

@media (max-width: 1280px) {
  .summary-grid,
  .hero-kpi__facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .trend-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .insight-grid,
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .admin-overview {
    gap: 14px;
  }

  .page-hero,
  .insight-card,
  .section {
    padding: 16px;
  }

  .page-hero {
    flex-direction: column;
  }

  .page-hero__actions {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .summary-grid,
  .hero-kpi__facts,
  .trend-summary {
    grid-template-columns: 1fr;
  }

  .summary-card {
    min-height: 120px;
  }

  .trend-row {
    grid-template-columns: 62px minmax(0, 1fr) 72px;
    gap: 10px;
  }
}
</style>
