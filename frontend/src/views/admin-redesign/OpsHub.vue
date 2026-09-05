<template>
  <div class="mk-page">
    <div class="mk-status" :class="(wbFailedPaths > 0 || wbDeadLetters > 0) ? 'mk-status--warn' : 'mk-status--ok'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">运营中心</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">待处理反馈 {{ wbPendingFeedback }}</span>
      <span class="mk-status__meta" :class="wbFailedPaths > 0 ? 'mk-status__meta--bad' : ''">失败路径 {{ wbFailedPaths }}</span>
      <span class="mk-status__meta" :class="wbDeadLetters > 0 ? 'mk-status__meta--bad' : ''">死信 {{ wbDeadLetters }}</span>
      <span class="mk-status__meta">公告 {{ ann.rows }} 条</span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" :disabled="wbLoading" @click="refreshAll">
          {{ wbLoading ? '刷新中…' : '刷新' }}
        </button>
      </span>
    </div>

    <!-- 运营待办（全宽：按严重度排序的行动清单，非统计卡） -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h4 class="mk-card__title">运营待办</h4>
        <span class="mk-card__meta">按优先级排序 · 点击直达对应页面</span>
      </div>
      <div class="ow-todo-list">
        <button
          v-for="t in todoItems"
          :key="t.key"
          type="button"
          class="ow-todo"
          :class="[`ow-todo--${t.severity}`, { 'ow-todo--done': t.count === 0 }]"
          :title="t.count > 0 ? t.hint : '该事项已清零'"
          @click="t.action"
        >
          <i class="ow-todo__dot" aria-hidden="true"></i>
          <span class="ow-todo__main">
            <strong class="ow-todo__label">{{ t.label }}</strong>
            <em class="ow-todo__hint">{{ t.hint }}</em>
          </span>
          <b class="ow-todo__count" :class="{ 'ow-todo__count--bad': t.count > 0 }">{{ t.count }}</b>
          <span class="ow-todo__go">{{ t.count > 0 ? '去处理 →' : '已清零' }}</span>
        </button>
      </div>
    </section>

    <!-- 状态面板：路径 / 公告并列，紧凑行式区别于 Dashboard KPI 卡 -->
    <div class="ow-panels">
      <section class="mk-card">
        <div class="mk-card__head">
          <h4 class="mk-card__title">学习路径</h4>
          <button type="button" class="mk-link" @click="goContent">管理 →</button>
        </div>
        <div class="ow-state">
          <div class="ow-state__seg" aria-hidden="true">
            <i v-for="s in pathSegments" :key="s.key" :class="`ow-seg--${s.tone}`" :style="{ width: s.pct }" :title="`${s.label} ${s.count}`"></i>
          </div>
          <div class="ow-state__rows">
            <div v-for="c in pathCards" :key="c.label" class="ow-state__row">
              <span><i class="ow-state__dot" :class="`ow-state__dot--${c.tone || 'muted'}`"></i>{{ c.label }}</span>
              <b :class="{ 'ow-state__bad': c.tone === 'bad' && Number(c.value) > 0 }">{{ c.value }}</b>
            </div>
          </div>
        </div>
      </section>
      <section class="mk-card">
        <div class="mk-card__head">
          <h4 class="mk-card__title">公告</h4>
          <button type="button" class="mk-link" @click="goAnnouncements">管理 →</button>
        </div>
        <div class="ow-state">
          <div class="ow-state__seg" aria-hidden="true">
            <i v-for="s in annSegments" :key="s.key" :class="`ow-seg--${s.tone}`" :style="{ width: s.pct }" :title="`${s.label} ${s.count}`"></i>
          </div>
          <div class="ow-state__rows">
            <div v-for="s in annSegments" :key="s.key" class="ow-state__row">
              <span><i class="ow-state__dot" :class="`ow-state__dot--${s.tone}`"></i>{{ s.label }}</span>
              <b>{{ s.count }}</b>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 生效中公告（最近发布，行动入口） -->
    <section v-if="livePublished.length" class="mk-card">
      <div class="mk-card__head">
        <h4 class="mk-card__title">生效中公告</h4>
        <button type="button" class="mk-link" @click="goAnnouncements">全部公告 →</button>
      </div>
      <div class="ow-ann-list">
        <button v-for="a in livePublished" :key="a.id" type="button" class="ow-ann" @click="goAnnouncements">
          <span class="mk-badge" :class="annBadge(a.severity)">{{ annSeverityText(a.severity) }}</span>
          <span class="ow-ann__title" :title="a.body">{{ a.title }}</span>
          <span class="ow-ann__meta">{{ a.publishedAt ? timeAgo(a.publishedAt) : '—' }}</span>
          <span class="ow-ann__go">查看 →</span>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { timeAgo, liveAnnouncements } from './live'
import { intent } from './store'
import { adminFeedbackApi, adminLearningContentApi, adminDevtoolsApi, type LearningContentStats } from '@/api/adminApi'
import { announcementCounts, segmentPct } from './opsShared'

/* ===== 运营待办：反馈待处理 / 失败路径 / 死信 / 草稿公告 ===== */
const wbPendingFeedback = ref(0)
const wbFailedPaths = ref(0)
const wbDeadLetters = ref(0)
const wbLoading = ref(false)
const stats = ref<LearningContentStats | null>(null)

async function loadWorkbench() {
  if (wbLoading.value) return
  wbLoading.value = true
  const [, , dead] = await Promise.all([
    // 待处理反馈：后端 status=new 计数（与 Feedback 页口径一致）
    adminFeedbackApi.list({ limit: 1, status: 'new' })
      .then((r) => { const d = r.data?.data ?? r.data ?? {}; wbPendingFeedback.value = Number(d.pagination?.total ?? d.total ?? 0) })
      .catch(() => { wbPendingFeedback.value = 0 }),
    // 失败路径：学习内容 stats（与内容管理页口径一致）
    adminLearningContentApi.getStats()
      .then((r) => { const s = (r.data?.data ?? r.data) as LearningContentStats | null; stats.value = s; wbFailedPaths.value = s?.byStatus?.failed ?? 0 })
      .catch(() => { wbFailedPaths.value = 0 }),
    // outbox 死信：系统工具页（原运维中心）工具 tab 同源（返回 {deadCount, items}）
    adminDevtoolsApi.getOutboxDead()
      .then((r) => {
        const d = r.data?.data as { deadCount?: number } | null | undefined
        wbDeadLetters.value = Number(d?.deadCount ?? 0)
      })
      .catch(() => { wbDeadLetters.value = 0 })
  ])
  wbLoading.value = false
  void dead
}

/* 待办清单：按严重度排序（坏>警告>中性），零值弱化为「已清零」 */
const todoItems = computed(() => [
  { key: 'feedback', label: '待处理反馈', hint: '学习者低分反馈等待分流', count: wbPendingFeedback.value, severity: 'warn' as const, action: goFeedbackPending },
  { key: 'paths', label: '生成失败路径', hint: '目标对话产出路径失败，需排查', count: wbFailedPaths.value, severity: 'bad' as const, action: goFailedPaths },
  { key: 'dead', label: 'Outbox 死信', hint: '领域事件投递失败，影响画像/成就', count: wbDeadLetters.value, severity: 'warn' as const, action: goDeadLetters },
  { key: 'draft', label: '草稿公告', hint: '已创建未发布的公告', count: ann.value.draft, severity: 'muted' as const, action: goAnnouncements },
])

/* 公告三态计数（live 层共享，与侧栏徽章同源） */
const ann = announcementCounts

/* 状态面板：路径四态 + 公告三态（比例条 + 行式计数） */
const pathSegments = computed(() =>
  segmentPct([
    { key: 'active', label: '学习中', count: stats.value?.byStatus?.active || 0, tone: 'ok' },
    { key: 'completed', label: '已完成', count: stats.value?.byStatus?.completed || 0, tone: 'info' },
    { key: 'failed', label: '生成失败', count: stats.value?.byStatus?.failed || 0, tone: 'bad' },
    { key: 'archived', label: '已下线', count: stats.value?.byStatus?.archived || 0, tone: 'muted' },
  ])
)
/* 路径状态行（原 MkKpi 色板口径：非零计数的警示态才着色） */
const pathCards = computed(() => {
  const s = stats.value?.byStatus || {}
  const failedN = s.failed || 0
  return [
    { label: '学习中', value: String(s.active || 0), tone: (s.active || 0) > 0 ? ('ok' as const) : '' },
    { label: '已完成', value: String(s.completed || 0), tone: '' },
    { label: '生成失败', value: String(failedN), tone: failedN > 0 ? ('bad' as const) : '' },
    { label: '已下线', value: String(s.archived || 0), tone: '' },
  ]
})
const annSegments = computed(() =>
  segmentPct([
    { key: 'published', label: '生效中', count: ann.value.published, tone: 'info' },
    { key: 'draft', label: '草稿', count: ann.value.draft, tone: 'warn' },
    { key: 'archived', label: '已下线', count: ann.value.archived, tone: 'muted' },
  ])
)

/* 生效中公告列表（最近发布优先） */
const livePublished = computed(() =>
  liveAnnouncements.value
    .filter((a) => a.status === 'published')
    .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))
    .slice(0, 4)
)
const annSeverityText = (s: string) => ({ info: '通知', warning: '提醒', critical: '紧急' }[s] || s)
const annBadge = (s: string) =>
  s === 'critical' ? 'mk-badge--bad' : s === 'warning' ? 'mk-badge--warn' : 'mk-badge--info'

/* ===== 跨页深链（运营组内各页均为独立场景，操作对象页唯一） ===== */
/** 待处理反馈 → 反馈中心（预筛待处理） */
function goFeedbackPending() {
  intent.scene = 'feedback'
  intent.quickAction = '' // 确保不触发其他快捷动作
  // 反馈中心无状态深链参数，直接导航；由 Feedback 页默认筛选待处理
}
/** 生成失败路径 → 学习会话页「学习路径」tab（预筛 failed，宿主消费 intent.statusFilter/tab 后清空） */
function goFailedPaths() {
  intent.statusFilter = 'failed'
  intent.tab = 'paths'
  intent.scene = 'sessions'
}
/** outbox 死信 → 系统工具页（原运维中心） */
function goDeadLetters() {
  intent.scene = 'ops-center'
}
/** 学习路径管理 → 学习会话页「学习路径」tab */
function goContent() {
  intent.tab = 'paths'
  intent.scene = 'sessions'
}
/** 公告管理页（通知与公告 · 公告 tab） */
function goAnnouncements() {
  intent.tab = 'announce'
  intent.scene = 'messages'
}
/** 手动整体刷新：待办聚合 + 公告 live 计数（公告列表由 live 层管理，此处仅触发重拉） */
async function refreshAll() {
  await loadWorkbench()
}

/* 默认进入即拉取待办聚合（公告计数由 live 层加载） */
onMounted(() => {
  void loadWorkbench()
})
</script>

<style scoped>
/* ================= 运营工作台（待办清单 + 状态面板，区别于 Dashboard 统计卡） ================= */
/* 状态面板：路径 / 公告并列（行式计数 + 比例条，非 KPI 卡） */
.ow-panels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}

/* 待办清单：行动行式（严重度圆点 + 标题/说明 + 计数 + 去处理），非统计卡 */
.ow-todo-list { padding: 2px 10px 6px; }
.ow-todo {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 8px;
  border: 0;
  border-bottom: 1px solid #eef1f7;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}
.ow-todo:last-child { border-bottom: none; }
.ow-todo:hover { background: #f6f9ff; }
html[data-theme='dark'] .ow-todo { border-bottom-color: #1f2a3d; }
html[data-theme='dark'] .ow-todo:hover { background: #1a2436; }
.ow-todo__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--mk-faint);
  flex-shrink: 0;
}
.ow-todo--bad .ow-todo__dot { background: var(--mk-red); box-shadow: 0 0 0 3px var(--mk-red-bg); }
.ow-todo--warn .ow-todo__dot { background: var(--mk-amber); box-shadow: 0 0 0 3px var(--mk-amber-bg); }
.ow-todo__main { display: grid; gap: 1px; min-width: 0; }
.ow-todo__label { font-size: var(--mk-fs-13); font-weight: 700; color: var(--mk-ink); }
.ow-todo__hint {
  font-style: normal;
  font-size: var(--mk-fs-11);
  color: var(--mk-faint);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ow-todo__count {
  font-size: var(--mk-fs-18);
  font-weight: 800;
  color: var(--mk-muted);
  font-variant-numeric: tabular-nums;
  min-width: 42px;
  text-align: right;
}
.ow-todo__count--bad { color: var(--mk-red); }
.ow-todo__go {
  font-size: var(--mk-fs-11);
  font-weight: 700;
  color: var(--mk-blue);
  white-space: nowrap;
  padding: 3px 8px;
  border-radius: 6px;
  transition: background 0.12s;
}
.ow-todo__go:hover { background: rgba(44, 99, 208, 0.08); }
/* 已清零：整体弱化 */
.ow-todo--done { cursor: default; }
.ow-todo--done .ow-todo__label, .ow-todo--done .ow-todo__count { color: var(--mk-faint); }
.ow-todo--done .ow-todo__go { color: var(--mk-green); }
.ow-todo--done:hover { background: transparent; }

/* 状态面板：比例条 + 行式计数 */
.ow-state { padding: 8px 14px 12px; display: grid; gap: 10px; }
.ow-state__seg {
  display: flex;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--mk-line);
}
.ow-state__seg i { display: block; height: 100%; min-width: 0; transition: width 0.2s ease; }
.ow-seg--ok { background: var(--mk-green); }
.ow-seg--info { background: var(--mk-blue); }
.ow-seg--warn { background: var(--mk-amber); }
.ow-seg--bad { background: var(--mk-red); }
.ow-seg--muted { background: #c3cbda; }
html[data-theme='dark'] .ow-seg--muted { background: #3b4a66; }
.ow-state__rows { display: grid; gap: 5px; }
.ow-state__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--mk-fs-12_5);
  color: var(--mk-muted);
}
.ow-state__row b {
  font-size: var(--mk-fs-14);
  font-weight: 800;
  color: var(--mk-ink);
  font-variant-numeric: tabular-nums;
}
.ow-state__bad { color: var(--mk-red) !important; }
.ow-state__dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 8px;
  vertical-align: 1px;
}
.ow-state__dot--ok { background: var(--mk-green); }
.ow-state__dot--info { background: var(--mk-blue); }
.ow-state__dot--warn { background: var(--mk-amber); }
.ow-state__dot--bad { background: var(--mk-red); }
.ow-state__dot--muted { background: #c3cbda; }
html[data-theme='dark'] .ow-state__dot--muted { background: #3b4a66; }

/* 生效中公告列表 */
.ow-ann-list { padding: 2px 14px 6px; }
.ow-ann {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 4px;
  border: 0;
  border-bottom: 1px solid #eef1f7;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}
.ow-ann:last-child { border-bottom: none; }
.ow-ann:hover { background: #f6f9ff; }
html[data-theme='dark'] .ow-ann { border-bottom-color: #1f2a3d; }
html[data-theme='dark'] .ow-ann:hover { background: #1a2436; }
.ow-ann__title {
  flex: 1;
  min-width: 0;
  font-size: var(--mk-fs-12_5);
  font-weight: 600;
  color: var(--mk-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ow-ann__meta { font-size: var(--mk-fs-11); color: var(--mk-faint); white-space: nowrap; }
.ow-ann__go { font-size: var(--mk-fs-11); font-weight: 700; color: var(--mk-blue); white-space: nowrap; }
@media (max-width: 1100px) {
  .ow-panels { grid-template-columns: 1fr; }
}

/* 4K：待办/状态行跟随全站节奏 */
@media (min-width: 2000px) {
  .ow-todo__label { font-size: 14.5px; }
  .ow-todo__hint { font-size: 12px; }
  .ow-todo__count { font-size: 20px; }
  .ow-state__row { font-size: 13.5px; }
  .ow-state__row b { font-size: 15.5px; }
  .ow-ann__title { font-size: 14px; }
  .ow-ann__meta, .ow-ann__go { font-size: 12px; }
}
@media (min-width: 2800px) {
  .ow-todo__label { font-size: 17px; }
  .ow-todo__hint { font-size: 14px; }
  .ow-todo__count { font-size: 23px; }
  .ow-state__row { font-size: 15.5px; }
  .ow-state__row b { font-size: 18px; }
  .ow-ann__title { font-size: 16.5px; }
  .ow-ann__meta, .ow-ann__go { font-size: 14px; }
}
@media (min-width: 3600px) {
  .ow-todo__label { font-size: 20px; }
  .ow-todo__hint { font-size: 16.5px; }
  .ow-todo__count { font-size: 27px; }
  .ow-state__row { font-size: 18px; }
  .ow-state__row b { font-size: 21px; }
  .ow-ann__title { font-size: 19.5px; }
  .ow-ann__meta, .ow-ann__go { font-size: 16.5px; }
}
</style>
