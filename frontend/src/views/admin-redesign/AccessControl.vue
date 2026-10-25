<template>
  <!-- 访问与注册（2026-10-25 用户「这个组整个页面我觉得做的不好…可以功能打散」）：
       原为「模型与接入 · 安全与访问」页签。三张卡管的是后台谁能进来、谁能注册，
       与「模型接哪个上游」没有共享的对象或动线，留在模型页只是把两个不相干的域塞进一个入口。
       拆为独立页并归入侧栏「系统」组（与健康中心、模型与接入并列）。
       旧深链 /admin/api-config?tab=security 由路由改投本页。 -->
  <div class="mk-page">
    <MkPageHead
      title="访问与注册"
      sub="后台入口的来源限制、私有网络放行与自助注册"
      hint="改动保存后即时生效。覆盖管理端入口、注册与出站网络"
    />

    <!-- 读取失败：空表单不得伪装成「未配置」 -->
    <div v-if="configFailed" class="mk-alert mk-alert--row" role="alert">
      <span class="mk-alert__msg">访问策略读取失败：为空不代表未配置，请重试</span>
      <button type="button" class="mk-alert__btn" @click="retryLoad">重试</button>
    </div>

    <!-- 左一右二（2026-10-15 用户重组）：左卡管「谁能连进来」（入站来源 + 出站目标两段），
         右列两张小卡管「谁能注册进来」（自助注册 + 单 IP 配额）——各自只有一个开关，
         平铺成宫格会把左卡挤成半屏空白。 -->
    <div class="acl-grid">
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">访问来源与网络</h3>
          <button
            v-if="policyDirty"
            type="button"
            class="mk-btn mk-btn--sm mk-btn--primary"
            :disabled="saving"
            @click="savePolicy"
          >{{ saving ? '保存中…' : '保存策略' }}</button>
        </div>
        <div class="ac-body ac-policy__item">
          <div class="ac-group__title" title="管理端入口允许哪些来源访问：公网 / 仅内网 / 仅白名单">访问来源模式</div>
          <!-- radio 单选卡片（radiogroup + role=radio + aria-checked）；
               键盘契约（审核 #160）：roving tabindex（仅选中项可 Tab 进入）+ 方向键循环切换 -->
          <div class="ac-radio-row" role="radiogroup" aria-label="访问来源模式" @keydown="onAccessKeydown">
            <span
              v-for="(opt, i) in ACCESS_OPTIONS"
              :key="opt.id"
              :ref="(el) => setAccessRef(el, i)"
              class="ac-radio"
              role="radio"
              :tabindex="policy.adminAccessMode === opt.id ? 0 : -1"
              :aria-checked="policy.adminAccessMode === opt.id"
              @click="setAccessMode(opt.id)"
              @keydown.enter.prevent="setAccessMode(opt.id)"
              @keydown.space.prevent="setAccessMode(opt.id)"
            >
              <span class="ac-radio__mark" aria-hidden="true">{{ policy.adminAccessMode === opt.id ? '●' : '○' }}</span>
              <span class="ac-radio__text">
                <span class="ac-radio__title">{{ opt.label }}</span>
                <span class="ac-radio__sub">{{ opt.sub }}</span>
              </span>
            </span>
          </div>
          <span v-if="policy.adminAccessMode === 'any'" class="ac-policy__warn">公网开放 · 入口无访问限制</span>
          <label v-if="policy.adminAccessMode === 'private'" class="mk-field">
            <span class="mk-field__label">额外允许的客户端 IP（每行一个，可留空）</span>
            <textarea
              class="mk-field__textarea ac-textarea"
              rows="2"
              :value="policy.adminAllowedIps.join('\n')"
              @input="policy.adminAllowedIps = splitLines(($event.target as HTMLTextAreaElement).value); markDirty()"
              placeholder="203.0.113.10"
            ></textarea>
          </label>
        </div>
        <div class="ac-body ac-policy__item ac-policy__item--sep">
          <!-- 访问来源模式管「谁能连进来」（入站来源）；这条管「服务端能往哪里发请求」（出站目标） -->
          <div class="ac-group__title" title="服务端是否允许请求内网/私有地址：仅白名单时只放行「允许的 Host / IP」里的地址">私有网络服务</div>
          <div class="mk-seg" role="group" aria-label="私有网络服务">
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
            <span class="mk-field__label">允许的 Host / IP（每行一个）</span>
            <textarea
              class="mk-field__textarea ac-textarea"
              rows="2"
              :value="policy.privateNetworkHosts.join('\n')"
              @input="policy.privateNetworkHosts = splitLines(($event.target as HTMLTextAreaElement).value); markDirty()"
              placeholder="192.168.1.20"
            ></textarea>
          </label>
        </div>
      </section>

      <div class="ac-side-stack">
        <section v-if="isLive && registrationEnabled !== null" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">新用户注册</h3>
          </div>
          <div class="ac-body ac-policy__item">
            <MkSwitch
              :model-value="registrationEnabled"
              :busy="registrationBusy"
              aria-label="允许新用户自助注册"
              :state-text="registrationEnabled ? '任何人均可注册' : '仅管理员创建'"
              :title="registrationEnabled ? '关闭后新账号只能由管理员手动创建' : '开放后任何人可自助注册账号'"
              @update:model-value="setRegistration"
            />
          </div>
        </section>

        <section v-if="isLive && registerIpQuotaEnabled !== null" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">{{ IP_QUOTA_TITLE }}</h3>
          </div>
          <div class="ac-body ac-policy__item">
            <div class="ac-quota-row">
              <MkSwitch
                :model-value="registerIpQuotaEnabled"
                :busy="quotaBusy"
                :aria-label="IP_QUOTA_TITLE"
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
            </div>
            <span class="ac-policy__hint">同一公网出口 IP 24 小时内最多注册 {{ quotaInput || 5 }} 个账号（批量注册风险出现时再开）</span>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkSwitch from '@/components/mk/MkSwitch.vue'
import { toast } from '@/utils/toast'
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

/* 文案单源（R6 复读单源化）：卡标题与开关 aria-label 共用一份 */
const IP_QUOTA_TITLE = '单 IP 每日注册配额'

/* ---------- 访问来源与私有网络（策略组，一次保存） ---------- */
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

const ACCESS_OPTIONS = [
  { id: 'loopback' as const, label: '仅本机', sub: 'localhost / 127.0.0.1' },
  { id: 'private' as const, label: '私有网段（推荐）', sub: '本机 + RFC1918 局域网' },
  { id: 'any' as const, label: '不限制', sub: '不建议用于公网' },
]
function setAccessMode(mode: 'loopback' | 'private' | 'any'): void {
  if (policy.adminAccessMode === mode) return
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
  const n = ACCESS_OPTIONS.length
  const cur = ACCESS_OPTIONS.findIndex((o) => o.id === policy.adminAccessMode)
  const from = cur >= 0 ? cur : 0
  let next = from
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (from + 1) % n
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (from - 1 + n) % n
  else if (e.key === 'Home') next = 0
  else next = n - 1
  e.preventDefault()
  setAccessMode(ACCESS_OPTIONS[next].id)
  void nextTick(() => accessEls.value[next]?.focus())
}

async function savePolicy(): Promise<void> {
  if (saving.value || !policyDirty.value) return
  // 高风险确认：开放公网访问需二次确认
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

/* ---------- 注册开关（高风险，二次确认） ---------- */
const registrationBusy = ref(false)
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
watch(
  () => registerIpDailyQuota.value,
  (v) => { if (typeof v === 'number' && v >= 1 && v <= 100) quotaInput.value = v },
  { immediate: true },
)
const quotaEnabledText = computed(() =>
  registerIpQuotaEnabled.value ? `已启用 · 每 IP 每日 ${quotaInput.value} 个` : '未启用（不限制注册数量）',
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
    toast.success(enabled ? `配额已启用：每 IP 每日 ${quota} 个` : '配额已关闭，注册不再限制数量')
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    quotaBusy.value = false
  }
}
</script>

<style scoped>
/* 左一右二（2026-10-15 用户重组）：左卡管「谁能连进来」（入站来源 + 出站目标两段），
   右列两张小卡管「谁能注册进来」——各只有一个开关，平铺成宫格会把左卡挤成半屏空白。
   2026-10-25 拆页后右列内容更少，比例从 1.35:1 收到 1.6:1，让右列两张窄卡不拉得过宽；
   ≤1100px 回落单列。 */
.acl-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
}
.ac-side-stack { display: grid; gap: 12px; align-content: start; min-width: 0; }
/* 左卡与右列等高：右列两张卡叠起来比左卡矮时，左卡底部会拖出一块空；反过来也一样。
   用 grid 的 stretch（默认）让左卡撑满行高，右列自身按内容排、不拉伸。 */
@media (max-width: 1100px) {
  .acl-grid { grid-template-columns: minmax(0, 1fr); }
}

/* 卡内内容容器：统一内边距与间距（与模型页同一语言） */
.ac-body { display: grid; gap: 14px; padding: 4px 16px 16px; }
.ac-body .mk-field { margin: 0; min-width: 0; }
.ac-policy__item { min-width: 0; }
/* 同一张卡的两段（入站 / 出站）之间用虚线分层，不另起卡 */
.ac-policy__item--sep { border-top: 1px dashed var(--mk-line); padding-top: 14px; }
.ac-policy__hint { font-size: var(--mk-fs-micro); color: var(--mk-faint); line-height: 1.55; display: block; }
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
.ac-radio__mark { flex: none; line-height: 1; }
.ac-radio__text { display: grid; gap: 0; min-width: 0; }
.ac-radio__sub { color: var(--mk-muted); font-weight: 500; }
.ac-radio[aria-checked='true'] .ac-radio__sub { color: inherit; opacity: 0.82; }

/* 配额输入行：开关 + 数字 + 单位同行 */
.ac-quota-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ac-quota-field { display: inline-flex; align-items: center; gap: 8px; }
.ac-quota-field .mk-field__label { margin: 0; }
.ac-quota-field .mk-field__input { width: 76px; text-align: center; }
.ac-quota-field em { font-style: normal; color: var(--mk-faint); }

.ac-group__title { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-ink); }
.ac-textarea { resize: vertical; font-size: var(--mk-fs-micro); min-height: 0; }
</style>
