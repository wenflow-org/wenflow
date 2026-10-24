<template>
  <!-- 模型编辑（新增 / 修改，2026-10-18 BYOK 重做）。
       字段与后端解析器的校验一一对应：档位、思考/推理强度（强度依赖思考）、四类限额（正数）、
       备用链（必须是真实存在的模型）、单价。前端先拦一遍，后端再拦一次并回吐人话原因。
       「模型 ID」只在新增时可填：它是路由与被引用配置的键，改名等于换模型（后端也会拒）。 -->
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

          <!-- 身份与价格分开（2026-10-24 用户「添加模型表格再优化一下」）：
               原「基本信息」把 ID/名称和三档价格挤在一段里，价格没有单位与口径；
               现在身份一行、价格一行，价格注明 USD / 1M tokens 与影响范围。 -->
          <section class="med-sec">
            <div class="med-sec__head">
              <h4 class="med-sec__title">模型身份</h4>
              <span class="med-sec__hint">模型 ID 是路由与配置引用的键，创建后不可修改</span>
            </div>
            <div class="med-two">
              <label class="mk-field">
                <span class="mk-field__label">模型 ID</span>
                <input
                  v-model="form.id"
                  class="mk-field__input mono"
                  :disabled="!isCreate"
                  placeholder="deepseek-v4.1-flash"
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

          <section class="med-sec">
            <div class="med-sec__head">
              <h4 class="med-sec__title">价格</h4>
              <span class="med-sec__hint">USD / 1M tokens，选填，只影响成本分析</span>
            </div>
            <div class="med-price">
              <label class="mk-field">
                <span class="mk-field__label">输入</span>
                <input v-model.number="form.inputPer1M" class="mk-field__input mono" type="number" min="0" step="0.001" placeholder="0.00" />
              </label>
              <label class="mk-field">
                <span class="mk-field__label">缓存命中</span>
                <input v-model.number="form.cachedInputPer1M" class="mk-field__input mono" type="number" min="0" step="0.001" placeholder="选填" />
              </label>
              <label class="mk-field">
                <span class="mk-field__label">输出</span>
                <input v-model.number="form.outputPer1M" class="mk-field__input mono" type="number" min="0" step="0.001" placeholder="0.00" />
              </label>
            </div>
          </section>

          <details class="med-advanced">
            <summary>
              高级设置
              <span class="med-advanced__hint">用途、能力、调用限制、备用模型</span>
            </summary>
            <div class="med-adv-body">
              <div class="med-two">
                <label class="mk-field">
                  <span class="mk-field__label">用途</span>
                  <select v-model="form.tier" class="mk-field__select">
                    <option value="chat">对话</option>
                    <option value="reasoning">推理</option>
                  </select>
                  <span class="med-field-hint">推理档用于长思考与复杂判断</span>
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">说明</span>
                  <input v-model="form.description" class="mk-field__input" placeholder="选填" />
                </label>
              </div>

              <div>
                <div class="med-subrow">
                  <h5 class="med-sub">能力</h5>
                  <span class="med-sub__hint">只勾模型实际支持的能力</span>
                </div>
                <div class="med-checks">
                  <label class="mk-field mk-field--switch med-cap" :class="{ 'med-cap--on': form.supportsThinking }">
                    <input v-model="form.supportsThinking" type="checkbox" />
                    <span class="med-cap__text">
                      <b>思考模式</b>
                      <span>先思考再回答</span>
                    </span>
                  </label>
                  <label class="mk-field mk-field--switch med-cap" :class="{ 'med-cap--on': form.supportsReasoningEffort }">
                    <input v-model="form.supportsReasoningEffort" type="checkbox" />
                    <span class="med-cap__text">
                      <b>推理强度</b>
                      <span>可调节思考深度</span>
                    </span>
                  </label>
                  <label class="mk-field mk-field--switch med-cap" :class="{ 'med-cap--on': form.vision }">
                    <input v-model="form.vision" type="checkbox" />
                    <span class="med-cap__text">
                      <b>图片输入</b>
                      <span>可读图与截图</span>
                    </span>
                  </label>
                </div>
              </div>

              <div>
                <div class="med-subrow">
                  <h5 class="med-sub">调用限制</h5>
                  <span class="med-sub__hint">留空 = 平台默认，并发留空 = 不限</span>
                </div>
                <div class="med-two">
                  <label class="mk-field">
                    <span class="mk-field__label">输出上限</span>
                    <input v-model.number="form.maxOutputTokens" class="mk-field__input mono" type="number" min="1" placeholder="131072" />
                  </label>
                  <label class="mk-field">
                    <span class="mk-field__label">默认输出</span>
                    <input v-model.number="form.defaultMaxTokens" class="mk-field__input mono" type="number" min="1" placeholder="32768" />
                  </label>
                  <label class="mk-field">
                    <span class="mk-field__label">推理预留</span>
                    <input v-model.number="form.reasoningReserveTokens" class="mk-field__input mono" type="number" min="1" placeholder="8192" />
                  </label>
                  <label class="mk-field">
                    <span class="mk-field__label">并发上限</span>
                    <input v-model.number="form.maxParallelRequests" class="mk-field__input mono" type="number" min="1" placeholder="不限" />
                  </label>
                </div>
              </div>

              <div>
                <div class="med-subrow">
                  <h5 class="med-sub">备用模型</h5>
                  <span class="med-sub__hint">主模型失败后按顺序尝试</span>
                </div>
                <!-- 原生的多选 listbox 一屏铺开全部候选、也看不出尝试顺序；
                     改成「已选编号 → 搜索 → 勾选」三段，顺序即勾选顺序。 -->
                <div class="med-fb">
                  <div v-if="pickedFallbacks.length" class="med-fb__picked">
                    <span v-for="(opt, i) in pickedFallbacks" :key="opt" class="med-fb__chip">
                      <b class="med-fb__order">{{ i + 1 }}</b>
                      <span class="mono med-fb__name" :title="opt">{{ opt }}</span>
                      <button type="button" class="med-fb__remove" :aria-label="`移除 ${opt}`" @click="removeFallback(opt)">✕</button>
                    </span>
                  </div>
                  <p v-else class="med-fb__empty">未选备用模型：沿用平台默认的备用模型列表</p>
                  <input
                    v-model="fallbackQuery"
                    class="mk-field__input med-fb__filter"
                    placeholder="搜索模型"
                    aria-label="搜索备用模型"
                    autocomplete="off"
                  />
                  <div class="med-fb__list">
                    <label
                      v-for="opt in filteredFallbacks"
                      :key="opt"
                      class="med-fb__row"
                      :class="{ 'med-fb__row--on': pickedFallbacks.includes(opt) }"
                    >
                      <input type="checkbox" :checked="pickedFallbacks.includes(opt)" @change="toggleFallback(opt)" />
                      <span class="mono med-fb__id" :title="opt">{{ opt }}</span>
                    </label>
                    <p v-if="!filteredFallbacks.length" class="med-fb__empty">
                      {{ availableFallbacks.length ? '没有匹配的模型' : '当前没有其他可选模型' }}
                    </p>
                  </div>
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
import { useEscape } from './useEscape'
import { useMaskClose, useOverlay } from './useOverlay'

export interface ModelLike {
  id: string
  label: string
  tier: 'chat' | 'reasoning'
  supportsThinking: boolean
  supportsReasoningEffort: boolean
  vision: boolean
  maxOutputTokens: number | null
  defaultMaxTokens: number | null
  reasoningReserveTokens: number | null
  maxParallelRequests: number | null
  fallbacks: string[]
  pricing: { inputPer1M?: number; cachedInputPer1M?: number; outputPer1M?: number } | null
  description: string | null
}

const props = defineProps<{ fallbackOptions: string[] }>()
const emit = defineEmits<{ saved: [{ modelId: string; warnings: string[] }] }>()

const open = ref(false)
const busy = ref(false)
const error = ref('')
const isCreate = ref(true)
const providerId = ref('')
/** 批量勾选后的第几个（拉取浮窗 → 逐个配置）；单条新增时为空，标题不显示进度 */
const stepInfo = ref<{ index: number; total: number } | null>(null)
const maskRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const pickedFallbacks = ref<string[]>([])
const fallbackQuery = ref('')
/** 显示名称是否被手动改过：没改过时跟随模型 ID（拉取结果预填时两栏不再各写一遍） */
const labelTouched = ref(false)

const form = reactive({
  id: '',
  label: '',
  tier: 'chat' as 'chat' | 'reasoning',
  supportsThinking: false,
  vision: false,
  supportsReasoningEffort: false,
  maxOutputTokens: null as number | null,
  defaultMaxTokens: null as number | null,
  reasoningReserveTokens: null as number | null,
  maxParallelRequests: null as number | null,
  description: '',
  inputPer1M: null as number | null,
  cachedInputPer1M: null as number | null,
  outputPer1M: null as number | null
})

/** 备用链候选：排除自己（主模型出错后不可能再回落给自己） */
const availableFallbacks = computed(() => {
  const self = `${providerId.value}/${form.id.trim()}`
  return props.fallbackOptions.filter((opt) => opt !== self)
})
/** 备用链搜索：候选多时靠筛选找，不再用原生 listbox 一屏铺开 */
const filteredFallbacks = computed(() => {
  const q = fallbackQuery.value.trim().toLowerCase()
  return q ? availableFallbacks.value.filter((opt) => opt.toLowerCase().includes(q)) : availableFallbacks.value
})

/** 叠加/移除备用模型：数组顺序就是尝试顺序 */
function toggleFallback(opt: string): void {
  pickedFallbacks.value = pickedFallbacks.value.includes(opt)
    ? pickedFallbacks.value.filter((x) => x !== opt)
    : [...pickedFallbacks.value, opt]
}
function removeFallback(opt: string): void {
  pickedFallbacks.value = pickedFallbacks.value.filter((x) => x !== opt)
}
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
  form.maxOutputTokens = m?.maxOutputTokens ?? null
  form.defaultMaxTokens = m?.defaultMaxTokens ?? null
  form.reasoningReserveTokens = m?.reasoningReserveTokens ?? null
  form.maxParallelRequests = m?.maxParallelRequests ?? null
  form.description = m?.description ?? ''
  form.inputPer1M = m?.pricing?.inputPer1M ?? null
  form.cachedInputPer1M = m?.pricing?.cachedInputPer1M ?? null
  form.outputPer1M = m?.pricing?.outputPer1M ?? null
  pickedFallbacks.value = [...(m?.fallbacks ?? [])]
  fallbackQuery.value = ''
  labelTouched.value = false
  open.value = true
}

function close(): void {
  if (busy.value) return
  open.value = false
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
      maxOutputTokens: numOrNull(form.maxOutputTokens),
      defaultMaxTokens: numOrNull(form.defaultMaxTokens),
      reasoningReserveTokens: numOrNull(form.reasoningReserveTokens),
      maxParallelRequests: numOrNull(form.maxParallelRequests),
      fallbacks: pickedFallbacks.value,
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

defineExpose({ openWith })
</script>

<style scoped>
/* 单列 + 折叠高级项：首屏只放模型身份与价格，高级项默认收起 */
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
.med-sec__hint { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.med-field-hint { color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.med-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.med-price { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
/* 高级设置：默认收起，展开后按「用途 / 能力 / 调用限制 / 备用模型」四段排 */
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
.med-advanced__hint { color: var(--mk-muted); font-size: var(--mk-fs-micro); font-weight: 400; }
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

/* 能力：三张可勾选卡片，勾中后整卡描蓝——比三个裸复选框更容易看清选了什么 */
.med-checks { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.med-cap {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 9px 10px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface);
  cursor: pointer;
}
.med-cap input[type='checkbox'] { margin: 2px 0 0; flex: none; }
.med-cap__text { display: grid; gap: 1px; min-width: 0; }
.med-cap__text b { color: var(--mk-ink); font-size: var(--mk-fs-micro); font-weight: 600; }
.med-cap__text span { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.med-cap--on {
  border-color: var(--mk-blue);
  background: color-mix(in srgb, var(--mk-blue) 6%, var(--mk-surface));
}

/* 备用模型：已选区（带尝试顺序）+ 搜索 + 候选勾选，替代原生多选 listbox */
.med-fb {
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface);
  overflow: hidden;
}
.med-fb__picked { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 10px 0; }
.med-fb__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 3px 6px;
  border-radius: 999px;
  background: var(--mk-surface-3);
}
.med-fb__order {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--mk-blue);
  color: var(--mk-graph-on-accent);
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  flex: none;
}
.med-fb__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--mk-fs-micro);
}
.med-fb__remove {
  border: 0;
  background: none;
  padding: 0 2px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  cursor: pointer;
}
.med-fb__remove:hover { color: var(--mk-red); }
.med-fb__empty {
  margin: 0;
  padding: 10px 10px 0;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.med-fb__filter { width: calc(100% - 20px); margin: 10px; }
.med-fb__list { max-height: 156px; overflow-y: auto; border-top: 1px solid var(--mk-line); }
.med-fb__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--mk-line);
  font-size: var(--mk-fs-micro);
  cursor: pointer;
}
.med-fb__row:last-child { border-bottom: 0; }
.med-fb__row:hover { background: var(--mk-table-row-hover-bg); }
.med-fb__row--on { background: color-mix(in srgb, var(--mk-blue) 5%, transparent); }
.med-fb__id { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 900px) {
  .med-modal.mk-modal__panel--wide { width: min(100%, 96vw); }
  .med-two, .med-price, .med-checks { grid-template-columns: minmax(0, 1fr); }
}
</style>
