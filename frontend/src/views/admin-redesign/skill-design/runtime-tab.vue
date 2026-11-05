<template>
  <!-- 运行时：模型与路由。
       2026-10-21 版式重做（用户「这个的布局不行，看看成熟设计」）：
       参照主流 LLM 控制台的 Settings + Test 动线——
       ① 独立配置改成卡头开关（Override），状态与动作同处，不再用复选框占一行；
       ② 配置按「模型 / 生成参数 / 请求与容错」三段竖排，每段内是两列字段；
          参数覆盖从三列大格子改成一行一个字段的小表（标签 / 模式 / 值对齐）；
       ③（2026-11-04 撤除）模型测试那块已从本页撑出去：它是直发上游的连通性探测，
          平台「模型与接入」页每个模型都有「测试」，在 Skill 页再留一份等于同一件事两处入口；
       2026-10-24（用户「生效值是什么东西，没意义，拿掉，什么叫独立配置」）：
       顶部「生效值」只读摘要删掉——导航副文/分节页头/表单本身已有同样的当前值，
       改为一行「取值顺序」；卡头开关从「独立配置」改称「覆盖平台默认」（说出独立于谁）。 -->
  <div class="sdp-pane">
    <section class="mk-card">
      <div class="mk-card__head sdp-card__head">
        <h3 class="mk-card__title">模型与路由</h3>
        <!-- 覆盖开关放卡头（成熟控制台的「Override」动线）：状态与动作同处，
             下面的字段随开关统一禁用，不再用一枚小复选框占一行表单。
             2026-11-03：`v-model` 改「翻转即落盘」——这枚开关此前是全页唯一
             **没有保存入口的表单字段**：翻它只置脏态，而落盘路径只有配置弹层里的「保存」，
             翻完直接离开页面改动就无声丢了（脏态只喂了导航守卫的离开确认）。 -->
        <MkSwitch
          :model-value="rtForm.enabled"
          label="覆盖平台默认"
          :state-text="rtForm.enabled ? '已开启' : '用平台默认'"
          :title="overrideTitle"
          :busy="rtSaving"
          class="sdp-head__switch"
          @update:model-value="onOverrideToggle"
        />
        <!-- 2026-10-28 用户「skill 详情的模型也改一下」：卡面只留当前配置摘要，
             模型 / 生成参数 / 请求容错收进「配置」弹层，一次保存。 -->
        <button
          type="button"
          class="mk-btn mk-btn--sm"
          :disabled="!rtForm.enabled"
          :title="rtForm.enabled ? '编辑模型与路由' : '先开启覆盖平台默认'"
          @click="openConfig"
        >配置</button>
      </div>
      <!-- 卡头只保留标题/开关/保存；旧「Prompt 里声明了 model 时，本页模型不参与」已删：
           与运行时契约相反（route 优先于 prompt.model）。 -->

      <div class="sdp-body">
        <div v-if="rtLoadFailed" class="sdp-error">运行时配置加载失败，已重置为默认值。<button type="button" class="mk-link" @click="loadRuntime">重试</button></div>

        <!-- 当前生效配置（2026-11-03 二稿：用户「做的太差了」后改版）。
             一稿是「四行通栏读数 + 浅底描边盒」，两处实测毛病：盒子框大内容少，宽屏下右侧
             空一半；层级也反了——「取值顺序」这条**永远不变**的规则被摆在最重的一行，
             比真正在跑的模型 id 还亮。现在：模型 id 当主角（+ 能力胶囊），其余五项
             排成两列读数，不再套盒子；取值顺序只作悬停说明挂在模型 id 上（需要时再看）。
             2026-11-04 用户「为什么还在区分默认推理和对话」：档位胶囊撤除——平台只有一档
             默认，长不长思考看这一屏已有的「思考模式 / 推理强度」两项。 -->
        <!-- 2026-11-04 用户「他是在平台配置模型之下的，进行独立的调整」：
             卡面改成「基线 + 差异」两段——先写清基线是谁（平台默认模型），
             再只列**这个 Skill 改过的**项，每一项后面标注它在没改时会取什么。
             此前是五项读数平铺，读者看不出哪几项是本 Skill 的决定、哪几项只是继承；
             模型那一行还写着「未单独指定，跟随平台默认」，与卡头「覆盖平台默认 已开启」读作打架。 -->
        <div class="sdp-live">
          <div class="sdp-base">
            <span class="sdp-base__k">基线</span>
            <span class="mono sdp-base__model" :title="`${baseModel}

${orderTitle}`">{{ baseModel }}</span>
            <!-- 能力做成**陈述句**（2026-11-02 评审：原来只写 思考 / 推理强度 两个裸词，
                 被读成「只有标签、值还没填」）。 -->
            <span v-for="cap in summaryCaps" :key="cap" class="sdp-chip">{{ cap }}</span>
            <span v-if="summaryMeta" class="sdp-base__meta">{{ summaryMeta }}</span>
            <span class="sdp-base__src">{{ baseModelSource }}</span>
          </div>

          <template v-if="rtForm.enabled">
            <div class="sdp-diff">
              <p class="sdp-diff__k">本 Skill 独立调整</p>
              <ul class="sdp-diff__list">
                <li v-for="row in changedRows" :key="row.label">
                  <span class="sdp-diff__label">{{ row.label }}</span>
                  <strong class="sdp-diff__val">{{ row.value }}</strong>
                  <em class="sdp-diff__base" :title="row.baseTitle">{{ row.base }}</em>
                </li>
              </ul>
              <p v-if="!changedRows.length" class="sdp-diff__none">没有单独调整的项，全部沿用基线</p>
            </div>
          </template>
          <p v-else class="sdp-live__note">
            覆盖已关闭：模型与超时按基线，生成参数仍按 Prompt 文件声明取值。
          </p>
        </div>

        <!-- 配置弹层：模型 / 生成参数 / 请求与容错三段，底部一颗保存。 -->
        <Teleport to="body">
          <div v-if="configOpen" ref="configMaskRef" class="mk-modal">
            <div ref="configPanelRef" class="mk-modal__panel sdp-config-modal" role="dialog" aria-label="配置模型与路由">
              <div class="mk-modal__head">
                <h3 class="mk-modal__title">配置模型与路由</h3>
                <button type="button" class="mk-modal__close" aria-label="关闭" @click="closeConfig">✕</button>
              </div>
              <div class="mk-modal__body">
                <div class="sdp-sections">
          <section id="sdp-panel-model" class="sdp-panel">
          <header class="sdp-panel__head">
            <h4>模型</h4>
          </header>
            <div class="sdp-form__grid">
              <label class="sdp-field sdp-field--wide">
                <!-- 不再写「模型」字段标签：分节名与面板标题都是「模型」，第三遍纯复读 -->
                <MkModelPicker
                  aria-label="模型"
                  :model-value="rtForm.model"
                  :options="pickerOptions"
                  allow-inherit
                  inherit-label="用平台默认模型"
                  :disabled="!rtForm.enabled"
                  @update:model-value="rtForm.model = $event"
                />
                <!-- 选中项的能力与价格就地核对（Azure Foundry 的部署行形态）：不必再回接入页查 -->
                <span v-if="!inheritingModel && primaryMetaText" class="sdp-model-meta">{{ primaryMetaText }}</span>
                <!-- 用平台默认时，把「实际在跑哪个模型」写出来：否则这一屏只有「平台默认」一个词，
                     运营无法确认线上究竟是 deepseek 还是别的。
                     2026-11-02 评审：本弹层里没有「覆盖」开关，句子原先带「覆盖已开启 / 已关闭」，
                     读者在这个上下文里既看不到也改不了那个状态——只陈述这一项的事实。 -->
                <span v-else-if="inheritedModelText" class="sdp-model-meta">{{ inheritedModelText }}</span>
              </label>
            </div>
          </section>

            <section id="sdp-panel-params" class="sdp-panel">
              <header class="sdp-panel__head">
                <h4>生成参数</h4>
                <!-- 段头是这一段的小结（思考档 + T 与来源）；每行的取值另在各行右侧给
                     （2026-11-02 评审：原先四行都写「按 Prompt 声明」，唯一的数字只在这里，
                     每行看不到自己的取值） -->
                <span class="sdp-panel__state">思考模式 {{ thinkingLabel }} · T={{ generationParams?.temperature ?? INHERIT_PROMPT_LABEL }}<template v-if="generationParams?.temperature != null">（{{ sourceLabel('temperature') }}）</template></span>
              </header>
              <div class="sdp-form__grid">
                <label class="sdp-field">
                  <span>思考模式</span>
                  <MkSelect
                    v-model="rtForm.thinkingMode"
                    :options="THINKING_MODE_OPTIONS"
                    aria-label="思考模式"
                    block
                    :disabled="!rtForm.enabled"
                  />
                </label>
                <label class="sdp-field">
                  <span>思考强度</span>
                  <MkSelect
                    v-model="rtForm.reasoningEffort"
                    :options="reasoningEffortOptions"
                    aria-label="推理强度"
                    block
                    :disabled="!rtForm.enabled || rtForm.thinkingMode === 'disabled'"
                  />
                </label>
              </div>
              <!-- 能力冲突提示（2026-10-24）：模型支不支持思考/强度由注册表声明，网关按能力裁剪；
                   裁剪是静默的，所以必须在配置处说明「写了也不会发」。模型不在目录时不猜、不提示。 -->
              <p v-if="rtForm.enabled && thinkingNotice" class="sdp-cap-note" role="status">{{ thinkingNotice }}</p>

              <div class="sdp-subhead">
                <span>参数覆盖</span>
                <em>未覆盖的字段沿用 Prompt 默认</em>
              </div>
              <div class="sdp-params">
                <div class="sdp-param">
                  <span class="sdp-param__label">temperature<span class="sdp-param__range">0–2</span></span>
                  <div class="sdp-param__ctl">
                    <MkSelect
                      v-model="paramT.mode"
                      :options="PARAM_MODE_OPTIONS"
                      aria-label="temperature 参数生效方式"
                      block
                      :disabled="!rtForm.enabled"
                    />
                    <input v-if="paramT.mode === 'override'" v-model.number="paramT.value" type="number" min="0" max="2" step="0.1" class="mk-input mono" :disabled="!rtForm.enabled" aria-label="temperature 覆盖值" />
                    <span v-else class="mono sdp-param__val" :title="paramValTitle('temperature')">{{ paramValText('temperature') }}</span>
                  </div>
                </div>
                <div class="sdp-param">
                  <span class="sdp-param__label">topP<span class="sdp-param__range">0–1</span></span>
                  <div class="sdp-param__ctl">
                    <MkSelect
                      v-model="paramTopP.mode"
                      :options="PARAM_MODE_OPTIONS"
                      aria-label="topP 参数生效方式"
                      block
                      :disabled="!rtForm.enabled"
                    />
                    <input v-if="paramTopP.mode === 'override'" v-model.number="paramTopP.value" type="number" min="0.01" max="1" step="0.05" class="mk-input mono" :disabled="!rtForm.enabled" aria-label="topP 覆盖值" />
                    <span v-else class="mono sdp-param__val" :title="paramValTitle('topP')">{{ paramValText('topP') }}</span>
                  </div>
                </div>
                <div class="sdp-param">
                  <span class="sdp-param__label">maxTokens<span class="sdp-param__range">256–131072</span></span>
                  <div class="sdp-param__ctl">
                    <MkSelect
                      v-model="paramMax.mode"
                      :options="PARAM_MODE_OPTIONS"
                      aria-label="maxTokens 参数生效方式"
                      block
                      :disabled="!rtForm.enabled"
                    />
                    <input v-if="paramMax.mode === 'override'" v-model.number="paramMax.value" type="number" min="256" max="131072" step="1000" class="mk-input mono" :disabled="!rtForm.enabled" aria-label="maxTokens 覆盖值" />
                    <span v-else class="mono sdp-param__val" :title="paramValTitle('maxTokens')">{{ paramValText('maxTokens') }}</span>
                  </div>
                </div>
                <div class="sdp-param">
                  <span class="sdp-param__label">maxAttempts<span class="sdp-param__range">1–5</span></span>
                  <div class="sdp-param__ctl">
                    <MkSelect
                      v-model="paramAttempts.mode"
                      :options="PARAM_MODE_OPTIONS"
                      aria-label="maxAttempts 参数生效方式"
                      block
                      :disabled="!rtForm.enabled"
                    />
                    <input v-if="paramAttempts.mode === 'override'" v-model.number="paramAttempts.value" type="number" min="1" max="5" step="1" class="mk-input mono" :disabled="!rtForm.enabled" aria-label="maxAttempts 覆盖值" />
                    <span v-else class="mono sdp-param__val" :title="paramValTitle('maxAttempts')">{{ paramValText('maxAttempts') }}</span>
                  </div>
                </div>
              </div>
            </section>

            <section id="sdp-panel-request" class="sdp-panel">
              <header class="sdp-panel__head">
                <h4>请求与容错</h4>
                <span class="sdp-panel__state">超时 {{ rtForm.requestTimeoutMs ? Math.round(rtForm.requestTimeoutMs / 1000) + 's' : '平台默认' }} · 重试 {{ effectiveLogicalRetries }} 次</span>
              </header>
              <div class="sdp-form__grid">
                <label class="sdp-field">
                  <!-- 2026-11-02 评审：原来是一枚带上下微调箭头的数字框，框内显示文字「平台默认」
                       （占位符），读者把它当成当前取值，打开时它还顶着自动聚焦的焦点环。
                       改成与紧邻的「逻辑重试」同形：先选用不用平台默认，再在自定义档里填毫秒数。 -->
                  <span>请求超时（ms）</span>
                  <div class="sdp-param__ctl">
                    <MkSelect
                      v-model="timeoutMode"
                      :options="TIMEOUT_MODE_OPTIONS"
                      aria-label="请求超时"
                      block
                      :disabled="!rtForm.enabled"
                    />
                    <input v-if="timeoutMode === 'custom'" v-model.number="rtForm.requestTimeoutMs" type="number" min="10000" max="300000" step="10000" class="mk-input mono" :disabled="!rtForm.enabled" placeholder="例如 60000" aria-label="请求超时毫秒数" />
                  </div>
                </label>
                <div class="sdp-field">
                  <span>逻辑重试<em>平台默认 {{ platformLogicalRetries }} 次，可单独设置</em></span>
                  <div class="sdp-param__ctl">
                    <MkSelect
                      v-model="logicalRetryMode"
                      :options="logicalRetryOptions"
                      aria-label="逻辑重试"
                      block
                    />
                    <input v-if="logicalRetryMode === 'custom'" v-model.number="customLogicalRetries" type="number" :min="1" :max="platformLogicalRetries" step="1" class="mk-input mono" aria-label="最大逻辑重试次数" />
                  </div>
                </div>
              </div>
            </section>
                </div>
              </div>
              <div class="mk-modal__foot sdp-config-modal__foot">
                <button type="button" class="mk-btn mk-btn--sm mk-btn--danger-ghost" :disabled="rtSaving" @click="resetRuntime">恢复默认</button>
                <span class="sdp-config-modal__spacer"></span>
                <button type="button" class="mk-btn" @click="closeConfig">取消</button>
                <button type="button" class="mk-btn mk-btn--primary" :disabled="rtSaving" @click="saveRuntime()">
                  {{ rtSaving ? '保存中…' : '保存' }}
                </button>
              </div>
            </div>
          </div>
        </Teleport>

      </div>

      <div v-if="rtMsg" class="sdp-form__footer">
        <p class="sdp-form__msg" :class="{ 'is-err': rtErr }">{{ rtMsg }}</p>
      </div>
    </section>

  </div>
</template>

<script setup lang="ts">
/**
 * 运行时 tab：模型与路由（覆盖平台默认开关 / 模型层级 / 思考档 / 超时 / 参数覆盖）
 * + 模型测试（直发上游探测）。重排说明见模板顶部注释：本组件是该页唯一的编辑入口。
 * 2026-11-04 用户「去掉降级这个功能，不要」：备用链（降级顺序）整块撤除。
 */
import { computed, ref, watch } from 'vue'
import { adminPlatformSettingsApi, adminSkillsApi } from '@/api/adminApi'
import { askConfirm } from '../useConfirm'
import { useEscape } from '../useEscape'
import { useOverlay, useMaskClose } from '../useOverlay'
import { errText, callParamSourceLabel, thinkingCapabilityNotice, type ThinkingCapability } from './sdp-shared'
import { REASONING_EFFORT_LEVELS, effortOptions, normalizeEfforts, type ReasoningEffortLevel } from '../reasoningEfforts'
import { useModelCatalog } from '@/composables/useModelCatalog'
import MkModelPicker from '@/components/mk/MkModelPicker.vue'
import MkSwitch from '@/components/mk/MkSwitch.vue'
import MkSelect from '@/components/mk/MkSelect.vue'

// 模型目录候选（File-as-Truth llm-providers.json）：模型选择器消费；
// 加载失败静默降级为空目录（仍可按输入提交别名 / 注册表外 id，不影响保存）
const { pickerOptions, load: loadModelCatalog } = useModelCatalog()
loadModelCatalog()

/* 文案单源（R6 复读单源化）：思考模式/思考强度下拉的默认项、参数覆盖四个下拉的默认项。
   2026-10-26 用户「不太想走继承这个说法」：这些下拉的「不填」各自指向不同来源，直说来源即可——
   · 思考模式/强度：不填 = 按模型自身默认（模型支持就按它的默认走）
   · 参数覆盖：不填 = 按 Prompt 文件声明取值（Prompt 优先于平台默认，是另一层） */
const INHERIT_DEFAULT_LABEL = '按模型默认'
const INHERIT_PROMPT_LABEL = '按 Prompt 声明'

/* MkSelect 选项：值与原 <option> 的 value 一致，文案逐字保留 */
const THINKING_MODE_OPTIONS = [
  { value: 'default', label: INHERIT_DEFAULT_LABEL },
  { value: 'enabled', label: '开启' },
  { value: 'disabled', label: '关闭' }
] as const
/** 思考强度的候选**不由平台写死**（2026-11-05）：先取生效模型声明的挡位，
 *  下拉只出这几档。模型不在目录（自定义通道 / 历史值）时退回词表全集，
 *  由服务端的 thinking-policy 再按能力裁一次——这里少给一档，运营就选不到它。 */
const reasoningEffortOptions = computed(() => {
  const levels = effectiveModelCap.value?.efforts?.length
    ? normalizeEfforts(effectiveModelCap.value.efforts)
    : [...REASONING_EFFORT_LEVELS]
  return effortOptions(levels, INHERIT_DEFAULT_LABEL)
})
const PARAM_MODE_OPTIONS = [
  { value: 'inherit', label: INHERIT_PROMPT_LABEL },
  { value: 'override', label: '覆盖' }
] as const

const props = defineProps<{ skillId: string; refreshTick: number }>()
/* #118：运行时配置的未保存改动上报宿主（此前只有协议编辑器有脏态，切 Skill/离开页面会静默丢弃） */
const emit = defineEmits<{ (e: 'dirty', p: { dirty: boolean; label: string }): void }>()

interface RuntimeForm {
  model: string
  thinkingMode: 'default' | 'enabled' | 'disabled'
  reasoningEffort: 'default' | ReasoningEffortLevel
  requestTimeoutMs: number | null
  enabled: boolean
}
const rtForm = ref<RuntimeForm>({
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
/** 「自定义」在原 <option> 上按平台上限禁用；MkSelect 无逐项禁用，改为上限为 0 时不出该项
 *  （已选 custom 时仍保留，避免回显空白）。 */
const logicalRetryOptions = computed<Array<{ value: 'inherit' | 'disabled' | 'custom'; label: string }>>(() => [
  { value: 'inherit', label: '用平台默认' },
  { value: 'disabled', label: '禁用' },
  ...(platformLogicalRetries.value > 0 || logicalRetryMode.value === 'custom'
    ? [{ value: 'custom' as const, label: '自定义' }]
    : [])
])
/** 请求超时两态（与紧邻的逻辑重试同形）：沿用平台默认，或本 Skill 单独指定毫秒数。
 *  2026-11-02 评审：原先是数字框靠占位符写「平台默认」，框里显出文字又被当成当前取值。
 *  独立的状态位（不从值反推）：选了「自定义」还没填数时，下拉不能被值反推回去。 */
type TimeoutMode = 'inherit' | 'custom'
const TIMEOUT_MODE_OPTIONS = [
  { value: 'inherit', label: '用平台默认' },
  { value: 'custom', label: '自定义' }
]
const timeoutMode = ref<TimeoutMode>('inherit')
const generationParams = ref<{ model?: string | null; temperature?: number | null; topP?: number | null; maxTokens?: number | null; sources?: Record<string, string>; owner?: string } | null>(null)

// ── 参数覆盖（paramOverrides）：每字段「继承 / 覆盖」三选 ──
type ParamMode = 'inherit' | 'override'
interface ParamField { mode: ParamMode; value: number | null }
const paramT = ref<ParamField>({ mode: 'inherit', value: null })
const paramTopP = ref<ParamField>({ mode: 'inherit', value: null })
const paramMax = ref<ParamField>({ mode: 'inherit', value: null })
const paramAttempts = ref<ParamField>({ mode: 'inherit', value: null })
// 加载时该 skill 是否已有覆盖（决定保存时是发对象、发 null 清空、还是不发）
const hadParamOverrides = ref(false)

const effectiveLogicalRetries = computed(() =>
  logicalRetryMode.value === 'inherit' ? platformLogicalRetries.value : logicalRetryMode.value === 'disabled' ? 0 : customLogicalRetries.value
)
const thinkingLabel = computed(() =>
  rtForm.value.thinkingMode === 'enabled' ? '开启' : rtForm.value.thinkingMode === 'disabled' ? '关闭' : '按模型默认'
)
const sourceLabel = (k: string) => callParamSourceLabel(generationParams.value?.sources?.[k])
/** 继承档的生效取值：只读展示合并链（Prompt 文件声明 → 代码默认 → 平台默认）算出来的数。
 *  2026-11-02 评审：四行都写「按 Prompt 声明」，每行看不到自己到底取了多少。
 *  maxAttempts 不在配置接口的生效值投影里（后端只投 temperature/topP/maxTokens），显 — 不猜。 */
type EffectiveParamKey = 'temperature' | 'topP' | 'maxTokens' | 'maxAttempts'
function paramValText(k: EffectiveParamKey): string {
  if (k === 'maxAttempts') return '—'
  const v = generationParams.value?.[k]
  return v == null ? '—' : String(v)
}
function paramValTitle(k: EffectiveParamKey): string {
  if (k === 'maxAttempts') return '该字段的生效取值未随配置接口返回，需要核对 Prompt 文件'
  const v = paramValText(k)
  return v === '—' ? '当前没有取到生效取值' : `当前实际取值 ${v} · 来源：${sourceLabel(k)}`
}
/** 卡头开关的悬停全文：说清「覆盖什么」与「关掉之后谁生效」——
 *  「独立配置」只说明它独立，说不出独立于谁，运营没法据此判断该不该开。 */
const overrideTitle =
  '开启后本 Skill 使用下面这套模型、参数与超时设置，与平台默认冲突时优先。'
  + '关闭后这些设置不参与，模型与超时按平台默认，生成参数仍按 Prompt 文件声明取值。'
/** 取值顺序的悬停全文：UI 上一行只放主链，具体分层在这里写全（与后端
 *  resolve-llm-call-params 的字段级合并序一致，2026-10-24 核对） */
const orderTitle =
  '模型：本 Skill 指定 → 平台默认模型 → 代码默认 → Prompt 里的历史副本\n'
  + '生成参数（T / topP / Max）：本 Skill 覆盖 → Prompt 文件声明 → 代码默认 → 平台默认\n'
  + '超时与逻辑重试：本 Skill 设置 → 平台默认\n'
  + '每一层只取第一个有值的字段，未填即跳过'
/** 模型沿用平台默认（开关关闭 或 模型留空）——此时表单里可能还留着上次选的模型值，
 *  但真正在跑的是平台默认模型，模型段要显示后者 */
const inheritingModel = computed(() => !(rtForm.value.enabled && rtForm.value.model))
/** 跟随平台默认时实际在跑的模型：补上「平台默认」到底是谁。
 *  2026-11-02 评审：这句原先带「覆盖已开启 / 已关闭」，而它出现在配置弹层的模型区里——
 *  那个弹层没有「覆盖」开关，读者既看不到也改不了该状态。这里只陈述这一项的事实。 */
const inheritedModelText = computed(() => {
  if (!inheritingModel.value) return ''
  const model = String(generationParams.value?.model || '')
  if (!model) return ''
  return `模型未单独指定，当前使用平台默认：${model}`
})
/** 能力胶囊写成陈述句（2026-11-02 评审）：裸「思考 / 推理强度」被读成没有值的标签 */
const summaryCaps = computed(() => {
  const opt = primaryOption.value
  const cap = effectiveModelCap.value
  return [
    cap?.thinking ? '支持思考' : '',
    cap?.efforts.length ? `支持推理强度 ${cap.efforts.join(' / ')}` : '',
    opt?.vision ? '支持读图' : ''
  ].filter(Boolean)
})
const summaryMeta = computed(() => {
  const opt = primaryOption.value
  // 目录里查不到这个模型（继承平台默认 / 自定义通道）时这里不说话：
  // 「覆盖开着却用平台默认」的事实由「模型：平台默认」胶囊表达，
  // 在这行再写一遍会与卡头绿色开关读作自相矛盾（2026-11-02 评审）
  if (!opt) return ''
  const price = opt.priceIn != null || opt.priceOut != null
    ? `入 ${opt.priceIn ?? '—'} / 出 ${opt.priceOut ?? '—'}`
    : ''
  return [opt.providerName, price].filter(Boolean).join(' · ')
})
/** 生效模型的能力声明（注册表）：选中模型优先；继承时用侧栏解析出的生效模型查目录 */
const effectiveModelCap = computed<ThinkingCapability | null>(() => {
  const id = String(rtForm.value.enabled && rtForm.value.model ? rtForm.value.model : generationParams.value?.model || '')
  if (!id) return null
  const opt = pickerOptions.value.find((o) => o.value === id)
  return opt ? { thinking: opt.thinking, efforts: opt.efforts } : null
})
const thinkingNotice = computed(() =>
  thinkingCapabilityNotice(
    { thinkingMode: rtForm.value.thinkingMode, reasoningEffort: rtForm.value.reasoningEffort },
    effectiveModelCap.value
  )
)

/* ---------- 基线 + 差异（2026-11-04） ----------
   基线 = 这个 Skill 什么都不改时会拿到的配置。卡面只列改过的项，每项右侧标注基线会取什么。 */
/** 推理强度在卡面的读数（思考关掉时它不参与，恒为「按模型默认」） */
const cfgEffortLabel = computed(() =>
  rtForm.value.reasoningEffort === 'default' ? '按模型默认' : rtForm.value.reasoningEffort
)
/** 基线模型：本 Skill 没单独指定时就是平台默认（generationParams 的合并链已算出） */
const baseModel = computed(() => {
  if (rtForm.value.enabled && rtForm.value.model) return rtForm.value.model
  return String(generationParams.value?.model || '平台默认模型')
})
/** 基线这一行的来源句：换模型这件事本身有没有做 */
const baseModelSource = computed(() => {
  if (!rtForm.value.enabled) return '平台默认模型'
  return rtForm.value.model ? '本 Skill 指定' : '平台默认模型'
})
interface DiffRow { label: string; value: string; base: string; baseTitle: string; changed: boolean }
/** 五项读数逐条与基线对比；覆盖关闭时这套设置不参与，不列差异 */
const diffRows = computed<DiffRow[]>(() => {
  if (!rtForm.value.enabled) return []
  const t = paramT.value
  return [
    {
      label: '思考模式',
      value: thinkingLabel.value,
      base: INHERIT_DEFAULT_LABEL,
      baseTitle: '这一项不单独设置时，由模型自身决定要不要思考',
      changed: rtForm.value.thinkingMode !== 'default'
    },
    {
      label: '推理强度',
      value: cfgEffortLabel.value,
      base: INHERIT_DEFAULT_LABEL,
      baseTitle: '这一项不单独设置时，由模型自身决定思考的深度',
      changed: rtForm.value.thinkingMode !== 'disabled' && rtForm.value.reasoningEffort !== 'default'
    },
    {
      label: 'temperature',
      value: t.mode === 'override' && t.value != null ? String(t.value) : String(generationParams.value?.temperature ?? '—'),
      base: INHERIT_PROMPT_LABEL,
      baseTitle: '这一项不覆盖时，取 Prompt 文件里声明的值',
      changed: t.mode === 'override'
    },
    {
      label: '请求超时',
      value: rtForm.value.requestTimeoutMs ? `${Math.round(rtForm.value.requestTimeoutMs / 1000)}s` : '平台默认',
      base: '平台默认',
      baseTitle: '这一项不单独设置时，用平台的请求超时',
      changed: rtForm.value.requestTimeoutMs != null
    },
    {
      label: '逻辑重试',
      value: `${effectiveLogicalRetries.value} 次`,
      base: `平台默认 ${platformLogicalRetries.value} 次`,
      baseTitle: '这一项不单独设置时，用平台的逻辑重试次数',
      changed: logicalRetryMode.value !== 'inherit'
    }
  ]
})
const changedRows = computed(() => diffRows.value.filter((r) => r.changed))

/** 主模型在目录里的条目：用于就地核对能力与价格（2026-11-04 起不再收窄备用候选） */
const primaryOption = computed(() => pickerOptions.value.find((o) => o.value === rtForm.value.model) ?? null)
const primaryMetaText = computed(() => {
  const o = primaryOption.value
  if (!o) return ''
  const caps = [
    o.thinking ? '思考' : '',
    o.efforts.length ? `推理强度 ${o.efforts.join(' / ')}` : '',
    o.vision ? '读图' : ''
  ].filter(Boolean).join(' / ')
  const price = o.priceIn != null || o.priceOut != null
    ? `入 ${o.priceIn ?? '—'} / 出 ${o.priceOut ?? '—'}`
    : ''
  // 2026-11-04：不再把目录里的档位枚举（chat / reasoning）印在这一行——它是目录分类，
  // 不是运营要在这里做的选择；能力与价格才是就地核对的对象。
  return [o.providerName, caps, price].filter(Boolean).join(' · ')
})

watch(
  () => rtForm.value.thinkingMode,
  (m) => {
    if (m === 'disabled') rtForm.value.reasoningEffort = 'default'
  }
)

/** 默认运行时表单（与初始定义一致）；切 skill / 404 时显式回退，避免残留上一个 skill 的数据 */
function resetRtForm() {
  rtForm.value = {
    model: '',
    thinkingMode: 'default',
    reasoningEffort: 'default',
    requestTimeoutMs: null,
    enabled: false
  }
  logicalRetryMode.value = 'inherit'
  customLogicalRetries.value = 1
  timeoutMode.value = 'inherit'
  paramT.value = { mode: 'inherit', value: null }
  paramTopP.value = { mode: 'inherit', value: null }
  paramMax.value = { mode: 'inherit', value: null }
  paramAttempts.value = { mode: 'inherit', value: null }
  hadParamOverrides.value = false
}

/* ---------- 配置弹层（2026-10-28）：取消回滚，保存一次提交 ---------- */
const configOpen = ref(false)
const configPanelRef = ref<HTMLElement | null>(null)
const configMaskRef = ref<HTMLElement | null>(null)
interface ConfigBackup {
  form: RuntimeForm
  logicalRetryMode: 'inherit' | 'disabled' | 'custom'
  /** 超时两态也要进备份：它不从值反推，「取消」时得一起回滚（否则选了自定义又取消会留住状态） */
  timeoutMode: TimeoutMode
  customLogicalRetries: number
  paramT: ParamField
  paramTopP: ParamField
  paramMax: ParamField
  paramAttempts: ParamField
  hadParamOverrides: boolean
}
let configBackup: ConfigBackup | null = null

function openConfig() {
  if (!rtForm.value.enabled) return
  configBackup = {
    form: { ...rtForm.value },
    logicalRetryMode: logicalRetryMode.value,
    timeoutMode: timeoutMode.value,
    customLogicalRetries: customLogicalRetries.value,
    paramT: { ...paramT.value },
    paramTopP: { ...paramTopP.value },
    paramMax: { ...paramMax.value },
    paramAttempts: { ...paramAttempts.value },
    hadParamOverrides: hadParamOverrides.value
  }
  configOpen.value = true
}

function closeConfig() {
  if (configBackup) {
    rtForm.value = { ...configBackup.form }
    logicalRetryMode.value = configBackup.logicalRetryMode
    timeoutMode.value = configBackup.timeoutMode
    customLogicalRetries.value = configBackup.customLogicalRetries
    paramT.value = { ...configBackup.paramT }
    paramTopP.value = { ...configBackup.paramTopP }
    paramMax.value = { ...configBackup.paramMax }
    paramAttempts.value = { ...configBackup.paramAttempts }
    hadParamOverrides.value = configBackup.hadParamOverrides
  }
  configBackup = null
  configOpen.value = false
  reportDirty()
}

useEscape(() => configOpen.value, closeConfig)
useOverlay(configOpen, configPanelRef)
useMaskClose(configMaskRef, closeConfig)

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
    const raw = (skillRes.value.data?.data || null) as (RuntimeForm & { maxLogicalRetries?: number | null; paramOverrides?: string | null; generationParams?: typeof generationParams.value }) | null
    generationParams.value = raw?.generationParams || null
    rtForm.value = {
      model: raw?.model || '',
      thinkingMode: raw?.thinkingMode || 'default',
      reasoningEffort: raw?.reasoningEffort || 'default',
      requestTimeoutMs: raw?.requestTimeoutMs ?? null,
      enabled: raw?.enabled === true
    }
    timeoutMode.value = raw?.requestTimeoutMs ? 'custom' : 'inherit'
    logicalRetryMode.value = raw?.maxLogicalRetries == null ? 'inherit' : raw.maxLogicalRetries === 0 ? 'disabled' : 'custom'
    customLogicalRetries.value = raw?.maxLogicalRetries && raw.maxLogicalRetries > 0 ? Math.min(raw.maxLogicalRetries, platformLogicalRetries.value || 1) : 1
    // 参数覆盖：JSON 原文 → 每字段 mode/value；缺字段=继承
    let po: Record<string, number> = {}
    if (raw?.paramOverrides) { try { po = JSON.parse(raw.paramOverrides) || {} } catch { po = {} } }
    hadParamOverrides.value = Object.keys(po).length > 0
    paramT.value = po.temperature != null ? { mode: 'override', value: po.temperature } : { mode: 'inherit', value: null }
    paramTopP.value = po.topP != null ? { mode: 'override', value: po.topP } : { mode: 'inherit', value: null }
    paramMax.value = po.maxTokens != null ? { mode: 'override', value: po.maxTokens } : { mode: 'inherit', value: null }
    paramAttempts.value = po.maxAttempts != null ? { mode: 'override', value: po.maxAttempts } : { mode: 'inherit', value: null }
  } else {
    // 无本 Skill 覆盖（404）等失败：显式重置为默认值，不残留上一 skill
    resetRtForm()
    generationParams.value = null
  }
  // 数据落地 → 重置脏态基线（#118：加载失败走的是默认值分支，同样不该算用户改动）
  dirtyBase = formSnapshot()
  dirtyNow.value = false
  emit('dirty', { dirty: false, label: '运行时配置' })
}

async function saveRuntime(okMsg = '已更新') {
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
        rtMsg.value = `${label} 的覆盖值未填（或不是数字）：清空该项请把模式切回「按 Prompt 声明」，留空保存会按 0 提交。`
        return null
      }
      return n
    }
    const tVal = overrideNum('temperature', paramT.value.mode, paramT.value.value)
    const topPVal = overrideNum('topP', paramTopP.value.mode, paramTopP.value.value)
    const maxVal = overrideNum('maxTokens', paramMax.value.mode, paramMax.value.value)
    const attemptsVal = overrideNum('maxAttempts', paramAttempts.value.mode, paramAttempts.value.value)
    if (!invalid && attemptsVal != null && (!Number.isInteger(attemptsVal) || attemptsVal < 1 || attemptsVal > 5)) {
      rtErr.value = true
      rtMsg.value = 'maxAttempts 须是 1 到 5 的整数。'
      return
    }
    if (invalid) return
    /* 超时选了自定义却没填：空值会归一成 null，与「用平台默认」无法区分，等于静默改回默认 */
    if (timeoutMode.value === 'custom' && normNum(rtForm.value.requestTimeoutMs) == null) {
      rtErr.value = true
      rtMsg.value = '请求超时选了「自定义」但没填毫秒数：请填 10000 到 300000 之间的数值，或切回「用平台默认」。'
      return
    }
    const overrides: Record<string, number> = {}
    if (tVal != null) overrides.temperature = tVal
    if (topPVal != null) overrides.topP = topPVal
    if (maxVal != null) overrides.maxTokens = maxVal
    if (attemptsVal != null) overrides.maxAttempts = attemptsVal
    const payload: Record<string, unknown> = {
      model: rtForm.value.model || undefined,
      thinkingMode: rtForm.value.thinkingMode,
      reasoningEffort: rtForm.value.thinkingMode === 'disabled' ? 'default' : rtForm.value.reasoningEffort,
      requestTimeoutMs: rtForm.value.enabled ? normNum(rtForm.value.requestTimeoutMs) : null,
      maxLogicalRetries: logicalRetryMode.value === 'inherit' ? null : logicalRetryMode.value === 'disabled' ? 0 : normNum(customLogicalRetries.value),
      enabled: rtForm.value.enabled
    }
    if (Object.keys(overrides).length > 0) payload.paramOverrides = overrides
    else if (hadParamOverrides.value) payload.paramOverrides = null
    await adminSkillsApi.updateSkillModelConfig(props.skillId, payload)
    rtErr.value = false
    rtMsg.value = okMsg
    await loadRuntime()
    configOpen.value = false
    configBackup = null
  } catch (e) {
    rtErr.value = true
    rtMsg.value = `保存失败：${errText(e)}`
  } finally {
    rtSaving.value = false
  }
}

/* 卡头「覆盖平台默认」开关：翻转即落盘（2026-11-03）。
   这枚开关是全页唯一落在卡面的表单字段，而卡面没有保存钮——此前翻转只置脏态，
   真正落盘得进配置弹层再点「保存」，用户翻完就离开，改动无声丢失（脏态只喂了
   导航守卫的离开确认）。现在翻转直接调同一套保存：弹层关着时表单其余字段等于
   最近一次落盘值（弹层取消会回滚），所以这次保存只会改变 enabled 这一项；
   失败则把开关退回原状——开关显示的状态与库里存的状态始终一致。 */
async function onOverrideToggle(next: boolean) {
  if (rtSaving.value || next === rtForm.value.enabled) return
  rtForm.value.enabled = next
  await saveRuntime(next ? '覆盖已开启，已保存' : '覆盖已关闭，已保存')
  if (rtErr.value) rtForm.value.enabled = !next
}

async function resetRuntime() {
  if (rtSaving.value) return
  const ok = await askConfirm({
    title: '恢复默认配置',
    message: '确定恢复该 Skill 的默认模型配置吗？\n本 Skill 的覆盖配置将被删除，改为用平台默认。',
    confirmText: '恢复默认'
  })
  if (!ok) return
  rtSaving.value = true
  rtMsg.value = ''
  try {
    await adminSkillsApi.deleteSkillModelConfig(props.skillId)
    rtErr.value = false
    rtMsg.value = '已恢复默认（用平台默认）'
    await loadRuntime()
    configOpen.value = false
    configBackup = null
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
    configOpen.value = false
    configBackup = null
    resetRtForm()
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
    at: paramAttempts.value
  })
}
let dirtyBase = formSnapshot()
function reportDirty() {
  const dirty = formSnapshot() !== dirtyBase
  dirtyNow.value = dirty
  emit('dirty', { dirty, label: '运行时配置' })
}
watch(
  [rtForm, logicalRetryMode, customLogicalRetries, paramT, paramTopP, paramMax, paramAttempts],
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
/* 取值顺序：一行说清「谁压谁」。原来这块是「生效值」只读摘要，把下面各分节的
   当前值又抄一遍（导航副文、分节页头、表单各一份），已删（2026-10-24 用户判定无意义）。 */
/* 卡面「基线 + 差异」（2026-11-04）：第一段是基线（平台默认模型那一行），
   第二段只列本 Skill 改过的项。 */
.sdp-live { display: grid; gap: 14px; }
.sdp-live__note { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-amber); line-height: 1.6; }
.sdp-base { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
/* 「基线」这枚词是这一行的角色标签，不是值：做成小字灰标签，别抢模型 id 的第一眼 */
.sdp-base__k {
  padding: 1px 7px;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface-2);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  line-height: 1.7;
}
/* 主角：基线模型 id（比读数高一级，卡面第一眼先读它） */
.sdp-base__model { color: var(--mk-ink); font-weight: 700; font-size: var(--mk-fs-emphasis); overflow-wrap: anywhere; }
.sdp-base__meta { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.sdp-base__src { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.sdp-diff { display: grid; gap: 8px; }
.sdp-diff__k { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); font-weight: 700; letter-spacing: 0.04em; }
.sdp-diff__list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
/* 一行三格：项名 / 本 Skill 的取值 / 未调整时会取什么。第三格是差异的对照面，
   亮度降一档，读起来像脚注而不是第二个值。 */
.sdp-diff__list > li { display: grid; grid-template-columns: 96px minmax(0, 1fr) auto; gap: 10px; align-items: baseline; min-width: 0; }
.sdp-diff__label { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.sdp-diff__val { color: var(--mk-ink); font-weight: 700; overflow-wrap: anywhere; }
.sdp-diff__base { color: var(--mk-faint); font-size: var(--mk-fs-micro); font-style: normal; }
.sdp-diff__none { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
@media (max-width: 720px) {
  .sdp-diff__list > li { grid-template-columns: minmax(0, 1fr); gap: 2px; }
}

.sdp-config-modal { width: min(720px, 96vw); }
.sdp-config-modal__foot { display: flex; align-items: center; gap: 8px; }
.sdp-config-modal__spacer { flex: 1 1 auto; }

/* 一页纵向铺开（2026-10-25）：四段按「模型 → 生成参数 → 请求与容错 → 模型测试」顺序排列，
   段间用发丝线分隔；不再有左导航，所以也不需要 shell/detail 的两栏容器。 */
.sdp-sections { display: grid; gap: 0; }
.sdp-panel { display: grid; gap: 14px; align-content: start; }
/* 段与段之间一条发丝线；首段不画（否则与取值顺序那行的下边框叠两条） */
.sdp-panel + .sdp-panel { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--mk-line); }
.sdp-panel__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.sdp-panel__head h4 { margin: 0; font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); }
.sdp-panel__state { font-size: var(--mk-fs-micro); color: var(--mk-faint); overflow-wrap: anywhere; }


.sdp-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface-2);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
}
/* 卡头：覆盖开关与配置入口同处右组；标题左，动作右 */
.sdp-card__head { flex-wrap: wrap; }
.sdp-head__switch { margin-left: auto; }

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
  /* 两列：标签 + 控件。第三列（128px）原留给「继承」二字，但下拉框选中的文案就是
     「按 Prompt 声明」——同一个事实说两遍，还白占 128px（2026-10-26 走查实见）。
     选「覆盖」时数值输入框接在控件列里，行高不变。 */
  grid-template-columns: minmax(140px, 1fr) minmax(170px, 1.2fr);
  gap: 8px;
  align-items: center;
  min-width: 0;
}
.sdp-param__label { display: flex; align-items: baseline; gap: 6px; font-size: var(--mk-fs-micro); color: var(--mk-muted); font-weight: 600; }
.sdp-param__range { font-weight: 400; color: var(--mk-faint); }
@media (max-width: 900px) {
  .sdp-param { grid-template-columns: minmax(0, 1fr) 128px; }
  .sdp-param__label { grid-column: 1 / -1; }
}
.sdp-param__ctl { display: grid; grid-template-columns: minmax(0, 1fr) 128px; gap: 8px; align-items: center; }
.sdp-param__ctl > :only-child { grid-column: 1 / -1; }
/* 继承档的生效取值（只读）：与右侧输入框同宽同位，切到「覆盖」时被输入框顶替，行高不变 */
.sdp-param__val { font-size: var(--mk-fs-micro); color: var(--mk-ink); text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 700px) {
  /* 窄屏：参数行整行放模式选择 */
  .sdp-param { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 860px) {
  .sdp-form__grid { grid-template-columns: 1fr; }
}
.sdp-field { display: grid; gap: 5px; min-width: 0; align-content: start; }
.sdp-field--wide { grid-column: 1 / -1; }
.sdp-field > span { font-size: var(--mk-fs-micro); color: var(--mk-muted); font-weight: 600; }
.sdp-field > span em { font-style: normal; font-weight: 400; color: var(--mk-faint); margin-left: 6px; }
.sdp-model-meta { font-size: var(--mk-fs-micro); color: var(--mk-faint); overflow-wrap: anywhere; }
.sdp-form__footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 0 16px 16px;
}
.sdp-form__msg { margin: 0 auto 0 0; font-size: var(--mk-fs-micro); color: var(--mk-green); font-weight: 600; }
.sdp-form__msg.is-err { color: var(--mk-red); }
.sdp-error {
  padding: 10px 12px;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-red-bg);
  border: 1px solid rgba(220, 38, 38, 0.3);
  color: var(--mk-red);
  font-size: var(--mk-fs-micro);
}
/* 能力冲突提示：不是错误（配置可保存、换模型后即生效），用琥珀预警色 */
.sdp-cap-note {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--mk-radius-md);
  background: var(--mk-amber-bg, rgba(217, 119, 6, 0.12));
  color: var(--mk-amber);
  font-size: var(--mk-fs-micro);
}

/* 4K：字号跟随壳层放大 */
@media (min-width: 3600px) {
  .sdp-chip { font-size: var(--mk-fs-body); padding: 4px 12px; }
  .sdp-body { gap: 18px; padding: 6px 20px 20px; }
  .sdp-field > span { font-size: var(--mk-fs-body); }
  .sdp-pane .mk-input { font-size: var(--mk-fs-emphasis); padding: 12px 15px; }
  .sdp-form__msg { font-size: var(--mk-fs-body); }
  .sdp-form__footer { padding: 0 20px 20px; }
}

/* 暗色模式：分节导航用壳层已有的 subtle 底，不再单独覆盖 */
</style>
