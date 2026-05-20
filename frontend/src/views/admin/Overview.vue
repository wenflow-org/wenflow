<template>
  <div class="admin-overview">
    <!-- 背景装饰层 -->
    <div class="overview-bg-layer">
      <div class="overview-bg-orb overview-bg-orb--1"></div>
      <div class="overview-bg-orb overview-bg-orb--2"></div>
      <div class="overview-bg-orb overview-bg-orb--3"></div>
      <div class="overview-bg-grid"></div>
    </div>

    <!-- Hero 区域 -->
    <div class="overview-hero surface-card">
      <div class="overview-hero__glow"></div>
      <div class="overview-hero__content">
        <div class="overview-hero__left">
          <span class="pill">后台概览</span>
          <h1 class="overview-hero__title">平台运行状态</h1>
          <p class="overview-hero__subtitle">查看用户、路径、Agent 和系统状态</p>
        </div>
        <div class="overview-hero__right">
          <el-button class="hero-refresh-btn" @click="refreshAll" :loading="refreshing">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
            刷新数据
          </el-button>
        </div>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-grid">
      <div class="stat-card stat-card--users">
        <div class="stat-card__icon-wrap stat-card__icon-wrap--users">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="stat-card__body">
          <span class="stat-card__label">总用户数</span>
          <strong class="stat-card__value">{{ stats.users?.total || 0 }}</strong>
          <div class="stat-card__trend">
            <span class="trend-badge trend-badge--success">+{{ stats.users?.newToday || 0 }}</span>
            <span class="trend-label">今日新增</span>
          </div>
        </div>
      </div>

      <div class="stat-card stat-card--active">
        <div class="stat-card__icon-wrap stat-card__icon-wrap--active">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        </div>
        <div class="stat-card__body">
          <span class="stat-card__label">活跃用户</span>
          <strong class="stat-card__value">{{ stats.users?.activeToday || 0 }}</strong>
          <div class="stat-card__trend">
            <span class="trend-badge trend-badge--primary">{{ stats.users?.activeRate || 0 }}%</span>
            <span class="trend-label">活跃率</span>
          </div>
        </div>
      </div>

      <div class="stat-card stat-card--paths">
        <div class="stat-card__icon-wrap stat-card__icon-wrap--paths">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        </div>
        <div class="stat-card__body">
          <span class="stat-card__label">学习路径</span>
          <strong class="stat-card__value">{{ stats.learning?.totalPaths || 0 }}</strong>
          <div class="stat-card__trend">
            <span class="trend-badge trend-badge--primary">{{ stats.learning?.activePaths || 0 }}</span>
            <span class="trend-label">活跃路径</span>
          </div>
        </div>
      </div>

      <div class="stat-card stat-card--tasks">
        <div class="stat-card__icon-wrap stat-card__icon-wrap--tasks">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>
        <div class="stat-card__body">
          <span class="stat-card__label">任务完成</span>
          <strong class="stat-card__value">{{ stats.learning?.completedTasks || 0 }}</strong>
          <div class="stat-card__trend">
            <span class="trend-badge trend-badge--success">{{ stats.learning?.completionRate || 0 }}%</span>
            <span class="trend-label">完成率</span>
          </div>
        </div>
      </div>

      <div class="stat-card stat-card--conversations">
        <div class="stat-card__icon-wrap stat-card__icon-wrap--conversations">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div class="stat-card__body">
          <span class="stat-card__label">目标对话</span>
          <strong class="stat-card__value">{{ stats.conversations?.total || 0 }}</strong>
          <div class="stat-card__trend">
            <span class="trend-badge trend-badge--accent">{{ stats.conversations?.active || 0 }}</span>
            <span class="trend-label">进行中</span>
          </div>
        </div>
      </div>

      <div class="stat-card stat-card--agents">
        <div class="stat-card__icon-wrap stat-card__icon-wrap--agents">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>
        </div>
        <div class="stat-card__body">
          <span class="stat-card__label">Agent 调用</span>
          <strong class="stat-card__value">{{ stats.agents?.totalCalls || 0 }}</strong>
          <div class="stat-card__trend">
            <span class="trend-badge trend-badge--success">{{ stats.agents?.successRate || 100 }}%</span>
            <span class="trend-label">成功率</span>
            <span class="trend-badge trend-badge--subtle">{{ stats.agents?.todayCalls || 0 }}</span>
            <span class="trend-label">今日调用</span>
          </div>
          <div class="stat-card__meta">
            <span>24h 活跃：{{ stats.agents?.activeAgents24h || 0 }}</span>
            <span>今日超时：{{ stats.agents?.todayTimeouts || 0 }}</span>
          </div>
          <div v-if="stats.agents?.wrapup?.sampleSize" class="stat-card__meta">
            <span>Wrapup 样本：{{ stats.agents.wrapup.sampleSize }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Agent 运行状态 -->
    <div class="section">
      <h3 class="section-title">
        <el-icon><Cpu /></el-icon>
        Agent / 编排器 运行状态
      </h3>
      <el-table :data="agentStatuses" stripe class="agent-status-table">
        <el-table-column prop="name" label="Agent" min-width="140">
          <template #default="{ row }">
            <div class="agent-name">
              <el-tag :type="getAgentTagType(row.status)" size="small" class="agent-tag">
                {{ row.status }}
              </el-tag>
              <span class="agent-name-text">{{ getAgentDisplayName(row.name) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="successRate" label="成功率" width="150">
          <template #default="{ row }">
            <el-progress :percentage="parseFloat(row.successRate)" :status="parseFloat(row.successRate) >= 90 ? 'success' : 'warning'" />
          </template>
        </el-table-column>
        <el-table-column prop="avgDuration" label="平均耗时" width="100" align="center">
          <template #default="{ row }">
            {{ row.avgDuration }}ms
          </template>
        </el-table-column>
        <el-table-column prop="totalCalls" label="总调用" width="80" align="center" />
        <el-table-column prop="successCalls" label="成功" width="80" align="center">
          <template #default="{ row }">
            <span class="success-count">{{ row.successCalls }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="errorCalls" label="失败" width="80" align="center">
          <template #default="{ row }">
            <span class="error-count">{{ row.errorCalls }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="lastActivity" label="最后活跃" width="140">
          <template #default="{ row }">
            {{ formatTime(row.lastActivity) }}
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="section">
      <h3 class="section-title">
        <el-icon><TrendCharts /></el-icon>
        最近 24 小时异常趋势
      </h3>
      <div class="trend-panel" v-if="trendPoints.length > 0">
        <div class="trend-row trend-row--head">
          <span class="trend-time">时间</span>
          <span class="trend-bars-label">调用 / 异常</span>
          <span class="trend-values">数量</span>
        </div>
        <div class="trend-row" v-for="point in trendPoints" :key="point.time">
          <span class="trend-time">{{ point.label }}</span>
          <div class="trend-bars">
            <div class="trend-bar trend-bar--calls" :style="{ width: `${(point.total / maxCalls) * 100}%` }"></div>
            <div class="trend-bar trend-bar--issues" :style="{ width: `${((point.error + point.timeout) / maxIssues) * 100}%` }"></div>
          </div>
          <span class="trend-values">{{ point.total }} / {{ point.error + point.timeout }}</span>
        </div>
      </div>
      <el-empty v-else description="暂无 24 小时趋势数据" />
    </div>

    <!-- 最近活动 -->
    <div class="section">
      <div class="section-head">
        <h3 class="section-title">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg>
          最近活动
        </h3>
        <router-link class="section-link" to="/admin/activity-stream">查看全部活动</router-link>
      </div>
      <el-timeline>
        <el-timeline-item
          v-for="activity in recentActivitySummary"
          :key="activity.id"
          :timestamp="formatTime(activity.createdAt)"
          placement="top"
          :type="activity.type"
        >
          <div class="activity-card">
            <h4>{{ activity.title }}</h4>
            <p>{{ activity.description }}</p>
          </div>
        </el-timeline-item>
      </el-timeline>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { adminDashboardApi, adminAgentsApi } from '@/api/adminApi';
import { Cpu, TrendCharts } from '@element-plus/icons-vue';
import { toast } from '../../utils/toast';

const stats = ref<any>({});
const agentStatuses = ref<any[]>([]);
const recentActivities = ref<any[]>([]);
const refreshing = ref(false);

const recentActivitySummary = computed(() => recentActivities.value.slice(0, 5));

const trendPoints = computed(() => {
  const points = stats.value?.agents?.last24h || [];
  return points.slice(-12);
});

const maxCalls = computed(() => {
  const max = trendPoints.value.reduce((acc: number, item: any) => Math.max(acc, item.total || 0), 0);
  return max > 0 ? max : 1;
});

const maxIssues = computed(() => {
  const max = trendPoints.value.reduce(
    (acc: number, item: any) => Math.max(acc, (item.error || 0) + (item.timeout || 0)),
    0
  );
  return max > 0 ? max : 1;
});

const refreshAll = async () => {
  refreshing.value = true;
  try {
    await Promise.all([loadOverview(), loadAgentStatus(), loadActivity()]);
  } finally {
    refreshing.value = false;
  }
};

const loadOverview = async () => {
  try {
    const response: any = await adminDashboardApi.getStats();
    stats.value = response.data.data || {};
  } catch (error: any) {
    console.error('加载概览数据失败:', error);
    toast.error('加载概览数据失败');
  }
};

const loadAgentStatus = async () => {
  try {
    const response: any = await adminAgentsApi.status();
    agentStatuses.value = response.data.data?.agents || [];
  } catch (error: any) {
    console.error('加载 Agent 状态失败:', error);
  }
};

const loadActivity = async () => {
  try {
    const response: any = await adminDashboardApi.getActivity(20);
    const data = response.data.data || {};
    
    const activities: any[] = [];
    
    if (data.recentSessions) {
      data.recentSessions.forEach((session: any) => {
        const taskTitle = session.task?.title || session.topic || session.taskId || '未知任务';
        activities.push({
          id: session.id,
          type: 'success',
          title: '学习会话',
          description: `${session.user?.name || session.users?.name || '用户'} 开始了任务 "${taskTitle}"`,
          createdAt: session.startTime
        });
      });
    }
    
    if (data.recentUsers) {
      data.recentUsers.forEach((user: any) => {
        activities.push({
          id: user.id,
          type: 'primary',
          title: '新用户注册',
          description: `${user.name || user.email} 加入了平台`,
          createdAt: user.createdAt
        });
      });
    }
    
    if (data.completedTasks) {
      data.completedTasks.forEach((task: any) => {
        activities.push({
          id: task.id,
          type: 'warning',
          title: '任务完成',
          description: `${task.user?.name || '用户'} 完成了任务 "${task.title}"`,
          createdAt: task.completedAt
        });
      });
    }
    
    activities.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    recentActivities.value = activities.slice(0, 50);
  } catch (error: any) {
    console.error('加载活动日志失败:', error);
  }
};

const getAgentTagType = (status: string) => {
  switch (status) {
    case 'success':
      return 'success';
    case 'running':
      return 'warning';
    case 'error':
      return 'danger';
    default:
      return 'info';
  }
};

const getAgentDisplayName = (name: string) => {
  const map: Record<string, string> = {
    RequirementCollection: '需求收集',
    PathPlanning: '路径规划',
    Teaching: '教学执行',
    TeachingOrchestration: '教学编排',
    LearningCompanion: '伴学介入',
    SessionWrapup: '课后产出'
  };

  return map[name] || name;
};

const formatTime = (time: any) => {
  if (!time) return '暂无数据';
  const date = new Date(time);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  return `${days}天前`;
};

onMounted(() => {
  loadOverview();
  loadAgentStatus();
  loadActivity();
});
</script>

<style scoped>
/* ==========================================
   背景装饰层
   ========================================== */
.admin-overview {
  position: relative;
  padding: 0;
  padding-bottom: 24px;
  overflow: hidden;
}

.overview-bg-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.overview-bg-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(52px);
  opacity: 0.42;
}

.overview-bg-orb--1 {
  width: 380px;
  height: 380px;
  top: -120px;
  left: -80px;
  background: color-mix(in srgb, var(--color-primary) 30%, white);
  animation: admin-orb-drift 26s ease-in-out infinite;
}

.overview-bg-orb--2 {
  width: 320px;
  height: 320px;
  top: 12%;
  right: -80px;
  background: color-mix(in srgb, var(--color-accent) 22%, white);
  animation: admin-orb-drift 30s ease-in-out infinite reverse;
}

.overview-bg-orb--3 {
  width: 260px;
  height: 260px;
  bottom: -70px;
  left: 24%;
  background: color-mix(in srgb, var(--color-secondary) 22%, white);
  animation: admin-orb-drift 28s ease-in-out infinite alternate;
}

.overview-bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(52, 120, 246, 0.02) 1px, transparent 1px),
    linear-gradient(90deg, rgba(52, 120, 246, 0.02) 1px, transparent 1px);
  background-size: 72px 72px;
  mask-image: radial-gradient(circle at 50% 22%, black 20%, transparent 76%);
}

@keyframes admin-orb-drift {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(30px, -20px) scale(1.05); }
  66% { transform: translate(-20px, 30px) scale(0.95); }
}

/* ==========================================
   Hero 区域
   ========================================== */
.overview-hero {
  position: relative;
  z-index: 1;
  margin-bottom: 1.5rem;
  padding: 20px 24px;
  border-radius: 28px;
  border: 1px solid #d2dbf3;
  background:
    radial-gradient(circle at top right, rgba(52, 120, 246, 0.08), transparent 34%),
    color-mix(in srgb, #ffffff 90%, white);
  backdrop-filter: blur(20px);
  box-shadow: 0 30px 90px rgba(58, 101, 197, 0.16);
  overflow: hidden;
}

.overview-hero__glow {
  position: absolute;
  top: -60px;
  right: -40px;
  width: 300px;
  height: 300px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.1), transparent 60%);
  pointer-events: none;
}

.overview-hero__content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.overview-hero__left {
  display: grid;
  gap: 10px;
}

.overview-hero__title {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.03em;
  line-height: 1.15;
}

.overview-hero__subtitle {
  margin: 0;
  font-size: 1rem;
  color: var(--text-secondary);
  line-height: 1.6;
}

.hero-refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 16px;
  border-radius: 14px;
  border: 1px solid rgba(52, 120, 246, 0.12);
  background: color-mix(in srgb, var(--bg-surface) 84%, white);
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 180ms ease;
}

.hero-refresh-btn:hover {
  background: color-mix(in srgb, var(--color-primary) 8%, white);
  border-color: color-mix(in srgb, var(--color-primary) 16%, rgba(52, 120, 246, 0.2));
  color: var(--color-primary-dark);
}

/* pill 标签 */
.pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary) 10%, white);
  color: var(--color-primary-dark);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

/* surface-card 基础 */
.surface-card {
  border: 1px solid #d2dbf3;
  border-radius: 28px;
  background: color-mix(in srgb, #ffffff 90%, white);
  box-shadow: 0 30px 90px rgba(58, 101, 197, 0.16);
  backdrop-filter: blur(20px);
}

/* ==========================================
   统计卡片
   ========================================== */
.stats-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.875rem;
  margin-bottom: 1.5rem;
}

.stats-grid > .stat-card--conversations,
.stats-grid > .stat-card--agents {
  grid-column: span 2;
}

.stat-card {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  border-radius: 28px;
  border: 1px solid rgba(52, 120, 246, 0.06);
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(20px);
  padding: 1.25rem 1.5rem;
  box-shadow: 0 30px 90px rgba(58, 101, 197, 0.16);
  transition: transform 0.2s ease;
  position: relative;
  overflow: hidden;
}

.trend-row {
  align-items: center;
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr) 82px;
  gap: 12px;
  padding: 0.5rem 0;
  border-bottom: 1px dashed rgba(52, 120, 246, 0.06);
}

.trend-row:last-child {
  border-bottom: none;
}

.trend-row--head {
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 700;
  border-bottom-style: solid;
  border-bottom-color: rgba(52, 120, 246, 0.1);
}

.trend-time {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.8125rem;
  color: var(--text-primary);
}

.trend-bars {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.trend-bar {
  height: 8px;
  border-radius: 999px;
  min-width: 2px;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.trend-bar--calls {
  background: linear-gradient(90deg, #3478f6, #5a94f8);
  box-shadow: 0 0 8px rgba(52, 120, 246, 0.2);
}

.trend-bar--issues {
  background: linear-gradient(90deg, #ef7578, #f49a9c);
  box-shadow: 0 0 6px rgba(239, 117, 120, 0.15);
}

.trend-bars-label,
.trend-values {
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

/* ==========================================
   活动时间轴
   ========================================== */
.activity-card {
  padding: 14px 18px;
  border-radius: 14px;
  border: 1px solid rgba(52, 120, 246, 0.06);
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(8px);
  transition: all 0.2s ease;
}

.activity-card:hover {
  background: rgba(255, 255, 255, 0.9);
  border-color: rgba(52, 120, 246, 0.1);
}

.activity-card h4 {
  margin: 0 0 4px 0;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
}

.activity-card p {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.55;
}

/* :deep 覆盖 el-timeline */
:deep(.el-timeline) {
  padding-left: 8px;
}

:deep(.el-timeline-item__node) {
  background: linear-gradient(135deg, #3478f6, #8d6bff);
  border: none;
  box-shadow: 0 0 0 4px rgba(52, 120, 246, 0.1);
}

:deep(.el-timeline-item__node--success) {
  background: linear-gradient(135deg, #31b16f, #5cc98b);
  box-shadow: 0 0 0 4px rgba(49, 177, 111, 0.1);
}

:deep(.el-timeline-item__node--primary) {
  background: linear-gradient(135deg, #3478f6, #5a94f8);
  box-shadow: 0 0 0 4px rgba(52, 120, 246, 0.1);
}

:deep(.el-timeline-item__node--warning) {
  background: linear-gradient(135deg, #f4aa46, #f7c07a);
  box-shadow: 0 0 0 4px rgba(244, 170, 70, 0.1);
}

:deep(.el-timeline-item__tail) {
  border-left-color: rgba(52, 120, 246, 0.08);
}

:deep(.el-timeline-item__timestamp) {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 500;
}

:deep(.el-timeline-item__wrapper) {
  padding-left: 20px;
}

/* ==========================================
    响应式
   ========================================== */
@media (max-width: 1024px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .stats-grid > .stat-card--conversations,
  .stats-grid > .stat-card--agents {
    grid-column: span 2;
  }

  .overview-hero__content {
    flex-direction: column;
    align-items: flex-start;
  }
}

@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .stats-grid > .stat-card--conversations,
  .stats-grid > .stat-card--agents {
    grid-column: span 1;
  }

  .overview-hero {
    padding: 16px;
  }

  .section {
    padding: 1rem;
  }
}
</style>
