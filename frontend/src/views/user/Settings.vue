<template>
  <CapabilityShell
    title="API 接入"
    description="配置自己的模型服务后，问流会使用它进行后续调用。"
  >
    <div class="user-settings-page">
      <el-card class="settings-card" shadow="never">
        <template #header>
          <div class="card-header">
            <h3>AI 模型配置</h3>
            <p>保存后，后续 AI 调用会优先使用这组配置。</p>
          </div>
        </template>

        <el-form v-loading="loading" label-width="140px" class="api-form">
          <el-form-item label="启用自定义 API">
            <el-switch
              v-model="apiConfig.enabled"
              active-text="启用"
              inactive-text="禁用"
              :disabled="busy"
              @change="handleEnabledChange"
            />
            <div class="field-hint">
              启用后将使用你配置的 API，禁用则使用平台默认
            </div>
          </el-form-item>

          <el-form-item label="模型端点">
            <el-input
              v-model="apiConfig.endpoint"
              placeholder="https://api.openai.com/v1"
              :disabled="!apiConfig.enabled || busy"
            />
            <div class="field-hint">
              例如：https://api.openai.com/v1 或 https://api.deepseek.com
            </div>
          </el-form-item>

          <el-form-item label="API Key">
            <el-input
              v-model="apiConfig.apiKey"
              type="password"
              :placeholder="hasSavedApiKey ? '已保存密钥，留空表示继续使用' : 'sk-...'"
              show-password
              :disabled="!apiConfig.enabled || busy"
            />
            <div class="field-hint">
              {{ hasSavedApiKey ? '密钥已安全保存。仅在需要替换时输入新值。' : '你的 API 密钥，仅用于身份验证。' }}
            </div>
          </el-form-item>

          <el-form-item label="对话模型">
            <el-input
              v-model="apiConfig.chatModel"
              placeholder="deepseek-v4-flash"
              :disabled="!apiConfig.enabled || busy"
            />
            <div class="field-hint">
              用于常规对话和任务生成的模型
            </div>
          </el-form-item>

          <el-form-item label="推理模型">
            <el-input
              v-model="apiConfig.reasoningModel"
              placeholder="deepseek-v4-pro"
              :disabled="!apiConfig.enabled || busy"
            />
            <div class="field-hint">
              用于复杂推理任务的模型（可选，默认同对话模型）
            </div>
          </el-form-item>

          <el-form-item>
            <div class="action-buttons">
              <el-button
                type="default"
                :loading="testing"
                @click="testConnection"
                :disabled="!apiConfig.enabled || busy"
              >
                测试连接
              </el-button>
              <el-button
                type="primary"
                :loading="saving"
                @click="saveApiConfig"
                :disabled="!apiConfig.enabled || busy"
              >
                保存配置
              </el-button>
              <el-button
                v-if="apiConfig.enabled"
                type="danger"
                plain
                :loading="disabling"
                :disabled="busy"
                @click="disableConfig"
              >
                禁用自定义 API
              </el-button>
            </div>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import CapabilityShell from '@/components/user/CapabilityShell.vue';
import { toast } from '../../utils/toast';
import { disableUserApiConfig, getUserApiConfig, testApiConnection, updateUserApiConfig } from '@/api/userCustom';

const saving = ref(false);
const testing = ref(false);
const loading = ref(false);
const disabling = ref(false);
const hasSavedApiKey = ref(false);
const busy = computed(() => loading.value || saving.value || testing.value || disabling.value);

// 单配置模式
const apiConfig = reactive({
  enabled: false,
  endpoint: '',
  apiKey: '',
  chatModel: 'deepseek-v4-flash',
  reasoningModel: 'deepseek-v4-pro',
});

onMounted(async () => {
  await loadApiConfig();
});

const loadApiConfig = async () => {
  loading.value = true;
  try {
    const res = await getUserApiConfig();
    const data = res.data;
    apiConfig.enabled = data.enabled || false;
    apiConfig.endpoint = data.endpoint || '';
    apiConfig.apiKey = '';
    hasSavedApiKey.value = !!data.hasApiKey;
    apiConfig.chatModel = data.chatModel || 'deepseek-v4-flash';
    apiConfig.reasoningModel = data.reasoningModel || 'deepseek-v4-pro';
  } catch {
    toast.error('加载 API 配置失败');
  } finally {
    loading.value = false;
  }
};

const isValidEndpoint = (endpoint: string) => {
  if (!endpoint) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const testConnection = async () => {
  if (!apiConfig.endpoint) {
    toast.warning('请先填写模型端点');
    return;
  }

  if (!isValidEndpoint(apiConfig.endpoint)) {
    toast.warning('模型端点格式不正确，请输入以 http:// 或 https:// 开头的 URL');
    return;
  }

  if (!apiConfig.apiKey && !hasSavedApiKey.value) {
    toast.warning('请先填写 API Key');
    return;
  }

  testing.value = true;
  try {
    await testApiConnection({
      endpoint: apiConfig.endpoint,
      apiKey: apiConfig.apiKey || undefined,
      model: apiConfig.chatModel,
    });
    toast.success('连接测试成功');
  } catch (error: any) {
    toast.error(`连接失败：${error.message}`);
  } finally {
    testing.value = false;
  }
};

const saveApiConfig = async () => {
  if (!apiConfig.endpoint) {
    toast.warning('请先填写模型端点');
    return;
  }

  if (!isValidEndpoint(apiConfig.endpoint)) {
    toast.warning('模型端点格式不正确，请输入以 http:// 或 https:// 开头的 URL');
    return;
  }

  if (apiConfig.enabled && !apiConfig.apiKey && !hasSavedApiKey.value) {
    toast.warning('启用时必须填写 API Key');
    return;
  }

  saving.value = true;
  try {
    await updateUserApiConfig({
      enabled: apiConfig.enabled,
      endpoint: apiConfig.endpoint,
      apiKey: apiConfig.apiKey || undefined,
      chatModel: apiConfig.chatModel,
      reasoningModel: apiConfig.reasoningModel,
    });

    toast.success('配置已保存');
    if (apiConfig.apiKey) {
      hasSavedApiKey.value = true;
      apiConfig.apiKey = '';
    }
  } catch (error: any) {
    toast.error(`保存失败：${error.message}`);
  } finally {
    saving.value = false;
  }
};

const disableConfig = async () => {
  try {
    await ElMessageBox.confirm(
      '禁用后将立即改用平台默认模型，已保存的端点和 API Key 会保留。确认继续吗？',
      '禁用自定义 API',
      {
        type: 'warning',
        confirmButtonText: '确认禁用',
        cancelButtonText: '取消'
      }
    );
  } catch {
    apiConfig.enabled = true;
    return;
  }

  disabling.value = true;
  try {
    await disableUserApiConfig();
    apiConfig.enabled = false;
    toast.success('已禁用自定义 API，将使用平台默认配置');
  } catch (error: any) {
    apiConfig.enabled = true;
    toast.error(`操作失败：${error.message}`);
  } finally {
    disabling.value = false;
  }
};

const handleEnabledChange = async (enabled: boolean) => {
  if (!enabled) {
    await disableConfig();
    return;
  }

  if (!apiConfig.endpoint || !isValidEndpoint(apiConfig.endpoint) || (!hasSavedApiKey.value && !apiConfig.apiKey)) {
    apiConfig.enabled = false;
    toast.info('请补全配置并保存后启用');
  }
};
</script>

<style scoped lang="scss">
.user-settings-page {
  display: grid;
  gap: 14px;
}

.page-alert {
  border-radius: 12px;
}

.settings-card {
  border-radius: 18px;
  border: 1px solid rgba(52, 120, 246, 0.1);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.88) 0%, rgba(248, 252, 255, 0.76) 100%);
  box-shadow: 0 20px 38px rgba(31, 87, 204, 0.08);
}

[data-theme='dark'] .settings-card {
  background: linear-gradient(180deg, rgba(26, 37, 47, 0.84), rgba(15, 24, 32, 0.76));
  border-color: rgba(96, 165, 250, 0.1);
  box-shadow: 0 20px 38px rgba(0, 0, 0, 0.22);
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;

  h3 {
    margin: 0;
    font-size: 18px;
    color: #184a69;
  }

  p {
    margin: 6px 0 0;
    font-size: 13px;
    color: #567082;
  }
}

.api-form {
  max-width: 600px;
}

.api-form :deep(.el-form-item) {
  margin-bottom: 24px;
}

.api-form :deep(.el-input__wrapper),
.api-form :deep(.el-textarea__inner) {
  box-shadow: 0 0 0 1px rgba(52, 120, 246, 0.1) inset;
}

.action-buttons {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.action-buttons :deep(.el-button--primary) {
  border: none;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
}

.field-hint {
  margin-top: 6px;
  font-size: 12px;
  color: #6e8798;
  line-height: 1.5;
}

.card-header {
  h3 {
    margin: 0 0 6px;
    font-size: 18px;
    font-weight: 700;
    color: #1a2b3c;
  }

  p {
    margin: 0;
    font-size: 13px;
    color: #5f7b8e;
  }
}

@media (max-width: 768px) {
  .card-header {
    flex-direction: column;
  }

  .action-buttons {
    flex-direction: column;
    
    .el-button {
      width: 100%;
    }
  }
}
</style>
