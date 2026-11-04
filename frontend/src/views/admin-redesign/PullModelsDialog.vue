<template>
  <!-- 上游模型清单（2026-10-28 用户「应用商店级的选择弹窗」）。
       2026-11-04 用户「文案不要…我们不做模型类型区分。不分什么对话非对话，这个页面就是拉取列表测试添加」：
       撤掉按用途分的页签与「建议归入向量/重排」的判词，清单原样列出——能勾的勾、已添加的置灰。
       2026-11-04 用户「这两个拉取，弹窗怎么还不一样呢」：向量 / 重排卡的「＋ 添加模型」
       也走这一张弹窗（single 单例模式：单选、无全选、无能力确认提示），两条拉取不要再是两种弹窗。 -->
  <Teleport v-if="open" to="body">
    <div ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel pmd" role="dialog" aria-modal="true" :aria-label="title">
        <div class="mk-modal__head">
          <div class="pmd-head">
            <h3 class="mk-modal__title">{{ title }}</h3>
          </div>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="close">✕</button>
        </div>

        <div class="mk-modal__body">
          <div class="pmd-toolbar">
            <input
              v-model="query"
              class="mk-field__input pmd-filter"
              :placeholder="`搜索模型名称或厂商…`"
              aria-label="搜索模型"
              autocomplete="off"
            />
          </div>

          <!-- 没有「能力特性」列（2026-11-04 用户「能力特性我们也不知道吧，这个列表并不能获取这些，
               需要运营者添加模型后勾选填写」）：`/v1/models` 只回模型 id，按名字猜出来的能力
               摆在这里等同平台假装知道；能力留给引入后的「确认模型能力」逐项勾。 -->
          <div class="pmd-cols" aria-hidden="true">
            <span></span>
            <span>模型标识</span>
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
                  v-if="single"
                  type="radio"
                  :name="`pmd-single-${title}`"
                  :checked="selected[0] === row.id"
                  :disabled="!row.selectable"
                  @change="selectOne(row.id)"
                />
                <input
                  v-else
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
              <span class="pmd-row__status">
                <span v-if="row.added" class="mk-badge mk-badge--muted">{{ single ? '使用中' : '已添加' }}</span>
                <span v-else class="mk-badge mk-badge--ok">可添加</span>
              </span>
              <span v-if="providerId" class="pmd-row__probe">
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
            <p v-if="!visibleRows.length" class="pmd-empty">{{ emptyText }}</p>
          </div>

          <div class="pmd-hint">
            <span v-if="hint">{{ hint }}</span>
            <label v-if="!single && selectableVisibleRows.length" class="pmd-all">
              <input
                type="checkbox"
                :checked="allVisibleSelected"
                :indeterminate="someVisibleSelected && !allVisibleSelected"
                :disabled="!selectableVisibleRows.length"
                @change="toggleAll"
              />
              <span>全选当前可添加的 {{ selectableVisibleRows.length }} 个模型</span>
            </label>
          </div>
        </div>

        <div class="mk-modal__foot pmd-foot">
          <button v-if="allowManual" type="button" class="mk-link pmd-manual" @click="manual">
            找不到需要的模型？手动录入模型 ID
          </button>
          <span class="pmd-foot__count">已选 <b>{{ selected.length }}</b> 个</span>
          <button type="button" class="mk-btn" @click="close">取消</button>
          <button
            type="button"
            class="mk-btn mk-btn--primary"
            :disabled="!selected.length"
            @click="confirm"
          >确认引入</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { adminModelProvidersApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useMaskClose, useOverlay } from './useOverlay'
import { errMsg } from './live'
import {
  hasReadableName,
  readableModelName,
} from './modelCapabilityInference'

interface PickerRow {
  id: string
  display: string
  added: boolean
  selectable: boolean
}

const props = withDefaults(defineProps<{
  /** 供应商 id：就地测试要用它自己的地址与密钥（未传 = 不渲染测试动作） */
  providerId?: string
  /** 本次拉取到的全部模型 id */
  models: string[]
  /** 已登记进模型清单的 id：这些行只读标记「已添加」 */
  registered: string[]
  /** 弹窗标题：对话卡「添加模型」/ 向量卡「添加向量模型」… */
  title?: string
  /** 单选模式：向量 / 重排是单例引擎，只挑一个 */
  single?: boolean
  /** 底栏「手动录入」出口（向量 / 重排的配置弹层里本来就能填模型 ID） */
  allowManual?: boolean
  /** 底栏说明；空串即不显示（单例模式没有「引入后确认能力」这一步） */
  hint?: string
}>(), {
  providerId: '',
  title: '添加模型',
  single: false,
  allowManual: true,
  hint: '能力列表里没有，勾完引入时会让你逐项确认思考 / 推理强度 / 读图。',
})

const emit = defineEmits<{
  /** 勾选完成：把 id 交给宿主批量引入 */
  confirm: [ids: string[]]
  /** 上游没有需要的模型：转到手动录入 */
  manual: []
}>()

const open = ref(false)
const query = ref('')
const selected = ref<string[]>([])
/** 正在测试的模型 id（同一时刻只跑一个：串行避免一把把上游打满） */
const testing = ref('')
/** 行内测试结果：ok 显耗时，失败显「连接失败」（原因进 title） */
const results = ref<Record<string, { ok: boolean; latency: string; text: string }>>({})
const maskRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)

const registeredSet = computed(() => new Set(props.registered))

const rows = computed<PickerRow[]>(() => {
  const list = props.models.map((id) => {
    const added = registeredSet.value.has(id)
    return {
      id,
      display: hasReadableName(id) ? readableModelName(id) : '',
      added,
      // 只有「已添加」勾不动；不再按模型角色判断能不能加（2026-11-04）
      selectable: !added,
    }
  })
  /* 已添加的行沉到末尾：首屏先给还没挂上的，sort 稳定，同组内保持上游原序。 */
  return list.sort((a, b) => Number(b.selectable) - Number(a.selectable))
})

const visibleRows = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return rows.value
  return rows.value.filter((row) => row.id.toLowerCase().includes(q) || row.display.toLowerCase().includes(q))
})

const selectableVisibleRows = computed(() => visibleRows.value.filter((row) => row.selectable))

/** 空列表只有两种缘由：搜索无果，或者上游一个都没返回 / 都已经挂上了。 */
const emptyText = computed(() => {
  if (query.value.trim()) return '没有匹配的模型'
  if (!props.models.length) return '这次没有拉取到模型'
  return '上游模型都已添加'
})
const allVisibleSelected = computed(() =>
  selectableVisibleRows.value.length > 0
  && selectableVisibleRows.value.every((row) => selected.value.includes(row.id))
)
const someVisibleSelected = computed(() =>
  selectableVisibleRows.value.some((row) => selected.value.includes(row.id))
)

/** 单例模式：选中即替换（向量 / 重排只挂一个模型） */
function selectOne(id: string): void {
  selected.value = [id]
}

function toggleAll(): void {
  const ids = selectableVisibleRows.value.map((row) => row.id)
  if (allVisibleSelected.value) {
    selected.value = selected.value.filter((id) => !ids.includes(id))
  } else {
    selected.value = Array.from(new Set([...selected.value, ...ids]))
  }
}

function openWith(): void {
  selected.value = []
  query.value = ''
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
.pmd-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--mk-line);
}
.pmd-filter { width: 320px; }
.pmd-cols {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) 132px 92px;
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
  grid-template-columns: 26px minmax(0, 1fr) 132px 92px;
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
  .pmd-row__status, .pmd-row__probe { grid-column: 2; }
}
.pmd-row__pick {
  display: contents;
  cursor: pointer;
}
.pmd-row--off .pmd-row__pick { cursor: default; }
.pmd-row__name { display: grid; gap: 1px; min-width: 0; }
.pmd-row__display { color: var(--mk-faint); font-size: var(--mk-fs-micro); }
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
/* ≤640：底栏四项在手机宽度放不下一行，flex 会把按钮压到竖排换字。
   手动录入独占一行，已选数靠左、两个按钮靠右，按钮不收缩。 */
@media (max-width: 640px) {
  .pmd-foot { flex-wrap: wrap; row-gap: 8px; }
  .pmd-manual { width: 100%; margin-right: 0; }
  .pmd-foot__count { margin-right: auto; }
  .pmd-foot .mk-btn { flex: none; white-space: nowrap; }
}
</style>
