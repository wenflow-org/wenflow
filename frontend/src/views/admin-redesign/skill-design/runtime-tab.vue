<template>
  <!-- 运行时：模型与路由。
       2026-10-21 版式重做（用户「这个的布局不行，看看成熟设计」）：
       参照主流 LLM 控制台的 Settings + Test 动线——
       ① 独立配置改成卡头开关（Override），状态与动作同处，不再用复选框占一行；
       ② 配置按「模型 / 生成参数 / 请求与容错」三段竖排，每段内是两列字段；
          参数覆盖从三列大格子改成一行一个字段的小表（标签 / 模式 / 值对齐）；
       ③ 模型测试收成右侧窄栏、视觉次级，≤1080 回落单列；
       ④ 生效值胶囊保留在顶部，先回答「现在生效的是什么」。 -->
  <div class="sdp-pane">
    <section class="mk-card">
      <div class="mk-card__head sdp-card__head">
        <h3 class="mk-card__title">模型与路由</h3>
        <!-- 覆盖开关放卡头（成熟控制台的「Override」动线）：状态与动作同处，
             下面的字段随开关统一禁用，不再用一枚小复选框占一行表单 -->
        <MkSwitch
          v-model="rtForm.enabled"
          label="独立配置"
          :state-text="rtForm.enabled ? '生效中' : '继承上层'"
          class="sdp-head__switch"
        />
        <button
          v-if="dirtyNow"
          type="button"
          class="sdp-card__save"
          :disabled="rtSaving"
          @click="saveRuntime"
        >{{ rtSaving ? '保存中…' : '保存配置' }}</button>
      </div>
      <!-- 口径一条放卡头正下方（卡头只放标题/现状/动作；规则不复述） -->
      <p class="mk-card__note">Prompt 里声明了 model 时，本页模型不参与。</p>

      <div class="sdp-body">
        <div v-if="rtLoadFailed" class="sdp-error">运行时配置加载失败，已重置为默认值。<button type="button" class="mk-link" @click="loadRuntime">重试</button></div>

        <!-- 生效值（只读「所配即所得」）：先回答「现在生效的是什么」，再进入分节编辑。
             来源词走 sdp-shared 的人话映射（后端枚举码不直接露给运营） -->
        <div class="sdp-summary">
          <div class="sdp-summary__head">
            <span class="sdp-sec__title">生效值</span>
            <span class="sdp-summary__hint">只读 · 当前实际生效</span>
          </div>
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

        <!-- 与「模型与接入」的供应商详情同解剖：左分节导航 / 右当前分节。
             一屏只展开一段，避免长表单把所有字段摊成一条竖线；导航上的副文就是各段
             当前生效值，切段前也能看到全貌。≤900px 导航折成横向可滚动条。 -->
        <div class="sdp-shell">
          <nav class="sdp-nav" role="tablist" aria-label="运行时配置分节">
            <button
              v-for="item in runtimeNav"
              :key="item.key"
              type="button"
              role="tab"
              :id="`sdp-nav-${item.key}`"
              class="sdp-nav__item"
              :class="{ 'is-on': runtimeSection === item.key }"
              :aria-selected="runtimeSection === item.key"
              :aria-controls="`sdp-panel-${item.key}`"
              @click="runtimeSection = item.key"
            >
              <span class="sdp-nav__name">{{ item.label }}</span>
              <span class="sdp-nav__meta">{{ item.meta }}</span>
            </button>
          </nav>

          <div class="sdp-detail">
            <section v-show="runtimeSection === 'model'" id="sdp-panel-model" class="sdp-panel" role="tabpanel" aria-labelledby="sdp-nav-model">
              <header class="sdp-panel__head">
                <h4>模型</h4>
                <span class="sdp-panel__state mono">{{ rtForm.model || '未指定' }}</span>
              </header>
              <div class="sdp-form__grid">
                <label class="sdp-field sdp-field--wide">
                  <span>模型</span>
                  <MkModelPicker
                    :model-value="rtForm.model"
                    :options="pickerOptions"
                    allow-inherit
                    inherit-label="继承 Agent / 平台默认"
                    :tier="rtForm.tier"
                    :disabled="!rtForm.enabled"
                    @update:model-value="rtForm.model = $event"
                    @pick="onModelPicked"
                  />
                  <!-- 选中项的能力与价格就地核对（Azure Foundry 的部署行形态）：不必再回接入页查 -->
                  <span v-if="primaryMetaText" class="sdp-model-meta mono">{{ primaryMetaText }}</span>
                </label>
              </div>
            </section>

            <section v-show="runtimeSection === 'params'" id="sdp-panel-params" class="sdp-panel" role="tabpanel" aria-labelledby="sdp-nav-params">
              <header class="sdp-panel__head">
                <h4>生成参数</h4>
                <span class="sdp-panel__state">{{ thinkingLabel }} · T={{ generationParams?.temperature ?? '继承' }}</span>
              </header>
              <div class="sdp-form__grid">
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
              </div>

              <div class="sdp-subhead">
                <span>参数覆盖</span>
                <em>未覆盖的字段沿用 Prompt 默认</em>
              </div>
              <div class="sdp-params">
                <div class="sdp-param">
                  <span class="sdp-param__label">temperature<span class="sdp-param__range">0–2</span></span>
                  <select v-model="paramT.mode" class="mk-input" :disabled="!rtForm.enabled">
                    <option value="inherit">{{ INHERIT_PROMPT_LABEL }}</option>
                    <option value="override">覆盖</option>
                  </select>
                  <input v-if="paramT.mode === 'override'" v-model.number="paramT.value" type="number" min="0" max="2" step="0.1" class="mk-input mono" :disabled="!rtForm.enabled" aria-label="temperature 覆盖值" />
                  <span v-else class="sdp-param__inherit">继承</span>
                </div>
                <div class="sdp-param">
                  <span class="sdp-param__label">topP<span class="sdp-param__range">0–1</span></span>
                  <select v-model="paramTopP.mode" class="mk-input" :disabled="!rtForm.enabled">
                    <option value="inherit" title="Prompt 未声明该字段时不发送">{{ INHERIT_PROMPT_LABEL }}</option>
                    <option value="override">覆盖</option>
                  </select>
                  <input v-if="paramTopP.mode === 'override'" v-model.number="paramTopP.value" type="number" min="0.01" max="1" step="0.05" class="mk-input mono" :disabled="!rtForm.enabled" aria-label="topP 覆盖值" />
                  <span v-else class="sdp-param__inherit">继承</span>
                </div>
                <div class="sdp-param">
                  <span class="sdp-param__label">maxTokens<span class="sdp-param__range">256–131072</span></span>
                  <select v-model="paramMax.mode" class="mk-input" :disabled="!rtForm.enabled">
                    <option value="inherit">{{ INHERIT_PROMPT_LABEL }}</option>
                    <option value="override">覆盖</option>
                  </select>
                  <input v-if="paramMax.mode === 'override'" v-model.number="paramMax.value" type="number" min="256" max="131072" step="1000" class="mk-input mono" :disabled="!rtForm.enabled" aria-label="maxTokens 覆盖值" />
                  <span v-else class="sdp-param__inherit">继承</span>
                </div>
              </div>
            </section>

            <section v-show="runtimeSection === 'request'" id="sdp-panel-request" class="sdp-panel" role="tabpanel" aria-labelledby="sdp-nav-request">
              <header class="sdp-panel__head">
                <h4>请求与容错</h4>
                <span class="sdp-panel__state">超时 {{ rtForm.requestTimeoutMs ? Math.round(rtForm.requestTimeoutMs / 1000) + 's' : '继承' }} · 重试 {{ effectiveLogicalRetries }} 次</span>
              </header>
              <div class="sdp-form__grid">
                <label class="sdp-field">
                  <span>请求超时（ms）</span>
                  <input v-model.number="rtForm.requestTimeoutMs" type="number" min="10000" max="300000" step="10000" class="mk-input" :disabled="!rtForm.enabled" placeholder="继承" />
                </label>
                <div class="sdp-field">
                  <span>逻辑重试<em>平台默认 {{ platformLogicalRetries }} 次，可单独设置</em></span>
                  <div class="sdp-param__ctl">
                    <select v-model="logicalRetryMode" class="mk-input">
                      <option value="inherit">继承平台默认</option>
                      <option value="disabled">禁用</option>
                      <option value="custom" :disabled="platformLogicalRetries <= 0">自定义</option>
                    </select>
                    <input v-if="logicalRetryMode === 'custom'" v-model.number="customLogicalRetries" type="number" :min="1" :max="platformLogicalRetries" step="1" class="mk-input mono" aria-label="最大逻辑重试次数" />
                  </div>
                </div>
              </div>

              <div class="sdp-field">
                <span>降级顺序<em>{{ fallbackHint }}</em></span>
                <div class="sdp-fallback">
                  <ol v-if="fallbackChain.length" class="sdp-fallback__chain" aria-label="备用链顺序">
                    <li v-for="(m, i) in fallbackChain" :key="m" class="sdp-chip">
                      <b class="mono">{{ i + 1 }}</b><span class="mono">{{ m }}</span>
                      <button type="button" class="mk-link mk-link--danger" :disabled="!rtForm.enabled" :aria-label="`移除备用模型 ${m}`" @click="removeFallback(m)">×</button>
                    </li>
                  </ol>
                  <MkModelPicker
                    v-if="fallbackChain.length < 2"
                    :model-value="newFallback"
                    :options="fallbackOptions"
                    :exclude="fallbackExclude"
                    :tier="rtForm.tier"
                    :allow-custom="false"
                    :disabled="!rtForm.enabled"
                    placeholder="选择备用模型"
                    @update:model-value="addFallbackValue"
                  />
                  <button type="button" class="mk-link sdp-fallback__probe" :disabled="probing || !rtForm.enabled" @click="probeChannel">
                    {{ probing ? '探测中…' : '探测当前通道可用模型' }}
                  </button>
                  <span v-if="probeMsg" class="sdp-chip" :class="probeErr ? 'sdp-chip--danger' : 'sdp-chip--ok'">{{ probeMsg }}</span>
                </div>
              </div>
            </section>

            <section v-show="runtimeSection === 'test'" id="sdp-panel-test" class="sdp-panel" role="tabpanel" aria-labelledby="sdp-nav-test">
              <header class="sdp-panel__head">
                <h4>模型测试</h4>
                <span class="sdp-panel__state">直发上游，不留记录</span>
              </header>
              <div class="sdp-test-grid">
                <div class="sdp-test-controls">
                  <div class="sdp-form__grid">
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
                </div>

                <div class="sdp-test-result">
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
                  <p v-else class="sdp-test-result__empty">还没有探测结果。点「开始探测」直发一次上游请求，结果会留在这里。</p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <div class="sdp-form__footer">
        <p v-if="rtMsg" class="sdp-form__msg" :class="{ 'is-err': rtErr }">{{ rtMsg }}</p>
        <button type="button" class="mk-btn mk-btn--danger-ghost" :disabled="rtSaving" @click="resetRuntime">恢复默认</button>
        <button type="button" class="mk-btn" :disabled="rtSaving" @click="loadRuntime">刷新</button>
      </div>
    </section>

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
import MkModelPicker, { type MkModelOption } from '@/components/mk/MkModelPicker.vue'
import MkSwitch from '@/components/mk/MkSwitch.vue'

// 模型目录候选（File-as-Truth llm-providers.json）：模型与备用模型共用一个可选择器；
// 加载失败静默降级为空目录（仍可按输入提交别名 / 注册表外 id，不影响保存）
const { pickerOptions, load: loadModelCatalog } = useModelCatalog()
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

/* 分节导航（与「模型与接入」供应商详情的左列表/右详情同解剖）：
   一屏只展开一段，副文直接写各段当前生效值，切段前也能看到全貌。 */
type RuntimeSection = 'model' | 'params' | 'request' | 'test'
const runtimeSection = ref<RuntimeSection>('model')
const runtimeNav = computed<Array<{ key: RuntimeSection; label: string; meta: string }>>(() => [
  {
    key: 'model',
    label: '模型',
    meta: rtForm.value.enabled ? (rtForm.value.model || '继承 Agent / 平台') : '继承上层'
  },
  {
    key: 'params',
    label: '生成参数',
    meta: `T=${generationParams.value?.temperature ?? '继承'} · ${thinkingLabel.value}`
  },
  {
    key: 'request',
    label: '请求与容错',
    meta: `重试 ${effectiveLogicalRetries.value} 次 · 超时 ${rtForm.value.requestTimeoutMs ? Math.round(rtForm.value.requestTimeoutMs / 1000) + 's' : '继承'}`
  },
  {
    key: 'test',
    label: '模型测试',
    meta: probeResult.value ? `已探测 ${fmtMs(probeResult.value.durationMs ?? 0)}` : '直发上游'
  }
])
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

/** 主模型在目录里的条目：备用链要按它的供应商与层级收窄（后端 validateFallbackChain 同规则） */
const primaryOption = computed(() => pickerOptions.value.find((o) => o.value === rtForm.value.model) ?? null)
const primaryMetaText = computed(() => {
  const o = primaryOption.value
  if (!o) return ''
  const caps = [o.thinking ? '思考' : '', o.reasoning ? '强度' : '', o.vision ? '视觉' : ''].filter(Boolean).join(' / ')
  const price = o.priceIn != null || o.priceOut != null
    ? `入 ${o.priceIn ?? '—'} / 出 ${o.priceOut ?? '—'}`
    : ''
  return [o.providerName, o.tier, caps, price].filter(Boolean).join(' · ')
})
const fallbackHint = computed(() => {
  if (primaryOption.value) return ''
  if (fallbackChain.value.length) return '主模型为空，候选按层级列出'
  return '留空继承平台默认备用模型'
})
/** 备用候选：同供应商 + 同层级；主模型未指定时只按层级收窄 */
const fallbackOptions = computed(() => {
  const primary = primaryOption.value
  return pickerOptions.value.filter((o) => {
    if (primary) return o.providerId === primary.providerId && o.tier === primary.tier
    return !rtForm.value.tier || o.tier === rtForm.value.tier
  })
})
const fallbackExclude = computed(() => [rtForm.value.model, ...fallbackChain.value].filter(Boolean))

/** 选中候选即入链；选择器自身受 max 2 与 exclude 约束 */
function addFallbackValue(m: string) {
  const value = (m || '').trim()
  newFallback.value = ''
  if (!value || fallbackChain.value.includes(value) || fallbackChain.value.length >= 2) return
  fallbackChain.value = [...fallbackChain.value, value]
  fallbackTouched.value = true
}

/** 选中目录里的模型时同步层级：候选行标了 tier，选 reasoning 模型却留着 chat 会路由错档 */
function onModelPicked(opt: MkModelOption | null) {
  if (opt?.tier === 'chat' || opt?.tier === 'reasoning') rtForm.value.tier = opt.tier
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
.sdp-pane { display: grid; gap: 14px; align-content: start; container-type: inline-size; }
/* 卡体：与「模型与接入」的 .ac-body 同解剖（16px 内衬 + 14px 栅格），段与段之间靠发丝线分开 */
.sdp-body { display: grid; gap: 16px; padding: 4px 16px 16px; }
.sdp-sec__title { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-ink); }
.sdp-sec__hint { font-size: var(--mk-fs-micro); font-weight: 500; color: var(--mk-faint); }

/* 生效值：一段只读摘要，和下面的编辑区用发丝线分开 */
.sdp-summary {
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface-2);
}
.sdp-summary__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.sdp-summary__hint { font-size: var(--mk-fs-micro); color: var(--mk-faint); }

/* 左分节导航 / 右当前分节：与「模型与接入」供应商详情的列表 + 详情同解剖 */
.sdp-shell {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  overflow: hidden;
  background: var(--mk-surface);
}
.sdp-nav {
  display: grid;
  align-content: start;
  gap: 2px;
  padding: 8px;
  background: var(--mk-surface-2);
  border-right: 1px solid var(--mk-line);
}
.sdp-nav__item {
  display: grid;
  gap: 3px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.sdp-nav__item:hover { background: color-mix(in srgb, var(--mk-ink) 4%, transparent); }
.sdp-nav__item.is-on { background: var(--mk-surface); border-color: var(--mk-line); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04); }
.sdp-nav__name { font-size: var(--mk-fs-body); font-weight: 600; color: var(--mk-ink); }
.sdp-nav__item.is-on .sdp-nav__name { color: var(--mk-blue); }
.sdp-nav__meta { font-size: var(--mk-fs-micro); color: var(--mk-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sdp-detail { min-width: 0; padding: 16px; }
.sdp-panel { display: grid; gap: 14px; align-content: start; }
.sdp-panel__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--mk-line);
}
.sdp-panel__head h4 { margin: 0; font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); }
.sdp-panel__state { font-size: var(--mk-fs-micro); color: var(--mk-faint); overflow-wrap: anywhere; }
.sdp-panel__hint { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }

/* 模型测试：左控制 / 右结果。结果列用发丝线分隔，不再套一层卡 */
.sdp-test-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 18px; align-items: start; }
.sdp-test-controls { display: grid; gap: 12px; align-content: start; min-width: 0; }
.sdp-test-result { display: grid; gap: 10px; align-content: start; min-width: 0; padding-left: 18px; border-left: 1px solid var(--mk-line); }
.sdp-test-result__empty { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); line-height: 1.6; }
@container (max-width: 760px) {
  .sdp-test-grid { grid-template-columns: minmax(0, 1fr); }
  .sdp-test-result { padding-left: 0; border-left: 0; padding-top: 14px; border-top: 1px solid var(--mk-line); }
}
/* 按卡片自身宽度回落（容器查询）：侧栏展开时视口仍宽，但卡片只剩 850px */
@container (max-width: 900px) {
  .sdp-shell { grid-template-columns: minmax(0, 1fr); }
  .sdp-nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-flow: row;
    border-right: 0;
    border-bottom: 1px solid var(--mk-line);
  }
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
.sdp-fallback { display: grid; gap: 8px; }
.sdp-fallback__chain { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; padding: 0; list-style: none; }
.sdp-fallback__chain b { color: var(--mk-faint); font-weight: 700; }
.sdp-fallback__probe { justify-self: start; }
.mk-link--danger { color: var(--mk-red, #b3372f); }
/* 卡头：覆盖开关与保存钮同处右组；标题左，动作右 */
.sdp-card__head { flex-wrap: wrap; }
.sdp-head__switch { margin-left: auto; }
/* 卡头分段保存钮（模型与接入的 .ac-sec__save 同款：只在脏位出现） */
.sdp-card__save {
  margin-left: 0;
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
/* 参数覆盖：一行一个字段（标签 / 模式 / 值），三行对齐成一张小表 */
.sdp-subhead {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 2px;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-ink);
}
.sdp-subhead em { font-style: normal; font-weight: 400; color: var(--mk-faint); }
.sdp-params { display: grid; gap: 8px; }
.sdp-param {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(170px, 1.2fr) 128px;
  gap: 8px;
  align-items: center;
  min-width: 0;
}
.sdp-param__label { display: flex; align-items: baseline; gap: 6px; font-size: var(--mk-fs-micro); color: var(--mk-muted); font-weight: 600; }
.sdp-param__range { font-weight: 400; color: var(--mk-faint); }
.sdp-param__inherit { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
@media (max-width: 900px) {
  .sdp-param { grid-template-columns: minmax(0, 1fr) 128px; }
  .sdp-param__label { grid-column: 1 / -1; }
}
.sdp-param__ctl { display: grid; grid-template-columns: minmax(0, 1fr) 128px; gap: 8px; align-items: center; }
.sdp-param__ctl > :only-child { grid-column: 1 / -1; }
@media (max-width: 700px) {
  /* 窄屏：参数行整行放模式选择；「继承」由选项文案已表达，不再单独占一列 */
  .sdp-param { grid-template-columns: minmax(0, 1fr); }
  .sdp-param__inherit { display: none; }
}
@media (max-width: 860px) {
  .sdp-form__grid { grid-template-columns: 1fr; }
}
.sdp-field { display: grid; gap: 5px; min-width: 0; align-content: start; }
.sdp-field--wide { grid-column: 1 / -1; }
.sdp-field > span { font-size: var(--mk-fs-micro); color: var(--mk-muted); font-weight: 600; }
.sdp-field > span em { font-style: normal; font-weight: 400; color: var(--mk-faint); margin-left: 6px; }
.sdp-model-meta { font-size: var(--mk-fs-micro); color: var(--mk-faint); overflow-wrap: anywhere; }
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

/* 暗色模式：分节导航用壳层已有的 subtle 底，不再单独覆盖 */
</style>
