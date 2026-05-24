<template>
  <div class="runtime-definitions-page">
    <div class="page-hero">
      <span class="pill">Runtime</span>
      <h2 class="page-hero__title admin-page-title">Orchestrator Definitions</h2>
      <p class="page-hero__subtitle">查看当前编排器的步骤定义与变量图，为后续可视化编排器打基础。</p>
    </div>

    <div class="summary-grid" v-if="orchestrators.length">
      <el-card class="summary-card summary-card--blue" shadow="hover">
        <div class="label">编排器数量</div>
        <div class="value">{{ orchestrators.length }}</div>
      </el-card>
      <el-card class="summary-card summary-card--green" shadow="hover">
        <div class="label">总步骤数</div>
        <div class="value">{{ totalSteps }}</div>
      </el-card>
      <el-card class="summary-card summary-card--purple" shadow="hover">
        <div class="label">代码托管</div>
        <div class="value">{{ managedByCodeCount }}</div>
      </el-card>
    </div>

    <div class="filters admin-list-toolbar">
      <div class="admin-list-toolbar__group">
        <el-input v-model="keyword" placeholder="搜索编排器 ID / 名称 / 描述" clearable class="search" />
      </div>
      <div class="admin-list-toolbar__group">
        <el-button type="primary" :loading="loading" @click="loadOrchestrators">刷新</el-button>
      </div>
    </div>

    <div class="admin-list-card">
      <el-table :data="filteredOrchestrators" v-loading="loading" stripe>
        <el-table-column label="编排器" min-width="280">
          <template #default="{ row }">
            <div class="definition-cell">
              <strong>{{ row.displayName }}</strong>
              <span class="definition-cell__id">{{ row.id }}</span>
              <span class="definition-cell__desc">{{ row.description || '暂无描述' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="步骤数" width="120">
          <template #default="{ row }">{{ row.steps?.length || 0 }}</template>
        </el-table-column>
        <el-table-column label="来源" width="140">
          <template #default="{ row }">
            <el-tag size="small" :type="row.managedByCode ? 'info' : 'warning'">{{ row.source }}{{ row.managedByCode ? ' · code' : '' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="selectedOrchestrator = row">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-if="selectedOrchestrator" class="definition-detail-grid">
      <el-card shadow="never">
        <template #header>
          <div class="detail-header">
            <strong>{{ selectedOrchestrator.displayName }}</strong>
            <span>{{ selectedOrchestrator.id }}</span>
          </div>
        </template>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="类型">{{ selectedOrchestrator.category }}</el-descriptions-item>
          <el-descriptions-item label="来源">{{ selectedOrchestrator.source }}</el-descriptions-item>
          <el-descriptions-item label="描述" :span="2">{{ selectedOrchestrator.description || '-' }}</el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card shadow="never">
        <template #header><strong>Steps</strong></template>
        <el-table :data="selectedOrchestrator.steps || []" border>
          <el-table-column prop="step" label="#" width="80" />
          <el-table-column label="Agent ID" min-width="260">
            <template #default="{ row }">
              <div class="step-agent-cell">
                <span>{{ row.agentId }}</span>
                <div class="step-agent-cell__actions">
                  <el-button type="primary" link @click="goToAgentDefinition(row.agentId)">定义</el-button>
                  <el-button type="primary" link @click="goToPromptLogs(row.agentId)">日志</el-button>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="role" label="Role" min-width="200" />
          <el-table-column prop="loopOver" label="Loop" min-width="140" />
        </el-table>
      </el-card>

      <el-card shadow="never">
        <template #header><strong>Flow View</strong></template>
        <div class="flow-rail" v-if="flowSteps.length">
          <article v-for="(step, index) in flowSteps" :key="`${step.step}-${step.agentId}`" class="flow-step-card">
            <div class="flow-step-card__head">
              <span class="flow-step-card__index">Step {{ step.step }}</span>
              <strong>{{ step.displayName }}</strong>
            </div>
            <p class="flow-step-card__sub">{{ step.roleLabel }}</p>
            <div class="flow-step-card__meta">
              <span>{{ step.agentId }}</span>
              <span v-if="step.loopOver">loop: {{ step.loopOver }}</span>
            </div>
            <div class="flow-chip-group">
              <span class="flow-chip-label">Consumes</span>
              <el-tag v-for="item in step.consumes" :key="`${step.agentId}-c-${item}`" size="small" effect="plain">{{ item }}</el-tag>
              <span v-if="!step.consumes.length" class="flow-empty">无显式绑定</span>
            </div>
            <div class="flow-chip-group">
              <span class="flow-chip-label">Produces</span>
              <el-tag v-for="item in step.produces" :key="`${step.agentId}-p-${item}`" size="small" type="success" effect="plain">{{ item }}</el-tag>
              <span v-if="!step.produces.length" class="flow-empty">无显式产出</span>
            </div>
            <div class="flow-step-card__actions">
              <el-button type="primary" link @click="goToAgentDefinition(step.agentId)">查看定义</el-button>
              <el-button type="primary" link @click="goToPromptLogs(step.agentId)">查看日志</el-button>
            </div>
            <div v-if="index < flowSteps.length - 1" class="flow-arrow">
              <span>↓</span>
              <small>{{ flowTransitions[index] }}</small>
            </div>
          </article>
        </div>
        <el-empty v-else description="暂无步骤定义" />
      </el-card>

      <el-card shadow="never">
        <template #header><strong>Variable Graph</strong></template>
        <div class="variable-graph-grid" v-if="variableGraphEntries.length">
          <article v-for="entry in variableGraphEntries" :key="entry.node" class="variable-graph-card">
            <strong>{{ entry.node }}</strong>
            <div class="flow-chip-group">
              <el-tag v-for="item in entry.variables" :key="`${entry.node}-${item}`" size="small" effect="plain">{{ item }}</el-tag>
            </div>
          </article>
        </div>
        <pre v-else>{{ JSON.stringify(selectedOrchestrator.variableGraph, null, 2) }}</pre>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { adminRuntimeDefinitionsApi } from '@/api/adminApi';
import { toast } from '@/utils/toast';

const router = useRouter();
const loading = ref(false);
const orchestrators = ref<any[]>([]);
const agentDefinitions = ref<any[]>([]);
const selectedOrchestrator = ref<any | null>(null);
const keyword = ref('');

const filteredOrchestrators = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  return orchestrators.value.filter((item) => {
    const text = `${item.id} ${item.displayName} ${item.description || ''}`.toLowerCase();
    return !q || text.includes(q);
  });
});

const totalSteps = computed(() => orchestrators.value.reduce((sum, item) => sum + (item.steps?.length || 0), 0));
const managedByCodeCount = computed(() => orchestrators.value.filter((item) => item.managedByCode).length);

const agentDefinitionMap = computed(() => new Map(agentDefinitions.value.map((item) => [item.id, item])));

const roleLabelMap: Record<string, string> = {
  'goal-clarification': '澄清目标与真实问题',
  'input-normalization': '清洗输入并补节奏建议',
  'cognitive-core-and-milestones': '生成认知图景与主干阶段',
  'stage-task-expansion': '逐阶段展开 subtasks',
};

const flowSteps = computed(() => {
  if (!selectedOrchestrator.value?.steps) return [];
  return selectedOrchestrator.value.steps.map((step: any) => {
    const definition = agentDefinitionMap.value.get(step.agentId);
    return {
      ...step,
      displayName: definition?.displayName || step.agentId,
      consumes: definition?.variableBindings?.consumes || [],
      produces: definition?.variableBindings?.produces || [],
      roleLabel: roleLabelMap[step.role] || step.role || '未命名角色',
    };
  });
});

const flowTransitions = computed(() => {
  return flowSteps.value.slice(0, -1).map((step: any) => {
    const produced = step.produces.slice(0, 2);
    return produced.length ? `传递 ${produced.join(' / ')}` : '进入下一步';
  });
});

const variableGraphEntries = computed(() => {
  if (!selectedOrchestrator.value?.variableGraph || typeof selectedOrchestrator.value.variableGraph !== 'object') return [];
  return Object.entries(selectedOrchestrator.value.variableGraph).map(([node, variables]) => ({
    node,
    variables: Array.isArray(variables) ? variables : [],
  }));
});

const goToAgentDefinition = (agentId: string) => {
  router.push({ path: '/admin/agent-definitions', query: { agentId } });
};

const goToPromptLogs = (agentId: string) => {
  router.push({ path: '/admin/prompt-call-logs', query: { agentId } });
};

const loadOrchestrators = async () => {
  loading.value = true;
  try {
    const [orchestratorResponse, agentDefinitionResponse] = await Promise.all([
      adminRuntimeDefinitionsApi.getOrchestratorDefinitions(),
      adminRuntimeDefinitionsApi.getAgentDefinitions(),
    ]);
    orchestrators.value = orchestratorResponse.data.data || [];
    agentDefinitions.value = agentDefinitionResponse.data.data || [];
    if (!selectedOrchestrator.value && orchestrators.value.length > 0) {
      selectedOrchestrator.value = orchestrators.value[0];
    }
  } catch (error: any) {
    toast.error(error.response?.data?.error?.message || '加载 orchestrator definitions 失败');
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  loadOrchestrators();
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

.definition-detail-grid {
  display: grid;
  gap: 16px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.step-agent-cell {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.step-agent-cell__actions {
  display: inline-flex;
  gap: 8px;
}

.flow-rail {
  display: grid;
  gap: 16px;
}

.flow-step-card {
  position: relative;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 16px;
  padding: 16px;
  background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98));
}

.flow-step-card__head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.flow-step-card__index {
  font-size: 12px;
  color: #6366f1;
  font-weight: 700;
}

.flow-step-card__sub {
  margin: 8px 0 0;
  color: #4b5563;
  font-size: 13px;
}

.flow-step-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  font-size: 12px;
  color: #6b7280;
}

.flow-chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
  align-items: center;
}

.flow-chip-label {
  min-width: 72px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
}

.flow-empty {
  color: #9ca3af;
  font-size: 12px;
}

.flow-step-card__actions {
  margin-top: 12px;
  display: flex;
  gap: 10px;
}

.flow-arrow {
  display: grid;
  gap: 4px;
  justify-items: center;
  margin-top: 12px;
  color: #6366f1;
}

.flow-arrow small {
  color: #6b7280;
}

.variable-graph-grid {
  display: grid;
  gap: 12px;
}

.variable-graph-card {
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 12px;
  padding: 12px;
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
</style>
