<template>
  <div class="runtime-definitions-page">
    <div class="page-hero">
      <span class="pill">Runtime</span>
      <h2 class="page-hero__title admin-page-title">编排定义</h2>
      <p class="page-hero__subtitle">查看编排器的步骤定义、变量流和结构关系。这里用于理解编排结构，不用于判断实时运行健康。</p>
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
        <el-button class="table-link-btn table-link-btn--primary" :loading="loading" @click="loadOrchestrators">刷新</el-button>
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
              <el-button class="table-link-btn table-link-btn--sm" @click="selectedOrchestrator = row">详情</el-button>
            </template>
          </el-table-column>
      </el-table>
    </div>

    <div v-if="selectedOrchestrator" class="definition-detail-grid">
      <section class="detail-hero-card">
        <div class="detail-hero-card__main">
          <span class="pill">结构定义</span>
          <h3>{{ selectedOrchestrator.displayName }}</h3>
          <p>{{ selectedOrchestrator.description || '当前编排器暂无补充说明。' }}</p>
          <div class="detail-hero-card__meta">
            <span>{{ selectedOrchestrator.id }}</span>
            <span>类型 {{ selectedOrchestrator.category }}</span>
            <span>来源 {{ selectedOrchestrator.source }}</span>
          </div>
        </div>
        <div class="detail-hero-card__stats">
          <div class="detail-stat-card">
            <span class="detail-stat-card__label">步骤数</span>
            <strong>{{ selectedOrchestrator.steps?.length || 0 }}</strong>
          </div>
          <div class="detail-stat-card">
            <span class="detail-stat-card__label">变量节点</span>
            <strong>{{ variableGraphEntries.length }}</strong>
          </div>
          <div class="detail-stat-card">
            <span class="detail-stat-card__label">代码托管</span>
            <strong>{{ selectedOrchestrator.managedByCode ? '是' : '否' }}</strong>
          </div>
        </div>
      </section>

      <el-card shadow="never" class="detail-card">
        <template #header>
          <div class="section-card__header">
            <strong>编排步骤</strong>
            <span>{{ selectedOrchestrator.steps?.length || 0 }} 步</span>
          </div>
        </template>
        <el-table :data="selectedOrchestrator.steps || []" border>
          <el-table-column prop="step" label="序号" width="80" />
          <el-table-column label="节点 ID" min-width="260">
            <template #default="{ row }">
              <div class="step-agent-cell">
                <span>{{ row.agentId }}</span>
                <div class="step-agent-cell__actions">
                  <el-button class="table-link-btn table-link-btn--sm" @click="goToAgentDefinition(row.agentId)">定义</el-button>
                  <el-button class="table-link-btn table-link-btn--sm" @click="goToPromptLogs(row.agentId)">日志</el-button>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="role" label="角色" min-width="200" />
          <el-table-column prop="loopOver" label="循环条件" min-width="140" />
        </el-table>
      </el-card>

      <el-card shadow="never" class="detail-card">
        <template #header>
          <div class="section-card__header">
            <strong>流程视图</strong>
            <span>按步骤查看读取/产出关系</span>
          </div>
        </template>
        <div class="flow-rail" v-if="flowSteps.length">
          <article v-for="(step, index) in flowSteps" :key="`${step.step}-${step.agentId}`" class="flow-step-card">
            <div class="flow-step-card__head">
              <span class="flow-step-card__index">步骤 {{ step.step }}</span>
              <strong>{{ step.displayName }}</strong>
            </div>
            <p class="flow-step-card__sub">{{ step.roleLabel }}</p>
            <div class="flow-step-card__meta">
              <span>{{ step.agentId }}</span>
              <span v-if="step.loopOver">循环：{{ step.loopOver }}</span>
            </div>
            <div class="flow-chip-group">
              <span class="flow-chip-label">读取变量</span>
              <el-tag v-for="item in step.consumes" :key="`${step.agentId}-c-${item}`" size="small" effect="plain">{{ item }}</el-tag>
              <span v-if="!step.consumes.length" class="flow-empty">无显式绑定</span>
            </div>
            <div class="flow-chip-group">
              <span class="flow-chip-label">产出变量</span>
              <el-tag v-for="item in step.produces" :key="`${step.agentId}-p-${item}`" size="small" type="success" effect="plain">{{ item }}</el-tag>
              <span v-if="!step.produces.length" class="flow-empty">无显式产出</span>
            </div>
            <div class="flow-step-card__actions">
              <el-button class="table-link-btn table-link-btn--sm" @click="goToAgentDefinition(step.agentId)">查看定义</el-button>
              <el-button class="table-link-btn table-link-btn--sm" @click="goToPromptLogs(step.agentId)">查看日志</el-button>
            </div>
            <div v-if="index < flowSteps.length - 1" class="flow-arrow">
              <span>↓</span>
              <small>{{ flowTransitions[index] }}</small>
            </div>
          </article>
        </div>
        <el-empty v-else description="暂无步骤定义" />
      </el-card>

      <el-card shadow="never" class="detail-card">
        <template #header>
          <div class="section-card__header">
            <strong>变量关系图</strong>
            <span>{{ variableGraphEntries.length ? `${variableGraphEntries.length} 个节点` : '暂无节点' }}</span>
          </div>
        </template>
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
  router.push({ path: '/admin/agent-registry', query: { agentId } });
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

.page-hero {
  padding: 24px 28px;
  border-radius: 24px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 38%), linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(244, 247, 252, 0.94));
  box-shadow: 0 16px 42px rgba(42, 72, 128, 0.08);
}

.admin-page-title {
  margin: 8px 0 0;
  font-size: 1.6rem;
  font-weight: 700;
  color: #22344d;
  letter-spacing: -0.03em;
}

.page-hero__subtitle {
  margin: 6px 0 0;
  color: #62758f;
  font-size: 0.95rem;
  line-height: 1.7;
}

.pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: #2d6df2;
  font-size: 12px;
  font-weight: 700;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.summary-card {
  border-radius: 18px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 249, 255, 0.96));
  box-shadow: 0 12px 28px rgba(42, 72, 128, 0.08);
}

.summary-card .label {
  font-size: 0.75rem;
  color: #7b8ba3;
  font-weight: 600;
}

.summary-card .value {
  font-size: 1.85rem;
  font-weight: 800;
  margin-top: 0.3rem;
  color: #22344d;
  line-height: 1;
}

.summary-card--blue .value { color: var(--color-primary); }
.summary-card--green .value { color: #16a34a; }
.summary-card--purple .value { color: #7c3aed; }

:deep(.summary-card .el-card__body) {
  padding: 16px 18px;
}

.filters {
  padding: 16px 18px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 255, 0.92));
  box-shadow: 0 12px 28px rgba(42, 72, 128, 0.08);
}

.admin-list-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.admin-list-toolbar__group {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.search {
  width: 260px;
}

.admin-list-card {
  width: 100%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 255, 0.94));
  border: 1px solid #d2dbf3;
  border-radius: 28px;
  padding: 0.8rem;
  box-shadow: 0 18px 40px rgba(42, 72, 128, 0.1);
}

.definition-btn,
.table-link-btn {
  border-radius: 14px;
  font-weight: 700;
}

.definition-btn--primary {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(135deg, #3478f6, #3f86ff);
}

.table-link-btn {
  min-height: 30px;
  padding: 0 12px;
  color: var(--color-primary-dark, #1f57cc);
  border: 1px solid rgba(52, 120, 246, 0.16);
  background: rgba(244, 249, 255, 0.96);
}

.table-link-btn--primary {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(135deg, #3478f6, #3f86ff);
}

.table-link-btn--sm {
  min-height: 28px;
  padding: 0 10px;
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

.detail-hero-card {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.9fr);
  gap: 16px;
  padding: 20px 22px;
  border-radius: 24px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(244, 248, 255, 0.95));
  box-shadow: 0 16px 38px rgba(42, 72, 128, 0.08);
}

.detail-hero-card__main h3 {
  margin: 10px 0 0;
  color: #22344d;
  font-size: 1.4rem;
}

.detail-hero-card__main p {
  margin: 10px 0 0;
  color: #7085a6;
  line-height: 1.7;
}

.detail-hero-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  margin-top: 14px;
  color: #7085a6;
  font-size: 0.875rem;
}

.detail-hero-card__stats {
  display: grid;
  gap: 10px;
}

.detail-stat-card,
.detail-card,
.variable-graph-card,
.flow-step-card {
  border: 1px solid rgba(205, 216, 238, 0.86);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 255, 0.95));
}

.detail-stat-card {
  border-radius: 18px;
  padding: 14px 16px;
  display: grid;
  gap: 4px;
}

.detail-stat-card__label {
  color: #7b8ba3;
  font-size: 12px;
  font-weight: 700;
}

.detail-stat-card strong {
  color: #22344d;
  font-size: 1.1rem;
}

.detail-card :deep(.el-card__body) {
  padding: 0 18px 18px;
}

.section-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  color: #7085a6;
  font-size: 13px;
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
  border-radius: 16px;
  padding: 16px;
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

@media (max-width: 960px) {
  .summary-grid,
  .detail-hero-card {
    grid-template-columns: minmax(0, 1fr);
  }

  .admin-list-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .admin-list-toolbar__group {
    justify-content: space-between;
  }

  .search {
    width: 100%;
  }
}
</style>
