<template>
  <!-- 注册设置弹层（2026-11-11 从「系统设置 → 访问与注册」迁到用户账号）：
       注册开的是业务层账号入口，与网络策略无关；放在用户页，紧挨着「新建用户」，
       「关掉注册后只能由管理员建号」这条因果关系才在同一个屏上。 -->
  <Teleport to="body">
    <div v-if="open" ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel rs" role="dialog" aria-label="注册设置">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">注册设置</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="close">✕</button>
        </div>

        <div class="mk-modal__body">
          <div v-if="settingsUnknown" class="mk-alert mk-alert--row" role="alert">
            <span class="mk-alert__msg">注册设置读取失败，开关状态未知</span>
            <button type="button" class="mk-alert__btn" @click="retrySettings">重试</button>
          </div>
          <div class="rs-row">
            <div class="rs-row__text">
              <b>新用户注册</b>
              <p>允许访客在登录页自行注册账号。</p>
            </div>
            <MkSwitch
              :model-value="registrationEnabled === true"
              :busy="registrationBusy"
              :disabled="settingsUnknown"
              aria-label="新用户注册"
              :state-text="settingsUnknown ? '读取失败' : registrationStateText"
              @update:model-value="setRegistration"
            />
          </div>

          <div class="rs-row">
            <div class="rs-row__text">
              <b>{{ IP_QUOTA_TITLE }}</b>
              <p>防止脚本批量注册账号。</p>
              <label class="rs-quota" :class="{ 'rs-quota--off': !registerIpQuotaEnabled }">
                <span class="mk-field__label">每日上限</span>
                <template v-if="registerIpQuotaEnabled">
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
                </template>
                <span v-else class="rs-quota__off">{{ settingsUnknown ? '读取失败' : '当前不限制' }}</span>
              </label>
              <button
                v-if="registerIpQuotaEnabled && quotaDirty"
                type="button"
                class="mk-btn mk-btn--sm mk-btn--primary"
                :disabled="quotaBusy"
                @click="saveQuota(registerIpQuotaEnabled === true, quotaInput)"
              >保存上限</button>
            </div>
            <MkSwitch
              :model-value="registerIpQuotaEnabled === true"
              :busy="quotaBusy"
              :disabled="settingsUnknown"
              :aria-label="IP_QUOTA_TITLE"
              @update:model-value="setQuotaEnabled"
            />
          </div>
        </div>

        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="close">关闭</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import MkSwitch from '@/components/mk/MkSwitch.vue'
import { authAPI } from '@/api/auth'
import { toast } from '@/utils/toast'
import { errMsg, loadLiveData, registrationEnabled, registerIpQuotaEnabled, registerIpDailyQuota, updateRegistrationSetting, updateRegisterIpQuotaSetting } from './live'
import { askConfirm } from './useConfirm'
import { useEscape } from './useEscape'
import { useMaskClose, useOverlay } from './useOverlay'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>()

const IP_QUOTA_TITLE = '单 IP 每日注册配额'

/** 未加载/读取失败时两个开关的值都是 null：不能按 false 渲染成「关闭 / 不限制」 */
const settingsUnknown = computed(() => registrationEnabled.value === null || registerIpQuotaEnabled.value === null)
function retrySettings(): void {
  void loadLiveData()
}

const maskRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => props.open), panelRef)
useMaskClose(maskRef, close)
useEscape(() => props.open, close)

function close(): void {
  emit('update:open', false)
}

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

/* 只在打开时问一次「注册实际可用吗」：关着的弹层不占用户页的一次请求 */
watch(
  () => props.open,
  (v) => { if (v) void loadRegistrationStatus() },
  { immediate: true },
)
</script>

<style scoped>
.rs { max-width: 560px; }
.rs-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 14px 0;
}
.rs-row + .rs-row { border-top: 1px solid var(--mk-line); }
.rs-row__text { display: grid; gap: 4px; min-width: 0; }
.rs-row__text b { font-size: var(--mk-fs-body); color: var(--mk-ink); }
.rs-row__text p { margin: 0; font-size: var(--mk-fs-micro); line-height: 1.6; color: var(--mk-muted); }
.rs-quota { display: inline-flex; align-items: center; gap: 8px; margin-top: 4px; }
.rs-quota .mk-field__input { width: 88px; }
.rs-quota em { font-style: normal; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.rs-quota--off { opacity: 0.55; }
.rs-quota__off { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
</style>
