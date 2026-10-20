<template>
  <!-- 模型编辑（新增 / 修改，2026-10-18 BYOK 重做）。
       字段与后端解析器的校验一一对应：档位、思考/推理强度（强度依赖思考）、四类限额（正数）、
       备用链（必须是真实存在的模型）、单价。前端先拦一遍，后端再拦一次并回吐人话原因。
       「模型 ID」只在新增时可填：它是路由与被引用配置的键，改名等于换模型（后端也会拒）。 -->
  <Teleport v-if="open" to="body">
    <div class="mk-modal">
      <div class="mk-modal__panel mk-modal__panel--wide med-modal" role="dialog" aria-label="模型设置">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">{{ isCreate ? '添加模型' : `模型设置 · ${form.id}` }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="close">✕</button>
        </div>

        <div class="mk-modal__body">
          <div v-if="error" class="mk-alert mk-alert--row" role="alert">
            <span class="mk-alert__msg">{{ error }}</span>
          </div>

          <!-- 基本信息（2026-10-21 用户走查「动作很简单：配置端点与 key、拉取模型、一个模型一个模型
               添加，配置基础信息，允许单一模型测试」）：首屏只留模型身份与价格；用途、能力、
               调用限制与备用链是高级项，默认收起。 -->
          <section class="med-sec">
            <h4 class="med-sec__title">基本信息</h4>
            <div class="med-two">
              <label class="mk-field">
                <span class="mk-field__label">模型 ID</span>
                <input
                  v-model="form.id"
                  class="mk-field__input mono"
                  :disabled="!isCreate"
                  placeholder="deepseek-v4-flash"
                  autocomplete="off"
                  @input="error = ''"
                />
              </label>
              <label class="mk-field">
                <span class="mk-field__label">显示名称</span>
                <input v-model="form.label" class="mk-field__input" placeholder="选填" @input="error = ''" />
              </label>
            </div>
            <div class="med-price">
              <label class="mk-field">
                <span class="mk-field__label">输入单价</span>
                <input v-model.number="form.inputPer1M" class="mk-field__input mono" type="number" min="0" step="0.001" placeholder="USD / 1M" />
              </label>
              <label class="mk-field">
                <span class="mk-field__label">缓存命中</span>
                <input v-model.number="form.cachedInputPer1M" class="mk-field__input mono" type="number" min="0" step="0.001" placeholder="选填" />
              </label>
              <label class="mk-field">
                <span class="mk-field__label">输出单价</span>
                <input v-model.number="form.outputPer1M" class="mk-field__input mono" type="number" min="0" step="0.001" placeholder="USD / 1M" />
              </label>
            </div>
          </section>

          <details class="med-advanced">
            <summary class="med-advanced__summary">高级设置</summary>
            <div class="med-adv-body">
              <div class="med-two">
                <label class="mk-field">
                  <span class="mk-field__label">用途</span>
                  <select v-model="form.tier" class="mk-field__select">
                    <option value="chat">对话</option>
                    <option value="reasoning">推理</option>
                  </select>
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">说明</span>
                  <input v-model="form.description" class="mk-field__input" placeholder="选填" />
                </label>
              </div>

              <div class="med-checks">
                <label class="mk-field mk-field--switch">
                  <input v-model="form.supportsThinking" type="checkbox" />
                  <span>支持思考模式</span>
                </label>
                <label class="mk-field mk-field--switch">
                  <input v-model="form.supportsReasoningEffort" type="checkbox" />
                  <span>支持推理强度</span>
                </label>
              </div>

              <h5 class="med-sub">调用限制</h5>
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

              <h5 class="med-sub">备用模型</h5>
              <label class="mk-field">
                <span class="mk-field__label">主模型出错后依次尝试</span>
                <select v-model="pickedFallbacks" class="mk-field__select mono med-fallbacks" multiple size="5">
                  <option v-for="opt in availableFallbacks" :key="opt" :value="opt">{{ opt }}</option>
                </select>
              </label>
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
import { computed, reactive, ref } from 'vue'
import { adminModelProvidersApi } from '@/api/adminApi'
import { errMsg } from './live'

export interface ModelLike {
  id: string
  label: string
  tier: 'chat' | 'reasoning'
  supportsThinking: boolean
  supportsReasoningEffort: boolean
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
const pickedFallbacks = ref<string[]>([])

const form = reactive({
  id: '',
  label: '',
  tier: 'chat' as 'chat' | 'reasoning',
  supportsThinking: false,
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

const MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const canSubmit = computed(() => (isCreate.value ? MODEL_ID_PATTERN.test(form.id.trim()) : true))
/**
 * 勾了强度没勾思考：就地拦在保存这一步，并给出原因。
 * 不改成「取消思考时自动把强度也清掉」——那样会替用户改一个他没碰过的字段，而 Vue 对
 * checkbox 的 v-model 在「DOM 值 ≠ 新模型值」时会跳过同步（它假定那是用户的点击，见
 * vModelCheckbox.beforeUpdate），界面上那个勾会留着不消失：状态与显示对不上，比报错更糟。
 */
const effortWithoutThinking = computed(() => form.supportsReasoningEffort && !form.supportsThinking)

function openWith(target: { providerId: string; model: ModelLike | null; presetId?: string }): void {
  isCreate.value = !target.model
  providerId.value = target.providerId
  error.value = ''
  const m = target.model
  const preset = target.presetId ?? ''
  form.id = m?.id ?? preset
  form.label = m?.label ?? preset
  form.tier = m?.tier ?? 'chat'
  form.supportsThinking = m?.supportsThinking ?? false
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
  open.value = true
}

function close(): void {
  if (busy.value) return
  open.value = false
}

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
/* 单列 + 折叠高级项：首屏只放模型身份与价格，不再为两栏把弹窗撑到 880px */
.med-modal.mk-modal__panel--wide { width: min(720px, 96vw); max-width: none; }
.med-sec { min-width: 0; }
.med-sec__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 10px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.med-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.med-price { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
.med-fallbacks { height: auto; min-height: 116px; font-size: var(--mk-fs-micro); }
/* 高级设置：默认收起，展开后仍按字段网格排；不占首屏 */
.med-advanced {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--mk-line);
}
.med-advanced > summary {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--mk-ink);
  font-size: var(--mk-fs-body);
  font-weight: 700;
  cursor: pointer;
  list-style: none;
}
.med-advanced > summary::-webkit-details-marker { display: none; }
.med-advanced > summary::before { content: '▸'; color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.med-advanced[open] > summary::before { content: '▾'; }
.med-adv-body { display: grid; gap: 14px; margin-top: 14px; }
.med-checks { display: flex; flex-wrap: wrap; gap: 10px 20px; }
.med-sub { margin: 2px 0 0; color: var(--mk-muted); font-size: var(--mk-fs-micro); font-weight: 700; letter-spacing: 0.04em; }
.med-advanced .mk-field { align-content: start; }
@media (max-width: 900px) {
  .med-modal.mk-modal__panel--wide { width: min(100%, 96vw); }
  .med-two, .med-price { grid-template-columns: minmax(0, 1fr); }
}
</style>
