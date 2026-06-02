<template>
  <div class="api-config-page">
    <div class="bg-layer"><div class="bg-orb bg-orb--1"></div><div class="bg-orb bg-orb--2"></div></div>
    <div class="page-hero">
      <span class="pill">平台配置</span>
      <h2 class="page-hero__title admin-page-title">
        <el-icon class="admin-page-title__icon"><Setting /></el-icon>
        API 管理
      </h2>
      <p class="page-hero__subtitle">配置服务地址、访问凭证与默认模型，统一平台的模型连接与调用基础设置。</p>
    </div>

    <div class="summary-grid">
      <div class="summary-item summary-item--primary">
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
              <el-button class="api-btn api-btn--ghost" @click="loadConfig" :loading="loading">刷新</el-button>
              <el-button class="api-btn api-btn--primary" @click="saveConfig" :loading="saving">保存配置</el-button>
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
              <el-button class="api-btn api-btn--primary" @click="fetchModels" :loading="testing">获取模型列表</el-button>
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
                <el-button class="api-append-btn" @click="appendManualModels">添加</el-button>
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

          <section class="strategy-panel">
            <div class="section-heading">
              <div>
                <span class="section-kicker">高级选项</span>
                <h3>模型分工策略</h3>
                <p>把通用默认模型与专项模型拆开管理，适合需要分别控制推理链路和评估链路的后台场景。</p>
              </div>
              <div class="section-meta">
                <span>默认：{{ form.defaultModel || '未设置' }}</span>
                <span>专项覆盖：{{ [form.defaultReasoningModel, form.defaultEvaluationModel].filter(Boolean).length }}/2</span>
              </div>
            </div>

            <div class="flat-form-grid">
              <div class="flat-field">
                <label>默认推理模型</label>
                <p>用于复杂思考、路径规划和需要更多中间推理步骤的任务。</p>
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
              </div>

              <div class="flat-field">
                <label>默认评估模型</label>
                <p>用于评分、结果审阅、质量判断以及简洁的结果收束任务。</p>
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
              </div>
            </div>
          </section>

          <section class="model-lab">
            <div class="section-heading">
              <div>
                <span class="section-kicker">模型测试</span>
                <h3>在线验证实验台</h3>
                <p>直接发起一次真实调用，快速确认当前配置是否可用、响应速度是否正常，以及返回文本是否符合预期。</p>
              </div>
              <div class="section-meta section-meta--status" :class="{ 'is-success': modelTestResult?.success, 'is-error': modelTestResult && !modelTestResult.success }">
                {{ modelTesting ? '测试中' : modelTestResult ? (modelTestResult.success ? '测试通过' : '测试失败') : '待执行' }}
              </div>
            </div>

            <div class="lab-flat-layout">
              <div class="lab-form-area">
                <div class="flat-form-grid flat-form-grid--test">
                  <div class="flat-field flat-field--wide">
                    <label>测试模型</label>
                    <el-select
                      v-model="modelTestForm.model"
                      filterable
                      allow-create
                      default-first-option
                      placeholder="选择或输入测试模型"
                      style="width: 100%"
                    >
                      <el-option v-for="model in modelOptions" :key="`test-${model}`" :label="model" :value="model" />
                    </el-select>
                  </div>

                  <div class="flat-field">
                    <label>温度</label>
                    <el-input-number v-model="modelTestForm.temperature" :min="0" :max="2" :step="0.1" style="width: 100%" />
                  </div>

                  <div class="flat-field">
                    <label>最大输出</label>
                    <el-input-number v-model="modelTestForm.maxTokens" :min="32" :max="4000" :step="32" style="width: 100%" />
                  </div>
                </div>

                <div class="flat-field flat-field--prompt">
                  <label>测试提示词</label>
                  <p>建议保持一句到两句，便于快速判断返回是否正常。即时调用，不写入配置。</p>
                  <el-input
                    v-model="modelTestForm.prompt"
                    class="lab-textarea"
                    type="textarea"
                    :rows="5"
                    placeholder="例如：请用一句中文确认模型测试成功。"
                  />
                </div>

                <div class="lab-actions">
                  <el-button class="api-btn api-btn--primary" @click="runModelTest" :loading="modelTesting">运行模型测试</el-button>
                  <div v-if="modelTestResult" class="lab-feedback" :class="{ success: modelTestResult.success, error: !modelTestResult.success }">
                    {{ modelTestResult.success ? '已返回有效响应，可继续观察输出内容。' : modelTestResult.message }}
                  </div>
                </div>
              </div>

              <div class="lab-result-area" :class="{ 'is-error': modelTestResult && !modelTestResult.success }">
                <div class="result-line">
                  <span>测试模型</span>
                  <strong>{{ modelTestResult?.model || modelTestForm.model || '未指定' }}</strong>
                </div>
                <div class="result-line">
                  <span>响应耗时</span>
                  <strong>{{ modelTestResult?.durationMs ? `${modelTestResult.durationMs}ms` : '--' }}</strong>
                </div>
                <div class="result-line">
                  <span>Token 用量</span>
                  <strong>{{ modelTestResult ? formatUsage(modelTestResult.usage) : '--' }}</strong>
                </div>
                <div class="result-output">
                  <label>返回内容</label>
                  <pre class="sample-json sample-json--light">{{ modelTestResult ? (modelTestResult.content || modelTestResult.message) : '执行测试后，这里会展示模型返回内容。' }}</pre>
                </div>
              </div>
            </div>
          </section>
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
  padding: 0;
  position: relative;
  display: grid;
  gap: 16px;
}

/* Background orbs */
.bg-layer { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.bg-orb { position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0.15; }
.bg-orb--1 { width: 460px; height: 460px; top: -180px; right: -120px; background: radial-gradient(circle, rgba(52, 120, 246, 0.3), transparent 70%); animation: orb-d 26s ease-in-out infinite; }
.bg-orb--2 { width: 380px; height: 380px; left: -100px; bottom: 120px; background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%); animation: orb-d 30s ease-in-out infinite reverse; }
@keyframes orb-d { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -20px) scale(1.05); } 66% { transform: translate(-20px, 30px) scale(0.95); } }

/* Hero */
.page-hero,
.summary-item,
.config-card {
  border: 1px solid rgba(205, 216, 238, 0.9);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 255, 0.94));
  box-shadow: 0 16px 42px rgba(42, 72, 128, 0.08);
}

.page-hero { position: relative; z-index: 1; padding: 24px 28px; border-radius: 24px; background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 38%), linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(244, 247, 252, 0.94)); margin-bottom: 0; }
.page-hero__title.admin-page-title { margin: 8px 0 0; font-size: 1.6rem; font-weight: 700; color: #22344d; letter-spacing: -0.03em; display: flex; align-items: center; gap: 8px; }
.admin-page-title__icon { font-size: 1.25rem; color: var(--color-primary); }
.page-hero__subtitle { margin: 6px 0 0; color: #62758f; font-size: 0.95rem; line-height: 1.65; }
.pill { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px; border-radius: 999px; background: rgba(52, 120, 246, 0.08); color: #2d6df2; font-size: 12px; font-weight: 700; }

.summary-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 0;
}

.summary-item {
  border-radius: 18px;
  padding: 1rem 1.25rem;
  display: grid;
  gap: 0.25rem;
}

.summary-item--primary {
  background: linear-gradient(180deg, rgba(246, 250, 255, 0.98), rgba(237, 244, 255, 0.98));
}

.summary-label {
  font-size: 0.75rem;
  color: #7b8ba3;
  font-weight: 600;
}

.summary-value {
  font-size: 1.75rem;
  font-weight: 800;
  color: #22344d;
  line-height: 1.2;
}

.config-shell {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(320px, 0.9fr);
  gap: 16px;
}

.config-card {
  border-radius: 24px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.config-card :deep(.el-card__header) {
  border-bottom-color: rgba(52, 120, 246, 0.06);
  padding: 18px 24px;
}

.config-card :deep(.el-card__body) {
  padding: 20px 24px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.card-title {
  font-size: 1rem;
  font-weight: 700;
  color: #22344d;
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

.api-btn {
  min-height: 36px;
  padding: 0 14px;
  border-radius: 14px;
  border: 1px solid transparent;
  font-size: 0.875rem;
  font-weight: 700;
}

.api-btn--primary {
  color: #ffffff;
  background: linear-gradient(135deg, #3478f6, #3f86ff);
  box-shadow: 0 10px 20px rgba(52, 120, 246, 0.24);
}

.api-btn--primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 26px rgba(52, 120, 246, 0.3);
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
  font-weight: 700;
  color: #335aa4;
}

.sample-json {
  margin: 0;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 0.82rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.sample-json--light {
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(247, 250, 255, 0.9);
  border: 1px solid rgba(216, 224, 238, 0.9);
  color: #22344d;
}

.advanced-field-card {
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid rgba(216, 224, 238, 0.9);
  background: rgba(248, 250, 255, 0.88);
  display: grid;
  gap: 10px;
}

.advanced-field-card__head {
  display: grid;
  gap: 4px;
}

.advanced-field-card__head strong {
  color: #22344d;
  font-size: 0.9rem;
}

.advanced-field-card__head span {
  color: #7b8ba3;
  font-size: 0.78rem;
}

.strategy-panel,
.model-lab {
  margin-top: 18px;
  padding: 18px 0 0;
  border-top: 1px solid rgba(216, 224, 238, 0.9);
  display: grid;
  gap: 16px;
}

.section-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.section-heading h3 {
  margin: 4px 0 0;
  color: #22344d;
  font-size: 1.1rem;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.section-heading p {
  margin: 8px 0 0;
  max-width: 680px;
  color: #62758f;
  font-size: 0.88rem;
  line-height: 1.7;
}

.section-kicker {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: #2d6df2;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.section-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
  color: #6f8098;
  font-size: 0.8rem;
  font-weight: 700;
}

.section-meta span,
.section-meta--status {
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.07);
  color: #335aa4;
}

.section-meta--status.is-success {
  background: rgba(51, 181, 103, 0.1);
  color: #1f7a4f;
}

.section-meta--status.is-error {
  background: rgba(233, 82, 82, 0.1);
  color: #c84b48;
}

.flat-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 16px;
}

.flat-form-grid--test {
  grid-template-columns: minmax(220px, 1.4fr) minmax(120px, 0.8fr) minmax(120px, 0.8fr);
}

.flat-field {
  display: grid;
  align-content: start;
  gap: 8px;
}

.flat-field label,
.result-output label {
  color: #22344d;
  font-size: 0.86rem;
  font-weight: 800;
}

.flat-field p {
  margin: 0;
  color: #6f8098;
  font-size: 0.8rem;
  line-height: 1.6;
}

.flat-field--prompt {
  padding-top: 2px;
}

.lab-flat-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.8fr);
  gap: 18px;
  align-items: stretch;
}

.lab-form-area {
  display: grid;
  gap: 14px;
}

.lab-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.lab-feedback {
  padding: 0;
  background: transparent;
  border: 0;
  font-size: 0.82rem;
  line-height: 1.55;
}

.lab-feedback.success {
  color: #1f7a4f;
}

.lab-feedback.error {
  color: #c84b48;
}

.lab-result-area {
  padding-left: 18px;
  border-left: 1px solid rgba(216, 224, 238, 0.95);
  display: grid;
  gap: 12px;
  align-content: start;
}

.lab-result-area.is-error {
  border-left-color: rgba(233, 82, 82, 0.34);
}

.result-line {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px dashed rgba(216, 224, 238, 0.92);
}

.result-line span {
  color: #7b8ba3;
  font-size: 0.78rem;
  font-weight: 700;
}

.result-line strong {
  color: #22344d;
  font-size: 0.86rem;
  font-weight: 800;
  text-align: right;
  word-break: break-word;
}

.result-output {
  display: grid;
  gap: 10px;
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
  border-radius: 16px;
  background: rgba(247, 250, 255, 0.88);
  border: 1px solid rgba(216, 224, 238, 0.9);
}

.registration-actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.status-item {
  padding: 1rem;
  border-radius: 16px;
  background: rgba(247, 250, 255, 0.88);
  border: 1px solid rgba(216, 224, 238, 0.9);
}

.status-label {
  font-size: 0.8rem;
  color: #7b8ba3;
  margin-bottom: 0.35rem;
}

.status-value {
  color: #22344d;
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

:deep(.config-card .el-select__wrapper),
:deep(.config-card .el-input__wrapper) {
  border-radius: 12px;
}

:deep(.lab-textarea .el-textarea__inner) {
  min-height: 144px;
  border-radius: 16px;
  background: rgba(248, 250, 255, 0.92);
}

@media (max-width: 1024px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .config-shell {
    grid-template-columns: 1fr;
  }

  .section-heading {
    flex-direction: column;
  }

  .flat-form-grid,
  .flat-form-grid--test,
  .lab-flat-layout {
    grid-template-columns: 1fr;
  }

  .section-meta {
    justify-content: flex-start;
  }

  .lab-result-area {
    padding-left: 0;
    padding-top: 16px;
    border-left: 0;
    border-top: 1px solid rgba(216, 224, 238, 0.95);
  }
}

@media (max-width: 640px) {
  .status-grid {
    grid-template-columns: 1fr;
  }
}
</style>
