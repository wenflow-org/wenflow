<template>
  <CapabilityShell title="高级模型">
    <div class="agent-model-settings">
      <article class="uc-card">
        <div class="uc-card__head">
          <div>
            <h3>能力模型覆盖</h3>
            <p>为各项能力单独指定模型与参数；留空则使用系统默认</p>
          </div>
        </div>

        <div v-if="loadError && !loading && configs.length === 0" class="uc-errorbar" role="alert">
          {{ loadError }}
          <button type="button" class="uc-errorbar__retry" @click="fetchConfigs">重新加载</button>
        </div>

        <div v-if="loading && !configs.length" class="uc-loading">
          <span class="uc-spinner"></span>
          加载模型配置…
        </div>

        <div v-else-if="!loading && configs.length === 0" class="uc-empty">
          <strong>暂无能力配置</strong>
          <span>平台能力会显示在这里</span>
        </div>

        <div v-else class="uc-table-wrap ams-scroll">
          <table class="uc-table ams-table">
            <thead>
              <tr>
                <th>能力</th>
                <th>模型</th>
                <th>温度</th>
                <th>自定义</th>
                <th class="uc-table__right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in configs" :key="row.agentId">
                <td>
                  <strong>{{ row.displayName || row.agentId }}</strong>
                  <span class="uc-table__sub">{{ row.agentId }}</span>
                </td>
                <td class="uc-table__muted">{{ row.model || '系统默认' }}</td>
                <td class="uc-table__muted">{{ row.temperature ?? '默认' }}</td>
                <td>
                  <label class="uc-switch">
                    <input
                      type="checkbox"
                      v-model="row.enabled"
                      :disabled="isBusy"
                      @change="toggleOverride(row)"
                    />
                    <span class="uc-switch__track"></span>
                  </label>
                </td>
                <td class="uc-table__right">
                  <button type="button" class="uc-btn uc-btn--link" :disabled="isBusy" @click="editOverride(row)">编辑</button>
                  <button type="button" class="uc-btn uc-btn--link uc-btn--link-danger" :disabled="isBusy" @click="resetOverride(row)">重置</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <!-- 编辑弹窗 -->
      <div v-if="editDialogVisible" class="uc-dialog-mask" @click.self="editDialogVisible = false">
        <div class="uc-dialog" role="dialog" aria-modal="true" aria-label="自定义配置">
          <div class="uc-dialog__head">
            <h3>自定义配置</h3>
            <button type="button" class="uc-dialog__close" aria-label="关闭" @click="editDialogVisible = false">✕</button>
          </div>
          <div class="uc-dialog__body">
            <label class="uc-field">
              <span class="uc-field__label">AI 能力</span>
              <input :value="editForm.agentId" class="uc-field__input" disabled />
            </label>
            <label class="uc-field">
              <span class="uc-field__label">生成随机性（Temperature：0-2）</span>
              <input v-model.number="editForm.temperature" type="number" min="0" max="2" step="0.1" class="uc-field__input" />
            </label>
            <label class="uc-field">
              <span class="uc-field__label">最大输出长度（Token）</span>
              <input v-model.number="editForm.maxTokens" type="number" min="100" max="8000" class="uc-field__input" />
            </label>
            <label class="uc-field">
              <span class="uc-field__label">模型名称</span>
              <input v-model="editForm.model" class="uc-field__input" placeholder="留空使用系统配置" />
            </label>
          </div>
          <div class="uc-dialog__foot">
            <button type="button" class="uc-btn" :disabled="isBusy" @click="editDialogVisible = false">取消</button>
            <button type="button" class="uc-btn uc-btn--primary" :disabled="isBusy" @click="saveOverride">
              {{ busyAction === 'save' ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <UcConfirm :state="confirmState" />
  </CapabilityShell>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import api from '@/utils/api';
import { toast } from '../../utils/toast';
import CapabilityShell from '@/components/user/CapabilityShell.vue';
import UcConfirm from '@/components/user/UcConfirm.vue';
import { useUcConfirm } from '@/components/user/useUcConfirm';
import '@/components/user/uc.css';

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
const { state: confirmState, openConfirm } = useUcConfirm();

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
  openConfirm(
    '恢复系统默认',
    `确认清除“${row.displayName || row.agentId}”的自定义模型参数并恢复系统默认吗？`,
    async () => {
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
    },
    { confirmText: '确认恢复', danger: true }
  );
};

onMounted(() => {
  fetchConfigs();
});
</script>

<style scoped>
.agent-model-settings {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.ams-scroll {
  overflow-x: auto;
}

.ams-table {
  min-width: 860px;
}

.uc-btn--link-danger {
  color: #c0454a;
}

.uc-btn--link-danger:hover:not(:disabled) {
  background: rgba(239, 117, 120, 0.08);
  color: #c0454a;
}
</style>
