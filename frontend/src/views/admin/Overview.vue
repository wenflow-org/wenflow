<template>
  <div class="admin-overview">
    <div class="page-header">
      <h2 class="page-title">📊 平台概览</h2>
      <p class="page-subtitle">实时监控平台运行状态和关键指标</p>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-grid">
      <!-- 用户统计 -->
      <el-card class="stat-card stat-card--users" shadow="hover">
        <div class="stat-icon">👥</div>
        <div class="stat-content">
          <div class="stat-label">总用户数</div>
          <div class="stat-value">{{ stats.users?.total || 0 }}</div>
          <div class="stat-trend">
            <span class="trend-positive">+{{ stats.users?.newToday || 0 }}</span>
            <span class="trend-label">今日新增</span>
          </div>
        </div>
      </el-card>

      <!-- 活跃用户 -->
      <el-card class="stat-card stat-card--active" shadow="hover">
        <div class="stat-icon">🔥</div>
        <div class="stat-content">
          <div class="stat-label">活跃用户</div>
          <div class="stat-value">{{ stats.users?.activeToday || 0 }}</div>
          <div class="stat-trend">
            <span class="trend-text">{{ stats.users?.activeRate || 0 }}%</span>
            <span class="trend-label">活跃率</span>
          </div>
        </div>
      </el-card>

      <!-- 学习路径 -->
      <el-card class="stat-card stat-card--paths" shadow="hover">
        <div class="stat-icon">📚</div>
        <div class="stat-content">
          <div class="stat-label">学习路径</div>
          <div class="stat-value">{{ stats.learning?.totalPaths || 0 }}</div>
          <div class="stat-trend">
            <span class="trend-text">{{ stats.learning?.activePaths || 0 }}</span>
            <span class="trend-label">活跃路径</span>
          </div>
        </div>
      </el-card>

      <!-- 任务完成率 -->
      <el-card class="stat-card stat-card--tasks" shadow="hover">
        <div class="stat-icon">✅</div>
        <div class="stat-content">
          <div class="stat-label">任务完成</div>
          <div class="stat-value">{{ stats.learning?.completedTasks || 0 }}</div>
          <div class="stat-trend">
            <span class="trend-positive">{{ stats.learning?.completionRate || 0 }}%</span>
            <span class="trend-label">完成率</span>
          </div>
        </div>
      </el-card>

      <!-- 目标对话 -->
      <el-card class="stat-card stat-card--conversations" shadow="hover">
        <div class="stat-icon">💬</div>
        <div class="stat-content">
          <div class="stat-label">目标对话</div>
          <div class="stat-value">{{ stats.conversations?.total || 0 }}</div>
          <div class="stat-trend">
            <span class="trend-text">{{ stats.conversations?.active || 0 }}</span>
            <span class="trend-label">进行中</span>
          </div>
        </div>
      </el-card>

      <!-- Agent 成功率 -->
      <el-card class="stat-card stat-card--agents" shadow="hover">
        <div class="stat-icon">🤖</div>
        <div class="stat-content">
          <div class="stat-label">Agent 调用</div>
          <div class="stat-value">{{ stats.agents?.totalCalls || 0 }}</div>
          <div class="stat-trend">
            <span class="trend-positive">{{ stats.agents?.successRate || 100 }}%</span>
            <span class="trend-label">成功率</span>
          </div>
        </div>
      </el-card>
    </div>

    <!-- Agent 运行状态 -->
    <div class="section">
      <h3 class="section-title">🤖 Agent 运行状态</h3>
      <el-table :data="agentStatuses" stripe style="min-width: 100%">
        <el-table-column prop="name" label="Agent" min-width="140">
          <template #default="{ row }">
            <div class="agent-name">
              <el-tag :type="getAgentTagType(row.status)" size="small">
                {{ row.status }}
              </el-tag>
              <span class="agent-name-text">{{ row.name }}</span>
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
            <span style="color: var(--el-color-success)">{{ row.successCalls }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="errorCalls" label="失败" width="80" align="center">
          <template #default="{ row }">
            <span style="color: var(--el-color-danger)">{{ row.errorCalls }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="lastActivity" label="最后活跃" width="140">
          <template #default="{ row }">
            {{ formatTime(row.lastActivity) }}
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 最近活动 -->
    <div class="section">
      <h3 class="section-title">📝 最近活动</h3>
      <el-timeline>
        <el-timeline-item
          v-for="activity in recentActivities"
          :key="activity.id"
          :timestamp="formatTime(activity.createdAt)"
          placement="top"
          :type="activity.type"
        >
          <el-card>
            <h4>{{ activity.title }}</h4>
            <p>{{ activity.description }}</p>
          </el-card>
        </el-timeline-item>
      </el-timeline>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { adminDashboardApi, adminAgentsApi } from '@/api/adminApi';
import { ElMessage } from 'element-plus';

const stats = ref<any>({});
const agentStatuses = ref<any[]>([]);
const recentActivities = ref<any[]>([]);

const loadOverview = async () => {
  try {
    const response: any = await adminDashboardApi.getStats();
    stats.value = response.data.data || {};
  } catch (error: any) {
    console.error('加载概览数据失败:', error);
    ElMessage.error('加载概览数据失败');
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
    
    // 合并并转换活动数据
    const activities = [];
    
    // 添加学习会话活动
    if (data.recentSessions) {
      data.recentSessions.forEach((session: any) => {
        activities.push({
          id: session.id,
          type: 'success',
          title: '学习会话',
          description: `${session.user?.name || '用户'} 开始了任务 "${session.task?.title || '未知任务'}"`,
          createdAt: session.startTime
        });
      });
    }
    
    // 添加新用户注册活动
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
    
    // 添加任务完成活动
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
    
    // 按时间排序并取前 20 条
    activities.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    recentActivities.value = activities.slice(0, 20);
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
.admin-overview {
  padding: 0;
}

.page-header {
  margin-bottom: 2rem;
}

.page-title {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.5rem 0;
}

.page-subtitle {
  font-size: 1rem;
  color: var(--text-secondary);
  margin: 0;
}

/* 统计卡片 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 1.5rem !important;
  border-radius: var(--radius-xl) !important;
  border: 1px solid rgba(255, 255, 255, 0.32) !important;
  background: rgba(255, 255, 255, 0.72) !important;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  transition: all 0.3s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg) !important;
}

.stat-icon {
  font-size: 3rem;
  flex-shrink: 0;
}

.stat-content {
  flex: 1;
}

.stat-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.stat-trend {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.trend-positive {
  color: var(--color-success);
  font-weight: 600;
}

.trend-text {
  color: var(--color-primary);
  font-weight: 600;
}

.trend-label {
  color: var(--text-muted);
}

/* 不同卡片的图标背景色 */
.stat-card--users .stat-icon { background: linear-gradient(135deg, #60a5fa, #3b82f6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.stat-card--active .stat-icon { background: linear-gradient(135deg, #f59e0b, #f97316); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.stat-card--paths .stat-icon { background: linear-gradient(135deg, #10b981, #059669); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.stat-card--tasks .stat-icon { background: linear-gradient(135deg, #8b5cf6, #7c3aed); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.stat-card--conversations .stat-icon { background: linear-gradient(135deg, #ec4899, #db2777); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.stat-card--agents .stat-icon { background: linear-gradient(135deg, #06b6d4, #0891b2); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }

/* Section */
.section {
  margin-top: 2rem;
  padding: 1.25rem;
  border-radius: var(--radius-xl);
  border: 1px solid rgba(255, 255, 255, 0.32);
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--shadow-sm);
}

.section-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.agent-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.agent-name-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Agent 状态表格 */
:deep(.el-table) {
  width: 100%;
  --el-table-bg-color: transparent;
  --el-bg-color: transparent;
  --el-fill-color-blank: transparent;
}

:deep(.el-table__body-wrapper) {
  overflow-x: visible;
}

[data-theme="dark"] .stat-card {
  background: rgba(30, 45, 58, 0.74) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
}

[data-theme="dark"] .section {
  background: rgba(30, 45, 58, 0.74) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
}

[data-theme="dark"] .page-title {
  color: var(--text-primary);
}

[data-theme="dark"] .page-subtitle {
  color: var(--text-secondary);
}

[data-theme="dark"] .stat-label {
  color: var(--text-secondary);
}

[data-theme="dark"] .stat-value {
  color: var(--text-primary);
}

[data-theme="dark"] .section-title {
  color: var(--text-primary);
}

[data-theme="dark"] :deep(.el-table) {
  --el-table-bg-color: transparent;
  --el-bg-color: transparent;
  --el-fill-color-blank: transparent;
  --el-text-color-primary: var(--text-primary);
  --el-text-color-regular: var(--text-secondary);
  --el-border-color-lighter: var(--border-default);
}

[data-theme="dark"] :deep(.el-timeline-item__timestamp) {
  color: var(--text-muted);
}

[data-theme="dark"] :deep(.el-timeline-item__content) {
  color: var(--text-primary);
}

[data-theme="dark"] :deep(.el-card) {
  background: rgba(30, 45, 58, 0.74) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
}

[data-theme="dark"] :deep(.el-progress-bar__inner) {
  --el-color-success: var(--color-success);
  --el-color-warning: var(--color-efficient);
}
</style>
