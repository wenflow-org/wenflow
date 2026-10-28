<template>
  <!-- 模型资产选择器（2026-10-28 用户「应用商店级的选择弹窗」）：
       拉取结果不再只是一个勾选清单——按用途与能力分页签、显示推断出的能力标签，
       向量 / 重排模型直接标出应去哪张卡，避免误加进对话模型。 -->
  <Teleport v-if="open" to="body">
    <div ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel pmd" role="dialog" aria-modal="true" aria-label="添加对话模型">
        <div class="mk-modal__head">
          <div class="pmd-head">
            <h3 class="mk-modal__title">添加对话模型</h3>
            <span class="pmd-head__sub">从上游 {{ providerName || '当前通道' }} 拉取到 {{ models.length }} 个模型</span>
          </div>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="close">✕</button>
        </div>

        <div class="mk-modal__body">
          <div class="pmd-toolbar">
            <div class="pmd-tabs" role="tablist" aria-label="模型分类" @keydown="onTabKeydown">
              <button
                v-for="tab in tabs"
                :key="tab.key"
                type="button"
                class="pmd-tab"
                role="tab"
                :data-tab="tab.key"
                :aria-selected="activeTab === tab.key"
                :tabindex="activeTab === tab.key ? 0 : -1"
                :class="{ 'is-active': activeTab === tab.key }"
                :disabled="tab.key !== 'all' && tab.count === 0"
                @click="activeTab = tab.key"
              >{{ tab.label }} ({{ tab.count }})</button>
            </div>            <input
              v-model="query"
              class="mk-field__input pmd-filter"
              :placeholder="`搜索模型名称或厂商…`"
              aria-label="搜索模型"
              autocomplete="off"
            />
          </div>

          <div class="pmd-cols" aria-hidden="true">
            <span></span>
            <span>模型标识</span>
            <span>能力特性</span>
            <span>状态</span>
            <span></span>
          </div>
          <div class="pmd-list">
            <div
              v-for="row in visibleRows"
              :key="row.id"
              class="pmd-row"
              :class="{ 'pmd-row--done': row.added, 'pmd-row--off': !row.selectable }"
            >
              <label class="pmd-row__pick">
                <input
                  v-model="selected"
                  type="checkbox"
                  :value="row.id"
                  :disabled="!row.selectable"
                />
                <span class="pmd-row__name">
                  <span class="mono pmd-row__id" :title="row.id">{{ row.id }}</span>
                  <small v-if="row.display" class="pmd-row__display">{{ row.display }}</small>
                </span>
              </label>
              <span class="pmd-row__tags">
                <span v-for="tag in row.labels" :key="tag" class="pmd-chip">{{ tag }}</span>
                <span v-if="!row.labels.length" class="pmd-none">—</span>
              </span>
              <span class="pmd-row__status">
                <span v-if="row.added" class="mk-badge mk-badge--muted">已添加</span>
                <span v-else-if="row.suggestion" class="mk-badge mk-badge--warn">{{ row.suggestion }}</span>
                <span v-else class="mk-badge mk-badge--ok">新发现</span>
              </span>
              <span v-if="providerId && row.role === 'chat'" class="pmd-row__probe">
                <button
                  type="button"
                  class="mk-link pmd-row__test"
                  :disabled="!!testing"
                  @click="runTest(row.id)"
                >{{ testing === row.id ? '测试中…' : '测试' }}</button>
                <span
                  v-if="results[row.id]"
                  class="pmd-row__res"
                  :class="results[row.id].ok ? 'is-ok' : 'is-bad'"
                  :title="results[row.id].text"
                >{{ results[row.id].ok ? `已连通 · ${results[row.id].latency}` : '连接失败' }}</span>
                <span v-else class="pmd-row__res" aria-hidden="true"></span>
              </span>
            </div>
            <p v-if="!visibleRows.length" class="pmd-empty">
              {{ models.length ? '没有匹配的模型' : '这次没有拉取到模型' }}
            </p>
          </div>

          <div class="pmd-hint">
            <span>勾选后会按模型名自动带上能力标签，添加后可再逐个编辑。</span>
            <label class="pmd-all">
              <input
                type="checkbox"
                :checked="allVisibleSelected"
                :indeterminate="someVisibleSelected && !allVisibleSelected"
                :disabled="!selectableVisibleRows.length"
                @change="toggleAll"
              />
              <span>全选当前可添加 {{ selectableVisibleRows.length }} 个</span>
            </label>
          </div>
        </div>

        <div class="mk-modal__foot pmd-foot">
          <button type="button" class="mk-link pmd-manual" @click="manual">
            找不到需要的模型？手动录入模型 ID
          </button>
          <span class="pmd-foot__count">已选 <b>{{ selected.length }}</b> 个</span>
          <button type="button" class="mk-btn" @click="close">取消</button>
          <button
            type="button"
            class="mk-btn mk-btn--primary"
            :disabled="!selected.length"
            @click="confirm"
          >确认引入（已选 {{ selected.length }}）</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { adminModelProvidersApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useMaskClose, useOverlay } from './useOverlay'
import { errMsg } from './live'
import {
  hasReadableName,
  inferModelCapabilities,
  inferenceLabels,
  readableModelName,
  roleSuggestion,
  type ModelInference,
  type ModelRole,
} from './modelCapabilityInference'

type TabKey = 'all' | 'reasoning' | 'vision'

interface PickerRow {
  id: string
  display: string
  inference: ModelInference
  role: ModelRole
  labels: string[]
  suggestion: string
  added: boolean
  selectable: boolean
}

const props = defineProps<{
  /** 供应商名（浮窗副标题，说明这批模型从哪来） */
  providerName: string
  /** 供应商 id：就地测试要用它自己的地址与密钥（未传 = 不渲染测试动作） */
  providerId?: string
  /** 本次拉取到的全部模型 id */
  models: string[]
  /** 已登记进模型清单的 id：这些行只读标记「已添加」 */
  registered: string[]
}>()

const emit = defineEmits<{
  /** 勾选完成：把 id 交给宿主批量引入 */
  confirm: [ids: string[]]
  /** 上游没有需要的模型：转到手动录入 */
  manual: []
}>()

const open = ref(false)
const query = ref('')
const activeTab = ref<TabKey>('all')
const selected = ref<string[]>([])
/** 正在测试的模型 id（同一时刻只跑一个：串行避免一把把上游打满） */
const testing = ref('')
/** 行内测试结果：ok 显耗时，失败显「连接失败」（原因进 title） */
const results = ref<Record<string, { ok: boolean; latency: string; text: string }>>({})
const maskRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)

const registeredSet = computed(() => new Set(props.registered))

const rows = computed<PickerRow[]>(() =>
  props.models.map((id) => {
    const inference = inferModelCapabilities(id)
    const added = registeredSet.value.has(id)
    const suggestion = roleSuggestion(inference.role)
    return {
      id,
      display: hasReadableName(id) ? readableModelName(id) : '',
      inference,
      role: inference.role,
      labels: inferenceLabels(inference),
      suggestion,
      added,
      selectable: !added && inference.role === 'chat',
    }
  })
)

const tabs = computed(() => [
  { key: 'all' as const, label: '全部', count: rows.value.length },
  { key: 'reasoning' as const, label: '深度思考/推理', count: rows.value.filter((r) => r.inference.supportsThinking).length },
  { key: 'vision' as const, label: '多模态读图', count: rows.value.filter((r) => r.inference.vision).length },
])

const visibleRows = computed(() => {
  const q = query.value.trim().toLowerCase()
  return rows.value.filter((row) => {
    if (q && !row.id.toLowerCase().includes(q) && !row.display.toLowerCase().includes(q)) return false
    if (activeTab.value === 'reasoning') return row.inference.supportsThinking
    if (activeTab.value === 'vision') return row.inference.vision
    return true
  })
})

const selectableVisibleRows = computed(() => visibleRows.value.filter((row) => row.selectable))
const allVisibleSelected = computed(() =>
  selectableVisibleRows.value.length > 0
  && selectableVisibleRows.value.every((row) => selected.value.includes(row.id))
)
const someVisibleSelected = computed(() =>
  selectableVisibleRows.value.some((row) => selected.value.includes(row.id))
)

function toggleAll(): void {
  const ids = selectableVisibleRows.value.map((row) => row.id)
  if (allVisibleSelected.value) {
    selected.value = selected.value.filter((id) => !ids.includes(id))
  } else {
    selected.value = Array.from(new Set([...selected.value, ...ids]))
  }
}

/** 页签行键盘契约：方向键在可用的分类之间移动，Home/End 到两端。 */
async function onTabKeydown(event: KeyboardEvent): Promise<void> {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const available = tabs.value.filter((tab) => tab.key === 'all' || tab.count > 0)
  if (!available.length) return
  const current = available.findIndex((tab) => tab.key === activeTab.value)
  let next = current < 0 ? 0 : current
  if (event.key === 'ArrowRight') next = (next + 1) % available.length
  else if (event.key === 'ArrowLeft') next = (next - 1 + available.length) % available.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = available.length - 1
  activeTab.value = available[next].key
  await nextTick()
  const list = event.currentTarget as HTMLElement | null
  list?.querySelector<HTMLElement>(`[data-tab="${available[next].key}"]`)?.focus()
}

function openWith(): void {
  selected.value = []
  query.value = ''
  activeTab.value = 'all'
  results.value = {}
  testing.value = ''
  open.value = true
}

/** 就地测试：复用供应商测试端点（用该供应商自己的地址与密钥真发一次），
    结果只落在本行——勾选清单不该因为一个模型失败而整块变红。 */
async function runTest(modelId: string): Promise<void> {
  if (!props.providerId || testing.value) return
  testing.value = modelId
  try {
    const res = await adminModelProvidersApi.test(props.providerId, { modelId })
    const data = res?.data?.data ?? {}
    results.value = {
      ...results.value,
      [modelId]: { ok: true, latency: `${data.durationMs ?? 0}ms`, text: data.content || '连通正常' },
    }
  } catch (e) {
    results.value = { ...results.value, [modelId]: { ok: false, latency: '', text: errMsg(e) } }
  } finally {
    testing.value = ''
  }
}

function close(): void {
  open.value = false
}

function confirm(): void {
  if (!selected.value.length) return
  emit('confirm', [...selected.value])
  open.value = false
}

function manual(): void {
  emit('manual')
  open.value = false
}

useEscape(() => open.value, close)
useOverlay(open, panelRef)
useMaskClose(maskRef, close)

defineExpose({ openWith })
</script>

<style scoped>
.pmd.mk-modal__panel { width: min(980px, 96vw); max-width: none; }
.pmd-head { display: grid; gap: 2px; min-width: 0; }
.pmd-head__sub { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.pmd-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--mk-line);
}
.pmd-tabs { display: inline-flex; align-items: center; gap: 2px; flex-wrap: wrap; }
.pmd-tab {
  border: 0;
  background: transparent;
  padding: 5px 10px;
  border-radius: var(--mk-radius-sm);
  color: var(--mk-muted);
  font: inherit;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.pmd-tab:hover { background: var(--mk-hover-surface); color: var(--mk-ink); }
.pmd-tab.is-active { background: var(--mk-blue-bg); color: var(--mk-blue); }
.pmd-tab:disabled { opacity: 0.45; cursor: default; }
.pmd-tab:disabled:hover { background: transparent; color: var(--mk-muted); }
.pmd-filter { width: 240px; }
.pmd-cols {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) 190px 132px 92px;
  gap: 12px;
  padding: 10px 12px 6px;
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
}
.pmd-list {
  max-height: 44vh;
  overflow-y: auto;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
}
.pmd-row {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) 190px 132px 92px;
  align-items: center;
  gap: 12px;
  min-height: 46px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--mk-line);
  font-size: var(--mk-fs-micro);
}
.pmd-row:last-child { border-bottom: 0; }
.pmd-row:hover { background: var(--mk-table-row-hover-bg); }
.pmd-row--off { cursor: default; }
.pmd-row--off .pmd-row__id { color: var(--mk-faint); }
@media (max-width: 900px) {
  .pmd-cols { display: none; }
  .pmd-row { grid-template-columns: 26px minmax(0, 1fr); }
  .pmd-row__tags, .pmd-row__status, .pmd-row__probe { grid-column: 2; }
}
.pmd-row__pick {
  display: contents;
  cursor: pointer;
}
.pmd-row--off .pmd-row__pick { cursor: default; }
.pmd-row__name { display: grid; gap: 1px; min-width: 0; }
.pmd-row__display { color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.pmd-row__tags { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.pmd-chip {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--mk-blue-bg);
  color: var(--mk-blue);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  white-space: nowrap;
}
.pmd-none { color: var(--mk-faint); }
.pmd-row__status { display: flex; }
.pmd-row__probe { display: inline-flex; align-items: center; gap: 8px; justify-content: flex-end; }
.pmd-row__test { width: 32px; flex: none; font-size: var(--mk-fs-micro); text-align: left; }
.pmd-row__test:disabled { opacity: 0.55; cursor: default; }
.pmd-row__res {
  width: 92px;
  flex: none;
  font-size: var(--mk-fs-micro);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-align: right;
}
.pmd-row__res.is-ok { color: var(--mk-green); }
.pmd-row__res.is-bad { color: var(--mk-red); font-weight: 600; }
.pmd-row__id {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pmd-empty {
  margin: 0;
  padding: 14px 12px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.pmd-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 10px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.pmd-all {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  cursor: pointer;
}
.pmd-foot { align-items: center; gap: 10px; }
.pmd-manual { margin-right: auto; font-size: var(--mk-fs-micro); }
.pmd-foot__count { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.pmd-foot__count b { color: var(--mk-ink); }
</style>
