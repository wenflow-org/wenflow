<template>
  <div class="admin-page teaching-sessions-page">
    <AdminPageHeader
      v-if="!embedded"
      title="教学会话巡检"
      :icon="Reading"
      :highlights="sessionHighlights"
    >
      <template #actions>
        <el-button :loading="loading" @click="loadSessions">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </template>
    </AdminPageHeader>

    <section v-else class="module-head">
      <div class="module-head__copy">
        <h2>教学会话巡检</h2>
      </div>
    </section>

    <section class="admin-filter-panel">
      <div class="admin-section-head">
        <h3 class="admin-section-head__title">筛选与过滤</h3>
      </div>
      <div class="admin-list-toolbar">
        <div class="admin-list-toolbar__group">
          <el-input v-model="filters.userId" placeholder="按用户 ID 过滤" clearable class="toolbar-item" @keyup.enter="loadSessions" />
          <el-select v-model="filters.status" placeholder="状态" clearable class="toolbar-item">
            <el-option label="进行中" value="active" />
            <el-option label="已完成" value="completed" />
            <el-option label="超时" value="timeout" />
            <el-option label="错误" value="error" />
          </el-select>
          <el-checkbox v-model="filters.onlyWithAdvisory">仅看有建议</el-checkbox>
          <el-checkbox v-model="filters.onlyAttention">仅看待关注</el-checkbox>
          <el-checkbox v-model="filters.onlyMissingWrapup">仅看缺少会话总结</el-checkbox>
        </div>
      </div>
    </section>

    <div class="table-wrap admin-list-card"><el-table v-loading="loading" :data="sessions" stripe>
      <el-table-column label="会话" min-width="260">
        <template #default="{ row }">
          <div class="topic-cell">
            <strong>{{ row.topic }}</strong>
            <span>{{ row.subject }} · {{ getTaskTypeLabel(row.taskType) }}</span>
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
      <el-table-column prop="status" label="状态" width="96">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.status)" size="small">{{ getStatusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="互动规模" width="132" align="center">
        <template #default="{ row }">
          <div class="scale-cell">
            <strong>{{ formatDuration(row.duration) }}</strong>
            <span>{{ row.messageCount || 0 }} 条消息</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="产物状态" min-width="240">
        <template #default="{ row }">
          <div class="summary-cell">
            <div class="artifact-tags">
              <el-tag size="small" :type="getWrapupStatusTag(row)">会话总结 {{ getWrapupStatusText(row) }}</el-tag>
              <el-tag size="small" :type="getAdvisoryStatusTag(row)">Advisory {{ getAdvisoryStatusText(row) }}</el-tag>
            </div>
            <span class="truncate">{{ getArtifactSummary(row) }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="关注提示" min-width="220">
        <template #default="{ row }">
          <div class="summary-cell">
            <div>
              <el-tag size="small" :type="getAttentionTag(row)">{{ getAttentionLevel(row) }}</el-tag>
            </div>
            <span class="truncate">{{ getAttentionText(row) }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="112" align="center">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click="selectSession(row)">查看</el-button>
        </template>
      </el-table-column>
    </el-table></div>

    <div class="pager admin-list-pagination">
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

    <el-drawer v-model="detailVisible" size="min(60%, 760px)" :title="selectedSession ? `教学会话 · ${selectedSession.topic}` : '会话详情'" destroy-on-close class="session-detail-drawer">
      <div v-if="selectedSession" class="detail-grid">
        <div class="detail-banner" :class="`detail-banner--${getAttentionTone(selectedSession)}`">
          <div>
            <strong>{{ getAttentionLevel(selectedSession) }}</strong>
            <p>{{ getDetailHeadline(selectedSession) }}</p>
          </div>
          <el-tag size="small" :type="getStatusType(selectedSession.status)">{{ getStatusLabel(selectedSession.status) }}</el-tag>
        </div>

        <el-card shadow="never" class="detail-card">
          <template #header>会话概况</template>
          <div class="kv-list">
            <div class="kv-item"><span>用户</span><strong>{{ selectedSession.userName || selectedSession.userId }}</strong></div>
            <div class="kv-item"><span>状态</span><strong>{{ getStatusLabel(selectedSession.status) }}</strong></div>
            <div class="kv-item"><span>时长</span><strong>{{ formatDuration(selectedSession.duration) }}</strong></div>
            <div class="kv-item"><span>消息数</span><strong>{{ selectedSession.messageCount || 0 }}</strong></div>
            <div class="kv-item"><span>关注等级</span><strong>{{ getAttentionLevel(selectedSession) }}</strong></div>
          </div>
        </el-card>
        <el-card shadow="never" class="detail-card">
          <template #header>会话总结</template>
          <div v-if="selectedSession.wrapup" class="kv-list">
            <div class="kv-item"><span>状态</span><strong>{{ getWrapupStatusText(selectedSession) }}</strong></div>
            <div class="kv-item"><span>总结来源</span><strong>{{ selectedSession.wrapup?.sources?.summary || '--' }}</strong></div>
            <div class="kv-item"><span>评估来源</span><strong>{{ selectedSession.wrapup?.sources?.evaluation || '--' }}</strong></div>
            <div class="kv-item kv-item--stack"><span>摘要</span><strong>{{ selectedSession.wrapup?.summary?.topicSummary || '暂无摘要内容' }}</strong></div>
          </div>
          <div v-else class="detail-empty-block">
            <strong>当前没有生成会话总结</strong>
            <p>会话未完成或总结未生成。</p>
          </div>
        </el-card>
        <el-card shadow="never" class="detail-card">
          <template #header>Advisory 摘要</template>
          <div v-if="selectedSession.advisory" class="kv-list">
            <div class="kv-item"><span>是否触发</span><strong>{{ selectedSession.advisory?.shouldSuggest ? '是' : '否' }}</strong></div>
            <div class="kv-item"><span>优先级</span><strong>{{ selectedSession.advisory?.priority || '--' }}</strong></div>
            <div class="kv-item kv-item--stack"><span>建议</span><strong>{{ selectedSession.advisory?.recommendation || '暂无建议内容' }}</strong></div>
            <div class="kv-item"><span>UI 标题</span><strong>{{ selectedSession.advisory?.ui?.title || '--' }}</strong></div>
          </div>
          <div v-else class="detail-empty-block">
            <strong>当前没有 Advisory 建议</strong>
            <p>说明系统没有触发额外提醒，或当前会话还没有形成足够的判断依据。</p>
          </div>
        </el-card>
        <el-collapse v-if="selectedSession.wrapup || selectedSession.advisory" class="detail-collapse">
          <el-collapse-item v-if="selectedSession.wrapup" title="查看原始会话总结数据" name="wrapup">
            <pre>{{ formatJson(selectedSession.wrapup) }}</pre>
          </el-collapse-item>
          <el-collapse-item v-if="selectedSession.advisory" title="查看原始 Advisory JSON" name="advisory">
            <pre>{{ formatJson(selectedSession.advisory) }}</pre>
          </el-collapse-item>
        </el-collapse>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Reading, Refresh } from '@element-plus/icons-vue';
import { adminTeachingSessionsApi } from '@/api/adminApi';
import { toast } from '../../utils/toast';
import AdminPageHeader from './components/AdminPageHeader.vue';

withDefaults(defineProps<{ embedded?: boolean }>(), {
  embedded: false,
});

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
  onlyAttention: false,
  onlyMissingWrapup: false,
});

const statusSummary = computed(() => {
  return sessions.value.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    { active: 0, completed: 0, timeout: 0, error: 0 } as Record<string, number>
  );
});

const advisoryCount = computed(() => sessions.value.filter((item) => item.advisory?.shouldSuggest).length);

const sessionHighlights = computed(() => [
  { label: `${sessions.value.length} 个会话`, tone: 'info' as const },
  { label: `${statusSummary.value.active} 进行中`, tone: 'success' as const },
  { label: `${statusSummary.value.completed} 已完成`, tone: 'neutral' as const },
  { label: `${statusSummary.value.timeout + statusSummary.value.error} 超时/错误`, tone: statusSummary.value.timeout + statusSummary.value.error > 0 ? 'danger' as const : 'neutral' as const },
  { label: `${advisoryCount.value} 有建议`, tone: advisoryCount.value > 0 ? 'warning' as const : 'neutral' as const },
]);

const getTaskTypeLabel = (type: string) => ({
  reading: '阅读',
  practice: '练习',
  project: '项目',
  quiz: '测验',
  acquire: '获取',
  deconstruct: '拆解',
  model: '建模',
  execute: '执行',
  diagnose: '诊断',
  refine: '优化',
  consolidate: '巩固'
}[type] || type || '任务');

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
    let items = data.items || [];
    if (filters.value.onlyMissingWrapup) {
      items = items.filter((item: any) => !item.wrapup || !item.wrapup.summary?.topicSummary);
    }
    if (filters.value.onlyAttention) {
      items = items.filter((item: any) => getAttentionLevel(item) !== '低关注');
    }
    sessions.value = items;
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

const formatDuration = (duration: number | null | undefined) => {
  if (duration === null || duration === undefined) return '--';
  if (duration < 60) return `${duration}s`;
  const min = Math.floor(duration / 60);
  const sec = duration % 60;
  return `${min}m ${sec}s`;
};

const getWrapupStatusText = (row: any) => {
  if (!row.wrapup) return '缺失';
  if (row.wrapup.status === 'complete') return '完成';
  return row.wrapup.status || '处理中';
};

const getWrapupStatusTag = (row: any) => {
  if (!row.wrapup) return 'danger';
  if (row.wrapup.status === 'complete') return 'success';
  return 'warning';
};

const getAdvisoryStatusText = (row: any) => {
  return row.advisory?.shouldSuggest ? row.advisory?.priority || '触发' : '未触发';
};

const getAdvisoryStatusTag = (row: any) => {
  if (!row.advisory?.shouldSuggest) return 'info';
  return priorityTag(row.advisory.priority);
};

const getArtifactSummary = (row: any) => {
  if (!row.wrapup && !row.advisory?.shouldSuggest) return '暂无产物';
    if (row.wrapup && !row.wrapup.summary?.topicSummary) return '会话总结缺少摘要';
  if (row.advisory?.shouldSuggest) return row.advisory.recommendation || '有建议待处理';
  return row.wrapup?.summary?.topicSummary || '产物正常';
};

const getAttentionLevel = (row: any) => {
  if (row.status === 'timeout' || row.status === 'error') return '高关注';
  if (row.status === 'completed' && !row.wrapup) return '高关注';
  if (row.advisory?.priority === 'high') return '高关注';
  if (row.advisory?.priority === 'medium') return '中关注';
  if (row.wrapup && !row.wrapup.summary?.topicSummary) return '中关注';
  return '低关注';
};

const getAttentionTag = (row: any) => {
  const level = getAttentionLevel(row);
  if (level === '高关注') return 'danger';
  if (level === '中关注') return 'warning';
  return 'success';
};

const getAttentionText = (row: any) => {
  if (row.status === 'timeout') return '会话超时';
  if (row.status === 'error') return '会话错误';
  if (row.status === 'completed' && !row.wrapup) return '已完成但无会话总结';
  if (row.advisory?.priority === 'high') return '高优先级建议';
  if (row.advisory?.priority === 'medium') return '中优先级建议';
  if (row.wrapup && !row.wrapup.summary?.topicSummary) return '缺少摘要';
  return '状态稳定';
};

const getAttentionTone = (row: any) => {
  const level = getAttentionLevel(row);
  if (level === '高关注') return 'danger';
  if (level === '中关注') return 'warning';
  return 'safe';
};

const getDetailHeadline = (row: any) => {
  if (row.status === 'timeout') return '会话超时，请核查执行链路。';
  if (row.status === 'error') return '会话出错，请查看日志。';
  if (row.status === 'completed' && !row.wrapup) return '已完成但未产出总结。';
  if (row.status === 'active' && !row.messageCount) return '会话进行中但缺少互动。';
  if (row.advisory?.shouldSuggest) return row.advisory?.recommendation || '已触发建议，请复核。';
  return '会话稳定，查看产物摘要。';
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

watch(() => [
  filters.value.status,
  filters.value.onlyWithAdvisory,
  filters.value.onlyAttention,
  filters.value.onlyMissingWrapup,
], () => {
  page.value = 1;
  loadSessions();
});

onMounted(loadSessions);
</script>

<style scoped>
.module-head {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: var(--admin-border-subtle);
}

.module-head__copy {
  display: grid;
  gap: 6px;
}

.module-head__kicker {
  display: inline-flex;
  width: fit-content;
  min-height: 24px;
  align-items: center;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: var(--admin-text-brand);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.module-head__copy h2 {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.25;
  color: var(--admin-text-primary);
}

.module-head__copy p {
  margin: 0;
  color: var(--admin-text-muted);
  line-height: 1.6;
}

.teaching-sessions-page {
  display: grid;
  gap: 16px;
}

/* Content */
.table-wrap,
.detail-card,
.detail-collapse {
  border: var(--admin-border-subtle);
  background: var(--admin-bg-surface);
  box-shadow: none;
}

.toolbar-item {
  width: 180px;
}

/* Content z-index */
.table-wrap {
  position: relative;
  z-index: 1;
  border-radius: var(--admin-radius-md);
  padding: 0;
}

/* Table overrides */
.topic-cell, .user-cell, .summary-cell { display: grid; gap: 4px; overflow: hidden; }
.topic-cell span, .user-cell span, .summary-cell span { color: var(--text-secondary); font-size: 12px; }
.scale-cell { display: grid; gap: 2px; line-height: 1.2; }
.scale-cell span { color: var(--text-secondary); font-size: 12px; }
.artifact-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.muted { color: var(--text-muted); }
.detail-grid { display: grid; gap: 16px; }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.6; }
.kv-list { display: grid; gap: 10px; }
.kv-item { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.kv-item--stack {
  display: grid;
  gap: 6px;
}
.detail-banner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  background: rgba(255, 255, 255, 0.9);
}
.detail-banner strong {
  display: block;
  margin-bottom: 6px;
  font-size: 0.98rem;
  color: #22344d;
}
.detail-banner p {
  margin: 0;
  color: #62758f;
  line-height: 1.6;
  font-size: 0.88rem;
}
.detail-banner--danger {
  border-color: rgba(244, 118, 118, 0.22);
  background: rgba(255, 247, 247, 0.94);
}
.detail-banner--warning {
  border-color: rgba(244, 170, 70, 0.24);
  background: rgba(255, 249, 241, 0.94);
}
.detail-banner--safe {
  border-color: rgba(93, 195, 128, 0.24);
  background: rgba(246, 251, 247, 0.94);
}
.detail-empty-block {
  display: grid;
  gap: 8px;
  padding: 4px 0;
}
.detail-empty-block strong {
  color: #22344d;
  font-size: 0.95rem;
}
.detail-empty-block p {
  margin: 0;
  color: #62758f;
  line-height: 1.65;
  font-size: 0.88rem;
}

.detail-card {
  border-radius: 16px;
}

.detail-collapse {
  border-radius: 16px;
  overflow: hidden;
}

:deep(.el-table th.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
  font-weight: 700;
}

:deep(.el-table .el-table__row:hover > td.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
}

:deep(.session-detail-drawer .el-drawer) {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 255, 0.96));
}

:deep(.session-detail-drawer .el-drawer__header) {
  margin-bottom: 0;
  padding: 20px 24px 16px;
  border-bottom: 1px solid rgba(52, 120, 246, 0.08);
  color: #22344d;
  font-weight: 700;
}

:deep(.session-detail-drawer .el-drawer__body) {
  padding: 20px;
  background: linear-gradient(180deg, rgba(248, 250, 255, 0.72), rgba(244, 247, 252, 0.82));
}

:deep(.session-detail-drawer .el-drawer__footer) {
  padding: 12px 20px 20px;
  border-top: 1px solid rgba(52, 120, 246, 0.08);
}

:deep(.detail-card .el-card__header) {
  border-bottom-color: rgba(52, 120, 246, 0.08);
  color: #22344d;
  font-weight: 700;
}

:deep(.detail-collapse .el-collapse-item__header) {
  background: rgba(255, 255, 255, 0.86);
  color: #22344d;
  font-weight: 600;
  padding: 0 16px;
}

:deep(.detail-collapse .el-collapse-item__content) {
  padding: 16px;
  background: rgba(249, 251, 255, 0.92);
}

@media (max-width: 1100px) {
  .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

</style>
