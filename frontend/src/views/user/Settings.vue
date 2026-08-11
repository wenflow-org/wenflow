<template>
  <CapabilityShell title="API 接入">
    <div class="user-settings-page">
      <article class="uc-card">
        <div class="uc-card__head">
          <div>
            <h3>自定义 API</h3>
            <p>接入你自己的模型服务，覆盖平台默认配置</p>
          </div>
          <label class="uc-switch" :class="{ 'uc-switch--off': !apiConfig.enabled }">
            <input
              type="checkbox"
              v-model="apiConfig.enabled"
              :disabled="busy"
              @change="handleEnabledChange"
            />            <span class="uc-switch__track"></span>
            <span class="uc-switch__label">{{ apiConfig.enabled ? '启用' : '禁用' }}</span>
          </label>
        </div>

        <div v-if="loadError" class="uc-errorbar" role="alert">
          {{ loadError }}
          <button type="button" class="uc-errorbar__retry" @click="loadApiConfig">重新加载</button>
        </div>

        <div v-if="loading" class="uc-loading">
          <span class="uc-spinner"></span>
          加载配置…
        </div>

        <div v-else-if="!loadError" class="api-form">
          <label class="uc-field">
            <span class="uc-field__label">端点</span>
            <input v-model="apiConfig.endpoint" class="uc-field__input" placeholder="https://api.openai.com/v1" :disabled="busy" />
          </label>

          <label class="uc-field">
            <span class="uc-field__label">API Key</span>
            <div class="uc-field__pwd">
              <input
                v-model="apiConfig.apiKey"
                type="password"
                class="uc-field__input"
                :placeholder="hasSavedApiKey ? '已保存，留空继续使用' : 'sk-...'"
                :disabled="busy"
              />
              <button type="button" class="uc-field__eye" @click="showKey = !showKey" :aria-label="showKey ? '隐藏密钥' : '显示密钥'">
                {{ showKey ? '隐藏' : '显示' }}
              </button>
            </div>
            <span v-if="hasSavedApiKey" class="uc-field__hint">已保存密钥，留空则继续使用</span>
          </label>

          <div class="api-form__grid">
            <label class="uc-field">
              <span class="uc-field__label">对话模型</span>
              <input v-model="apiConfig.chatModel" class="uc-field__input" placeholder="deepseek-v4-flash" :disabled="busy" />
            </label>
            <label class="uc-field">
              <span class="uc-field__label">推理模型</span>
              <input v-model="apiConfig.reasoningModel" class="uc-field__input" placeholder="deepseek-v4-pro" :disabled="busy" />
            </label>
          </div>

          <div class="action-buttons">
            <button type="button" class="uc-btn" :disabled="busy" @click="testConnection">
              {{ testing ? '测试中…' : '测试连接' }}
            </button>
            <button type="button" class="uc-btn uc-btn--primary" :disabled="busy" @click="saveApiConfig">
              {{ saving ? '保存中…' : '保存配置' }}
            </button>
            <button v-if="apiConfig.enabled" type="button" class="uc-btn uc-btn--danger" :disabled="busy" @click="disableConfig">
              {{ disabling ? '禁用中…' : '禁用自定义 API' }}
            </button>
          </div>
        </div>
      </article>
    </div>

    <UcConfirm :state="confirmState" />
  </CapabilityShell>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import CapabilityShell from '@/components/user/CapabilityShell.vue';
import UcConfirm from '@/components/user/UcConfirm.vue';
import { useUcConfirm } from '@/components/user/useUcConfirm';
import { toast } from '../../utils/toast';
import { disableUserApiConfig, getUserApiConfig, testApiConnection, updateUserApiConfig } from '@/api/userCustom';
import '@/components/user/uc.css';

const saving = ref(false);
const testing = ref(false);
const loading = ref(false);
const loadError = ref('');
const disabling = ref(false);
const hasSavedApiKey = ref(false);
const showKey = ref(false);
const busy = computed(() => loading.value || saving.value || testing.value || disabling.value);
const { state: confirmState, openConfirm } = useUcConfirm();

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
  loadError.value = '';
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
    loadError.value = '无法读取已保存的配置，请检查网络或服务状态。';
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

const saveApiConfig = async (): Promise<boolean> => {
  if (!apiConfig.endpoint) {
    toast.warning('请先填写模型端点');
    return false;
  }

  if (!isValidEndpoint(apiConfig.endpoint)) {
    toast.warning('模型端点格式不正确，请输入以 http:// 或 https:// 开头的 URL');
    return false;
  }

  if (apiConfig.enabled && !apiConfig.apiKey && !hasSavedApiKey.value) {
    toast.warning('启用时必须填写 API Key');
    return false;
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
    return true;
  } catch (error: any) {
    toast.error(`保存失败：${error.message}`);
    return false;
  } finally {
    saving.value = false;
  }
};

const disableConfig = async () => {
  openConfirm(
    '禁用自定义 API',
    '禁用后将立即改用平台默认模型，已保存的端点和 API Key 会保留。确认继续吗？',
    async () => {
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
    },
    { confirmText: '确认禁用', danger: true }
  );
};

const handleEnabledChange = () => {
  const enabled = apiConfig.enabled
  if (!enabled) {
    void disableConfig();
    return;
  }

  if (!apiConfig.endpoint || !isValidEndpoint(apiConfig.endpoint) || (!hasSavedApiKey.value && !apiConfig.apiKey)) {
    apiConfig.enabled = false;
    toast.info('请先填写模型端点和 API Key，保存后再启用');
    return;
  }

  // 启用即保存，避免"界面显示已启用但服务端未生效"的不一致状态
  void saveApiConfig().then((saved) => {
    if (!saved) {
      apiConfig.enabled = false;
    }
  });
};
</script>

<style scoped>
.user-settings-page {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.api-form {
  display: grid;
  gap: 16px;
  max-width: 640px;
}

.api-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 640px) {
  .api-form__grid {
    grid-template-columns: 1fr;
  }
}

.action-buttons {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.uc-field__pwd {
  position: relative;
}

.uc-field__pwd .uc-field__input {
  padding-right: 56px;
}

.uc-field__eye {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  border: 0;
  background: transparent;
  color: var(--faint, #67758f);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 8px;
}

.uc-field__eye:hover {
  background: var(--canvas, #f3f6fb);
  color: var(--muted, #5b6577);
}

.uc-switch__label {
  font-size: 13px;
  font-weight: 700;
  color: var(--muted, #5b6577);
}

.uc-switch--off .uc-switch__label {
  color: var(--faint, #67758f);
}
</style>
