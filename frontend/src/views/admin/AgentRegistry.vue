<template>
  <div class="agent-registry-page">
    <div class="page-header">
      <h2 class="page-title">🧩 Agent 注册管理</h2>
      <p class="page-subtitle">查看已注册 Agent 的状态、调用和版本信息</p>
    </div>

    <div class="summary-grid" v-if="summary">
      <el-card class="summary-card" shadow="hover">
        <div class="label">已注册</div>
        <div class="value">{{ summary.total }}</div>
      </el-card>
      <el-card class="summary-card" shadow="hover">
        <div class="label">24h 活跃</div>
        <div class="value">{{ summary.active24h }}</div>
      </el-card>
      <el-card class="summary-card" shadow="hover">
        <div class="label">未调用</div>
        <div class="value">{{ summary.neverCalled }}</div>
      </el-card>
      <el-card class="summary-card" shadow="hover">
        <div class="label">需关注</div>
        <div class="value danger">{{ summary.unhealthy }}</div>
      </el-card>
    </div>

    <div class="filters">
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
    </div>

    <el-table :data="filteredAgents" v-loading="loading" stripe style="width: 100%">
      <el-table-column prop="agentId" label="Agent ID" min-width="170" />
      <el-table-column prop="name" label="名称" min-width="180" />
      <el-table-column prop="type" label="类型" width="100" />
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
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { adminAgentsApi, type AdminRegistryAgent } from '@/api/adminApi';

const loading = ref(false);
const summary = ref<{ total: number; active24h: number; neverCalled: number; unhealthy: number } | null>(null);
const agents = ref<AdminRegistryAgent[]>([]);
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
    ElMessage.error('加载 Agent 注册列表失败');
  } finally {
    loading.value = false;
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
}

.page-header {
  margin-bottom: 1rem;
}

.page-title {
  margin: 0;
  color: var(--text-primary);
}

.page-subtitle {
  margin: 0.4rem 0 0;
  color: var(--text-secondary);
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
</style>
