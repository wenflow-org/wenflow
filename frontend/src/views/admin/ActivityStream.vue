<template>
  <div class="admin-page activity-stream-page" v-loading="loading">
    <AdminPageHeader
      kicker="Activity Diagnostics"
      title="活动流"
      desc="查看系统活动。"
      :icon="Clock"
      :highlights="activityHighlights"
    >
      <template #actions>
        <el-button type="primary" :loading="loading" @click="reload">刷新活动流</el-button>
      </template>
    </AdminPageHeader>

    <section class="admin-filter-panel activity-filter-panel">
      <div class="admin-section-head activity-filter-panel__head">
        <div class="admin-section-head__copy">
          <span class="admin-section-head__eyebrow">Activity Filters</span>
          <h3 class="admin-section-head__title">活动筛选</h3>
          <p class="admin-section-head__desc">按活动类型和关键词收窄时间线范围。</p>
        </div>
        <div class="activity-filter-panel__summary">
          <span>{{ filteredActivities.length }} 条结果</span>
        </div>
      </div>

      <div class="admin-list-toolbar">
        <div class="admin-list-toolbar__group">
        <el-select v-model="filters.type" placeholder="活动类型" clearable class="toolbar-item">
          <el-option label="学习会话" value="学习会话" />
          <el-option label="新用户注册" value="新用户注册" />
          <el-option label="任务完成" value="任务完成" />
        </el-select>
        <el-input
          v-model="filters.keyword"
          placeholder="按用户或事件关键词筛选"
          clearable
          class="toolbar-item toolbar-item--wide"
        />
      </div>
      <div class="admin-list-toolbar__group">
        <p class="activity-toolbar-note">{{ filters.type || filters.keyword ? '已启用筛选' : '默认范围' }}</p>
      </div>
      </div>
    </section>

    <section class="timeline-wrap admin-list-card">
      <div class="timeline-wrap__head">
        <strong>活动时间线</strong>
        <span>按时间倒序查看系统活动</span>
      </div>
      <el-empty v-if="pagedActivities.length === 0" description="暂无活动数据" />
      <el-timeline v-else>
        <el-timeline-item
          v-for="activity in pagedActivities"
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
    </section>

    <div class="admin-list-pagination">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.limit"
        :total="filteredActivities.length"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Clock } from '@element-plus/icons-vue';
import { adminDashboardApi } from '@/api/adminApi';
import AdminPageHeader from './components/AdminPageHeader.vue';
import { toast } from '../../utils/toast';

const loading = ref(false);
const allActivities = ref<any[]>([]);

const filters = reactive({
  type: '',
  keyword: '',
});

const pagination = reactive({
  page: 1,
  limit: 20,
});

const normalizeActivities = (data: any) => {
  const activities: any[] = [];

  if (data.recentSessions) {
    data.recentSessions.forEach((session: any) => {
      const taskTitle = session.task?.title || session.topic || session.taskId || '未知任务';
      activities.push({
        id: `session-${session.id}`,
        type: 'success',
        title: '学习会话',
        description: `${session.user?.name || session.users?.name || '用户'} 开始了任务 "${taskTitle}"`,
        createdAt: session.startTime,
      });
    });
  }

  if (data.recentUsers) {
    data.recentUsers.forEach((user: any) => {
      activities.push({
        id: `user-${user.id}`,
        type: 'primary',
        title: '新用户注册',
        description: `${user.name || user.email} 加入了平台`,
        createdAt: user.createdAt,
      });
    });
  }

  if (data.completedTasks) {
    data.completedTasks.forEach((task: any) => {
      activities.push({
        id: `task-${task.id}`,
        type: 'warning',
        title: '任务完成',
        description: `${task.user?.name || '用户'} 完成了任务 "${task.title}"`,
        createdAt: task.completedAt,
      });
    });
  }

  activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return activities;
};

const filteredActivities = computed(() => {
  const keyword = filters.keyword.trim().toLowerCase();
  return allActivities.value.filter((item) => {
    if (filters.type && item.title !== filters.type) return false;
    if (!keyword) return true;
    const content = `${item.title} ${item.description}`.toLowerCase();
    return content.includes(keyword);
  });
});

const pagedActivities = computed(() => {
  const start = (pagination.page - 1) * pagination.limit;
  return filteredActivities.value.slice(start, start + pagination.limit);
});

const sessionCount = computed(() => allActivities.value.filter((item) => item.title === '学习会话').length);
const signupCount = computed(() => allActivities.value.filter((item) => item.title === '新用户注册').length);
const completedCount = computed(() => allActivities.value.filter((item) => item.title === '任务完成').length);
const activityHighlights = computed(() => [
  { label: `${filteredActivities.value.length} 条活动`, tone: 'info' as const },
  { label: `学习会话 ${sessionCount.value}`, tone: 'success' as const },
  { label: `新用户 ${signupCount.value}`, tone: 'neutral' as const },
  { label: `任务完成 ${completedCount.value}`, tone: 'warning' as const }
]);

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

const reload = async () => {
  loading.value = true;
  try {
    const response: any = await adminDashboardApi.getActivity(200);
    const data = response.data?.data || {};
    allActivities.value = normalizeActivities(data);
    pagination.page = 1;
  } catch (error) {
    console.error(error);
    toast.error('加载活动流失败');
  } finally {
    loading.value = false;
  }
};

onMounted(reload);
</script>

<style scoped>
.activity-stream-page {
  position: relative;
  display: grid;
  gap: 16px;
}

.toolbar-item { width: 180px; }
.toolbar-item--wide { width: 320px; }

.activity-toolbar-note {
  margin: 0;
  font-size: 12px;
  color: var(--admin-text-muted);
}

.activity-filter-panel {
  gap: 14px;
}

.activity-filter-panel__head {
  margin-bottom: 0;
}

.activity-filter-panel__summary {
  color: var(--admin-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.stats-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.mini-stat {
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(52, 120, 246, 0.1);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.86), rgba(244, 247, 252, 0.88));
  display: grid;
  gap: 6px;
}

.mini-stat span { color: var(--text-secondary); font-size: 12px; }
.mini-stat strong { font-size: 20px; color: var(--text-primary); line-height: 1.2; }

.timeline-wrap {
  position: relative;
  z-index: 1;
  padding: 16px;
}

.timeline-wrap__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: var(--admin-border-subtle);
}

.timeline-wrap__head strong {
  color: var(--admin-text-primary);
  font-size: 14px;
}

.timeline-wrap__head span {
  color: var(--admin-text-muted);
  font-size: 12px;
}

.activity-card {
  border-radius: 12px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: rgba(255, 255, 255, 0.85);
  padding: 12px 14px;
}

.activity-card h4 {
  margin: 0 0 6px;
  font-size: 14px;
  color: var(--text-primary);
}

.activity-card p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}

:deep(.el-timeline-item__timestamp) {
  color: var(--text-secondary);
}

@media (max-width: 900px) {
  .toolbar-item, .toolbar-item--wide { width: 100%; }
  .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
