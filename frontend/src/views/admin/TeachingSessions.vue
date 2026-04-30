<template>
  <div class="teaching-sessions-page">
    <div class="page-header">
      <h2 class="page-title">
        <el-icon class="page-title-icon"><Reading /></el-icon>
        教学会话调试
      </h2>
      <p class="page-subtitle">查看和调试 AI 教学会话记录</p>
    </div>

    <div class="toolbar">
      <el-input v-model="filters.userId" placeholder="按用户 ID 过滤" clearable class="toolbar-item" />
      <el-select v-model="filters.status" placeholder="状态" clearable class="toolbar-item">
        <el-option label="active" value="active" />
        <el-option label="completed" value="completed" />
        <el-option label="timeout" value="timeout" />
      </el-select>
      <el-checkbox v-model="filters.onlyWithAdvisory">仅看有建议</el-checkbox>
      <el-button type="primary" @click="loadSessions">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="sessions" stripe>
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
      <el-table-column prop="status" label="状态" width="110" />
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
    </el-table>

    <div class="pager">
      <el-pagination
        background
        layout="prev, pager, next, total"
        :total="total"
        :current-page="page"
        :page-size="limit"
        @current-change="handlePageChange"
      />
    </div>

    <el-drawer v-model="detailVisible" size="60%" :title="selectedSession ? `教学会话 · ${selectedSession.topic}` : '会话详情'">
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
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Reading } from '@element-plus/icons-vue';
import { adminTeachingSessionsApi } from '@/api/adminApi';

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
    ElMessage.error(error.response?.data?.error?.message || error.message || '加载教学会话失败');
  } finally {
    loading.value = false;
  }
};

const selectSession = (row: any) => {
  selectedSession.value = row;
  detailVisible.value = true;
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

const formatJson = (value: any) => JSON.stringify(value || {}, null, 2);

onMounted(loadSessions);
</script>

<style scoped>
.teaching-sessions-page { display: grid; gap: 16px; }
.page-header { margin-bottom: 0; }
.page-title { margin: 0; font-size: 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 0.5rem; }
.page-title-icon { color: var(--color-primary); }
.page-subtitle { margin: 6px 0 0; color: var(--text-secondary); }
.toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.toolbar-item { width: 180px; }
.topic-cell, .user-cell, .summary-cell { display: grid; gap: 4px; overflow: hidden; }
.topic-cell span, .user-cell span, .summary-cell span { color: var(--text-secondary); font-size: 12px; }
.wrapup-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.muted { color: var(--text-muted); }
.pager { display: flex; justify-content: flex-end; }
.detail-grid { display: grid; gap: 16px; }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.6; }

[data-theme="dark"] .teaching-sessions-page {
  background: var(--glass-bg-dark);
}

[data-theme="dark"] .toolbar {
  background: var(--glass-bg-dark);
  border-color: var(--glass-border-dark);
}
</style>
