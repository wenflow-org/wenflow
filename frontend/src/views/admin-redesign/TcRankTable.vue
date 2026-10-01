<template>
  <div class="tc-table" :class="`tc-table--${variant}`" role="table" :aria-label="`${nameLabel}维度调用排行`">
    <!-- 表头：与行共用同一列模板，保证列对齐；ARIA 表格语义让列标题可被读屏播报 -->
    <div class="tc-table__head" role="row">
      <span class="tc-c tc-c--rk" role="columnheader">#</span>
      <span class="tc-c tc-c--name" role="columnheader">{{ nameLabel }}</span>
      <span class="tc-c tc-c--num" role="columnheader">调用</span>
      <span class="tc-c tc-c--num" role="columnheader">失败</span>
      <span v-if="variant === 'skill'" class="tc-c tc-c--num" role="columnheader">平均/次</span>
      <span class="tc-c tc-c--tok" role="columnheader">Token 用量</span>
      <span class="tc-c tc-c--share" role="columnheader">占比</span>
    </div>

    <div
      v-for="(r, i) in items"
      :key="r.key"
      class="tc-table__row"
      role="row"
      :title="rowTitle(r)"
    >
      <!-- 排名徽章：1/2/3 实心蓝（前三），其余中性 -->
      <span class="tc-c tc-c--rk" role="cell">
        <i class="tc-rank__no" :class="{ 'tc-rank__no--top': i < 3 }">{{ i + 1 }}</i>
      </span>

      <!-- 名称列（各维度形态不同） -->
      <div class="tc-c tc-c--name" role="cell">
        <template v-if="variant === 'user'">
          <MkCellAvatar :name="r.name || r.key" />
          <span class="tc-c__main">
            <strong :title="r.name || r.key">{{ r.name || shortId(r.key) }}</strong>
            <em class="tc-c__sub" :title="r.email || r.key">
              {{ r.email || (r.name ? shortId(r.key) : '') }}
            </em>
          </span>
        </template>
        <template v-else>
          <span class="tc-c__main">
            <strong :title="r.display || r.key">{{ r.display || r.key }}</strong>
            <em v-if="r.key && r.display && r.key !== r.display" class="tc-c__sub" :title="r.key">{{ r.key }}</em>
          </span>
        </template>
      </div>

      <span class="tc-c tc-c--num tc-num" role="cell">{{ r.calls }}</span>

      <!-- 失败：红字 + 失败率小注；0 弱化 -->
      <span class="tc-c tc-c--num" :class="r.failed > 0 ? 'tc-fail--bad' : 'tc-fail--ok'" role="cell">
        {{ r.failed > 0 ? r.failed : '0' }}<em v-if="r.failed > 0" class="tc-c__sub">{{ failRate(r) }}</em>
      </span>

      <span v-if="variant === 'skill'" class="tc-c tc-c--num tc-num tc-avg" role="cell">{{ avgPerCall(r) }}</span>

      <!-- Token 用量：主值 + prompt·completion 拆分 -->
      <div class="tc-c tc-c--tok" role="cell">
        <strong class="tc-num">{{ fmtTokens(r.tokens) }}</strong>
        <em class="tc-c__sub">prompt {{ fmtTokens(r.promptTokens) }}<template v-if="(r.completionTokens ?? 0) > 0"> · comp {{ fmtTokens(r.completionTokens) }}</template></em>
      </div>

      <!-- 占比：迷你进度条（mk-minibar 原语，替代页内自搓渐变条）+ 百分比 -->
      <div class="tc-c tc-c--share" role="cell">
        <span class="mk-minibar tc-share__bar"><span class="mk-minibar__fill" :style="{ width: shareW(r.tokens) }"></span></span>
        <span class="tc-share__num">{{ sharePct(r.tokens) }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
export interface RankRow {
  key: string
  display: string
  tokens: number
  promptTokens?: number
  completionTokens?: number
  calls: number
  failed: number
  name?: string | null
  email?: string | null
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import MkCellAvatar from '@/components/mk/MkCellAvatar.vue'

const props = withDefaults(
  defineProps<{
    items: RankRow[]
    /** skill = 全宽大表（多一列平均/次）；user/model = 半宽侧表 */
    variant: 'skill' | 'user' | 'model'
    totalTokens: number
  }>(),
  { totalTokens: 0 }
)

const nameLabel = computed(() =>
  props.variant === 'skill' ? 'Skill 名称' : props.variant === 'user' ? '用户' : '模型'
)

function fmtTokens(n: number | undefined): string {
  if (!Number.isFinite(n as number) || !n || n <= 0) return '0'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

function shortId(id: string): string {
  if (!id) return '—'
  return id.length > 18 ? `${id.slice(0, 12)}…${id.slice(-4)}` : id
}

function shareW(tokens: number): string {
  const p = sharePctNum(tokens)
  return `${Math.max(p > 0 ? 3 : 0, p)}%`
}
function sharePct(tokens: number): string {
  const p = sharePctNum(tokens)
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`
}
function sharePctNum(tokens: number): number {
  if (!props.totalTokens || tokens <= 0) return 0
  return (tokens / props.totalTokens) * 100
}

function failRate(r: RankRow): string {
  if (!r.calls || r.failed <= 0) return ''
  return `${Math.round((r.failed / r.calls) * 100)}%`
}

function avgPerCall(r: RankRow): string {
  if (!r.calls) return '—'
  return fmtTokens(r.tokens / r.calls)
}

function rowTitle(r: RankRow): string {
  const label = props.variant === 'user' ? (r.name || r.key) : (r.display || r.key)
  const parts = [label, `${r.calls} 次调用`, `失败 ${r.failed}`]
  if (r.promptTokens || r.completionTokens) {
    parts.push(`prompt ${fmtTokens(r.promptTokens)} · completion ${fmtTokens(r.completionTokens)}`)
  }
  return parts.join(' · ')
}
</script>

<style scoped>
/* —— 排行表 —— */
.tc-table {
  display: flex;
  flex-direction: column;
  padding: 2px 14px 0;
}
.tc-table__head,
.tc-table__row {
  display: grid;
  align-items: center;
  gap: 10px;
}
/* skill = 全宽大表；user/model = 半宽侧表（统一列模板，跨卡对齐）。
   skill 表卡片 1638px：名称/数字列全按 fr 比例摊余量——原「名称 1fr 独吃」在宽卡下
   名称列撑到 ~1100px，右侧五个定宽数字列全挤在 530px 里（用户实测「后面挤起来了」）。 */
.tc-table--skill .tc-table__head,
.tc-table--skill .tc-table__row {
  grid-template-columns:
    28px
    minmax(140px, 1.2fr)
    minmax(56px, 0.6fr)
    minmax(48px, 0.5fr)
    minmax(64px, 0.7fr)
    minmax(150px, 1.3fr)
    minmax(100px, 0.9fr);
}
/* user/model 半宽侧表：原「名称 1fr 独吃 + Token 固定 112px」——Token 副行
   （prompt X · comp Y）实测宽 183px，溢出列宽 71px 压到「失败」列上（用户实测「挤着」）。
   名称与 Token 双 fr 摊分：名称足够放邮箱（~178px），Token 放得下 183px 副行。 */
.tc-table--user .tc-table__head,
.tc-table--user .tc-table__row,
.tc-table--model .tc-table__head,
.tc-table--model .tc-table__row {
  grid-template-columns: 26px minmax(140px, 1fr) 52px 46px minmax(180px, 1fr) 100px;
}

/* 表头 */
.tc-table__head {
  padding: 7px 0 6px;
  border-bottom: 1px solid var(--mk-line);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--mk-faint);
}

/* 行（分隔线/hover 走 mk-table 同套 token，与原型 .tbl tbody 行语言一致） */
.tc-table__row {
  padding: 7px 0;
  border-bottom: 1px solid var(--mk-table-row-line);
  transition: background 0.12s;
}
.tc-table__row:last-child { border-bottom: none; }
.tc-table__row:hover { background: var(--mk-table-row-hover-bg); }

.tc-c { min-width: 0; }
.tc-c--num { text-align: right; }
.tc-c--tok {
  text-align: right;
  /* 主值 + prompt·comp 拆分必须两行堆叠：原靠 128px 定宽被迫换行，
     列宽按 fr 摊开后装得下就横排成「48.7Mprompt 47.0M · comp 1.7M」 */
  display: grid;
  gap: 1px;
  justify-items: end;
}
.tc-c--share {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 40px;
  align-items: center;
  gap: 8px;
}

/* 排名徽章 */
.tc-rank__no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  font-style: normal;
  color: var(--mk-faint);
  background: var(--mk-surface-3);
  font-variant-numeric: tabular-nums;
}
.tc-rank__no--top { background: var(--mk-blue-bg); color: var(--mk-blue); }

/* 名称列 */
.tc-c--name { display: flex; align-items: center; gap: 9px; }
.tc-c__main { display: grid; gap: 1px; min-width: 0; }
.tc-c__main strong {
  display: block;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tc-c__sub {
  font-style: normal;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  font-family: var(--mk-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* max-width 必须显式给：作为 grid/flex 子项时 auto 宽度取 min-content，
     长于列宽的元素会溢出列（overflow:hidden 对自身超宽的元素无效），
     2026-09-29 实测 Token 副行 183px 在 112px 列里压到「失败」列 */
  max-width: 100%;
}


/* 数字 */
.tc-num {
  font-family: var(--mk-mono);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--mk-ink);
  white-space: nowrap;
  font-size: var(--mk-fs-micro);
}
.tc-avg { color: var(--mk-muted); font-weight: 600; }

/* 失败列 */
.tc-fail--bad { color: var(--mk-red); font-weight: 800; font-size: var(--mk-fs-micro); }
.tc-fail--bad .tc-c__sub { color: var(--mk-red); opacity: 0.75; }
.tc-fail--ok { color: var(--mk-faint); font-weight: 600; }

/* 占比条：走 mk-minibar 原语（轨道底/品牌蓝填充/暗色档由原语 token 接管），
   原页内渐变条（.tc-share__track/__bar 自搓 + 双暗色补丁）已删 */
.tc-share__num {
  text-align: right;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 4K 档：跟随全站节奏 */
@media (min-width: 2000px) {
  .tc-table { padding: 2px 16px 0; }
  .tc-c__main strong, .tc-num, .tc-fail--bad { font-size: var(--mk-fs-body); }
  .tc-c__sub { font-size: var(--mk-fs-micro); }
  .tc-rank__no { width: 22px; height: 22px; font-size: var(--mk-fs-micro); }
  .tc-share__bar { height: 7px; }
  .tc-share__num { font-size: var(--mk-fs-micro); }
  /* MkCellAvatar 根节点（scoped 可命中子组件根）：排行表紧凑尺寸 + 大屏三档缩放 */
  .mk-ava { width: 22px; height: 22px; font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .tc-c__main strong, .tc-num, .tc-fail--bad { font-size: var(--mk-fs-micro); }
  .tc-c__sub { font-size: var(--mk-fs-micro); }
  .tc-rank__no { width: 26px; height: 26px; font-size: var(--mk-fs-micro); border-radius: var(--mk-radius-sm); }
  .tc-share__bar { height: 8px; }
  .tc-share__num { font-size: var(--mk-fs-micro); }
  .mk-ava { width: 28px; height: 28px; font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  .tc-c__main strong, .tc-num, .tc-fail--bad { font-size: var(--mk-fs-emphasis); }
  .tc-c__sub { font-size: var(--mk-fs-body); }
  .tc-rank__no { width: 30px; height: 30px; font-size: var(--mk-fs-micro); }
  .tc-share__bar { height: 10px; }
  .tc-share__num { font-size: var(--mk-fs-body); }
  .mk-ava { width: 32px; height: 32px; font-size: var(--mk-fs-micro); }
}
</style>
