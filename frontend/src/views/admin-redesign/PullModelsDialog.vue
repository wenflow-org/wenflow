<template>
  <!-- 上游模型清单（2026-10-28 用户「应用商店级的选择弹窗」）。
       2026-11-04 用户「文案不要…我们不做模型类型区分。不分什么对话非对话，这个页面就是拉取列表测试添加」：
       撤掉按用途分的页签与「建议归入向量/重排」的判词，清单原样列出——能勾的勾、已添加的置灰。
       2026-11-05 用户「连接设置和添加模型合并到一起吧，只保留添加模型」：
       对话卡的连接（地址 / 密钥 / 重试 / RPM / 重置）搬到本弹窗顶部的 conn 槽里，
       卡头不再另挂一个「连接设置」入口——一次弹窗既配连接又选模型。
       2026-11-09 用户走查（图 2）：满屏绿色「可添加」既没有信息量（整列同值），
       又和「已添加」的真相打架（已挂上的模型仍显示可添加、还能重复勾）。
       现在：默认只看「未添加」，中间列改成**预判标签**（标签按名字预判，与本弹窗原有的
       底部说明同一口径），全选移到表头第一列，底部只留手动录入 + 已选数 + 两个按钮。
       注：2026-11-04 撤过一版「能力特性」列，那时是拿它当**事实**列在清单里；
       这次的「预判标签」是同一个推断函数，但列头就写明是预判，只服务「这行是什么模型」。 -->
  <Teleport v-if="open" to="body">
    <div ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel pmd" role="dialog" aria-modal="true" :aria-label="title">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">{{ title }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="close">✕</button>
        </div>

        <div class="mk-modal__body">
          <div class="pmd-toolbar">
            <input
              v-model="query"
              class="mk-field__input pmd-filter"
              placeholder="搜索模型名称或厂商…"
              aria-label="搜索模型"
              autocomplete="off"
            />
            <!-- 添加状态（2026-11-09）：默认只看未添加——省掉整列同值的绿标签，
                 也免得已挂上的模型在「全部」里被再勾一次。计数是清单规模，不随搜索变。
                 键盘契约同 MkSubTabs：方向键在页签间移动并切换、roving tabindex、Home/End。 -->
            <div class="mk-seg pmd-view" role="tablist" aria-label="按添加状态筛选" @keydown="onViewKeydown">
              <button
                v-for="(v, i) in viewOptions"
                :key="v.key"
                :ref="(el) => setViewRef(el, i)"
                type="button"
                class="mk-seg__item"
                role="tab"
                :aria-selected="view === v.key"
                :tabindex="view === v.key ? 0 : -1"
                :class="{ 'mk-seg__item--active': view === v.key }"
                @click="view = v.key"
              >{{ v.label }}</button>
            </div>
            <!-- 清单是「这次拉取」的快照：改了连接就重拉（2026-11-05 合并弹窗后，
                 重拉与改连接同处一屏，不再需要回卡头找入口） -->
            <button
              type="button"
              class="mk-btn mk-btn--sm pmd-refetch"
              :disabled="loading"
              @click="emit('refetch')"
            >{{ loading ? '拉取中…' : models.length ? '重新获取' : '获取模型' }}</button>
          </div>

          <div class="pmd-cols">
            <!-- 全选移到表头（2026-11-09 用户「把右下角那句全选移回表头第一列」）：
                 点表头勾即全选当前列表里**可添加**的行 -->
            <label class="pmd-cols__pick" :title="allPickTitle">
              <input
                type="checkbox"
                :checked="allVisibleSelected"
                :indeterminate="someVisibleSelected && !allVisibleSelected"
                :disabled="!selectableVisibleRows.length"
                :aria-label="allPickTitle"
                @change="toggleAll"
              />
            </label>
            <span>模型标识</span>
            <span>预判标签</span>
            <span>连通状态</span>
            <span class="pmd-cols__act">操作</span>
          </div>
          <div class="pmd-list" :class="{ 'pmd-list--stale': stale && !loading }">
            <p v-if="loading" class="pmd-empty">正在向上游拉取模型清单…</p>
            <p v-else-if="error && !models.length" class="pmd-empty pmd-empty--bad">{{ error }}</p>
            <p v-else-if="stale" class="pmd-empty">连接已改动，清单还是上一次的。先点「重新获取」。</p>
            <template v-else>
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
                    :aria-label="`选择 ${row.id}`"
                  />
                  <span class="pmd-row__name">
                    <span class="mono pmd-row__id" :title="row.id">{{ row.id }}</span>
                    <span v-if="row.display" class="pmd-row__alias" :title="row.display">{{ row.display }}</span>
                  </span>
                </label>
                <span class="pmd-row__tags">
                  <!-- 已添加只在「已添加 / 全部」两个视图里出现：未添加视图里本行不存在 -->
                  <span v-if="row.added" class="mk-badge mk-badge--muted mk-badge--sm">已添加</span>
                  <span v-for="tag in row.tags" :key="tag" class="mk-badge mk-badge--muted mk-badge--sm">{{ tag }}</span>
                </span>
                <span class="pmd-row__res" :class="resClass(row.id)" :title="results[row.id]?.text">
                  <template v-if="results[row.id]">{{ results[row.id].ok ? `已连通 · ${results[row.id].latency}` : '连接失败' }}</template>
                  <span v-else class="mk-na">—</span>
                </span>
                <span v-if="providerId || tester" class="pmd-row__probe">
                  <button
                    type="button"
                    class="mk-link pmd-row__test"
                    :disabled="!!testing"
                    @click="runTest(row.id)"
                  >{{ testing === row.id ? '测试中…' : '测试' }}</button>
                </span>
                <span v-else class="pmd-row__probe"><span class="mk-na">—</span></span>
              </div>
              <p v-if="!visibleRows.length" class="pmd-empty">{{ emptyMessage }}</p>
            </template>
          </div>

          <div v-if="hint || hiddenCount" class="pmd-hint">
            <span class="pmd-hint__left">
              <span v-if="hint">{{ hint }}</span>
              <!-- 宿主按用途筛过清单时（向量 / 重排卡）给一条「看全部」的退路：
                   名字里没有 embedding / rerank 这类标记的模型会被筛掉，
                   没有这条退路就只能眼睁睁少几个能挂的模型。 -->
              <button
                v-if="hiddenCount"
                type="button"
                class="mk-link"
                @click="emit('showAll')"
              >显示全部模型（{{ models.length + hiddenCount }}）</button>
            </span>
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
            :disabled="!selected.length || loading"
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
  inferModelCapabilities,
  inferenceLabels,
  readableModelName,
} from './modelCapabilityInference'

/** 清单视图：默认「未添加」（2026-11-09 用户走查） */
type PickerView = 'missing' | 'added' | 'all'

const ROLE_LABEL: Record<string, string> = { embedding: '向量', rerank: '重排', image: '图像' }

interface PickerRow {
  id: string
  display: string
  added: boolean
  selectable: boolean
  /** 预判标签：非对话模型给用途（向量 / 重排 / 图像），对话模型给能力（思考 / 视觉…） */
  tags: string[]
}

const props = withDefaults(defineProps<{
  /** 供应商 id：就地测试要用它自己的地址与密钥（未传 = 不渲染测试动作） */
  providerId?: string
  /** 本次拉取到的全部模型 id */
  models: string[]
  /** 已登记进模型清单的 id：这些行只读标记「已添加」 */
  registered: string[]
  /** 弹窗标题：对话卡「添加对话模型」/ 向量卡「添加向量模型」… */
  title?: string
  /** 清单正在重新拉取（宿主在「获取模型」时置位）：列表区给进度，不给一份过期清单 */
  loading?: boolean
  /** 上一次拉取失败的人话原因：清单空时直接显示在这里 */
  error?: string
  /** 连接在清单之后被改过：清单过期，先重拉再选（避免把旧端点的模型挂到新连接上） */
  stale?: boolean
  /** 底栏「手动录入」出口（向量 / 重排的配置弹层里本来就能填模型 ID） */
  allowManual?: boolean
  /** 底栏说明；空串即不显示 */
  hint?: string
  /** 已配置模型的显示名称（id → 名称）：宿主起过名的行优先显示它 */
  labels?: Record<string, string>
  /** 宿主按用途筛掉了几条：给了就在清单下方多一条「显示全部」的出口 */
  hiddenCount?: number
  /** 清单为空时的说明（宿主自己有筛选口径时自己给：全量就是空 / 是被筛空了） */
  emptyText?: string
  /** 行内测试的实现：向量 / 重排的连接不是供应商，宿主传自己的测试函数过来；
      不传就按 providerId 走供应商测试端点。 */
  tester?: (modelId: string) => Promise<{ latency: string; text: string }>
}>(), {
  providerId: '',
  title: '添加模型',
  loading: false,
  error: '',
  stale: false,
  allowManual: true,
  hint: '能力按模型名预判，引入后可点该行的「配置」调整思考 / 推理强度 / 视觉。',
  hiddenCount: 0,
  labels: () => ({}),
  emptyText: '',
  tester: undefined,
})

const emit = defineEmits<{
  /** 勾选完成：把 id 交给宿主批量引入 */
  confirm: [ids: string[]]
  /** 上游没有需要的模型：转到手动录入 */
  manual: []
  /** 「获取模型 / 重新获取」：拉清单是宿主的连接动作，弹窗只发意图 */
  refetch: []
  /** 「显示全部」：把宿主筛掉的那些也要过来 */
  showAll: []
  /** 弹窗关闭（取消 / 确认 / 手动录入都算）：宿主据此收起连接的编辑态 */
  closed: []
  /** 弹窗打开：宿主据此记一份「开窗前的连接」，用于关窗回滚未保存改动 */
  opened: []
}>()

const open = ref(false)
const query = ref('')
const view = ref<PickerView>('missing')
const selected = ref<string[]>([])
/** 正在测试的模型 id（同一时刻只跑一个：串行避免一把把上游打满） */
const testing = ref('')
/** 行内测试结果：ok 显耗时，失败显「连接失败」（原因进 title） */
const results = ref<Record<string, { ok: boolean; latency: string; text: string }>>({})
const maskRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)

const registeredSet = computed(() => new Set(props.registered))

/** 预判标签（只服务「这行是什么模型」，不是落库事实）：
    非对话模型给用途，对话模型给能力；两者都判不出时给「对话」，免得单元格空着像没数据。 */
function tagsOf(id: string): string[] {
  const inference = inferModelCapabilities(id)
  const role = ROLE_LABEL[inference.role]
  if (role) return [role]
  const caps = inferenceLabels(inference)
  return caps.length ? caps : ['对话']
}

const rows = computed<PickerRow[]>(() => {
  const list = props.models.map((id) => {
    const added = registeredSet.value.has(id)
    return {
      id,
      // 运营起过名就用他的名字；没起名才按 id 现推一个可读名
      display: props.labels[id] || (hasReadableName(id) ? readableModelName(id) : ''),
      added,
      // 只有「已添加」勾不动；不再按模型角色判断能不能加（2026-11-04）
      selectable: !added,
      tags: tagsOf(id),
    }
  })
  /* 已添加的行沉到末尾：首屏先给还没挂上的，sort 稳定，同组内保持上游原序。 */
  return list.sort((a, b) => Number(b.selectable) - Number(a.selectable))
})

/** 三个视图的计数用整份清单（不随搜索变），否则打字时数字乱跳 */
const viewOptions = computed<Array<{ key: PickerView; label: string }>>(() => {
  const added = rows.value.filter((r) => r.added).length
  return [
    { key: 'missing', label: `未添加 (${rows.value.length - added})` },
    { key: 'added', label: `已添加 (${added})` },
    { key: 'all', label: `全部 (${rows.value.length})` },
  ]
})

const visibleRows = computed(() => {
  const inView = rows.value.filter((row) =>
    view.value === 'all' ? true : view.value === 'added' ? row.added : !row.added
  )
  const q = query.value.trim().toLowerCase()
  if (!q) return inView
  return inView.filter((row) => row.id.toLowerCase().includes(q) || row.display.toLowerCase().includes(q))
})

const selectableVisibleRows = computed(() => visibleRows.value.filter((row) => row.selectable))

/** 空列表的缘由分四种：搜索无果 / 上游没回 / 当前视图下都挂上了 / 宿主自己筛过。
    宿主自己筛过清单时，它给的那句更准（是筛空了还是本来就没有）。 */
const emptyMessage = computed(() => {
  if (query.value.trim()) return '没有匹配的模型'
  if (!props.models.length) return props.emptyText || '这次没有拉取到模型'
  if (view.value === 'missing') return '上游模型都已添加'
  if (view.value === 'added') return '还没有已添加的模型'
  return props.emptyText || '这次没有拉取到模型'
})
const allVisibleSelected = computed(() =>
  selectableVisibleRows.value.length > 0
  && selectableVisibleRows.value.every((row) => selected.value.includes(row.id))
)
const someVisibleSelected = computed(() =>
  selectableVisibleRows.value.some((row) => selected.value.includes(row.id))
)
const allPickTitle = computed(() =>
  selectableVisibleRows.value.length
    ? `全选当前可添加的 ${selectableVisibleRows.value.length} 个模型`
    : '当前列表没有可添加的模型'
)

/* 分段控件的键盘落点（与 MkSubTabs 同一套判据）：roving tabindex + 方向键/Home/End。 */
const viewEls = ref<(HTMLButtonElement | null)[]>([])
function setViewRef(el: unknown, i: number): void {
  viewEls.value[i] = (el as HTMLButtonElement) || null
}
function activateView(i: number): void {
  const opt = viewOptions.value[i]
  if (!opt) return
  view.value = opt.key
  // 焦点跟随选中（ARIA tabs 的 manual 激活惯例）
  requestAnimationFrame(() => viewEls.value[i]?.focus())
}
function onViewKeydown(e: KeyboardEvent): void {
  const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const n = viewOptions.value.length
  if (!n) return
  const cur = viewOptions.value.findIndex((o) => o.key === view.value)
  const from = cur >= 0 ? cur : 0
  let next = from
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (from + 1) % n
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (from - 1 + n) % n
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = n - 1
  e.preventDefault()
  activateView(next)
}

function toggleAll(): void {
  const ids = selectableVisibleRows.value.map((row) => row.id)
  if (allVisibleSelected.value) {
    selected.value = selected.value.filter((id) => !ids.includes(id))
  } else {
    selected.value = Array.from(new Set([...selected.value, ...ids]))
  }
}

function resClass(id: string): string[] {
  const r = results.value[id]
  if (!r) return []
  return [r.ok ? 'is-ok' : 'is-bad']
}

function openWith(): void {
  selected.value = []
  query.value = ''
  // 每次开窗都回「未添加」：默认视图是「这次能挂什么」（2026-11-09）
  view.value = 'missing'
  results.value = {}
  testing.value = ''
  open.value = true
  emit('opened')
}

/** 就地测试：向量 / 重排用宿主给的测试函数（走那条连接），对话卡走供应商测试端点。
    结果只落在本行——勾选清单不该因为一个模型失败而整块变红。 */
async function runTest(modelId: string): Promise<void> {
  if ((!props.providerId && !props.tester) || testing.value) return
  testing.value = modelId
  try {
    if (props.tester) {
      const r = await props.tester(modelId)
      results.value = { ...results.value, [modelId]: { ok: true, latency: r.latency, text: r.text || '连通正常' } }
      return
    }
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
  if (!open.value) return
  open.value = false
  emit('closed')
}

function confirm(): void {
  if (!selected.value.length) return
  emit('confirm', [...selected.value])
  close()
}

function manual(): void {
  emit('manual')
  close()
}

useEscape(() => open.value, close)
useOverlay(open, panelRef)
useMaskClose(maskRef, close)

defineExpose({ openWith, isOpen: () => open.value })
</script>

<style scoped>
.pmd.mk-modal__panel { width: min(1040px, 96vw); max-width: none; }
.pmd-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--mk-line);
}
.pmd-filter { width: 280px; }
/* 搜索框：撤掉浏览器原生那圈粗蓝 outline（与外层输入框边框叠成双层框），
   焦点改用本站口径——描边变蓝（2026-11-07 用户「把搜索框那圈粗大的原生蓝色 outline 焦点框去掉」） */
.pmd-filter:focus-visible { outline: none; border-color: var(--mk-blue); }
.pmd-view { flex: none; }
/* 拉取按钮靠右（分段与搜索留在左半：它们是同一次挑选的两步） */
.pmd-refetch { margin-left: auto; flex: none; }
.pmd-cols {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) 240px 104px 64px;
  gap: 12px;
  align-items: center;
  padding: 10px 12px 6px;
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
}
.pmd-cols__pick { display: inline-flex; align-items: center; cursor: pointer; }
.pmd-cols__pick input { cursor: pointer; }
.pmd-cols__pick input:disabled { cursor: default; }
.pmd-cols__act { text-align: right; }
.pmd-list {
  max-height: 44vh;
  overflow-y: auto;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
}
.pmd-row {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) 240px 104px 64px;
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
  .pmd-row__tags, .pmd-row__res, .pmd-row__probe { grid-column: 2; }
}
.pmd-row__pick {
  display: contents;
  cursor: pointer;
}
.pmd-row--off .pmd-row__pick { cursor: default; }
.pmd-row__name { display: grid; gap: 1px; min-width: 0; }
.pmd-row__alias { color: var(--mk-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 预判标签：可能 2~3 枚（思考 / 视觉 / 代码），允许折行但行高仍受 46px 约束 */
.pmd-row__tags { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; min-width: 0; }
.pmd-row__probe { display: inline-flex; align-items: center; justify-content: flex-end; }
.pmd-row__test { flex: none; font-size: var(--mk-fs-micro); }
.pmd-row__test:disabled { opacity: 0.55; cursor: default; }
.pmd-row__res {
  font-size: var(--mk-fs-micro);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
.pmd-empty--bad { color: var(--mk-red); }
/* 清单过期（连接改了还没重拉）：整块压暗，读起来像「这批不作数」而不是「可以选」 */
.pmd-list--stale { background: var(--mk-surface-2); }
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
/* 说明与「显示全部」并排：两者之间要有缝，否则读成一句「…显示全部…」 */
.pmd-hint__left { display: inline-flex; align-items: center; gap: 4px 12px; flex-wrap: wrap; min-width: 0; }
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
