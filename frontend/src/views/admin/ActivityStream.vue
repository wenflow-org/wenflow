<template>
  <div class="activity-stream-page" v-loading="loading">
    <div class="activity-bg-layer">
      <div class="activity-bg-orb activity-bg-orb--1"></div>
      <div class="activity-bg-orb activity-bg-orb--2"></div>
    </div>

    <div class="page-hero">
      <span class="pill">监控诊断</span>
      <h1 class="page-hero__title admin-page-title">
        <el-icon class="admin-page-title__icon"><Clock /></el-icon>
        活动流
      </h1>
      <p class="page-hero__subtitle">查看最近系统动态，快速定位用户与教学事件</p>
    </div>

    <div class="toolbar admin-list-toolbar">
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
        <el-button class="activity-btn activity-btn--primary" @click="reload">刷新</el-button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="mini-stat"><span>总活动</span><strong>{{ filteredActivities.length }}</strong></div>
      <div class="mini-stat"><span>学习会话</span><strong>{{ sessionCount }}</strong></div>
      <div class="mini-stat"><span>新用户注册</span><strong>{{ signupCount }}</strong></div>
      <div class="mini-stat"><span>任务完成</span><strong>{{ completedCount }}</strong></div>
    </div>

    <div class="timeline-wrap admin-list-card">
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
    </div>

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

.activity-bg-layer { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.activity-bg-orb { position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0.15; }
.activity-bg-orb--1 { width: 460px; height: 460px; top: -180px; right: -120px; background: radial-gradient(circle, rgba(52, 120, 246, 0.3), transparent 70%); animation: activity-orb 26s ease-in-out infinite; }
.activity-bg-orb--2 { width: 380px; height: 380px; left: -100px; bottom: 120px; background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%); animation: activity-orb 30s ease-in-out infinite reverse; }
@keyframes activity-orb { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -20px) scale(1.05); } 66% { transform: translate(-20px, 30px) scale(0.95); } }

.page-hero { position: relative; z-index: 1; padding: 24px 28px; border-radius: 20px; border: 1px solid rgba(52, 120, 246, 0.08); background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 38%), linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92)); backdrop-filter: blur(16px); margin-bottom: 1.5rem; }
.page-hero__title { margin: 8px 0 0; font-size: 1.5rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.03em; }
.page-hero__subtitle { margin: 4px 0 0; color: var(--text-secondary); font-size: 0.9375rem; }
.pill { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 10%, white); color: var(--color-primary-dark, #1f57cc); font-size: 12px; font-weight: 700; }

.toolbar-item { width: 180px; }
.toolbar-item--wide { width: 320px; }

.activity-btn { height: 38px; padding: 0 16px; border-radius: 12px; border: 1px solid transparent; font-weight: 600; }
.activity-btn--primary { color: #ffffff; background: linear-gradient(135deg, #3478f6, #3f86ff); box-shadow: 0 10px 20px rgba(52, 120, 246, 0.24); }

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
