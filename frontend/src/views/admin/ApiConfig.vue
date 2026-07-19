<template>
  <div class="admin-page api-config-page">
    <AdminPageHeader
      title="连接与安全"
      :icon="Setting"
    >
      <template #actions>
        <el-button class="topbar-btn" @click="loadConfig" :loading="loading">刷新配置</el-button>
        <el-button type="primary" class="topbar-btn topbar-btn--primary" @click="saveAll" :loading="saving">保存变更</el-button>
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
        <span>Admin 范围</span>
        <strong>{{ adminAccessModeLabel }}</strong>
      </div>
      <div class="summary-strip__item">
        <span>私有网络</span>
        <strong>{{ networkPolicy.allowPrivateNetwork ? '允许' : '精确放行' }}</strong>
      </div>
    </section>

    <section class="flow-section security-section">
      <div class="flow-section__head flow-section__head--split">
        <div>
          <h2>网络边界</h2>
          <p>控制后台访问来源，以及模型、MCP 和内容提取是否可以连接本机或局域网服务。</p>
        </div>
        <span class="head-badge head-badge--info">{{ policySourceLabel }}</span>
      </div>

      <div class="policy-grid">
        <article class="policy-panel">
          <div class="policy-panel__head">
            <div>
              <h3>Admin 访问范围</h3>
              <p>默认允许服务器本机和同一局域网，公网来源会被拒绝。</p>
            </div>
          </div>

          <el-radio-group v-model="networkPolicy.adminAccessMode" class="mode-grid">
            <el-radio-button value="loopback">
              <span class="mode-option"><strong>仅本机</strong><small>127.0.0.1 / ::1</small></span>
            </el-radio-button>
            <el-radio-button value="private">
              <span class="mode-option"><strong>本机 + 局域网</strong><small>推荐用于开发和内网部署</small></span>
            </el-radio-button>
            <el-radio-button value="any">
              <span class="mode-option"><strong>不限制来源</strong><small>仅配合 VPN、网关或防火墙</small></span>
            </el-radio-button>
          </el-radio-group>

          <el-form label-position="top" class="config-form config-form--tight">
            <el-form-item label="额外允许的客户端 IP">
              <el-select
                v-model="networkPolicy.adminAllowedIps"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="例如 203.0.113.10"
              />
              <span class="field-help">适合 VPN 出口或固定运维终端，填写精确 IP，不填写网段。</span>
            </el-form-item>
          </el-form>
        </article>

        <article class="policy-panel policy-panel--network">
          <div class="policy-panel__head policy-panel__head--switch">
            <div>
              <h3>允许私有网络服务</h3>
              <p>用于 Ollama、本地模型、局域网 MCP 或内部内容服务。</p>
            </div>
            <el-switch
              v-model="networkPolicy.allowPrivateNetwork"
              inline-prompt
              active-text="开启"
              inactive-text="关闭"
              size="large"
            />
          </div>

          <div class="policy-state" :class="networkPolicy.allowPrivateNetwork ? 'policy-state--open' : 'policy-state--guarded'">
            <strong>{{ networkPolicy.allowPrivateNetwork ? '开发模式：允许本机与局域网目标' : '受控模式：仅允许下方白名单' }}</strong>
            <span>Link-local、云元数据、组播和保留地址始终禁止。</span>
          </div>

          <el-form label-position="top" class="config-form config-form--tight">
            <el-form-item label="私有服务 Host / IP 白名单">
              <el-select
                v-model="networkPolicy.privateNetworkHosts"
                multiple
                filterable
                allow-create
                default-first-option
                :disabled="networkPolicy.allowPrivateNetwork"
                placeholder="例如 192.168.31.26 或 ollama.local"
              />
              <span class="field-help">关闭总开关时，仅这些精确 Host 或 IP 可以作为模型与 MCP 地址。</span>
            </el-form-item>
          </el-form>
        </article>
      </div>

      <div v-if="networkPolicy.adminAccessMode === 'any'" class="issue-row issue-row--danger">
        Admin 已允许公网来源。请确认前方存在 VPN、访问网关或防火墙白名单。
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

        </el-form>
      </div>
    </section>

    <section class="flow-section">
      <div class="flow-section__head">
        <div>
          <h2>默认路由</h2>
        </div>
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
        <el-button type="primary" class="api-btn" @click="runModelTest" :loading="modelTesting">运行测试</el-button>
      </div>

      <div v-if="modelTestResult" class="result-panel" :class="{ 'is-error': !modelTestResult.success }">
        <div class="result-meta-grid">
          <div class="result-meta">
            <span>模型</span>
            <strong>{{ modelTestResult.model || modelTestForm.model || '--' }}</strong>
          </div>
          <div class="result-meta">
            <span>耗时</span>
            <strong>{{ modelTestResult.durationMs ? `${modelTestResult.durationMs}ms` : '--' }}</strong>
          </div>
          <div class="result-meta">
            <span>Tokens</span>
            <strong>{{ formatUsage(modelTestResult.usage) }}</strong>
          </div>
        </div>
        <pre class="result-output">{{ modelTestResult.content || modelTestResult.message }}</pre>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Setting } from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';
import { adminApiConfigApi } from '@/api/adminApi';
import AdminPageHeader from './components/AdminPageHeader.vue';
import { toast } from '../../utils/toast';

const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
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
  apiKeyInput: '',
  apiKeyConfigured: false,
  availableModels: [] as string[],
  defaultModel: '',
  defaultReasoningModel: '',
  defaultEvaluationModel: ''
});

const networkPolicy = reactive({
  adminAccessMode: 'private' as 'loopback' | 'private' | 'any',
  adminAllowedIps: [] as string[],
  allowPrivateNetwork: true,
  privateNetworkHosts: [] as string[],
  source: 'environment' as 'database' | 'environment'
});

const modelTestForm = reactive({
  model: '',
  prompt: '请用一句中文确认模型测试成功。',
  temperature: 0.2,
  maxTokens: 256
});

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

const keyStateLabel = computed(() => form.apiKeyConfigured ? '已配置' : '未配置')
const lastFetchLabel = computed(() => lastFetchAt.value || '--')
const adminAccessModeLabel = computed(() => ({
  loopback: '仅本机',
  private: '本机 + 局域网',
  any: '不限制来源'
}[networkPolicy.adminAccessMode]))
const policySourceLabel = computed(() => networkPolicy.source === 'database' ? '平台策略 · 热生效' : '环境默认值')

async function loadConfig() {
  loading.value = true;
  try {
    const response = await adminApiConfigApi.getConfig();
    const data = response.data.data;
    form.apiUrl = data.apiUrl || '';
    // 完整密钥不再写入内存（发送只用 apiKeyInput），避免敏感数据无谓滞留
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
    const policy = data.networkPolicy || {};
    networkPolicy.adminAccessMode = policy.adminAccessMode || 'private';
    networkPolicy.adminAllowedIps = Array.isArray(policy.adminAllowedIps) ? policy.adminAllowedIps : [];
    networkPolicy.allowPrivateNetwork = policy.allowPrivateNetwork !== false;
    networkPolicy.privateNetworkHosts = Array.isArray(policy.privateNetworkHosts) ? policy.privateNetworkHosts : [];
    networkPolicy.source = policy.source === 'database' ? 'database' : 'environment';
  } catch (error) {
    const message = (error as { message?: unknown } | null)?.message;
    toast.error(typeof message === 'string' && message ? message : '加载 API 配置失败');
  } finally {
    loading.value = false;
  }
}

async function saveConnectionConfig() {
  await adminApiConfigApi.updateConfig({
      apiUrl: form.apiUrl,
      apiKey: form.apiKeyInput,
      availableModels: form.availableModels,
      defaultModel: form.defaultModel,
      defaultReasoningModel: form.defaultReasoningModel,
      defaultEvaluationModel: form.defaultEvaluationModel
  });
}

async function saveNetworkPolicy() {
  await adminApiConfigApi.updateNetworkPolicy({
    adminAccessMode: networkPolicy.adminAccessMode,
    adminAllowedIps: networkPolicy.adminAllowedIps,
    allowPrivateNetwork: networkPolicy.allowPrivateNetwork,
    privateNetworkHosts: networkPolicy.privateNetworkHosts
  });
}

function isLanBrowserHost() {
  const host = window.location.hostname;
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
}

async function saveAll() {
  // 高风险确认：开放公网访问比"仅本机"风险更高，必须二次确认
  if (networkPolicy.adminAccessMode === 'any') {
    try {
      await ElMessageBox.confirm(
        '你正在将 Admin 后台开放到公网/任意来源访问。任何能访问该服务地址的人都能看到管理入口，请确认已了解风险。',
        '高风险操作确认',
        { confirmButtonText: '确认开放公网访问', cancelButtonText: '返回修改', type: 'error' }
      );
    } catch {
      return;
    }
  }

  if (networkPolicy.adminAccessMode === 'loopback' && isLanBrowserHost()) {
    try {
      await ElMessageBox.confirm(
        '当前通过局域网地址访问。保存“仅本机”后，这个浏览器将无法继续进入后台。',
        '确认收紧 Admin 范围',
        { confirmButtonText: '仍然保存', cancelButtonText: '返回修改', type: 'warning' }
      );
    } catch {
      return;
    }
  }

  saving.value = true;
  try {
    await saveConnectionConfig();
    await saveNetworkPolicy();
    toast.success('连接与安全配置已保存');
    await loadConfig();
  } catch (error: any) {
    toast.error(error.response?.data?.error || error.message || '保存配置失败');
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
    const response = await adminApiConfigApi.testConnection({
      apiUrl: form.apiUrl,
      apiKey: form.apiKeyInput
    });

    const models = response.data?.data?.models || response.data?.data?.availableModels || [];
    if (Array.isArray(models) && models.length > 0) {
      mergeModelOptions(models.map((m: unknown) => String(m)));
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
    const response = await adminApiConfigApi.testModel({
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

.config-form--tight {
  gap: 14px;
}

.topbar-btn {
  min-height: 34px;
}

.security-section {
  padding-top: 22px;
}

.policy-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.policy-panel {
  display: grid;
  align-content: start;
  gap: 18px;
  padding: 18px;
  border: 1px solid rgba(211, 221, 237, 0.94);
  border-radius: 18px;
  background: rgba(250, 252, 255, 0.92);
}

.policy-panel--network {
  background: linear-gradient(145deg, rgba(246, 250, 255, 0.96), rgba(250, 255, 252, 0.92));
}

.policy-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.policy-panel__head h3 {
  margin: 0;
  color: #22344d;
  font-size: 0.98rem;
}

.policy-panel__head p {
  margin: 6px 0 0;
  color: #7085a6;
  font-size: 0.82rem;
  line-height: 1.55;
}

.mode-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  width: 100%;
}

.mode-option {
  display: grid;
  gap: 4px;
  padding: 6px 0;
  white-space: normal;
}

.mode-option strong {
  font-size: 12px;
}

.mode-option small,
.field-help {
  color: #7b8ba3;
  font-size: 11px;
  line-height: 1.45;
}

.field-help {
  display: block;
  margin-top: 7px;
}

.policy-state {
  display: grid;
  gap: 5px;
  padding: 12px 14px;
  border-radius: 14px;
  font-size: 12px;
}

.policy-state span {
  opacity: 0.78;
}

.policy-state--open {
  color: #206b47;
  background: rgba(228, 249, 237, 0.84);
  border: 1px solid rgba(67, 193, 120, 0.2);
}

.policy-state--guarded {
  color: #5d6880;
  background: rgba(239, 244, 252, 0.86);
  border: 1px solid rgba(120, 145, 183, 0.18);
}

:deep(.mode-grid .el-radio-button__inner) {
  width: 100%;
  height: 100%;
  padding: 8px 10px;
}

/* 选中态改用浅蓝底 + 深色文字：纯色蓝底会让卡片内的说明文字（small）几乎不可见 */
:deep(.mode-grid .el-radio-button.is-active .el-radio-button__inner) {
  background: rgba(52, 120, 246, 0.1);
  border-color: rgba(52, 120, 246, 0.45);
  color: #295bd2;
  box-shadow: none;
}

:deep(.mode-grid .el-radio-button.is-active .mode-option strong) {
  color: #295bd2;
}

:deep(.mode-grid .el-radio-button.is-active .mode-option small) {
  color: #5d6880;
}

[data-theme="dark"] :deep(.mode-grid .el-radio-button.is-active .el-radio-button__inner) {
  background: rgba(90, 148, 248, 0.18);
  border-color: rgba(90, 148, 248, 0.45);
  color: #a8c5fc;
}

[data-theme="dark"] :deep(.mode-grid .el-radio-button.is-active .mode-option strong) {
  color: #a8c5fc;
}

[data-theme="dark"] :deep(.mode-grid .el-radio-button.is-active .mode-option small) {
  color: #8ba3b5;
}

.topbar-btn--primary {
  box-shadow: none;
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
  min-height: 34px;
  font-size: 13px;
}

.api-append-btn {
  font-weight: 550;
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

  .policy-grid {
    grid-template-columns: 1fr;
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

  .mode-grid {
    grid-template-columns: 1fr;
  }
}
</style>
