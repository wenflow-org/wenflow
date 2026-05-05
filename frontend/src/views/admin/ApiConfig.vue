<template>
  <div class="api-config-page">
    <div class="bg-layer"><div class="bg-orb bg-orb--1"></div><div class="bg-orb bg-orb--2"></div></div>
    <div class="page-hero">
      <span class="pill">平台配置</span>
      <h2 class="page-hero__title">
        <el-icon><Setting /></el-icon>
        API 管理
      </h2>
      <p class="page-hero__subtitle">配置和管理外部 API 密钥与服务</p>
    </div>

    <div class="config-shell">
      <el-card class="config-card" shadow="never">
        <template #header>
          <div class="card-header">
            <span class="card-title">平台 API 配置</span>
            <div class="card-actions">
              <el-button @click="loadConfig" :loading="loading">刷新</el-button>
              <el-button type="primary" @click="saveConfig" :loading="saving">保存配置</el-button>
            </div>
          </div>
        </template>

        <el-form :model="form" label-width="160px" class="config-form">
          <el-form-item label="服务地址">
            <el-input v-model="form.apiUrl" placeholder="http://localhost:3000" />
          </el-form-item>

          <el-form-item label="API Key">
            <el-input
              v-model="form.apiKeyInput"
              type="password"
              show-password
              :placeholder="form.apiKeyConfigured ? '已配置，留空则不修改' : '输入 API Key'"
            />
            <div class="hint-text">不会回显明文 Key；留空表示沿用当前 Key。</div>
          </el-form-item>

          <el-form-item label="可用模型">
            <el-input
              v-model="modelsInput"
              placeholder="多个模型用英文逗号分隔，如 deepseek-chat,deepseek-think"
            />
          </el-form-item>

          <el-form-item label="默认模型">
            <el-input v-model="form.defaultModel" placeholder="deepseek-chat" />
          </el-form-item>

          <el-form-item label="默认推理模型">
            <el-input v-model="form.defaultReasoningModel" placeholder="deepseek-think" />
          </el-form-item>

          <el-form-item label="默认评估模型">
            <el-input v-model="form.defaultEvaluationModel" placeholder="deepseek-think" />
          </el-form-item>

          <el-form-item>
            <div class="form-actions">
              <el-button type="primary" @click="testConnection" :loading="testing">测试连接</el-button>
              <span v-if="testResult" class="test-result" :class="{ success: testResult.connected, error: !testResult.connected }">
                {{ testResult.message }}
              </span>
            </div>
          </el-form-item>
        </el-form>
      </el-card>

      <el-card class="config-card" shadow="never">
        <template #header>
          <div class="card-header">
            <span class="card-title">当前状态</span>
          </div>
        </template>

        <div class="registration-control">
          <div>
            <div class="status-label">平台注册开关</div>
            <div class="status-value">{{ registrationEnabled ? '允许注册' : '关闭注册' }}</div>
          </div>
          <div class="registration-actions">
            <el-switch v-model="registrationEnabled" />
            <el-button size="small" type="primary" :loading="registrationSaving" @click="saveRegistrationSetting">
              保存
            </el-button>
          </div>
        </div>

        <div class="status-grid">
          <div class="status-item">
            <div class="status-label">服务地址</div>
            <div class="status-value break-all">{{ form.apiUrl || '未配置' }}</div>
          </div>
          <div class="status-item">
            <div class="status-label">API Key</div>
            <div class="status-value">{{ form.apiKey || '未配置' }}</div>
          </div>
          <div class="status-item">
            <div class="status-label">模型数量</div>
            <div class="status-value">{{ form.availableModels.length }}</div>
          </div>
          <div class="status-item">
            <div class="status-label">默认模型</div>
            <div class="status-value">{{ form.defaultModel || '未设置' }}</div>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { Setting } from '@element-plus/icons-vue';
import { adminApiConfigApi, adminPlatformSettingsApi } from '@/api/adminApi';
import { toast } from '../../utils/toast';

const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const registrationSaving = ref(false);
const registrationEnabled = ref(true);
const modelsInput = ref('');
const testResult = ref<{ connected: boolean; message: string } | null>(null);

const form = reactive({
  apiUrl: '',
  apiKey: '',
  apiKeyInput: '',
  apiKeyConfigured: false,
  availableModels: [] as string[],
  defaultModel: '',
  defaultReasoningModel: '',
  defaultEvaluationModel: ''
});

async function loadConfig() {
  loading.value = true;
  try {
    const response: any = await adminApiConfigApi.getConfig();
    const data = response.data.data;
    form.apiUrl = data.apiUrl || '';
    form.apiKey = data.apiKey || '';
    form.apiKeyConfigured = !!data.apiKeyConfigured;
    form.apiKeyInput = '';
    form.availableModels = data.availableModels || [];
    form.defaultModel = data.defaultModel || '';
    form.defaultReasoningModel = data.defaultReasoningModel || '';
    form.defaultEvaluationModel = data.defaultEvaluationModel || '';
    modelsInput.value = form.availableModels.join(', ');
  } catch (error: any) {
    toast.error(error.message || '加载 API 配置失败');
  } finally {
    loading.value = false;
  }
}

async function loadRegistrationSetting() {
  try {
    const response: any = await adminPlatformSettingsApi.getRegistrationSetting();
    registrationEnabled.value = !!response.data?.data?.registrationEnabled;
  } catch (error: any) {
    toast.error(error?.response?.data?.error?.message || '加载平台注册设置失败');
  }
}

async function saveRegistrationSetting() {
  registrationSaving.value = true;
  try {
    await adminPlatformSettingsApi.updateRegistrationSetting(registrationEnabled.value);
    toast.success(`平台注册已${registrationEnabled.value ? '开启' : '关闭'}`);
  } catch (error: any) {
    toast.error(error?.response?.data?.error?.message || '保存平台注册设置失败');
  } finally {
    registrationSaving.value = false;
  }
}

async function saveConfig() {
  saving.value = true;
  try {
    await adminApiConfigApi.updateConfig({
      apiUrl: form.apiUrl,
      apiKey: form.apiKeyInput,
      availableModels: modelsInput.value,
      defaultModel: form.defaultModel,
      defaultReasoningModel: form.defaultReasoningModel,
      defaultEvaluationModel: form.defaultEvaluationModel
    });
    toast.success('API 配置已保存');
    await loadConfig();
  } catch (error: any) {
    toast.error(error.message || '保存 API 配置失败');
  } finally {
    saving.value = false;
  }
}

async function testConnection() {
  testing.value = true;
  testResult.value = null;
  try {
    const response: any = await adminApiConfigApi.testConnection({
      apiUrl: form.apiUrl,
      apiKey: form.apiKeyInput
    });
    testResult.value = {
      connected: true,
      message: `连接成功，发现 ${response.data.data.modelsCount} 个模型`
    };
    toast.success('连接测试成功');
  } catch (error: any) {
    testResult.value = {
      connected: false,
      message: error.response?.data?.error || error.message || '连接测试失败'
    };
    toast.error('连接测试失败');
  } finally {
    testing.value = false;
  }
}

onMounted(() => {
  loadConfig();
  loadRegistrationSetting();
});
</script>

<style scoped>
.api-config-page {
  padding: 0;
  position: relative;
  overflow: hidden;
}

/* Background orbs */
.bg-layer { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.bg-orb { position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0.15; }
.bg-orb--1 { width: 460px; height: 460px; top: -180px; right: -120px; background: radial-gradient(circle, rgba(52, 120, 246, 0.3), transparent 70%); animation: orb-d 26s ease-in-out infinite; }
.bg-orb--2 { width: 380px; height: 380px; left: -100px; bottom: 120px; background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%); animation: orb-d 30s ease-in-out infinite reverse; }
@keyframes orb-d { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -20px) scale(1.05); } 66% { transform: translate(-20px, 30px) scale(0.95); } }

/* Hero */
.page-hero { position: relative; z-index: 1; padding: 24px 28px; border-radius: 20px; border: 1px solid rgba(52, 120, 246, 0.08); background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 34%), linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92)); backdrop-filter: blur(16px); margin-bottom: 1.5rem; }
.page-hero__title { margin: 8px 0 0; font-size: 1.5rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.03em; display: flex; align-items: center; gap: 0.5rem; }
.page-hero__subtitle { margin: 4px 0 0; color: var(--text-secondary); font-size: 0.9375rem; }
.pill { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 10%, white); color: var(--color-primary-dark, #1f57cc); font-size: 12px; font-weight: 700; }

.config-shell {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 1rem;
}

.config-card {
  background: var(--glass-bg-light);
  border: 1px solid var(--glass-border-light);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-radius: var(--fluent-radius-lg);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.card-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.card-actions,
.form-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.config-form {
  max-width: 100%;
}

.status-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.registration-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.9rem;
  padding: 0.9rem;
  border-radius: var(--fluent-radius-md);
  background: color-mix(in srgb, var(--glass-bg-light) 90%, transparent);
  border: 1px solid var(--glass-border-light);
}

.registration-actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.status-item {
  padding: 1rem;
  border-radius: var(--fluent-radius-md);
  background: color-mix(in srgb, var(--glass-bg-light) 90%, transparent);
  border: 1px solid var(--glass-border-light);
}

.status-label {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-bottom: 0.35rem;
}

.status-value {
  color: var(--text-primary);
  font-weight: 600;
}

.break-all {
  word-break: break-all;
}

.test-result {
  font-size: 0.875rem;
}

.test-result.success {
  color: var(--color-success);
}

.test-result.error {
  color: var(--color-danger);
}

.hint-text {
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

[data-theme="dark"] .page-hero { background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.1), transparent 34%), linear-gradient(180deg, rgba(30, 33, 42, 0.92), rgba(24, 27, 35, 0.92)); border-color: rgba(52, 120, 246, 0.12); }
[data-theme="dark"] .pill { background: color-mix(in srgb, var(--color-primary) 18%, transparent); }

[data-theme="dark"] .config-card,
[data-theme="dark"] .status-item,
[data-theme="dark"] .registration-control {
  background: var(--glass-bg-dark);
  border-color: var(--glass-border-dark);
}

@media (max-width: 1024px) {
  .config-shell {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .status-grid {
    grid-template-columns: 1fr;
  }
}
</style>
