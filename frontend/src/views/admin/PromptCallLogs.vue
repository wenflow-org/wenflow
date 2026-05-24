<template>
  <div class="prompt-call-logs-page">
    <div class="page-hero">
      <span class="pill">Runtime</span>
      <h2 class="page-hero__title admin-page-title">Prompt Call Logs</h2>
      <p class="page-hero__subtitle">查看 PromptComposer 记录的真实调用链路：userPayload、rawModelOutput、extractedJson、normalizedOutput。</p>
    </div>

    <div class="summary-grid" v-if="logs.length">
      <el-card class="summary-card summary-card--blue" shadow="hover">
        <div class="label">当前列表</div>
        <div class="value">{{ logs.length }}</div>
      </el-card>
      <el-card class="summary-card summary-card--green" shadow="hover">
        <div class="label">成功</div>
        <div class="value">{{ successCount }}</div>
      </el-card>
      <el-card class="summary-card summary-card--red" shadow="hover">
        <div class="label">失败</div>
        <div class="value">{{ errorCount }}</div>
      </el-card>
      <el-card class="summary-card summary-card--purple" shadow="hover">
        <div class="label">漂移标记</div>
        <div class="value">{{ driftCount }}</div>
      </el-card>
    </div>

    <div class="filters admin-list-toolbar">
      <div class="admin-list-toolbar__group">
        <el-input v-model="filters.agentId" placeholder="agentId / skillId" clearable class="search" />
        <el-input v-model="filters.pathId" placeholder="pathId" clearable class="search" />
        <el-input v-model="filters.pipelineRunId" placeholder="pipelineRunId" clearable class="search" />
        <el-select v-model="filters.limit" class="select" style="width: 120px;">
          <el-option :value="20" label="20 条" />
          <el-option :value="50" label="50 条" />
          <el-option :value="100" label="100 条" />
        </el-select>
      </div>
      <div class="admin-list-toolbar__group">
        <el-button @click="handleReset">重置</el-button>
        <el-button type="primary" :loading="loading" @click="loadLogs">刷新</el-button>
      </div>
    </div>

    <div class="admin-list-card" v-loading="loading">
      <div v-if="logs.length" class="prompt-log-list">
        <article v-for="log in logs" :key="log.id" class="prompt-log-card" :class="{ 'is-error': !log.success }">
          <div class="prompt-log-card__head">
            <div class="prompt-log-card__meta">
              <strong>{{ log.agentId }}</strong>
              <span>{{ formatTime(log.createdAt) }}</span>
              <el-tag size="small" :type="log.success ? 'success' : 'danger'">{{ log.success ? 'success' : 'error' }}</el-tag>
              <el-tag v-if="log.promptDrift" size="small" type="warning">drift</el-tag>
              <el-tag v-if="log.systemPromptVersion" size="small" effect="plain">v{{ log.systemPromptVersion }}</el-tag>
            </div>
            <div class="prompt-log-card__meta prompt-log-card__meta--right">
              <span>{{ log.durationMs }}ms</span>
              <span v-if="log.pipelineRunId">run: {{ log.pipelineRunId }}</span>
              <span v-if="log.pipelineStepIndex !== null && log.pipelineStepIndex !== undefined">step: {{ log.pipelineStepIndex }}</span>
            </div>
          </div>

          <div class="prompt-log-card__summary">
            <span v-if="log.pathId">path: {{ log.pathId }}</span>
            <span v-if="log.conversationId">conversation: {{ log.conversationId }}</span>
            <span v-if="log.errorCode">{{ log.errorCode }}</span>
            <span v-if="log.errorMessage">{{ log.errorMessage }}</span>
          </div>

          <div class="prompt-log-card__actions">
            <el-button type="primary" link @click="openDetail(log)">查看详情</el-button>
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
        <el-descriptions :column="2" border>
          <el-descriptions-item label="状态">{{ selectedLog.success ? 'success' : 'error' }}</el-descriptions-item>
          <el-descriptions-item label="Prompt 版本">{{ selectedLog.systemPromptVersion || '--' }}</el-descriptions-item>
          <el-descriptions-item label="agentId">{{ selectedLog.agentId }}</el-descriptions-item>
          <el-descriptions-item label="duration">{{ selectedLog.durationMs }}ms</el-descriptions-item>
          <el-descriptions-item label="pathId">{{ selectedLog.pathId || '--' }}</el-descriptions-item>
          <el-descriptions-item label="pipelineRunId">{{ selectedLog.pipelineRunId || '--' }}</el-descriptions-item>
          <el-descriptions-item label="error" :span="2">{{ selectedLog.errorMessage || '--' }}</el-descriptions-item>
        </el-descriptions>

        <el-tabs class="detail-tabs">
          <el-tab-pane label="User Payload">
            <pre>{{ selectedLog.userPayload }}</pre>
          </el-tab-pane>
          <el-tab-pane label="Raw Model Output">
            <pre>{{ selectedLog.rawModelOutput || '--' }}</pre>
          </el-tab-pane>
          <el-tab-pane label="Extracted JSON">
            <pre>{{ selectedLog.extractedJson || '--' }}</pre>
          </el-tab-pane>
          <el-tab-pane label="Normalized Output">
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
  limit: 50,
});

const successCount = computed(() => logs.value.filter((item) => item.success).length);
const errorCount = computed(() => logs.value.filter((item) => !item.success).length);
const driftCount = computed(() => logs.value.filter((item) => item.promptDrift).length);

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

const openDetail = (log: any) => {
  selectedLog.value = log;
  detailVisible.value = true;
};

const syncRouteQuery = () => {
  const query: Record<string, string> = {};
  if (filters.value.agentId.trim()) query.agentId = filters.value.agentId.trim();
  if (filters.value.pathId.trim()) query.pathId = filters.value.pathId.trim();
  if (filters.value.pipelineRunId.trim()) query.pipelineRunId = filters.value.pipelineRunId.trim();
  if (filters.value.limit !== 50) query.limit = String(filters.value.limit);
  router.replace({ query });
};

const hydrateFiltersFromRoute = () => {
  filters.value.agentId = typeof route.query.agentId === 'string' ? route.query.agentId : '';
  filters.value.pathId = typeof route.query.pathId === 'string' ? route.query.pathId : '';
  filters.value.pipelineRunId = typeof route.query.pipelineRunId === 'string' ? route.query.pipelineRunId : '';
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
  gap: 20px;
}

.prompt-log-list {
  display: grid;
  gap: 14px;
}

.prompt-log-card {
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 16px;
  padding: 16px;
  background: #fff;
}

.prompt-log-card.is-error {
  border-color: rgba(239, 68, 68, 0.24);
}

.prompt-log-card__head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.prompt-log-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.prompt-log-card__meta--right {
  justify-content: flex-end;
  color: #6b7280;
  font-size: 12px;
}

.prompt-log-card__summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
  color: #4b5563;
  font-size: 13px;
}

.prompt-log-card__actions {
  margin-top: 10px;
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
</style>
