<template>
  <div class="api-config-page">
    <div class="bg-layer"><div class="bg-orb bg-orb--1"></div><div class="bg-orb bg-orb--2"></div></div>
    <div class="page-hero">
      <span class="pill">平台配置</span>
      <h2 class="page-hero__title admin-page-title">
        <el-icon class="admin-page-title__icon"><Setting /></el-icon>
        API 管理
      </h2>
      <p class="page-hero__subtitle">输入地址和 Key，拉取端点模型并快速配置默认模型</p>
    </div>

    <div class="summary-grid">
      <div class="summary-item">
        <span class="summary-label">默认模型</span>
        <strong class="summary-value">{{ form.defaultModel || '未设置' }}</strong>
      </div>
      <div class="summary-item">
        <span class="summary-label">可用模型数</span>
        <strong class="summary-value">{{ form.availableModels.length }}</strong>
      </div>
      <div class="summary-item">
        <span class="summary-label">API Key</span>
        <strong class="summary-value">{{ form.apiKeyConfigured ? '已配置' : '未配置' }}</strong>
      </div>
      <div class="summary-item">
        <span class="summary-label">模型列表来源</span>
        <strong class="summary-value">{{ lastFetchAt ? '已拉取' : '未拉取' }}</strong>
      </div>
    </div>

    <div class="config-shell">
      <el-card class="config-card" shadow="never">
        <template #header>
          <div class="card-header">
            <span class="card-title">连接与模型配置</span>
            <div class="card-actions">
              <el-button @click="loadConfig" :loading="loading">刷新</el-button>
              <el-button type="primary" @click="saveConfig" :loading="saving">保存配置</el-button>
            </div>
          </div>
        </template>

        <el-form :model="form" label-width="160px" class="config-form">
          <div class="form-section-title">连接配置</div>
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

          <el-form-item>
            <div class="form-actions">
              <el-button type="primary" @click="fetchModels" :loading="testing">获取模型列表</el-button>
              <span v-if="testResult" class="test-result" :class="{ success: testResult.connected, error: !testResult.connected }">
                {{ testResult.message }}
              </span>
            </div>
          </el-form-item>

          <div class="form-section-title">模型选择</div>
          <el-form-item label="可用模型">
            <el-select
              v-model="form.availableModels"
              multiple
              filterable
              allow-create
              default-first-option
              placeholder="先获取模型列表，也可手动补充"
              style="width: 100%"
            >
              <el-option v-for="model in modelOptions" :key="model" :label="model" :value="model" />
            </el-select>
          </el-form-item>

          <el-form-item label="手动补充模型">
            <el-input
              v-model="manualModelInput"
              placeholder="输入模型名，多个用英文逗号分隔"
            >
              <template #append>
                <el-button @click="appendManualModels">添加</el-button>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item label="默认模型">
            <el-select
              v-model="form.defaultModel"
              filterable
              allow-create
              default-first-option
              placeholder="选择或输入默认模型"
              style="width: 100%"
            >
              <el-option v-for="model in modelOptions" :key="`default-${model}`" :label="model" :value="model" />
            </el-select>
          </el-form-item>

          <el-collapse class="advanced-collapse">
            <el-collapse-item title="高级配置" name="advanced">
              <el-form-item label="默认推理模型">
                <el-select
                  v-model="form.defaultReasoningModel"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="选择或输入默认推理模型"
                  style="width: 100%"
                >
                  <el-option v-for="model in modelOptions" :key="`reason-${model}`" :label="model" :value="model" />
                </el-select>
              </el-form-item>

              <el-form-item label="默认评估模型">
                <el-select
                  v-model="form.defaultEvaluationModel"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="选择或输入默认评估模型"
                  style="width: 100%"
                >
                  <el-option v-for="model in modelOptions" :key="`eval-${model}`" :label="model" :value="model" />
                </el-select>
              </el-form-item>
            </el-collapse-item>
          </el-collapse>
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
            <div class="status-label">最近拉取</div>
            <div class="status-value">{{ lastFetchAt || '尚未拉取模型列表' }}</div>
          </div>
        </div>

        <div class="status-grid">
          <div class="status-item">
            <div class="status-label">服务地址</div>
            <div class="status-value break-all">{{ form.apiUrl || '未配置' }}</div>
          </div>
          <div class="status-item">
            <div class="status-label">API Key</div>
            <div class="status-value">{{ form.apiKeyConfigured ? '已配置（已脱敏）' : '未配置' }}</div>
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
import { adminApiConfigApi } from '@/api/adminApi';
import { toast } from '../../utils/toast';

const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const manualModelInput = ref('');
const lastFetchAt = ref('');
const testResult = ref<{ connected: boolean; message: string } | null>(null);
const modelOptions = ref<string[]>([]);

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
    modelOptions.value = Array.from(new Set(form.availableModels.filter(Boolean)));
  } catch (error: any) {
    toast.error(error.message || '加载 API 配置失败');
  } finally {
    loading.value = false;
  }
}

async function saveConfig() {
  saving.value = true;
  try {
    await adminApiConfigApi.updateConfig({
      apiUrl: form.apiUrl,
      apiKey: form.apiKeyInput,
      availableModels: form.availableModels,
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

const mergeModelOptions = (models: string[]) => {
  const merged = Array.from(new Set([...(form.availableModels || []), ...models].filter(Boolean)));
  form.availableModels = merged;
  modelOptions.value = Array.from(new Set([...(modelOptions.value || []), ...merged]));
};

async function fetchModels() {
  testing.value = true;
  testResult.value = null;
  try {
    const response: any = await adminApiConfigApi.testConnection({
      apiUrl: form.apiUrl,
      apiKey: form.apiKeyInput
    });

    const models = response.data?.data?.models || response.data?.data?.availableModels || [];
    if (Array.isArray(models) && models.length > 0) {
      mergeModelOptions(models.map((m: any) => String(m)));
    }

    lastFetchAt.value = new Date().toLocaleString();
    testResult.value = {
      connected: true,
      message: Array.isArray(models) && models.length > 0
        ? `已获取 ${models.length} 个模型`
        : `连接成功，发现 ${response.data?.data?.modelsCount ?? 0} 个模型（接口未返回具体列表）`
    };
    toast.success('模型列表获取成功');
  } catch (error: any) {
    testResult.value = {
      connected: false,
      message: error.response?.data?.error || error.message || '连接测试失败'
    };
    toast.error('模型列表获取失败');
  } finally {
    testing.value = false;
  }
}

function appendManualModels() {
  const value = manualModelInput.value.trim();
  if (!value) return;
  const models = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (models.length === 0) return;
  mergeModelOptions(models);
  manualModelInput.value = '';
}

onMounted(() => {
  loadConfig();
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

.summary-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.summary-item {
  border-radius: 14px;
  border: 1px solid rgba(52, 120, 246, 0.1);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.86), rgba(244, 247, 252, 0.88));
  padding: 12px 14px;
  display: grid;
  gap: 6px;
}

.summary-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.summary-value {
  font-size: 18px;
  color: var(--text-primary);
  line-height: 1.2;
}

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

.form-section-title {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid rgba(52, 120, 246, 0.12);
  background: rgba(52, 120, 246, 0.05);
  color: #335aa4;
  font-size: 13px;
  font-weight: 700;
}

.advanced-collapse {
  margin: 6px 0 2px;
}

.advanced-collapse :deep(.el-collapse-item__header) {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
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

@media (max-width: 1024px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

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
