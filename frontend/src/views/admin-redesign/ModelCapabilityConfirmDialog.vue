<template>
  <!-- 能力确认（P1 2026-11-04，用户「模型的思考啊强度啊以及能力这一块，也是让用户自己去勾选嘛，
       因为他自己一定要清楚他的模型有什么能力」）：
       批量添加时能力不再由模型名**静默推断落盘**——推断值只做预填，用户核对后才算数。
       依据：注册表里的 supportsThinking / reasoningEfforts / vision 是运行时的硬闸门
       （如请求带图片而模型未声明 vision 会被网关直接拒绝），猜错不会报错，会在真实调用里才炸。
       强度是**逐档**声明的（2026-11-05）：勾哪几档就是这台模型的支持集，不再是一个总开关。 -->
  <Teleport v-if="open" to="body">
    <div ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel mcc" role="dialog" aria-modal="true" aria-label="确认模型能力">
        <div class="mk-modal__head">
          <div class="mcc-head">
            <h3 class="mk-modal__title">确认模型能力</h3>
            <span class="mcc-head__sub">下面每个模型都按模型名预填了一版，请按实际能力核对——这决定运行时哪些参数敢发给上游。</span>
          </div>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="close">✕</button>
        </div>

        <div class="mk-modal__body">
          <div class="mcc-cols" aria-hidden="true">
            <span>模型</span>
            <span>思考</span>
            <span>强度挡位</span>
            <span>读图</span>
          </div>
          <div class="mcc-list">
            <div v-for="row in rows" :key="row.id" class="mcc-row">
              <span class="mcc-row__id">
                <span class="mono mcc-row__name" :title="row.id">{{ row.id }}</span>
                <span v-if="row.tags.length" class="mcc-row__tags">
                  <span v-for="tag in row.tags" :key="tag" class="mcc-chip">{{ tag }}</span>
                </span>
                <span v-else class="mcc-row__none">未推断出能力</span>
              </span>
              <label class="mcc-row__cell">
                <input v-model="row.supportsThinking" type="checkbox" :aria-label="`${row.id} 支持思考`" />
              </label>
              <div class="mcc-row__cell mcc-efforts">
                <label
                  v-for="level in EFFORT_LEVELS"
                  :key="level"
                  class="mcc-effort"
                  :class="{ 'mcc-effort--on': row.reasoningEfforts.includes(level), 'mcc-effort--off': !row.supportsThinking }"
                >
                  <input
                    v-model="row.reasoningEfforts"
                    type="checkbox"
                    :value="level"
                    :disabled="!row.supportsThinking"
                    :aria-label="`${row.id} 支持${effortShortText(level)}档推理强度`"
                  />
                  <span>{{ effortShortText(level) }}</span>
                </label>
              </div>
              <label class="mcc-row__cell">
                <input v-model="row.vision" type="checkbox" :aria-label="`${row.id} 支持读图`" />
              </label>
            </div>
            <p v-if="!rows.length" class="mcc-empty">没有要引入的模型</p>
          </div>
          <p class="mcc-hint">推断只认模型名，判不出的一律留空。留空是保守档：不发思考、强度与读图参数，模型照常可用。</p>
        </div>

        <div class="mk-modal__foot mcc-foot">
          <span class="mcc-foot__count">共 <b>{{ rows.length }}</b> 个模型</span>
          <button type="button" class="mk-btn" @click="close">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="!rows.length" @click="confirm">
            确认引入
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { inferModelCapabilities, inferenceLabels } from './modelCapabilityInference'
import { REASONING_EFFORT_LEVELS, effortShortText, type ReasoningEffortLevel } from './reasoningEfforts'
import { useEscape } from './useEscape'
import { useMaskClose, useOverlay } from './useOverlay'

/** 一个待确认的模型：能力三项是用户勾选后的结果（预填值来自推断，不是真相）。
 *  用 type（不是 interface）：形态与后端 addModels 的 Record<string, unknown>[] 直接相容，
 *  宿主不必再拼一遍字段。 */
export type ConfirmedModelCapability = {
  id: string
  supportsThinking: boolean
  /** 这台模型认哪几档推理强度；空数组 = 不支持该字段 */
  reasoningEfforts: ReasoningEffortLevel[]
  vision: boolean
}

interface Row extends ConfirmedModelCapability {
  /** 推断出的能力标签（只用于让用户认得出这是哪个模型，不参与提交） */
  tags: string[]
}

const emit = defineEmits<{
  confirm: [models: ConfirmedModelCapability[]]
}>()

/** 挡位词表：与模型编辑弹层共用同一份（勾选项、文案、顺序都一致） */
const EFFORT_LEVELS = REASONING_EFFORT_LEVELS

const open = ref(false)
const rows = ref<Row[]>([])
const maskRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)

/** 打开：把选中 id 逐个过一遍推断，得到一版可编辑的预填值 */
function openWith(ids: string[]): void {
  rows.value = ids.map((id) => {
    const inference = inferModelCapabilities(id)
    return {
      id,
      supportsThinking: inference.supportsThinking,
      reasoningEfforts: [...inference.reasoningEfforts],
      vision: inference.vision,
      tags: inferenceLabels(inference),
    }
  })
  open.value = true
}

function close(): void {
  open.value = false
}

/** 提交用户核对后的能力值（不回传推断），随后由宿主写入注册表 */
function confirm(): void {
  if (!rows.value.length) return
  emit(
    'confirm',
    rows.value.map(({ id, supportsThinking, reasoningEfforts, vision }) => ({
      id,
      supportsThinking,
      // 没开思考的模型不该带着挡位落盘（后端会拒），这里先清掉
      reasoningEfforts: supportsThinking ? reasoningEfforts : [],
      vision,
    })),
  )
  open.value = false
}

useEscape(() => open.value, close)
useOverlay(open, panelRef)
useMaskClose(maskRef, close)

defineExpose({ openWith })
</script>

<style scoped>
.mcc.mk-modal__panel { width: min(720px, 96vw); max-width: none; }
.mcc-head { display: grid; gap: 2px; min-width: 0; }
.mcc-head__sub { color: var(--mk-muted); font-size: var(--mk-fs-micro); line-height: 1.5; }
.mcc-cols,
.mcc-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 64px minmax(0, 260px) 64px;
  align-items: center;
  gap: 12px;
}
.mcc-cols {
  padding: 0 12px 6px;
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
}
.mcc-list {
  max-height: 46vh;
  overflow-y: auto;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
}
.mcc-row {
  min-height: 44px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--mk-line);
  font-size: var(--mk-fs-micro);
}
.mcc-row:last-child { border-bottom: 0; }
.mcc-row:hover { background: var(--mk-table-row-hover-bg); }
.mcc-row__id { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mcc-row__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mcc-row__tags { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.mcc-chip {
  padding: 1px 7px;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-blue-bg);
  color: var(--mk-blue);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  white-space: nowrap;
}
.mcc-row__none { color: var(--mk-faint); }
.mcc-row__cell { display: flex; justify-content: center; cursor: pointer; }
/* 挡位五选：一行五枚窄勾选，与模型编辑弹层同一副外观 */
.mcc-efforts { justify-content: flex-start; flex-wrap: wrap; gap: 4px; cursor: default; }
.mcc-effort {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-sm);
  color: var(--mk-muted);
  cursor: pointer;
}
.mcc-effort input[type='checkbox'] { margin: 0; flex: none; }
.mcc-effort--on { border-color: var(--mk-blue); color: var(--mk-ink); }
.mcc-effort--off { opacity: 0.45; cursor: not-allowed; }
.mcc-empty { margin: 0; padding: 14px 12px; color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.mcc-hint { margin: 10px 0 0; color: var(--mk-muted); font-size: var(--mk-fs-micro); line-height: 1.5; }
.mcc-foot { align-items: center; gap: 10px; }
.mcc-foot__count { margin-right: auto; color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.mcc-foot__count b { color: var(--mk-ink); }
@media (max-width: 640px) {
  .mcc-cols { display: none; }
  .mcc-row { grid-template-columns: minmax(0, 1fr) 48px minmax(0, 1fr) 48px; }
}
</style>
