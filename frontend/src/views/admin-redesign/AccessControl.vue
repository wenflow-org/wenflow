<template>
  <div :class="embedded ? 'acl-host acl-host--embedded' : 'mk-page acl-host'">
    <MkPageHead v-if="!embedded" title="访问与注册" />

    <div v-if="configFailed" class="mk-alert mk-alert--row" role="alert">
      <span class="mk-alert__msg">访问策略读取失败：为空不代表未配置</span>
      <button type="button" class="mk-alert__btn" @click="retryLoad">重试</button>
    </div>

    <!-- 单卡承载三组设置（入站 / 出站 / 注册）：原来是「访问来源」与「注册」两张卡并排，
         右卡只有两行开关，下方留半屏空白，两块卡高度也对不齐（2026-10-30 人工复查
         「做成一个卡片吧」）。三组之间用分隔线分段；保存钮仍只保存上面两组访问策略，
         注册两个开关保持逐项即时生效。 -->
    <section class="mk-card ac-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">访问与注册设置</h3>
        </div>
        <div class="ac-body">
          <!-- 入站：三张可选卡（图标 + 一句话后果），选中态蓝边 + 右上单选点。
               2026-10-27 用户「重新设计一下」：原 ○/● 行内单选看不出选中面积，也读不出各档差异。 -->
          <section class="ac-section">
            <div class="ac-section__head">
              <h4 class="ac-section__title">管理后台访问控制</h4>
            </div>
            <div class="ac-seg" role="radiogroup" aria-label="访问来源模式" @keydown="onAccessKeydown">
              <button
                v-for="(opt, i) in accessOptions"
                :key="opt.id"
                :ref="(el) => setAccessRef(el, i)"
                type="button"
                role="radio"
                class="ac-seg__item"
                :class="{
                  'ac-seg__item--on': policy.adminAccessMode === opt.id,
                  'ac-seg__item--disabled': opt.disabled,
                }"
                :tabindex="policy.adminAccessMode === opt.id ? 0 : -1"
                :aria-checked="policy.adminAccessMode === opt.id"
                :aria-disabled="opt.disabled || undefined"
                @click="setAccessMode(opt.id)"
              >
                <component :is="opt.icon" :size="15" :stroke-width="1.8" aria-hidden="true" />
                <span>{{ opt.label }}</span>
                <span v-if="opt.recommended" class="ac-seg__badge">推荐</span>
              </button>
            </div>
            <p v-if="policy.adminAccessMode === 'any'" class="ac-risk" role="alert">
              <TriangleAlert :size="15" :stroke-width="2" aria-hidden="true" />
              已允许公网访问：任意来源均可进入管理后台，仅建议临时调试时使用。
            </p>
            <label v-if="policy.adminAccessMode === 'private'" class="mk-field">
              <span class="mk-field__label">额外允许的客户端 IP</span>
              <textarea
                class="mk-field__textarea ac-textarea"
                rows="2"
                :value="policy.adminAllowedIps.join('\n')"
                @input="policy.adminAllowedIps = splitLines(($event.target as HTMLTextAreaElement).value); markDirty()"
                placeholder="每行一个 IP 或 CIDR 网段，例如 203.0.113.10"
              ></textarea>
            </label>
          </section>

          <!-- 出站：两档并列分段，标签本身就是互斥语义 -->
          <section class="ac-section">
            <div class="ac-section__head">
              <h4 class="ac-section__title">服务端出站访问</h4>
            </div>
            <div class="ac-seg" role="radiogroup" aria-label="服务端出站白名单" @keydown="onOutboundKeydown">
              <button
                :ref="(el) => setOutboundRef(el, 0)"
                type="button"
                role="radio"
                class="ac-seg__item"
                :class="{ 'ac-seg__item--on': policy.allowPrivateNetwork }"
                :tabindex="policy.allowPrivateNetwork ? 0 : -1"
                :aria-checked="policy.allowPrivateNetwork"
                @click="setOutbound(true)"
              >
                <Network :size="15" :stroke-width="1.8" aria-hidden="true" />
                <span>允许全部内网</span>
              </button>
              <button
                :ref="(el) => setOutboundRef(el, 1)"
                type="button"
                role="radio"
                class="ac-seg__item"
                :class="{ 'ac-seg__item--on': !policy.allowPrivateNetwork }"
                :tabindex="!policy.allowPrivateNetwork ? 0 : -1"
                :aria-checked="!policy.allowPrivateNetwork"
                @click="setOutbound(false)"
              >
                <ShieldCheck :size="15" :stroke-width="1.8" aria-hidden="true" />
                <span>仅白名单</span>
              </button>
            </div>
            <label v-if="!policy.allowPrivateNetwork" class="mk-field">
              <span class="mk-field__label">允许的 Host / IP</span>
              <textarea
                class="mk-field__textarea ac-textarea"
                rows="2"
                :value="policy.privateNetworkHosts.join('\n')"
                @input="policy.privateNetworkHosts = splitLines(($event.target as HTMLTextAreaElement).value); markDirty()"
                placeholder="每行一个 Host 或 CIDR 网段，例如 192.168.1.20"
              ></textarea>
            </label>
            <p v-if="outboundEmptyWarn" class="ac-risk" role="alert">
              <TriangleAlert :size="15" :stroke-width="2" aria-hidden="true" />
              白名单为空：保存后服务端将无法访问任何内网地址。
            </p>
          </section>

          <!-- 注册：并入同卡第三段，与访问策略只隔一条分隔线；两个开关仍各自即时生效 -->
          <section v-if="isLive && registrationEnabled !== null && registerIpQuotaEnabled !== null" class="ac-section">
            <div class="ac-section__head">
              <h4 class="ac-section__title">注册设置</h4>
            </div>
            <div class="ac-reg-rows">
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
                  @update:model-value="setQuotaEnabled"
                />
                <!-- 2026-11-01 外部评审：开关关闭时输入框只是「暗一档」，在一屏灰字里仍被读成可填；
                     整组（标签 + 数字 + 单位）一起压暗，才看得出这是「当前不生效的值」 -->
                <label class="ac-quota-field" :class="{ 'ac-quota-field--off': !registerIpQuotaEnabled }">
                  <span class="mk-field__label">每日上限</span>
                  <input
                    type="number"
                    class="mk-field__input"
                    min="1"
                    max="100"
                    :value="quotaInput"
                    :disabled="!registerIpQuotaEnabled || quotaBusy"
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
        <div class="ac-foot">
          <button
            type="button"
            class="mk-btn mk-btn--primary"
            :disabled="!policyDirty || saving || saveBlocked"
            @click="savePolicy"
          >{{ saving ? '保存中…' : '保存策略' }}</button>
          <!-- 未修改时保存钮置灰是「暂无可保存的改动」而非无权限（2026-10-31 三轮评审）：
               灰底主按钮旁补一句弱化说明，避免误读成只读 -->
          <span v-if="!policyDirty && !saveBlocked" class="ac-foot__hint">调整任一策略后可保存</span>
        </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkSwitch from '@/components/mk/MkSwitch.vue'
import { Globe, Laptop, Network, ShieldCheck, TriangleAlert } from 'lucide-vue-next'
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
  {
    id: 'loopback' as const,
    label: '仅本机',
    icon: Laptop,
    recommended: false,
    disabled: false,
  },
  {
    id: 'private' as const,
    label: '私有网段',
    icon: Network,
    recommended: true,
    disabled: false,
  },
  {
    id: 'any' as const,
    label: '不限制',
    icon: Globe,
    recommended: false,
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

/* 出站两档同样走 radio 语义：roving tabindex + 方向键切换 */
function setOutbound(allow: boolean): void {
  if (policy.allowPrivateNetwork === allow) return
  policy.allowPrivateNetwork = allow
  markDirty()
}
const outboundEls = ref<(HTMLElement | null)[]>([])
function setOutboundRef(el: unknown, i: number): void {
  outboundEls.value[i] = (el as HTMLElement) || null
}
function onOutboundKeydown(e: KeyboardEvent): void {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(e.key)) return
  e.preventDefault()
  const next = e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'Home' ? 0 : 1
  setOutbound(next === 0)
  void nextTick(() => outboundEls.value[next]?.focus())
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
const registrationStateText = computed(() =>
  registrationTemporaryUnavailable.value ? '暂不可用' : '',
)
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
/* 卡通栏左对齐（与同页签运维工具/数据导出/会话安全外框同轴，2026-10-31 三轮评审：
   上一版 1200 居中在左侧导航 + 左对齐页头的后台里砍断了左轴线）；
   表单控件区单独限宽 720 左对齐，保住单列表单的可读宽度 */
.ac-card { width: 100%; }
.ac-reg-rows { display: grid; gap: 12px; }
.ac-body { display: grid; gap: 18px; padding: 4px 16px 16px; max-width: 736px; }
.ac-body .mk-field { margin: 0; min-width: 0; }

/* 三段设置（入站 / 出站 / 注册）：段间用分隔线，不再用大卡占位 */
.ac-section { display: grid; gap: 10px; min-width: 0; }
.ac-section + .ac-section {
  padding-top: 16px;
  border-top: 1px solid var(--mk-line);
}
.ac-section__head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.ac-section__title { margin: 0; font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); }

/* 互斥枚举：分段器（三档入站 / 两档出站共用），选中态用底色和字色，不用远端单选点 */
.ac-seg {
  display: flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface-2);
}
.ac-seg__item {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--mk-radius-sm);
  background: transparent;
  color: var(--mk-muted);
  font-size: var(--mk-fs-body);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.ac-seg__item:hover { color: var(--mk-ink); }
.ac-seg__item:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 1px; }
.ac-seg__item--on {
  border-color: var(--mk-line);
  background: var(--mk-surface);
  color: var(--mk-ink);
}
.ac-seg__item--disabled { cursor: not-allowed; opacity: 0.55; }
.ac-seg__item--disabled:hover { color: var(--mk-muted); }
.ac-seg__badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--mk-blue) 12%, transparent);
  color: var(--mk-blue);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  line-height: 1.4;
}

/* 风险提示（公网开放 / 白名单为空）：整条落在该段下方，不是一行小字 */
.ac-risk {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 9px 12px;
  border-radius: var(--mk-radius-md);
  background: color-mix(in srgb, var(--mk-red) 8%, transparent);
  color: var(--mk-red);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  line-height: 1.5;
}
.ac-risk svg { flex: none; margin-top: 1px; }

/* 注册卡两行：开关 + 数字 + 保存 */
.ac-reg-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.ac-quota-field { display: inline-flex; align-items: center; gap: 8px; }
.ac-quota-field .mk-field__label { margin: 0; }
.ac-quota-field .mk-field__input { width: 76px; text-align: center; font-variant-numeric: tabular-nums; }
.ac-quota-field em { font-style: normal; color: var(--mk-faint); }
/* 配额关闭 = 这组数不生效：整组压暗（含标签与单位），比只换输入框底色可辨得多 */
.ac-quota-field--off { opacity: 0.45; }

/* 保存归位到表单末尾：改完整张卡，动作就在手边（2026-10-30 人工复查） */
.ac-foot {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  padding: 14px 16px 18px;
  border-top: 1px solid var(--mk-line);
}
.ac-foot__hint { font-size: var(--mk-fs-micro); color: var(--mk-faint); }

/* 全宽（2026-10-31 外部评审）：760 卡内上下分段控件都撑满，唯独 textarea 420px 右侧留半截 */
.ac-textarea { resize: vertical; font-size: var(--mk-fs-micro); min-height: 0; width: 100%; }
</style>
