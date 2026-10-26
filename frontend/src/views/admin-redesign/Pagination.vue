<template>
  <div v-if="!hidden" ref="rootEl" class="mk-pagination">
    <!-- 信息行 = 原型 .pager__info 口径（newui pager()）：「共 N 条 · 第 P / T 页」恒显、
         muted 弱化色、tabular-nums，不再加粗当前页。showTotal 保留为兼容 prop（12 个页面在传），
         原「共 N 条」前缀开关已并入恒显口径。
         2026-10-18：单位可换（默认「条」）——列表数的是「人」时直接写「位学习者」，
         不再另起一句解释「行数=学习者数、全部会话=会话数」。
         P3-28（设计评审）：撤「每页 S 条」段——与右侧「S条/页」下拉同屏复读同事实，
         条数口径单源留在下拉（aria-label 已有「每页条数」）。 -->
    <span class="pagination-left">
      <span class="mk-pagination__total">
        共 {{ total }} {{ unit }} · 第 {{ page }} / {{ totalPages }} 页
      </span>
      <!-- 口径说明（可选，如「在当前页内搜索」「全部活跃 93 条」）：与 total 同组，弱化补充，不占按钮区。
           2026-10-18 用户走查「这类文案」：只放「这个数是什么范围」，不放系统怎么把数据拼起来的自述 -->
      <span v-if="note" class="pagination-note">{{ note }}</span>
    </span>
    <span class="mk-pagination__right">
      <select
        v-if="!hideSize"
        class="mk-pagination__size mono"
        :value="pageSize"
        :disabled="loading"
        aria-label="每页条数"
        @change="onSizeChange"
      >
        <option v-for="s in sizeOptions" :key="s" :value="s">{{ s }}条/页</option>
      </select>
      <div class="mk-pagination__nav">
        <button
          type="button"
          class="mk-pagination__btn"
          :disabled="page <= 1 || totalPages <= 1 || loading"
          @click="$emit('update:page', page - 1)"
        >
          上一页
        </button>
        <template v-for="(n, i) in pageItems" :key="i">
          <span v-if="n === '…'" class="mk-pagination__ellipsis" aria-hidden="true">…</span>
          <button
            v-else
            type="button"
            class="mk-pagination__num"
            :class="{ 'mk-pagination__num--active': n === page }"
            :disabled="loading || total === 0"
            :aria-current="n === page ? 'page' : undefined"
            :aria-label="`第 ${n} 页`"
            @click="$emit('update:page', n)"
          >
            {{ n }}
          </button>
        </template>
        <button
          type="button"
          class="mk-pagination__btn"
          :disabled="page >= totalPages || totalPages <= 1 || loading"
          @click="$emit('update:page', page + 1)"
        >
          下一页
        </button>
      </div>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { totalPagesOf } from './live'

const props = withDefaults(
  defineProps<{
    page: number
    total: number
    pageSize: number
    loading?: boolean
    showTotal?: boolean
    /** 固定每页行数场景（如字段路由表 15 行/页）：隐藏每页条数下拉，页码器形态不变 */
    hideSize?: boolean
    sizes?: number[]
    /** 总数单位（默认「条」）：列表数的是「人」时传「位学习者」，把口径放进计数本身 */
    unit?: string
    /** 附加口径说明（如「在当前页内搜索」）：显示在总数右侧，弱化文本；装配自述（谁并入谁）不属于此列 */
    note?: string
    /** 只有一页时整条自隐（默认 false：total=0 也常驻「共 0 条 · 第 1 / 1 页」） */
    hideWhenSinglePage?: boolean
  }>(),
  {
    loading: false,
    showTotal: false,
    hideSize: false,
    sizes: () => [15, 30, 50, 100],
    unit: '条',
    note: '',
    hideWhenSinglePage: false
  }
)

const emit = defineEmits<{
  'update:page': [page: number]
  'update:pageSize': [size: number]
}>()

const totalPages = computed(() => totalPagesOf(props.total, props.pageSize))
/* 单页自隐：仅当调用方显式要求（hideWhenSinglePage）且 totalPages===1 时整条不渲染。
   total=0 时 totalPages 仍为 1，但调用方没传 hideWhenSinglePage 就常驻空计数行。 */
const hidden = computed(() => props.hideWhenSinglePage && totalPages.value === 1)

/* 翻页后列表回到顶部（2026-10-22 走查）：fill 卡内的 .mk-table-scroll 自带纵向滚动，
   换页后仍停在上一次的 scrollTop（实测 400px 纹丝不动），用户落在新页中段。
   两套滚动宿主要分别复位：表格内滚容器 + 外壳（.mshell__content）滚到卡头。 */
const rootEl = ref<HTMLElement | null>(null)
watch(
  () => props.page,
  () => {
    const host = rootEl.value
    if (!host) return
    const scroller = host.closest('.mk-card')?.querySelector<HTMLElement>('.mk-table-scroll')
    if (scroller) scroller.scrollTop = 0
    const shell = host.closest<HTMLElement>('.mshell__content')
    const card = host.closest<HTMLElement>('.mk-card')
    if (shell && card && shell.scrollTop > 0) {
      const top = card.getBoundingClientRect().top + shell.scrollTop - 12
      shell.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    }
  }
)

/* 下拉选项 = 预设档位 ∪ 当前 pageSize（有序）。
   页面若把 pageSize 初始化成不在预设档里的值（如 OpsAchievements / Notifications 的 20），
   原实现 `:value="pageSize"` 找不到对应 option → 浏览器 selectedIndex=-1，下拉渲染成空白
   （首选项被显示成"已选"的假象），与表格实际行数/分页器页数三者不一致（F5-2）。
   补进当前值后：下拉显示真实每页条数，且不改变既有 15/30/50/100 档位口径。 */
const sizeOptions = computed(() => {
  const set = new Set(props.sizes)
  set.add(props.pageSize)
  return [...set].sort((a, b) => a - b)
})

/* 页码按钮序列（AntD 风格折叠）：≤7 页全显；>7 页显示 1 … p-1 p p+1 … N */
const pageItems = computed<(number | '…')[]>(() => {
  const n = totalPages.value
  const p = props.page
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1)
  const around = [p - 1, p, p + 1].filter((x) => x > 1 && x < n)
  const items: (number | '…')[] = [1]
  if (around[0] > 2) items.push('…')
  items.push(...around)
  if (around[around.length - 1] < n - 1) items.push('…')
  items.push(n)
  return items
})

function onSizeChange(e: Event) {
  emit('update:pageSize', Number((e.target as HTMLSelectElement).value))
}

/* 自动收敛越界页码：自动刷新/数据变化导致 total 缩小、当前页超出总页数时，
   回落到最后一页（父组件收到 update:page 后重查），避免停在「第 5 / 3 页」 */
watch(
  () => [props.page, props.total, props.pageSize],
  () => {
    const real = totalPagesOf(props.total, props.pageSize)
    if (props.page > real) emit('update:page', real)
  },
  { immediate: true }
)
</script>

<style scoped>
/* 口径源：newui/UI-分支优化设计 index.html 头部 <style> 的 .pager / .pager__info / .pager__btn。
   收口点：foot 内边距 8×16（原型 .card__foot）、主缝 8px（--sp-2）、钮 30×30 + r-sm、
   hover 只动描边与字色（不铺底）、禁用 = opacity .45、当前页 = brand 实心底白字。 */
.mk-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid var(--mk-line);
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
.mk-pagination__total {
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* 左侧信息组：总数字 + 可选口径说明（如「全部活跃 93 条」）同组排布 */
.pagination-left {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
}
.pagination-note {
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
  white-space: nowrap;
}
.mk-pagination__right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.mk-pagination__size {
  padding: 4px 8px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  cursor: pointer;
  transition: border-color 0.12s;
}
.mk-pagination__size:hover { border-color: color-mix(in srgb, var(--mk-blue) 40%, transparent); }
.mk-pagination__nav {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mk-pagination__btn,
.mk-pagination__num {
  min-width: 30px;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface);
  color: var(--mk-ink);
  font: inherit;
  font-size: var(--mk-fs-micro);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.12s, color 0.12s;
}
/* 原型 hover 只染描边（brand 40% 混线）与字色，不铺底；hover 媒体查询防触屏粘底 */
@media (hover: hover) {
  .mk-pagination__btn:hover:not(:disabled),
  .mk-pagination__num:hover:not(:disabled):not(.mk-pagination__num--active) {
    border-color: color-mix(in srgb, var(--mk-blue) 40%, var(--mk-line));
    color: var(--mk-blue);
  }
}
.mk-pagination__btn:disabled,
.mk-pagination__num:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
/* 当前页码：brand 实心底 + on-brand 白字（原型 .pager__btn[aria-current] 形态） */
.mk-pagination__num--active {
  background: var(--mk-blue-fill);
  border-color: var(--mk-blue-fill);
  color: var(--mk-on-fill);
}
.mk-pagination__ellipsis {
  min-width: 22px;
  text-align: center;
  color: var(--mk-faint);
  user-select: none;
}

/* 大屏/4K 适配（全站 mk 体系档位） */
@media (min-width: 2000px) {
  .mk-pagination { font-size: var(--mk-fs-micro); gap: 12px; padding: 10px 18px; }
  .mk-pagination__total { font-size: var(--mk-fs-micro); }
  .mk-pagination__size { font-size: var(--mk-fs-micro); padding: 5px 10px; border-radius: var(--mk-radius-sm); }
  .mk-pagination__btn, .mk-pagination__num { font-size: var(--mk-fs-micro); min-width: 32px; height: 32px; padding: 0 10px; }
}
@media (min-width: 3600px) {
  .mk-pagination { font-size: var(--mk-fs-micro); }
  .mk-pagination__total { font-size: var(--mk-fs-micro); }
  .mk-pagination__size { font-size: var(--mk-fs-micro); }
  .mk-pagination__btn { font-size: var(--mk-fs-micro); }
}
</style>
