<template>
  <div class="runtime-definitions-page">
    <div class="page-hero">
      <span class="pill">Runtime</span>
      <h2 class="page-hero__title admin-page-title">Agent / Skill Definitions</h2>
      <p class="page-hero__subtitle">查看运行时定义、输入输出 schema 和变量绑定，给后续 prompt 编辑与编排器可视化打基础。</p>
    </div>

    <div class="summary-grid" v-if="summaryReady">
      <el-card class="summary-card summary-card--blue" shadow="hover">
        <div class="label">定义总数</div>
        <div class="value">{{ definitions.length }}</div>
      </el-card>
      <el-card class="summary-card summary-card--green" shadow="hover">
        <div class="label">Agent</div>
        <div class="value">{{ agentCount }}</div>
      </el-card>
      <el-card class="summary-card summary-card--orange" shadow="hover">
        <div class="label">Skill</div>
        <div class="value">{{ skillCount }}</div>
      </el-card>
      <el-card class="summary-card summary-card--purple" shadow="hover">
        <div class="label">代码托管</div>
        <div class="value">{{ managedByCodeCount }}</div>
      </el-card>
    </div>

    <div class="filters admin-list-toolbar">
      <div class="admin-list-toolbar__group">
        <el-input v-model="keyword" placeholder="搜索 ID / 名称 / 描述" clearable class="search" />
        <el-select v-model="category" placeholder="类型" clearable class="select">
          <el-option label="全部" value="" />
          <el-option label="Agent" value="agent" />
          <el-option label="Skill" value="skill" />
        </el-select>
      </div>
      <div class="admin-list-toolbar__group">
        <el-button type="primary" :loading="loading" @click="loadDefinitions">刷新</el-button>
      </div>
    </div>

    <div class="admin-list-card">
      <el-table :data="filteredDefinitions" v-loading="loading" stripe>
        <el-table-column label="定义" min-width="280">
          <template #default="{ row }">
            <div class="definition-cell">
              <strong>{{ row.displayName }}</strong>
              <span class="definition-cell__id">{{ row.id }}</span>
              <span class="definition-cell__desc">{{ row.description || '暂无描述' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="row.category === 'agent' ? 'primary' : 'success'">{{ row.category }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="变量绑定" min-width="180">
          <template #default="{ row }">
            <div class="definition-metrics">
              <span>consumes {{ row.variableBindings?.consumes?.length || 0 }}</span>
              <span>produces {{ row.variableBindings?.produces?.length || 0 }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="默认参数" min-width="180">
          <template #default="{ row }">
            <div class="definition-metrics">
              <span>Max {{ row.defaultMaxTokens || '--' }}</span>
              <span>T {{ row.defaultTemperature ?? '--' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="ACTIVE Prompt" min-width="220">
          <template #default="{ row }">
            <div class="definition-metrics">
              <span v-if="row.activePrompt">v{{ row.activePrompt.version }} · {{ row.activePrompt.name }}</span>
              <span v-else>未发布</span>
              <span v-if="row.activePrompt">{{ row.activePrompt.model || '--' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="140">
          <template #default="{ row }">
            <el-tag size="small" :type="row.managedByCode ? 'info' : 'warning'">{{ row.source }}{{ row.managedByCode ? ' · code' : '' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="selectDefinition(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-if="selectedDefinition" v-loading="detailLoading" class="definition-detail-grid">
      <el-card shadow="never">
        <template #header>
          <div class="detail-header">
            <strong>{{ selectedDefinition.displayName }}</strong>
            <span>{{ selectedDefinition.id }}</span>
          </div>
        </template>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="类型">{{ selectedDefinition.category }}</el-descriptions-item>
          <el-descriptions-item label="Schema 版本">{{ selectedDefinition.schemaVersion }}</el-descriptions-item>
          <el-descriptions-item label="默认 Max Tokens">{{ selectedDefinition.defaultMaxTokens || '--' }}</el-descriptions-item>
          <el-descriptions-item label="默认 Temperature">{{ selectedDefinition.defaultTemperature ?? '--' }}</el-descriptions-item>
          <el-descriptions-item label="描述" :span="2">{{ selectedDefinition.description || '-' }}</el-descriptions-item>
        </el-descriptions>
        <div class="chip-row chip-row--spaced">
          <span class="chip-label">capabilities</span>
          <el-tag v-for="item in selectedDefinition.capabilities || []" :key="item" size="small" effect="plain">{{ item }}</el-tag>
        </div>
      </el-card>

      <el-card shadow="never">
        <template #header><strong>ACTIVE Prompt</strong></template>
        <template v-if="selectedDefinition.activePrompt">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="版本">v{{ selectedDefinition.activePrompt.version }}</el-descriptions-item>
            <el-descriptions-item label="模型">{{ selectedDefinition.activePrompt.model || '--' }}</el-descriptions-item>
            <el-descriptions-item label="名称">{{ selectedDefinition.activePrompt.name }}</el-descriptions-item>
            <el-descriptions-item label="Temperature">{{ selectedDefinition.activePrompt.temperature ?? '--' }}</el-descriptions-item>
            <el-descriptions-item label="Max Tokens">{{ selectedDefinition.activePrompt.maxTokens ?? '--' }}</el-descriptions-item>
            <el-descriptions-item label="发布时间">{{ selectedDefinition.activePrompt.publishedAt || selectedDefinition.activePrompt.updatedAt || '--' }}</el-descriptions-item>
            <el-descriptions-item label="描述" :span="2">{{ selectedDefinition.activePrompt.description || '-' }}</el-descriptions-item>
          </el-descriptions>
          <div class="prompt-block">
            <pre>{{ selectedDefinition.activePrompt.systemPrompt }}</pre>
          </div>
          <div class="detail-actions">
            <el-button type="primary" @click="openPromptLogs({ agentId: selectedDefinition.id })">查看该节点调用日志</el-button>
          </div>
        </template>
        <el-empty v-else description="当前没有 ACTIVE prompt" />
      </el-card>

      <el-card shadow="never">
        <template #header><strong>Variable Bindings</strong></template>
        <div class="binding-grid">
          <div>
            <h4>Consumes</h4>
            <el-tag v-for="item in selectedDefinition.variableBindings?.consumes || []" :key="`c-${item}`" size="small" effect="plain">{{ item }}</el-tag>
          </div>
          <div>
            <h4>Produces</h4>
            <el-tag v-for="item in selectedDefinition.variableBindings?.produces || []" :key="`p-${item}`" size="small" effect="plain">{{ item }}</el-tag>
          </div>
        </div>
      </el-card>

      <el-card shadow="never">
        <template #header><strong>Input Schema</strong></template>
        <pre>{{ JSON.stringify(selectedDefinition.inputSchema, null, 2) }}</pre>
      </el-card>

      <el-card shadow="never">
        <template #header><strong>Output Schema</strong></template>
        <pre>{{ JSON.stringify(selectedDefinition.outputSchema, null, 2) }}</pre>
      </el-card>

      <el-card shadow="never">
        <template #header><strong>Recent Prompt Calls</strong></template>
        <div v-if="selectedDefinition.recentPromptCalls?.length" class="recent-call-list">
          <article v-for="item in selectedDefinition.recentPromptCalls" :key="item.id" class="recent-call-card">
            <div class="recent-call-card__meta">
              <el-tag size="small" :type="item.success ? 'success' : 'danger'">{{ item.success ? 'success' : 'error' }}</el-tag>
              <span>{{ item.durationMs }}ms</span>
              <span>{{ formatTime(item.createdAt) }}</span>
              <span v-if="item.pathId">path: {{ item.pathId }}</span>
            </div>
            <div class="detail-actions detail-actions--compact">
              <el-button type="primary" link @click="openPromptLogs({ agentId: selectedDefinition.id, pathId: item.pathId || undefined, pipelineRunId: item.pipelineRunId || undefined })">在日志页中查看</el-button>
            </div>
            <details>
              <summary>展开样本</summary>
              <div class="prompt-sample-grid">
                <div>
                  <h4>User Payload</h4>
                  <pre>{{ item.userPayload }}</pre>
                </div>
                <div>
                  <h4>Extracted JSON</h4>
                  <pre>{{ item.extractedJson || '--' }}</pre>
                </div>
                <div>
                  <h4>Normalized Output</h4>
                  <pre>{{ JSON.stringify(item.normalizedOutput, null, 2) }}</pre>
                </div>
              </div>
            </details>
          </article>
        </div>
        <el-empty v-else description="暂无最近调用样本" />
      </el-card>
    </div>
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
const detailLoading = ref(false);
const definitions = ref<any[]>([]);
const selectedDefinition = ref<any | null>(null);
const keyword = ref('');
const category = ref('');

const filteredDefinitions = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  return definitions.value.filter((item) => {
    const matchCategory = !category.value || item.category === category.value;
    const text = `${item.id} ${item.displayName} ${item.description || ''}`.toLowerCase();
    const matchKeyword = !q || text.includes(q);
    return matchCategory && matchKeyword;
  });
});

const agentCount = computed(() => definitions.value.filter((item) => item.category === 'agent').length);
const skillCount = computed(() => definitions.value.filter((item) => item.category === 'skill').length);
const managedByCodeCount = computed(() => definitions.value.filter((item) => item.managedByCode).length);
const summaryReady = computed(() => definitions.value.length > 0);

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

const openPromptLogs = (params: { agentId?: string; pathId?: string; pipelineRunId?: string }) => {
  router.push({
    path: '/admin/prompt-call-logs',
    query: {
      ...(params.agentId ? { agentId: params.agentId } : {}),
      ...(params.pathId ? { pathId: params.pathId } : {}),
      ...(params.pipelineRunId ? { pipelineRunId: params.pipelineRunId } : {}),
    }
  });
};

const selectDefinition = async (item: any) => {
  detailLoading.value = true;
  try {
    const response = await adminRuntimeDefinitionsApi.getAgentDefinitionDetail(item.id);
    selectedDefinition.value = response.data.data;
  } catch (error: any) {
    toast.error(error.response?.data?.error?.message || '加载 definition 详情失败');
  } finally {
    detailLoading.value = false;
  }
};

const loadDefinitions = async () => {
  loading.value = true;
  try {
    const response = await adminRuntimeDefinitionsApi.getAgentDefinitions();
    definitions.value = response.data.data || [];
    if (definitions.value.length > 0) {
      const preferredAgentId = typeof route.query.agentId === 'string' ? route.query.agentId : null;
      const preferred = preferredAgentId ? definitions.value.find((item: any) => item.id === preferredAgentId) : null;
      if (!selectedDefinition.value || preferred) {
        await selectDefinition(preferred || definitions.value[0]);
      }
    }
  } catch (error: any) {
    toast.error(error.response?.data?.error?.message || '加载 runtime definitions 失败');
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  loadDefinitions();
});

watch(() => route.query.agentId, (agentId) => {
  if (typeof agentId !== 'string' || !agentId.trim() || !definitions.value.length) return;
  const matched = definitions.value.find((item) => item.id === agentId);
  if (matched && selectedDefinition.value?.id !== matched.id) {
    void selectDefinition(matched);
  }
});
</script>

<style scoped>
.runtime-definitions-page {
  display: grid;
  gap: 20px;
}

.definition-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.definition-cell__id {
  font-size: 12px;
  color: #6b7280;
}

.definition-cell__desc {
  font-size: 13px;
  color: #4b5563;
}

.definition-metrics {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}

.definition-detail-grid {
  display: grid;
  gap: 16px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.chip-row--spaced {
  margin-top: 16px;
}

.chip-label {
  min-width: 90px;
  color: #6b7280;
  font-size: 13px;
}

.binding-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.binding-grid h4 {
  margin: 0 0 10px;
}

.prompt-block {
  margin-top: 16px;
}

.detail-actions {
  margin-top: 12px;
  display: flex;
  gap: 10px;
}

.detail-actions--compact {
  margin-top: 0;
}

.recent-call-list {
  display: grid;
  gap: 12px;
}

.recent-call-card {
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 12px;
  padding: 12px;
}

.recent-call-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 8px;
}

.prompt-sample-grid {
  display: grid;
  gap: 12px;
  margin-top: 12px;
}

.prompt-sample-grid h4 {
  margin: 0 0 8px;
}

pre {
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
  .binding-grid {
    grid-template-columns: 1fr;
  }
}
</style>
