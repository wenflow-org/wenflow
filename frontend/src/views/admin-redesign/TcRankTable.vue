<template>
  <div class="tc-table" :class="`tc-table--${variant}`">
    <!-- 表头：与行共用同一列模板，保证列对齐 -->
    <div class="tc-table__head" aria-hidden="true">
      <span class="tc-c tc-c--rk">#</span>
      <span class="tc-c tc-c--name">{{ nameLabel }}</span>
      <span class="tc-c tc-c--num">调用</span>
      <span class="tc-c tc-c--num">失败</span>
      <span v-if="variant === 'skill'" class="tc-c tc-c--num">平均/次</span>
      <span class="tc-c tc-c--tok">Token 用量</span>
      <span class="tc-c tc-c--share">占比</span>
    </div>

    <div
      v-for="(r, i) in items"
      :key="r.key"
      class="tc-table__row"
      :title="rowTitle(r)"
    >
      <!-- 排名徽章：1/2/3 实心蓝（前三），其余中性 -->
      <span class="tc-c tc-c--rk">
        <i class="tc-rank__no" :class="{ 'tc-rank__no--top': i < 3 }">{{ i + 1 }}</i>
      </span>

      <!-- 名称列（各维度形态不同） -->
      <div class="tc-c tc-c--name">
        <template v-if="variant === 'user'">
          <i class="tc-avatar" aria-hidden="true">{{ avatarChar(r) }}</i>
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

      <span class="tc-c tc-c--num tc-num">{{ r.calls }}</span>

      <!-- 失败：红字 + 失败率小注；0 弱化 -->
      <span class="tc-c tc-c--num" :class="r.failed > 0 ? 'tc-fail--bad' : 'tc-fail--ok'">
        {{ r.failed > 0 ? r.failed : '0' }}<em v-if="r.failed > 0" class="tc-c__sub">{{ failRate(r) }}</em>
      </span>

      <span v-if="variant === 'skill'" class="tc-c tc-c--num tc-num tc-avg">{{ avgPerCall(r) }}</span>

      <!-- Token 用量：主值 + prompt·completion 拆分 -->
      <div class="tc-c tc-c--tok">
        <strong class="tc-num">{{ fmtTokens(r.tokens) }}</strong>
        <em class="tc-c__sub">prompt {{ fmtTokens(r.promptTokens) }}<template v-if="(r.completionTokens ?? 0) > 0"> · comp {{ fmtTokens(r.completionTokens) }}</template></em>
      </div>

      <!-- 占比：细条 + 百分比 -->
      <div class="tc-c tc-c--share">
        <i class="tc-share__track"><b class="tc-share__bar" :style="{ width: shareW(r.tokens) }"></b></i>
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

function avatarChar(r: RankRow): string {
  const src = (r.name || r.key || '?').trim()
  if (!src) return '?'
  // 优先取中文/英文首字符，数字用户回退 key 前两位
  const ch = src[0]
  return /^[0-9a-zA-Z\u4e00-\u9fa5]$/.test(ch) ? ch.toUpperCase() : '?'
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
/* skill = 全宽大表；user/model = 半宽侧表（统一列模板，跨卡对齐） */
.tc-table--skill .tc-table__head,
.tc-table--skill .tc-table__row {
  grid-template-columns: 28px minmax(0, 1fr) 58px 56px 84px 128px 118px;
}
.tc-table--user .tc-table__head,
.tc-table--user .tc-table__row,
.tc-table--model .tc-table__head,
.tc-table--model .tc-table__row {
  grid-template-columns: 26px minmax(0, 1fr) 52px 46px 112px 100px;
}

/* 表头 */
.tc-table__head {
  padding: 7px 0 6px;
  border-bottom: 1px solid var(--mk-line);
  font-size: var(--mk-fs-11);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mk-faint);
}

/* 行 */
.tc-table__row {
  padding: 7px 0;
  border-bottom: 1px solid #eef1f7;
  transition: background 0.12s;
}
.tc-table__row:last-child { border-bottom: none; }
.tc-table__row:hover { background: #f6f9ff; }
html[data-theme='dark'] .tc-table__row { border-bottom-color: #1f2a3d; }
html[data-theme='dark'] .tc-table__row:hover { background: #1a2436; }

.tc-c { min-width: 0; }
.tc-c--num { text-align: right; }
.tc-c--tok { text-align: right; }
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
  font-size: var(--mk-fs-11);
  font-weight: 700;
  font-style: normal;
  color: var(--mk-faint);
  background: #f0f2f5;
  font-variant-numeric: tabular-nums;
}
.tc-rank__no--top { background: var(--mk-blue-bg); color: var(--mk-blue); }
html[data-theme='dark'] .tc-rank__no { background: #253049; color: var(--mk-muted); }
html[data-theme='dark'] .tc-rank__no--top { background: rgba(91, 141, 239, 0.2); color: #9db8f5; }

/* 名称列 */
.tc-c--name { display: flex; align-items: center; gap: 9px; }
.tc-c__main { display: grid; gap: 1px; min-width: 0; }
.tc-c__main strong {
  display: block;
  font-size: var(--mk-fs-12_5);
  font-weight: 600;
  color: var(--mk-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tc-c__sub {
  font-style: normal;
  font-size: var(--mk-fs-11);
  color: var(--mk-faint);
  font-family: var(--mk-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 用户头像圆片 */
.tc-avatar {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--mk-fs-11);
  font-weight: 800;
  font-style: normal;
  background: var(--mk-blue-bg);
  color: var(--mk-blue);
}

/* 数字 */
.tc-num {
  font-family: var(--mk-mono);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--mk-ink);
  white-space: nowrap;
  font-size: var(--mk-fs-12_5);
}
.tc-avg { color: var(--mk-muted); font-weight: 600; }

/* 失败列 */
.tc-fail--bad { color: var(--mk-red); font-weight: 800; font-size: var(--mk-fs-12_5); }
.tc-fail--bad .tc-c__sub { color: var(--mk-red); opacity: 0.75; }
.tc-fail--ok { color: var(--mk-faint); font-weight: 600; }

/* 占比条 */
.tc-share__track {
  display: block;
  height: 6px;
  border-radius: 999px;
  background: var(--mk-line);
  overflow: hidden;
}
.tc-share__bar {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #6fa1f5, var(--mk-accent-deep));
}
html[data-theme='dark'] .tc-share__track { background: #232f45; }
html[data-theme='dark'] .tc-share__bar { background: linear-gradient(90deg, #6fa1f5, #2f6fed); }
.tc-share__num {
  text-align: right;
  font-size: var(--mk-fs-11);
  font-weight: 700;
  color: var(--mk-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 4K 档：跟随全站节奏 */
@media (min-width: 2000px) {
  .tc-table { padding: 2px 16px 0; }
  .tc-c__main strong, .tc-num, .tc-fail--bad { font-size: 14px; }
  .tc-c__sub { font-size: 12px; }
  .tc-rank__no { width: 22px; height: 22px; font-size: 12px; }
  .tc-share__track { height: 7px; }
  .tc-share__num { font-size: 12px; }
  .tc-avatar { width: 24px; height: 24px; font-size: 12px; }
}
@media (min-width: 2800px) {
  .tc-c__main strong, .tc-num, .tc-fail--bad { font-size: 16px; }
  .tc-c__sub { font-size: 14px; }
  .tc-rank__no { width: 26px; height: 26px; font-size: 14px; border-radius: 7px; }
  .tc-share__track { height: 8px; }
  .tc-share__num { font-size: 14px; }
  .tc-avatar { width: 28px; height: 28px; font-size: 14px; }
}
@media (min-width: 3600px) {
  .tc-c__main strong, .tc-num, .tc-fail--bad { font-size: 19px; }
  .tc-c__sub { font-size: 16.5px; }
  .tc-rank__no { width: 30px; height: 30px; font-size: 16px; }
  .tc-share__track { height: 10px; }
  .tc-share__num { font-size: 16.5px; }
  .tc-avatar { width: 32px; height: 32px; font-size: 16px; }
}
</style>
