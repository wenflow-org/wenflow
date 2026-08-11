<template>
  <CapabilityShell title="高级模型">
    <div class="agent-model-settings">
      <section class="agent-model-settings__panel glass-card">
        <div class="agent-model-settings__table mobile-table-scroll">
          <el-result
            v-if="loadError && !loading && configs.length === 0"
            icon="error"
            title="模型配置加载失败"
            :sub-title="loadError"
          >
            <template #extra>
              <el-button type="primary" @click="fetchConfigs">重新加载</el-button>
            </template>
          </el-result>
          <el-table v-else :data="configs" v-loading="loading" table-layout="fixed" style="width: 100%">
            <el-table-column label="能力" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="agent-cell">
                  <strong>{{ row.displayName || row.agentId }}</strong>
                  <span>{{ row.agentId }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="model" label="模型" min-width="120" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.model || '系统默认' }}
              </template>
            </el-table-column>
            <el-table-column prop="temperature" label="温度" width="80">
              <template #default="{ row }">
                {{ row.temperature ?? '默认' }}
              </template>
            </el-table-column>
            <el-table-column prop="enabled" label="自定义" width="80">
              <template #default="{ row }">
                <el-switch v-model="row.enabled" :loading="busyAgentId === row.agentId" :disabled="isBusy" @change="toggleOverride(row)" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="140" fixed="right">
              <template #default="{ row }">
                <div class="table-actions">
                  <el-button link type="primary" :disabled="isBusy" @click="editOverride(row)">编辑</el-button>
                  <el-button link type="danger" :loading="busyAgentId === row.agentId && busyAction === 'reset'" :disabled="isBusy" @click="resetOverride(row)">重置</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>

      <el-dialog v-model="editDialogVisible" title="自定义配置" width="min(560px, calc(100vw - 32px))" :close-on-click-modal="!isBusy" :close-on-press-escape="!isBusy" :show-close="!isBusy">
        <el-form :model="editForm" label-position="top">
          <el-form-item label="AI 能力">
            <el-input v-model="editForm.agentId" disabled />
          </el-form-item>
          <el-form-item label="生成随机性（Temperature）">
            <el-slider v-model="editForm.temperature" :min="0" :max="2" :step="0.1" show-input />
          </el-form-item>
          <el-form-item label="最大输出长度（Token）">
            <el-input-number v-model="editForm.maxTokens" :min="100" :max="8000" />
          </el-form-item>
          <el-form-item label="模型名称">
            <el-input v-model="editForm.model" placeholder="留空使用系统配置" />
          </el-form-item>
        </el-form>
        <template #footer>
          <div class="dialog-actions">
            <el-button :disabled="isBusy" @click="editDialogVisible = false">取消</el-button>
            <el-button type="primary" :loading="busyAction === 'save'" :disabled="isBusy && busyAction !== 'save'" @click="saveOverride">保存</el-button>
          </div>
        </template>
      </el-dialog>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { ElMessageBox } from 'element-plus';
import api from '@/utils/api';
import { toast } from '../../utils/toast';
import CapabilityShell from '@/components/user/CapabilityShell.vue';

interface UserAgentConfig {
  agentId: string;
  displayName?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  enabled: boolean;
  hasOverride?: boolean;
}

interface AgentDefinition {
  id: string;
  name: string;
}

const configs = ref<UserAgentConfig[]>([]);
const loading = ref(false);
const loadError = ref('');
const editDialogVisible = ref(false);
const busyAgentId = ref('');
const busyAction = ref<'' | 'toggle' | 'save' | 'reset'>('');
const isBusy = computed(() => busyAction.value !== '');
const editForm = ref<UserAgentConfig>({
  agentId: '',
  enabled: false
});

const buildConfigRows = (agents: AgentDefinition[], overrides: UserAgentConfig[]) => {
  const overrideMap = new Map(overrides.map((item) => [item.agentId, item]));
  const rows: UserAgentConfig[] = agents.map((agent) => {
    const override = overrideMap.get(agent.id);
    return {
      agentId: agent.id,
      displayName: agent.name || agent.id,
      model: override?.model,
      temperature: override?.temperature,
      maxTokens: override?.maxTokens,
      enabled: override?.enabled ?? false,
      hasOverride: !!override
    };
  });

  overrides.forEach((override) => {
    if (!rows.some((row) => row.agentId === override.agentId)) {
      rows.push({
        ...override,
        displayName: override.agentId,
        hasOverride: true
      });
    }
  });

  return rows;
};

const toConfigPayload = (config: UserAgentConfig) => ({
  enabled: config.enabled,
  model: config.model,
  temperature: config.temperature,
  maxTokens: config.maxTokens
});

const fetchConfigs = async () => {
  loading.value = true;
  loadError.value = '';
  try {
    const [configRes, agentsRes] = await Promise.all([
      api.get('/user/agent-model-configs'),
      api.get('/agents/list')
    ]);

    const overrides = Array.isArray(configRes.data) ? configRes.data : [];
    const agents = Array.isArray(agentsRes.data) ? agentsRes.data : [];

    configs.value = buildConfigRows(agents, overrides);
  } catch (error) {
    loadError.value = '无法读取模型配置，请检查网络或服务状态后重试。';
    toast.error('获取配置失败');
  }
  loading.value = false;
};

const toggleOverride = async (row: UserAgentConfig) => {
  if (isBusy.value) return;
  const previousEnabled = !row.enabled;
  busyAgentId.value = row.agentId;
  busyAction.value = 'toggle';
  try {
    await api.put(`/user/agent-model-configs/${encodeURIComponent(row.agentId)}`, {
      ...toConfigPayload(row)
    });
    toast.success(row.enabled ? '已启用覆盖' : '已禁用覆盖');
  } catch (error) {
    row.enabled = previousEnabled;
    toast.error('操作失败');
  } finally {
    await fetchConfigs();
    busyAgentId.value = '';
    busyAction.value = '';
  }
};

const editOverride = (row: UserAgentConfig) => {
  editForm.value = { ...row };
  editDialogVisible.value = true;
};

const saveOverride = async () => {
  if (isBusy.value) return;
  busyAgentId.value = editForm.value.agentId;
  busyAction.value = 'save';
  try {
    await api.put(`/user/agent-model-configs/${encodeURIComponent(editForm.value.agentId)}`, toConfigPayload(editForm.value));
    toast.success('配置已保存');
    editDialogVisible.value = false;
    await fetchConfigs();
  } catch (error) {
    toast.error('保存失败');
  } finally {
    busyAgentId.value = '';
    busyAction.value = '';
  }
};

const resetOverride = async (row: UserAgentConfig) => {
  if (isBusy.value) return;
  try {
    await ElMessageBox.confirm(
      `确认清除“${row.displayName || row.agentId}”的自定义模型参数并恢复系统默认吗？`,
      '恢复系统默认',
      {
        type: 'warning',
        confirmButtonText: '确认恢复',
        cancelButtonText: '取消'
      }
    );
  } catch {
    return;
  }

  busyAgentId.value = row.agentId;
  busyAction.value = 'reset';
  try {
    if (row.hasOverride) {
      await api.delete(`/user/agent-model-configs/${encodeURIComponent(row.agentId)}`);
    }
    toast.success('已重置为系统默认');
    await fetchConfigs();
  } catch (error) {
    toast.error('重置失败');
  } finally {
    busyAgentId.value = '';
    busyAction.value = '';
  }
};

onMounted(() => {
  fetchConfigs();
});
</script>

<style scoped>
.agent-model-settings {
  display: grid;
  gap: 20px;
}

.agent-model-settings__intro,
.agent-model-settings__panel {
  padding: 22px;
  border-radius: 16px;
}

.agent-model-settings__intro {
  display: grid;
  gap: 16px;
  background: var(--surface, #fff);
  border: 1px solid var(--line, #e3e9f4);
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04), 0 10px 28px rgba(23, 32, 51, 0.05);
}

.agent-model-settings__panel {
  background: var(--surface, #fff);
  border: 1px solid var(--line, #e3e9f4);
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04), 0 10px 28px rgba(23, 32, 51, 0.05);
}

.agent-model-settings__intro h2,
.agent-model-settings__header h3 {
  margin: 0;
  color: var(--ink, #172033);
}

.agent-model-settings__header {
  margin-bottom: 16px;
}

.agent-model-settings__header p {
  margin: 8px 0 0;
  color: var(--muted, #5b6577);
  line-height: 1.6;
}

.agent-model-settings__intro :deep(.el-alert) {
  border: 1px solid rgba(67, 176, 216, 0.16);
  background: var(--surface, #fff);
}

.agent-model-settings__table {
  width: 100%;
}

.agent-model-settings__table :deep(.el-table) {
  min-width: 860px;
}

.agent-cell {
  display: grid;
  gap: 4px;
}

.agent-cell strong {
  color: var(--text-primary);
  font-size: 13px;
}

.agent-cell span {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.4;
  word-break: break-all;
}

.table-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 2px;
}

.table-actions :deep(.el-button) {
  margin-left: 0;
  padding: 0 4px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.dialog-actions :deep(.el-button--primary) {
  border: none;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
}

@media (max-width: 768px) {
  .agent-model-settings__intro,
  .agent-model-settings__panel {
    padding: 18px;
    border-radius: 20px;
  }

  .dialog-actions {
    flex-direction: column;
  }

  .dialog-actions :deep(.el-button) {
    width: 100%;
    margin-left: 0;
  }

  .agent-model-settings__table {
    margin-inline: -2px;
    padding-inline: 2px;
  }

  :deep(.el-dialog__body),
  :deep(.el-dialog__footer) {
    padding-left: 16px;
    padding-right: 16px;
  }

  :deep(.el-slider__input) {
    width: 100%;
  }
}

@media (max-width: 520px) {
  .agent-model-settings__intro,
  .agent-model-settings__panel {
    padding: 16px;
  }
}
</style>
