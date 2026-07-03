<template>
  <div class="admin-page api-config-page">
    <AdminPageHeader
      title="API 管理"
      :icon="Setting"
      :highlights="apiConfigHighlights"
    >
      <template #actions>
        <el-button class="topbar-btn" @click="loadConfig" :loading="loading">刷新</el-button>
        <el-button type="primary" class="topbar-btn topbar-btn--primary" @click="saveConfig" :loading="saving">保存</el-button>
      </template>
    </AdminPageHeader>

    <section class="signal-strip">
      <article class="signal-tile" :class="`signal-tile--${connectionTone}`">
        <span>连接</span>
        <strong>{{ connectionStateLabel }}</strong>
        <em>{{ lastFetchLabel }}</em>
      </article>
      <article class="signal-tile">
        <span>Endpoint</span>
        <strong>{{ compactApiUrl }}</strong>
        <em>{{ keyStateLabel }}</em>
      </article>
      <article class="signal-tile">
        <span>目录</span>
        <strong>{{ form.availableModels.length }}</strong>
        <em>{{ primaryModelLabel }}</em>
      </article>
      <article class="signal-tile" :class="`signal-tile--${modelTestTone}`">
        <span>测试</span>
        <strong>{{ modelTestStateLabel }}</strong>
        <em>{{ modelTestResult?.model || modelTestForm.model || 'NO MODEL' }}</em>
      </article>
    </section>

    <div class="workbench-grid">
      <section class="studio-card studio-card--primary">
        <div class="studio-card__head">
          <div>
            <span class="studio-card__eyebrow">CONFIG</span>
            <h2>接入与路由</h2>
          </div>
          <span class="head-badge">{{ routeFillCount }}/3</span>
        </div>

        <el-form :model="form" label-position="top" class="config-form">
          <section class="form-block">
            <div class="form-block__title">接入</div>
            <div class="field-grid field-grid--two">
              <el-form-item label="服务地址">
                <el-input v-model="form.apiUrl" placeholder="http://localhost:3000" />
              </el-form-item>

              <el-form-item label="API Key">
                <el-input
                  v-model="form.apiKeyInput"
                  type="password"
                  show-password
                  :placeholder="form.apiKeyConfigured ? '留空沿用' : '输入 API Key'"
                />
              </el-form-item>
            </div>
          </section>

          <section class="form-block">
            <div class="form-block__row">
              <div class="form-block__title">目录</div>
              <div class="inline-actions">
                <el-button class="api-btn api-btn--ghost" @click="fetchModels" :loading="testing">获取模型</el-button>
                <span v-if="testResult" class="inline-status" :class="{ 'is-success': testResult.connected, 'is-error': !testResult.connected }">
                  {{ testResult.message }}
                </span>
              </div>
            </div>

            <div class="field-stack">
              <el-form-item label="可用模型">
                <el-select
                  v-model="form.availableModels"
                  multiple
                  filterable
                  allow-create
                  default-first-option
                  placeholder="选择模型"
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
            </div>
          </section>

          <section class="form-block">
            <div class="form-block__title">路由</div>
            <div class="field-grid field-grid--three">
              <el-form-item label="默认模型">
                <el-select
                  v-model="form.defaultModel"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="默认模型"
                >
                  <el-option v-for="model in modelOptions" :key="`default-${model}`" :label="model" :value="model" />
                </el-select>
              </el-form-item>

              <el-form-item label="推理模型">
                <el-select
                  v-model="form.defaultReasoningModel"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="推理模型"
                >
                  <el-option v-for="model in modelOptions" :key="`reason-${model}`" :label="model" :value="model" />
                </el-select>
              </el-form-item>

              <el-form-item label="评估模型">
                <el-select
                  v-model="form.defaultEvaluationModel"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="评估模型"
                >
                  <el-option v-for="model in modelOptions" :key="`eval-${model}`" :label="model" :value="model" />
                </el-select>
              </el-form-item>
            </div>
          </section>
        </el-form>
      </section>

      <section class="side-column">
        <section class="studio-card studio-card--status">
          <div class="studio-card__head">
            <div>
              <span class="studio-card__eyebrow">STATE</span>
              <h2>状态</h2>
            </div>
          </div>

          <div class="status-grid">
            <div class="status-chip">
              <span>连接</span>
              <strong>{{ connectionStateLabel }}</strong>
            </div>
            <div class="status-chip">
              <span>API Key</span>
              <strong>{{ keyStateLabel }}</strong>
            </div>
            <div class="status-chip status-chip--wide">
              <span>Endpoint</span>
              <strong class="break-all">{{ compactApiUrl }}</strong>
            </div>
            <div class="status-chip">
              <span>模型数</span>
              <strong>{{ form.availableModels.length }}</strong>
            </div>
            <div class="status-chip">
              <span>默认模型</span>
              <strong>{{ form.defaultModel || '--' }}</strong>
            </div>
            <div class="status-chip">
              <span>最近拉取</span>
              <strong>{{ lastFetchLabel }}</strong>
            </div>
          </div>
        </section>

        <section class="studio-card studio-card--terminal">
          <div class="studio-card__head">
            <div>
              <span class="studio-card__eyebrow">TEST</span>
              <h2>模型测试</h2>
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
                  placeholder="测试模型"
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

          <div class="terminal-panel" :class="{ 'is-error': modelTestResult && !modelTestResult.success }">
            <div class="terminal-meta">
              <span>MODEL</span>
              <strong>{{ modelTestResult?.model || modelTestForm.model || '--' }}</strong>
            </div>
            <div class="terminal-meta">
              <span>LATENCY</span>
              <strong>{{ modelTestResult?.durationMs ? `${modelTestResult.durationMs}ms` : '--' }}</strong>
            </div>
            <div class="terminal-meta">
              <span>TOKENS</span>
              <strong>{{ modelTestResult ? formatUsage(modelTestResult.usage) : '--' }}</strong>
            </div>
            <pre class="terminal-output">{{ modelTestResult ? (modelTestResult.content || modelTestResult.message) : 'READY' }}</pre>
          </div>
        </section>
      </section>
    </div>
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
  { label: `${form.availableModels.length} Models`, tone: 'neutral' as const },
  { label: modelTestStateLabel.value, tone: modelTestTone.value }
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
  if (!modelTestResult.value) return '待执行'
  return modelTestResult.value.success ? '测试通过' : '测试失败'
})

const modelTestTone = computed<'info' | 'success' | 'warning' | 'danger' | 'neutral'>(() => {
  if (modelTesting.value) return 'info'
  if (!modelTestResult.value) return 'neutral'
  return modelTestResult.value.success ? 'success' : 'danger'
})

const compactApiUrl = computed(() => form.apiUrl || '未配置')
const keyStateLabel = computed(() => form.apiKeyConfigured ? 'KEY READY' : 'KEY EMPTY')
const primaryModelLabel = computed(() => form.defaultModel || form.defaultReasoningModel || form.defaultEvaluationModel || 'NO DEFAULT')
const routeFillCount = computed(() => [form.defaultModel, form.defaultReasoningModel, form.defaultEvaluationModel].filter(Boolean).length)
const lastFetchLabel = computed(() => lastFetchAt.value || '未拉取')

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
        : `连接成功，发现 ${response.data?.data?.modelsCount ?? 0} 个模型（接口未返回具体列表）`
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

.topbar-btn {
  min-height: 38px;
  padding: 0 16px;
  border-radius: 999px;
  font-weight: 700;
}

.topbar-btn--primary {
  box-shadow: 0 14px 26px rgba(52, 120, 246, 0.22);
}

.signal-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.signal-tile {
  position: relative;
  overflow: hidden;
  padding: 18px 18px 16px;
  border-radius: 24px;
  border: 1px solid rgba(206, 220, 244, 0.95);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(246, 249, 255, 0.92));
  box-shadow: 0 18px 36px rgba(31, 87, 204, 0.08);
  display: grid;
  gap: 10px;
}

.signal-tile::after {
  content: '';
  position: absolute;
  inset: 0 auto auto 0;
  width: 100%;
  height: 3px;
  background: linear-gradient(90deg, rgba(52, 120, 246, 0.42), rgba(52, 120, 246, 0));
}

.signal-tile span {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #7788a1;
}

.signal-tile strong {
  color: #1f2f47;
  font-size: 1.3rem;
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: -0.03em;
  word-break: break-word;
}

.signal-tile em {
  font-style: normal;
  color: #69809f;
  font-size: 12px;
  line-height: 1.45;
  word-break: break-word;
}

.signal-tile--success {
  border-color: rgba(67, 193, 120, 0.28);
  background: linear-gradient(180deg, rgba(249, 255, 251, 0.98), rgba(241, 252, 246, 0.94));
}

.signal-tile--success::after {
  background: linear-gradient(90deg, rgba(67, 193, 120, 0.52), rgba(67, 193, 120, 0));
}

.signal-tile--danger {
  border-color: rgba(233, 82, 82, 0.24);
  background: linear-gradient(180deg, rgba(255, 250, 250, 0.98), rgba(255, 244, 245, 0.94));
}

.signal-tile--danger::after {
  background: linear-gradient(90deg, rgba(233, 82, 82, 0.5), rgba(233, 82, 82, 0));
}

.signal-tile--info::after {
  background: linear-gradient(90deg, rgba(93, 128, 255, 0.52), rgba(93, 128, 255, 0));
}

.workbench-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(320px, 0.95fr);
  gap: 18px;
}

.side-column {
  display: grid;
  gap: 18px;
  align-content: start;
}

.studio-card {
  min-width: 0;
  padding: 22px;
  border-radius: 30px;
  border: 1px solid rgba(211, 221, 240, 0.95);
  background:
    radial-gradient(circle at top right, rgba(52, 120, 246, 0.08), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 255, 0.94));
  box-shadow: 0 24px 54px rgba(31, 87, 204, 0.09);
}

.studio-card--primary {
  padding: 24px;
}

.studio-card__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 18px;
}

.studio-card__eyebrow {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: #2d67de;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.12em;
}

.studio-card__head h2 {
  margin: 8px 0 0;
  color: #20324d;
  font-size: 1.18rem;
  font-weight: 800;
  letter-spacing: -0.03em;
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

.form-block {
  display: grid;
  gap: 14px;
  padding: 18px;
  border-radius: 24px;
  border: 1px solid rgba(217, 226, 241, 0.94);
  background: rgba(249, 251, 255, 0.88);
}

.form-block__title {
  color: #6f8098;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.form-block__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
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

.inline-status {
  font-size: 12px;
  font-weight: 800;
  line-height: 1.5;
}

.inline-status.is-success {
  color: #237b4a;
}

.inline-status.is-error {
  color: #b64349;
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

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.status-chip {
  min-height: 92px;
  padding: 15px 16px;
  border-radius: 20px;
  border: 1px solid rgba(216, 224, 238, 0.92);
  background: rgba(249, 251, 255, 0.88);
  display: grid;
  gap: 10px;
}

.status-chip--wide {
  grid-column: span 2;
}

.status-chip span {
  color: #7788a1;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.status-chip strong {
  color: #20324d;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.45;
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

.terminal-panel {
  margin-top: 16px;
  padding: 16px;
  border-radius: 24px;
  border: 1px solid rgba(92, 122, 182, 0.18);
  background: linear-gradient(180deg, #10192a, #121f35);
  color: #dbe5ff;
  display: grid;
  gap: 12px;
}

.terminal-panel.is-error {
  border-color: rgba(233, 82, 82, 0.2);
  background: linear-gradient(180deg, #2a1219, #231019);
  color: #ffd8df;
}

.terminal-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px dashed rgba(160, 186, 243, 0.18);
}

.terminal-meta span {
  color: rgba(183, 200, 236, 0.74);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.12em;
}

.terminal-meta strong {
  color: inherit;
  font-size: 12px;
  font-weight: 800;
  text-align: right;
  word-break: break-word;
}

.terminal-output {
  margin: 0;
  min-height: 180px;
  max-height: 320px;
  overflow: auto;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
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
  .signal-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .workbench-grid {
    grid-template-columns: 1fr;
  }

  .field-grid--three,
  .field-grid--test {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .signal-strip,
  .status-grid {
    grid-template-columns: 1fr;
  }

  .status-chip--wide {
    grid-column: span 1;
  }

  .field-grid--two {
    grid-template-columns: 1fr;
  }

  .studio-card,
  .studio-card--primary {
    padding: 18px;
    border-radius: 24px;
  }
}
</style>
