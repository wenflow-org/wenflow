<template>
  <div class="prompt-call-logs-page">
    <div class="page-hero">
      <h2 class="page-hero__title admin-page-title">Prompt Call Logs</h2>
      <p class="page-hero__subtitle">查看提示词调用的真实产物：输入载荷、模型原始输出、提取 JSON 与归一化结果，适合排查结构漂移和版本行为差异。</p>
    </div>

    <div class="stats-bar" v-if="logs.length">
      <div class="stat-item">
        <span class="stat-label">当前列表</span>
        <span class="stat-value">{{ logs.length }}</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-item success">
        <span class="stat-dot success"></span>
        <span class="stat-label">成功</span>
        <span class="stat-value">{{ successCount }}</span>
        <span class="stat-percent">({{ logs.length ? Math.round((successCount / logs.length) * 100) : 0 }}%)</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-item error">
        <span class="stat-dot error"></span>
        <span class="stat-label">失败</span>
        <span class="stat-value">{{ errorCount }}</span>
        <span class="stat-percent">({{ logs.length ? Math.round((errorCount / logs.length) * 100) : 0 }}%)</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-item drift">
        <span class="stat-dot drift"></span>
        <span class="stat-label">漂移标记</span>
        <span class="stat-value">{{ driftCount }}</span>
      </div>
    </div>

    <div class="filter-section">
      <div class="filter-section__intro">
        <div>
          <h3>调用筛选</h3>
          <p>先按 agent、路径、批次和结果状态收窄范围，再打开单次调用详情检查输入输出链路。</p>
        </div>
      </div>
      <div class="filter-row">
        <div class="filter-item">
          <label>Agent / Skill</label>
          <el-input v-model="filters.agentId" placeholder="agentId / skillId" clearable class="filter-input" />
        </div>
        <div class="filter-item">
          <label>Path ID</label>
          <el-input v-model="filters.pathId" placeholder="pathId" clearable class="filter-input" />
        </div>
        <div class="filter-item">
          <label>Pipeline Run</label>
          <el-input v-model="filters.pipelineRunId" placeholder="pipelineRunId" clearable class="filter-input" />
        </div>
        <div class="filter-item">
          <label>结果状态</label>
          <el-select v-model="filters.status" placeholder="全部状态" clearable class="filter-select">
            <el-option label="成功" value="success" />
            <el-option label="失败" value="error" />
            <el-option label="漂移" value="drift" />
          </el-select>
        </div>
        <div class="filter-item">
          <label>列表数量</label>
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
    </div>

    <div class="logs-list" v-loading="loading">
      <div v-if="logs.length" class="prompt-log-list">
        <article v-for="log in filteredLogs" :key="log.id" class="prompt-log-card" :class="{ 'is-error': !log.success, 'is-drift': !!log.promptDrift }">
          <div class="prompt-log-card__head">
            <div class="prompt-log-card__headline">
              <div class="prompt-log-card__meta">
                <span class="prompt-log-card__time">{{ formatTime(log.createdAt) }}</span>
                <strong class="prompt-log-card__agent">{{ log.agentId }}</strong>
                <el-tag size="small" :type="log.success ? 'success' : 'danger'">{{ log.success ? '成功' : '失败' }}</el-tag>
                <el-tag v-if="log.promptDrift" size="small" type="warning">漂移</el-tag>
                <el-tag v-if="log.systemPromptVersion" size="small" effect="plain">v{{ log.systemPromptVersion }}</el-tag>
              </div>
              <div class="prompt-log-card__summary">
                <span class="prompt-summary-label">诊断</span>
                <span class="prompt-summary-text">{{ describeLogIssue(log) }}</span>
              </div>
            </div>

            <div class="prompt-log-card__rail">
              <div class="prompt-log-card__duration">{{ log.durationMs }}ms</div>
              <el-button class="prompt-log-card__detail-btn" @click="openDetail(log)">查看详情</el-button>
            </div>
          </div>

          <div class="prompt-log-card__footer">
            <div class="prompt-log-card__meta-row">
              <span v-if="log.pathId">路径 {{ log.pathId }}</span>
              <span v-if="log.conversationId">会话 {{ log.conversationId }}</span>
              <span v-if="log.pipelineRunId">运行批次 {{ log.pipelineRunId }}</span>
              <span v-if="log.pipelineStepIndex !== null && log.pipelineStepIndex !== undefined">步骤 {{ log.pipelineStepIndex }}</span>
              <span>提取 JSON {{ log.extractedJson ? '已提取' : '无结果' }}</span>
              <span>归一化输出 {{ log.normalizedOutput ? '已生成' : '无结果' }}</span>
            </div>

            <div class="prompt-log-card__error-row" v-if="log.errorCode || log.errorMessage">
              <span class="prompt-log-card__error-code" v-if="log.errorCode">{{ log.errorCode }}</span>
              <span class="prompt-log-card__error-message">{{ log.errorMessage || '未记录详细错误信息' }}</span>
            </div>
          </div>
        </article>
      </div>
      <el-empty v-else description="暂无 Prompt Call Logs" />
    </div>

    <el-drawer v-model="detailVisible" size="min(72%, 1100px)" destroy-on-close>
      <template #header>
        <div class="detail-header">
          <strong>{{ selectedLog?.agentId || 'Prompt Call' }}</strong>
          <span>{{ selectedLog?.id || '' }}</span>
        </div>
      </template>

      <div v-if="selectedLog" class="detail-body">
        <section class="detail-hero">
          <div class="detail-hero__main">
            <span class="pill">Prompt Call</span>
            <h3>{{ selectedLog.agentId }}</h3>
            <p>这次调用记录保留了输入载荷、模型原始输出、提取 JSON 和归一化结果，可用于判断提示词约束是否稳定落地。</p>
          </div>
          <div class="detail-hero__summary">
            <div class="detail-summary-card">
              <span class="detail-summary-card__label">状态</span>
              <el-tag size="small" :type="selectedLog.success ? 'success' : 'danger'">{{ selectedLog.success ? '成功' : '失败' }}</el-tag>
              <p>{{ selectedLog.errorMessage || '本次调用未记录错误信息。' }}</p>
            </div>
            <div class="detail-summary-card">
              <span class="detail-summary-card__label">Prompt 版本</span>
              <strong>{{ selectedLog.systemPromptVersion ? `v${selectedLog.systemPromptVersion}` : '未记录' }}</strong>
              <p>{{ selectedLog.promptDrift ? '本次调用带有漂移标记，建议重点核对提取 JSON。' : '本次调用未标记漂移。' }}</p>
            </div>
          </div>
        </section>

        <el-alert
          v-if="selectedLog.promptDrift || selectedLog.errorMessage"
          :title="selectedLog.promptDrift ? '本次调用存在结构漂移标记，建议优先检查提取 JSON 与归一化输出。' : '本次调用已记录错误信息，请优先核对模型原始输出与错误字段。'
          "
          :type="selectedLog.promptDrift ? 'warning' : 'error'"
          :closable="false"
          show-icon
        />

        <div class="detail-overview-grid">
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
        </div>

        <el-descriptions :column="2" border>
          <el-descriptions-item label="状态">{{ selectedLog.success ? '成功' : '失败' }}</el-descriptions-item>
          <el-descriptions-item label="Prompt 版本">{{ selectedLog.systemPromptVersion || '--' }}</el-descriptions-item>
          <el-descriptions-item label="agentId">{{ selectedLog.agentId }}</el-descriptions-item>
          <el-descriptions-item label="耗时">{{ selectedLog.durationMs }}ms</el-descriptions-item>
          <el-descriptions-item label="pathId">{{ selectedLog.pathId || '--' }}</el-descriptions-item>
          <el-descriptions-item label="pipelineRunId">{{ selectedLog.pipelineRunId || '--' }}</el-descriptions-item>
          <el-descriptions-item label="错误信息" :span="2">{{ selectedLog.errorMessage || '--' }}</el-descriptions-item>
        </el-descriptions>

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
import { adminRuntimeDefinitionsApi } from '@/api/adminApi';
import { toast } from '@/utils/toast';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const detailVisible = ref(false);
const selectedLog = ref<any | null>(null);
const logs = ref<any[]>([]);
const filters = ref({
  agentId: '',
  pathId: '',
  pipelineRunId: '',
  status: '',
  limit: 50,
});

const successCount = computed(() => logs.value.filter((item) => item.success).length);
const errorCount = computed(() => logs.value.filter((item) => !item.success).length);
const driftCount = computed(() => logs.value.filter((item) => item.promptDrift).length);
const filteredLogs = computed(() => logs.value.filter((log) => {
  if (filters.value.status === 'success' && !log.success) return false;
  if (filters.value.status === 'error' && log.success) return false;
  if (filters.value.status === 'drift' && !log.promptDrift) return false;
  return true;
}));

const formatTime = (value: string) => {
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

const describeLogIssue = (log: any) => {
  if (log.success) {
    if (log.promptDrift) return '本次调用成功返回，但已被标记为结构漂移，建议核对提取 JSON 与归一化输出是否仍符合预期协议。';
    if (!log.normalizedOutput) return '本次调用已成功，但尚未形成归一化输出，建议检查后处理链路是否遗漏。';
    return '本次调用已完整落地，可重点核对版本差异或采样内容是否符合业务预期。';
  }

  if (log.errorMessage) return `本次调用失败：${log.errorMessage}`;
  if (log.errorCode) return `本次调用失败，错误码为 ${log.errorCode}。`;
  if (!log.extractedJson) return '本次调用失败，当前没有可提取的 JSON 结果，建议优先检查模型原始输出。';
  return '本次调用失败，建议对照模型原始输出、提取 JSON 与归一化输出逐层排查。';
};

const openDetail = (log: any) => {
  selectedLog.value = log;
  detailVisible.value = true;
};

const syncRouteQuery = () => {
  const query: Record<string, string> = {};
  if (filters.value.agentId.trim()) query.agentId = filters.value.agentId.trim();
  if (filters.value.pathId.trim()) query.pathId = filters.value.pathId.trim();
  if (filters.value.pipelineRunId.trim()) query.pipelineRunId = filters.value.pipelineRunId.trim();
  if (filters.value.status.trim()) query.status = filters.value.status.trim();
  if (filters.value.limit !== 50) query.limit = String(filters.value.limit);
  router.replace({ query });
};

const hydrateFiltersFromRoute = () => {
  filters.value.agentId = typeof route.query.agentId === 'string' ? route.query.agentId : '';
  filters.value.pathId = typeof route.query.pathId === 'string' ? route.query.pathId : '';
  filters.value.pipelineRunId = typeof route.query.pipelineRunId === 'string' ? route.query.pipelineRunId : '';
  filters.value.status = typeof route.query.status === 'string' ? route.query.status : '';
  filters.value.limit = typeof route.query.limit === 'string' && Number.isFinite(Number(route.query.limit))
    ? Number(route.query.limit)
    : 50;
};

const loadLogs = async () => {
  loading.value = true;
  try {
    const response = await adminRuntimeDefinitionsApi.getPromptCallLogs({
      limit: filters.value.limit,
      agentId: filters.value.agentId || undefined,
      pathId: filters.value.pathId || undefined,
      pipelineRunId: filters.value.pipelineRunId || undefined,
    });
    logs.value = response.data.data || [];
  } catch (error: any) {
    toast.error(error.response?.data?.error?.message || '加载 Prompt Call Logs 失败');
  } finally {
    loading.value = false;
  }
};

const handleReset = () => {
  filters.value = {
    agentId: '',
    pathId: '',
    pipelineRunId: '',
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

.page-hero {
  position: relative;
  z-index: 1;
  padding: 18px 22px;
  border-radius: 22px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(244, 247, 252, 0.94));
  margin-bottom: 12px;
  box-shadow: 0 12px 30px rgba(42, 72, 128, 0.06);
}

.admin-page-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  color: #22344d;
  letter-spacing: -0.03em;
}

.page-hero__subtitle {
  margin: 8px 0 0;
  color: #62758f;
  font-size: 0.9rem;
  line-height: 1.6;
}

.stats-bar {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 12px 18px;
  border-radius: 20px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.97), rgba(246, 249, 255, 0.95));
  box-shadow: 0 12px 28px rgba(42, 72, 128, 0.06);
  overflow-x: auto;
}

.stat-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  padding: 0 10px;
  color: #4b5e77;
}

.stat-label {
  font-size: 12px;
  color: #7085a6;
}

.stat-value {
  font-size: 16px;
  font-weight: 800;
  color: #22344d;
}

.stat-percent {
  font-size: 12px;
  color: #7b8ba3;
}

.stat-divider {
  width: 1px;
  height: 24px;
  background: #e5eaf2;
  flex-shrink: 0;
}

.stat-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  display: inline-block;
}

.stat-dot.success { background: #22c55e; }
.stat-dot.error { background: #ef4444; }
.stat-dot.drift { background: #8b5cf6; }

.filter-section {
  padding: 16px 18px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 255, 0.92));
  box-shadow: 0 12px 28px rgba(42, 72, 128, 0.06);
}

.filter-section__intro {
  margin-bottom: 12px;
}

.filter-section__intro h3 {
  margin: 0;
  color: #22344d;
  font-size: 0.95rem;
}

.filter-section__intro p {
  margin: 4px 0 0;
  color: #7085a6;
  font-size: 0.82rem;
  line-height: 1.5;
}

.filter-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr)) auto;
  gap: 12px;
  align-items: end;
}

.filter-item {
  display: grid;
  gap: 6px;
}

.filter-item label {
  font-size: 12px;
  color: #6d7c92;
}

.filter-input,
.filter-select {
  width: 100%;
}

.filter-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.logs-list {
  width: 100%;
}

.prompt-log-list {
  display: grid;
  gap: 12px;
}

.prompt-log-card {
  border: 1px solid rgba(205, 216, 238, 0.9);
  border-radius: 18px;
  padding: 12px 14px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(247, 250, 255, 0.95));
  box-shadow: 0 10px 22px rgba(42, 72, 128, 0.05);
  display: grid;
  gap: 8px;
}

.prompt-log-card.is-error {
  border-color: rgba(239, 68, 68, 0.28);
  box-shadow: inset 3px 0 0 rgba(239, 68, 68, 0.22), 0 10px 24px rgba(42, 72, 128, 0.06);
}

.prompt-log-card.is-drift {
  box-shadow: inset 3px 0 0 rgba(245, 158, 11, 0.22), 0 10px 24px rgba(42, 72, 128, 0.06);
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
  color: #22344d;
  font-size: 0.98rem;
  line-height: 1.3;
}

.prompt-log-card__time,
.prompt-log-card__duration {
  color: #7085a6;
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
  color: #4b5e77;
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
  color: #7085a6;
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
  font-size: 11px;
  font-weight: 700;
}

.prompt-log-card__error-message {
  color: #4b5e77;
  line-height: 1.5;
  font-size: 12px;
}

.prompt-log-card__actions {
  display: flex;
  justify-content: flex-end;
}

.prompt-log-card__detail-btn {
  border-radius: 14px;
  font-weight: 700;
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
  gap: 16px;
}

.detail-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.9fr);
  gap: 14px;
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 255, 0.95));
}

.detail-hero__main h3 {
  margin: 10px 0 0;
  color: #22344d;
  font-size: 1.35rem;
}

.detail-hero__main p {
  margin: 10px 0 0;
  color: #7085a6;
  line-height: 1.7;
}

.detail-hero__summary {
  display: grid;
  gap: 10px;
}

.detail-summary-card,
.detail-overview-card {
  border: 1px solid rgba(205, 216, 238, 0.86);
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 255, 0.95));
  padding: 14px 16px;
  display: grid;
  gap: 8px;
}

.detail-summary-card__label,
.detail-overview-card__label {
  color: #7b8ba3;
  font-size: 12px;
  font-weight: 700;
}

.detail-summary-card strong,
.detail-overview-card strong {
  color: #22344d;
  font-size: 15px;
}

.detail-summary-card p {
  margin: 0;
  color: #7085a6;
  font-size: 13px;
  line-height: 1.6;
}

.detail-overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.detail-tabs pre {
  margin: 0;
  padding: 16px;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 12px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
}

@media (max-width: 960px) {
  .detail-hero,
  .detail-overview-grid,
  .prompt-log-card__head {
    grid-template-columns: minmax(0, 1fr);
  }

  .page-hero {
    padding: 20px;
  }

  .filter-row {
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
</style>
