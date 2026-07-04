<template>
  <div class="admin-page api-config-page">
    <AdminPageHeader
      title="模型接入与路由"
      :icon="Setting"
      :highlights="apiConfigHighlights"
    >
      <template #actions>
        <el-button class="topbar-btn" @click="loadConfig" :loading="loading">刷新配置</el-button>
        <el-button type="primary" class="topbar-btn topbar-btn--primary" @click="saveConfig" :loading="saving">保存变更</el-button>
      </template>
    </AdminPageHeader>

    <section class="summary-strip">
      <div class="summary-strip__item">
        <span>连接</span>
        <strong>{{ connectionStateLabel }}</strong>
      </div>
      <div class="summary-strip__item">
        <span>密钥</span>
        <strong>{{ keyStateLabel }}</strong>
      </div>
      <div class="summary-strip__item">
        <span>模型目录</span>
        <strong>{{ form.availableModels.length }} 个模型</strong>
      </div>
      <div class="summary-strip__item">
        <span>默认路由</span>
        <strong>{{ routeFillCount }}/3 已设置</strong>
      </div>
    </section>

    <section class="flow-section">
      <div class="flow-section__head">
        <div>
          <h2>接入</h2>
        </div>
      </div>

      <el-form :model="form" label-position="top" class="config-form">
        <div class="field-grid field-grid--two">
          <el-form-item label="服务地址">
            <el-input v-model="form.apiUrl" placeholder="https://api.example.com/v1" />
          </el-form-item>

          <el-form-item label="API Key">
            <el-input
              v-model="form.apiKeyInput"
              type="password"
              show-password
              :placeholder="form.apiKeyConfigured ? '留空则沿用' : '输入 API Key'"
            />
          </el-form-item>
        </div>
      </el-form>

      <div v-if="testResult" class="issue-row" :class="testResult.connected ? 'issue-row--success' : 'issue-row--danger'">
        <span>{{ testResult.message }}</span>
      </div>
    </section>

    <section class="flow-section">
      <div class="flow-section__head flow-section__head--split">
        <div>
          <h2>模型目录</h2>
        </div>
        <div class="flow-section__meta-actions">
          <span class="section-meta">最近拉取：{{ lastFetchLabel }}</span>
          <el-button class="api-btn api-btn--ghost" @click="fetchModels" :loading="testing">连接并拉取模型</el-button>
        </div>
      </div>

      <div class="model-directory-panel">
        <div class="directory-summary">
          <span>当前收录</span>
          <strong>{{ form.availableModels.length }} 个模型</strong>
        </div>

        <div v-if="form.availableModels.length" class="model-chip-list">
          <span v-for="model in form.availableModels" :key="model" class="model-chip">{{ model }}</span>
        </div>
        <el-empty v-else description="暂无模型" :image-size="56" />

        <el-form :model="form" label-position="top" class="config-form config-form--tight">
          <el-form-item label="可用模型">
            <el-select
              v-model="form.availableModels"
              multiple
              filterable
              allow-create
              default-first-option
              placeholder="选择或补充模型"
            >
              <el-option v-for="model in modelOptions" :key="model" :label="model" :value="model" />
            </el-select>
          </el-form-item>

          <el-form-item label="手动补充">
            <el-input v-model="manualModelInput" placeholder="model-a, model-b">
              <template #append>
                <el-button class="api-append-btn" @click="appendManualModels">添加</el-button>
              </template>
            </el-input>
          </el-form-item>
        </el-form>
      </div>
    </section>

    <section class="flow-section">
      <div class="flow-section__head">
        <div>
          <h2>默认路由</h2>
        </div>
        <span class="section-meta">{{ routeFillCount }}/3 已设置</span>
      </div>

      <el-form :model="form" label-position="top" class="config-form">
        <div class="field-grid field-grid--three">
          <el-form-item label="对话默认">
            <el-select
              v-model="form.defaultModel"
              filterable
              allow-create
              default-first-option
              placeholder="选择对话默认模型"
            >
              <el-option v-for="model in modelOptions" :key="`default-${model}`" :label="model" :value="model" />
            </el-select>
          </el-form-item>

          <el-form-item label="推理默认">
            <el-select
              v-model="form.defaultReasoningModel"
              filterable
              allow-create
              default-first-option
              placeholder="选择推理默认模型"
            >
              <el-option v-for="model in modelOptions" :key="`reason-${model}`" :label="model" :value="model" />
            </el-select>
          </el-form-item>

          <el-form-item label="评估默认">
            <el-select
              v-model="form.defaultEvaluationModel"
              filterable
              allow-create
              default-first-option
              placeholder="选择评估默认模型"
            >
              <el-option v-for="model in modelOptions" :key="`eval-${model}`" :label="model" :value="model" />
            </el-select>
          </el-form-item>
        </div>
      </el-form>
    </section>

    <section class="flow-section">
      <div class="flow-section__head flow-section__head--split">
        <div>
          <h2>验证</h2>
        </div>
        <span class="head-badge" :class="`head-badge--${modelTestTone}`">{{ modelTestStateLabel }}</span>
      </div>

      <el-form :model="modelTestForm" label-position="top" class="test-form">
        <div class="field-grid field-grid--test">
          <el-form-item label="测试模型">
            <el-select
              v-model="modelTestForm.model"
              filterable
              allow-create
              default-first-option
              placeholder="选择测试模型"
            >
              <el-option v-for="model in modelOptions" :key="`test-${model}`" :label="model" :value="model" />
            </el-select>
          </el-form-item>

          <el-form-item label="温度">
            <el-input-number v-model="modelTestForm.temperature" :min="0" :max="2" :step="0.1" />
          </el-form-item>

          <el-form-item label="最大输出">
            <el-input-number v-model="modelTestForm.maxTokens" :min="32" :max="4000" :step="32" />
          </el-form-item>
        </div>

        <el-form-item label="提示词">
          <el-input
            v-model="modelTestForm.prompt"
            class="lab-textarea"
            type="textarea"
            :rows="4"
            placeholder="请输入测试提示词"
          />
        </el-form-item>
      </el-form>

      <div class="terminal-actions">
        <el-button class="api-btn api-btn--primary" @click="runModelTest" :loading="modelTesting">运行测试</el-button>
      </div>

      <div class="result-panel" :class="{ 'is-error': modelTestResult && !modelTestResult.success }">
        <div class="result-meta-grid">
          <div class="result-meta">
            <span>模型</span>
            <strong>{{ modelTestResult?.model || modelTestForm.model || '--' }}</strong>
          </div>
          <div class="result-meta">
            <span>耗时</span>
            <strong>{{ modelTestResult?.durationMs ? `${modelTestResult.durationMs}ms` : '--' }}</strong>
          </div>
          <div class="result-meta">
            <span>Tokens</span>
            <strong>{{ modelTestResult ? formatUsage(modelTestResult.usage) : '--' }}</strong>
          </div>
        </div>
        <pre class="result-output">{{ modelTestResult ? (modelTestResult.content || modelTestResult.message) : '--' }}</pre>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Setting } from '@element-plus/icons-vue';
import { adminApiConfigApi } from '@/api/adminApi';
import AdminPageHeader from './components/AdminPageHeader.vue';
import { toast } from '../../utils/toast';

const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const manualModelInput = ref('');
const lastFetchAt = ref('');
const connectionStatus = ref('unknown');
const testResult = ref<{ connected: boolean; message: string } | null>(null);
const modelOptions = ref<string[]>([]);
const modelTesting = ref(false);
const modelTestResult = ref<{
  success: boolean;
  message: string;
  model?: string;
  durationMs?: number;
  content?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
} | null>(null);

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

const modelTestForm = reactive({
  model: '',
  prompt: '请用一句中文确认模型测试成功。',
  temperature: 0.2,
  maxTokens: 256
});

const apiConfigHighlights = computed(() => [
  { label: connectionStateLabel.value, tone: connectionTone.value },
  { label: keyStateLabel.value, tone: form.apiKeyConfigured ? 'success' as const : 'danger' as const },
  { label: `${form.availableModels.length} 个模型`, tone: 'neutral' as const },
  { label: `${routeFillCount.value}/3 已设置`, tone: routeFillCount.value === 3 ? 'success' as const : 'neutral' as const }
])

const connectionStateLabel = computed(() => {
  switch (connectionStatus.value) {
    case 'connected':
      return '连接正常'
    case 'failed':
      return '连接失败'
    default:
      return '未检测'
  }
})

const connectionTone = computed<'info' | 'success' | 'warning' | 'danger' | 'neutral'>(() => {
  if (connectionStatus.value === 'connected') return 'success'
  if (connectionStatus.value === 'failed') return 'danger'
  return 'neutral'
})

const modelTestStateLabel = computed(() => {
  if (modelTesting.value) return '测试中'
  if (!modelTestResult.value) return '未执行'
  return modelTestResult.value.success ? '测试通过' : '测试失败'
})

const modelTestTone = computed<'info' | 'success' | 'warning' | 'danger' | 'neutral'>(() => {
  if (modelTesting.value) return 'info'
  if (!modelTestResult.value) return 'neutral'
  return modelTestResult.value.success ? 'success' : 'danger'
})

const compactApiUrl = computed(() => form.apiUrl || '未配置')
const keyStateLabel = computed(() => form.apiKeyConfigured ? '已配置密钥' : '未配置密钥')
const routeFillCount = computed(() => [form.defaultModel, form.defaultReasoningModel, form.defaultEvaluationModel].filter(Boolean).length)
const lastFetchLabel = computed(() => lastFetchAt.value || '--')

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
    connectionStatus.value = data.connectionStatus || 'unknown';
    lastFetchAt.value = data.lastCheckedAt ? new Date(data.lastCheckedAt).toLocaleString() : '';
    modelTestForm.model = data.defaultModel || modelTestForm.model || '';
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

function formatUsage(usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined) {
  if (!usage) return '--';
  return `P ${usage.prompt_tokens ?? 0} / C ${usage.completion_tokens ?? 0} / T ${usage.total_tokens ?? 0}`;
}

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
    connectionStatus.value = 'connected';
    testResult.value = {
      connected: true,
      message: Array.isArray(models) && models.length > 0
        ? `已获取 ${models.length} 个模型`
        : `连接成功`
    };
    toast.success('模型列表获取成功');
  } catch (error: any) {
    connectionStatus.value = 'failed';
    testResult.value = {
      connected: false,
      message: error.response?.data?.error || error.message || '连接测试失败'
    };
    toast.error('模型列表获取失败');
  } finally {
    testing.value = false;
  }
}

async function runModelTest() {
  if (!modelTestForm.model.trim()) {
    toast.error('请先选择或输入测试模型');
    return;
  }

  modelTesting.value = true;
  modelTestResult.value = null;

  try {
    const response: any = await adminApiConfigApi.testModel({
      apiUrl: form.apiUrl,
      apiKey: form.apiKeyInput,
      model: modelTestForm.model.trim(),
      prompt: modelTestForm.prompt.trim(),
      temperature: modelTestForm.temperature,
      maxTokens: modelTestForm.maxTokens
    });

    const data = response.data?.data || {};
    modelTestResult.value = {
      success: true,
      message: '模型测试成功',
      model: data.model,
      durationMs: data.durationMs,
      content: data.content,
      usage: data.usage || null
    };
    toast.success('模型测试成功');
  } catch (error: any) {
    modelTestResult.value = {
      success: false,
      message: error.response?.data?.error || error.message || '模型测试失败'
    };
    toast.error('模型测试失败');
  } finally {
    modelTesting.value = false;
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
  display: grid;
  gap: 18px;
}

.summary-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  border: 1px solid rgba(223, 231, 243, 0.92);
  border-radius: 20px;
  overflow: hidden;
  background: rgba(248, 250, 255, 0.88);
}

.summary-strip__item {
  display: grid;
  gap: 6px;
  padding: 16px 18px;
}

.summary-strip__item + .summary-strip__item {
  border-left: 1px solid rgba(223, 231, 243, 0.92);
}

.summary-strip__item span {
  font-size: 12px;
  color: #7b8ba3;
  font-weight: 700;
}

.summary-strip__item strong {
  color: #22344d;
  font-size: 1rem;
  line-height: 1.35;
}

.flow-section {
  display: grid;
  gap: 16px;
  padding: 18px 0 22px;
  border-bottom: 1px solid rgba(223, 231, 243, 0.92);
}

.flow-section:last-child {
  border-bottom: none;
}

.flow-section__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.flow-section__head--split {
  flex-wrap: wrap;
}

.flow-section__head h2 {
  margin: 0;
  color: #20324d;
  font-size: 1.12rem;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.flow-section__head p {
  margin: 6px 0 0;
  color: #7085a6;
  font-size: 0.9rem;
  line-height: 1.6;
}

.flow-section__meta-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.section-meta {
  font-size: 12px;
  color: #7085a6;
  font-weight: 700;
}

.issue-row {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 0 14px;
  border-radius: 14px;
  border: 1px solid rgba(223, 231, 243, 0.92);
  background: rgba(248, 250, 255, 0.76);
  color: #43566f;
  font-size: 13px;
  font-weight: 700;
}

.issue-row--success {
  border-color: rgba(67, 193, 120, 0.22);
  background: rgba(245, 255, 248, 0.9);
  color: #237b4a;
}

.issue-row--danger {
  border-color: rgba(233, 82, 82, 0.22);
  background: rgba(255, 247, 247, 0.92);
  color: #b64349;
}

.model-directory-panel {
  display: grid;
  gap: 16px;
}

.directory-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.directory-summary span {
  font-size: 12px;
  color: #7b8ba3;
  font-weight: 700;
}

.directory-summary strong {
  color: #22344d;
  font-size: 0.98rem;
  font-weight: 800;
}

.model-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.model-chip {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(223, 231, 243, 0.92);
  background: rgba(248, 250, 255, 0.92);
  color: #294a80;
  font-size: 13px;
  font-weight: 700;
}

.config-form--tight {
  gap: 14px;
}

.topbar-btn {
  min-height: 38px;
  padding: 0 16px;
  border-radius: 999px;
  font-weight: 700;
}

.topbar-btn--primary {
  box-shadow: 0 14px 26px rgba(52, 120, 246, 0.22);
}

.head-badge {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: #295bd2;
  font-size: 12px;
  font-weight: 800;
}

.head-badge--success {
  background: rgba(67, 193, 120, 0.12);
  color: #237b4a;
}

.head-badge--danger {
  background: rgba(233, 82, 82, 0.12);
  color: #b64349;
}

.head-badge--info {
  background: rgba(52, 120, 246, 0.12);
  color: #295bd2;
}

.config-form {
  display: grid;
  gap: 16px;
}

.field-grid,
.field-stack {
  display: grid;
  gap: 14px;
}

.field-grid--two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.field-grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.field-grid--test {
  grid-template-columns: minmax(220px, 1.5fr) minmax(120px, 0.75fr) minmax(120px, 0.75fr);
}

.inline-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.api-btn {
  min-height: 38px;
  padding: 0 16px;
  border-radius: 14px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 800;
}

.api-btn--primary {
  color: #ffffff;
  background: linear-gradient(135deg, #3478f6, #3f86ff);
  box-shadow: 0 12px 24px rgba(52, 120, 246, 0.24);
}

.api-btn--primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 16px 28px rgba(52, 120, 246, 0.28);
}

.api-btn--ghost {
  color: #335aa4;
  border-color: rgba(52, 120, 246, 0.2);
  background: rgba(255, 255, 255, 0.92);
}

.api-btn--ghost:hover {
  color: #22478f;
  border-color: rgba(52, 120, 246, 0.38);
  background: rgba(238, 245, 255, 0.92);
}

.api-append-btn {
  font-weight: 800;
  color: #335aa4;
}

.test-form {
  display: grid;
  gap: 14px;
}

.terminal-actions {
  margin-top: 16px;
  display: flex;
  justify-content: flex-start;
}

.result-panel {
  padding: 16px;
  border-radius: 18px;
  border: 1px solid rgba(223, 231, 243, 0.92);
  background: rgba(248, 250, 255, 0.92);
  color: #22344d;
  display: grid;
  gap: 12px;
}

.result-meta-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.result-panel.is-error {
  border-color: rgba(233, 82, 82, 0.22);
  background: rgba(255, 247, 247, 0.94);
  color: #8f2d3a;
}

.result-meta {
  display: grid;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px dashed rgba(203, 214, 233, 0.92);
}

.result-meta span {
  color: #7b8ba3;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.result-meta strong {
  color: inherit;
  font-size: 13px;
  font-weight: 800;
  text-align: left;
  word-break: break-word;
}

.result-output {
  margin: 0;
  min-height: 160px;
  max-height: 320px;
  overflow: auto;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid rgba(223, 231, 243, 0.92);
  background: rgba(255, 255, 255, 0.92);
}

.break-all {
  word-break: break-all;
}

:deep(.config-form .el-form-item),
:deep(.test-form .el-form-item) {
  margin-bottom: 0;
}

:deep(.el-form-item__label) {
  padding-bottom: 8px !important;
  color: #607189;
  font-size: 12px;
  font-weight: 800;
}

:deep(.el-input__wrapper),
:deep(.el-select__wrapper),
:deep(.el-textarea__inner),
:deep(.el-input-number),
:deep(.el-input-group__append) {
  border-radius: 16px;
}

:deep(.el-input__wrapper),
:deep(.el-select__wrapper),
:deep(.el-textarea__inner) {
  background: rgba(255, 255, 255, 0.9);
}

:deep(.el-input-number) {
  width: 100%;
}

:deep(.el-input-group__append) {
  background: rgba(244, 248, 255, 0.96);
}

:deep(.lab-textarea .el-textarea__inner) {
  min-height: 132px;
  background: rgba(248, 250, 255, 0.92);
}

@media (max-width: 1024px) {
  .field-grid--three,
  .field-grid--test {
    grid-template-columns: 1fr;
  }

  .summary-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .terminal-meta-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .summary-strip {
    grid-template-columns: 1fr;
  }

  .summary-strip__item + .summary-strip__item {
    border-left: none;
    border-top: 1px solid rgba(223, 231, 243, 0.92);
  }

  .field-grid--two {
    grid-template-columns: 1fr;
  }
}
</style>
