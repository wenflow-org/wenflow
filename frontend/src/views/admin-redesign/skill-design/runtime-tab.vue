<template>
  <!-- 运行时：模型与路由。
       2026-10-19 重排（用户「要重新优化设计，参考模型接入的设计」）：
       ① 页内原本同一套配置渲染了两遍（宿主 SkillDetail 的只读概览 + 本组件的编辑块各一份
          「运行时限制 / 模型配置 / 模型测试」），现在本组件是唯一的编辑入口，宿主只留读数；
       ② 版式对齐「模型与接入」页：一张卡 + 卡头（标题/只读现状/脏时保存钮）+ 卡头正下方一句口径
          + 左右双列（左=填配置，右=顺手验证，≤1100 回落单列）+ 分段（段标题 + 提示）+ 卡尾动作；
       ③ 「运行时限制」独立卡退役：这一页唯一可能出现的限制就是请求超时，它既是下面的可编辑字段、
          又已经出现在「生效值」胶囊里，再单开一张只有一行（或空态）的卡是纯占位。 -->
  <div class="sdp-pane">
    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">模型与路由</h3>
        <!-- 卡头只出「是否为这个 Skill 覆盖了配置」这一个现状；继承规则在下面那句口径里，不复述 -->
        <span class="mk-card__meta">{{ rtForm.enabled ? '独立配置生效' : '未独立配置' }}</span>
        <button
          v-if="dirtyNow"
          type="button"
          class="sdp-card__save"
          :disabled="rtSaving"
          @click="saveRuntime"
        >{{ rtSaving ? '保存中…' : '保存配置' }}</button>
      </div>
      <!-- 口径一条放卡头正下方（卡头只放标题/现状/动作；规则不复述） -->
      <p class="mk-card__note">未覆盖的项继承 Agent 与平台默认，这里只写给这个 Skill 的差异。Prompt 里声明了 model 时，本页模型不参与。</p>

      <div class="sdp-body">
        <div v-if="rtLoadFailed" class="sdp-error">运行时配置加载失败，已重置为默认值。<button type="button" class="mk-link" @click="loadRuntime">重试</button></div>
        <!-- 生效值（只读「所配即所得」）：先回答「现在生效的是什么」，再谈怎么改。
             来源词走 sdp-shared 的人话映射（后端枚举码不直接露给运营） -->
        <div class="sdp-sec">
          <span class="sdp-sec__title">生效值</span>
          <div class="sdp-chips">
            <span class="sdp-chip">超时 <b class="mono">{{ rtForm.requestTimeoutMs ? Math.round(rtForm.requestTimeoutMs / 1000) + 's' : '继承' }}</b></span>
            <span class="sdp-chip">逻辑重试 <b class="mono">{{ effectiveLogicalRetries }}</b> 次</span>
            <span class="sdp-chip">思考 <b class="mono">{{ thinkingLabel }}</b></span>
            <span class="sdp-chip sdp-chip--amber" :title="`来源：${sourceLabel('temperature')}`">T=<b class="mono">{{ generationParams?.temperature ?? '—' }}</b><em class="sdp-chip__src">{{ sourceLabel('temperature') }}</em></span>
            <span class="sdp-chip sdp-chip--amber" :title="`来源：${sourceLabel('topP')}`">topP=<b class="mono">{{ generationParams?.topP ?? '—' }}</b><em class="sdp-chip__src">{{ sourceLabel('topP') }}</em></span>
            <span class="sdp-chip sdp-chip--amber" :title="`来源：${sourceLabel('maxTokens')}`">Max=<b class="mono">{{ generationParams?.maxTokens ?? '—' }}</b><em class="sdp-chip__src">{{ sourceLabel('maxTokens') }}</em></span>
            <span class="sdp-chip" :title="generationParams?.model ? `模型来源：${sourceLabel('model')}` : '按路由表选中，随路由变化'">
              模型 <b class="mono">{{ generationParams?.model || '继承路由模型' }}</b>
              <em v-if="generationParams?.model" class="sdp-chip__src">{{ sourceLabel('model') }}</em>
            </span>
          </div>
        </div>

        <!-- 左右双列（判例：模型与接入的「连接与模型清单」卡）：左=填配置，右=顺手验证 -->
        <div class="sdp-two">
          <div class="sdp-two__col">
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
                <span>模型（留空继承）<em>可填模型 ID 或别名，输入时会提示候选</em></span>
                <input v-model="rtForm.model" class="mk-input mono" :disabled="!rtForm.enabled" placeholder="继承 Agent / 平台默认" list="rt-model-options" />
              </label>
              <label class="sdp-field">
                <span>思考模式</span>
                <select v-model="rtForm.thinkingMode" class="mk-input" :disabled="!rtForm.enabled">
                  <option value="default">{{ INHERIT_DEFAULT_LABEL }}</option>
                  <option value="enabled">开启</option>
                  <option value="disabled">关闭</option>
                </select>
              </label>
              <label class="sdp-field">
                <span>思考强度</span>
                <select v-model="rtForm.reasoningEffort" class="mk-input" :disabled="!rtForm.enabled || rtForm.thinkingMode === 'disabled'">
                  <option value="default">{{ INHERIT_DEFAULT_LABEL }}</option>
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
          </div>

          <!-- 验证列：与「模型与接入」连接卡的右列同一动线——改完档位顺手直发上游测一次 -->
          <div class="sdp-two__col sdp-two__col--test">
            <span class="sdp-sec__title">模型测试<span class="sdp-sec__hint">直发上游，不留记录</span></span>
            <div class="sdp-form__grid sdp-form__grid--stack">
              <label class="sdp-field">
                <span>思考模式</span>
                <select v-model="probeForm.thinkingMode" class="mk-input">
                  <option value="default">跟随配置（{{ thinkingLabel }}）</option>
                  <option value="enabled">开启</option>
                  <option value="disabled">关闭</option>
                </select>
              </label>
              <label class="sdp-field">
                <span>思考强度</span>
                <select v-model="probeForm.reasoningEffort" class="mk-input" :disabled="probeForm.thinkingMode === 'disabled'">
                  <option value="default">跟随配置（{{ cfgEffortLabel }}）</option>
                  <option value="low">low</option>
                  <option value="high">high</option>
                  <option value="max">max</option>
                </select>
              </label>
            </div>
            <div class="sdp-test__act">
              <button type="button" class="mk-btn mk-btn--primary" :disabled="probeRunning" @click="runModelProbe">
                {{ probeRunning ? '探测中…（最长 180s）' : '开始探测' }}
              </button>
              <span v-if="probeError" class="sdp-form__msg is-err">{{ probeError }}</span>
            </div>
            <p v-if="probeResult?.resolved" class="sdp-probe__resolved mono">
              生效：{{ probeResult.resolved.model }} · {{ probeResult.resolved.thinkingMode }} / {{ probeResult.resolved.reasoningEffort }}
            </p>
            <div v-if="probeResult" class="sdp-probe" :class="probeResult.jsonOk === 'ok' ? 'is-ok' : 'is-bad'">
              <div class="sdp-probe__grid">
                <div><span>总耗时</span><strong class="mono">{{ fmtMs(probeResult.durationMs ?? 0) }}</strong></div>
                <div><span>首字 TTFT</span><strong class="mono">{{ probeResult.ttftContentMs != null ? fmtMs(probeResult.ttftContentMs) : '—' }}</strong></div>
                <div><span>JSON</span><strong class="mono">{{ probeResult.jsonOk || '—' }}</strong></div>
                <div><span>输出字符</span><strong class="mono">{{ probeResult.contentChars ?? '—' }}</strong></div>
                <div><span>输出 token</span><strong class="mono">{{ probeResult.completionTokens ?? '—' }}</strong></div>
                <div><span>结束原因</span><strong class="mono">{{ probeResult.finish || '—' }}</strong></div>
              </div>
              <pre v-if="probeResult.contentPreview" class="sdp-probe__pre mono">{{ probeResult.contentPreview }}</pre>
            </div>
            <span class="sdp-sec__hint">探测用线上生效 Prompt 与当前路由直发上游，看改档位后的真实延迟 / JSON / token。探测不保存、不改配置。</span>
          </div>
        </div>

        <div class="sdp-sec">
          <span class="sdp-sec__title">参数覆盖<span class="sdp-sec__hint">覆盖当前 Prompt 的默认值，未覆盖的字段继续继承</span></span>
          <div class="sdp-form__grid">
            <label class="sdp-field">
              <span>temperature</span>
              <select v-model="paramT.mode" class="mk-input" :disabled="!rtForm.enabled">
                <option value="inherit">{{ INHERIT_PROMPT_LABEL }}</option>
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
                <option value="inherit">继承（当前 Prompt 无此字段时不发送）</option>
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
                <option value="inherit">{{ INHERIT_PROMPT_LABEL }}</option>
                <option value="override">覆盖</option>
              </select>
            </label>
            <label v-if="paramMax.mode === 'override'" class="sdp-field">
              <span>maxTokens 值（256-131072）</span>
              <input v-model.number="paramMax.value" type="number" min="256" max="131072" step="1000" class="mk-input mono" :disabled="!rtForm.enabled" />
            </label>
          </div>
        </div>

        <div class="sdp-sec">
          <span class="sdp-sec__title">失败处理与备用模型<span class="sdp-sec__hint">备用模型最多 2 个，需与主模型同层级、同供应商</span></span>
          <div class="sdp-form__grid">
            <label class="sdp-field">
              <span>逻辑重试（平台默认 {{ platformLogicalRetries }} 次）</span>
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
            <div class="sdp-field sdp-field--wide">
              <span>备用模型（最多 2 个）<em>留空则使用平台默认备用模型</em></span>
              <div class="sdp-fallback-editor">
                <span v-for="m in fallbackChain" :key="m" class="sdp-chip">{{ m }}<button type="button" class="mk-link mk-link--danger" :disabled="!rtForm.enabled" @click="removeFallback(m)">×</button></span>
                <input v-model="newFallback" class="mk-input mono" placeholder="模型 id，回车添加" list="rt-model-options" :disabled="!rtForm.enabled || fallbackChain.length >= 2" @keydown.enter.prevent="addFallback" />
                <button type="button" class="mk-btn" :disabled="!rtForm.enabled || fallbackChain.length >= 2" @click="addFallback">添加</button>
                <button type="button" class="mk-link" :disabled="probing || !rtForm.enabled" @click="probeChannel">
                  {{ probing ? '探测中…' : '探测当前通道可用模型' }}
                </button>
                <span v-if="probeMsg" class="sdp-chip" :class="probeErr ? 'sdp-chip--danger' : 'sdp-chip--ok'">{{ probeMsg }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="sdp-form__footer">
        <p v-if="rtMsg" class="sdp-form__msg" :class="{ 'is-err': rtErr }">{{ rtMsg }}</p>
        <button type="button" class="mk-btn mk-btn--danger-ghost" :disabled="rtSaving" @click="resetRuntime">恢复默认</button>
        <button type="button" class="mk-btn" :disabled="rtSaving" @click="loadRuntime">刷新</button>
        <button type="button" class="mk-btn mk-btn--primary" :disabled="rtSaving" @click="saveRuntime">
          {{ rtSaving ? '保存中…' : '保存配置' }}
        </button>
      </div>
    </section>

    <!-- 模型目录候选：模型输入与兜底链输入共用（带「供应商 · tier」标注） -->
    <datalist id="rt-model-options">
      <option v-for="o in catalogOptions" :key="`cat-${o.value}`" :value="o.value" :label="o.label" />
    </datalist>
  </div>
</template>

<script setup lang="ts">
/**
 * 运行时 tab：模型与路由（独立配置开关 / 模型层级 / 思考档 / 超时 / 参数覆盖 / 失败处理与备用模型）
 * + 模型测试（直发上游探测）。重排说明见模板顶部注释：本组件是该页唯一的编辑入口。
 */
import { computed, ref, watch } from 'vue'
import { adminPlatformSettingsApi, adminSkillsApi } from '@/api/adminApi'
import { askConfirm } from '../useConfirm'
import { errText, fmtMs, callParamSourceLabel } from './sdp-shared'
import { useModelCatalog } from '@/composables/useModelCatalog'

// 模型目录候选（File-as-Truth llm-providers.json）：模型输入与兜底链输入共用的 datalist；
// 加载失败静默降级为空目录（输入框退化为自由文本，不影响配置）
const { options: catalogOptions, load: loadModelCatalog } = useModelCatalog()
loadModelCatalog()

/* 文案单源（R6 复读单源化）：思考模式/思考强度下拉的继承项、参数覆盖三个下拉的继承项 */
const INHERIT_DEFAULT_LABEL = '跟随继承值 / 模型默认'
const INHERIT_PROMPT_LABEL = '继承当前 Prompt'

const props = defineProps<{ skillId: string; refreshTick: number }>()
/* #118：运行时配置的未保存改动上报宿主（此前只有协议编辑器有脏态，切 Skill/离开页面会静默丢弃） */
const emit = defineEmits<{ (e: 'dirty', p: { dirty: boolean; label: string }): void }>()

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
/** 本地脏位：卡头保存钮只在有未保存改动时出现（判例：模型与接入的分段保存钮） */
const dirtyNow = ref(false)
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
const sourceLabel = (k: string) => callParamSourceLabel(generationParams.value?.sources?.[k])

/* ---------- 模型测试（model-probe；与 probeChannel 通道探测是两件事） ---------- */
interface ProbeForm {
  thinkingMode: 'default' | 'enabled' | 'disabled'
  reasoningEffort: 'default' | 'low' | 'high' | 'max'
}
interface ProbeResult {
  durationMs?: number
  ttftContentMs?: number | null
  contentChars?: number
  completionTokens?: number | null
  finish?: string
  jsonOk?: string
  contentPreview?: string
  resolved?: { model?: string; thinkingMode?: string; reasoningEffort?: string }
}
const probeForm = ref<ProbeForm>({ thinkingMode: 'default', reasoningEffort: 'default' })
const probeRunning = ref(false)
const probeError = ref('')
const probeResult = ref<ProbeResult | null>(null)
/** 「跟随配置」档位回显（读当前生效配置，不与探测参数混为一谈） */
const cfgEffortLabel = computed(() =>
  rtForm.value.reasoningEffort === 'default' ? '继承/默认' : rtForm.value.reasoningEffort
)

function resetProbe() {
  probeRunning.value = false
  probeError.value = ''
  probeResult.value = null
  probeForm.value = { thinkingMode: 'default', reasoningEffort: 'default' }
}

async function runModelProbe() {
  const id = props.skillId
  if (!id || probeRunning.value) return
  probeRunning.value = true
  probeError.value = ''
  probeResult.value = null
  try {
    const res = await adminSkillsApi.modelProbe(id, {
      thinkingMode: probeForm.value.thinkingMode,
      reasoningEffort: probeForm.value.reasoningEffort
    })
    if (id !== props.skillId) return
    probeResult.value = (res.data?.data ?? res.data ?? {}) as ProbeResult
  } catch (e) {
    if (id !== props.skillId) return
    probeError.value = `探测失败：${errText(e)}`
  } finally {
    if (id === props.skillId) probeRunning.value = false
  }
}

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
  // 数据落地 → 重置脏态基线（#118：加载失败走的是默认值分支，同样不该算用户改动）
  dirtyBase = formSnapshot()
  dirtyNow.value = false
  emit('dirty', { dirty: false, label: '运行时配置' })
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
    rtMsg.value = '已更新（生成参数与备用模型一起保存）'
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
    resetProbe()
    generationParams.value = null
    rtMsg.value = ''
    void loadRuntime()
  },
  { immediate: true }
)

/* ===== 脏态上报（#118）=====
   以「最近一次加载/保存成功后的表单快照」为基线（loadRuntime 末尾重设），表单任一处偏离即脏。
   保存成功与切换 skill 都会经 loadRuntime 重设基线，脏态自动复位；本地 dirtyNow 供卡头保存钮显隐。 */
function formSnapshot(): string {
  return JSON.stringify({
    f: rtForm.value,
    lr: logicalRetryMode.value,
    cr: customLogicalRetries.value,
    t: paramT.value,
    tp: paramTopP.value,
    mx: paramMax.value,
    fc: fallbackChain.value
  })
}
let dirtyBase = formSnapshot()
function reportDirty() {
  const dirty = formSnapshot() !== dirtyBase
  dirtyNow.value = dirty
  emit('dirty', { dirty, label: '运行时配置' })
}
watch(
  [rtForm, logicalRetryMode, customLogicalRetries, paramT, paramTopP, paramMax, fallbackChain],
  reportDirty,
  { deep: true }
)
// 切换 skill 时先复位基线（新数据到达前不算脏）
watch(() => props.skillId, () => {
  dirtyBase = formSnapshot()
  dirtyNow.value = false
  emit('dirty', { dirty: false, label: '运行时配置' })
})
</script>

<style scoped>
.sdp-pane { display: grid; gap: 14px; align-content: start; }
/* 卡体：与「模型与接入」的 .ac-body 同解剖（16px 内衬 + 14px 栅格），段与段之间靠发丝线分开 */
.sdp-body { display: grid; gap: 16px; padding: 4px 16px 16px; }
.sdp-sec { display: grid; gap: 9px; }
.sdp-sec + .sdp-sec { padding-top: 14px; border-top: 1px solid var(--mk-line); }
.sdp-sec__title { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-ink); }
.sdp-sec__hint { font-size: var(--mk-fs-micro); font-weight: 500; color: var(--mk-faint); }

/* 左右双列（判例：模型与接入「连接与模型清单」卡的 ac-conn2）：≤1100 回落整行 */
.sdp-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.sdp-two__col { display: grid; gap: 12px; align-content: start; min-width: 0; }
.sdp-two__col--test {
  padding: 12px 14px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
  align-content: start;
}
@media (max-width: 1100px) {
  .sdp-two { grid-template-columns: minmax(0, 1fr); }
}

.sdp-chips { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
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
.sdp-chip--amber { background: var(--mk-amber-bg); color: var(--mk-amber); }
.sdp-chip--amber b { color: var(--mk-amber); }
.sdp-fallback-editor { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.sdp-fallback-editor .mk-input { flex: 1; min-width: 200px; }
.mk-link--danger { color: var(--mk-red, #b3372f); }
/* 卡头分段保存钮（模型与接入的 .ac-sec__save 同款：只在脏位出现） */
.sdp-card__save {
  margin-left: auto;
  padding: 5px 12px;
  border: 1px solid color-mix(in srgb, var(--mk-blue) 45%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--mk-blue) 10%, transparent);
  color: var(--mk-blue);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  cursor: pointer;
}
.sdp-card__save:disabled { opacity: 0.6; cursor: not-allowed; }

.sdp-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
/* 验证列窄（≤1100 单列时不窄），字段一律纵向排 */
.sdp-form__grid--stack { grid-template-columns: minmax(0, 1fr); }
@media (max-width: 860px) {
  .sdp-form__grid { grid-template-columns: 1fr; }
}
.sdp-field { display: grid; gap: 5px; min-width: 0; }
.sdp-field > span { font-size: var(--mk-fs-micro); color: var(--mk-muted); font-weight: 600; }
.sdp-field > span em { font-style: normal; font-weight: 400; color: var(--mk-faint); margin-left: 6px; }
.sdp-field--wide { grid-column: 1 / -1; }
.sdp-field--check { display: flex; align-items: center; gap: 8px; }
.sdp-field--check input { width: 15px; height: 15px; accent-color: var(--mk-blue); }
.sdp-test__act { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sdp-form__footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 0 16px 16px;
}
.sdp-form__msg { margin: 0 auto 0 0; font-size: var(--mk-fs-micro); color: var(--mk-green); font-weight: 600; }
.sdp-form__msg.is-err { color: var(--mk-red); }
.sdp-probe { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid var(--mk-line); border-radius: var(--mk-radius-xl); }
.sdp-probe.is-ok { border-color: rgba(22, 163, 74, 0.35); background: var(--mk-green-bg); }
.sdp-probe.is-bad { border-color: rgba(220, 38, 38, 0.3); background: var(--mk-red-bg); }
.sdp-probe__resolved { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); overflow-wrap: anywhere; }
.sdp-probe__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.sdp-probe__grid > div { display: grid; gap: 2px; font-size: var(--mk-fs-micro); min-width: 0; }
.sdp-probe__grid span { color: var(--mk-faint); }
.sdp-probe__grid strong { color: var(--mk-ink); font-weight: 600; overflow-wrap: anywhere; }
.sdp-probe__pre {
  margin: 0;
  max-height: 160px;
  overflow: auto;
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
  color: var(--mk-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
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
  .sdp-body { gap: 18px; padding: 6px 20px 20px; }
  .sdp-sec__title { font-size: var(--mk-fs-emphasis); }
  .sdp-sec__hint { font-size: var(--mk-fs-body); }
  .sdp-field > span { font-size: var(--mk-fs-body); }
  .sdp-pane .mk-input { font-size: var(--mk-fs-emphasis); padding: 12px 15px; }
  .sdp-form__msg { font-size: var(--mk-fs-body); }
  .sdp-form__footer { padding: 0 20px 20px; }
  .sdp-probe__resolved, .sdp-probe__grid > div, .sdp-probe__pre { font-size: var(--mk-fs-body); }
}

/* 暗色模式 */
[data-theme='dark'] .sdp-two__col--test { background: var(--wf-bg-subtle); }
</style>
