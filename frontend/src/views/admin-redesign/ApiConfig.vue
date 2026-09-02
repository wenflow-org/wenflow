<template>
  <div class="mk-page">
    <!-- 单行健康条 -->
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">模型与接入</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">密钥：{{ keySet ? '已配置' : '未配置' }}</span>
      <span class="mk-status__meta">模型：{{ models.length || '待拉取' }}</span>
      <span class="mk-status__meta">路由：{{ routeCount }}/3</span>
      <span v-if="isLive && lastCheckedText" class="mk-status__meta">上次探测：{{ lastCheckedText }}</span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" :disabled="fetching || !form.apiUrl" @click="fetchModels">
          <span v-if="fetching"><span class="mk-spinner"></span> 拉取中…</span>
          <span v-else>{{ models.length ? '重新拉取' : '连接并拉取' }}</span>
        </button>
      </span>
    </div>


    <!-- 接入与模型（全宽：连接 → 模型/路由 → 连通性验证） -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">接入与模型</h3>
        <span class="mk-badge" :class="connBadge.cls">{{ connBadge.text }}</span>
      </div>
      <div class="ac-body">
        <div class="ac-row ac-row--2-1">
          <label class="mk-field mk-field--row">
            <span>服务地址</span>
            <input class="mk-filter__input" v-model="form.apiUrl" placeholder="https://api.example.com/v1" @input="markDirty('conn')" />
          </label>
          <label class="mk-field mk-field--row">
            <span>API Key</span>
            <span class="ac-key-wrap">
              <span class="ac-key-input-row">
                <input
                  class="mk-filter__input"
                  :type="keyVisible ? 'text' : 'password'"
                  v-model="form.apiKey"
                  :placeholder="keySet ? '已配置，留空沿用' : '输入 API Key'"
                  @input="markDirty('conn')"
                />
                <button
                  v-if="keySet || form.apiKey"
                  type="button"
                  class="ac-key-toggle"
                  :title="keyVisible ? '隐藏' : '显示'"
                  @click="keyVisible = !keyVisible"
                ><svg v-if="keyVisible" viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>
                  <svg v-else viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg></button>
              </span>
              <em v-if="keyHintNeeded" class="ac-keyhint">⚠ 更换服务地址需重新输入密钥</em>
            </span>
          </label>
        </div>
        <label class="mk-field">
          <span>可用模型</span>
          <div class="ac-models">
            <span v-for="m in models" :key="m" class="ac-model">{{ m }}</span>
            <span v-if="!models.length" class="mk-na">尚未拉取模型</span>
          </div>
        </label>
        <div class="ac-row ac-row--3">
          <label class="mk-field">
            <span>对话默认</span>
            <select class="mk-filter__select" v-model="form.defaultModel" :disabled="!models.length" @change="markDirty('route')">
              <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
              <option v-if="!models.length" value="">未设置</option>
            </select>
          </label>
          <label class="mk-field">
            <span>推理默认</span>
            <select class="mk-filter__select" v-model="form.defaultReasoningModel" :disabled="!models.length" @change="markDirty('route')">
              <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
              <option v-if="!models.length" value="">未设置</option>
            </select>
          </label>
          <label class="mk-field">
            <span>评估默认</span>
            <select class="mk-filter__select" v-model="form.defaultEvaluationModel" :disabled="!models.length" @change="markDirty('route')">
              <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
              <option v-if="!models.length" value="">未设置</option>
            </select>
          </label>
        </div>
      </div>

      <!-- 连通性验证（并入本卡，横向操作） -->
      <div class="ac-test">
        <label class="mk-field mk-field--row ac-test__model">
          <span>测试模型</span>
          <select class="mk-filter__select" v-model="testModel" :disabled="!models.length">
            <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
            <option v-if="!models.length" value="">无可用模型</option>
          </select>
        </label>
        <button type="button" class="mk-btn mk-btn--primary" :disabled="!models.length || testing" @click="runTest">
          <span v-if="testing"><span class="mk-spinner"></span> 测试中…</span>
          <span v-else>运行测试</span>
        </button>
        <span
          v-if="testResult"
          class="mk-badge"
          :class="testResult.ok ? 'mk-badge--ok' : 'mk-badge--bad'"
        >{{ testResult.ok ? '测试通过' : '测试失败' }}</span>
        <span v-if="testResult" class="ac-test__meta mono">{{ testResult.latency || '—' }}{{ testResult.usage ? ` · ${testResult.usage}` : '' }}</span>
        <span v-if="testResult" class="ac-test__text" :class="{ 'ac-test__text--bad': !testResult.ok }">「{{ testResult.text }}」</span>
      </div>
    </section>

    <!-- 安全与访问（全宽，三栏） -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">安全与访问</h3>
        <span class="mk-badge mk-badge--info">平台策略 · 热生效</span>
      </div>
      <div class="ac-policy ac-policy--3">
        <div class="ac-policy__item">
          <span class="ac-policy__label">Admin 访问范围</span>
          <div class="ac-seg">
            <button
              v-for="opt in accessOptions"
              :key="opt.id"
              type="button"
              class="ac-seg__item"
              :class="{ 'ac-seg__item--active': policy.adminAccessMode === opt.id }"
              @click="policy.adminAccessMode = opt.id; markDirty('policy')"
            >
              {{ opt.label }}
            </button>
          </div>
          <span v-if="policy.adminAccessMode === 'any'" class="ac-policy__warn">⚠ 公网开放 · 入口无访问限制</span>
          <label v-if="policy.adminAccessMode === 'private'" class="mk-field">
            <span>额外允许的客户端 IP（每行一个，可留空）</span>
            <textarea
              class="mk-filter__input ac-textarea"
              rows="2"
              :value="policy.adminAllowedIps.join('\n')"
              @input="policy.adminAllowedIps = splitLines(($event.target as HTMLTextAreaElement).value); markDirty('policy')"
              placeholder="203.0.113.10"
            ></textarea>
          </label>
        </div>
        <div class="ac-policy__item">
          <span class="ac-policy__label">私有网络服务</span>
          <div class="ac-seg">
            <button
              type="button"
              class="ac-seg__item"
              :class="{ 'ac-seg__item--active': policy.allowPrivateNetwork }"
              @click="policy.allowPrivateNetwork = true; markDirty('policy')"
            >
              允许
            </button>
            <button
              type="button"
              class="ac-seg__item"
              :class="{ 'ac-seg__item--active': !policy.allowPrivateNetwork }"
              @click="policy.allowPrivateNetwork = false; markDirty('policy')"
            >
              仅白名单
            </button>
          </div>
          <label v-if="!policy.allowPrivateNetwork" class="mk-field">
            <span>允许的 Host / IP（每行一个）</span>
            <textarea
              class="mk-filter__input ac-textarea"
              rows="2"
              :value="policy.privateNetworkHosts.join('\n')"
              @input="policy.privateNetworkHosts = splitLines(($event.target as HTMLTextAreaElement).value); markDirty('policy')"
              placeholder="192.168.1.20"
            ></textarea>
          </label>
        </div>
        <!-- 新用户注册（live） -->
        <div v-if="isLive && registrationEnabled !== null" class="ac-policy__item">
          <span class="ac-policy__label">新用户注册</span>
          <span class="ac-policy__desc">{{ registrationEnabled ? '任何人可注册' : '仅管理员创建' }}</span>
          <button
            type="button"
            class="ac-seg__item ac-policy__toggle"
            :class="{ 'ac-seg__item--active': true }"
            :disabled="registrationBusy"
            @click="toggleRegistration"
          >
            {{ registrationBusy ? '切换中…' : registrationEnabled ? '关闭注册' : '开放注册' }}
          </button>
        </div>
      </div>
    </section>

    <!-- AI 调用与健康（全宽分区：可靠性 → 探测 → 健康） -->
    <section v-if="isLive && (reliability || probe.loaded || configLoadFailed)" class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">AI 调用与健康</h3>
        <span class="mk-badge" :class="healthBadgeCls">{{ healthLabel }}</span>
      </div>

      <div v-if="configLoadFailed && !reliability && !probe.loaded" class="ac-config-error" role="alert">
        <span>配置读取失败</span>
        <button type="button" class="mk-link" @click="retryConfigLoad">重试</button>
      </div>

      <!-- 两列：左 = 调用参数，右 = 能力健康 -->
      <div class="ac-cols">
        <!-- 左列：调用参数（重试 / 超时 / 探测 分组） -->
        <div v-if="reliability || probe.loaded" class="ac-cols__main">
          <div class="ac-sec__title">调用参数</div>
          <div class="ac-groups">
            <div v-if="reliability" class="ac-group">
              <div class="ac-group__title">重试</div>
              <div class="ac-group__fields">
                <label class="mk-field">
                  <span>上游最大尝试</span>
                  <input v-model.number="reliability.maxUpstreamAttempts" type="number" min="1" max="10" class="mk-filter__input" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field">
                  <span>传输重试</span>
                  <input v-model.number="reliability.maxTransportRetries" type="number" min="0" max="5" class="mk-filter__input" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field">
                  <span>逻辑重试</span>
                  <input v-model.number="reliability.maxLogicalRetries" type="number" min="0" max="5" class="mk-filter__input" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field">
                  <span>退避基数（毫秒）</span>
                  <input v-model.number="reliability.retryBaseDelayMs" type="number" min="100" step="100" class="mk-filter__input" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field">
                  <span>Retry-After 上限（毫秒）</span>
                  <input v-model.number="reliability.maxRetryAfterMs" type="number" min="1000" step="1000" class="mk-filter__input" @input="markDirty('reliability')" />
                </label>
                <label class="mk-field mk-field--switch">
                  <span>随机抖动</span>
                  <span class="ac-switch">
                    <input type="checkbox" v-model="reliability.jitterEnabled" @change="markDirty('reliability')" />
                    <i aria-hidden="true"></i>
                  </span>
                </label>
              </div>
            </div>
            <div v-if="reliability" class="ac-group">
              <div class="ac-group__title">超时</div>
              <div class="ac-group__fields">
                <label class="mk-field">
                  <span>单次超时（毫秒）</span>
                  <input v-model.number="reliability.defaultRequestTimeoutMs" type="number" min="1000" step="1000" class="mk-filter__input" @input="markDirty('reliability')" />
                </label>
              </div>
            </div>
            <div v-if="probe.loaded" class="ac-group">
              <div class="ac-group__title">探测</div>
              <div class="ac-group__fields">
                <label class="mk-field mk-field--switch">
                  <span>定期探活</span>
                  <span class="ac-switch">
                    <input type="checkbox" v-model="probe.enabled" @change="markDirty('probe')" />
                    <i aria-hidden="true"></i>
                  </span>
                </label>
                <label class="mk-field">
                  <span>探测间隔（秒）</span>
                  <input
                    v-model.number="probe.intervalSec"
                    type="number"
                    :min="Math.ceil(probe.minIntervalMs / 1000)"
                    :max="Math.floor(probe.maxIntervalMs / 1000)"
                    step="30"
                    class="mk-filter__input"
                    :disabled="!probe.enabled"
                    @input="markDirty('probe')"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- 右列：能力健康 -->
        <div v-if="isLive" class="ac-cols__side">
          <div class="ac-sec__title">
            能力健康
            <span v-if="healthSummaryText" class="mk-badge" :class="healthSummaryBadge">{{ healthSummaryText }}</span>
            <span class="ac-sec__sub">
              <span v-if="health?.stale" class="ac-health__stale">上次探测 {{ timeAgo(health.checkedAt) }} · 快照已过期</span>
              <span v-else-if="health?.checkedAt" class="ac-health__stale">最近探测 {{ timeAgo(health.checkedAt) }}</span>
              <span v-else-if="health" class="ac-health__stale">尚未探测</span>
            </span>
          </div>
          <div v-if="health" class="ac-health">
            <div class="ac-health__head" aria-hidden="true">
              <span></span>
              <span>能力</span>
              <span>信息</span>
              <span>响应</span>
              <span>最近探测</span>
            </div>
            <div v-for="c in health.capabilities" :key="c.id" class="ac-health__row">
              <span class="ac-health__dot" :class="`is-${c.status}`"></span>
              <span class="ac-health__id mono">{{ c.id }}</span>
              <span class="ac-health__msg">{{ c.message }}</span>
              <span class="ac-health__lat mono">{{ c.latencyMs != null ? `${c.latencyMs}ms` : '—' }}</span>
              <span class="ac-health__time">{{ c.checkedAt ? timeAgo(c.checkedAt) : '未探测' }}</span>
            </div>
          </div>
          <div v-else-if="healthFailed" class="ac-rel__note ac-rel__error">
            健康快照不可用
            <button type="button" class="mk-link" :disabled="healthProbing" @click="probeHealth">{{ healthProbing ? '探测中…' : '重试' }}</button>
          </div>
          <p v-else class="ac-rel__note">健康快照加载中…</p>
          <div class="ac-health__foot">
            <button type="button" class="mk-status__action" :class="{ 'ac-probe--alert': health?.stale && !probe.enabled }" :disabled="healthProbing" @click="probeHealth">
              {{ healthProbing ? '探测中…' : '立即探测' }}
            </button>
            <span v-if="health?.stale && probe.loaded && !probe.enabled" class="ac-health__stale">定期探活未开启 · 探测后 5 分钟将再次过期</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 保存条：脏位分域标注（连接/路由/策略/可靠性/探测） -->
    <div v-if="dirty.size > 0" class="ac-save">
      <span class="ac-save__dot"></span>
      <span>{{ dirtyGroups.join(' + ') }} · {{ dirty.size }} 组未保存变更</span>
      <button type="button" class="mk-link" :disabled="saving" @click="discardAll">放弃</button>
      <button type="button" class="ac-save__primary" :disabled="saving" @click="saveAll">
        {{ saving ? '保存中…' : '保存变更' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { dataSource, isLive } from './store'
import {
  liveApiConfig as cfg,
  liveFetchModels,
  liveSaveApiConfig,
  liveRunModelTest,
  liveSaveNetworkPolicy,
  timeAgo,
  errMsg
} from './live'
import { adminPlatformSettingsApi, adminCapabilityProbeApi, adminSystemApi } from '@/api/adminApi'
import { registrationEnabled, updateRegistrationSetting } from './live'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'

/* ---------- AI 能力健康快照 ---------- */
interface CapHealth {
  id: string
  status: 'operational' | 'degraded' | 'unavailable' | 'unknown'
  checkedAt: string | null
  latencyMs: number | null
  message: string
}
interface CapSnapshot {
  overall: CapHealth['status']
  checkedAt: string | null
  stale: boolean
  capabilities: CapHealth[]
}
const health = ref<CapSnapshot | null>(null)
const healthFailed = ref(false)
const healthProbing = ref(false)

/** 汇总角标：「5 能力 · 1 异常」——异常 = degraded/unavailable；unknown 归「待确认」，不假装实时 */
const healthSummaryText = computed(() => {
  const caps = health.value?.capabilities ?? []
  if (!caps.length) return ''
  const abnormal = caps.filter((c) => c.status === 'unavailable' || c.status === 'degraded').length
  const unknown = caps.filter((c) => c.status === 'unknown').length
  if (abnormal > 0) return `${caps.length} 能力 · ${abnormal} 异常`
  if (unknown > 0) return `${caps.length} 能力 · ${unknown} 待确认`
  return `${caps.length} 能力 · 全部正常`
})
const healthSummaryBadge = computed(() => {
  const caps = health.value?.capabilities ?? []
  if (!caps.length) return 'mk-badge--muted'
  if (caps.some((c) => c.status === 'unavailable')) return 'mk-badge--bad'
  if (caps.some((c) => c.status === 'degraded')) return 'mk-badge--warn'
  if (caps.some((c) => c.status === 'unknown')) return 'mk-badge--muted'
  return 'mk-badge--ok'
})

/** 同页时间源统一：状态条「上次探测」与能力行「最近探测」同源（健康快照 checkedAt），
    DB lastCheckedAt 仅在快照不可用时兜底——消除「8 分钟前 vs 9 小时前」双写分叉 */
const lastCheckedText = computed(() => {
  if (health.value?.checkedAt) return timeAgo(health.value.checkedAt)
  if (cfg.value?.lastCheckedAt) return timeAgo(cfg.value.lastCheckedAt)
  return ''
})

const healthLabel = computed(
  () =>
    ({ operational: '全部正常', degraded: '部分降级', unavailable: '存在不可用', unknown: '状态确认中' })[
      health.value?.overall || 'unknown'
    ]
)
const healthBadgeCls = computed(
  () =>
    ({
      operational: 'mk-badge--ok',
      degraded: 'mk-badge--warn',
      unavailable: 'mk-badge--bad',
      unknown: 'mk-badge--muted',
      '': 'mk-badge--muted',
    } as Record<string, string>)[health.value?.overall || '']
)

/** 页面进入自动探测（方案 c）：组件挂载期间快照过期时自动补一次探测，避免「已过期」常驻；
    只自动一次（避免 deep watch 重复触发烧 LLM 调用），重新进入页面（重新挂载）再触发 */
let autoProbeDone = false
async function loadHealth() {
  try {
    const res = await adminSystemApi.getCapabilities()
    health.value = res.data?.data ?? res.data ?? null
    healthFailed.value = false
    if (health.value?.stale && !autoProbeDone) {
      autoProbeDone = true
      void probeHealth()
    }
  } catch {
    // 失败标记不可用（不再显示永久的「加载中…」），保留旧快照供重试后对比
    healthFailed.value = true
  }
}

async function probeHealth() {
  if (healthProbing.value) return
  healthProbing.value = true
  try {
    const res = await adminSystemApi.probeCapabilities()
    health.value = res.data?.data ?? res.data ?? null
    healthFailed.value = false
  } catch {
    healthFailed.value = true
  } finally {
    healthProbing.value = false
  }
}

/* ---------- 表单状态（live 一套交互） ---------- */
const form = reactive({
  apiUrl: '',
  apiKey: '',
  defaultModel: '',
  defaultReasoningModel: '',
  defaultEvaluationModel: ''
})
const policy = reactive({
  adminAccessMode: 'private' as 'loopback' | 'private' | 'any',
  adminAllowedIps: [] as string[],
  allowPrivateNetwork: true,
  privateNetworkHosts: [] as string[]
})
const fetchedModels = ref<string[]>([])
const keySet = ref(false)
const keyVisible = ref(false)
const connectionStatus = ref('unknown')
/** 曾成功拉取过模型列表（含从已保存配置载入）：此后提交才携带 availableModels，避免空数组清空后端列表 */
const modelsFetchedOnce = ref(false)
/** 已保存的服务地址：endpoint 被改动且 Key 留空时提示重新输入密钥 */
const savedApiUrl = ref('')

const dirty = ref<Set<string>>(new Set())
function markDirty(group: string) {
  dirty.value = new Set([...dirty.value, group])
}

/** 脏位分域标注：5 组 → 保存条列出具体未保存组（连接/路由/策略/可靠性/探测） */
const DIRTY_GROUP_LABELS: Record<string, string> = {
  conn: '连接',
  route: '路由',
  policy: '策略',
  reliability: '可靠性',
  probe: '探测'
}
const dirtyGroups = computed(() => [...dirty.value].map((g) => DIRTY_GROUP_LABELS[g] || g))

function splitLines(s: string): string[] {
  return s.split('\n').map((x) => x.trim()).filter(Boolean)
}

/* AI 可靠性（live 加载） */
interface Reliability {
  maxUpstreamAttempts: number
  maxTransportRetries: number
  maxLogicalRetries: number
  defaultRequestTimeoutMs: number
  retryBaseDelayMs: number
  maxRetryAfterMs: number
  jitterEnabled: boolean
}
const reliability = ref<Reliability | null>(null)
const configLoadFailed = ref(false)

const probe = reactive({
  enabled: false,
  intervalSec: 120,
  minIntervalMs: 10_000,
  maxIntervalMs: 86_400_000,
  loaded: false,
  lastEnabled: false,
  lastIntervalSec: 120
})

async function loadReliability() {
  try {
    const res = await adminPlatformSettingsApi.getReliabilitySettings()
    const s = res.data?.data?.settings ?? res.data?.data ?? {}
    reliability.value = {
      maxUpstreamAttempts: Number(s.maxUpstreamAttempts ?? 3),
      maxTransportRetries: Number(s.maxTransportRetries ?? 1),
      maxLogicalRetries: Number(s.maxLogicalRetries ?? 1),
      defaultRequestTimeoutMs: Number(s.defaultRequestTimeoutMs ?? 600000),
      retryBaseDelayMs: Number(s.retryBaseDelayMs ?? 2000),
      maxRetryAfterMs: Number(s.maxRetryAfterMs ?? 30000),
      jitterEnabled: s.jitterEnabled !== false
    }
    configLoadFailed.value = false
  } catch {
    reliability.value = null
    configLoadFailed.value = true
  }
}

async function loadProbe() {
  try {
    const res = await adminCapabilityProbeApi.getSettings()
    const d = res.data?.data ?? {}
    probe.enabled = d.enabled === true
    probe.lastEnabled = probe.enabled
    const ms = Number(d.intervalMs)
    probe.intervalSec = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 120
    probe.lastIntervalSec = probe.intervalSec
    if (typeof d.minIntervalMs === 'number') probe.minIntervalMs = d.minIntervalMs
    if (typeof d.maxIntervalMs === 'number') probe.maxIntervalMs = d.maxIntervalMs
    probe.loaded = true
    configLoadFailed.value = false
  } catch {
    probe.loaded = false
    configLoadFailed.value = true
  }
}

/** 配置域重试：重新拉取可靠性 + 探测设置 */
function retryConfigLoad() {
  void loadReliability()
  void loadProbe()
}

function applyLiveConfig() {
  if (!cfg.value) return
  form.apiUrl = cfg.value.apiUrl
  form.apiKey = ''
  form.defaultModel = cfg.value.defaultModel
  form.defaultReasoningModel = cfg.value.defaultReasoningModel
  form.defaultEvaluationModel = cfg.value.defaultEvaluationModel
  fetchedModels.value = [...cfg.value.availableModels]
  keySet.value = cfg.value.apiKeyConfigured
  connectionStatus.value = cfg.value.connectionStatus
  savedApiUrl.value = cfg.value.apiUrl
  modelsFetchedOnce.value = true
  Object.assign(policy, cfg.value.networkPolicy)
  dirty.value = new Set()
}

watch(
  () => [dataSource.value, cfg.value] as const,
  () => {
    applyLiveConfig()
    if (!reliability.value) void loadReliability()
    if (!probe.loaded) void loadProbe()
    void loadHealth()
  },
  { immediate: true, deep: true }
)

const models = computed(() => fetchedModels.value)
const ready = computed(() => keySet.value && models.value.length > 0 && !!form.defaultModel)
const routeCount = computed(() => [form.defaultModel, form.defaultReasoningModel, form.defaultEvaluationModel].filter(Boolean).length)
const statusTone = computed(() => {
  if (ready.value) return 'mk-status--ok'
  if (keySet.value) return 'mk-status--muted'
  return 'mk-status--warn'
})
const connBadge = computed(() => {
  if (connectionStatus.value === 'connected') return { cls: 'mk-badge--ok', text: '连接正常' }
  if (connectionStatus.value === 'failed') return { cls: 'mk-badge--bad', text: '上次连接失败' }
  return { cls: 'mk-badge--muted', text: ready.value ? '已配置' : '待配置' }
})

/** 已配置密钥但改了服务地址且 Key 留空：密钥不会随地址迁移，需提示重新输入 */
const keyHintNeeded = computed(
  () => keySet.value && !!form.apiUrl && form.apiUrl !== savedApiUrl.value && !form.apiKey.trim()
)

const accessOptions = [
  { id: 'loopback' as const, label: '仅本机' },
  { id: 'private' as const, label: '本机 + 局域网' },
  { id: 'any' as const, label: '不限制' }
]

/* ---------- 操作 ---------- */
const fetching = ref(false)
const testing = ref(false)
const saving = ref(false)
const testModel = ref('')
const testResult = ref<{ ok: boolean; text: string; latency?: string; usage?: string } | null>(null)

watch(models, (ms) => {
  if (ms.length && !ms.includes(testModel.value)) testModel.value = ms[0]
}, { immediate: true })

async function fetchModels() {
  if (fetching.value || !form.apiUrl) return
  fetching.value = true
  try {
    const list = await liveFetchModels(form.apiUrl, form.apiKey)
    fetchedModels.value = list
    modelsFetchedOnce.value = true
    connectionStatus.value = 'connected'
    markDirty('conn')
    toast.info(list.length ? `已获取 ${list.length} 个模型，记得保存` : '连接成功，但服务未返回模型列表')
  } catch (e) {
    connectionStatus.value = 'failed'
    toast.error(`连接失败：${errMsg(e)}`)
  } finally {
    fetching.value = false
  }
}

async function runTest() {
  if (testing.value || !testModel.value) return
  testing.value = true
  testResult.value = null
  const started = Date.now()
  try {
    const r = await liveRunModelTest({
      apiUrl: form.apiUrl,
      apiKey: form.apiKey,
      model: testModel.value,
      prompt: '用一句话介绍你自己。'
    })
    testResult.value = {
      ok: true,
      text: r.text.slice(0, 80),
      latency: r.latencyMs ? `${r.latencyMs}ms` : `${Date.now() - started}ms`,
      usage: r.usage
    }
  } catch (e) {
    testResult.value = { ok: false, text: errMsg(e).slice(0, 80) }
  } finally {
    testing.value = false
  }
}

async function saveAll() {
  if (saving.value) return
  // 高风险确认：开放公网访问需二次确认
  if (dirty.value.has('policy') && policy.adminAccessMode === 'any') {
    const ok = await askConfirm({
      title: '开放公网访问',
      message: '你正在将 Admin 后台开放到公网/任意来源访问。\n任何能访问该服务地址的人都能看到管理入口，请确认已了解风险。',
      confirmText: '确认开放'
    })
    if (!ok) return
  }
  saving.value = true
  try {
    if (dirty.value.has('conn') || dirty.value.has('route')) {
      const payload: {
        apiUrl: string
        apiKey: string
        defaultModel: string
        defaultReasoningModel: string
        defaultEvaluationModel: string
        availableModels?: string[]
      } = {
        apiUrl: form.apiUrl,
        apiKey: form.apiKey,
        defaultModel: form.defaultModel,
        defaultReasoningModel: form.defaultReasoningModel,
        defaultEvaluationModel: form.defaultEvaluationModel
      }
      // G5：从未成功拉取过模型时不提交 availableModels，避免空数组清空后端模型列表
      if (modelsFetchedOnce.value) payload.availableModels = fetchedModels.value
      await liveSaveApiConfig(payload as Parameters<typeof liveSaveApiConfig>[0])
    }
    if (dirty.value.has('policy')) {
      await liveSaveNetworkPolicy({ ...policy })
    }
    if (dirty.value.has('reliability') && reliability.value) {
      await adminPlatformSettingsApi.updateReliabilitySettings({ ...reliability.value })
    }
    if (dirty.value.has('probe') && probe.loaded) {
      const payload: { enabled?: boolean; intervalMs?: number } = {}
      if (probe.enabled !== probe.lastEnabled) payload.enabled = probe.enabled
      if (probe.intervalSec !== probe.lastIntervalSec) {
        payload.intervalMs = Math.round(probe.intervalSec * 1000)
      }
      if (Object.keys(payload).length) {
        const res = await adminCapabilityProbeApi.updateSettings(payload)
        const d = res.data?.data ?? {}
        if (typeof d.enabled === 'boolean') {
          probe.enabled = d.enabled
          probe.lastEnabled = d.enabled
        }
        if (typeof d.intervalMs === 'number') {
          probe.intervalSec = Math.round(d.intervalMs / 1000)
          probe.lastIntervalSec = probe.intervalSec
        }
      }
    }
    // L5：probe 未加载成功时保留其脏标记，避免静默丢弃用户改动
    dirty.value = new Set(dirty.value.has('probe') && !probe.loaded ? ['probe'] : [])
    toast.success('配置已保存并生效')
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    saving.value = false
  }
}

function discardAll() {
  applyLiveConfig()
  void loadReliability()
  void loadProbe()
  toast.info('已放弃未保存的变更')
}

/* 注册开关：高风险操作，二次确认 */
const registrationBusy = ref(false)
async function toggleRegistration() {
  if (registrationBusy.value || registrationEnabled.value === null) return
  const target = !registrationEnabled.value
  const ok = await askConfirm({
    title: target ? '开放注册' : '关闭注册',
    message: target
      ? '确认开放新用户自助注册？\n任何人都能通过注册页创建账号。'
      : '确认关闭新用户自助注册？\n关闭后新账号只能由管理员手动创建。',
    confirmText: target ? '开放注册' : '关闭注册',
    danger: target
  })
  if (!ok) return
  registrationBusy.value = true
  try {
    await updateRegistrationSetting(target)
    toast.success(target ? '注册已开放' : '注册已关闭，新账号只能由管理员创建')
  } catch (e) {
    // 失败回滚本地状态（updateRegistrationSetting 仅在成功后写回）
    registrationEnabled.value = !target
    toast.error(`切换失败：${errMsg(e)}`)
  } finally {
    registrationBusy.value = false
  }
}
</script>

<style scoped>
/* 内容区容器（对齐其他页面：mk-card__head + 内容区结构，不覆盖全局 .mk-card 盒模型） */
.ac-body { display: grid; gap: 14px; padding: 14px 16px; }
.ac-row { display: grid; gap: 12px; }
.ac-row--2-1 { grid-template-columns: 1.6fr 1fr; }
.ac-row--3 { grid-template-columns: repeat(3, 1fr); }
/* mk-field 已在 shared.css 定义；此处只补 mk-field 下 .mk-filter__input 的 100% 宽 */
.mk-field .mk-filter__input,
.mk-field .mk-filter__select { width: 100%; }
.ac-key-wrap { display: grid; gap: 4px; min-width: 0; }
.ac-key-input-row { display: flex; align-items: center; gap: 6px; }
.ac-key-input-row .mk-filter__input { flex: 1; min-width: 0; }
.ac-key-toggle {
  flex-shrink: 0;
  border: 1px solid var(--mk-line);
  background: #fafbfc;
  border-radius: 8px;
  width: 32px;
  height: 32px;
  font-size: var(--mk-fs-14);
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.ac-key-toggle:hover { background: #eef5ff; border-color: var(--mk-blue, #2c63d0); }
.ac-keyhint {
  font-size: var(--mk-fs-12);
  color: var(--mk-amber);
  font-weight: 600;
  font-style: normal;
  white-space: normal;
}

/* 连通性验证行：测试模型 + 运行测试 + 结果内联（底边对齐，按钮与输入控件同水平线） */
.ac-test {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px 14px;
  border-top: 1px solid #f0f2f5;
}
.ac-test__model { min-width: 260px; }
.ac-test__meta { font-size: var(--mk-fs-12); color: var(--mk-faint); }
.ac-test__text {
  font-size: var(--mk-fs-12_5);
  color: var(--mk-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40%;
}
.ac-test__text--bad { color: var(--mk-red); }

.ac-models { display: flex; gap: 6px; flex-wrap: wrap; }
.ac-model {
  padding: 4px 10px;
  border-radius: 7px;
  background: #eef2fa;
  color: var(--mk-muted);
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-12);
  font-weight: 600;
}

.ac-policy {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  padding: 16px;
}
.ac-policy__item { display: grid; gap: 8px; align-content: start; }
.ac-policy--3 { grid-template-columns: repeat(3, 1fr); }
.ac-policy__label { font-size: var(--mk-fs-12); font-weight: 700; color: var(--mk-muted); }
.ac-policy__desc { font-size: var(--mk-fs-12); color: var(--mk-muted); line-height: 1.6; }
.ac-policy__toggle { width: fit-content; }
.ac-policy__warn { font-size: var(--mk-fs-12); color: var(--mk-red); font-weight: 600; }
.ac-seg { display: inline-flex; gap: 4px; padding: 3px; background: #eef2fa; border-radius: 10px; width: fit-content; }
.ac-seg__item {
  border: 0;
  background: transparent;
  padding: 6px 12px;
  border-radius: 7px;
  font: inherit;
  font-size: var(--mk-fs-12);
  font-weight: 600;
  color: var(--mk-muted);
  cursor: pointer;
}
.ac-seg__item--active { background: #fff; color: var(--mk-ink); box-shadow: 0 1px 2px rgba(23, 32, 51, 0.1); }

.ac-textarea { resize: vertical; font-size: var(--mk-fs-12); }

/* 能力健康 */
.ac-health { display: grid; padding: 2px 0 8px; }
/* 列头（P3）：能力行各列为无标注数字（响应 ms / 相对时间），补一行表头说明语义 */
.ac-health__head {
  display: grid;
  grid-template-columns: 10px 200px 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 4px 0 2px;
  border-bottom: 1px solid #f0f2f5;
  font-size: var(--mk-fs-11);
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.ac-health__head span:last-child { white-space: nowrap; }
.ac-health__row {
  display: grid;
  grid-template-columns: 10px 200px 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 7px 0;
  border-bottom: 1px solid #f0f2f5;
  font-size: var(--mk-fs-12);
}
.ac-health__row:last-child { border-bottom: none; }
.ac-health__dot { width: 8px; height: 8px; border-radius: 50%; }
.ac-health__dot.is-operational { background: var(--mk-green); }
.ac-health__dot.is-degraded { background: var(--mk-amber); }
.ac-health__dot.is-unavailable { background: var(--mk-red); }
.ac-health__dot.is-unknown { background: var(--mk-faint); }
.ac-health__id { font-size: var(--mk-fs-11); color: var(--mk-ink); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ac-health__msg { color: var(--mk-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ac-health__lat { font-size: var(--mk-fs-11); color: var(--mk-muted); font-variant-numeric: tabular-nums; }
.ac-health__time { font-size: var(--mk-fs-11); color: var(--mk-faint); white-space: nowrap; }
.ac-health__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 10px 0 14px;
  border-top: 1px solid #f0f2f5;
  margin-top: 4px;
}
/* stale 时「立即探测」红色脉冲（A3：承认探活默认关闭的机制性状态，引导手动探测） */
.ac-probe--alert {
  border-color: var(--mk-red) !important;
  color: var(--mk-red) !important;
  animation: ac-probe-pulse 1.6s ease infinite;
}
@keyframes ac-probe-pulse {
  50% { box-shadow: 0 0 0 4px rgba(220, 38, 38, 0.18); }
}

/* AI 调用与健康：分区标题 */
.ac-sec { border-top: 1px solid #f0f2f5; }
.mk-card__head + .ac-sec { border-top: none; }
.ac-sec__title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 14px 0 0;
  font-size: var(--mk-fs-11);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.ac-sec__sub { margin-left: auto; font-size: var(--mk-fs-11); letter-spacing: 0; text-transform: none; font-weight: 500; }
.ac-health__stale { font-size: var(--mk-fs-11); color: var(--mk-faint); }

/* 调用参数分组 */
.ac-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  align-items: start;
}
.ac-cols__main { min-width: 0; padding: 0 18px 0 16px; }
.ac-cols__side {
  min-width: 0;
  border-left: 1px solid #f0f2f5;
  padding: 0 16px 0 18px;
}
.ac-groups { display: grid; gap: 18px; padding: 12px 0 8px; }
.ac-group { display: grid; gap: 8px; }
.ac-group__title {
  font-size: var(--mk-fs-11);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.ac-group__fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
/* 开关控件 */
.mk-field--switch { align-content: start; }
.ac-switch { position: relative; width: 36px; height: 20px; justify-self: start; margin-top: 2px; }
.ac-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.ac-switch i {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: #d3dbe9;
  transition: background 0.18s ease;
  pointer-events: none;
}
.ac-switch i::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25);
  transition: left 0.18s ease;
}
.ac-switch input:checked + i { background: var(--mk-blue); }
.ac-switch input:checked + i::after { left: 18px; }
.ac-switch input:disabled + i { opacity: 0.5; }
.ac-switch input:focus-visible + i { box-shadow: 0 0 0 3px rgba(44, 99, 208, 0.25); }

.ac-rel__note {
  margin: 0;
  padding: 0 0 14px;
  font-size: var(--mk-fs-12);
  color: var(--mk-faint);
}
/* 降级提示：健康快照不可用 / 配置读取失败 */
.ac-rel__error {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--mk-red);
  font-weight: 600;
}
.ac-rel__error .mk-link { font-size: var(--mk-fs-12); }
.ac-config-error {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 16px 4px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--mk-red-bg);
  color: var(--mk-red);
  font-size: var(--mk-fs-12_5);
  font-weight: 600;
}

.ac-save {
  position: sticky;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  margin: 4px auto 0;
  padding: 9px 12px 9px 16px;
  border-radius: 999px;
  border: 1px solid rgba(44, 99, 208, 0.24);
  background: var(--mk-surface);
  box-shadow: var(--mk-shadow-pop);
  font-weight: 600;
}
.ac-save__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mk-amber); }
.ac-save__primary {
  padding: 6px 14px;
  border-radius: 999px;
  border: 0;
  background: var(--mk-blue);
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.ac-save__primary:disabled { opacity: 0.6; cursor: not-allowed; }


/* 侧栏占 208px，断点需按视口 1100px 触发（内容区 ≈ 892px），安全策略单列 */
@media (max-width: 1100px) {
  .ac-policy { grid-template-columns: 1fr; }
  .ac-cols { grid-template-columns: 1fr; }
  .ac-cols__main { padding: 0 16px; }
  .ac-cols__side { border-left: none; padding: 0 16px; margin-top: 6px; }
}
@media (max-width: 800px) {
  .ac-group__fields { grid-template-columns: 1fr; }
  .ac-health__row { grid-template-columns: 10px minmax(0, 1fr) auto; }
  .ac-health__head { grid-template-columns: 10px minmax(0, 1fr) auto; }
  .ac-health__msg { display: none; }
  .ac-health__head span:nth-child(3) { display: none; }
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .ac-body { gap: 16px; padding: 16px 18px; }
  .mk-field__label { font-size: 13.5px; }
  .ac-model { font-size: 13px; padding: 5px 12px; }
  .ac-run { padding: 10px 14px; }
  .ac-policy { gap: 16px; padding: 18px; }
  .ac-policy__label { font-size: 13.5px; }
  .ac-policy__desc { font-size: 13px; }
  .ac-policy__warn { font-size: 13px; }
  .ac-seg { border-radius: 12px; }
  .ac-seg__item { font-size: 13.5px; padding: 8px 14px; }
  .ac-textarea { font-size: 13.5px; }
  .ac-sec__title { font-size: 12.5px; padding: 16px 0 0; }
  .ac-cols__main { padding: 0 20px 0 18px; }
  .ac-cols__side { padding: 0 18px 0 20px; }
  .ac-sec__sub { font-size: 12.5px; }
  .ac-group__title { font-size: 12.5px; }
  .ac-groups { gap: 20px; padding: 14px 0 8px; }
  .ac-rel__note { font-size: 13px; }
  .ac-health__row { grid-template-columns: 12px 210px 1fr auto auto; gap: 12px; padding: 9px 0; font-size: 13.5px; }
  .ac-health__head { grid-template-columns: 12px 210px 1fr auto auto; gap: 12px; padding: 5px 0 3px; font-size: 12.5px; }
  .ac-health__id,
  .ac-health__lat,
  .ac-health__time { font-size: 12.5px; }
  .ac-health__stale { font-size: 12.5px; }
  .ac-save { padding: 11px 14px 11px 18px; }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号继续放大 */
  .ac-body { gap: 18px; padding: 20px 22px; }
  .mk-field__label { font-size: 15.5px; }
  .ac-model { font-size: 15px; padding: 6px 14px; border-radius: 9px; }
  .ac-run { padding: 12px 16px; }
  .ac-policy { gap: 18px; padding: 22px; }
  .ac-policy__label { font-size: 15.5px; }
  .ac-policy__desc { font-size: 15px; }
  .ac-policy__warn { font-size: 15px; }
  .ac-seg__item { font-size: 15.5px; padding: 9px 16px; }
  .ac-textarea { font-size: 15.5px; }
  .ac-sec__title { font-size: 14.5px; padding: 18px 0 0; }
  .ac-cols__main { padding: 0 24px 0 22px; }
  .ac-cols__side { padding: 0 22px 0 24px; }
  .ac-sec__sub { font-size: 14.5px; }
  .ac-group__title { font-size: 14.5px; }
  .ac-groups { gap: 22px; padding: 16px 0 8px; }
  .ac-rel__note { font-size: 15px; }
  .ac-health__row { grid-template-columns: 14px 260px 1fr auto auto; gap: 14px; padding: 11px 0; font-size: 15.5px; }
  .ac-health__head { grid-template-columns: 14px 260px 1fr auto auto; gap: 14px; padding: 6px 0 3px; font-size: 14.5px; }
  .ac-health__id,
  .ac-health__lat,
  .ac-health__time { font-size: 14.5px; }
  .ac-health__stale { font-size: 14.5px; }
  .ac-save { padding: 13px 16px 13px 20px; }
}
@media (min-width: 3600px) {
  /* 4K（zoom 1.3 档）：字号继续放大，与页面基线对齐 */
  .ac-body { gap: 20px; padding: 24px 26px; }
  .mk-field__label { font-size: 18px; }
  .ac-model { font-size: 17.5px; padding: 7px 16px; }
  .ac-run { padding: 14px 18px; }
  .ac-policy { gap: 20px; padding: 26px; }
  .ac-policy__label { font-size: 18px; }
  .ac-policy__desc { font-size: 17.5px; }
  .ac-policy__warn { font-size: 17.5px; }
  .ac-seg__item { font-size: 18px; padding: 11px 19px; }
  .ac-textarea { font-size: 18px; }
  .ac-sec__title { font-size: 17px; padding: 20px 0 0; }
  .ac-cols__main { padding: 0 28px 0 26px; }
  .ac-cols__side { padding: 0 26px 0 28px; }
  .ac-sec__sub { font-size: 17px; }
  .ac-group__title { font-size: 17px; }
  .ac-groups { gap: 26px; padding: 18px 0 10px; }
  .ac-rel__note { font-size: 17.5px; }
  .ac-health__row { grid-template-columns: 16px 310px 1fr auto auto; gap: 16px; padding: 13px 0; font-size: 18px; }
  .ac-health__head { grid-template-columns: 16px 310px 1fr auto auto; gap: 16px; padding: 7px 0 4px; font-size: 17px; }
  .ac-health__id,
  .ac-health__lat,
  .ac-health__time { font-size: 17px; }
  .ac-health__stale { font-size: 17px; }
  .ac-save { padding: 15px 18px 15px 24px; }
}

/* ================= 暗色模式（D1 补完）：模型与接入 ================= */
html[data-theme='dark'] {
  .ac-key-toggle:hover { background: rgba(91, 141, 239, 0.14); }
  .ac-seg { background: #1d2739; }
  .ac-seg__item--active { background: rgba(91, 141, 239, 0.22); color: #9db8f5; box-shadow: none; }
  .ac-save { background: #141c2b; border-color: #232f45; }
  /* 补漏：密钥切换钮/模型胶囊浅底 */
  .ac-key-toggle,
  .ac-model { background: #1d2739; color: #9fb0c8; }
  /* 开关轨道：浅灰轨道暗色化（滑块保持白色——深色开关的标准做法） */
  .ac-switch i { background: #3a4a63; }
}
</style>
