<template>
  <CapabilityShell title="API 接入">
    <div class="user-settings-page">
      <!-- 状态条 -->
      <div class="settings-status">
        <div class="settings-status__left">
          <span class="uc-badge" :class="apiConfig.enabled ? 'uc-badge--ok' : 'uc-badge--muted'">
            {{ apiConfig.enabled ? '已启用' : '未启用' }}
          </span>
          <div>
            <strong>{{ apiConfig.enabled ? '使用自定义模型服务' : '使用平台默认模型服务' }}</strong>
            <p>对话模型 {{ apiConfig.chatModel || 'deepseek-v4-flash' }} · 推理模型 {{ apiConfig.reasoningModel || 'deepseek-v4-pro' }}</p>
          </div>
        </div>
        <label class="uc-switch" :class="{ 'uc-switch--off': !apiConfig.enabled }">
          <input
            type="checkbox"
            v-model="apiConfig.enabled"
            :disabled="busy"
            @change="handleEnabledChange"
          />
          <span class="uc-switch__track"></span>
          <span class="uc-switch__label">{{ apiConfig.enabled ? '启用' : '禁用' }}</span>
        </label>
      </div>

      <div v-if="loadError" class="uc-errorbar" role="alert">
        {{ loadError }}
        <button type="button" class="uc-errorbar__retry" @click="loadApiConfig">重新加载</button>
      </div>

      <div v-if="loading" class="uc-card">
        <div class="uc-loading">
          <span class="uc-spinner"></span>
          加载配置…
        </div>
      </div>

      <div v-else-if="!loadError" class="settings-cols">
        <!-- 左：配置表单 -->
        <article class="uc-card">
          <div class="uc-card__head">
            <div>
              <h3>服务配置</h3>
              <p>填写兼容 OpenAI 协议的自定义模型端点</p>
            </div>
          </div>
          <div class="api-form">
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
                {{ disabling ? '禁用中…' : '禁用' }}
              </button>
            </div>
          </div>
        </article>

        <!-- 右：说明卡 -->
        <aside class="settings-side">
          <article class="uc-card">
            <div class="uc-card__head">
              <div>
                <h3>什么是自定义 API？</h3>
              </div>
            </div>
            <ul class="help-list">
              <li><strong>自带模型服务</strong><span>接入你自己购买的模型服务（DeepSeek / OpenAI / 兼容端点），学习对话将使用你的模型</span></li>
              <li><strong>平台默认</strong><span>不配置时使用平台内置模型，无需任何操作</span></li>
              <li><strong>密钥安全</strong><span>API Key 加密存储，仅用于平台调用你的模型服务</span></li>
            </ul>
            <div class="help-tip">
              需要帮助？将配置问题反馈给开发者，可附上调用日志。
            </div>
          </article>
        </aside>
      </div>
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

/* 状态条 */
.settings-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border: 1px solid var(--line, #e3e9f4);
  border-radius: 14px;
  background: var(--surface, #fff);
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04);
  flex-wrap: wrap;
}

.settings-status__left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.settings-status__left strong {
  display: block;
  font-size: 14px;
  color: var(--ink, #172033);
}

.settings-status__left p {
  margin: 3px 0 0;
  font-size: 12.5px;
  color: var(--faint, #67758f);
}

/* 两栏：表单 + 说明 */
.settings-cols {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

@media (max-width: 900px) {
  .settings-cols {
    grid-template-columns: 1fr;
  }
}

.settings-side {
  display: grid;
  gap: 16px;
}

.help-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 14px;
}

.help-list li {
  display: grid;
  gap: 3px;
}

.help-list strong {
  font-size: 13.5px;
  color: var(--ink, #172033);
}

.help-list span {
  font-size: 12.5px;
  color: var(--muted, #5b6577);
  line-height: 1.6;
}

.help-tip {
  margin-top: 16px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--canvas, #f3f6fb);
  border: 1px dashed var(--line, #e3e9f4);
  font-size: 12.5px;
  color: var(--muted, #5b6577);
  line-height: 1.6;
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
