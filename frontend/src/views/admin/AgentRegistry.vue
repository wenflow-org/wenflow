<template>
  <div class="agent-registry-page">
    <div class="bg-layer" aria-hidden="true">
      <div class="bg-orb bg-orb--1"></div>
      <div class="bg-orb bg-orb--2"></div>
    </div>

    <div class="page-hero">
      <span class="pill">Admin</span>
      <h2 class="page-hero__title">
        <el-icon class="page-title-icon"><Grid /></el-icon>
        Agent 注册管理
      </h2>
      <p class="page-hero__subtitle">查看和管理已注册的 Agent 列表</p>
    </div>

    <div class="summary-grid" v-show="summary" style="position: relative; z-index: 1;">
      <el-card class="summary-card summary-card--blue" shadow="hover">
        <div class="label">已注册</div>
        <div class="value">{{ summary?.total }}</div>
      </el-card>
      <el-card class="summary-card summary-card--green" shadow="hover">
        <div class="label">24h 活跃</div>
        <div class="value">{{ summary?.active24h }}</div>
      </el-card>
      <el-card class="summary-card summary-card--orange" shadow="hover">
        <div class="label">未调用</div>
        <div class="value">{{ summary?.neverCalled }}</div>
      </el-card>
      <el-card class="summary-card summary-card--red" shadow="hover">
        <div class="label">需关注</div>
        <div class="value danger">{{ summary?.unhealthy }}</div>
      </el-card>
    </div>

    <div class="filters" style="position: relative; z-index: 1;">
      <el-input v-model="keyword" placeholder="搜索 Agent ID / 名称" clearable class="search" />
      <el-select v-model="lifecycle" placeholder="发布状态" clearable class="select">
        <el-option label="草稿" value="draft" />
        <el-option label="预发布" value="staging" />
        <el-option label="已发布" value="published" />
      </el-select>
      <el-select v-model="health" placeholder="健康状态" clearable class="select">
        <el-option label="健康" value="healthy" />
        <el-option label="预警" value="warning" />
        <el-option label="异常" value="error" />
        <el-option label="空闲" value="idle" />
      </el-select>
      <el-button type="primary" @click="loadRegistry" :loading="loading">
        <el-icon><Refresh /></el-icon>
        刷新
      </el-button>
    </div>

    <el-table :data="filteredAgents" v-loading="loading" stripe style="width: 100%; position: relative; z-index: 1;">
      <el-table-column prop="agentId" label="Agent ID" min-width="170" show-overflow-tooltip />
      <el-table-column prop="name" label="名称" min-width="180" show-overflow-tooltip />
      <el-table-column prop="type" label="类型" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="type-cell">{{ row.type }}</span>
        </template>
      </el-table-column>
      <el-table-column label="运行角色/层级" width="130">
        <template #default="{ row }">
          <el-tag :type="getRuntimeRoleTagType(row)" size="small">{{ getRuntimeRoleLabel(row) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="lifecycleStatus" label="发布状态" width="110">
        <template #default="{ row }">
          <el-tag :type="getLifecycleTagType(row.lifecycleStatus)" size="small">{{ row.lifecycleStatus }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="健康状态" width="100">
        <template #default="{ row }">
          <el-tag :type="getHealthTagType(row.status)" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="callCount" label="调用" width="90" align="center" sortable />
      <el-table-column prop="successRate" label="成功率" width="120">
        <template #default="{ row }">
          <span :class="rateClass(row.successRate)">{{ row.successRate }}%</span>
        </template>
      </el-table-column>
      <el-table-column prop="avgDuration" label="平均耗时" width="100" align="center">
        <template #default="{ row }">{{ row.avgDuration }}ms</template>
      </el-table-column>
      <el-table-column prop="lastActivity" label="最后活跃" min-width="150">
        <template #default="{ row }">{{ formatTime(row.lastActivity) }}</template>
      </el-table-column>
      <el-table-column prop="version" label="版本" width="90" align="center" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link @click="openDesign(row)">查看设计</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-drawer
      v-model="designDrawerVisible"
      :title="`Agent 设计详情 · ${currentDesign?.agentId || ''}`"
      size="min(58%, 800px)"
      destroy-on-close
    >
      <div v-loading="designLoading" class="design-drawer">
        <template v-if="currentDesign">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="名称">{{ currentDesign.basic.name }}</el-descriptions-item>
            <el-descriptions-item label="版本">{{ currentDesign.basic.version }}</el-descriptions-item>
            <el-descriptions-item label="类型">{{ currentDesign.basic.type }}</el-descriptions-item>
            <el-descriptions-item label="分类">{{ currentDesign.basic.category }}</el-descriptions-item>
            <el-descriptions-item label="角色">{{ currentDesign.runtime.role }}</el-descriptions-item>
            <el-descriptions-item label="运行类型">{{ currentDesign.runtime.kind }}</el-descriptions-item>
            <el-descriptions-item label="启用状态">
              <el-tag :type="currentDesign.runtime.runtimeEnabled ? 'success' : 'info'" size="small">
                {{ currentDesign.runtime.runtimeEnabled ? 'enabled' : 'disabled' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="输出协议">
              <el-tag :type="currentDesign.runtime.ioContractVersion === 'agent-output-v1' ? 'success' : 'warning'" size="small">
                {{ currentDesign.runtime.ioContractVersion }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="监控分组">{{ currentDesign.runtime.monitoringGroup || '-' }}</el-descriptions-item>
            <el-descriptions-item label="别名">{{ currentDesign.runtime.aliases.join(', ') || '-' }}</el-descriptions-item>
            <el-descriptions-item label="描述" :span="2">{{ currentDesign.basic.description || '-' }}</el-descriptions-item>
          </el-descriptions>

          <div class="chip-section">
            <div class="chip-row">
              <span class="chip-label">capabilities</span>
              <el-tag v-for="item in currentDesign.definition.capabilities" :key="`cap-${item}`" size="small" effect="plain">{{ item }}</el-tag>
              <span v-if="!currentDesign.definition.capabilities.length" class="empty">-</span>
            </div>
            <div class="chip-row">
              <span class="chip-label">subscribes</span>
              <el-tag v-for="item in currentDesign.definition.subscribes" :key="`sub-${item}`" size="small" effect="plain">{{ item }}</el-tag>
              <span v-if="!currentDesign.definition.subscribes.length" class="empty">-</span>
            </div>
            <div class="chip-row">
              <span class="chip-label">publishes</span>
              <el-tag v-for="item in currentDesign.definition.publishes" :key="`pub-${item}`" size="small" effect="plain">{{ item }}</el-tag>
              <span v-if="!currentDesign.definition.publishes.length" class="empty">-</span>
            </div>
          </div>

          <el-tabs class="design-tabs">
            <el-tab-pane label="Input Schema">
              <el-table :data="inputSchemaRows" border size="small" empty-text="无 input schema">
                <el-table-column prop="path" label="字段路径" min-width="240" />
                <el-table-column prop="type" label="类型" width="120" />
                <el-table-column prop="required" label="必填" width="90" />
                <el-table-column prop="description" label="说明" min-width="220" />
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="Output Schema">
              <el-table :data="outputSchemaRows" border size="small" empty-text="无 output schema">
                <el-table-column prop="path" label="字段路径" min-width="240" />
                <el-table-column prop="type" label="类型" width="120" />
                <el-table-column prop="required" label="必填" width="90" />
                <el-table-column prop="description" label="说明" min-width="220" />
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="Recent Samples">
              <div class="sample-block">
                <h4>agent_call_logs</h4>
                <el-collapse>
                  <el-collapse-item
                    v-for="item in currentDesign.samples.agentCallLogs"
                    :key="`call-${item.id}`"
                    :title="`${formatTime(item.calledAt)} · ${item.success ? 'success' : 'error'} · ${item.durationMs || 0}ms`"
                  >
                    <pre class="sample-json">{{ prettyJson({ input: item.input, output: item.output, error: item.error }) }}</pre>
                  </el-collapse-item>
                </el-collapse>
              </div>

              <div class="sample-block">
                <h4>arena_agent_logs</h4>
                <el-collapse>
                  <el-collapse-item
                    v-for="item in currentDesign.samples.arenaAgentLogs"
                    :key="`arena-${item.id}`"
                    :title="`${formatTime(item.calledAt)} · ${item.success ? 'success' : 'error'} · ${item.durationMs || 0}ms`"
                  >
                    <pre class="sample-json">{{ prettyJson({ input: item.input, output: item.output, error: item.error }) }}</pre>
                  </el-collapse-item>
                </el-collapse>
              </div>
            </el-tab-pane>
          </el-tabs>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Grid, Refresh } from '@element-plus/icons-vue';
import { adminAgentsApi, type AdminRegistryAgent, type AgentDesignDetail } from '@/api/adminApi';
import { toast } from '../../utils/toast';

const loading = ref(false);
const summary = ref<{ total: number; active24h: number; neverCalled: number; unhealthy: number } | null>(null);
const agents = ref<AdminRegistryAgent[]>([]);
const designDrawerVisible = ref(false);
const designLoading = ref(false);
const currentDesign = ref<AgentDesignDetail | null>(null);
const keyword = ref('');
const lifecycle = ref('');
const health = ref('');

const orchestratorIds = new Set([
  'ai-teaching',
  'ai-teaching-agent',
  'requirement-orchestrator',
  'path-orchestrator'
]);

const filteredAgents = computed(() => {
  return agents.value.filter(agent => {
    const byKeyword = !keyword.value || `${agent.agentId} ${agent.name}`.toLowerCase().includes(keyword.value.toLowerCase());
    const byLifecycle = !lifecycle.value || agent.lifecycleStatus === lifecycle.value;
    const byHealth = !health.value || agent.status === health.value;
    return byKeyword && byLifecycle && byHealth;
  });
});

const loadRegistry = async () => {
  loading.value = true;
  try {
    const response: any = await adminAgentsApi.getRegistry();
    summary.value = response.data.data.summary;
    agents.value = response.data.data.agents || [];
  } catch (error) {
    console.error('加载 Agent 注册列表失败:', error);
    toast.error('加载 Agent 注册列表失败');
  } finally {
    loading.value = false;
  }
};

interface SchemaRow {
  path: string;
  type: string;
  required: 'yes' | 'no';
  description: string;
}

const toSchemaRows = (schema: any): SchemaRow[] => {
  if (!schema || typeof schema !== 'object') return [];
  const rows: SchemaRow[] = [];

  const walk = (node: any, path: string, requiredList: string[] = []) => {
    if (!node || typeof node !== 'object') return;
    const props = node.properties || {};
    const currentRequired = Array.isArray(node.required) ? node.required : requiredList;

    for (const key of Object.keys(props)) {
      const child = props[key] || {};
      const childPath = path ? `${path}.${key}` : key;
      rows.push({
        path: childPath,
        type: child.type || (child.properties ? 'object' : 'any'),
        required: currentRequired.includes(key) ? 'yes' : 'no',
        description: child.description || ''
      });

      if (child.type === 'object' && child.properties) {
        walk(child, childPath, Array.isArray(child.required) ? child.required : []);
      }
      if (child.type === 'array' && child.items && child.items.properties) {
        walk({ properties: child.items.properties, required: child.items.required || [] }, `${childPath}[]`);
      }
    }
  };

  walk(schema, '');
  return rows;
};

const inputSchemaRows = computed(() => toSchemaRows(currentDesign.value?.definition.inputSchema));
const outputSchemaRows = computed(() => toSchemaRows(currentDesign.value?.definition.outputSchema));

const prettyJson = (value: any) => {
  if (value === null || value === undefined) return '-';
  return JSON.stringify(value, null, 2);
};

const openDesign = async (agent: AdminRegistryAgent) => {
  designDrawerVisible.value = true;
  designLoading.value = true;
  try {
    const response: any = await adminAgentsApi.getAgentDesign(agent.agentId);
    currentDesign.value = response.data.data;
  } catch (error) {
    console.error('加载 Agent 设计失败:', error);
    toast.error('加载 Agent 设计失败');
  } finally {
    designLoading.value = false;
  }
};

const formatTime = (time: string | null) => {
  if (!time) return '从未';
  return new Date(time).toLocaleString('zh-CN');
};

const getLifecycleTagType = (status: string) => {
  if (status === 'published') return 'success';
  if (status === 'staging') return 'warning';
  return 'info';
};

const getHealthTagType = (status: string) => {
  if (status === 'healthy') return 'success';
  if (status === 'warning') return 'warning';
  if (status === 'error') return 'danger';
  return 'info';
};

const getRuntimeRole = (agent: AdminRegistryAgent): 'orchestrator' | 'agent' => {
  const roleHint = `${agent.role || ''} ${agent.type || ''}`.toLowerCase();
  if (roleHint.includes('orchestrator')) return 'orchestrator';
  if (orchestratorIds.has(agent.agentId)) return 'orchestrator';
  if (agent.agentId.endsWith('-orchestrator')) return 'orchestrator';
  return 'agent';
};

const getRuntimeRoleLabel = (agent: AdminRegistryAgent) => {
  return getRuntimeRole(agent) === 'orchestrator' ? 'orchestrator' : 'agent';
};

const getRuntimeRoleTagType = (agent: AdminRegistryAgent) => {
  return getRuntimeRole(agent) === 'orchestrator' ? 'warning' : 'info';
};

const rateClass = (rate: number) => {
  if (rate >= 95) return 'rate-good';
  if (rate >= 80) return 'rate-mid';
  return 'rate-bad';
};

onMounted(loadRegistry);
</script>

<style scoped>
.agent-registry-page {
  padding: 1.25rem;
  position: relative;
}

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

.page-title-icon {
  color: var(--color-primary);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.8rem;
  margin-bottom: 1rem;
}

.summary-card .label {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.summary-card .value {
  color: var(--text-primary);
  font-size: 1.6rem;
  font-weight: 700;
}

.summary-card .value.danger {
  color: var(--color-danger);
}

/* Summary card gradient variants */
.summary-card--blue { border-radius: 16px; background: linear-gradient(135deg, rgba(52, 120, 246, 0.06), rgba(52, 120, 246, 0.02)); border: 1px solid rgba(52, 120, 246, 0.1); }
.summary-card--green { border-radius: 16px; background: linear-gradient(135deg, rgba(16, 185, 129, 0.06), rgba(16, 185, 129, 0.02)); border: 1px solid rgba(16, 185, 129, 0.1); }
.summary-card--orange { border-radius: 16px; background: linear-gradient(135deg, rgba(245, 158, 11, 0.06), rgba(245, 158, 11, 0.02)); border: 1px solid rgba(245, 158, 11, 0.1); }
.summary-card--red { border-radius: 16px; background: linear-gradient(135deg, rgba(239, 68, 68, 0.06), rgba(239, 68, 68, 0.02)); border: 1px solid rgba(239, 68, 68, 0.1); }

.filters {
  margin-bottom: 1rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.search {
  width: 260px;
}

.select {
  width: 140px;
}

.rate-good {
  color: var(--color-success);
}

.rate-mid {
  color: var(--color-primary);
}

.rate-bad {
  color: var(--color-danger);
}

.type-cell {
  white-space: nowrap;
}

.design-drawer {
  padding-right: 0.4rem;
}

.chip-section {
  margin-top: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
}

.chip-label {
  min-width: 92px;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.empty {
  color: var(--text-muted);
}

.design-tabs {
  margin-top: 1rem;
}

.sample-block {
  margin-bottom: 1rem;
}

.sample-block h4 {
  margin: 0 0 0.55rem;
  color: var(--text-primary);
}

.sample-json {
  background: var(--bg-secondary);
  padding: 0.75rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

/* Table deep overrides */
.agent-registry-page :deep(.el-table) {
  border-radius: 16px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(12px);
}

.agent-registry-page :deep(.el-table th.el-table__cell) {
  background: rgba(52, 120, 246, 0.04);
  font-weight: 600;
}

.agent-registry-page :deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background: rgba(52, 120, 246, 0.02);
}

.agent-registry-page :deep(.el-table td.el-table__cell) {
  border-bottom: 1px solid rgba(52, 120, 246, 0.06);
}
</style>
