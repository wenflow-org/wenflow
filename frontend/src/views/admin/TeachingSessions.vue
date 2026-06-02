<template>
  <div class="teaching-sessions-page">
    <div class="bg-layer"><div class="bg-orb bg-orb--1"></div><div class="bg-orb bg-orb--2"></div></div>
    <div class="page-hero">
      <span class="pill">教学巡检</span>
      <h1 class="page-hero__title admin-page-title">
        <el-icon class="admin-page-title__icon"><Reading /></el-icon>
        教学会话巡检
      </h1>
      <p class="page-hero__subtitle">查看会话状态、产物质量与人工关注项，快速定位需要复核的教学过程。</p>
    </div>

    <div class="stats-grid">
      <div class="mini-stat"><span>总会话</span><strong>{{ sessions.length }}</strong></div>
      <div class="mini-stat"><span>进行中</span><strong>{{ statusSummary.active }}</strong></div>
      <div class="mini-stat"><span>已完成</span><strong>{{ statusSummary.completed }}</strong></div>
      <div class="mini-stat"><span>超时/错误</span><strong>{{ statusSummary.timeout + statusSummary.error }}</strong></div>
      <div class="mini-stat"><span>有建议</span><strong>{{ advisoryCount }}</strong></div>
    </div>

    <div class="toolbar glass-toolbar admin-list-toolbar">
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
      <div class="admin-list-toolbar__group">
        <el-button class="session-btn session-btn--primary" @click="loadSessions">刷新</el-button>
      </div>
    </div>

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
          <el-button class="session-btn session-btn--row" @click="selectSession(row)">查看</el-button>
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
            <p>这通常表示会话尚未完成，或完成后没有成功产出总结与评估结果。</p>
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
        <el-button class="session-btn session-btn--ghost" @click="detailVisible = false">关闭</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
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
  if (row.status === 'timeout') return '会话超时，建议人工复核';
  if (row.status === 'error') return '会话错误，建议查看日志';
  if (row.status === 'completed' && !row.wrapup) return '已完成但无会话总结';
  if (row.advisory?.priority === 'high') return '高优先级建议，建议跟进';
  if (row.advisory?.priority === 'medium') return '中优先级建议，可人工确认';
  if (row.wrapup && !row.wrapup.summary?.topicSummary) return '会话总结缺少摘要信息';
  return '状态稳定';
};

const getAttentionTone = (row: any) => {
  const level = getAttentionLevel(row);
  if (level === '高关注') return 'danger';
  if (level === '中关注') return 'warning';
  return 'safe';
};

const getDetailHeadline = (row: any) => {
  if (row.status === 'timeout') return '该会话已经超时，建议优先核查执行链路与产物缺失原因。';
  if (row.status === 'error') return '该会话执行出错，建议结合日志与产物状态定位问题。';
  if (row.status === 'completed' && !row.wrapup) return '该会话已完成，但没有成功产出会话总结。';
  if (row.status === 'active' && !row.messageCount) return '该会话仍在进行中，但当前几乎没有有效互动数据。';
  if (row.advisory?.shouldSuggest) return row.advisory?.recommendation || '该会话触发了额外建议，建议人工复核。';
  return '当前会话状态整体稳定，可重点查看产物与建议摘要。';
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
.teaching-sessions-page { display: grid; gap: 16px; position: relative; overflow: visible; }

/* Background orbs */
.bg-layer { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.bg-orb { position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0.15; }
.bg-orb--1 { width: 460px; height: 460px; top: -180px; right: -120px; background: radial-gradient(circle, rgba(52, 120, 246, 0.3), transparent 70%); animation: orb-d 26s ease-in-out infinite; }
.bg-orb--2 { width: 380px; height: 380px; left: -100px; bottom: 120px; background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%); animation: orb-d 30s ease-in-out infinite reverse; }
@keyframes orb-d { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -20px) scale(1.05); } 66% { transform: translate(-20px, 30px) scale(0.95); } }

/* Hero */
.page-hero,
.glass-toolbar,
.table-wrap,
.mini-stat,
.detail-card,
.detail-collapse {
  border: 1px solid rgba(205, 216, 238, 0.9);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 255, 0.94));
  box-shadow: 0 16px 42px rgba(42, 72, 128, 0.08);
}

.page-hero { position: relative; z-index: 1; padding: 24px 28px; border-radius: 24px; background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 34%), linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(244, 247, 252, 0.94)); margin-bottom: 0; }
.page-hero__title { margin: 8px 0 0; font-size: 1.6rem; font-weight: 700; color: #22344d; letter-spacing: -0.03em; }
.page-hero__subtitle { margin: 6px 0 0; color: #62758f; font-size: 0.95rem; line-height: 1.65; }
.pill { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px; border-radius: 999px; background: rgba(52, 120, 246, 0.08); color: #2d6df2; font-size: 12px; font-weight: 700; }

/* Toolbar glass */
.toolbar-item { width: 180px; }

.stats-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.mini-stat {
  padding: 12px 14px;
  border-radius: 16px;
  display: grid;
  gap: 6px;
}

.mini-stat span { color: var(--text-secondary); font-size: 12px; }
.mini-stat strong { font-size: 20px; color: var(--text-primary); line-height: 1.2; }

/* Content z-index */
.table-wrap { position: relative; z-index: 1; border-radius: 24px; padding: 4px; }

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

.session-btn {
  min-height: 36px;
  padding: 0 14px;
  border-radius: 14px;
  border: 1px solid transparent;
  font-size: 0.875rem;
  font-weight: 700;
}

.session-btn--primary {
  color: #ffffff;
  background: linear-gradient(135deg, #3478f6, #3f86ff);
  box-shadow: 0 10px 20px rgba(52, 120, 246, 0.24);
}

.session-btn--primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 26px rgba(52, 120, 246, 0.3);
}

.session-btn--row {
  min-height: 30px;
  padding: 0 12px;
  color: var(--color-primary-dark, #1f57cc);
  background: rgba(244, 249, 255, 0.96);
  border-color: rgba(52, 120, 246, 0.16);
}

.session-btn--row:hover {
  color: var(--color-primary-dark, #1f57cc);
  background: rgba(236, 244, 255, 0.98);
  border-color: rgba(52, 120, 246, 0.3);
}

.session-btn--ghost {
  color: #335aa4;
  border-color: rgba(52, 120, 246, 0.2);
  background: rgba(255, 255, 255, 0.92);
}

.session-btn--ghost:hover {
  color: #22478f;
  border-color: rgba(52, 120, 246, 0.38);
  background: rgba(238, 245, 255, 0.92);
}

.detail-card {
  border-radius: 20px;
}

.detail-collapse {
  border-radius: 18px;
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
