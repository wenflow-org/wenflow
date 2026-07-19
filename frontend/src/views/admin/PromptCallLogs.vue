<template>
  <div class="admin-page prompt-call-logs-page">
    <AdminPageHeader
      title="Prompt 调用日志"
      :icon="Document"
      :highlights="promptLogHighlights"
    />

    <section class="admin-filter-panel">
      <div class="admin-section-head">
      <div class="admin-section-head__copy">
          <h3 class="admin-section-head__title">调用筛选</h3>
        </div>
        <el-button class="filter-toggle" text @click="filterExpanded = !filterExpanded">
          {{ filterExpanded ? '收起' : `展开${activeFilterCount ? ` · ${activeFilterCount} 项` : ''}` }}
        </el-button>
      </div>
      <div v-show="filterExpanded" class="admin-filter-grid admin-filter-grid--wide prompt-filter-grid">
        <div class="admin-filter-field">
          <label class="admin-filter-field__label">节点</label>
          <el-input v-model="filters.agentId" clearable class="filter-input" />
        </div>
        <div class="admin-filter-field">
          <label class="admin-filter-field__label">路径 ID</label>
          <el-input v-model="filters.pathId" clearable class="filter-input" />
        </div>
        <div class="admin-filter-field">
          <label class="admin-filter-field__label">运行批次</label>
          <el-input v-model="filters.pipelineRunId" clearable class="filter-input" />
        </div>
        <div class="admin-filter-field">
          <label class="admin-filter-field__label">Trace ID</label>
          <el-input v-model="filters.traceId" clearable class="filter-input" />
        </div>
        <div class="admin-filter-field">
          <label class="admin-filter-field__label">结果状态</label>
          <el-select v-model="filters.status" placeholder="全部状态" clearable class="filter-select">
            <el-option label="成功" value="success" />
            <el-option label="失败" value="error" />
            <el-option label="漂移" value="drift" />
          </el-select>
        </div>
        <div class="admin-filter-field">
          <label class="admin-filter-field__label">列表数量</label>
          <el-select v-model="filters.limit" class="filter-select">
            <el-option :value="20" label="20 条" />
            <el-option :value="50" label="50 条" />
            <el-option :value="100" label="100 条" />
          </el-select>
        </div>
        <div class="filter-actions">
          <el-button type="primary" :loading="loading" @click="loadLogs">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </div>
      </div>
    </section>

    <el-alert v-if="loadError" type="error" :closable="false" show-icon title="Prompt 日志加载失败">
      <template #default>
        <div class="admin-error-row">
          <span>{{ loadError }}</span>
          <el-button size="small" @click="loadLogs">重试</el-button>
        </div>
      </template>
    </el-alert>

    <section class="prompt-results-shell">
      <div class="admin-section-head prompt-results-shell__head">
        <div class="admin-section-head__copy">
          <h3 class="admin-section-head__title">调用结果</h3>
        </div>
      </div>
      <div class="prompt-results-toolbar">
        <span class="prompt-results-toolbar__count">{{ logs.length }} 条结果</span>
      </div>
      <div class="logs-list" v-loading="loading">
      <div v-if="logs.length" class="prompt-log-list">
        <article
          v-for="log in logs"
          :key="log.id"
          class="prompt-log-card"
          :class="{ 'is-error': !log.success, 'is-drift': !!log.promptDrift }"
          role="button"
          tabindex="0"
          @click="openDetail(log)"
          @keydown.enter="openDetail(log)"
          @keydown.space.prevent="openDetail(log)"
        >
          <div class="prompt-log-card__head">
            <div class="prompt-log-card__headline">
              <div class="prompt-log-card__meta">
                <span class="prompt-log-card__time">{{ formatTime(log.createdAt) }}</span>
                <strong class="prompt-log-card__agent">{{ log.agentId }}</strong>
                <el-tag size="small" :type="log.success ? 'success' : 'danger'">{{ log.success ? '成功' : '失败' }}</el-tag>
                <el-tag v-if="log.promptDrift" size="small" type="warning">Prompt 漂移</el-tag>
                <el-tag v-if="log.systemPromptVersion" size="small" effect="plain">v{{ log.systemPromptVersion }}</el-tag>
              </div>
              <div v-if="describeLogIssue(log)" class="prompt-log-card__summary">
                <span class="prompt-summary-label">诊断</span>
                <span class="prompt-summary-text">{{ describeLogIssue(log) }}</span>
              </div>
            </div>

            <div class="prompt-log-card__rail">
              <div class="prompt-log-card__duration">{{ log.durationMs }}ms</div>
              <el-button class="prompt-log-card__detail-btn" @click.stop="openDetail(log)">查看详情</el-button>
            </div>
          </div>

          <div class="prompt-log-card__footer">
            <div class="prompt-log-card__meta-row">
              <span v-if="log.pathId">路径 {{ log.pathId }}</span>
              <span v-if="log.conversationId">会话 {{ log.conversationId }}</span>
              <span v-if="log.pipelineRunId">运行批次 {{ log.pipelineRunId }}</span>
              <span v-if="log.pipelineStepIndex !== null && log.pipelineStepIndex !== undefined">步骤 {{ log.pipelineStepIndex }}</span>
              <span v-if="log.traceId">Trace {{ log.traceId }}</span>
              <span v-if="!log.extractedJson">未提取 JSON</span>
              <span v-if="!log.normalizedOutput">缺少标准化输出</span>
            </div>

            <div class="prompt-log-card__error-row" v-if="log.errorCode || log.errorMessage">
              <span class="prompt-log-card__error-code" v-if="log.errorCode">{{ log.errorCode }}</span>
              <span class="prompt-log-card__error-message">{{ log.errorMessage || '未记录详细错误信息' }}</span>
            </div>
          </div>
        </article>
      </div>
      <el-empty v-else description="暂无调用记录" />
      </div>
    </section>

    <el-drawer v-model="detailVisible" size="min(calc(100vw - 24px), 880px)" destroy-on-close>
      <template #header>
        <div class="detail-header">
          <strong>{{ selectedLog?.agentId || 'Prompt Call' }}</strong>
          <span>{{ selectedLog?.id || '' }}</span>
        </div>
      </template>

      <div v-if="selectedLog" class="detail-body">
        <div class="detail-overview-grid detail-overview-grid--lead">
          <div class="detail-overview-card">
            <span class="detail-overview-card__label">状态</span>
            <div class="detail-overview-card__tags">
              <el-tag size="small" :type="selectedLog.success ? 'success' : 'danger'">{{ selectedLog.success ? '成功' : '失败' }}</el-tag>
              <el-tag v-if="selectedLog.promptDrift" size="small" type="warning">漂移</el-tag>
            </div>
          </div>
          <div class="detail-overview-card">
            <span class="detail-overview-card__label">Prompt 版本</span>
            <strong>{{ selectedLog.systemPromptVersion ? `v${selectedLog.systemPromptVersion}` : '未记录' }}</strong>
          </div>
          <div class="detail-overview-card">
            <span class="detail-overview-card__label">时间</span>
            <strong>{{ formatTime(selectedLog.createdAt) }}</strong>
          </div>
          <div class="detail-overview-card">
            <span class="detail-overview-card__label">耗时</span>
            <strong>{{ selectedLog.durationMs }}ms</strong>
          </div>
          <div class="detail-overview-card">
            <span class="detail-overview-card__label">路径</span>
            <strong>{{ selectedLog.pathId || '未记录' }}</strong>
          </div>
          <div class="detail-overview-card">
            <span class="detail-overview-card__label">运行批次</span>
            <strong>{{ selectedLog.pipelineRunId || '未记录' }}</strong>
          </div>
          <div class="detail-overview-card">
            <span class="detail-overview-card__label">步骤</span>
            <strong>{{ selectedLog.pipelineStepIndex ?? '未记录' }}</strong>
          </div>
          <div class="detail-overview-card">
            <span class="detail-overview-card__label">Trace</span>
            <strong>{{ selectedLog.traceId || '未记录' }}</strong>
          </div>
          <div v-if="selectedLog.errorCode" class="detail-overview-card">
            <span class="detail-overview-card__label">错误码</span>
            <strong>{{ selectedLog.errorCode }}</strong>
          </div>
        </div>

        <div
          v-if="selectedLog.promptDrift || selectedLog.errorMessage"
          class="detail-issue-row"
          :class="selectedLog.promptDrift ? 'detail-issue-row--warning' : 'detail-issue-row--error'"
        >
          <span class="detail-issue-message">{{ selectedLog.errorMessage || '发现 Prompt 版本漂移' }}</span>
        </div>

        <el-tabs class="detail-tabs">
          <el-tab-pane label="输入载荷">
            <pre>{{ selectedLog.userPayload }}</pre>
          </el-tab-pane>
          <el-tab-pane label="模型原始输出">
            <pre>{{ selectedLog.rawModelOutput || '--' }}</pre>
          </el-tab-pane>
          <el-tab-pane label="提取 JSON">
            <pre>{{ selectedLog.extractedJson || '--' }}</pre>
          </el-tab-pane>
          <el-tab-pane label="归一化输出">
            <pre>{{ JSON.stringify(selectedLog.normalizedOutput, null, 2) }}</pre>
          </el-tab-pane>
          <el-tab-pane label="Token Usage">
            <pre>{{ JSON.stringify(selectedLog.tokenUsage, null, 2) }}</pre>
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Document } from '@element-plus/icons-vue';
import { adminRuntimeDefinitionsApi } from '@/api/adminApi';
import AdminPageHeader from './components/AdminPageHeader.vue';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const loadError = ref('');
const filterExpanded = ref(typeof window === 'undefined' || window.innerWidth > 768);
interface PromptCallLogItem {
  id: string;
  success?: boolean;
  promptDrift?: boolean;
  createdAt?: string;
  agentId?: string;
  systemPromptVersion?: string | number;
  durationMs?: number;
  pathId?: string;
  conversationId?: string;
  pipelineRunId?: string;
  pipelineStepIndex?: number;
  traceId?: string;
  extractedJson?: unknown;
  normalizedOutput?: unknown;
  errorCode?: string;
  errorMessage?: string;
  userPayload?: unknown;
  rawModelOutput?: unknown;
  tokenUsage?: unknown;
  [key: string]: unknown;
}

const detailVisible = ref(false);
const selectedLog = ref<PromptCallLogItem | null>(null);
const logs = ref<PromptCallLogItem[]>([]);
const filters = ref({
  agentId: '',
  pathId: '',
  pipelineRunId: '',
  traceId: '',
  parentExecutionId: '',
  status: '',
  limit: 50,
});

const activeFilterCount = computed(() => [
  filters.value.agentId,
  filters.value.pathId,
  filters.value.pipelineRunId,
  filters.value.traceId,
  filters.value.status,
  filters.value.limit !== 50 ? filters.value.limit : '',
].filter(Boolean).length);

const successCount = computed(() => logs.value.filter((item) => item.success).length);
const errorCount = computed(() => logs.value.filter((item) => !item.success).length);
const driftCount = computed(() => logs.value.filter((item) => item.promptDrift).length);
const promptLogHighlights = computed(() => [
  { label: `${logs.value.length} 条记录`, tone: 'info' as const },
  { label: `成功 ${successCount.value}`, tone: 'success' as const },
  { label: `失败 ${errorCount.value}`, tone: errorCount.value > 0 ? 'danger' as const : 'neutral' as const },
  { label: `漂移 ${driftCount.value}`, tone: driftCount.value > 0 ? 'warning' as const : 'neutral' as const }
]);
const formatTime = (value: string | undefined) => {
  if (!value) return '--';
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

const describeLogIssue = (log: PromptCallLogItem) => {
  if (log.success) {
    if (!log.normalizedOutput) return '成功，但缺少归一化输出。';
    return '';
  }

  if (log.errorMessage) return '';
  if (log.errorCode) return `失败，错误码 ${log.errorCode}`;
  if (!log.extractedJson) return '失败，未提取 JSON。';
  return '失败。';
};

const openDetail = (log: PromptCallLogItem) => {
  selectedLog.value = log;
  detailVisible.value = true;
};

const syncRouteQuery = () => {
  const query: Record<string, string> = {};
  if (filters.value.agentId.trim()) query.agentId = filters.value.agentId.trim();
  if (filters.value.pathId.trim()) query.pathId = filters.value.pathId.trim();
  if (filters.value.pipelineRunId.trim()) query.pipelineRunId = filters.value.pipelineRunId.trim();
  if (filters.value.traceId.trim()) query.traceId = filters.value.traceId.trim();
  if (filters.value.parentExecutionId.trim()) query.parentExecutionId = filters.value.parentExecutionId.trim();
  if (filters.value.status.trim()) query.status = filters.value.status.trim();
  if (filters.value.limit !== 50) query.limit = String(filters.value.limit);
  router.replace({ query });
};

const hydrateFiltersFromRoute = () => {
  filters.value.agentId = typeof route.query.agentId === 'string' ? route.query.agentId : '';
  filters.value.pathId = typeof route.query.pathId === 'string' ? route.query.pathId : '';
  filters.value.pipelineRunId = typeof route.query.pipelineRunId === 'string' ? route.query.pipelineRunId : '';
  filters.value.traceId = typeof route.query.traceId === 'string' ? route.query.traceId : '';
  filters.value.parentExecutionId = typeof route.query.parentExecutionId === 'string' ? route.query.parentExecutionId : '';
  filters.value.status = typeof route.query.status === 'string' ? route.query.status : '';
  filters.value.limit = typeof route.query.limit === 'string' && Number.isFinite(Number(route.query.limit))
    ? Number(route.query.limit)
    : 50;
};

const loadLogs = async () => {
  loading.value = true;
  loadError.value = '';
  try {
    const response = await adminRuntimeDefinitionsApi.getPromptCallLogs({
      limit: filters.value.limit,
      agentId: filters.value.agentId || undefined,
      pathId: filters.value.pathId || undefined,
      pipelineRunId: filters.value.pipelineRunId || undefined,
      traceId: filters.value.traceId || undefined,
      parentExecutionId: filters.value.parentExecutionId || undefined,
      // 状态过滤下沉到服务端，避免只过滤当前页造成的"全量"误解
      status: (filters.value.status as 'success' | 'error' | 'drift') || undefined,
    });
    logs.value = response.data.data || [];
  } catch (error: any) {
    loadError.value = error.response?.data?.error?.message || '无法获取 Prompt 日志，请检查服务连接后重试。';
  } finally {
    loading.value = false;
  }
};

const handleReset = () => {
  filters.value = {
    agentId: '',
    pathId: '',
    pipelineRunId: '',
    traceId: '',
    parentExecutionId: '',
    status: '',
    limit: 50,
  };
  syncRouteQuery();
  loadLogs();
};

onMounted(() => {
  hydrateFiltersFromRoute();
  loadLogs();
});

watch(() => route.query, () => {
  hydrateFiltersFromRoute();
});

watch(filters, () => {
  syncRouteQuery();
}, { deep: true });
</script>

<style scoped>
.prompt-call-logs-page {
  display: grid;
  gap: 14px;
  position: relative;
}

.prompt-summary-meta {
  margin-top: 8px;
  font-size: 12px;
  color: var(--admin-text-secondary);
}

.prompt-filter-grid {
  grid-template-columns: repeat(5, minmax(0, 1fr)) auto;
}

.filter-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.prompt-results-shell {
  display: grid;
  gap: 14px;
  padding-top: 4px;
  border-top: var(--admin-border-subtle);
}

.prompt-results-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.prompt-results-toolbar__count {
  color: var(--admin-text-primary);
  font-size: 12px;
  font-weight: 700;
}

.prompt-results-toolbar__note {
  margin: 0;
  color: var(--admin-text-muted);
  font-size: 12px;
}

.prompt-results-shell__head {
  margin-bottom: 0;
}

.logs-list {
  width: 100%;
}

.prompt-log-list {
  display: grid;
  gap: 12px;
}

.prompt-log-card {
  border: var(--admin-border);
  border-radius: var(--admin-radius-sm);
  padding: 12px 14px;
  background: var(--admin-bg-surface);
  box-shadow: none;
  display: grid;
  gap: 8px;
}

.prompt-log-card.is-error {
  border-color: var(--admin-color-error-border);
  box-shadow: inset 3px 0 0 var(--admin-color-error);
}

.prompt-log-card.is-drift {
  box-shadow: inset 3px 0 0 var(--admin-color-warning);
}

.prompt-log-card:focus-visible {
  border-color: var(--admin-text-brand);
  box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.12);
}

.filter-toggle {
  display: none;
}

.admin-error-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.prompt-log-card__head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.prompt-log-card__headline {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.prompt-log-card__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.prompt-log-card__agent {
  color: var(--admin-text-primary);
  font-size: var(--admin-text-title-sm);
  line-height: 1.3;
}

.prompt-log-card__time,
.prompt-log-card__duration {
  color: var(--admin-text-secondary);
  font-size: 12px;
}

.prompt-log-card__summary {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 12px;
  line-height: 1.55;
}

.prompt-summary-label {
  color: #7b8ba3;
  font-weight: 700;
  flex-shrink: 0;
}

.prompt-summary-text {
  color: var(--admin-text-muted);
}

.prompt-log-card__rail {
  display: grid;
  justify-items: end;
  align-content: start;
  gap: 6px;
  min-width: 92px;
}

.prompt-log-card__duration {
  font-size: 12px;
}

.prompt-log-card__footer {
  display: grid;
  gap: 6px;
}

.prompt-log-card__meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--admin-text-secondary);
  font-size: 12px;
}

.prompt-log-card__meta-row span {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: #f3f6fb;
}

.prompt-log-card__error-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: 12px;
}

.prompt-log-card__error-code {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.08);
  color: #d14343;
  font-size: var(--admin-text-micro);
  font-weight: 700;
}

.prompt-log-card__error-message {
  color: var(--admin-text-muted);
  line-height: 1.5;
  font-size: 12px;
}

.prompt-log-card__actions {
  display: flex;
  justify-content: flex-end;
}

.prompt-log-card__detail-btn {
  min-height: 30px;
  padding: 0 12px;
}

.detail-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
  min-width: 0;
}

.detail-overview-grid {
  min-width: 0;
}
.detail-overview-card {
  border: 1px solid var(--admin-border-color);
  border-radius: var(--admin-radius-sm);
  background: var(--admin-bg-surface-alt);
  padding: 12px 14px;
  display: grid;
  gap: 6px;
  min-width: 0;
}

.detail-overview-card__label {
  color: #7b8ba3;
  font-size: 12px;
  font-weight: 700;
}

.detail-overview-card strong {
  color: var(--admin-text-primary);
  font-size: var(--admin-text-title-sm);
  word-break: break-word;
}

.detail-overview-card__tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.detail-overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding-top: 4px;
  border-top: var(--admin-border-subtle);
}

.detail-overview-grid--lead {
  padding-top: 0;
  border-top: none;
}

.detail-issue-row {
  padding: 12px 14px;
  border-radius: var(--admin-radius-sm);
  font-size: 13px;
  line-height: 1.6;
}

.detail-issue-row--warning {
  background: var(--admin-color-warning-bg);
  color: #9a3412;
}

.detail-issue-row--error {
  background: var(--admin-color-error-bg);
  color: #b91c1c;
}

.detail-issue-message {
  display: block;
  word-break: break-word;
}

.detail-tabs {
  padding-top: 4px;
  border-top: var(--admin-border-subtle);
  min-width: 0;
}

.detail-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}

.detail-tabs pre {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 16px;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 12px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.6;
}

@media (max-width: 960px) {
  .detail-overview-grid,
  .prompt-log-card__head {
    grid-template-columns: minmax(0, 1fr);
  }

  .prompt-filter-grid {
    grid-template-columns: 1fr;
  }

  .prompt-log-card__head {
    display: grid;
    align-items: flex-start;
  }

  .prompt-log-card__rail {
    justify-items: start;
  }

  .filter-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 768px) {
  .filter-toggle {
    display: inline-flex;
  }

  .prompt-log-card__meta-row span,
  .prompt-log-card__agent,
  .detail-header span {
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  .prompt-log-card__detail-btn {
    min-width: 100%;
  }

  .admin-error-row {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
