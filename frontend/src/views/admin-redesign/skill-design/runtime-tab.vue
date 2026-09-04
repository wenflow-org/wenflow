<template>
  <!-- 运行时：路由与可靠性配置 -->
  <div class="sdp-pane">
    <div class="sdp-notice">
      <strong>路由与可靠性</strong>
      只配置 endpoint / model 路由 / 超时 / 逻辑重试；温度与 Max Tokens 由 ACTIVE Prompt 管理。
    </div>

    <div class="sdp-chiprows">
      <div class="sdp-chiprow">
        <span class="sdp-chiprow__label">路由层</span>
        <span class="mk-badge" :class="rtForm.enabled ? 'mk-badge--ok' : 'mk-badge--muted'">
          {{ rtForm.enabled ? '独立路由' : '继承上层 / 平台默认' }}
        </span>
        <span class="sdp-chip">超时 <b class="mono">{{ rtForm.requestTimeoutMs ? Math.round(rtForm.requestTimeoutMs / 1000) + 's' : '继承' }}</b></span>
        <span class="sdp-chip">Logical 预算 <b class="mono">{{ effectiveLogicalRetries }}</b> 次</span>
        <span class="sdp-chip">思考 <b class="mono">{{ thinkingLabel }}</b></span>
      </div>
      <div class="sdp-chiprow">
        <span class="sdp-chiprow__label">生成参数（只读）</span>
        <span class="sdp-chip sdp-chip--amber">T=<b class="mono">{{ generationParams?.temperature ?? '—' }}</b></span>
        <span class="sdp-chip sdp-chip--amber">Max=<b class="mono">{{ generationParams?.maxTokens ?? '—' }}</b></span>
        <span class="sdp-chip">{{ generationParams?.model || '继承路由模型' }}</span>
        <span class="sdp-chip">来源={{ generationParams?.sources?.temperature || generationParams?.owner || 'ACTIVE Prompt' }}</span>
      </div>
    </div>

    <div class="sdp-form mk-card">
      <div v-if="rtLoadFailed" class="sdp-error">运行时配置加载失败，已重置为默认值。<button type="button" class="mk-link" @click="loadRuntime">重试</button></div>
      <label class="sdp-field sdp-field--check">
        <input v-model="rtForm.enabled" type="checkbox" />
        <span>独立配置<em>关闭后继承调用 Agent 或平台默认</em></span>
      </label>
      <div class="sdp-form__grid">
        <label class="sdp-field">
          <span>模型层级</span>
          <select v-model="rtForm.tier" class="mk-input" :disabled="!rtForm.enabled">
            <option value="chat">chat</option>
            <option value="reasoning">reasoning</option>
          </select>
        </label>
        <label class="sdp-field">
          <span>模型（留空继承）</span>
          <input v-model="rtForm.model" class="mk-input mono" :disabled="!rtForm.enabled" placeholder="继承 Agent / 平台默认" />
        </label>
        <label class="sdp-field">
          <span>思考模式</span>
          <select v-model="rtForm.thinkingMode" class="mk-input" :disabled="!rtForm.enabled">
            <option value="default">跟随继承值 / 模型默认</option>
            <option value="enabled">开启</option>
            <option value="disabled">关闭</option>
          </select>
        </label>
        <label class="sdp-field">
          <span>思考强度</span>
          <select v-model="rtForm.reasoningEffort" class="mk-input" :disabled="!rtForm.enabled || rtForm.thinkingMode === 'disabled'">
            <option value="default">跟随继承值 / 模型默认</option>
            <option value="low">low</option>
            <option value="high">high</option>
            <option value="max">max</option>
          </select>
        </label>
        <label class="sdp-field">
          <span>请求超时（ms）</span>
          <input v-model.number="rtForm.requestTimeoutMs" type="number" min="10000" max="300000" step="10000" class="mk-input" :disabled="!rtForm.enabled" placeholder="继承" />
        </label>
      </div>

      <div class="sdp-divider">
        <strong>失败处理与重试</strong>
        <span>逻辑重试独立于模型覆盖；传输重试由平台统一管理。</span>
      </div>

      <div class="sdp-form__grid">
        <label class="sdp-field">
          <span>Logical Retry（平台默认 {{ platformLogicalRetries }} 次）</span>
          <select v-model="logicalRetryMode" class="mk-input">
            <option value="inherit">继承平台默认</option>
            <option value="disabled">禁用</option>
            <option value="custom" :disabled="platformLogicalRetries <= 0">自定义</option>
          </select>
        </label>
        <label v-if="logicalRetryMode === 'custom'" class="sdp-field">
          <span>最大逻辑重试次数</span>
          <input v-model.number="customLogicalRetries" type="number" :min="1" :max="platformLogicalRetries" step="1" class="mk-input" />
        </label>
        <label class="sdp-field">
          <span>业务回退</span>
          <input class="mk-input" model-value="由 Skill 代码定义" disabled />
        </label>
      </div>

      <div class="sdp-form__footer">
        <p v-if="rtMsg" class="sdp-form__msg" :class="{ 'is-err': rtErr }">{{ rtMsg }}</p>
        <button type="button" class="mk-btn sdp-btn--danger" :disabled="rtSaving" @click="resetRuntime">恢复默认</button>
        <button type="button" class="mk-btn" :disabled="rtSaving" @click="loadRuntime">刷新</button>
        <button type="button" class="mk-btn mk-btn--primary" :disabled="rtSaving" @click="saveRuntime">
          {{ rtSaving ? '保存中…' : '保存配置' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 运行时 tab：路由 / 可靠性表单（独立配置开关 / 模型层级 / 思考模式 / 超时 / 逻辑重试 / 业务回退只读）
 */
import { computed, ref, watch } from 'vue'
import { adminPlatformSettingsApi, adminSkillsApi } from '@/api/adminApi'
import { askConfirm } from '../useConfirm'
import { errText } from './sdp-shared'

const props = defineProps<{ skillId: string; refreshTick: number }>()

interface RuntimeForm {
  tier: 'chat' | 'reasoning'
  model: string
  thinkingMode: 'default' | 'enabled' | 'disabled'
  reasoningEffort: 'default' | 'low' | 'high' | 'max'
  requestTimeoutMs: number | null
  enabled: boolean
}
const rtForm = ref<RuntimeForm>({
  tier: 'chat',
  model: '',
  thinkingMode: 'default',
  reasoningEffort: 'default',
  requestTimeoutMs: null,
  enabled: false
})
const rtSaving = ref(false)
const rtMsg = ref('')
const rtErr = ref(false)
const rtLoadFailed = ref(false)
const platformLogicalRetries = ref(1)
const logicalRetryMode = ref<'inherit' | 'disabled' | 'custom'>('inherit')
const customLogicalRetries = ref(1)
const generationParams = ref<{ model?: string | null; temperature?: number | null; maxTokens?: number | null; sources?: Record<string, string>; owner?: string } | null>(null)

const effectiveLogicalRetries = computed(() =>
  logicalRetryMode.value === 'inherit' ? platformLogicalRetries.value : logicalRetryMode.value === 'disabled' ? 0 : customLogicalRetries.value
)
const thinkingLabel = computed(() =>
  rtForm.value.thinkingMode === 'enabled' ? '开启' : rtForm.value.thinkingMode === 'disabled' ? '关闭' : '继承/默认'
)

watch(
  () => rtForm.value.thinkingMode,
  (m) => {
    if (m === 'disabled') rtForm.value.reasoningEffort = 'default'
  }
)

/** 默认运行时表单（与初始定义一致）；切 skill / 404 时显式回退，避免残留上一个 skill 的数据 */
function resetRtForm() {
  rtForm.value = {
    tier: 'chat',
    model: '',
    thinkingMode: 'default',
    reasoningEffort: 'default',
    requestTimeoutMs: null,
    enabled: false
  }
  logicalRetryMode.value = 'inherit'
  customLogicalRetries.value = 1
}

async function loadRuntime() {
  const id = props.skillId
  rtLoadFailed.value = false
  const [skillRes, relRes] = await Promise.allSettled([
    adminSkillsApi.getSkillModelConfig(id),
    adminPlatformSettingsApi.getReliabilitySettings()
  ])
  if (id !== props.skillId) return
  if (skillRes.status === 'rejected') rtLoadFailed.value = true
  if (relRes.status === 'fulfilled') {
    platformLogicalRetries.value = Number(relRes.value.data?.data?.settings?.maxLogicalRetries ?? 1)
  }
  if (skillRes.status === 'fulfilled') {
    const raw = (skillRes.value.data?.data || null) as (RuntimeForm & { maxLogicalRetries?: number | null; generationParams?: typeof generationParams.value }) | null
    generationParams.value = raw?.generationParams || null
    rtForm.value = {
      tier: raw?.tier === 'reasoning' ? 'reasoning' : 'chat',
      model: raw?.model || '',
      thinkingMode: raw?.thinkingMode || 'default',
      reasoningEffort: raw?.reasoningEffort || 'default',
      requestTimeoutMs: raw?.requestTimeoutMs ?? null,
      enabled: raw?.enabled === true
    }
    logicalRetryMode.value = raw?.maxLogicalRetries == null ? 'inherit' : raw.maxLogicalRetries === 0 ? 'disabled' : 'custom'
    customLogicalRetries.value = raw?.maxLogicalRetries && raw.maxLogicalRetries > 0 ? Math.min(raw.maxLogicalRetries, platformLogicalRetries.value || 1) : 1
  } else {
    // 无独立配置（404）等失败：显式重置为默认值，不残留上一 skill
    resetRtForm()
    generationParams.value = null
  }
}

async function saveRuntime() {
  if (rtSaving.value) return
  rtSaving.value = true
  rtMsg.value = ''
  // v-model.number 空输入会得到 ''/NaN：保存前归一为 null，避免 400
  const normNum = (v: unknown): number | null => {
    if (v == null || v === '' || !Number.isFinite(Number(v))) return null
    return Number(v)
  }
  try {
    await adminSkillsApi.updateSkillModelConfig(props.skillId, {
      tier: rtForm.value.tier,
      model: rtForm.value.model || undefined,
      thinkingMode: rtForm.value.thinkingMode,
      reasoningEffort: rtForm.value.thinkingMode === 'disabled' ? 'default' : rtForm.value.reasoningEffort,
      requestTimeoutMs: rtForm.value.enabled ? normNum(rtForm.value.requestTimeoutMs) : null,
      maxLogicalRetries: logicalRetryMode.value === 'inherit' ? null : logicalRetryMode.value === 'disabled' ? 0 : normNum(customLogicalRetries.value),
      enabled: rtForm.value.enabled
    })
    rtErr.value = false
    rtMsg.value = '路由/可靠性已更新（生成参数仍由 ACTIVE Prompt 管理）'
    await loadRuntime()
  } catch (e) {
    rtErr.value = true
    rtMsg.value = `保存失败：${errText(e)}`
  } finally {
    rtSaving.value = false
  }
}

async function resetRuntime() {
  if (rtSaving.value) return
  const ok = await askConfirm({
    title: '恢复默认配置',
    message: '确定恢复该 Skill 的默认模型配置吗？\n独立配置将被删除，恢复为继承上层 / 平台默认。',
    confirmText: '恢复默认'
  })
  if (!ok) return
  rtSaving.value = true
  rtMsg.value = ''
  try {
    await adminSkillsApi.deleteSkillModelConfig(props.skillId)
    rtErr.value = false
    rtMsg.value = '已恢复默认（继承上层 / 平台）'
    await loadRuntime()
  } catch (e) {
    rtErr.value = true
    rtMsg.value = `恢复失败：${errText(e)}`
  } finally {
    rtSaving.value = false
  }
}

/* 切换 skill / 发布后刷新（显式回退避免残留上一 skill 数据） */
watch(
  [() => props.skillId, () => props.refreshTick],
  () => {
    resetRtForm()
    generationParams.value = null
    rtMsg.value = ''
    void loadRuntime()
  },
  { immediate: true }
)
</script>

<style scoped>
.sdp-pane { display: grid; gap: 14px; align-content: start; }
.sdp-notice {
  padding: 9px 14px;
  border-radius: 10px;
  background: #eff6ff;
  border: 1px solid #dbe7f6;
  color: #41516e;
  font-size: 12px;
  line-height: 1.6;
}
.sdp-notice strong { margin-right: 6px; }
.sdp-notice code { font-size: 11px; }
.sdp-chiprows { display: grid; gap: 8px; }
.sdp-chiprow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  background: #fff;
}
.sdp-chiprow__label { font-size: 12px; font-weight: 600; color: var(--mk-muted); margin-right: 4px; }
.sdp-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef2fa;
  color: var(--mk-muted);
  font-size: 10.5px;
  font-weight: 600;
}
.sdp-chip b { color: var(--mk-ink); font-weight: 600; }
.sdp-chip--amber { background: var(--mk-amber-bg); color: var(--mk-amber); }
.sdp-chip--amber b { color: var(--mk-amber); }
.sdp-form { padding: 14px 16px; display: grid; gap: 12px; }
.sdp-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 860px) {
  .sdp-form__grid { grid-template-columns: 1fr; }
}
.sdp-field { display: grid; gap: 5px; }
.sdp-field > span { font-size: 11.5px; color: var(--mk-muted); font-weight: 600; }
.sdp-field > span em { font-style: normal; font-weight: 400; color: var(--mk-faint); margin-left: 6px; }
.sdp-field--check {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sdp-field--check input { width: 15px; height: 15px; accent-color: var(--mk-blue); }
.sdp-divider {
  display: grid;
  gap: 3px;
  padding-top: 12px;
  border-top: 1px solid var(--mk-line);
}
.sdp-divider strong { font-size: 12.5px; }
.sdp-divider span { color: var(--mk-faint); font-size: 11.5px; }
.sdp-form__footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}
.sdp-form__msg { margin: 0 auto 0 0; font-size: 11.5px; color: var(--mk-green); font-weight: 600; }
.sdp-form__msg.is-err { color: var(--mk-red); }
.sdp-btn--danger { color: var(--mk-red); border-color: rgba(220, 38, 38, 0.35); background: transparent; }
.sdp-btn--danger:hover { background: var(--mk-red-bg); }
.sdp-error {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--mk-red-bg);
  border: 1px solid rgba(220, 38, 38, 0.3);
  color: var(--mk-red);
  font-size: 12px;
}

/* 4K：字号跟随壳层放大 */
@media (min-width: 3600px) {
  .sdp-chip { font-size: 16.5px; padding: 4px 12px; }
  .sdp-notice { font-size: 18px; padding: 14px 18px; }
  .sdp-notice code { font-size: 17px; }
  .sdp-chiprow { padding: 14px 16px; }
  .sdp-chiprow__label { font-size: 18px; }
  .sdp-form { padding: 18px 20px; gap: 14px; }
  .sdp-field > span { font-size: 18px; }
  .sdp .mk-input { font-size: 19px; padding: 12px 15px; }
  .sdp-divider strong { font-size: 19px; }
  .sdp-divider span { font-size: 18px; }
  .sdp-form__msg { font-size: 18px; }
}
</style>
