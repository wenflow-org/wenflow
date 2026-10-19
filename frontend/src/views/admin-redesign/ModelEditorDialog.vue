<template>
  <!-- 模型编辑（新增 / 修改，2026-10-18 BYOK 重做）。
       字段与后端解析器的校验一一对应：档位、思考/推理强度（强度依赖思考）、四类限额（正数）、
       备用链（必须是真实存在的模型）、单价。前端先拦一遍，后端再拦一次并回吐人话原因。
       「模型 ID」只在新增时可填：它是路由与被引用配置的键，改名等于换模型（后端也会拒）。 -->
  <Teleport v-if="open" to="body">
    <div class="mk-modal">
      <div class="mk-modal__panel mk-modal__panel--wide" role="dialog" aria-label="模型设置">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">{{ isCreate ? '添加模型' : `模型设置 · ${form.id}` }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="close">✕</button>
        </div>

        <div class="mk-modal__body">
          <div v-if="error" class="mk-alert mk-alert--row" role="alert">
            <span class="mk-alert__msg">{{ error }}</span>
          </div>

          <div class="med-cols">
            <div class="med-col">
              <div class="med-sec">标识</div>
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
                <span class="mk-field__hint">{{ isCreate ? '上游认这个名字，字母数字点下划线连字符' : '创建后不改（路由按这个名字找模型）' }}</span>
              </label>
              <label class="mk-field">
                <span class="mk-field__label">显示名称</span>
                <input v-model="form.label" class="mk-field__input" placeholder="选填，给运营看的名字" @input="error = ''" />
              </label>
              <label class="mk-field">
                <span class="mk-field__label">档位</span>
                <select v-model="form.tier" class="mk-field__select">
                  <option value="chat">对话（chat）</option>
                  <option value="reasoning">推理（reasoning）</option>
                </select>
                <span class="mk-field__hint">默认路由按档位挑模型，选错档位会让推理任务落到普通模型上</span>
              </label>
              <label class="mk-field">
                <span class="mk-field__label">说明</span>
                <input v-model="form.description" class="mk-field__input" placeholder="选填：这个模型适合干什么" />
              </label>
            </div>

            <div class="med-col">
              <div class="med-sec">能力</div>
              <label class="mk-field mk-field--switch">
                <input v-model="form.supportsThinking" type="checkbox" />
                <span>支持思考模式</span>
              </label>
              <label class="mk-field mk-field--switch">
                <input v-model="form.supportsReasoningEffort" type="checkbox" />
                <span>支持推理强度</span>
              </label>
              <span class="mk-field__hint">推理强度依赖思考模式：两项要一起勾，只勾强度会在保存时被拦下</span>
              <div class="med-sec">限额</div>
              <label class="mk-field">
                <span class="mk-field__label">输出上限</span>
                <input v-model.number="form.maxOutputTokens" class="mk-field__input mono" type="number" min="1" placeholder="131072" />
                <span class="mk-field__hint">上游硬限制。调用方要得再多也不会超过它</span>
              </label>
              <label class="mk-field">
                <span class="mk-field__label">默认输出</span>
                <input v-model.number="form.defaultMaxTokens" class="mk-field__input mono" type="number" min="1" placeholder="32768" />
                <span class="mk-field__hint">调用方没声明输出预算时用它</span>
              </label>
              <label class="mk-field">
                <span class="mk-field__label">推理预留</span>
                <input v-model.number="form.reasoningReserveTokens" class="mk-field__input mono" type="number" min="1" placeholder="8192" />
                <span class="mk-field__hint">开思考时额外留给推理的额度，避免推理吃光正文</span>
              </label>
              <label class="mk-field">
                <span class="mk-field__label">并发上限</span>
                <input v-model.number="form.maxParallelRequests" class="mk-field__input mono" type="number" min="1" placeholder="不限" />
              </label>
            </div>

            <div class="med-col">
              <div class="med-sec">备用模型</div>
              <label class="mk-field">
                <span class="mk-field__label">主模型出错后依次尝试</span>
                <select v-model="pickedFallbacks" class="mk-field__select med-fallbacks" multiple size="6">
                  <option v-for="opt in fallbackOptions" :key="opt" :value="opt">{{ opt }}</option>
                </select>
                <span class="mk-field__hint">运行时最多用到第 1 条备用。降级只换模型名，跨供应商的候选不可达</span>
              </label>
            </div>
          </div>

          <!-- 单价独立成条：三档（输入 / 缓存命中 / 输出）并排时需要整行宽度，
               挤在备用链那一列里每格只剩 60 多 px，读数会被截断 -->
          <div class="med-pricebar">
            <div class="med-sec">单价（USD / 1M tokens）</div>
            <div class="med-price">
              <label class="mk-field">
                <span class="mk-field__label">输入</span>
                <input v-model.number="form.inputPer1M" class="mk-field__input mono" type="number" min="0" step="0.001" placeholder="未知" />
              </label>
              <label class="mk-field">
                <span class="mk-field__label">缓存命中</span>
                <input v-model.number="form.cachedInputPer1M" class="mk-field__input mono" type="number" min="0" step="0.001" placeholder="留空按输入价计" />
              </label>
              <label class="mk-field">
                <span class="mk-field__label">输出</span>
                <input v-model.number="form.outputPer1M" class="mk-field__input mono" type="number" min="0" step="0.001" placeholder="未知" />
              </label>
            </div>
            <span class="mk-field__hint">只影响成本分析页的金额换算。缓存命中留空按输入价计（保守高估）。输入与输出都留空 = 金额未知，不会按 0 计算</span>
          </div>
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

const fallbackOptions = computed(() => props.fallbackOptions)

const MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const canSubmit = computed(() => (isCreate.value ? MODEL_ID_PATTERN.test(form.id.trim()) : true))
/**
 * 勾了强度没勾思考：就地拦在保存这一步，并给出原因。
 * 不改成「取消思考时自动把强度也清掉」——那样会替用户改一个他没碰过的字段，而 Vue 对
 * checkbox 的 v-model 在「DOM 值 ≠ 新模型值」时会跳过同步（它假定那是用户的点击，见
 * vModelCheckbox.beforeUpdate），界面上那个勾会留着不消失：状态与显示对不上，比报错更糟。
 */
const effortWithoutThinking = computed(() => form.supportsReasoningEffort && !form.supportsThinking)

function openWith(target: { providerId: string; model: ModelLike | null }): void {
  isCreate.value = !target.model
  providerId.value = target.providerId
  error.value = ''
  const m = target.model
  form.id = m?.id ?? ''
  form.label = m?.label ?? ''
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
.med-cols {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
@media (max-width: 900px) {
  .med-cols { grid-template-columns: minmax(0, 1fr); }
}
.med-sec {
  margin: 2px 0 8px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  letter-spacing: 0.04em;
}
.med-fallbacks { height: auto; min-height: 120px; }
.med-pricebar {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--mk-line);
}
.med-price { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.mk-field__hint {
  display: block;
  margin-top: 4px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
</style>
