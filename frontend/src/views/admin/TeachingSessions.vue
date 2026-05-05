<template>
  <div class="teaching-sessions-page">
    <div class="bg-layer"><div class="bg-orb bg-orb--1"></div><div class="bg-orb bg-orb--2"></div></div>
    <div class="page-hero">
      <span class="pill">教学调试</span>
      <h2 class="page-hero__title">
        <el-icon class="page-title-icon"><Reading /></el-icon>
        教学会话调试
      </h2>
      <p class="page-hero__subtitle">查看和调试 AI 教学会话记录</p>
    </div>

    <div class="toolbar glass-toolbar">
      <el-input v-model="filters.userId" placeholder="按用户 ID 过滤" clearable class="toolbar-item" @keyup.enter="loadSessions" />
      <el-select v-model="filters.status" placeholder="状态" clearable class="toolbar-item">
        <el-option label="进行中" value="active" />
        <el-option label="已完成" value="completed" />
        <el-option label="超时" value="timeout" />
      </el-select>
      <el-checkbox v-model="filters.onlyWithAdvisory">仅看有建议</el-checkbox>
      <el-button type="primary" @click="loadSessions">刷新</el-button>
    </div>

    <div class="table-wrap"><el-table v-loading="loading" :data="sessions" stripe>
      <el-table-column prop="subject" label="主题" min-width="220">
        <template #default="{ row }">
          <div class="topic-cell">
            <strong>{{ row.topic }}</strong>
            <span>{{ row.subject }} · {{ row.taskType }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="userName" label="用户" min-width="180">
        <template #default="{ row }">
          <div class="user-cell">
            <strong>{{ row.userName || row.userId }}</strong>
            <span>{{ row.email || row.userId }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.status)" size="small">{{ getStatusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="duration" label="时长" width="90" align="center" />
      <el-table-column prop="messageCount" label="消息" width="90" align="center" />
      <el-table-column label="Wrapup" min-width="260" show-overflow-tooltip>
        <template #default="{ row }">
          <div v-if="row.wrapup" class="summary-cell">
            <el-tag size="small" :type="row.wrapup.status === 'complete' ? 'success' : 'warning'">{{ row.wrapup.status }}</el-tag>
            <span class="wrapup-text">总结：{{ row.wrapup.sources?.summary || '-' }}</span>
            <span class="wrapup-text">评估：{{ row.wrapup.sources?.evaluation || '-' }}</span>
            <span class="truncate">{{ row.wrapup.summary?.topicSummary || '暂无总结' }}</span>
          </div>
          <span v-else class="muted">暂无</span>
        </template>
      </el-table-column>
      <el-table-column label="建议" min-width="240">
        <template #default="{ row }">
          <div v-if="row.advisory?.shouldSuggest" class="summary-cell">
            <el-tag size="small" :type="priorityTag(row.advisory.priority)">{{ row.advisory.priority }}</el-tag>
            <span>{{ row.advisory.recommendation }}</span>
            <span class="truncate">{{ row.advisory.ui?.title }}</span>
          </div>
          <span v-else class="muted">无建议</span>
        </template>
      </el-table-column>
      <el-table-column label="详情" width="100" align="center">
        <template #default="{ row }">
          <el-button text @click="selectSession(row)">查看</el-button>
        </template>
      </el-table-column>
    </el-table></div>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="limit"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        background
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="handleSizeChange"
        @current-change="handlePageChange"
      />
    </div>

    <el-drawer v-model="detailVisible" size="min(60%, 720px)" :title="selectedSession ? `教学会话 · ${selectedSession.topic}` : '会话详情'" destroy-on-close>
      <div v-if="selectedSession" class="detail-grid">
        <el-card shadow="never">
          <template #header>Wrapup 摘要</template>
          <pre>{{ formatJson(selectedSession.wrapup) }}</pre>
        </el-card>
        <el-card shadow="never">
          <template #header>Advisory 摘要</template>
          <pre>{{ formatJson(selectedSession.advisory) }}</pre>
        </el-card>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { Reading } from '@element-plus/icons-vue';
import { adminTeachingSessionsApi } from '@/api/adminApi';
import { toast } from '../../utils/toast';

const loading = ref(false);
const sessions = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const limit = ref(20);
const detailVisible = ref(false);
const selectedSession = ref<any | null>(null);
const filters = ref({
  userId: '',
  status: '',
  onlyWithAdvisory: false,
});

const loadSessions = async () => {
  loading.value = true;
  try {
    const response: any = await adminTeachingSessionsApi.list({
      page: page.value,
      limit: limit.value,
      userId: filters.value.userId || undefined,
      status: filters.value.status || undefined,
      onlyWithAdvisory: filters.value.onlyWithAdvisory || undefined,
    });
    const data = response.data?.data || response.data || {};
    sessions.value = data.items || [];
    total.value = data.total || 0;
  } catch (error: any) {
    toast.error(error.response?.data?.error?.message || error.message || '加载教学会话失败');
  } finally {
    loading.value = false;
  }
};

const selectSession = (row: any) => {
  selectedSession.value = row;
  detailVisible.value = true;
};

const handleSizeChange = (size: number) => {
  limit.value = size;
  page.value = 1;
  loadSessions();
};

const handlePageChange = (next: number) => {
  page.value = next;
  loadSessions();
};

const priorityTag = (priority: string) => {
  if (priority === 'high') return 'danger';
  if (priority === 'medium') return 'warning';
  if (priority === 'low') return 'success';
  return 'info';
};

const getStatusType = (status: string) => {
  const map: Record<string, string> = {
    active: 'success',
    completed: 'info',
    timeout: 'danger',
    error: 'danger',
  };
  return (map[status] || 'info') as any;
};

const getStatusLabel = (status: string) => {
  const map: Record<string, string> = {
    active: '进行中',
    completed: '已完成',
    timeout: '超时',
    error: '错误',
  };
  return map[status] || status;
};

const formatJson = (value: any) => JSON.stringify(value || {}, null, 2);

watch(() => [filters.value.status, filters.value.onlyWithAdvisory], () => {
  page.value = 1;
  loadSessions();
});

onMounted(loadSessions);
</script>

<style scoped>
.teaching-sessions-page { display: grid; gap: 16px; position: relative; overflow: visible; }

/* Background orbs */
.bg-layer { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.bg-orb { position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0.15; }
.bg-orb--1 { width: 460px; height: 460px; top: -180px; right: -120px; background: radial-gradient(circle, rgba(52, 120, 246, 0.3), transparent 70%); animation: orb-d 26s ease-in-out infinite; }
.bg-orb--2 { width: 380px; height: 380px; left: -100px; bottom: 120px; background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%); animation: orb-d 30s ease-in-out infinite reverse; }
@keyframes orb-d { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -20px) scale(1.05); } 66% { transform: translate(-20px, 30px) scale(0.95); } }

/* Hero */
.page-hero { position: relative; z-index: 1; padding: 24px 28px; border-radius: 20px; border: 1px solid rgba(52, 120, 246, 0.08); background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 34%), linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92)); backdrop-filter: blur(16px); margin-bottom: 1.5rem; }
.page-hero__title { margin: 8px 0 0; font-size: 1.5rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.03em; display: inline-flex; align-items: center; gap: 0.5rem; }
.page-hero__subtitle { margin: 4px 0 0; color: var(--text-secondary); font-size: 0.9375rem; }
.pill { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 10%, white); color: var(--color-primary-dark, #1f57cc); font-size: 12px; font-weight: 700; }

.page-title-icon { color: var(--color-primary); }

/* Toolbar glass */
.glass-toolbar { position: relative; z-index: 1; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 16px 20px; border-radius: 18px; border: 1px solid rgba(52, 120, 246, 0.08); background: linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(244, 247, 252, 0.88)); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
.toolbar-item { width: 180px; }

/* Content z-index */
.table-wrap { position: relative; z-index: 1; overflow-x: auto; }
.pager { position: relative; z-index: 1; display: flex; justify-content: flex-end; }

/* Table overrides */
.table-wrap :deep(.el-table) { border-radius: 18px; overflow: hidden; border: 1px solid rgba(52, 120, 246, 0.06); background: rgba(255, 255, 255, 0.82); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
.table-wrap :deep(.el-table th.el-table__cell) { background: rgba(244, 247, 252, 0.7); font-weight: 600; }
.table-wrap :deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) { background: rgba(244, 247, 252, 0.45); }
.table-wrap :deep(.el-table td.el-table__cell) { border-bottom-color: rgba(52, 120, 246, 0.05); }

.topic-cell, .user-cell, .summary-cell { display: grid; gap: 4px; overflow: hidden; }
.topic-cell span, .user-cell span, .summary-cell span { color: var(--text-secondary); font-size: 12px; }
.wrapup-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.muted { color: var(--text-muted); }
.detail-grid { display: grid; gap: 16px; }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.6; }

[data-theme="dark"] .page-hero { background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.1), transparent 34%), linear-gradient(180deg, rgba(30, 33, 42, 0.92), rgba(24, 27, 35, 0.92)); border-color: rgba(52, 120, 246, 0.12); }
[data-theme="dark"] .pill { background: color-mix(in srgb, var(--color-primary) 18%, transparent); }
[data-theme="dark"] .glass-toolbar { background: linear-gradient(180deg, rgba(30, 33, 42, 0.88), rgba(24, 27, 35, 0.88)); border-color: rgba(52, 120, 246, 0.12); }
[data-theme="dark"] .table-wrap :deep(.el-table) { background: rgba(30, 33, 42, 0.82); border-color: rgba(52, 120, 246, 0.1); }
[data-theme="dark"] .table-wrap :deep(.el-table th.el-table__cell) { background: rgba(36, 39, 49, 0.7); }
[data-theme="dark"] .table-wrap :deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) { background: rgba(36, 39, 49, 0.45); }
[data-theme="dark"] .table-wrap :deep(.el-table td.el-table__cell) { border-bottom-color: rgba(52, 120, 246, 0.07); }
</style>
