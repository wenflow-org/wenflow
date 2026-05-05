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
            <el-table-column prop="agentId" label="Agent" width="200" />
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
  model?: string;
  temperature?: number;
  maxTokens?: number;
  enabled: boolean;
}

const configs = ref<UserAgentConfig[]>([]);
const loading = ref(false);
const editDialogVisible = ref(false);
const isMobileDialog = ref(false);
const editForm = ref<UserAgentConfig>({
  agentId: '',
  enabled: false
});

const syncViewport = () => {
  isMobileDialog.value = window.innerWidth <= 768;
};

const fetchConfigs = async () => {
  loading.value = true;
  try {
    const res = await api.get('/user/agent-model-settings');
    configs.value = res.data?.data || [];
  } catch (error) {
    toast.error('获取配置失败');
  }
  loading.value = false;
};

const toggleOverride = async (row: UserAgentConfig) => {
  try {
    await api.put(`/user/agent-model-settings/${row.agentId}/toggle`, { enabled: row.enabled });
    toast.success(row.enabled ? '已启用覆盖' : '已禁用覆盖');
  } catch (error) {
    toast.error('操作失败');
    fetchConfigs();
  }
};

const editOverride = (row: UserAgentConfig) => {
  editForm.value = { ...row };
  editDialogVisible.value = true;
};

const saveOverride = async () => {
  try {
    await api.put(`/user/agent-model-settings/${editForm.value.agentId}`, editForm.value);
    toast.success('配置已保存');
    editDialogVisible.value = false;
    fetchConfigs();
  } catch (error) {
    toast.error('保存失败');
  }
};

const resetOverride = async (row: UserAgentConfig) => {
  try {
    await api.delete(`/user/agent-model-settings/${row.agentId}`);
    toast.success('已重置为系统默认');
    fetchConfigs();
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

.agent-model-settings__table {
  width: 100%;
}

.agent-model-settings__table :deep(.el-table) {
  min-width: 860px;
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
