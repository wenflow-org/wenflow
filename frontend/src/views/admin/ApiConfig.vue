<template>
  <div class="api-config-page">
    <div class="page-header">
      <h2 class="page-title">
        <el-icon><Setting /></el-icon>
        API 管理
      </h2>
      <p class="page-subtitle">配置平台 AI 服务地址、模型与默认推理参数</p>
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
              <el-button type="success" @click="testConnection" :loading="testing">测试连接</el-button>
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
import { ElMessage } from 'element-plus';
import { Setting } from '@element-plus/icons-vue';
import { adminApiConfigApi, adminPlatformSettingsApi } from '@/api/adminApi';

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
    ElMessage.error(error.message || '加载 API 配置失败');
  } finally {
    loading.value = false;
  }
}

async function loadRegistrationSetting() {
  try {
    const response: any = await adminPlatformSettingsApi.getRegistrationSetting();
    registrationEnabled.value = !!response.data?.data?.registrationEnabled;
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.error?.message || '加载平台注册设置失败');
  }
}

async function saveRegistrationSetting() {
  registrationSaving.value = true;
  try {
    await adminPlatformSettingsApi.updateRegistrationSetting(registrationEnabled.value);
    ElMessage.success(`平台注册已${registrationEnabled.value ? '开启' : '关闭'}`);
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.error?.message || '保存平台注册设置失败');
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
    ElMessage.success('API 配置已保存');
    await loadConfig();
  } catch (error: any) {
    ElMessage.error(error.message || '保存 API 配置失败');
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
    ElMessage.success('连接测试成功');
  } catch (error: any) {
    testResult.value = {
      connected: false,
      message: error.response?.data?.error || error.message || '连接测试失败'
    };
    ElMessage.error('连接测试失败');
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
}

.page-header {
  margin-bottom: 1.5rem;
}

.page-title {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.5rem 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.page-subtitle {
  color: var(--text-secondary);
  margin: 0;
}

.config-shell {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 1rem;
}

.config-card {
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.35);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: var(--radius-xl);
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
  max-width: 860px;
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
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.35);
}

.registration-actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.status-item {
  padding: 1rem;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.35);
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

[data-theme="dark"] .config-card,
[data-theme="dark"] .status-item,
[data-theme="dark"] .registration-control {
  background: rgba(30, 45, 58, 0.74);
  border-color: rgba(255, 255, 255, 0.1);
}

@media (max-width: 1024px) {
  .config-shell {
    grid-template-columns: 1fr;
  }
}
</style>
