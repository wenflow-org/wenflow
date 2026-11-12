<template>
  <!-- 模型编辑（新增 / 修改，2026-10-18 BYOK 重做）。
       字段与后端解析器的校验一一对应：思考与推理强度挡位（挡位依赖思考）、四类限额（正数）、单价。
       前端先拦一遍，后端再拦一次并回吐人话原因。
       「模型 ID」只在新增时可填：它是路由与被引用配置的键，改名等于换模型（后端也会拒）。
       档位（chat / reasoning）不在这一层让运营选：界面不做模型类型区分，编辑时原样带回，
       只有注册表里本就写着 reasoning 的条目不会被改成 chat。 -->
  <Teleport v-if="open" to="body">
    <div ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel mk-modal__panel--wide med-modal" role="dialog" aria-label="模型设置" @keydown.enter="onEnterSubmit">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">{{ title }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="close">✕</button>
        </div>

        <div class="mk-modal__body">
          <div v-if="error" class="mk-alert mk-alert--row" role="alert">
            <span class="mk-alert__msg">{{ error }}</span>
          </div>

          <!-- 字段按「先声明能力，再定默认值」排（2026-11-05 用户「能力开关与默认策略上下倒置」）：
               决定这台模型*能*做什么的开关在上，消费这些能力的默认值在它下面，
               且默认值只在对应能力开着时才出现——不给自己制造「填了也会被裁掉」的组合。
               2026-11-04 撤掉分区说明行；2026-11-05 撤掉「模型身份 / 生成参数」两枚分区标题；
               同日再撤「高级设置」折叠：能力与它的默认值必须同屏，一收起就看不见因果。 -->
          <section class="med-sec">
            <div class="med-two">
              <label class="mk-field">
                <span class="mk-field__label">模型 ID</span>
                <input
                  v-model="form.id"
                  class="mk-field__input mono"
                  :class="{ 'med-id--locked': !isCreate }"
                  :disabled="!isCreate"
                  placeholder="例如 gpt-4o-mini"
                  autocomplete="off"
                  @input="error = ''"
                />
              </label>
              <label class="mk-field">
                <span class="mk-field__label">显示名称</span>
                <input v-model="form.label" class="mk-field__input" placeholder="默认跟随模型 ID" @input="onLabelInput" />
              </label>
            </div>
          </section>

          <!-- 能力：开关就是声明。默认值跟在开关下面同一屏，读完「它会不会想」再读「默认想多深」。
               挡位由运营手填（2026-11-05）：填的就是请求体里那个字段的取值，原样发给上游；
               平台不再固定五档——各家词表不一致，认哪些词只有运营知道。 -->
          <section class="med-sec">
            <div class="med-subrow">
              <h5 class="med-sub">能力</h5>
            </div>
            <div class="med-checks">
              <label class="mk-field mk-field--switch med-cap" :class="{ 'med-cap--on': form.supportsThinking }">
                <input v-model="form.supportsThinking" type="checkbox" />
                <span class="med-cap__text"><b>思考</b></span>
              </label>
              <label class="mk-field mk-field--switch med-cap" :class="{ 'med-cap--on': form.vision }">
                <input v-model="form.vision" type="checkbox" />
                <span class="med-cap__text"><b>视觉</b></span>
              </label>
            </div>
            <!-- 思考的默认值：挡位（它认哪些词）+ 两个默认项（没被 Skill 指定时用哪一档）。
                 开关一关整块收起——关掉思考后这两项本来就发不出去。 -->
            <div v-if="form.supportsThinking" class="med-reasoning">
              <div class="mk-field">
                <span class="mk-field__label">支持的推理挡位</span>
                <div class="med-efforts__list">
                  <span v-for="level in form.reasoningEfforts" :key="level" class="med-effort">
                    <span class="mono med-effort__token">{{ level }}</span>
                    <button
                      type="button"
                      class="med-effort__del"
                      :aria-label="`移除挡位 ${level}`"
                      @click="removeEffort(level)"
                    >✕</button>
                  </span>
                  <input
                    v-model="effortDraft"
                    class="med-effort__input mono"
                    placeholder="添加挡位，如 xhigh"
                    aria-label="添加推理强度挡位"
                    autocomplete="off"
                    @keydown.enter.prevent="addEffort"
                    @blur="addEffort"
                    @input="error = ''"
                  />
                </div>
              </div>
              <div class="med-two">
                <label class="mk-field">
                  <span class="mk-field__label">默认思考模式</span>
                  <MkSelect
                    v-model="form.defaultThinkingMode"
                    :options="THINKING_MODE_OPTIONS"
                    aria-label="默认思考模式"
                    block
                  />
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">默认推理挡位</span>
                  <!-- 选项只来自上面填的挡位：没填任何挡位 = 没有这一项可选。
                       不给未声明的档位，是因为发出去上游也不认。 -->
                  <MkSelect
                    v-model="form.defaultReasoningEffort"
                    :options="effortSelectOptions"
                    aria-label="默认推理挡位"
                    block
                    :disabled="!form.reasoningEfforts.length || form.defaultThinkingMode === 'disabled'"
                  />
                </label>
              </div>
            </div>
          </section>

          <section class="med-sec">
            <!-- 2026-11-11 用户「这种文案不要有」：撤掉整行参数释义；
                 单位并回字段名（三个 tokens 字段），并发留空即不限由占位符表达。 -->
            <div class="med-subrow">
              <h5 class="med-sub">调用限制</h5>
            </div>
            <div class="med-two">
              <label class="mk-field">
                <span class="mk-field__label">输出上限（tokens）</span>
                <input v-model.number="form.maxOutputTokens" class="mk-field__input mono" type="number" min="1" placeholder="默认" />
              </label>
              <label class="mk-field">
                <span class="mk-field__label">默认输出（tokens）</span>
                <input v-model.number="form.defaultMaxTokens" class="mk-field__input mono" type="number" min="1" placeholder="默认" />
              </label>
              <label class="mk-field">
                <span class="mk-field__label">推理预留（tokens）</span>
                <input v-model.number="form.reasoningReserveTokens" class="mk-field__input mono" type="number" min="1" placeholder="默认" />
              </label>
              <label class="mk-field">
                <span class="mk-field__label">并发上限</span>
                <input v-model.number="form.maxParallelRequests" class="mk-field__input mono" type="number" min="1" placeholder="不限" />
              </label>
            </div>
          </section>

          <!-- 价格不是接入模型的关键路径（2026-10-28 用户「单价不是很重要的东西，
               可以在二级页面编辑」）：只在成本分析需要时再填。 -->
          <section class="med-sec">
            <div class="med-subrow">
              <h5 class="med-sub">价格</h5>
              <!-- 单位与作用范围留一次；「选填」不写——三格各自再标一遍是同一提示四次上屏 -->
              <span class="med-sub__hint">USD / 1M tokens · 只影响成本分析</span>
            </div>
            <div class="med-price">
              <label class="mk-field">
                <span class="mk-field__label">输入</span>
                <input v-model.number="form.inputPer1M" class="mk-field__input mono" type="number" min="0" step="0.001" />
              </label>
              <label class="mk-field">
                <span class="mk-field__label">缓存命中</span>
                <input v-model.number="form.cachedInputPer1M" class="mk-field__input mono" type="number" min="0" step="0.001" />
              </label>
              <label class="mk-field">
                <span class="mk-field__label">输出</span>
                <input v-model.number="form.outputPer1M" class="mk-field__input mono" type="number" min="0" step="0.001" />
              </label>
            </div>
          </section>
        </div>

        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" :disabled="busy" @click="close">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="busy || !canSubmit" @click="submit">
            {{ busy ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { adminModelProvidersApi } from '@/api/adminApi'
import { errMsg } from './live'
import MkSelect from '@/components/mk/MkSelect.vue'
import { REASONING_EFFORT_PATTERN, effortOptions, normalizeEfforts } from './reasoningEfforts'
import { useEscape } from './useEscape'
import { useMaskClose, useOverlay } from './useOverlay'

export interface ModelLike {
  id: string
  label: string
  tier: 'chat' | 'reasoning'
  supportsThinking: boolean
  /** 这台模型声明的推理强度挡位（后端 ModelViewModel.reasoningEfforts）；空数组 = 不支持该字段。
   *  每项就是请求体里的取值——上游定义的词，平台不改写。 */
  reasoningEfforts: string[]
  vision: boolean
  /** 模型级生成默认（2026-10-24）；null/缺省 = 跟随平台默认 */
  defaultThinkingMode?: 'enabled' | 'disabled' | null
  defaultReasoningEffort?: string | null
  /** 输出格式（2026-11-04 从弹层下线）：注册表里可能还写着，这里只读不写——
   *  提交时不带这个键，未动过的旧值原样留着，等这个功能回来再给入口。 */
  defaultResponseFormat?: 'none' | 'json_object' | null
  maxOutputTokens: number | null
  defaultMaxTokens: number | null
  reasoningReserveTokens: number | null
  maxParallelRequests: number | null
  pricing: { inputPer1M?: number; cachedInputPer1M?: number; outputPer1M?: number } | null
  /** 注册表里可能写着运维备注，但**本弹层不再编辑它**（2026-11-05 用户「说明是干嘛的，不要了」）。
   *  只读透传：提交时不带这个键，未动过的旧值原样留在文件里。 */
  description?: string | null
}

const emit = defineEmits<{ saved: [{ modelId: string; warnings: string[] }]; closed: [] }>()

const open = ref(false)
const busy = ref(false)
const error = ref('')
const isCreate = ref(true)
const providerId = ref('')
/** 批量勾选后的第几个（拉取浮窗 → 逐个配置）；单条新增时为空，标题不显示进度 */
const stepInfo = ref<{ index: number; total: number } | null>(null)
const maskRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
/** 显示名称是否被手动改过：没改过时跟随模型 ID（拉取结果预填时两栏不再各写一遍） */
const labelTouched = ref(false)

const form = reactive({
  id: '',
  label: '',
  tier: 'chat' as 'chat' | 'reasoning',
  supportsThinking: false,
  vision: false,
  /** 这台模型认的挡位词（手填）：每项原样发上游 */
  reasoningEfforts: [] as string[],
  defaultThinkingMode: 'default' as 'default' | 'enabled' | 'disabled',
  defaultReasoningEffort: 'default' as string,
  maxOutputTokens: null as number | null,
  defaultMaxTokens: null as number | null,
  reasoningReserveTokens: null as number | null,
  maxParallelRequests: null as number | null,
  inputPer1M: null as number | null,
  cachedInputPer1M: null as number | null,
  outputPer1M: null as number | null
})

/* 默认思考模式的下拉档位（2026-11-05 这个字段从「生成参数」区搬到「思考」开关下面，
   并改名「默认思考模式」——它回答的是「没被 Skill 指定时用哪一档」）。
   2026-11-04 用户「输出格式这个功能先下掉」：输出格式档位随字段一并撤除，
   已存的值原样留在注册表里，这里不读也不写。
   2026-11-05 用户「思考强度为什么还强制开启？」：`enabled` 原写作「强制开启」，
   但它一点都不强制——优先级是 Skill 显式配置 > 模型默认 > 平台默认，
   某个 Skill 自己选了「关闭」时，模型这一档根本不参与，所以改回「开启」。
   首项从「跟随默认」改成「不指定」：它写的是「这一层不表态」，
   接手的可能是平台默认（平台也没表态时请求里就不带这个字段）。 */
/** 「这一层不表态」的那一项（三个下拉共用一句，同文件不重复抄第二遍——文案单源） */
const NOT_SPECIFIED_LABEL = '不指定（按平台默认）'
const THINKING_MODE_OPTIONS: Array<{ value: 'default' | 'enabled' | 'disabled'; label: string }> = [
  { value: 'default', label: NOT_SPECIFIED_LABEL },
  { value: 'enabled', label: '开启' },
  { value: 'disabled', label: '关闭' }
]
/**
 * 「默认推理挡位」的可选档位：只出上面「支持的推理挡位」里填过的那几个词。
 * 一条没填时下拉只剩一项并整项禁用——没有挡位可选就是没有这一项。
 */
const effortSelectOptions = computed(() => effortOptions(
  form.reasoningEfforts,
  // 一条都没填时那唯一一项要自己说明原因：否则「不指定」读起来像还有别的档位没展开
  form.reasoningEfforts.length ? NOT_SPECIFIED_LABEL : '这台模型没有声明挡位'
))
/** 档位输入草稿（回车或失焦即添加；形态不对就地报错，不写进列表） */
const effortDraft = ref('')

function addEffort(): void {
  // 小写与后端落盘口径一致（上游这几个词都是小写），免得界面上写的与发出去的不是一个值
  const token = effortDraft.value.trim().toLowerCase()
  if (!token) return
  if (!REASONING_EFFORT_PATTERN.test(token)) {
    error.value = '挡位填的是要发给上游的那个词，只能是不带空格的短词。'
    return
  }
  if (!form.reasoningEfforts.includes(token)) form.reasoningEfforts.push(token)
  effortDraft.value = ''
  error.value = ''
}

function removeEffort(level: string): void {
  form.reasoningEfforts = form.reasoningEfforts.filter((x) => x !== level)
}

/* 默认挡位必须留在列表里：删掉正在被当作默认的那一档，默认值不能悬空。
   列表是原地 push / filter 的，所以要 deep watch（浅 watch 拿不到同一引用内的变化）。 */
watch(
  () => form.reasoningEfforts,
  (levels) => {
    if (form.defaultReasoningEffort === 'default') return
    if (!levels.includes(form.defaultReasoningEffort)) form.defaultReasoningEffort = 'default'
  },
  { deep: true }
)
/* 默认思考模式选「关闭」时，默认挡位没有意义：跟着回「不指定」，
   免得界面上留着一个「关了思考却指定了强度」的组合（与 Skill 运行时页同一条规则）。 */
watch(
  () => form.defaultThinkingMode,
  (mode) => {
    if (mode === 'disabled') form.defaultReasoningEffort = 'default'
  }
)

/** 用户一旦手改显示名称，就停止跟随模型 ID */
function onLabelInput(): void {
  labelTouched.value = true
  error.value = ''
}
watch(
  () => form.id,
  (nextId, prevId) => {
    if (!isCreate.value || labelTouched.value) return
    if (!form.label || form.label === prevId) form.label = nextId
  },
  { flush: 'sync' }
)

const MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const canSubmit = computed(() => (isCreate.value ? MODEL_ID_PATTERN.test(form.id.trim()) : true))
/** 标题：批量队列显示 2/5，让用户知道还有几个要配；编辑态不带队列进度 */
const title = computed(() => {
  if (!isCreate.value) return `模型设置 · ${form.id}`
  return stepInfo.value ? `添加模型 · ${stepInfo.value.index}/${stepInfo.value.total}` : '添加模型'
})
function openWith(target: { providerId: string; model: ModelLike | null; presetId?: string; step?: { index: number; total: number } }): void {
  isCreate.value = !target.model
  providerId.value = target.providerId
  stepInfo.value = target.model ? null : (target.step ?? null)
  error.value = ''
  const m = target.model
  const preset = target.presetId ?? ''
  form.id = m?.id ?? preset
  form.label = m?.label ?? preset
  form.tier = m?.tier ?? 'chat'
  form.supportsThinking = m?.supportsThinking ?? false
  form.vision = m?.vision ?? false
  form.reasoningEfforts = normalizeEfforts(m?.reasoningEfforts)
  form.defaultThinkingMode = m?.defaultThinkingMode ?? 'default'
  form.defaultReasoningEffort = m?.defaultReasoningEffort ?? 'default'
  form.maxOutputTokens = m?.maxOutputTokens ?? null
  form.defaultMaxTokens = m?.defaultMaxTokens ?? null
  form.reasoningReserveTokens = m?.reasoningReserveTokens ?? null
  form.maxParallelRequests = m?.maxParallelRequests ?? null
  form.inputPer1M = m?.pricing?.inputPer1M ?? null
  form.cachedInputPer1M = m?.pricing?.cachedInputPer1M ?? null
  form.outputPer1M = m?.pricing?.outputPer1M ?? null
  labelTouched.value = false
  open.value = true
  focusFirstEditable()
}

/** 自动聚焦第一个可编辑字段（2026-11-11 可用性）：
    useOverlay 会聚焦面板内第一个 input，但编辑态的「模型 ID」是 disabled——focus 无效。
    这里跳过禁用控件，落到「显示名称」等真正可编辑项。 */
function focusFirstEditable(): void {
  void nextTick(() => {
    const el = panelRef.value
    if (!el) return
    const first = el.querySelector<HTMLElement>(
      'input:not([disabled]), textarea:not([disabled]), select:not([disabled])'
    )
    first?.focus()
  })
}

function close(): void {
  if (busy.value) return
  open.value = false
  emit('closed')
}

useEscape(() => open.value, close)
useOverlay(open, panelRef)
useMaskClose(maskRef, close)

/** 空字符串/NaN 一律当「没填」：清空输入框要能表达「删除这个限额」，而不是塞 0（会被后端拒） */
function numOrNull(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Enter 提交（2026-11-11 可用性）：输入框回车即保存；按钮 / 下拉保持原生行为。
    模型设置里没有 textarea，但保留排除以防后续加说明字段。 */
function onEnterSubmit(e: KeyboardEvent): void {
  if (e.isComposing) return
  /* 字段自己的 Enter 处理器（如「添加挡位」的 @keydown.enter.prevent）已消费这次回车：
     不再冒泡成整表单提交，否则会清掉它刚给出的校验错误。 */
  if (e.defaultPrevented) return
  const el = e.target as HTMLElement | null
  if (!el || el.closest('button, textarea, select, [role="combobox"], [role="listbox"], .mk-select')) return
  if (busy.value || !canSubmit.value) return
  e.preventDefault()
  void submit()
}

async function submit(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const pricing = {
      ...(numOrNull(form.inputPer1M) !== null ? { inputPer1M: numOrNull(form.inputPer1M)! } : {}),
      ...(numOrNull(form.cachedInputPer1M) !== null ? { cachedInputPer1M: numOrNull(form.cachedInputPer1M)! } : {}),
      ...(numOrNull(form.outputPer1M) !== null ? { outputPer1M: numOrNull(form.outputPer1M)! } : {})
    }
    const payload = {
      label: form.label.trim(),
      tier: form.tier,
      supportsThinking: form.supportsThinking,
      vision: form.vision,
      /* 能力与默认值同进同退（2026-11-05）：没开思考时把挡位与两个默认项一并交空，
         免得存进一份「声明了挡位却不会思考」的配置——后端会拒，运行时也会被裁掉。
         开关关掉只影响这一程的提交，表单里的值不抹：再打开思考，填过的挡位还在。 */
      reasoningEfforts: form.supportsThinking ? form.reasoningEfforts : [],
      // 'default' → null：后端删掉模型字段，运行时跟随平台默认
      defaultThinkingMode: form.supportsThinking && form.defaultThinkingMode !== 'default' ? form.defaultThinkingMode : null,
      defaultReasoningEffort: form.supportsThinking && form.defaultThinkingMode !== 'disabled' && form.defaultReasoningEffort !== 'default'
        ? form.defaultReasoningEffort
        : null,
      maxOutputTokens: numOrNull(form.maxOutputTokens),
      defaultMaxTokens: numOrNull(form.defaultMaxTokens),
      reasoningReserveTokens: numOrNull(form.reasoningReserveTokens),
      maxParallelRequests: numOrNull(form.maxParallelRequests),
      pricing
    }
    const res = isCreate.value
      ? await adminModelProvidersApi.addModel(providerId.value, { ...payload, id: form.id.trim() })
      : await adminModelProvidersApi.updateModel(providerId.value, form.id, payload)
    const data = res?.data ?? {}
    emit('saved', { modelId: form.id.trim(), warnings: Array.isArray(data.warnings) ? data.warnings : [] })
    open.value = false
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

defineExpose({ openWith, close })
</script>

<style scoped>
/* 单列 + 折叠高级项：首屏两行字段，其余默认收起。
   分区标题已于 2026-11-05 撤除（用户「这个不要」），组与组之间靠 18px 间距分组。 */
.med-modal.mk-modal__panel--wide { width: min(720px, 96vw); max-width: none; }
.med-sec { min-width: 0; }
.med-sec + .med-sec { margin-top: 18px; }
/* 已创建的模型 ID 是只读值，不是待填占位符（2026-11-02 评审：disabled 的弱化字色
   与「显示名称」白字并排，看起来像没填）。只读态回到正文色 + 次级底，读作「这里是值」 */
.mk-field__input.med-id--locked {
  color: var(--mk-ink);
  -webkit-text-fill-color: currentColor;
  background: var(--mk-surface-2);
  opacity: 1;
}
.med-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.med-price { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.med-subrow { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; margin-bottom: 8px; }
.med-sub {
  margin: 0;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.med-sub__hint { color: var(--mk-faint); font-size: var(--mk-fs-micro); }

/* 能力：两枚紧凑勾选标签（思考 / 视觉），名称与模型表的功能列一致 */
.med-checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.med-cap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 7px 10px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface);
  cursor: pointer;
}
.med-cap input[type='checkbox'] { margin: 0; flex: none; }
.med-cap__text { display: flex; align-items: center; min-width: 0; }
.med-cap__text b { color: var(--mk-ink); font-size: var(--mk-fs-micro); font-weight: 600; }
.med-cap--on {
  border-color: var(--mk-blue);
  background: color-mix(in srgb, var(--mk-blue) 6%, var(--mk-surface));
}

/* 思考的默认值（挡位 + 两个默认项）：整块淡底，表示它只在「思考」开着时存在——
   关掉思考这一块直接不渲染，不留下一组会被后端裁掉的死值。 */
.med-reasoning {
  display: grid;
  gap: 12px;
  margin-top: 10px;
  padding: 12px;
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface-2);
}
/* 推理强度挡位：一排「词 + 删除」，末尾一个输入框（填的就是请求里发的那个值） */
.med-efforts__list { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.med-effort {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 3px 2px 8px;
  border: 1px solid var(--mk-blue);
  border-radius: var(--mk-radius-sm);
  background: color-mix(in srgb, var(--mk-blue) 6%, var(--mk-surface));
  color: var(--mk-ink);
  font-size: var(--mk-fs-micro);
}
.med-effort__token { font-weight: 600; }
/* 删除钮：小一号的 ×，不占额外横向空间（每枚挡位右侧各一个） */
.med-effort__del {
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--mk-radius-xs);
  background: transparent;
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
  line-height: 1;
  cursor: pointer;
}
.med-effort__del:hover:not(:disabled) { background: var(--mk-hover-surface); color: var(--mk-ink); }
.med-effort__input {
  flex: 1 1 150px;
  min-width: 120px;
  padding: 3px 6px;
  border: 1px dashed var(--mk-line);
  border-radius: var(--mk-radius-sm);
  background: transparent;
  color: var(--mk-ink);
  font: inherit;
  font-size: var(--mk-fs-micro);
}
.med-effort__input:focus { border-style: solid; border-color: var(--mk-blue); outline: none; }
.med-effort__input:disabled { cursor: not-allowed; opacity: 0.5; }

@media (max-width: 900px) {
  .med-modal.mk-modal__panel--wide { width: min(100%, 96vw); }
  .med-two, .med-price, .med-checks { grid-template-columns: minmax(0, 1fr); }
}
</style>
