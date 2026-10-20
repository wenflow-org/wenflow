<template>
  <!-- Skill × 模型 × 参数 × 备用模型 覆盖矩阵（2026-10-19：原「兜底」与同表列头「备用模型」同义不同词） -->
  <div class="mk-card skc">
    <!-- 原型 .card__head（title + sub）：卡头统一走 mk-card 词表 -->
    <div class="mk-card__head">
      <div>
        <h3 class="mk-card__title">Skill × 模型 × 参数 × 备用模型</h3>
        <span class="mk-card__meta">
          <template v-if="isFiltered">命中 {{ visibleRows.length }} / 共 {{ rows.length }} 个技能</template>
          <template v-else>共 {{ rows.length }} 个技能</template>
        </span>
      </div>
      <div class="mk-card__head-right">
        <MkFilterSearch v-model="keyword" placeholder="搜索 Skill / 模型" />
      </div>
    </div>
    <div class="skc__body">
      <!-- 说明段已删（2026-10-17 用户走查：这类文案没有用）：
           「未配置的技能会走平台默认」是下面「路由来源」列与页头「降级策略」KPI 的原文复述；
           「对多个技能套用同一份…配置：」是表单自身的用途，输入框占位与按钮已说明。
           原 p 的 title 还挂着一条 2026-09-28 的研发事故记录，属实现历史，不该出现在界面上。 -->
      <!-- 可筛选的来源视图（2026-10-20 走查）：此前只有一张不可筛的矩阵，
           看不出「多少 Skill 在用平台默认、多少独立配置」。计数取全量口径，不随其它筛选变化。 -->
      <div class="skc__filters">
        <div class="mk-pills" role="group" aria-label="按路由来源筛选">
          <button type="button" class="mk-pill" :class="{ 'mk-pill--active': sourceFilter === 'all' }" :aria-pressed="sourceFilter === 'all'" @click="sourceFilter = 'all'">全部<span class="mk-pill__count">{{ counts.all }}</span></button>
          <button type="button" class="mk-pill" :class="{ 'mk-pill--active': sourceFilter === 'platform-default' }" :aria-pressed="sourceFilter === 'platform-default'" @click="sourceFilter = 'platform-default'">平台默认<span class="mk-pill__count">{{ counts.platformDefault }}</span></button>
          <button type="button" class="mk-pill" :class="{ 'mk-pill--active': sourceFilter === 'skill-model-only' }" :aria-pressed="sourceFilter === 'skill-model-only'" @click="sourceFilter = 'skill-model-only'">仅技能模型<span class="mk-pill__count">{{ counts.skillModelOnly }}</span></button>
          <button type="button" class="mk-pill" :class="{ 'mk-pill--active': sourceFilter === 'skill-channel' }" :aria-pressed="sourceFilter === 'skill-channel'" @click="sourceFilter = 'skill-channel'">独立通道<span class="mk-pill__count">{{ counts.skillChannel }}</span></button>
        </div>
        <div class="mk-pills" role="group" aria-label="按备用模型筛选">
          <button type="button" class="mk-pill" :class="{ 'mk-pill--active': onlyFallback }" :aria-pressed="onlyFallback" @click="onlyFallback = !onlyFallback">自定义备用模型<span class="mk-pill__count">{{ counts.fallback }}</span></button>
        </div>
        <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
      </div>

      <div class="skc__apply">
        <input v-model="bulk.endpoint" class="mk-input mono" placeholder="endpoint（必填，http://host:30001）" :class="{ 'is-err': bulkErr }" />
        <input v-model="bulk.apiKey" class="mk-input mono" type="password" placeholder="apiKey（必填）" :class="{ 'is-err': bulkErr }" />
        <input v-model="bulk.model" class="mk-input mono" placeholder="model（留空则不覆盖）" list="skc-model-options" />
        <button type="button" class="mk-btn mk-btn--primary" :disabled="bulkSaving || !selected.length" @click="applyBulk">
          {{ bulkSaving ? '套用中…' : `套用到 ${selected.length} 个技能` }}
        </button>
        <button type="button" class="mk-link" :disabled="loading" @click="load"><MkLoading v-if="loading" inline min text="加载中…" /><template v-else>刷新</template></button>
      </div>
      <!-- 刷新失败但表内仍有上次数据时：顶部错误条（空表时由下方 tone=error 空态承载，不重复） -->
      <p v-if="loadErr && rows.length" class="note note--bad" role="alert">刷新失败：{{ loadErr }}（下表仍为上次成功的数据）</p>
      <p v-if="bulkMsg" class="note" :class="{ 'note--bad': bulkErr }" :role="bulkErr ? 'alert' : 'status'" aria-live="polite">{{ bulkMsg }}</p>

      <!-- 原型 .tbl：统一 mk-table--dense 词表；长内容列（参数/备用模型链）走 wrap 列 -->
      <div v-if="visibleRows.length" class="mk-table-scroll">
        <table class="mk-table mk-table--dense skc__table">
          <thead>
            <tr>
              <th scope="col">
                <input
                  type="checkbox"
                  aria-label="全选技能"
                  :checked="allChecked"
                  :indeterminate="someChecked"
                  @change="toggleAll(($event.target as HTMLInputElement).checked)"
                />
              </th>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="covSortState('skill')"
                @click="toggleCovSort('skill')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleCovSort('skill')">Skill<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="covSortState('source')"
                @click="toggleCovSort('source')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleCovSort('source')">路由来源<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="covSortState('model')"
                @click="toggleCovSort('model')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleCovSort('model')">model<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="covSortState('params')"
                @click="toggleCovSort('params')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleCovSort('params')" title="按覆盖项数排序">参数覆盖<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                scope="col"
                class="mk-th--sortable skc__wrap"
                :aria-sort="covSortState('fallback')"
                @click="toggleCovSort('fallback')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleCovSort('fallback')" title="按备用模型链条数排序">备用模型<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in visibleRows" :key="s.skillId">
              <td><input v-model="selected" type="checkbox" :value="s.skillId" :aria-label="`选择技能 ${s.skillId}`" /></td>
              <td class="mono"><button type="button" class="mk-link skc__name" @click="emit('open-skill', s.skillId)">{{ s.skillId }}</button></td>
              <td>
                <span class="mk-badge" :class="s.source === 'platform-default' ? 'mk-badge--muted' : 'mk-badge--ok'">
                  {{ s.source === 'platform-default' ? '平台默认(未配置)' : s.source === 'skill-channel' ? '独立通道' : '仅技能模型' }}
                </span>
              </td>
              <td class="mono"><span class="skc__model"><span class="skc__model-id">{{ s.model || '未配置' }}</span><span v-if="s.model" class="mk-badge mk-badge--muted">{{ s.tier }}</span></span></td>
              <!-- 2026-10-18：整串 JSON 挤在单元格里属开发向；表内只给项数，原文进 title -->
              <td class="mono skc__wrap" :title="s.paramOverrides ? JSON.stringify(s.paramOverrides) : undefined">{{ overrideText(s.paramOverrides) }}</td>
              <td class="mono skc__wrap" :title="s.fallbackChain && s.fallbackChain.length ? s.fallbackChain.join(' → ') : undefined">{{ s.fallbackChain && s.fallbackChain.length ? s.fallbackChain.join(' → ') : '平台默认' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- 筛空 ≠ 目录空：筛选控件保留，只换空态文案（控件不能折叠/隐藏） -->
      <MkEmptyState
        v-else-if="rows.length && !loading"
        title="没有符合筛选的技能"
        description="当前来源筛选与搜索词没有命中任何 Skill。"
        action-text="清除筛选"
        @action="clearFilters"
      />
      <MkEmptyState
        v-else-if="!loading && loadErr"
        tone="error"
        title="技能覆盖数据加载失败"
        :description="loadErr"
        action-text="重试"
        @action="load"
      />
      <MkEmptyState
        v-else-if="!loading"
        title="暂无技能覆盖数据"
        description="技能目录为空。可点击「刷新」重新拉取。"
        action-text="刷新"
        @action="load"
      />
    </div>

    <!-- 模型目录候选（File-as-Truth llm-providers.json；带「供应商 · tier」标注） -->
    <datalist id="skc-model-options">
      <option v-for="o in catalogOptions" :key="`cat-${o.value}`" :value="o.value" :label="o.label" />
    </datalist>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { adminSkillsApi } from '@/api/adminApi'
import { useModelCatalog } from '@/composables/useModelCatalog'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import { askConfirm } from './useConfirm'
import { useTableSort } from './useTableSort'

/** 套用成功 → 通知宿主 Skills.vue 重拉 coverageById（#93：否则上方路由表两列与四张 KPI
    仍用挂载时的旧值，与下方矩阵同屏互相打架）；行内 Skill 名 → 打开该 Skill 运行时页签 */
const emit = defineEmits<{ (e: 'applied'): void; (e: 'open-skill', skillId: string): void }>()

const { options: catalogOptions, load: loadModelCatalog } = useModelCatalog()
loadModelCatalog()

interface Row {
  skillId: string
  endpoint: string | null
  model: string | null
  tier: string
  source: 'skill-channel' | 'skill-model-only' | 'platform-default'
  paramOverrides: Record<string, number> | null
  fallbackChain: string[] | null
}

const rows = ref<Row[]>([])
/* 来源筛选 + 搜索（2026-10-20）：两者 AND；计数取全量口径 */
type SourceFilter = 'all' | Row['source']
const keyword = ref('')
const sourceFilter = ref<SourceFilter>('all')
const onlyFallback = ref(false)
const counts = computed(() => {
  const out = { all: rows.value.length, platformDefault: 0, skillModelOnly: 0, skillChannel: 0, fallback: 0 }
  for (const r of rows.value) {
    if (r.source === 'platform-default') out.platformDefault += 1
    else if (r.source === 'skill-model-only') out.skillModelOnly += 1
    else if (r.source === 'skill-channel') out.skillChannel += 1
    if (r.fallbackChain && r.fallbackChain.length) out.fallback += 1
  }
  return out
})
const isFiltered = computed(() => sourceFilter.value !== 'all' || onlyFallback.value || !!keyword.value.trim())
function clearFilters(): void {
  sourceFilter.value = 'all'
  onlyFallback.value = false
  keyword.value = ''
}

/* 矩阵排序（2026-10-17 用户走查「有的列没有排序」）：数据是全量覆盖清单，
   客户端排序诚实；参数覆盖按覆盖项数排（无覆盖 = 0），备用模型按链条数排（该列列头就叫「备用模型」，注释与卡头不再用「兜底」）。 */
const { sortState: covSortState, toggle: toggleCovSort, sortRows: sortCovRows } = useTableSort<Row>({
  accessors: {
    skill: (r) => r.skillId,
    source: (r) => r.source,
    model: (r) => r.model || '未配置',
    params: (r) => (r.paramOverrides ? Object.keys(r.paramOverrides).length : 0),
    fallback: (r) => r.fallbackChain?.length ?? 0
  },
  storageKey: 'wf_skc_sort'
})
/** 参数覆盖单元格：只给项数（原文在 title）；整串 JSON 在列里读不出「覆盖了几项」 */
function overrideText(p: Record<string, number> | null): string {
  const n = p ? Object.keys(p).length : 0
  return n ? `${n} 项参数` : '—'
}
const sortedRows = computed(() => sortCovRows(rows.value))
const visibleRows = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return sortedRows.value.filter((r) => {
    if (sourceFilter.value !== 'all' && r.source !== sourceFilter.value) return false
    if (onlyFallback.value && !(r.fallbackChain && r.fallbackChain.length)) return false
    if (!q) return true
    return [r.skillId, r.model, r.endpoint].some((v) => typeof v === 'string' && v.toLowerCase().includes(q))
  })
})
const loading = ref(false)
const selected = ref<string[]>([])
const bulk = ref({ endpoint: '', apiKey: '', model: '' })
const bulkSaving = ref(false)
const bulkMsg = ref('')
const bulkErr = ref(false)
/** 列表加载失败（#92）：与「套用失败」分开——此前共用一个 bulkErr，
    加载失败时 endpoint/apiKey 被染红（用户什么都没填却被指为无效） */
const loadErr = ref('')

/** axios 错误文本归一（unknown 收窄；管理端错误体 {error:{message}}） */
function httpErrText(e: unknown): string {
  const err = e as { response?: { data?: { error?: { message?: string } } }; message?: string }
  return err?.response?.data?.error?.message || err?.message || String(e)
}

/* 全选只作用于当前可见（筛选后）的行：否则「筛出 3 行、点全选」会静默选上全部 32 个。
   取消全选也只撤可见行，筛选外的已选项保留。 */
const allChecked = computed(() => visibleRows.value.length > 0 && visibleRows.value.every((r) => selected.value.includes(r.skillId)))
/** 部分选中（可见行里有选中的且未全选）：全选框呈 indeterminate，用户才看得出「已选 M/N」 */
const someChecked = computed(() => visibleRows.value.some((r) => selected.value.includes(r.skillId)) && !allChecked.value)

function toggleAll(on: boolean) {
  const ids = visibleRows.value.map((r) => r.skillId)
  selected.value = on
    ? Array.from(new Set([...selected.value, ...ids]))
    : selected.value.filter((id) => !ids.includes(id))
}

async function load() {
  loading.value = true
  loadErr.value = ''
  try {
    const res = await adminSkillsApi.getSkillModelCoverage()
    const data = res.data?.data as { skills?: Row[] } | undefined
    rows.value = data?.skills || []
  } catch (e) {
    loadErr.value = httpErrText(e)
    rows.value = []
  } finally {
    loading.value = false
  }
}

async function applyBulk() {
  if (bulkSaving.value || !selected.value.length) return
  // 空 endpoint/apiKey 会把所选技能的通道与密钥覆写成空串（静默清掉已配的独立通道，
  // 正是本卡开头那句「未配置 = 走平台默认」的同型事故）。这里显式拦住并给出原因。
  const endpoint = bulk.value.endpoint.trim()
  const apiKey = bulk.value.apiKey.trim()
  if (!endpoint || !apiKey) {
    bulkErr.value = true
    bulkMsg.value = `请先填写 ${!endpoint ? 'endpoint' : ''}${!endpoint && !apiKey ? ' 与 ' : ''}${!apiKey ? 'apiKey' : ''}：留空提交会把所选技能的通道/密钥清空。`
    return
  }
  const ok = await askConfirm({
    title: '批量套用通道配置',
    message: `将把 endpoint 与 apiKey 覆盖到选中的 ${selected.value.length} 个技能（model 留空则不覆盖）。\n这会替换这些技能已有的独立通道与密钥，且不可撤销。确定继续？`,
    confirmText: '覆盖套用',
    busy: true,
  })
  if (!ok) return
  bulkSaving.value = true
  bulkMsg.value = ''
  bulkErr.value = false
  try {
    const res = await adminSkillsApi.bulkApplySkillModelConfig({
      skillIds: selected.value,
      endpoint,
      apiKey,
      model: bulk.value.model.trim() || undefined,
      tier: 'chat',
    })
    const data = res.data?.data as { applied?: number; failed?: number; results?: Array<{ skillId: string; ok: boolean; error?: string }> } | undefined
    const failed = (data?.results || []).filter(r => !r.ok)
    const applied = data?.applied ?? 0
    bulkErr.value = failed.length > 0
    // 结果句拆成「已套用 N 个 / 失败 M 个」两个可读片段（读屏也拿得到唯一反馈）
    bulkMsg.value = failed.length
      ? `已套用 ${applied} 个，失败 ${failed.length} 个：${failed.map(f => `${f.skillId}（${f.error}）`).join('；')}`
      : `已套用 ${applied} 个，全部成功`
    await load()
    // 通知宿主重拉 coverage（#93）：上方路由表与四张 KPI 同屏跟随
    emit('applied')
  } catch (e) {
    bulkErr.value = true
    bulkMsg.value = `套用失败：${httpErrText(e)}`
  } finally {
    bulkSaving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
/* 卡体：与 mk-card__head 的 16px 内边距同档 */
.skc { display: grid; }
.skc__body { display: grid; gap: var(--mk-space-3); padding: var(--mk-space-4); }
/* 原型 .note：说明行（surface-2 底 + muted 小字） */
.note {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface-2);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
}
.note b { color: var(--mk-ink); }
.note--bad { background: var(--mk-red-bg); color: var(--mk-red); }
/* 筛选行：pills 与动作同一节奏 */
.skc__filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.skc__name { font-family: inherit; text-align: left; }
.skc__model { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.skc__model-id { overflow-wrap: break-word; }
/* model 列给下限：表格 auto 布局在卡片里会把这一列压到 20px，模型 ID 被拆成一字一行 */
.skc__table th:nth-child(4),
.skc__table td:nth-child(4) { min-width: 220px; }
.skc__apply { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.skc__apply .mk-input { max-width: 280px; }
.skc__apply .is-err { border-color: var(--mk-red); }
/* 原型 .tbl td.wrap：长文本列（参数覆盖 / 备用模型链）换行不截断 */
.skc__table th.skc__wrap,
.skc__table td.skc__wrap { white-space: normal; overflow-wrap: anywhere; min-width: 220px; max-width: 320px; }
</style>
