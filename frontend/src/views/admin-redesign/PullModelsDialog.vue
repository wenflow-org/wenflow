<template>
  <!-- 上游模型清单（2026-10-28 用户「应用商店级的选择弹窗」）。
       2026-11-04 用户「文案不要…我们不做模型类型区分。不分什么对话非对话，这个页面就是拉取列表测试添加」：
       撤掉按用途分的页签与「建议归入向量/重排」的判词，清单原样列出——能勾的勾、已添加的置灰。
       2026-11-05 用户「连接设置和添加模型合并到一起吧，只保留添加模型」：
       对话卡的连接（地址 / 密钥 / 重试 / RPM / 重置）搬到本弹窗顶部的 conn 槽里，
       卡头不再另挂一个「连接设置」入口——一次弹窗既配连接又选模型。 -->
  <Teleport v-if="open" to="body">
    <div ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel pmd" role="dialog" aria-modal="true" :aria-label="title">
        <div class="mk-modal__head">
          <div class="pmd-head">
            <h3 class="mk-modal__title">{{ title }}</h3>
            <p v-if="stateLine" class="pmd-head__state" :title="stateLineTitle || undefined">{{ stateLine }}</p>
          </div>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="close">✕</button>
        </div>

        <div class="mk-modal__body">
          <!-- 连接段（宿主注入）：对话卡把服务地址 / 密钥 / 重试策略放在这里。
               脚注动作（重置此通道等）也由宿主给，弹窗不拥有那条连接。 -->
          <section v-if="$slots.conn" class="pmd-conn">
            <div class="pmd-conn__head">
              <h4 class="pmd-conn__title">连接</h4>
              <span class="pmd-conn__actions"><slot name="conn-actions" /></span>
            </div>
            <slot name="conn" />
          </section>

          <div class="pmd-toolbar">
            <input
              v-model="query"
              class="mk-field__input pmd-filter"
              :placeholder="`搜索模型名称或厂商…`"
              aria-label="搜索模型"
              autocomplete="off"
            />
            <!-- 清单是「这次拉取」的快照：改了连接就重拉（2026-11-05 合并弹窗后，
                 重拉与改连接同处一屏，不再需要回卡头找入口） -->
            <button
              type="button"
              class="mk-btn mk-btn--sm"
              :disabled="loading"
              @click="emit('refetch')"
            >{{ loading ? '拉取中…' : models.length ? '重新获取' : '获取模型' }}</button>
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
                  />
                  <span class="pmd-row__name">
                    <span class="mono pmd-row__id" :title="row.id">{{ row.id }}</span>
                    <small v-if="row.display" class="pmd-row__display">{{ row.display }}</small>
                  </span>
                </label>
                <span class="pmd-row__status">
                  <span v-if="row.added" class="mk-badge mk-badge--muted">已添加</span>
                  <span v-else class="mk-badge mk-badge--ok">可添加</span>
                </span>
                <span v-if="providerId" class="pmd-row__probe">
                  <button
                    type="button"
                    class="mk-link mk-link--hold pmd-row__test"
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
            </template>
          </div>

          <div class="pmd-hint">
            <span v-if="hint">{{ hint }}</span>
            <label v-if="selectableVisibleRows.length" class="pmd-all">
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
            :disabled="!selected.length || loading || (stale && !selected.length)"
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
  /** 清单正在重新拉取（宿主在「获取模型」时置位）：列表区给进度，不给一份过期清单 */
  loading?: boolean
  /** 上一次拉取失败的人话原因：清单空时直接显示在这里 */
  error?: string
  /** 连接在清单之后被改过：清单过期，先重拉再选（避免把旧端点的模型挂到新连接上） */
  stale?: boolean
  /** 标题下的一行状态（连接是否就绪 / 密钥是否已配）：合并连接段之后，
      这一行是「能不能拉」的唯一读数 */
  stateLine?: string
  /** stateLine 的悬停全文（时间口径 / 不冒充实时探活那类说明） */
  stateLineTitle?: string
  /** 底栏「手动录入」出口（向量 / 重排的配置弹层里本来就能填模型 ID） */
  allowManual?: boolean
  /** 底栏说明；空串即不显示 */
  hint?: string
}>(), {
  providerId: '',
  title: '添加模型',
  loading: false,
  error: '',
  stale: false,
  stateLine: '',
  stateLineTitle: '',
  allowManual: true,
  hint: '能力列表里没有，勾完引入时会让你逐项确认思考 / 推理强度 / 视觉。',
})

const emit = defineEmits<{
  /** 勾选完成：把 id 交给宿主批量引入 */
  confirm: [ids: string[]]
  /** 上游没有需要的模型：转到手动录入 */
  manual: []
  /** 「获取模型 / 重新获取」：拉清单是宿主的连接动作，弹窗只发意图 */
  refetch: []
  /** 弹窗关闭（取消 / 确认 / 手动录入都算）：宿主据此收起连接的编辑态 */
  closed: []
  /** 弹窗打开：宿主据此记一份「开窗前的连接」，用于关窗回滚未保存改动 */
  opened: []
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
  emit('opened')
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
.pmd.mk-modal__panel { width: min(980px, 96vw); max-width: none; }
.pmd-head { display: grid; gap: 2px; min-width: 0; }
/* 标题下那行连接读数（2026-11-05 合并弹窗）：填地址与密钥时正对着看，不是第二行标题 */
.pmd-head__state { margin: 2px 0 0; color: var(--mk-muted); font-size: var(--mk-fs-micro); }
/* 连接段：地址 / 密钥 / 重试策略。与下方清单用发丝线分开——
   上面是「接在哪」，下面是「挂了哪些」，两件事不该读成一片。 */
.pmd-conn {
  display: grid;
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--mk-line);
}
.pmd-conn__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.pmd-conn__title { margin: 0; color: var(--mk-ink); font-size: var(--mk-fs-body); font-weight: 700; }
.pmd-conn__actions { display: inline-flex; align-items: center; gap: 8px; }
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
