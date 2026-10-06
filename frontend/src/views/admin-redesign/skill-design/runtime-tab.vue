<template>
  <!-- 运行时：路由与可靠性配置 -->
  <div class="sdp-pane">
    <div class="sdp-notice">
      <strong>路由、可靠性与生成参数</strong>
      配置 endpoint / model 路由 / 超时 / 逻辑重试 / 参数覆盖 / 兜底链。
      生成参数默认来自 ACTIVE Prompt（File-as-Truth），本页可逐字段覆盖；生效值与来源见上方「生成参数」投影。
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
        <span class="sdp-chiprow__label">生成参数（生效值）</span>
        <span class="sdp-chip sdp-chip--amber">T=<b class="mono">{{ generationParams?.temperature ?? '—' }}</b><em class="sdp-chip__src">{{ sourceLabel('temperature') }}</em></span>
        <span class="sdp-chip sdp-chip--amber">topP=<b class="mono">{{ generationParams?.topP ?? '—' }}</b><em class="sdp-chip__src">{{ sourceLabel('topP') }}</em></span>
        <span class="sdp-chip sdp-chip--amber">Max=<b class="mono">{{ generationParams?.maxTokens ?? '—' }}</b><em class="sdp-chip__src">{{ sourceLabel('maxTokens') }}</em></span>
        <span class="sdp-chip">{{ generationParams?.model || '继承路由模型' }}</span>
      </div>
      <div class="sdp-chiprow">
        <span class="sdp-chiprow__label">兜底链</span>
        <span v-if="fallbackChain.length" class="sdp-chip">{{ fallbackChain.join(' → ') }}</span>
        <span v-else class="sdp-chip">未配置（用模型注册表默认链）</span>
        <button type="button" class="mk-link" :disabled="probing || !rtForm.enabled" @click="probeChannel">
          {{ probing ? '探测中…' : '探测当前通道可用模型' }}
        </button>
        <span v-if="probeMsg" class="sdp-chip" :class="probeErr ? 'sdp-chip--danger' : 'sdp-chip--ok'">{{ probeMsg }}</span>
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
          <span>模型（留空继承）<em>可填模型 id、provider/model 限定式或别名；候选来自模型目录</em></span>
          <input v-model="rtForm.model" class="mk-input mono" :disabled="!rtForm.enabled" placeholder="继承 Agent / 平台默认" list="rt-model-options" />
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
        <strong>参数覆盖（覆盖 ACTIVE Prompt 默认值）</strong>
        <span>每字段三选：继承（File-as-Truth 默认）/ 覆盖（写入本表，即时生效）。清空全部覆盖=恢复继承。</span>
      </div>

      <div class="sdp-form__grid">
        <label class="sdp-field">
          <span>temperature</span>
          <select v-model="paramT.mode" class="mk-input" :disabled="!rtForm.enabled">
            <option value="inherit">继承 ACTIVE Prompt</option>
            <option value="override">覆盖</option>
          </select>
        </label>
        <label v-if="paramT.mode === 'override'" class="sdp-field">
          <span>temperature 值（0-2）</span>
          <input v-model.number="paramT.value" type="number" min="0" max="2" step="0.1" class="mk-input mono" :disabled="!rtForm.enabled" />
        </label>
        <label class="sdp-field">
          <span>topP</span>
          <select v-model="paramTopP.mode" class="mk-input" :disabled="!rtForm.enabled">
            <option value="inherit">继承（ACTIVE Prompt 无此字段时不发送）</option>
            <option value="override">覆盖</option>
          </select>
        </label>
        <label v-if="paramTopP.mode === 'override'" class="sdp-field">
          <span>topP 值（0-1）</span>
          <input v-model.number="paramTopP.value" type="number" min="0.01" max="1" step="0.05" class="mk-input mono" :disabled="!rtForm.enabled" />
        </label>
        <label class="sdp-field">
          <span>maxTokens（输出预算）</span>
          <select v-model="paramMax.mode" class="mk-input" :disabled="!rtForm.enabled">
            <option value="inherit">继承 ACTIVE Prompt</option>
            <option value="override">覆盖</option>
          </select>
        </label>
        <label v-if="paramMax.mode === 'override'" class="sdp-field">
          <span>maxTokens 值（256-131072）</span>
          <input v-model.number="paramMax.value" type="number" min="256" max="131072" step="1000" class="mk-input mono" :disabled="!rtForm.enabled" />
        </label>
      </div>

      <div class="sdp-divider">
        <strong>失败处理与模型兜底</strong>
        <span>逻辑重试独立于模型覆盖；传输重试由平台统一管理；兜底链最多 2 跳、同 tier、同供应商（降级不换端点），保存时校验通道可用性。</span>
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
        <div class="sdp-field">
          <span>兜底链（最多 2 个候选）<em>留空=用模型注册表默认链；空数组保存=显式无链</em></span>
          <div class="sdp-fallback-editor">
            <span v-for="m in fallbackChain" :key="m" class="sdp-chip">{{ m }}<button type="button" class="mk-link mk-link--danger" :disabled="!rtForm.enabled" @click="removeFallback(m)">×</button></span>
            <input v-model="newFallback" class="mk-input mono" placeholder="模型 id，回车添加" list="rt-model-options" :disabled="!rtForm.enabled || fallbackChain.length >= 2" @keydown.enter.prevent="addFallback" />
            <button type="button" class="mk-btn" :disabled="!rtForm.enabled || fallbackChain.length >= 2" @click="addFallback">添加</button>
          </div>
        </div>
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

    <!-- 模型目录候选：模型输入与兜底链输入共用（带「供应商 · tier」标注） -->
    <datalist id="rt-model-options">
      <option v-for="o in catalogOptions" :key="`cat-${o.value}`" :value="o.value" :label="o.label" />
    </datalist>
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
import { useModelCatalog } from '@/composables/useModelCatalog'

// 模型目录候选（File-as-Truth llm-providers.json）：模型输入与兜底链输入共用的 datalist；
// 加载失败静默降级为空目录（输入框退化为自由文本，不影响配置）
const { options: catalogOptions, load: loadModelCatalog } = useModelCatalog()
loadModelCatalog()

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
const generationParams = ref<{ model?: string | null; temperature?: number | null; topP?: number | null; maxTokens?: number | null; sources?: Record<string, string>; owner?: string } | null>(null)

// ── 参数覆盖（paramOverrides）：每字段「继承 / 覆盖」三选 ──
type ParamMode = 'inherit' | 'override'
interface ParamField { mode: ParamMode; value: number | null }
const paramT = ref<ParamField>({ mode: 'inherit', value: null })
const paramTopP = ref<ParamField>({ mode: 'inherit', value: null })
const paramMax = ref<ParamField>({ mode: 'inherit', value: null })
// 加载时该 skill 是否已有覆盖（决定保存时是发对象、发 null 清空、还是不发）
const hadParamOverrides = ref(false)
// ── 兜底链（fallbackChain）：[]=显式无链；未动过则不发送（继承 registry 默认链）──
const fallbackChain = ref<string[]>([])
const fallbackTouched = ref(false)
const newFallback = ref('')
const probing = ref(false)
const probeMsg = ref('')
const probeErr = ref(false)

const effectiveLogicalRetries = computed(() =>
  logicalRetryMode.value === 'inherit' ? platformLogicalRetries.value : logicalRetryMode.value === 'disabled' ? 0 : customLogicalRetries.value
)
const thinkingLabel = computed(() =>
  rtForm.value.thinkingMode === 'enabled' ? '开启' : rtForm.value.thinkingMode === 'disabled' ? '关闭' : '继承/默认'
)
const sourceLabel = (k: string) => generationParams.value?.sources?.[k] || '—'

/** 通道探测：用该 skill 已保存的 endpoint+key 拉可用模型列表 */
async function probeChannel() {
  if (probing.value) return
  probing.value = true
  probeMsg.value = ''
  probeErr.value = false
  try {
    const res = await adminSkillsApi.probeSkillChannel(props.skillId)
    const d = res.data?.data as { ok: boolean; count?: number; models?: string[]; message?: string } | undefined
    if (d?.ok) probeMsg.value = `通道可用模型 ${d.count} 个：${(d.models || []).join(', ')}`
    else { probeErr.value = true; probeMsg.value = d?.message || '探测失败' }
  } catch (e) {
    probeErr.value = true
    probeMsg.value = `探测失败：${errText(e)}`
  } finally {
    probing.value = false
  }
}

/** 兜底链编辑 */
function addFallback() {
  const m = newFallback.value.trim()
  if (!m) return
  if (fallbackChain.value.includes(m)) { newFallback.value = ''; return }
  if (fallbackChain.value.length >= 2) return
  fallbackChain.value = [...fallbackChain.value, m]
  fallbackTouched.value = true
  newFallback.value = ''
}
function removeFallback(m: string) {
  fallbackChain.value = fallbackChain.value.filter(x => x !== m)
  fallbackTouched.value = true
}

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
  paramT.value = { mode: 'inherit', value: null }
  paramTopP.value = { mode: 'inherit', value: null }
  paramMax.value = { mode: 'inherit', value: null }
  hadParamOverrides.value = false
  fallbackChain.value = []
  fallbackTouched.value = false
  newFallback.value = ''
  probeMsg.value = ''
  probeErr.value = false
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
    const raw = (skillRes.value.data?.data || null) as (RuntimeForm & { maxLogicalRetries?: number | null; paramOverrides?: string | null; fallbackChain?: string | null; generationParams?: typeof generationParams.value }) | null
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
    // 参数覆盖：JSON 原文 → 每字段 mode/value；缺字段=继承
    let po: Record<string, number> = {}
    if (raw?.paramOverrides) { try { po = JSON.parse(raw.paramOverrides) || {} } catch { po = {} } }
    hadParamOverrides.value = Object.keys(po).length > 0
    paramT.value = po.temperature != null ? { mode: 'override', value: po.temperature } : { mode: 'inherit', value: null }
    paramTopP.value = po.topP != null ? { mode: 'override', value: po.topP } : { mode: 'inherit', value: null }
    paramMax.value = po.maxTokens != null ? { mode: 'override', value: po.maxTokens } : { mode: 'inherit', value: null }
    // 兜底链：JSON 原文 → string[]（未配置=registry 默认链）
    let fc: string[] = []
    if (raw?.fallbackChain) { try { fc = (JSON.parse(raw.fallbackChain) || []).filter((x: unknown) => typeof x === 'string') } catch { fc = [] } }
    fallbackChain.value = fc
    fallbackTouched.value = false
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
    // 参数覆盖：有 override 发对象；本有覆盖但被清空 → 发 null 显式清空；本就无覆盖且无 override → 不发。
    // 覆盖档必须给有效数字：v-model.number 清空得 ''，而 `'' != null` 为真、Number('') === 0——
    // temperature 会被静默写成 0（0 在合法区间内，直接生效），topP/maxTokens 则发出非法 0 让后端 400，
    // 用户看到的是接口报错而不是「这项没填」。空值一律拦住，让用户明确切回「继承」。
    let invalid = false
    const overrideNum = (label: string, mode: string, value: unknown): number | null => {
      if (mode !== 'override') return null
      const n = normNum(value)
      if (n == null) {
        invalid = true
        rtErr.value = true
        rtMsg.value = `${label} 的覆盖值未填（或不是数字）：清空该项请把模式切回「继承」，留空保存会按 0 提交。`
        return null
      }
      return n
    }
    const tVal = overrideNum('temperature', paramT.value.mode, paramT.value.value)
    const topPVal = overrideNum('topP', paramTopP.value.mode, paramTopP.value.value)
    const maxVal = overrideNum('maxTokens', paramMax.value.mode, paramMax.value.value)
    if (invalid) return
    const overrides: Record<string, number> = {}
    if (tVal != null) overrides.temperature = tVal
    if (topPVal != null) overrides.topP = topPVal
    if (maxVal != null) overrides.maxTokens = maxVal
    const payload: Record<string, unknown> = {
      tier: rtForm.value.tier,
      model: rtForm.value.model || undefined,
      thinkingMode: rtForm.value.thinkingMode,
      reasoningEffort: rtForm.value.thinkingMode === 'disabled' ? 'default' : rtForm.value.reasoningEffort,
      requestTimeoutMs: rtForm.value.enabled ? normNum(rtForm.value.requestTimeoutMs) : null,
      maxLogicalRetries: logicalRetryMode.value === 'inherit' ? null : logicalRetryMode.value === 'disabled' ? 0 : normNum(customLogicalRetries.value),
      enabled: rtForm.value.enabled
    }
    if (Object.keys(overrides).length > 0) payload.paramOverrides = overrides
    else if (hadParamOverrides.value) payload.paramOverrides = null
    if (fallbackTouched.value) payload.fallbackChain = fallbackChain.value
    await adminSkillsApi.updateSkillModelConfig(props.skillId, payload)
    rtErr.value = false
    rtMsg.value = '已更新（生成参数覆盖/兜底链同表管理，生效值见上方投影）'
    fallbackTouched.value = false
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
  border-radius: var(--mk-radius-xl);
  background: var(--mk-blue-bg);
  border: 1px solid #dbe7f6;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
}
.sdp-notice strong { margin-right: 6px; }
.sdp-notice code { font-size: var(--mk-fs-micro); }
.sdp-chiprows { display: grid; gap: 8px; }
.sdp-chiprow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
}
.sdp-chiprow__label { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-muted); margin-right: 4px; }
.sdp-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--mk-surface-2);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
}
.sdp-chip b { color: var(--mk-ink); font-weight: 600; }
.sdp-chip__src { font-style: normal; font-size: var(--mk-fs-micro); color: var(--mk-faint); margin-left: 2px; }
.sdp-chip--ok { background: var(--mk-green-bg, #e8f5ec); color: var(--mk-green, #20704a); }
.sdp-chip--danger { background: var(--mk-red-bg, #fdecec); color: var(--mk-red, #b3372f); }
.sdp-fallback-editor { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.sdp-fallback-editor .mk-input { flex: 1; min-width: 200px; }
.mk-link--danger { color: var(--mk-red, #b3372f); }
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
.sdp-field > span { font-size: var(--mk-fs-micro); color: var(--mk-muted); font-weight: 600; }
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
.sdp-divider strong { font-size: var(--mk-fs-micro); }
.sdp-divider span { color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.sdp-form__footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}
.sdp-form__msg { margin: 0 auto 0 0; font-size: var(--mk-fs-micro); color: var(--mk-green); font-weight: 600; }
.sdp-form__msg.is-err { color: var(--mk-red); }
.sdp-btn--danger { color: var(--mk-red); border-color: rgba(220, 38, 38, 0.35); background: transparent; }
.sdp-btn--danger:hover { background: var(--mk-red-bg); }
.sdp-error {
  padding: 10px 12px;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-red-bg);
  border: 1px solid rgba(220, 38, 38, 0.3);
  color: var(--mk-red);
  font-size: var(--mk-fs-micro);
}

/* 4K：字号跟随壳层放大 */
@media (min-width: 3600px) {
  .sdp-chip { font-size: var(--mk-fs-body); padding: 4px 12px; }
  .sdp-notice { font-size: var(--mk-fs-body); padding: 14px 18px; }
  .sdp-notice code { font-size: var(--mk-fs-body); }
  .sdp-chiprow { padding: 14px 16px; }
  .sdp-chiprow__label { font-size: var(--mk-fs-body); }
  .sdp-form { padding: 18px 20px; gap: 14px; }
  .sdp-field > span { font-size: var(--mk-fs-body); }
  .sdp .mk-input { font-size: var(--mk-fs-emphasis); padding: 12px 15px; }
  .sdp-divider strong { font-size: var(--mk-fs-emphasis); }
  .sdp-divider span { font-size: var(--mk-fs-body); }
  .sdp-form__msg { font-size: var(--mk-fs-body); }
}

/* 暗色模式 */
[data-theme='dark'] .sdp-chiprow { background: var(--wf-bg-subtle); }

</style>