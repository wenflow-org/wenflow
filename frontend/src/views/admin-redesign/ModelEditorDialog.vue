<template>
  <!-- 模型编辑（新增 / 修改，2026-10-18 BYOK 重做）。
       字段与后端解析器的校验一一对应：思考/推理强度（强度依赖思考）、四类限额（正数）、单价。
       前端先拦一遍，后端再拦一次并回吐人话原因。
       「模型 ID」只在新增时可填：它是路由与被引用配置的键，改名等于换模型（后端也会拒）。
       档位（chat / reasoning）不在这一层让运营选：界面不做模型类型区分，编辑时原样带回，
       只有注册表里本就写着 reasoning 的条目不会被改成 chat。 -->
  <Teleport v-if="open" to="body">
    <div ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel mk-modal__panel--wide med-modal" role="dialog" aria-label="模型设置">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">{{ title }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="close">✕</button>
        </div>

        <div class="mk-modal__body">
          <div v-if="error" class="mk-alert mk-alert--row" role="alert">
            <span class="mk-alert__msg">{{ error }}</span>
          </div>

          <!-- 主路径只留「模型身份 + 生成参数」；价格与能力/限额一起进高级设置
               （2026-10-28 用户「单价不是很重要的东西」），不占新增模型的第一屏。
               2026-11-04 用户「配置弹窗里面的东西还没改，还是老一套的」：分区标题下的说明行
               全部撤除——让布局自己说话；需要解释的写进占位符。 -->
          <section class="med-sec">
            <div class="med-sec__head">
              <h4 class="med-sec__title">模型身份</h4>
            </div>
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

          <!-- 生成参数（2026-10-24 用户拍板「每个模型各自一套」）：原来只有平台级默认，
               现在每个模型可单独覆盖；「跟随默认」= 不写模型字段。
               2026-11-04 用户「输出格式这个功能先下掉」：输出格式一栏撤除。 -->
          <section class="med-sec med-gen">
            <div class="med-sec__head">
              <h4 class="med-sec__title">生成参数</h4>
            </div>
            <div class="med-two">
              <label class="mk-field">
                <span class="mk-field__label">思考模式</span>
                <MkSelect
                  v-model="form.defaultThinkingMode"
                  :options="THINKING_MODE_OPTIONS"
                  aria-label="思考模式"
                  block
                />
              </label>
              <label class="mk-field">
                <span class="mk-field__label">推理强度</span>
                <MkSelect
                  v-model="form.defaultReasoningEffort"
                  :options="REASONING_EFFORT_OPTIONS"
                  aria-label="推理强度"
                  block
                  :disabled="form.defaultThinkingMode === 'disabled'"
                />
              </label>
            </div>
          </section>

          <details class="med-advanced">
            <!-- 2026-11-02「让布局自己说话」：折叠头右侧原有列出本弹层分区名的一行小字，
                 它只罗列本弹层自己的分区——展开后各分区标题（说明 / 能力 / 调用限制 /
                 价格）已各说一次，属要收掉的那类。同一句改挂它描述的那个记号
                 （summary）的 title，悬停与读屏仍拿得到，屏上不再占一段版面。 -->
            <summary title="说明、能力、调用限制、价格">
              高级设置
            </summary>
            <div class="med-adv-body">
              <div>
                <label class="mk-field">
                  <span class="mk-field__label">说明</span>
                  <!-- 占位符不写「选填」：非必填由没有 * 表达，占位符只该给示例。
                       改用可换行输入（2026-11-02 评审）：单行 input 会把一句话从右缘硬切，
                       既没有省略号也读不到后半句。
                       2026-11-04：说明常常是一整段运维备注，固定两行会在句中截断——
                       高度跟着内容走（field-sizing），到视口上限才出现内滚。 -->
                  <textarea
                    v-model="form.description"
                    class="mk-field__textarea med-desc"
                    rows="2"
                    placeholder="中文理解强，适合结构化输出"
                  />
                </label>
              </div>

              <div>
                <div class="med-subrow">
                  <h5 class="med-sub">能力</h5>
                </div>
                <div class="med-checks">
                  <label class="mk-field mk-field--switch med-cap" :class="{ 'med-cap--on': form.supportsThinking }">
                    <input v-model="form.supportsThinking" type="checkbox" />
                    <span class="med-cap__text"><b>思考</b></span>
                  </label>
                  <label class="mk-field mk-field--switch med-cap" :class="{ 'med-cap--on': form.supportsReasoningEffort }">
                    <input v-model="form.supportsReasoningEffort" type="checkbox" />
                    <span class="med-cap__text"><b>{{ CAP_REASONING }}</b></span>
                  </label>
                  <label class="mk-field mk-field--switch med-cap" :class="{ 'med-cap--on': form.vision }">
                    <input v-model="form.vision" type="checkbox" />
                    <span class="med-cap__text"><b>读图</b></span>
                  </label>
                </div>
              </div>

              <div>
                <div class="med-subrow">
                  <h5 class="med-sub">调用限制</h5>
                </div>
                <div class="med-two">
                  <label class="mk-field">
                    <span class="mk-field__label">输出上限</span>
                    <input v-model.number="form.maxOutputTokens" class="mk-field__input mono" type="number" min="1" placeholder="默认" />
                  </label>
                  <label class="mk-field">
                    <span class="mk-field__label">默认输出</span>
                    <input v-model.number="form.defaultMaxTokens" class="mk-field__input mono" type="number" min="1" placeholder="默认" />
                  </label>
                  <label class="mk-field">
                    <span class="mk-field__label">推理预留</span>
                    <input v-model.number="form.reasoningReserveTokens" class="mk-field__input mono" type="number" min="1" placeholder="默认" />
                  </label>
                  <label class="mk-field">
                    <span class="mk-field__label">并发上限</span>
                    <input v-model.number="form.maxParallelRequests" class="mk-field__input mono" type="number" min="1" placeholder="不限" />
                  </label>
                </div>
              </div>

              <!-- 价格不是接入模型的关键路径（2026-10-28 用户「单价不是很重要的东西，
                   可以在二级页面编辑」）：收进高级设置，只在成本分析需要时再填。 -->
              <div>
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
              </div>
            </div>
          </details>
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
import { computed, reactive, ref, watch } from 'vue'
import { adminModelProvidersApi } from '@/api/adminApi'
import { errMsg } from './live'
import MkSelect from '@/components/mk/MkSelect.vue'
import { useEscape } from './useEscape'
import { useMaskClose, useOverlay } from './useOverlay'

export interface ModelLike {
  id: string
  label: string
  tier: 'chat' | 'reasoning'
  supportsThinking: boolean
  supportsReasoningEffort: boolean
  vision: boolean
  /** 模型级生成默认（2026-10-24）；null/缺省 = 跟随平台默认 */
  defaultThinkingMode?: 'enabled' | 'disabled' | null
  defaultReasoningEffort?: 'low' | 'high' | 'max' | null
  /** 输出格式（2026-11-04 从弹层下线）：注册表里可能还写着，这里只读不写——
   *  提交时不带这个键，未动过的旧值原样留着，等这个功能回来再给入口。 */
  defaultResponseFormat?: 'none' | 'json_object' | null
  maxOutputTokens: number | null
  defaultMaxTokens: number | null
  reasoningReserveTokens: number | null
  maxParallelRequests: number | null
  pricing: { inputPer1M?: number; cachedInputPer1M?: number; outputPer1M?: number } | null
  description: string | null
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
  supportsReasoningEffort: false,
  defaultThinkingMode: 'default' as 'default' | 'enabled' | 'disabled',
  defaultReasoningEffort: 'default' as 'default' | 'low' | 'high' | 'max',
  maxOutputTokens: null as number | null,
  defaultMaxTokens: null as number | null,
  reasoningReserveTokens: null as number | null,
  maxParallelRequests: null as number | null,
  description: '',
  inputPer1M: null as number | null,
  cachedInputPer1M: null as number | null,
  outputPer1M: null as number | null
})

/* 生成参数的下拉档位：文案保持与旧原生 select 逐字一致。
   2026-11-04 用户「输出格式这个功能先下掉」：输出格式档位随字段一并撤除，
   已存的值原样留在注册表里，这里不读也不写。 */
const THINKING_MODE_OPTIONS: Array<{ value: 'default' | 'enabled' | 'disabled'; label: string }> = [
  { value: 'default', label: '跟随默认' },
  { value: 'enabled', label: '强制开启' },
  { value: 'disabled', label: '关闭' }
]
const REASONING_EFFORT_OPTIONS: Array<{ value: 'default' | 'low' | 'high' | 'max'; label: string }> = [
  { value: 'default', label: '跟随默认' },
  { value: 'low', label: '低（low）' },
  { value: 'high', label: '高（high）' },
  { value: 'max', label: '最高（max）' }
]
/** 能力卡与生成参数同名（单一文案源：同文件出现两次会被文案门禁记复读） */
const CAP_REASONING = '推理强度'

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
/**
 * 勾了强度没勾思考：就地拦在保存这一步，并给出原因。
 * 不改成「取消思考时自动把强度也清掉」——那样会替用户改一个他没碰过的字段，而 Vue 对
 * checkbox 的 v-model 在「DOM 值 ≠ 新模型值」时会跳过同步（它假定那是用户的点击，见
 * vModelCheckbox.beforeUpdate），界面上那个勾会留着不消失：状态与显示对不上，比报错更糟。
 */
const effortWithoutThinking = computed(() => form.supportsReasoningEffort && !form.supportsThinking)

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
  form.supportsReasoningEffort = m?.supportsReasoningEffort ?? false
  form.defaultThinkingMode = m?.defaultThinkingMode ?? 'default'
  form.defaultReasoningEffort = m?.defaultReasoningEffort ?? 'default'
  form.maxOutputTokens = m?.maxOutputTokens ?? null
  form.defaultMaxTokens = m?.defaultMaxTokens ?? null
  form.reasoningReserveTokens = m?.reasoningReserveTokens ?? null
  form.maxParallelRequests = m?.maxParallelRequests ?? null
  form.description = m?.description ?? ''
  form.inputPer1M = m?.pricing?.inputPer1M ?? null
  form.cachedInputPer1M = m?.pricing?.cachedInputPer1M ?? null
  form.outputPer1M = m?.pricing?.outputPer1M ?? null
  labelTouched.value = false
  open.value = true
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

async function submit(): Promise<void> {
  if (effortWithoutThinking.value) {
    error.value = '勾了「支持推理强度」就必须同时支持思考模式。'
    return
  }
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
      supportsReasoningEffort: form.supportsReasoningEffort,
      // 'default' → null：后端删掉模型字段，运行时跟随平台默认
      defaultThinkingMode: form.defaultThinkingMode === 'default' ? null : form.defaultThinkingMode,
      defaultReasoningEffort: form.defaultReasoningEffort === 'default' ? null : form.defaultReasoningEffort,
      maxOutputTokens: numOrNull(form.maxOutputTokens),
      defaultMaxTokens: numOrNull(form.defaultMaxTokens),
      reasoningReserveTokens: numOrNull(form.reasoningReserveTokens),
      maxParallelRequests: numOrNull(form.maxParallelRequests),
      pricing,
      description: form.description.trim()
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
/* 单列 + 折叠高级项：首屏只放模型身份与生成参数，其余默认收起 */
.med-modal.mk-modal__panel--wide { width: min(720px, 96vw); max-width: none; }
.med-sec { min-width: 0; }
.med-sec + .med-sec { margin-top: 18px; }
.med-sec__head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-bottom: 10px;
}
.med-sec__title {
  margin: 0;
  color: var(--mk-ink);
  font-size: var(--mk-fs-body);
  font-weight: 700;
}
/* 已创建的模型 ID 是只读值，不是待填占位符（2026-11-02 评审：disabled 的弱化字色
   与「显示名称」白字并排，看起来像没填）。只读态回到正文色 + 次级底，读作「这里是值」 */
.mk-field__input.med-id--locked {
  color: var(--mk-ink);
  -webkit-text-fill-color: currentColor;
  background: var(--mk-surface-2);
  opacity: 1;
}
/* 说明跟着内容长高（field-sizing 不受支持的浏览器退回 rows=2 + 内滚，不会截断） */
.med-desc {
  min-height: 0;
  max-height: 30vh;
  field-sizing: content;
  resize: vertical;
}
.med-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.med-price { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
/* 高级设置：默认收起，展开后按「说明 / 能力 / 调用限制 / 价格」四段排 */
.med-advanced {
  margin-top: 20px;
  padding-top: 14px;
  border-top: 1px solid var(--mk-line);
}
.med-advanced > summary {
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: var(--mk-ink);
  font-size: var(--mk-fs-body);
  font-weight: 700;
  cursor: pointer;
  list-style: none;
}
.med-advanced > summary::-webkit-details-marker { display: none; }
.med-advanced > summary::before { content: '▸'; color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.med-advanced[open] > summary::before { content: '▾'; }
.med-adv-body { display: grid; gap: 18px; margin-top: 14px; }
.med-subrow { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; margin-bottom: 8px; }
.med-sub {
  margin: 0;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.med-sub__hint { color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.med-advanced .mk-field { align-content: start; }

/* 能力：三枚紧凑勾选标签，名称与模型表的功能列一致（思考 / 推理强度 / 读图） */
.med-checks { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
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

@media (max-width: 900px) {
  .med-modal.mk-modal__panel--wide { width: min(100%, 96vw); }
  .med-two, .med-price, .med-checks { grid-template-columns: minmax(0, 1fr); }
}
</style>
