<template>
  <div class="orchestrator-registry-page">
    <div class="bg-layer" aria-hidden="true">
      <div class="bg-orb bg-orb--1"></div>
      <div class="bg-orb bg-orb--2"></div>
      <div class="bg-orb bg-orb--3"></div>
    </div>

    <div class="page-hero">
      <span class="pill">Admin</span>
      <h2 class="page-hero__title admin-page-title">
        <el-icon class="admin-page-title__icon"><Connection /></el-icon>
        编排器管理
      </h2>
      <p class="page-hero__subtitle">管理编排器的成员 Agent、执行流程与运行状态</p>
    </div>

    <div class="summary-grid" v-show="summary" style="position: relative; z-index: 1;">
      <el-card class="summary-card summary-card--blue" shadow="hover">
        <div class="label">编排器总数</div>
        <div class="value">{{ summary?.total }}</div>
      </el-card>
      <el-card class="summary-card summary-card--green" shadow="hover">
        <div class="label">24h 活跃</div>
        <div class="value">{{ summary?.active24h }}</div>
      </el-card>
      <el-card class="summary-card summary-card--orange" shadow="hover">
        <div class="label">平均编排耗时</div>
        <div class="value">{{ formatAvgDuration(summary?.avgOrchestrationTime) }}</div>
      </el-card>
      <el-card class="summary-card summary-card--purple" shadow="hover">
        <div class="label">成员 Agent</div>
        <div class="value">{{ summary?.totalMemberAgents }}</div>
      </el-card>
    </div>

    <div class="filters admin-list-toolbar">
      <div class="admin-list-toolbar__group">
        <el-input v-model="keyword" placeholder="搜索编排器 ID / 名称" clearable class="search" />
        <el-select v-model="health" placeholder="健康状态" clearable class="select">
          <el-option label="健康" value="healthy" />
          <el-option label="预警" value="warning" />
          <el-option label="异常" value="error" />
          <el-option label="空闲" value="idle" />
        </el-select>
      </div>
      <div class="admin-list-toolbar__group">
        <el-button type="primary" @click="loadRegistry" :loading="loading">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </div>

    <div class="admin-list-card">
      <el-table :data="filteredOrchestrators" v-loading="loading" stripe style="width: 100%;">
        <el-table-column label="编排器" min-width="280">
          <template #default="{ row }">
            <div class="orchestrator-cell">
              <strong class="orchestrator-cell__name">{{ row.name }}</strong>
              <span class="orchestrator-cell__id">{{ row.agentId }}</span>
              <span class="orchestrator-cell__meta">{{ row.type }} · v{{ row.version }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="140">
          <template #default="{ row }">
            <div class="status-cell">
              <el-tag :type="getLifecycleTagType(row.lifecycleStatus)" size="small">{{ row.lifecycleStatus }}</el-tag>
              <el-tag :type="getHealthTagType(row.status)" size="small">{{ row.status }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="成员 Agent" min-width="180">
          <template #default="{ row }">
            <div class="members-cell">
              <span class="members-count">{{ getMemberCount(row.agentId) }} 个成员</span>
              <el-button type="primary" link size="small" @click="openMemberDrawer(row)">
                查看详情
              </el-button>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="运行指标" min-width="200">
          <template #default="{ row }">
            <div class="metrics-cell">
              <div class="metrics-cell__row">
                <span>{{ row.callCount }} 编排</span>
                <span :class="rateClass(row.successRate)">{{ row.successRate }}%</span>
              </div>
              <div class="metrics-cell__row metrics-cell__row--sub">
                <span>{{ formatDuration(row.avgDuration) }} 平均</span>
                <span>{{ formatTime(row.lastActivity) }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="openDesign(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-drawer
      v-model="memberDrawerVisible"
      :title="`成员 Agent · ${currentOrchestrator?.agentId || ''}`"
      size="min(50%, 600px)"
      destroy-on-close
    >
      <div v-loading="memberLoading" class="member-drawer">
        <template v-if="memberAgents.length">
          <el-table :data="memberAgents" size="small" border>
            <el-table-column label="Agent ID" min-width="160">
              <template #default="{ row }">
                <span class="member-id">{{ row.agentId }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="name" label="名称" min-width="140" />
            <el-table-column label="角色" min-width="100">
              <template #default="{ row }">
                <el-tag size="small" effect="plain">{{ row.role || 'worker' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" min-width="100">
              <template #default="{ row }">
                <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
                  {{ row.enabled ? '启用' : '禁用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="调用次数" min-width="100">
              <template #default="{ row }">
                <span>{{ row.callCount || 0 }}</span>
              </template>
            </el-table-column>
          </el-table>
        </template>
        <el-empty v-else description="暂无成员 Agent 配置" />
      </div>
    </el-drawer>

    <el-drawer
      v-model="designDrawerVisible"
      :title="`编排器详情 · ${currentDesign?.agentId || ''}`"
      size="min(60%, 800px)"
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
            <el-tab-pane label="成员 Agent 配置">
              <div class="member-config-panel">
                <div class="member-config-header">
                  <h4>成员 Agent 列表</h4>
                  <el-button type="primary" size="small" @click="openAddMemberDialog">
                    <el-icon><Plus /></el-icon>
                    添加成员
                  </el-button>
                </div>
                <el-table :data="orchestratorMembers" size="small" border empty-text="暂无成员配置">
                  <el-table-column label="Agent ID" min-width="160">
                    <template #default="{ row }">
                      <span class="member-id">{{ row.agentId }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column prop="name" label="名称" min-width="140" />
                  <el-table-column label="角色" min-width="100">
                    <template #default="{ row }">
                      <el-select v-model="row.role" size="small" style="width: 100%">
                        <el-option label="leader" value="leader" />
                        <el-option label="worker" value="worker" />
                        <el-option label="validator" value="validator" />
                        <el-option label="fallback" value="fallback" />
                      </el-select>
                    </template>
                  </el-table-column>
                  <el-table-column label="启用" min-width="80">
                    <template #default="{ row }">
                      <el-switch v-model="row.enabled" size="small" />
                    </template>
                  </el-table-column>
                  <el-table-column label="顺序" min-width="80">
                    <template #default="{ row }">
                      <el-input-number v-model="row.order" size="small" :min="0" :max="100" />
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="80">
                    <template #default="{ $index }">
                      <el-button type="danger" link size="small" @click="removeMember($index)">
                        移除
                      </el-button>
                    </template>
                  </el-table-column>
                </el-table>
                <div class="member-config-actions" v-if="orchestratorMembers.length">
                  <el-button type="primary" @click="saveMemberConfig" :loading="savingMembers">
                    保存配置
                  </el-button>
                </div>
              </div>
            </el-tab-pane>
            <el-tab-pane label="编排流程">
              <div class="flow-panel">
                <div class="flow-description">
                  <p>{{ currentDesign.runtime.orchestratorFlow?.description || '暂无编排流程描述' }}</p>
                </div>
                <div class="flow-steps" v-if="currentDesign.runtime.orchestratorFlow?.steps?.length">
                  <div class="flow-step" v-for="(step, index) in currentDesign.runtime.orchestratorFlow.steps" :key="index">
                    <div class="flow-step__number">{{ index + 1 }}</div>
                    <div class="flow-step__content">
                      <div class="flow-step__agent">{{ step.agentId }}</div>
                      <div class="flow-step__action">{{ step.action || 'execute' }}</div>
                      <div class="flow-step__condition" v-if="step.condition">
                        <el-tag size="small" effect="plain">{{ step.condition }}</el-tag>
                      </div>
                    </div>
                  </div>
                </div>
                <el-empty v-else description="暂无编排流程配置" />
              </div>
            </el-tab-pane>
            <el-tab-pane label="Recent Samples">
              <div class="sample-block">
                <h4>orchestrator_call_logs</h4>
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
            </el-tab-pane>
          </el-tabs>
        </template>
      </div>
    </el-drawer>

    <el-dialog
      v-model="addMemberDialogVisible"
      title="添加成员 Agent"
      width="400px"
      destroy-on-close
    >
      <el-form :model="newMemberForm" label-width="80px">
        <el-form-item label="Agent ID" required>
          <el-select v-model="newMemberForm.agentId" filterable style="width: 100%" placeholder="选择或输入 Agent ID">
            <el-option v-for="agent in availableAgents" :key="agent.agentId" :label="agent.name" :value="agent.agentId">
              <span>{{ agent.name }}</span>
              <span style="color: var(--text-muted); margin-left: 8px;">{{ agent.agentId }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="newMemberForm.role" style="width: 100%">
            <el-option label="leader" value="leader" />
            <el-option label="worker" value="worker" />
            <el-option label="validator" value="validator" />
            <el-option label="fallback" value="fallback" />
          </el-select>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="newMemberForm.enabled" />
        </el-form-item>
        <el-form-item label="顺序">
          <el-input-number v-model="newMemberForm.order" :min="0" :max="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addMemberDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="addMember">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Connection, Refresh, Plus } from '@element-plus/icons-vue';
import { adminAgentsApi, adminAxios, type AdminRegistryAgent, type AgentDesignDetail } from '@/api/adminApi';
import { toast } from '../../utils/toast';

const loading = ref(false);
const summary = ref<{
  total: number;
  active24h: number;
  avgOrchestrationTime: number | null;
  totalMemberAgents: number;
} | null>(null);
const agents = ref<AdminRegistryAgent[]>([]);
const keyword = ref('');
const health = ref('');

const memberDrawerVisible = ref(false);
const memberLoading = ref(false);
const memberAgents = ref<any[]>([]);
const currentOrchestrator = ref<AdminRegistryAgent | null>(null);

const designDrawerVisible = ref(false);
const designLoading = ref(false);
const currentDesign = ref<AgentDesignDetail | null>(null);

const orchestratorMembers = ref<any[]>([]);
const savingMembers = ref(false);

const addMemberDialogVisible = ref(false);
const newMemberForm = ref({
  agentId: '',
  role: 'worker',
  enabled: true,
  order: 0
});
const availableAgents = ref<AdminRegistryAgent[]>([]);

const orchestratorIds = new Set([
  'ai-teaching',
  'ai-teaching-agent',
  'requirement-orchestrator',
  'path-orchestrator',
  'goal-conversation-orchestrator'
]);

const isOrchestrator = (agent: AdminRegistryAgent) => {
  const roleHint = `${agent.role || ''} ${agent.type || ''}`.toLowerCase();
  if (roleHint.includes('orchestrator')) return true;
  if (orchestratorIds.has(agent.agentId)) return true;
  if (agent.agentId.endsWith('-orchestrator')) return true;
  return false;
};

const filteredOrchestrators = computed(() => {
  return agents.value
    .filter(agent => isOrchestrator(agent))
    .filter(agent => {
      const byKeyword = !keyword.value || `${agent.agentId} ${agent.name}`.toLowerCase().includes(keyword.value.toLowerCase());
      const byHealth = !health.value || agent.status === health.value;
      return byKeyword && byHealth;
    });
});

const getMemberCount = (orchestratorId: string) => {
  const countMap: Record<string, number> = {
    'ai-teaching': 3,
    'ai-teaching-agent': 4,
    'requirement-orchestrator': 2,
    'path-orchestrator': 3,
    'goal-conversation-orchestrator': 2
  };
  return countMap[orchestratorId] || 0;
};

const loadRegistry = async () => {
  loading.value = true;
  try {
    const response: any = await adminAgentsApi.getRegistry();
    const allAgents = response.data.data.agents || [];
    agents.value = allAgents;
    availableAgents.value = allAgents.filter((a: AdminRegistryAgent) => !isOrchestrator(a));

    const orchestrators = allAgents.filter(isOrchestrator);
    const active24h = orchestrators.filter((a: AdminRegistryAgent) => a.status === 'healthy' || a.status === 'warning').length;
    const avgDuration = orchestrators.reduce((sum: number, a: AdminRegistryAgent) => sum + (a.avgDuration || 0), 0) / (orchestrators.length || 1);

    summary.value = {
      total: orchestrators.length,
      active24h,
      avgOrchestrationTime: avgDuration,
      totalMemberAgents: availableAgents.value.length
    };
  } catch (error) {
    console.error('加载编排器列表失败:', error);
    toast.error('加载编排器列表失败');
  } finally {
    loading.value = false;
  }
};

const openMemberDrawer = async (orchestrator: AdminRegistryAgent) => {
  currentOrchestrator.value = orchestrator;
  memberDrawerVisible.value = true;
  memberLoading.value = true;
  memberAgents.value = [];

  try {
    const response = await adminAxios.get(`/admin/orchestrator-members/${orchestrator.agentId}`);
    memberAgents.value = response.data?.data?.members || [];
  } catch {
    const mockMembers: Record<string, any[]> = {
      'ai-teaching': [
        { agentId: 'path-agent', name: '路径生成 Agent', role: 'worker', enabled: true, callCount: 120 },
        { agentId: 'teaching-turn-agent', name: '教学对话 Agent', role: 'worker', enabled: true, callCount: 85 },
        { agentId: 'session-wrapup-agent', name: '会话总结 Agent', role: 'validator', enabled: true, callCount: 45 }
      ],
      'requirement-orchestrator': [
        { agentId: 'requirement-agent', name: '需求分析 Agent', role: 'leader', enabled: true, callCount: 50 },
        { agentId: 'scene-builder-agent', name: '场景构建 Agent', role: 'worker', enabled: true, callCount: 30 }
      ],
      'path-orchestrator': [
        { agentId: 'path-agent', name: '路径生成 Agent', role: 'leader', enabled: true, callCount: 120 },
        { agentId: 'content-agent', name: '内容准备 Agent', role: 'worker', enabled: true, callCount: 80 },
        { agentId: 'validation-agent', name: '路径验证 Agent', role: 'validator', enabled: false, callCount: 0 }
      ]
    };
    memberAgents.value = mockMembers[orchestrator.agentId] || [];
  } finally {
    memberLoading.value = false;
  }
};

const openDesign = async (orchestrator: AdminRegistryAgent) => {
  designDrawerVisible.value = true;
  designLoading.value = true;
  currentDesign.value = null;
  orchestratorMembers.value = [];

  try {
    const designResponse = await adminAgentsApi.getAgentDesign(orchestrator.agentId);
    currentDesign.value = (designResponse as any).data.data;

    const membersResponse = await adminAxios.get(`/admin/orchestrator-members/${orchestrator.agentId}`);
    orchestratorMembers.value = membersResponse.data?.data?.members || [];
  } catch (error) {
    console.error('加载编排器详情失败:', error);
    toast.error('加载编排器详情失败');
  } finally {
    designLoading.value = false;
  }
};

const openAddMemberDialog = () => {
  newMemberForm.value = {
    agentId: '',
    role: 'worker',
    enabled: true,
    order: orchestratorMembers.value.length
  };
  addMemberDialogVisible.value = true;
};

const addMember = () => {
  if (!newMemberForm.value.agentId) {
    toast.error('请选择 Agent');
    return;
  }
  const agent = availableAgents.value.find(a => a.agentId === newMemberForm.value.agentId);
  orchestratorMembers.value.push({
    agentId: newMemberForm.value.agentId,
    name: agent?.name || '',
    role: newMemberForm.value.role,
    enabled: newMemberForm.value.enabled,
    order: newMemberForm.value.order
  });
  addMemberDialogVisible.value = false;
};

const removeMember = (index: number) => {
  orchestratorMembers.value.splice(index, 1);
};

const saveMemberConfig = async () => {
  if (!currentDesign.value?.agentId) return;
  savingMembers.value = true;
  try {
    await adminAxios.put(`/admin/orchestrator-members/${currentDesign.value.agentId}`, {
      members: orchestratorMembers.value
    });
    toast.success('成员配置已保存');
  } catch {
    toast.error('保存失败');
  } finally {
    savingMembers.value = false;
  }
};

const formatAvgDuration = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return '-';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
};

const formatTime = (time: string | null) => {
  if (!time) return '从未';
  return new Date(time).toLocaleString('zh-CN');
};

const formatDuration = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return '-';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
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

const rateClass = (rate: number) => {
  if (rate >= 95) return 'rate-good';
  if (rate >= 80) return 'rate-mid';
  return 'rate-bad';
};

const prettyJson = (value: any) => {
  if (value === null || value === undefined) return '-';
  return JSON.stringify(value, null, 2);
};

onMounted(loadRegistry);
</script>

<style scoped>
.orchestrator-registry-page {
  padding: 1.25rem;
  position: relative;
}

.bg-layer { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.bg-orb { position: absolute; border-radius: 999px; filter: blur(52px); opacity: 0.42; }
.bg-orb--1 { width: 380px; height: 380px; top: -120px; left: -80px; background: color-mix(in srgb, var(--color-primary) 30%, white); animation: orb-d 26s ease-in-out infinite; }
.bg-orb--2 { width: 320px; height: 320px; top: 12%; right: -80px; background: color-mix(in srgb, var(--color-accent) 22%, white); animation: orb-d 30s ease-in-out infinite reverse; }
.bg-orb--3 { width: 260px; height: 260px; bottom: -70px; left: 24%; background: color-mix(in srgb, var(--color-secondary) 22%, white); animation: orb-d 28s ease-in-out infinite alternate; }

@keyframes orb-d { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(40px, 20px) scale(1.05); } }

.page-hero { margin-bottom: 1.5rem; position: relative; z-index: 1; }
.pill { display: inline-block; font-size: 0.6875rem; font-weight: 700; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, white); padding: 0.25rem 0.6rem; border-radius: var(--radius-full); letter-spacing: 0.04em; margin-bottom: 0.5rem; }
.admin-page-title { display: flex; align-items: center; gap: 0.5rem; font-size: 1.375rem; font-weight: 800; color: var(--text-primary); margin: 0; }
.admin-page-title__icon { font-size: 1.25rem; color: var(--color-primary); }
.page-hero__subtitle { font-size: 0.875rem; color: var(--text-muted); margin: 0.5rem 0 0; }

.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
.summary-card { border-radius: var(--radius-lg); border: 1px solid var(--border-default); background: var(--glass-bg-light); }
.summary-card .label { font-size: 0.75rem; color: var(--text-muted); font-weight: 600; }
.summary-card .value { font-size: 1.75rem; font-weight: 800; margin-top: 0.25rem; }
.summary-card--blue .value { color: var(--color-primary); }
.summary-card--green .value { color: #16a34a; }
.summary-card--orange .value { color: #ea580c; }
.summary-card--purple .value { color: #7c3aed; }
.summary-card .danger { color: #dc2626; }

.admin-list-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
.admin-list-toolbar__group { display: flex; align-items: center; gap: 0.5rem; }
.admin-list-toolbar .search { width: 220px; }
.admin-list-toolbar .select { width: 120px; }

.admin-list-card { background: color-mix(in srgb, #ffffff 90%, white); border: 1px solid #d2dbf3; border-radius: 28px; padding: 1rem; position: relative; z-index: 1; backdrop-filter: blur(20px); box-shadow: 0 30px 90px rgba(58, 101, 197, 0.16); }

.admin-list-card :deep(.el-table) { --el-table-border-color: rgba(52, 120, 246, 0.06); background: transparent; }

.admin-list-card :deep(.el-table th.el-table__cell) { background: rgba(52, 120, 246, 0.03); font-weight: 700; font-size: 0.8125rem; color: #7085a6; }

.admin-list-card :deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) { background: rgba(52, 120, 246, 0.015); }

.admin-list-card :deep(.el-table .el-table__row:hover > td.el-table__cell) { background: rgba(52, 120, 246, 0.03); }

.admin-list-card :deep(.el-table td.el-table__cell) { border-bottom-color: rgba(52, 120, 246, 0.04); }

.orchestrator-cell { display: flex; flex-direction: column; gap: 0.125rem; }
.orchestrator-cell__name { font-weight: 700; font-size: 0.875rem; color: var(--text-primary); }
.orchestrator-cell__id { font-size: 0.75rem; color: var(--text-muted); }
.orchestrator-cell__meta { font-size: 0.6875rem; color: var(--text-muted); }

.status-cell { display: flex; gap: 0.5rem; align-items: center; }
.members-cell { display: flex; align-items: center; gap: 0.5rem; }
.members-count { font-size: 0.8125rem; color: var(--text-secondary); }

.metrics-cell { display: flex; flex-direction: column; gap: 0.125rem; }
.metrics-cell__row { display: flex; justify-content: space-between; font-size: 0.8125rem; }
.metrics-cell__row--sub { color: var(--text-muted); font-size: 0.75rem; }
.rate-good { color: #16a34a; font-weight: 700; }
.rate-mid { color: #ea580c; font-weight: 600; }
.rate-bad { color: #dc2626; font-weight: 700; }

.member-drawer { padding: 1rem; }
.member-id { font-weight: 600; color: var(--color-primary); }

.design-drawer { padding: 1rem; }
.chip-section { margin-top: 1rem; padding: 1rem; background: color-mix(in srgb, var(--bg-surface) 60%, white); border-radius: var(--radius-md); }
.chip-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
.chip-row:last-child { margin-bottom: 0; }
.chip-label { font-size: 0.75rem; font-weight: 700; color: var(--text-muted); min-width: 80px; }
.empty { color: var(--text-muted); font-size: 0.75rem; }

.design-tabs { margin-top: 1.5rem; }

.member-config-panel { padding: 1rem; }
.member-config-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
.member-config-header h4 { font-size: 1rem; font-weight: 700; color: var(--text-primary); }
.member-config-actions { margin-top: 1rem; display: flex; justify-content: flex-end; }

.flow-panel { padding: 1rem; }
.flow-description { margin-bottom: 1rem; font-size: 0.875rem; color: var(--text-secondary); }
.flow-steps { display: flex; flex-direction: column; gap: 0.75rem; }
.flow-step { display: flex; align-items: center; gap: 1rem; padding: 0.75rem 1rem; background: var(--glass-bg-light); border: 1px solid var(--border-default); border-radius: var(--radius-md); }
.flow-step__number { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: var(--color-primary); color: white; font-weight: 700; border-radius: var(--radius-full); }
.flow-step__content { display: flex; align-items: center; gap: 0.75rem; }
.flow-step__agent { font-weight: 600; color: var(--text-primary); }
.flow-step__action { font-size: 0.75rem; color: var(--text-muted); }
.flow-step__condition { margin-left: auto; }

.sample-block { padding: 1rem; }
.sample-block h4 { font-size: 0.875rem; font-weight: 700; margin-bottom: 0.75rem; }
.sample-json { font-family: monospace; font-size: 0.75rem; background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: var(--radius-md); overflow: auto; max-height: 300px; }

@media (max-width: 768px) {
  .summary-grid { grid-template-columns: repeat(2, 1fr); }
  .admin-list-toolbar { flex-direction: column; align-items: stretch; }
  .admin-list-toolbar__group { justify-content: space-between; }
}
</style>