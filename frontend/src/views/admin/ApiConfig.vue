<template>
  <div class="admin-page api-config-page">
    <AdminPageHeader
      title="连接与安全"
      :icon="Setting"
    >
      <template #actions>
        <el-button class="topbar-btn" @click="loadConfig" :loading="loading">刷新配置</el-button>
      </template>
    </AdminPageHeader>

    <el-alert
      v-if="loadError"
      type="error"
      title="配置加载失败"
      :description="loadError + '，当前展示的内容可能不是服务端实际配置，请恢复连接后刷新。'"
      show-icon
      :closable="false"
      class="config-load-error"
    >
      <el-button size="small" class="config-load-error__retry" @click="loadConfig">重新加载</el-button>
    </el-alert>

    <!-- 健康状态条：单行 -->
    <section class="health-bar" :class="`health-bar--${overallHealth.tone}`">
      <span class="health-bar__dot"></span>
      <strong class="health-bar__title">{{ overallHealth.title }}</strong>
      <span class="health-bar__sep"></span>
      <span class="health-bar__meta">密钥 {{ keyStateLabel }}</span>
      <span class="health-bar__meta">模型 {{ form.availableModels.length }}</span>
      <span class="health-bar__meta">路由 {{ routingReadyCount }}/3</span>
      <span class="health-bar__meta">{{ adminAccessModeLabel }}</span>
      <el-button class="health-bar__action" type="primary" plain size="small" :loading="testing" @click="fetchModels">
        {{ connectionStatus === 'connected' ? '重新拉取' : '连接拉取' }}
      </el-button>
    </section>

    <div class="config-layout">
      <div class="config-main">
        <section class="config-section">
          <div class="config-section__head">
            <h2>接入与模型</h2>
            <div class="config-section__meta">
              <span class="section-meta">最近拉取 {{ lastFetchLabel }}</span>
              <span class="head-badge" :class="`head-badge--${connectionStepStatus.tone}`">{{ connectionStepStatus.label }}</span>
              <span class="head-badge" :class="`head-badge--${modelStepStatus.tone}`">{{ modelStepStatus.label }}</span>
            </div>
          </div>

          <el-form :model="form" label-position="top" class="config-form">
            <div class="field-grid field-grid--connect">
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

          <el-form :model="form" label-position="top" class="config-form">
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

            <div class="field-grid field-grid--three">
              <el-form-item label="对话默认">
                <el-select
                  v-model="form.defaultModel"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="对话默认模型"
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
                  placeholder="推理默认模型"
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
                  placeholder="评估默认模型"
                >
                  <el-option v-for="model in modelOptions" :key="`eval-${model}`" :label="model" :value="model" />
                </el-select>
              </el-form-item>
            </div>
          </el-form>

          <div v-if="testResult" class="issue-row" :class="testResult.connected ? 'issue-row--success' : 'issue-row--danger'">
            <span>{{ testResult.message }}</span>
          </div>
        </section>
      </div>

      <aside class="config-side">
        <section class="verify-card">
          <div class="config-section__head">
            <h2>连通性验证</h2>
            <span class="head-badge" :class="`head-badge--${modelTestTone}`">{{ modelTestStateLabel }}</span>
          </div>

          <el-form :model="modelTestForm" label-position="top" class="test-form">
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

            <div class="field-grid field-grid--two">
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
      </aside>
    </div>

    <section class="config-section config-section--full reliability-section">
      <div class="config-section__head">
        <div>
          <h2>AI 调用可靠性</h2>
          <p class="section-description">控制一次执行树的请求预算、重试恢复和默认超时。Skill 可单独收紧逻辑重试。</p>
        </div>
        <span class="head-badge" :class="reliabilityLoaded ? 'head-badge--info' : 'head-badge--danger'">
          {{ reliabilityLoaded ? '平台默认 · 热生效' : '设置暂不可用' }}
        </span>
      </div>

      <div class="reliability-grid">
        <article class="reliability-panel">
          <div class="reliability-panel__head">
            <div>
              <h3>执行预算</h3>
              <p>初次请求、Transport Retry 和 Logical Retry 共用同一预算。</p>
            </div>
            <span class="effective-value">最多 {{ reliability.maxUpstreamAttempts }} 次</span>
          </div>
          <el-form label-position="top" class="config-form config-form--tight">
            <el-form-item label="单次执行树最多 Provider 请求数">
              <el-input-number
                v-model="reliability.maxUpstreamAttempts"
                :min="1"
                :max="reliabilityHardLimits.maxUpstreamAttempts"
                :disabled="!reliabilityLoaded"
              />
              <div class="field-help">代码硬上限 {{ reliabilityHardLimits.maxUpstreamAttempts }} 次，所有重试都会消耗此预算。</div>
            </el-form-item>
            <el-form-item label="默认 Logical Retry">
              <el-input-number
                v-model="reliability.maxLogicalRetries"
                :min="0"
                :max="reliabilityHardLimits.maxLogicalRetries"
                :disabled="!reliabilityLoaded"
              />
              <div class="field-help">这是预算上限，仅在 Skill 已实现输出校验和修复提示时生效。</div>
            </el-form-item>
          </el-form>
        </article>

        <article class="reliability-panel">
          <div class="reliability-panel__head">
            <div>
              <h3>传输恢复</h3>
              <p>处理超时、临时网络错误、429 和部分 5xx。</p>
            </div>
            <span class="effective-value">最多 {{ effectiveTransportAttempts }} 次尝试</span>
          </div>
          <el-form label-position="top" class="config-form config-form--tight">
            <div class="field-grid field-grid--two">
              <el-form-item label="最大 Transport Retry">
                <el-input-number
                  v-model="reliability.maxTransportRetries"
                  :min="0"
                  :max="reliabilityHardLimits.maxTransportRetries"
                  :disabled="!reliabilityLoaded"
                />
              </el-form-item>
              <el-form-item label="默认单次请求超时">
                <el-input-number
                  v-model="reliability.defaultRequestTimeoutMs"
                  :min="reliabilityHardLimits.minRequestTimeoutMs"
                  :max="reliabilityHardLimits.maxRequestTimeoutMs"
                  :step="10000"
                  :disabled="!reliabilityLoaded"
                />
                <div class="field-help">毫秒，Skill 显式超时优先。硬上限 {{ reliabilityHardLimits.maxRequestTimeoutMs / 1000 }} 秒。</div>
              </el-form-item>
            </div>
            <div class="field-grid field-grid--two">
              <el-form-item label="初始 Backoff">
                <el-input-number
                  v-model="reliability.retryBaseDelayMs"
                  :min="reliabilityHardLimits.minRetryBaseDelayMs"
                  :max="reliabilityHardLimits.maxRetryBaseDelayMs"
                  :step="100"
                  :disabled="!reliabilityLoaded"
                />
              </el-form-item>
              <el-form-item label="Retry-After 自动等待上限">
                <el-input-number
                  v-model="reliability.maxRetryAfterMs"
                  :min="0"
                  :max="reliabilityHardLimits.maxRetryAfterMs"
                  :step="1000"
                  :disabled="!reliabilityLoaded"
                />
              </el-form-item>
            </div>
            <el-form-item label="随机抖动">
              <el-switch v-model="reliability.jitterEnabled" :disabled="!reliabilityLoaded" inline-prompt active-text="开启" inactive-text="关闭" />
              <div class="field-help">建议保持开启，避免多个请求同时重试形成流量尖峰。</div>
            </el-form-item>
          </el-form>
        </article>
      </div>

      <div class="reliability-invariants">
        <span>认证失败不重试</span>
        <span>额度耗尽不重试</span>
        <span>调用方取消不重试</span>
        <span>不会从用户 Provider 静默切换到平台 Provider</span>
      </div>
    </section>

    <section class="config-section config-section--full">
      <div class="config-section__head">
        <h2>网络边界</h2>
        <span class="head-badge head-badge--info">{{ policySourceLabel }}</span>
      </div>

      <div class="policy-grid">
        <article class="policy-panel">
          <h3>Admin 访问范围</h3>
          <el-radio-group v-model="networkPolicy.adminAccessMode" class="mode-grid">
            <el-radio-button value="loopback">
              <span class="mode-option"><strong>仅本机</strong><small>127.0.0.1 / ::1</small></span>
            </el-radio-button>
            <el-radio-button value="private">
              <span class="mode-option"><strong>本机 + 局域网</strong><small>推荐</small></span>
            </el-radio-button>
            <el-radio-button value="any">
              <span class="mode-option"><strong>不限制来源</strong><small>需配合网关</small></span>
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
                placeholder="精确 IP，如 203.0.113.10"
              />
            </el-form-item>
          </el-form>
        </article>

        <article class="policy-panel policy-panel--network">
          <div class="policy-panel__head policy-panel__head--switch">
            <h3>私有网络服务</h3>
            <el-switch
              v-model="networkPolicy.allowPrivateNetwork"
              inline-prompt
              active-text="开启"
              inactive-text="关闭"
              size="large"
            />
          </div>

          <el-form label-position="top" class="config-form config-form--tight">
            <el-form-item label="Host / IP 白名单">
              <el-select
                v-model="networkPolicy.privateNetworkHosts"
                multiple
                filterable
                allow-create
                default-first-option
                :disabled="networkPolicy.allowPrivateNetwork"
                :placeholder="networkPolicy.allowPrivateNetwork ? '已允许全部私有地址' : '如 192.168.31.26 或 ollama.local'"
              />
            </el-form-item>
          </el-form>
        </article>
      </div>

      <div v-if="networkPolicy.adminAccessMode === 'any'" class="issue-row issue-row--danger">
        Admin 已允许公网来源。请确认前方存在 VPN、访问网关或防火墙白名单。
      </div>
    </section>

    <!-- AI 能力探测开关 -->
    <section class="config-section config-section--full">
      <div class="config-section__head">
        <h2>AI 能力探测</h2>
        <span class="head-badge head-badge--info">{{ capabilityProbe.enabled ? '已开启' : '已关闭' }}</span>
      </div>

      <article class="policy-panel policy-panel--network">
        <div class="policy-panel__head policy-panel__head--switch">
          <h3>定期探活请求</h3>
          <el-switch
            v-model="capabilityProbe.enabled"
            inline-prompt
            active-text="开启"
            inactive-text="关闭"
            size="large"
            :disabled="!capabilityProbe.loaded"
          />
        </div>
        <p class="policy-panel__desc">
          开启后，后端每隔约 2 分钟向已配置的模型服务发送一次极简探活请求
          （单次约 15 个输入 token），用于实时判断 5 条核心学习链路（目标对话、
          路径规划、阶段设计、教学回合、阶段收尾）的路由可用性，并在连接与安全
          页的健康状态条上反映结果。
        </p>
        <p class="policy-panel__desc policy-panel__desc--muted">
          关闭后将完全停止周期性 LLM 探活请求，可节省少量模型调用开销；
          但健康状态条会停留在最后一次探测结果，直到再次开启或手动刷新。
        </p>
      </article>
    </section>

    <!-- 未保存变更条：dirty 时浮现于视口底部 -->
    <transition name="save-bar">
      <div v-if="dirtyCount > 0" class="save-bar" role="status">
        <span class="save-bar__dot"></span>
        <span class="save-bar__text">有 {{ dirtyCount }} 项未保存变更</span>
        <div class="save-bar__actions">
          <el-button @click="discardChanges" :disabled="saving">放弃变更</el-button>
          <el-button type="primary" @click="saveAll" :loading="saving">保存变更</el-button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { Setting } from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';
import { adminApiConfigApi, adminPlatformSettingsApi, adminCapabilityProbeApi } from '@/api/adminApi';
import AdminPageHeader from './components/AdminPageHeader.vue';
import { toast } from '../../utils/toast';

const loading = ref(false);
const loadError = ref('');
const saving = ref(false);
const testing = ref(false);
const reliabilityLoaded = ref(false);
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

const reliability = reactive({
  maxUpstreamAttempts: 3,
  maxTransportRetries: 1,
  maxLogicalRetries: 1,
  defaultRequestTimeoutMs: 300000,
  retryBaseDelayMs: 1000,
  maxRetryAfterMs: 10000,
  jitterEnabled: true
});

const capabilityProbe = reactive({
  enabled: true,
  loaded: false,
  lastPersistedEnabled: true
});

const reliabilityHardLimits = reactive({
  maxUpstreamAttempts: 5,
  maxTransportRetries: 2,
  maxLogicalRetries: 2,
  minRequestTimeoutMs: 10000,
  maxRequestTimeoutMs: 300000,
  minRetryBaseDelayMs: 100,
  maxRetryBaseDelayMs: 5000,
  maxRetryAfterMs: 10000
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

// 默认路由完成度（对话/推理/评估 三项）
const routingReadyCount = computed(() =>
  [form.defaultModel, form.defaultReasoningModel, form.defaultEvaluationModel].filter(Boolean).length
)

// 01 接入与密钥 状态徽章
const connectionStepStatus = computed(() => {
  if (connectionStatus.value === 'connected') return { tone: 'success', label: connectionStateLabel.value }
  if (connectionStatus.value === 'failed') return { tone: 'danger', label: connectionStateLabel.value }
  return { tone: 'neutral', label: '待配置' }
})

// 02 模型与路由 状态徽章
const modelStepStatus = computed(() => {
  if (form.availableModels.length > 0) return { tone: 'success', label: `${form.availableModels.length} 个可用模型` }
  return { tone: 'neutral', label: '未拉取' }
})

// 整体健康结论：单行状态条只取一句标题
const overallHealth = computed(() => {
  if (connectionStatus.value === 'failed') {
    return { tone: 'danger', title: '模型服务连接失败' }
  }
  if (!form.apiUrl && !form.apiKeyConfigured) {
    return { tone: 'neutral', title: '尚未接入模型服务' }
  }
  const ready = connectionStatus.value === 'connected'
    && form.availableModels.length > 0
    && routingReadyCount.value === 3
  return ready
    ? { tone: 'success', title: '模型服务已就绪' }
    : { tone: 'warning', title: '配置尚未完成' }
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
const effectiveTransportAttempts = computed(() => Math.min(
  reliability.maxUpstreamAttempts,
  reliability.maxTransportRetries + 1
))

/* ---------- 未保存变更追踪 ----------
   快照对比：加载/保存成功后记录基线，逐字段计数，
   底部保存条仅在 dirty 时浮现 */
const savedSnapshot = ref('')

const currentConfigSnapshot = computed(() => JSON.stringify({
  apiUrl: form.apiUrl,
  apiKeyChanged: form.apiKeyInput.length > 0,
  availableModels: form.availableModels,
  defaultModel: form.defaultModel,
  defaultReasoningModel: form.defaultReasoningModel,
  defaultEvaluationModel: form.defaultEvaluationModel,
  adminAccessMode: networkPolicy.adminAccessMode,
  adminAllowedIps: networkPolicy.adminAllowedIps,
  allowPrivateNetwork: networkPolicy.allowPrivateNetwork,
  privateNetworkHosts: networkPolicy.privateNetworkHosts,
  maxUpstreamAttempts: reliability.maxUpstreamAttempts,
  maxTransportRetries: reliability.maxTransportRetries,
  maxLogicalRetries: reliability.maxLogicalRetries,
  defaultRequestTimeoutMs: reliability.defaultRequestTimeoutMs,
  retryBaseDelayMs: reliability.retryBaseDelayMs,
  maxRetryAfterMs: reliability.maxRetryAfterMs,
  jitterEnabled: reliability.jitterEnabled,
  capabilityProbeEnabled: capabilityProbe.enabled
}))

const dirtyCount = computed(() => {
  if (!savedSnapshot.value) return 0
  try {
    const saved = JSON.parse(savedSnapshot.value) as Record<string, unknown>
    const current = JSON.parse(currentConfigSnapshot.value) as Record<string, unknown>
    return Object.keys(current).filter((key) => JSON.stringify(current[key]) !== JSON.stringify(saved[key])).length
  } catch {
    return 0
  }
})

// 放弃变更 = 重新拉取服务端配置（同时重置快照）
async function discardChanges() {
  await loadConfig()
  toast.success('已放弃未保存的变更')
}

async function loadConfig() {
  loading.value = true;
  loadError.value = '';
  reliabilityLoaded.value = false;
  try {
    const [configResult, reliabilityResult, probeResult] = await Promise.allSettled([
      adminApiConfigApi.getConfig(),
      adminPlatformSettingsApi.getReliabilitySettings(),
      adminCapabilityProbeApi.getSettings()
    ]);
    if (configResult.status === 'rejected') throw configResult.reason;
    const response = configResult.value;
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
    if (reliabilityResult.status === 'fulfilled') {
      const reliabilityData = reliabilityResult.value.data?.data || {};
      Object.assign(reliability, reliabilityData.settings || {});
      Object.assign(reliabilityHardLimits, reliabilityData.hardLimits || {});
      reliabilityLoaded.value = true;
    } else {
      loadError.value = '连接配置已加载，但 AI 可靠性设置暂时不可用';
    }
    if (probeResult.status === 'fulfilled') {
      const probeData = probeResult.value.data?.data || {};
      capabilityProbe.enabled = probeData.enabled !== false;
      capabilityProbe.lastPersistedEnabled = capabilityProbe.enabled;
      capabilityProbe.loaded = true;
    } else {
      loadError.value = loadError.value || '连接配置已加载，但 AI 能力探测设置暂时不可用';
    }
    // 记录基线快照，用于未保存变更计数
    await nextTick();
    savedSnapshot.value = currentConfigSnapshot.value;
  } catch (error) {
    const err = error as { response?: { data?: { error?: { message?: unknown } } } } | null;
    const backendMessage = err?.response?.data?.error?.message;
    loadError.value = typeof backendMessage === 'string' && backendMessage ? backendMessage : '无法获取配置数据，请检查服务连接后重试。';
    toast.error('加载 API 配置失败');
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

async function saveReliabilitySettings() {
  if (!reliabilityLoaded.value) return false;
  await adminPlatformSettingsApi.updateReliabilitySettings({ ...reliability });
  return true;
}

async function saveCapabilityProbe() {
  if (!capabilityProbe.loaded) return false;
  if (capabilityProbe.enabled === capabilityProbe.lastPersistedEnabled) return false;
  const resp = await adminCapabilityProbeApi.updateSettings(capabilityProbe.enabled);
  const data = resp.data?.data;
  if (data && typeof data.enabled === 'boolean') {
    capabilityProbe.lastPersistedEnabled = data.enabled;
  }
  return true;
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
  let savedSections = 0;
  try {
    await saveConnectionConfig();
    savedSections += 1;
    await saveNetworkPolicy();
    savedSections += 1;
    const reliabilitySaved = await saveReliabilitySettings();
    if (reliabilitySaved) savedSections += 1;
    const probeSaved = await saveCapabilityProbe();
    if (probeSaved) savedSections += 1;
    toast.success(reliabilitySaved
      ? '连接与安全配置已保存'
      : '连接与网络配置已保存；可靠性设置未加载，已跳过');
    await loadConfig();
  } catch (error: any) {
    const message = error.response?.data?.error?.message || error.response?.data?.error || error.message || '保存配置失败';
    toast.error(savedSections > 0 ? `部分配置已保存，已重新加载服务端状态：${message}` : message);
    await loadConfig();
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
.config-load-error__retry {
  margin-left: 12px;
}

.api-config-page {
  display: grid;
  gap: 18px;
}

/* ---------- 健康状态条（单行） ---------- */
.health-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: var(--admin-radius-md);
  border: 1px solid rgba(223, 231, 243, 0.92);
  background: rgba(248, 250, 255, 0.88);
  flex-wrap: wrap;
}

.health-bar__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}

.health-bar--success .health-bar__dot { background: var(--admin-color-success); }
.health-bar--warning .health-bar__dot { background: var(--admin-color-warning); }
.health-bar--danger .health-bar__dot { background: var(--admin-color-error); }
.health-bar--neutral .health-bar__dot { background: var(--admin-color-neutral); }

.health-bar__title {
  font-size: var(--admin-text-body);
  color: var(--admin-text-primary);
  font-weight: 700;
}

.health-bar__sep {
  width: 1px;
  height: 14px;
  background: rgba(223, 231, 243, 0.92);
}

.health-bar__meta {
  font-size: var(--admin-text-body-sm);
  color: var(--admin-text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.health-bar__action {
  margin-left: auto;
}

/* ---------- 紧凑分区 ---------- */
.config-section {
  display: grid;
  gap: 14px;
  padding: 14px 0 18px;
  border-bottom: 1px solid rgba(223, 231, 243, 0.92);
}

.config-section:last-child {
  border-bottom: none;
}

/* 接入字段：地址宽、密钥窄 */
.field-grid--connect {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 12px;
}

/* 全宽区块（网络边界） */
.config-section--full {
  margin-top: 4px;
}

.config-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.config-section__head h2 {
  margin: 0;
  color: var(--admin-text-primary);
  font-size: var(--admin-text-title-sm);
  font-weight: 700;
}

.config-section__meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* ---------- 左主右辅布局 ---------- */
.config-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 380px);
  gap: 24px;
  align-items: start;
}

.config-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.config-side {
  position: sticky;
  top: 16px;
  min-width: 0;
}

.verify-card {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: var(--admin-border-subtle);
  border-radius: var(--admin-radius-md);
  background: var(--admin-bg-surface-alt);
}

.section-description {
  margin: 5px 0 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-text-body-sm);
  line-height: 1.55;
}

.reliability-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.82fr) minmax(0, 1.18fr);
  gap: 14px;
}

.reliability-panel {
  display: grid;
  align-content: start;
  gap: 18px;
  padding: 18px;
  border: 1px solid rgba(211, 221, 237, 0.94);
  border-radius: 18px;
  background: rgba(250, 252, 255, 0.92);
}

.reliability-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.reliability-panel h3 {
  margin: 0;
  color: var(--admin-text-primary);
  font-size: var(--admin-text-body);
}

.reliability-panel p {
  margin: 5px 0 0;
  color: var(--admin-text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.effective-value {
  flex-shrink: 0;
  padding: 5px 9px;
  border-radius: var(--admin-radius-pill);
  background: rgba(52, 120, 246, 0.09);
  color: #295bd2;
  font-size: 12px;
  font-weight: 800;
}

.field-help {
  margin-top: 5px;
  color: var(--admin-text-muted);
  font-size: 11px;
  line-height: 1.55;
}

.reliability-invariants {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.reliability-invariants span {
  padding: 6px 10px;
  border: 1px solid rgba(211, 221, 237, 0.94);
  border-radius: var(--admin-radius-pill);
  color: var(--admin-text-secondary);
  background: var(--admin-bg-surface-alt);
  font-size: 12px;
}

/* ---------- 未保存变更条 ---------- */
.save-bar {
  position: sticky;
  bottom: 16px;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  margin: 8px auto 0;
  padding: 10px 12px 10px 18px;
  border-radius: var(--admin-radius-pill);
  border: 1px solid rgba(52, 120, 246, 0.24);
  background: var(--admin-bg-surface);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
}

.save-bar__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--admin-color-warning);
  flex-shrink: 0;
}

.save-bar__text {
  font-size: var(--admin-text-body-sm);
  font-weight: 600;
  color: var(--admin-text-primary);
  white-space: nowrap;
}

.save-bar__actions {
  display: flex;
  gap: 8px;
  margin-left: 8px;
}

.save-bar-enter-active,
.save-bar-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.save-bar-enter-from,
.save-bar-leave-to {
  opacity: 0;
  transform: translateY(12px);
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
  font-size: var(--admin-text-title);
  font-weight: 800;
  letter-spacing: -0.02em;
}

.flow-section__head p {
  margin: 6px 0 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-text-body);
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
  color: var(--admin-text-muted);
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

.policy-panel h3 {
  margin: 0;
  color: var(--admin-text-primary);
  font-size: var(--admin-text-body);
  font-weight: 700;
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

.mode-option small {
  color: #7b8ba3;
  font-size: var(--admin-text-micro);
  line-height: 1.45;
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
  font-size: var(--admin-text-micro);
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
  border-radius: var(--admin-radius-sm);
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
  .config-layout {
    grid-template-columns: 1fr;
  }

  .config-side {
    position: static;
  }

  .field-grid--three,
  .field-grid--test {
    grid-template-columns: 1fr;
  }

  .policy-grid {
    grid-template-columns: 1fr;
  }

  .reliability-grid {
    grid-template-columns: 1fr;
  }

  .terminal-meta-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .health-bar__action {
    margin-left: 0;
    width: 100%;
  }

  .field-grid--two {
    grid-template-columns: 1fr;
  }

  .mode-grid {
    grid-template-columns: 1fr;
  }
}
</style>
