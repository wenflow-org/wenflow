<template>
  <div :class="embedded ? 'acl-host acl-host--embedded' : 'mk-page acl-host'">
    <MkPageHead v-if="!embedded" title="访问与注册">
      <template #actions>
        <button
          type="button"
          class="mk-btn mk-btn--sm mk-btn--primary"
          :disabled="!policyDirty || saving || saveBlocked"
          @click="savePolicy"
        >{{ saving ? '保存中…' : '保存策略' }}</button>
      </template>
    </MkPageHead>

    <div v-if="configFailed" class="mk-alert mk-alert--row" role="alert">
      <span class="mk-alert__msg">访问策略读取失败：为空不代表未配置</span>
      <button type="button" class="mk-alert__btn" @click="retryLoad">重试</button>
    </div>

    <!-- 左「谁能连进来」（入站来源 + 出站目标，一次保存），右「谁能注册进来」（两个开关）。
         左右列按对象分组，不再限宽居中：限宽会把 1080P 下的半屏留给空白。 -->
    <div class="acl-grid">
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">后台访问来源</h3>
          <!-- 嵌入运营中心时页头由宿主承担，保存钮跟着它要保存的那张卡 -->
          <button
            v-if="embedded"
            type="button"
            class="mk-btn mk-btn--sm mk-btn--primary"
            :disabled="!policyDirty || saving || saveBlocked"
            @click="savePolicy"
          >{{ saving ? '保存中…' : '保存策略' }}</button>
        </div>
        <div class="ac-body">
          <div class="ac-group__title">访问来源模式</div>
          <div class="ac-radio-row" role="radiogroup" aria-label="访问来源模式" @keydown="onAccessKeydown">
            <span
              v-for="(opt, i) in accessOptions"
              :key="opt.id"
              :ref="(el) => setAccessRef(el, i)"
              class="ac-radio"
              :class="{ 'ac-radio--disabled': opt.disabled }"
              role="radio"
              :tabindex="policy.adminAccessMode === opt.id ? 0 : -1"
              :aria-checked="policy.adminAccessMode === opt.id"
              :aria-disabled="opt.disabled || undefined"
              @click="setAccessMode(opt.id)"
              @keydown.enter.prevent="setAccessMode(opt.id)"
              @keydown.space.prevent="setAccessMode(opt.id)"
            >
              <span class="ac-radio__mark" aria-hidden="true">{{ policy.adminAccessMode === opt.id ? '●' : '○' }}</span>
              <span class="ac-radio__text">
                <span class="ac-radio__title">{{ opt.label }}</span>
                <span v-if="opt.sub" class="ac-radio__sub">{{ opt.sub }}</span>
              </span>
            </span>
          </div>
          <span v-if="policy.adminAccessMode === 'any'" class="ac-policy__warn">公网开放 · 入口无访问限制</span>
          <label v-if="policy.adminAccessMode === 'private'" class="mk-field">
            <span class="mk-field__label">额外允许的客户端 IP</span>
            <textarea
              class="mk-field__textarea ac-textarea"
              rows="2"
              :value="policy.adminAllowedIps.join('\n')"
              @input="policy.adminAllowedIps = splitLines(($event.target as HTMLTextAreaElement).value); markDirty()"
              placeholder="203.0.113.10"
            ></textarea>
          </label>

          <div class="ac-group__title ac-group__title--sep">服务端出站白名单</div>
          <div class="mk-seg" role="group" aria-label="服务端出站白名单">
            <button
              type="button"
              class="mk-seg__item"
              :class="{ 'mk-seg__item--active': policy.allowPrivateNetwork }"
              :aria-pressed="policy.allowPrivateNetwork"
              @click="policy.allowPrivateNetwork = true; markDirty()"
            >允许</button>
            <button
              type="button"
              class="mk-seg__item"
              :class="{ 'mk-seg__item--active': !policy.allowPrivateNetwork }"
              :aria-pressed="!policy.allowPrivateNetwork"
              @click="policy.allowPrivateNetwork = false; markDirty()"
            >仅白名单</button>
          </div>
          <label v-if="!policy.allowPrivateNetwork" class="mk-field">
            <span class="mk-field__label">允许的 Host / IP</span>
            <textarea
              class="mk-field__textarea ac-textarea"
              rows="2"
              :value="policy.privateNetworkHosts.join('\n')"
              @input="policy.privateNetworkHosts = splitLines(($event.target as HTMLTextAreaElement).value); markDirty()"
              placeholder="192.168.1.20"
            ></textarea>
          </label>
          <span v-if="outboundEmptyWarn" class="ac-policy__warn">名单为空：服务端将无法请求任何内网地址</span>
        </div>
      </section>

      <div class="acl-side">
        <section v-if="isLive && registrationEnabled !== null && registerIpQuotaEnabled !== null" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">注册</h3>
          </div>
          <div class="ac-body">
            <div class="ac-reg-row">
              <MkSwitch
                :model-value="registrationEnabled === true"
                :busy="registrationBusy"
                label="新用户注册"
                :state-text="registrationStateText"
                @update:model-value="setRegistration"
              />
              <button v-if="!registrationEnabled" type="button" class="mk-link" @click="goCreateUser">新建用户 →</button>
            </div>
            <div class="ac-reg-row">
              <MkSwitch
                :model-value="registerIpQuotaEnabled === true"
                :busy="quotaBusy"
                :label="IP_QUOTA_TITLE"
                :state-text="quotaEnabledText"
                @update:model-value="setQuotaEnabled"
              />
              <label v-if="registerIpQuotaEnabled" class="ac-quota-field">
                <span class="mk-field__label">每日上限</span>
                <input
                  type="number"
                  class="mk-field__input"
                  min="1"
                  max="100"
                  :value="quotaInput"
                  :disabled="quotaBusy"
                  @change="onQuotaInput"
                />
                <em>个 / IP</em>
              </label>
              <button
                v-if="registerIpQuotaEnabled && quotaDirty"
                type="button"
                class="mk-btn mk-btn--sm mk-btn--primary"
                :disabled="quotaBusy"
                @click="saveQuota(registerIpQuotaEnabled === true, quotaInput)"
              >保存上限</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkSwitch from '@/components/mk/MkSwitch.vue'
import { toast } from '@/utils/toast'
import { authAPI } from '@/api/auth'
import {
  liveApiConfig as cfg,
  liveFailures,
  liveSaveNetworkPolicy,
  loadLiveData,
  errMsg,
  registrationEnabled,
  registerIpQuotaEnabled,
  registerIpDailyQuota,
  updateRegistrationSetting,
  updateRegisterIpQuotaSetting,
} from './live'
import { isLive } from './store'
import { askConfirm } from './useConfirm'

/* 嵌入运营中心时页头由宿主承担 */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

/* 文案单源（R6 复读单源化）：卡标题与开关标签共用一份 */
const IP_QUOTA_TITLE = '单 IP 每日注册配额'
const router = useRouter()

/* ---------- 访问来源与出站白名单（策略组，一次保存） ---------- */
const policy = reactive({
  adminAccessMode: 'private' as 'loopback' | 'private' | 'any',
  adminAllowedIps: [] as string[],
  allowPrivateNetwork: true,
  privateNetworkHosts: [] as string[],
})
const policyDirty = ref(false)
const saving = ref(false)
/** 接入域读取失败：空表单不得伪装成「未配置」 */
const configFailed = computed(() => !!liveFailures.value.apiConfig)

function applyPolicy(): void {
  if (!cfg.value) return
  Object.assign(policy, cfg.value.networkPolicy)
  policyDirty.value = false
}
watch(() => cfg.value, applyPolicy, { immediate: true })

function markDirty(): void {
  policyDirty.value = true
}
function splitLines(s: string): string[] {
  return s.split('\n').map((x) => x.trim()).filter(Boolean)
}
function retryLoad(): void {
  void loadLiveData()
}

/* 宿主刷新（运营中心顶栏）：策略表单有未保存改动时不动它——重取 cfg 会 applyPolicy
   覆盖草稿；此时只刷新与表单无关的注册状态。无改动时按原「重试」语义整域重取。 */
function reload(): void {
  if (policyDirty.value) {
    if (isLive.value) void loadRegistrationStatus()
    return
  }
  retryLoad()
}
defineExpose({ reload })

/** 仅白名单且名单为空：保存后服务端请求不到任何内网地址（含内网模型上游） */
const outboundEmptyWarn = computed(
  () => !policy.allowPrivateNetwork && policy.privateNetworkHosts.length === 0,
)
const saveBlocked = computed(() => outboundEmptyWarn.value)

/** 生产环境后端拒绝「不限制」来源，选项就地置灰并写原因 */
const isProduction = import.meta.env.PROD
const accessOptions = computed(() => [
  { id: 'loopback' as const, label: '仅本机', sub: '', disabled: false },
  { id: 'private' as const, label: '私有网段（推荐）', sub: '', disabled: false },
  {
    id: 'any' as const,
    label: '不限制',
    sub: isProduction ? '生产环境不可选 · 请用私有网段 + IP 白名单' : '',
    disabled: isProduction,
  },
])
function setAccessMode(mode: 'loopback' | 'private' | 'any'): void {
  if (policy.adminAccessMode === mode) return
  if (accessOptions.value.find((o) => o.id === mode)?.disabled) return
  policy.adminAccessMode = mode
  markDirty()
}
/* 键盘契约（审核 #160）：roving tabindex + 方向键循环切换并移动焦点 */
const accessEls = ref<(HTMLElement | null)[]>([])
function setAccessRef(el: unknown, i: number): void {
  accessEls.value[i] = (el as HTMLElement) || null
}
function onAccessKeydown(e: KeyboardEvent): void {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const opts = accessOptions.value
  const n = opts.length
  const cur = opts.findIndex((o) => o.id === policy.adminAccessMode)
  const from = cur >= 0 ? cur : 0
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
  let next = from
  if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = n - 1
  else {
    // 跳过不可选档（生产环境的「不限制」）
    for (let i = 1; i <= n; i++) {
      const cand = (from + step * i + n * i) % n
      if (!opts[cand].disabled) { next = cand; break }
    }
  }
  e.preventDefault()
  if (opts[next].disabled) return
  setAccessMode(opts[next].id)
  void nextTick(() => accessEls.value[next]?.focus())
}

async function savePolicy(): Promise<void> {
  if (saving.value || !policyDirty.value || saveBlocked.value) return
  if (policy.adminAccessMode === 'any') {
    const ok = await askConfirm({
      title: '开放公网访问',
      message: '你正在将 Admin 后台开放到公网/任意来源访问。\n任何能访问该服务地址的人都能看到管理入口，请确认已了解风险。',
      confirmText: '确认开放',
    })
    if (!ok) return
  }
  saving.value = true
  try {
    await liveSaveNetworkPolicy({ ...policy })
    policyDirty.value = false
    toast.success('访问策略已保存并生效')
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    saving.value = false
  }
}

/* 未保存保护：与 ApiConfig 同款，离开页面前拦一次 */
onBeforeRouteLeave(async () => {
  if (!policyDirty.value) return true
  const ok = await askConfirm({
    title: '有未保存的访问策略',
    message: '离开将丢弃这些修改，确认离开？',
    confirmText: '丢弃并离开',
  })
  return ok === true
})
function onBeforeUnloadHandler(e: BeforeUnloadEvent) {
  if (policyDirty.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnloadHandler))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnloadHandler))

/* ---------- 注册开关（高风险，二次确认） ---------- */
const registrationBusy = ref(false)
/** 生效值：配置开但核心学习服务阻断时注册实际不可用（auth.ts registration-status） */
const registrationTemporaryUnavailable = ref(false)
async function loadRegistrationStatus(): Promise<void> {
  try {
    const s = await authAPI.getRegistrationStatus()
    registrationTemporaryUnavailable.value = s.temporaryUnavailable === true
  } catch {
    registrationTemporaryUnavailable.value = false
  }
}
const registrationStateText = computed(() => {
  if (!registrationEnabled.value) return '仅管理员创建'
  if (registrationTemporaryUnavailable.value) return '已开放 · 核心服务异常，暂时无法注册'
  return '任何人均可注册'
})
function goCreateUser(): void {
  void router.push('/admin/people')
}
async function setRegistration(target: boolean): Promise<void> {
  if (registrationBusy.value || registrationEnabled.value === null) return
  if (target === registrationEnabled.value) return
  const ok = await askConfirm({
    title: target ? '开放注册' : '关闭注册',
    message: target
      ? '确认开放新用户自助注册？\n任何人都能通过注册页创建账号。'
      : '确认关闭新用户自助注册？\n关闭后新账号只能由管理员手动创建。',
    confirmText: target ? '开放注册' : '关闭注册',
    danger: target,
  })
  if (!ok) return
  registrationBusy.value = true
  try {
    await updateRegistrationSetting(target)
    await loadRegistrationStatus()
    toast.success(target ? '注册已开放' : '注册已关闭，新账号只能由管理员创建')
  } catch (e) {
    registrationEnabled.value = !target
    toast.error(`切换失败：${errMsg(e)}`)
  } finally {
    registrationBusy.value = false
  }
}

/* ---------- 单 IP 每日注册配额（默认关，避免误伤同一出口的正常注册） ---------- */
const quotaBusy = ref(false)
const quotaInput = ref(5)
/** 已落盘的限额：状态词只报它，改数字未保存时屏幕上不出现新值 */
const quotaSaved = ref(5)
watch(
  () => registerIpDailyQuota.value,
  (v) => {
    if (typeof v === 'number' && v >= 1 && v <= 100) {
      quotaInput.value = v
      quotaSaved.value = v
    }
  },
  { immediate: true },
)
const quotaDirty = computed(() => quotaInput.value !== quotaSaved.value)
const quotaEnabledText = computed(() =>
  registerIpQuotaEnabled.value ? `已启用 · 每 IP 每日 ${quotaSaved.value} 个` : '未启用（不限制注册数量）',
)
/** 配额输入只在 change 时校验：清空/非法值回退最近一次有效值（Number('')=0 会被钳到 1 静默改值） */
function onQuotaInput(e: Event): void {
  const input = e.target as HTMLInputElement
  const raw = input.value.trim()
  const v = Number(raw)
  if (!raw || !Number.isInteger(v) || v < 1) {
    input.value = String(quotaInput.value)
    return
  }
  quotaInput.value = Math.min(100, Math.max(1, v))
}
async function setQuotaEnabled(enabled: boolean): Promise<void> {
  if (quotaBusy.value) return
  if (enabled && !registerIpQuotaEnabled.value) {
    const ok = await askConfirm({
      title: '启用单 IP 每日注册配额',
      message: `开启后，同一 IP 24 小时内最多注册 ${quotaInput.value} 个账号。\n若您所在网络有多个真实用户共享出口 IP，可能误伤正常注册。`,
      confirmText: '启用配额',
      danger: false,
    })
    if (!ok) return
  }
  await saveQuota(enabled, quotaInput.value)
}
async function saveQuota(enabled: boolean, quota: number): Promise<void> {
  if (quotaBusy.value) return
  quotaBusy.value = true
  try {
    await updateRegisterIpQuotaSetting(enabled, quota)
    quotaSaved.value = quota
    toast.success(enabled ? `配额已启用：每 IP 每日 ${quota} 个` : '配额已关闭，注册不再限制数量')
  } catch (e) {
    quotaInput.value = quotaSaved.value
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    quotaBusy.value = false
  }
}

onMounted(() => { if (isLive.value) void loadRegistrationStatus() })
</script>

<style scoped>
/* 嵌入运营中心（2026-10-27）：宿主承担页头与页面内边距，本页只做页签面板——
   占满剩余高度并自管纵向滚动，与 tools/export 面板同判例 */
.acl-host--embedded {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  gap: 12px;
  align-content: start;
}
@media (max-width: 900px) {
  .acl-host--embedded { flex: none; overflow: visible; }
}
/* 左「入站 + 出站」（一次保存）、右「注册」（两个独立开关）：按对象分列，窄屏回落单列 */
.acl-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.acl-side { display: grid; gap: 16px; }
@media (max-width: 1100px) {
  .acl-grid { grid-template-columns: minmax(0, 1fr); }
}
.ac-body { display: grid; gap: 14px; padding: 4px 16px 16px; }
.ac-body .mk-field { margin: 0; min-width: 0; }
.ac-policy__warn { font-size: var(--mk-fs-micro); color: var(--mk-red); font-weight: 600; }

/* 访问来源模式：radio 卡片（三选一，带一行口径副文） */
.ac-radio-row { display: flex; gap: 8px; flex-wrap: wrap; }
.ac-radio {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface);
  cursor: pointer;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-ink);
  transition: border-color 0.15s, background 0.15s;
}
.ac-radio:hover { border-color: var(--mk-blue); }
.ac-radio:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 1px; }
.ac-radio[aria-checked='true'] {
  border-color: var(--mk-blue);
  background: color-mix(in srgb, var(--mk-blue) 8%, transparent);
  color: var(--mk-blue);
}
.ac-radio--disabled { cursor: not-allowed; opacity: 0.55; }
.ac-radio--disabled:hover { border-color: var(--mk-line); }
.ac-radio__mark { flex: none; line-height: 1; }
.ac-radio__text { display: grid; gap: 0; min-width: 0; }
.ac-radio__title { font-weight: 600; }
.ac-radio__sub { color: var(--mk-muted); font-weight: 500; }
.ac-radio[aria-checked='true'] .ac-radio__sub { color: inherit; opacity: 0.82; }

/* 注册卡两行：开关 + 数字 + 保存 */
.ac-reg-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.ac-quota-field { display: inline-flex; align-items: center; gap: 8px; }
.ac-quota-field .mk-field__label { margin: 0; }
.ac-quota-field .mk-field__input { width: 76px; text-align: center; font-variant-numeric: tabular-nums; }
.ac-quota-field em { font-style: normal; color: var(--mk-faint); }

.ac-group__title { font-size: var(--mk-fs-emphasis); font-weight: 700; color: var(--mk-ink); }
/* 第二段（出站）与第一段（入站）之间加一条分隔，同卡两域不靠间距猜 */
.ac-group__title--sep { margin-top: 6px; padding-top: 14px; border-top: 1px solid var(--mk-line); }
.ac-textarea { resize: vertical; font-size: var(--mk-fs-micro); min-height: 0; }
</style>
