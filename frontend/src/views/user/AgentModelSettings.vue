<template>
  <CapabilityShell title="模型偏好设置" description="按 Agent 单独覆盖模型、温度和 token 上限。移动端保留表格视图，支持横向滑动查看完整字段。">
    <div class="agent-model-settings">
      <section class="agent-model-settings__intro glass-card">
        <h2>我的模型偏好</h2>
        <el-alert type="info" :closable="false">
          您可以自定义特定 Agent 的模型参数，覆盖系统默认配置。
        </el-alert>
      </section>

      <section class="agent-model-settings__panel glass-card">
        <div class="agent-model-settings__header">
          <div>
            <h3>Agent 覆盖列表</h3>
            <p>表格在小屏下保持完整字段，左右滑动即可查看。</p>
          </div>
        </div>

        <div class="agent-model-settings__table mobile-table-scroll">
          <el-table :data="configs" v-loading="loading">
            <el-table-column label="Agent" width="240">
              <template #default="{ row }">
                <div class="agent-cell">
                  <strong>{{ row.displayName || row.agentId }}</strong>
                  <span>{{ row.agentId }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="model" label="我的模型" width="150">
              <template #default="{ row }">
                {{ row.model || '使用系统默认' }}
              </template>
            </el-table-column>
            <el-table-column prop="temperature" label="我的温度" width="100">
              <template #default="{ row }">
                {{ row.temperature ?? '系统默认' }}
              </template>
            </el-table-column>
            <el-table-column prop="enabled" label="启用覆盖" width="100">
              <template #default="{ row }">
                <el-switch v-model="row.enabled" @change="toggleOverride(row)" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180" fixed="right">
              <template #default="{ row }">
                <div class="table-actions">
                  <el-button size="small" @click="editOverride(row)">设置</el-button>
                  <el-button size="small" type="danger" @click="resetOverride(row)">重置</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>

      <el-dialog v-model="editDialogVisible" title="自定义配置" width="560px" :fullscreen="isMobileDialog">
        <el-form :model="editForm" label-position="top">
          <el-form-item label="Agent">
            <el-input v-model="editForm.agentId" disabled />
          </el-form-item>
          <el-form-item label="温度">
            <el-slider v-model="editForm.temperature" :min="0" :max="1" :step="0.1" show-input />
          </el-form-item>
          <el-form-item label="Max Tokens">
            <el-input-number v-model="editForm.maxTokens" :min="100" :max="8000" />
          </el-form-item>
          <el-form-item label="自定义模型">
            <el-input v-model="editForm.model" placeholder="留空使用系统配置" />
          </el-form-item>
        </el-form>
        <template #footer>
          <div class="dialog-actions">
            <el-button @click="editDialogVisible = false">取消</el-button>
            <el-button type="primary" @click="saveOverride">保存</el-button>
          </div>
        </template>
      </el-dialog>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
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
const editDialogVisible = ref(false);
const isMobileDialog = ref(false);
const editForm = ref<UserAgentConfig>({
  agentId: '',
  enabled: false
});

const buildConfigRows = (agents: AgentDefinition[], overrides: UserAgentConfig[]) => {
  const overrideMap = new Map(overrides.map((item) => [item.agentId, item]));
  const rows = agents.map((agent) => {
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

const syncViewport = () => {
  isMobileDialog.value = window.innerWidth <= 768;
};

const fetchConfigs = async () => {
  loading.value = true;
  try {
    const [configRes, agentsRes] = await Promise.all([
      api.get('/user/agent-model-configs'),
      api.get('/agents/list')
    ]);

    const overrides = Array.isArray(configRes.data) ? configRes.data : [];
    const agents = Array.isArray(agentsRes.data) ? agentsRes.data : [];

    configs.value = buildConfigRows(agents, overrides);
  } catch (error) {
    toast.error('获取配置失败');
  }
  loading.value = false;
};

const toggleOverride = async (row: UserAgentConfig) => {
  const previousEnabled = !row.enabled;
  try {
    await api.put(`/user/agent-model-configs/${encodeURIComponent(row.agentId)}`, {
      ...toConfigPayload(row)
    });
    toast.success(row.enabled ? '已启用覆盖' : '已禁用覆盖');
    await fetchConfigs();
  } catch (error) {
    row.enabled = previousEnabled;
    toast.error('操作失败');
    await fetchConfigs();
  }
};

const editOverride = (row: UserAgentConfig) => {
  editForm.value = { ...row };
  editDialogVisible.value = true;
};

const saveOverride = async () => {
  try {
    await api.put(`/user/agent-model-configs/${encodeURIComponent(editForm.value.agentId)}`, toConfigPayload(editForm.value));
    toast.success('配置已保存');
    editDialogVisible.value = false;
    await fetchConfigs();
  } catch (error) {
    toast.error('保存失败');
  }
};

const resetOverride = async (row: UserAgentConfig) => {
  try {
    if (row.hasOverride) {
      await api.delete(`/user/agent-model-configs/${encodeURIComponent(row.agentId)}`);
    }
    toast.success('已重置为系统默认');
    await fetchConfigs();
  } catch (error) {
    toast.error('重置失败');
  }
};

onMounted(() => {
  syncViewport();
  window.addEventListener('resize', syncViewport);
  fetchConfigs();
});

onUnmounted(() => {
  window.removeEventListener('resize', syncViewport);
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
  border-radius: 24px;
}

.agent-model-settings__intro {
  display: grid;
  gap: 16px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.84), rgba(246, 250, 255, 0.74));
  border: 1px solid rgba(52, 120, 246, 0.1);
  box-shadow: 0 20px 38px rgba(31, 87, 204, 0.08);
}

.agent-model-settings__panel {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.8), rgba(248, 250, 255, 0.72));
  border: 1px solid rgba(52, 120, 246, 0.08);
  box-shadow: 0 18px 32px rgba(31, 87, 204, 0.07);
}

[data-theme='dark'] .agent-model-settings__intro,
[data-theme='dark'] .agent-model-settings__panel {
  background: linear-gradient(180deg, rgba(26, 37, 47, 0.84), rgba(15, 24, 32, 0.76));
  border-color: rgba(96, 165, 250, 0.1);
  box-shadow: 0 20px 38px rgba(0, 0, 0, 0.22);
}

.agent-model-settings__intro h2,
.agent-model-settings__header h3 {
  margin: 0;
  color: var(--text-primary);
}

.agent-model-settings__header {
  margin-bottom: 16px;
}

.agent-model-settings__header p {
  margin: 8px 0 0;
  color: var(--text-secondary);
  line-height: 1.6;
}

.agent-model-settings__intro :deep(.el-alert) {
  border: 1px solid rgba(67, 176, 216, 0.16);
  background: rgba(255, 255, 255, 0.52);
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
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
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
