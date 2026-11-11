<template>
  <!-- 运行时：模型与路由。
       2026-10-21 版式重做（用户「这个的布局不行，看看成熟设计」）：
       配置按「模型 / 生成参数 / 请求与容错」三段竖排，每段内是两列字段；
       参数覆盖从三列大格子改成一行一个字段的小表（标签 / 模式 / 值对齐）；
       ③（2026-11-04 撤除）模型测试那块已从本页撑出去：它是直发上游的连通性探测，
          平台「模型与接入」页每个模型都有「测试」，在 Skill 页再留一份等于同一件事两处入口；
       2026-11-10 用户「模型与路由也重新设计一下」（承接「不要有平台默认这个东西出现」）：
       卡头撤掉「覆盖平台默认」开关与那行黄字说明，只留「配置」；卡面 = 模型行（id + 能力/价格）
       + 事实格（只列有值的项：思考、强度、温度、topP、maxTokens、超时、重试）。
       改值进弹层，清掉这套配置用弹层里的「恢复默认」。 -->
  <div class="sdp-pane">
    <section class="mk-card">
      <div class="mk-card__head sdp-card__head">
        <h3 class="mk-card__title">模型与路由</h3>
        <!-- 2026-11-10 用户「模型与路由也重新设计一下」+ 上一轮「不要有平台默认这个东西出现，
             模型配置是什么，就是什么」：撤掉卡头「覆盖平台默认」开关。它把「这套配置启不启用」
             摆在了「现在跑什么」之前，关掉后卡面还留一行黄字解释机制；而开关本身只是
             skill_model_configs.enabled 的显隐，用户在卡上要的是当前模型与参数。
             现在只有一种状态：卡面陈述当前值，改值进弹层；要清掉这套配置用弹层的「恢复默认」。 -->
        <button type="button" class="mk-link sdp-head__act" :title="`改这个 Skill 的模型、生成参数与请求容错`" @click="openConfig">配置</button>
      </div>
      <!-- 卡头只保留标题 + 配置入口；旧「Prompt 里声明了 model 时，本页模型不参与」已删：
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
        <!-- 卡面只两行（2026-11-06 用户「没有什么基线之类的，只有切换模型，参数等等」）：
             模型一行（id + 能力陈述），参数一行（当前生效值连排）。
             此前两版的「基线 / 本 Skill 独立调整」是把机制讲给读者听，读者要的只是
             「这个 Skill 现在用哪个模型、参数是什么」；改值仍走卡头「配置」弹层。 -->
        <div class="sdp-live">
          <!-- 模型行：mono id + 能力小胶囊（与「系统设置 → 模型与接入」同一套语言）；
               动作已上移卡头，这一行只陈述「哪台模型、什么能力、什么价」。 -->
          <div class="sdp-modelrow">
            <span class="mono sdp-model" :title="`${baseModel}

${orderTitle}`">{{ baseModel }}</span>
            <span class="sdp-caps">
              <span v-for="tag in capTags" :key="tag" class="mk-badge mk-badge--muted sdp-cap">{{ tag }}</span>
              <span v-if="summaryMeta" class="sdp-meta" title="单价单位：USD / 1M tokens（在「系统设置 → 模型与接入」编辑）">· {{ summaryMeta }}</span>
            </span>
          </div>

          <!-- 参数读数：只列**有值**的项（思考模式、显式设过的强度、四项生成参数中填过的、
               设过的超时与重试）。没填的项不占位、也不写「平台默认」——那一列要回答
               「现在是什么」，不是「哪几项没配」。 -->
          <div v-if="runtimeFacts.length" class="mk-facts sdp-facts">
            <div v-for="f in runtimeFacts" :key="f.label">
              <span>{{ f.label }}</span>
              <strong>{{ f.value }}</strong>
            </div>
          </div>
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
                <!-- 不再写「模型」字段标签：分节名与面板标题都是「模型」，第三遍纯复读。
                     选择器只列真实模型、不再出「用平台默认模型」那一项（2026-11-06 用户
                     「什么覆盖默认什么的，没意义」）：显示的就是它在跑的模型；
                     本 Skill 没单独指定时显示生效的默认模型，改选即钉住，
                     想回到不单独指定用「恢复默认」。 -->
                <MkModelPicker
                  aria-label="模型"
                  :model-value="rtForm.model || effectiveModelId"
                  :options="pickerOptions"
                  @update:model-value="rtForm.model = $event"
                />
                <!-- 能力胶囊（2026-11-06 用户「不要这么设计，什么覆盖默认什么的，没意义」）：
                     不再写「模型未单独指定，当前使用平台默认：…」那类机制说明——选中项就是它在跑的
                     模型，能力与单价就地核对即可。 -->
                <span v-if="capTags.length" class="sdp-cap-row">
                  <span v-for="tag in capTags" :key="tag" class="mk-badge mk-badge--muted">{{ tag }}</span>
                  <span v-if="summaryMeta" class="sdp-cap-row__meta">{{ summaryMeta }}</span>
                </span>
              </label>
            </div>
          </section>

            <section id="sdp-panel-params" class="sdp-panel">
              <header class="sdp-panel__head">
                <h4>生成参数</h4>
                <!-- 2026-11-09 设计语言收敛：段头原先悬浮一枚「T=0.7」读数，而同一个
                     temperature 就在下面表单里——同一屏两个出口，且那个值只是某一项的复制。
                     读数撤除，段头只留段名，与同弹窗另两段一致。 -->
              </header>
              <div class="sdp-form__grid">
                <label class="sdp-field">
                  <span>思考模式</span>
                  <MkSelect
                    v-model="rtForm.thinkingMode"
                    :options="THINKING_MODE_OPTIONS"
                    aria-label="思考模式"
                    block
                  />
                </label>
                <label class="sdp-field">
                  <span>思考强度</span>
                  <MkSelect
                    v-model="rtForm.reasoningEffort"
                    :options="reasoningEffortOptions"
                    aria-label="推理强度"
                    block
                    :disabled="rtForm.thinkingMode === 'disabled'"
                  />
                </label>
              </div>
              <!-- 能力冲突提示（2026-10-24）：模型支不支持思考/强度由注册表声明，网关按能力裁剪；
                   裁剪是静默的，所以必须在配置处说明「写了也不会发」。模型不在目录时不猜、不提示。 -->
              <p v-if="thinkingNotice" class="sdp-cap-note" role="status">{{ thinkingNotice }}</p>

              <!-- 2026-11-09 设计语言收敛（弹窗表单）：这四个数字原先走 .sdp-param 的
                   「左标签 + 右输入框」横排，而同弹窗上面两项（思考模式 / 强度）和下面
                   请求与容错都是顶标签网格——同一个弹窗里两种表单语法。
                   统一成 .sdp-field 顶标签、两列网格，与「模型设置」弹窗同一套骨架。 -->
              <div class="sdp-form__grid">
                <label class="sdp-field">
                  <span>temperature <em class="sdp-field__range">0–2</em></span>
                  <input
                    v-model.number="temperatureInput"
                    type="number" min="0" max="2" step="0.1"
                    class="mk-input mono"
                    placeholder="未设置" aria-label="temperature"
                  />
                </label>
                <label class="sdp-field">
                  <span>topP <em class="sdp-field__range">0–1</em></span>
                  <input
                    v-model.number="topPInput"
                    type="number" min="0.01" max="1" step="0.05"
                    class="mk-input mono"
                    placeholder="未设置" aria-label="topP"
                  />
                </label>
                <label class="sdp-field">
                  <span>maxTokens <em class="sdp-field__range">256–131072</em></span>
                  <input
                    v-model.number="maxTokensInput"
                    type="number" min="256" max="131072" step="1000"
                    class="mk-input mono"
                    placeholder="未设置" aria-label="maxTokens"
                  />
                </label>
                <label class="sdp-field">
                  <span>maxAttempts <em class="sdp-field__range">1–5</em></span>
                  <input
                    v-model.number="maxAttemptsInput"
                    type="number" min="1" max="5" step="1"
                    class="mk-input mono"
                    placeholder="未设置" aria-label="maxAttempts"
                  />
                </label>
              </div>
            </section>

            <section id="sdp-panel-request" class="sdp-panel">
              <header class="sdp-panel__head">
                <h4>请求与容错</h4>
              </header>
              <div class="sdp-form__grid">
                <label class="sdp-field">
                  <!-- 只填毫秒数，留空就是平台的；不再先选「用平台默认 / 自定义」再填 -->
                  <span>请求超时（ms）</span>
                  <input
                    v-model.number="timeoutInput"
                    type="number" min="10000" max="300000" step="10000"
                    class="mk-input mono"
                    placeholder="未设置" aria-label="请求超时毫秒数"
                  />
                </label>
                <label class="sdp-field">
                  <span>逻辑重试（次）</span>
                  <input
                    v-model.number="retriesInput"
                    type="number" min="0" :max="platformLogicalRetries" step="1"
                    class="mk-input mono"
                    :aria-label="`逻辑重试次数，平台默认 ${platformLogicalRetries} 次`"
                  />
                </label>
              </div>
            </section>
                </div>
              </div>
              <div class="mk-modal__foot sdp-config-modal__foot">
                <button type="button" class="mk-btn mk-btn--danger-ghost" :disabled="rtSaving" @click="resetRuntime">恢复默认</button>
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
 * 运行时 tab：模型与路由（模型 / 思考 / 超时 / 参数覆盖）。重排说明见模板顶部注释：
 * 本组件是该页唯一的编辑入口。2026-11-10 起卡面陈述当前配置，不再有「这套配置启不启用」的开关。
 * 2026-11-04 用户「去掉降级这个功能，不要」：备用链（降级顺序）整块撤除。
 */
import { computed, ref, watch } from 'vue'
import { adminPlatformSettingsApi, adminSkillsApi } from '@/api/adminApi'
import { askConfirm } from '../useConfirm'
import { useEscape } from '../useEscape'
import { useOverlay, useMaskClose } from '../useOverlay'
import { errText, thinkingCapabilityNotice, type ThinkingCapability } from './sdp-shared'
import { COMMON_REASONING_EFFORTS, effortOptions, normalizeEfforts } from '../reasoningEfforts'
import { useModelCatalog } from '@/composables/useModelCatalog'
import MkModelPicker from '@/components/mk/MkModelPicker.vue'
import MkSelect from '@/components/mk/MkSelect.vue'

// 模型目录候选（File-as-Truth llm-providers.json）：模型选择器消费；
// 加载失败静默降级为空目录（仍可按输入提交别名 / 注册表外 id，不影响保存）
const { pickerOptions, load: loadModelCatalog } = useModelCatalog()
loadModelCatalog()

/* 文案单源（R6 复读单源化）：思考模式/思考强度下拉的默认项、参数覆盖四个下拉的默认项。
   2026-10-26 用户「不太想走继承这个说法」：这些下拉的「不填」各自指向不同来源，直说来源即可——
   · 思考模式/强度：不填 = 按模型自身默认（模型支持就按它的默认走）
   · 参数覆盖：不填 = 按 Prompt 文件声明取值（Prompt 优先于平台默认，是另一层） */
const INHERIT_DEFAULT_LABEL = '由模型决定'

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
    : [...COMMON_REASONING_EFFORTS]
  return effortOptions(levels, INHERIT_DEFAULT_LABEL)
})
const props = defineProps<{ skillId: string; refreshTick: number }>()
/* #118：运行时配置的未保存改动上报宿主（此前只有协议编辑器有脏态，切 Skill/离开页面会静默丢弃） */
const emit = defineEmits<{ (e: 'dirty', p: { dirty: boolean; label: string }): void }>()

interface RuntimeForm {
  model: string
  thinkingMode: 'default' | 'enabled' | 'disabled'
  reasoningEffort: 'default' | string
  requestTimeoutMs: number | null
}
const rtForm = ref<RuntimeForm>({
  model: '',
  thinkingMode: 'default',
  reasoningEffort: 'default',
  requestTimeoutMs: null
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
/** 超时的两态仍在内部保留：值框留空 = inherit，填了数 = custom。
 *  界面不再让用户先选这个状态（2026-11-06 用户「什么覆盖默认什么的，没意义」）。 */
type TimeoutMode = 'inherit' | 'custom'
const timeoutMode = ref<TimeoutMode>('inherit')
const generationParams = ref<{ model?: string | null; temperature?: number | null; topP?: number | null; maxTokens?: number | null; sources?: Record<string, string>; owner?: string } | null>(null)

// ── 参数覆盖（paramOverrides）：每字段「继承 / 覆盖」三选 ──
type ParamMode = 'inherit' | 'override'
interface ParamField { mode: ParamMode; value: number | null }
const paramT = ref<ParamField>({ mode: 'inherit', value: null })
const paramTopP = ref<ParamField>({ mode: 'inherit', value: null })
const paramMax = ref<ParamField>({ mode: 'inherit', value: null })
const paramAttempts = ref<ParamField>({ mode: 'inherit', value: null })

/* ---------- 「只填值」的绑定层（2026-11-06 用户「不要这么设计，什么覆盖默认什么的，没意义」） ----------
   弹层里每一行只有一个输入框：显示的是**当前生效值**（本 Skill 覆盖过就用覆盖值，否则用 Prompt
   声明值），留空即不设。用户不再先选「按 Prompt 声明 / 覆盖」再填数。
   底下仍是原来那套 mode + value：值没动过 → 仍是 inherit（保存不发这个键，Prompt 改了会跟着变）；
   填了数 → override。 */
type ParamFieldKey = 'temperature' | 'topP' | 'maxTokens' | 'maxAttempts'
const paramFieldRefs: Record<ParamFieldKey, typeof paramT> = {
  temperature: paramT,
  topP: paramTopP,
  maxTokens: paramMax,
  maxAttempts: paramAttempts
}
/** 各字段的 Prompt 声明值（生效链里本 Skill 不覆盖时取的那个） */
const promptParamValues = computed<Record<ParamFieldKey, number | null>>(() => ({
  temperature: generationParams.value?.temperature ?? null,
  topP: generationParams.value?.topP ?? null,
  maxTokens: generationParams.value?.maxTokens ?? null,
  // maxAttempts 不随配置接口返回生效值（后端只投 temperature/topP/maxTokens），留空由后端按自身默认
  maxAttempts: null
}))
function readParamInput(k: ParamFieldKey): number | null {
  const f = paramFieldRefs[k].value
  if (f.mode === 'override' && f.value != null) return Number(f.value)
  const pe = promptParamValues.value[k]
  return pe == null ? null : Number(pe)
}
function writeParamInput(k: ParamFieldKey, raw: unknown): void {
  const n = raw === '' || raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw)
  paramFieldRefs[k].value = n == null ? { mode: 'inherit', value: null } : { mode: 'override', value: n }
}
const temperatureInput = computed({ get: () => readParamInput('temperature'), set: (v) => writeParamInput('temperature', v) })
const topPInput = computed({ get: () => readParamInput('topP'), set: (v) => writeParamInput('topP', v) })
const maxTokensInput = computed({ get: () => readParamInput('maxTokens'), set: (v) => writeParamInput('maxTokens', v) })
const maxAttemptsInput = computed({ get: () => readParamInput('maxAttempts'), set: (v) => writeParamInput('maxAttempts', v) })

/** 超时：只填毫秒数，留空＝按平台默认（原先是「用平台默认 / 自定义」两档下拉） */
const timeoutInput = computed<number | null>({
  get: () => rtForm.value.requestTimeoutMs ?? null,
  set: (v) => {
    const n = v == null || !Number.isFinite(Number(v)) ? null : Number(v)
    rtForm.value.requestTimeoutMs = n
    timeoutMode.value = n == null ? 'inherit' : 'custom'
  }
})
/** 逻辑重试：填 0 = 关掉重试；等于平台默认值即不单独设置（保存不发这个键） */
const retriesInput = computed<number | null>({
  get: () => effectiveLogicalRetries.value,
  set: (v) => {
    const n = v == null || !Number.isFinite(Number(v)) ? null : Number(v)
    if (n == null || n === platformLogicalRetries.value) {
      logicalRetryMode.value = 'inherit'
      return
    }
    if (n <= 0) {
      logicalRetryMode.value = 'disabled'
      return
    }
    logicalRetryMode.value = 'custom'
    customLogicalRetries.value = n
  }
})
// 加载时该 skill 是否已有覆盖（决定保存时是发对象、发 null 清空、还是不发）
const hadParamOverrides = ref(false)

const effectiveLogicalRetries = computed(() =>
  logicalRetryMode.value === 'inherit' ? platformLogicalRetries.value : logicalRetryMode.value === 'disabled' ? 0 : customLogicalRetries.value
)
const thinkingLabel = computed(() =>
  rtForm.value.thinkingMode === 'enabled' ? '开启' : rtForm.value.thinkingMode === 'disabled' ? '关闭' : '按模型默认'
)
/** 取值顺序的悬停全文：UI 上一行只放主链，具体分层在这里写全（与后端
 *  resolve-llm-call-params 的字段级合并序一致，2026-10-24 核对） */
const orderTitle =
  '模型：本 Skill 指定 → 平台默认模型 → 代码默认 → Prompt 里的历史副本\n'
  + '生成参数（T / topP / Max）：本 Skill 覆盖 → Prompt 文件声明 → 代码默认 → 平台默认\n'
  + '超时与逻辑重试：本 Skill 设置 → 平台默认\n'
  + '每一层只取第一个有值的字段，未填即跳过'
/** 能力胶囊写成陈述句（2026-11-02 评审）：裸「思考 / 推理强度」被读成没有值的标签 */
/** 能力标签：与「系统设置 → 模型与接入」的模型行同一套措辞
 *  （思考 / 视觉）——2026-11-06 用户「按照系统设置的展开页面进行新的设计」。
 *  2026-11-06 用户「有必要暴露强度在外面吗，配置那边也是」：不再把模型的挡位清单
 *  （low / high / max）当胶囊印出来——挡位在弹层里有专门的「思考强度」下拉，
 *  外面只需要知道这台模型支不支持思考、看不看图。 */
/** 本 Skill 自己指定的模型；空 = 没有这套配置，沿用当前模型（generationParams 的合并链） */
const ownModel = computed(() => String(rtForm.value.model || ''))
/** 生效模型 id：本 Skill 没指定时就是当前模型（选择器的回显值） */
const effectiveModelId = computed(() => ownModel.value || String(generationParams.value?.model || ''))
const capTags = computed(() => {
  /* 用**生效模型**查目录（没单独指定时 rtForm.model 是空的，直接查会落空，
     于是「视觉」这枚标签整个消失——与系统设置同一台模型的标签对不上）。 */
  const id = effectiveModelId.value
  const opt = pickerOptions.value.find((o) => o.value === id) ?? null
  const cap = effectiveModelCap.value
  return [
    /* 2026-11-11（困惑测试 #69）：模型能力标签「思考」与下方事实格的「思考模式」同词不同义，
       能力侧写成「支持思考」，配置侧写成「思考模式」。 */
    cap?.thinking ? '支持思考' : '',
    opt?.vision ? '视觉' : ''
  ].filter(Boolean)
})
const summaryMeta = computed(() => {
  const opt = primaryOption.value
  // 目录里查不到这个模型（自定义通道 / 历史 id）时这里不说话，不猜供应商与价格
  if (!opt) return ''
  const price = opt.priceIn != null || opt.priceOut != null
    ? `价 入 ${opt.priceIn ?? '—'} / 出 ${opt.priceOut ?? '—'}`
    : ''
  return [opt.providerName, price].filter(Boolean).join(' · ')
})
/** 生效模型的能力声明（注册表）：选中模型优先；没指定时用当前模型查目录 */
const effectiveModelCap = computed<ThinkingCapability | null>(() => {
  const id = effectiveModelId.value
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

/** 推理强度在卡面的读数（思考关掉时它不参与，恒为「按模型默认」） */
const cfgEffortLabel = computed(() =>
  rtForm.value.reasoningEffort === 'default' ? '按模型默认' : rtForm.value.reasoningEffort
)
/** 卡面的模型标题：本 Skill 指定过就用它，否则用当前生效模型（没有就如实说未配置） */
const baseModel = computed(() => ownModel.value || String(generationParams.value?.model || '') || '未配置模型')
/** 卡面读数（2026-11-10 重设计）：只列**有值**的项——现在是什么，就写什么。
 *  没填的项不占位，也不出现「平台默认」这类占位词（用户要求：模型配置是什么就是什么）。
 *  温度 / topP / maxTokens 取生效值（本 Skill 覆盖 → Prompt 声明），超时与重试只在设过时列。 */
const runtimeFacts = computed<Array<{ label: string; value: string }>>(() => {
  const out: Array<{ label: string; value: string }> = []
  // 「思考模式」是配置状态（开启/关闭/按模型默认），与能力胶囊「支持思考」区分
  out.push({ label: '思考模式', value: thinkingLabel.value })
  if (rtForm.value.reasoningEffort !== 'default') out.push({ label: '思考强度', value: cfgEffortLabel.value })
  const temp = paramT.value.mode === 'override' && paramT.value.value != null
    ? paramT.value.value
    : generationParams.value?.temperature
  if (temp != null) out.push({ label: '温度', value: String(temp) })
  if (paramTopP.value.mode === 'override' && paramTopP.value.value != null) {
    out.push({ label: 'topP', value: String(paramTopP.value.value) })
  }
  const maxTok = paramMax.value.mode === 'override' && paramMax.value.value != null
    ? paramMax.value.value
    : generationParams.value?.maxTokens
  if (maxTok != null) out.push({ label: 'maxTokens', value: String(maxTok) })
  if (rtForm.value.requestTimeoutMs) out.push({ label: '超时', value: `${Math.round(rtForm.value.requestTimeoutMs / 1000)}s` })
  out.push({ label: '重试', value: `${effectiveLogicalRetries.value} 次` })
  return out
})

/** 主模型在目录里的条目：用于就地核对能力与价格（2026-11-04 起不再收窄备用候选） */
const primaryOption = computed(() => pickerOptions.value.find((o) => o.value === effectiveModelId.value) ?? null)

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
    requestTimeoutMs: null
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
      requestTimeoutMs: raw?.requestTimeoutMs ?? null
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
      requestTimeoutMs: normNum(rtForm.value.requestTimeoutMs),
      maxLogicalRetries: logicalRetryMode.value === 'inherit' ? null : logicalRetryMode.value === 'disabled' ? 0 : normNum(customLogicalRetries.value),
      // 卡面不再有启用开关：能打开弹层并保存，就是要这套配置生效
      enabled: true
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

/* 卡头开关已于 2026-11-10 撤除（用户「模型与路由也重新设计一下」）：卡面只陈述当前配置，
   改值统一走「配置」弹层，不再有「这套配置启不启用」这一维。 */

async function resetRuntime() {
  if (rtSaving.value) return
  const ok = await askConfirm({
    title: '恢复默认配置',
    message: '确认删除该 Skill 的模型与参数配置？\n删除后这个 Skill 使用当前的默认模型。',
    confirmText: '恢复默认'
  })
  if (!ok) return
  rtSaving.value = true
  rtMsg.value = ''
  try {
    await adminSkillsApi.deleteSkillModelConfig(props.skillId)
    rtErr.value = false
    rtMsg.value = '已恢复默认'
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
/* 模型行（2026-11-06 用户「按照系统设置的展开页面，进行新的设计」）：
   与「系统设置 → 模型与接入」的模型行同构——mono id 打头、能力胶囊跟后；
   2026-11-10 用户「模型与路由也重新设计一下」：动作收进卡头，参数改成事实格。 */
.sdp-live { display: grid; gap: 12px; }
.sdp-modelrow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
/* 模型 id：卡面第一眼要读到的那个值 */
.sdp-model { color: var(--mk-ink); font-weight: 700; font-size: var(--mk-fs-emphasis); overflow-wrap: anywhere; }
.sdp-caps { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; }
.sdp-cap { font-weight: 600; }
.sdp-meta { color: var(--mk-faint); font-size: var(--mk-fs-micro); }
/* 参数读数：共享事实格（.mk-facts）三列；项数不固定（只列有值的项），
   列宽自适应到内容不挤——六项以上自然换成四列。 */
.sdp-facts { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px 16px; }

/* 控件同高 32px：这一屏的下拉（.mk-select__trigger）与按钮（.mk-btn）都是 32px，
   只有模型选择器还是 40px 的默认档，实测同一行三个高度（40 / 31 / 32）。
   只收竖向内衬、保留字号与右侧 38px 的清除位——MkModelPicker 的 compact 档会把字号
   连带降到 micro（12.5px），高度齐了字号又跳一档。 */
.sdp-config-modal :deep(.mk-mp__control) { min-height: 32px; padding-top: 5px; padding-bottom: 5px; }
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

/* 卡头：标题左，唯一的动作（配置）右 */
.sdp-card__head { flex-wrap: wrap; }
.sdp-head__act { margin-left: auto; }

.sdp-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
/* 数值字段的取值范围：跟标签同一行、同一档灰字（原 .sdp-param__range 的语义，
   随顶标签网格收进字段自己的标签里）。留空即取 Prompt 声明 / 平台默认值。 */
.sdp-field__range { font-style: normal; font-weight: 400; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
@media (max-width: 860px) {
  .sdp-form__grid { grid-template-columns: 1fr; }
}
.sdp-field { display: grid; gap: 5px; min-width: 0; align-content: start; }
.sdp-field--wide { grid-column: 1 / -1; }
.sdp-field > span { font-size: var(--mk-fs-micro); color: var(--mk-muted); font-weight: 600; }
.sdp-field > span em { font-style: normal; font-weight: 400; color: var(--mk-faint); margin-left: 6px; }
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
  .sdp-body { gap: 18px; padding: 6px 20px 20px; }
  .sdp-field > span { font-size: var(--mk-fs-body); }
  .sdp-pane .mk-input { font-size: var(--mk-fs-emphasis); padding: 12px 15px; }
  .sdp-form__msg { font-size: var(--mk-fs-body); }
  .sdp-form__footer { padding: 0 20px 20px; }
}

/* 暗色模式：分节导航用壳层已有的 subtle 底，不再单独覆盖 */
</style>
