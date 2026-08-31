<template>
  <div class="mk-page mk-page--fill">
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">学习者中心</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ rows.length }} 位学习者</span>
      <button
        type="button"
        class="lc-count-link"
        :class="{ 'lc-count-link--on': pill === 'risk' }"
        :title="'点击筛选「需关注」学习者（趋势下降 / 疲劳中高 / 有风险）'"
        @click="pill = pill === 'risk' ? 'all' : 'risk'"
      >需关注 {{ riskCount }}</button>
      <button
        type="button"
        class="lc-count-link"
        :class="{ 'lc-count-link--on': pill === 'stale' }"
        :title="'点击筛选「低置信」学习者（快照置信度低于 50%）'"
        @click="pill = pill === 'stale' ? 'all' : 'stale'"
      >低置信 {{ lowConfCount }}</button>
      <button type="button" class="mk-status__action" :disabled="recomputingAll || !rows.length" @click="recomputeAll">
        {{ recomputingAll ? `重算中 ${recomputeProgress}/${rows.length}…` : '全部重算' }}
      </button>
    </div>


    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <div class="mk-pills">
            <button
              v-for="p in pills"
              :key="p.id"
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': pill === p.id }"
              @click="pill = p.id"
            >
              {{ p.label }}
            </button>
          </div>
          <input
            v-model="keyword"
            class="mk-filter__input"
            style="width: 200px;"
            placeholder="搜索名称 / 邮箱 / ID"
          />
        </div>
        <div class="mk-card__head-right">
          <DataScopeToggle v-if="isLive" v-model="includeTest" />
          <MkCols
            :col-defs="lcColDefs"
            storage-key="wf_learner_hidden_cols"
            v-model:hidden="lcHiddenCols"
          />
          <span class="mk-card__meta">{{ filtered.length }} / {{ rows.length }} 人</span>
        </div>
      </div>

      <MockSkeletonTable v-if="liveLoading && !rows.length" :cols="8" />
      <div v-else-if="loadFailed" class="mk-empty">
        <span class="mk-empty__icon" aria-hidden="true">◌</span>
        <strong>学习者快照加载失败</strong>
        <span>无法从后端拉取学习者状态。</span>
        <button type="button" class="mk-empty__action" @click="retryLoad">重试</button>
      </div>
      <div v-else-if="filtered.length" class="mk-table-scroll">
      <table class="mk-table">
        <colgroup>
          <col v-if="!lcHiddenCols.has('learner')" style="width:180px">
          <col v-if="!lcHiddenCols.has('progress')" style="width:35%">
          <col v-if="!lcHiddenCols.has('trend')" style="width:80px">
          <col v-if="!lcHiddenCols.has('fatigue')" style="width:60px">
          <col v-if="!lcHiddenCols.has('conf')" style="width:110px">
          <col v-if="!lcHiddenCols.has('risk')" style="width:180px">
          <col v-if="!lcHiddenCols.has('updated')" style="width:90px">
          <col style="width:var(--mk-col-actions-wide, 120px)">
        </colgroup>
        <thead>
          <tr>
            <th v-if="!lcHiddenCols.has('learner')">学习者</th>
            <th v-if="!lcHiddenCols.has('progress')">当前进度</th>
            <th v-if="!lcHiddenCols.has('trend')">趋势</th>
            <th v-if="!lcHiddenCols.has('fatigue')">疲劳</th>
            <th v-if="!lcHiddenCols.has('conf')" title="快照置信度：模型对该学习者状态的把握程度，低于 50% 为低置信">置信</th>
            <th v-if="!lcHiddenCols.has('risk')">风险摘要</th>
            <th v-if="!lcHiddenCols.has('updated')">更新</th>
            <th class="mk-col--actions-wide">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in paged" :key="r.id" class="lc-row" @click="openDetail(r)">
            <td v-if="!lcHiddenCols.has('learner')">
              <div class="mk-cell-main">
                <strong>{{ r.name }}</strong>
                <span class="mk-cell-sub">{{ r.email }}</span>
              </div>
              <span v-if="r.isTestAccount" class="mk-badge mk-badge--sm mk-badge--warn" title="虚拟学习者/测试账号不参与风险队列">测试账号</span>
            </td>
            <td v-if="!lcHiddenCols.has('progress')">
              <div class="mk-cell-main">
                <strong class="progress-title">{{ r.task || '未开始' }}</strong>
                <span class="mk-cell-sub">{{ r.path || '尚未开始学习' }}</span>
              </div>
            </td>
            <td v-if="!lcHiddenCols.has('trend')">
              <span class="lc-trend" :class="`lc-trend--${r.trend}`" :title="trendTitle(r)">
                <i class="lc-trend__arrow" aria-hidden="true">{{ r.trend === 'up' ? '↗' : r.trend === 'down' ? '↘' : '→' }}</i>
                <span class="lc-trend__bars" aria-hidden="true">
                  <i class="lc-trend__bar lc-trend__bar--1"></i>
                  <i class="lc-trend__bar lc-trend__bar--2"></i>
                  <i class="lc-trend__bar lc-trend__bar--3"></i>
                </span>
                {{ trendText(r.trend) }}
              </span>
            </td>
            <td v-if="!lcHiddenCols.has('fatigue')"><span class="mk-badge" :class="fatigueBadge(r.fatigue)">{{ r.fatigue }}</span></td>
            <td v-if="!lcHiddenCols.has('conf')" class="mk-num">
              <span
                v-if="r.confidence != null && r.task"
                class="conf"
                :class="{ 'conf--low': evidenceLowConfidence(r.confidence) }"
                :title="`置信度 ${Math.round(r.confidence * 100)}%。低于 50% 表示证据不足`"
              >
                {{ Math.round(r.confidence * 100) }}%<em v-if="evidenceLowConfidence(r.confidence)" class="conf__lack">证据不足</em>
              </span>
              <span v-else class="mk-na" :title="r.task ? '' : '尚未开始学习，暂无置信度'">—</span>
            </td>
            <td v-if="!lcHiddenCols.has('risk')" class="risk-text" :class="{ 'mk-na': !r.risk }">{{ r.risk || '—' }}</td>
            <td v-if="!lcHiddenCols.has('updated')" class="mk-na">{{ isUpdating(r.id) ? '重算中…' : r.updated }}</td>
            <td>
              <div class="mk-actions mk-actions--left">
                <button type="button" class="mk-icon-btn" title="详情" @click.stop="openDetail(r)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M6 21v-1a6 6 0 0 1 12 0v1"/></svg></button>
                <button v-if="isLive && !r.isTestAccount" type="button" class="mk-icon-btn" :class="{ 'lc-intervene--hot': isRisk(r) }" title="干预：查看会话 / 发送提醒" @click.stop="openIntervene(r)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></button>
                <button type="button" class="mk-icon-btn" :disabled="isUpdating(r.id)" :title="isUpdating(r.id) ? '重算中…' : '重算'" @click.stop="recompute(r)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg></button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>

      <div v-else class="mk-empty">
        <strong>{{ pill === 'all' ? '暂无学习者快照' : '当前分组暂无学习者' }}</strong>
        <span>{{ pill === 'all' ? '学习者产生学习行为后，快照将自动生成。' : '该风险分组暂无匹配的学习者。' }}</span>
      </div>
      <!-- 客户端分页（统一 mk-pagination 页码器）：筛选后按页切片 -->
      <Pagination
        v-if="filtered.length"
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="filtered.length"
        :showTotal="true"
      />
    </div>

    <!-- C2 干预动线：风险学习者 → 查看会话 / 发送站内提醒（对标英跃"过程管理"） -->
    <Teleport to="body">
      <div v-if="intervene" ref="interveneMask" class="mk-modal">
        <div class="mk-modal__panel" role="dialog" aria-label="学习者干预">
          <div class="mk-modal__head">
            <h3 class="mk-modal__title">干预 · {{ intervene.name }}</h3>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="intervene = null">✕</button>
          </div>
          <div class="mk-modal__body">
            <div v-if="intervene.risk" class="lc-iv__risk" :class="{ 'lc-iv__risk--hot': isRisk(intervene) }">
              <strong>风险摘要</strong>
              <span>{{ intervene.risk }}</span>
            </div>
            <div class="lc-iv__actions">
              <button type="button" class="mk-btn mk-btn--ghost" @click="goInterveneSession(intervene)">查看学习详情</button>
              <button type="button" class="mk-btn mk-btn--ghost" @click="goInterveneLogs">查看执行日志</button>
            </div>
            <label class="mk-field">
              <span class="mk-field__label">发送站内提醒 <em class="mk-field__req">*</em></span>
              <input v-model="interveneTitle" class="mk-field__input" placeholder="提醒标题，如：学习状态提醒" />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">提醒内容</span>
              <textarea v-model="interveneBody" class="mk-field__textarea" rows="3" placeholder="如：检测到疲劳度偏高，建议休息后继续学习。"></textarea>
            </label>
            <p class="lc-iv__hint">提醒将出现在该学习者的站内通知中（scope=user）。</p>
          </div>
          <div class="mk-modal__foot">
            <button type="button" class="mk-btn" @click="intervene = null">取消</button>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="interveneSending || !interveneTitle.trim()" @click="sendIntervene">
              {{ interveneSending ? '发送中…' : '发送提醒' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { openSubPage, isLive } from './store'
import { liveLearners, liveRecomputeLearner, liveSetLearnersIncludeTest, liveLoading, liveFailures, loadLiveData, timeAgo, errMsg } from './live'
import { evidenceLowConfidence } from './evidence'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import DataScopeToggle from './DataScopeToggle.vue'
import Pagination from './Pagination.vue'
import MkCols from './MkCols.vue'
import { adminNotificationsApi } from '@/api/adminApi'

interface Row {
  id: string
  name: string
  email: string
  isTestAccount?: boolean
  path: string
  task: string
  trend: 'up' | 'down' | 'flat'
  fatigue: '低' | '中' | '高'
  risk: string
  updated: string
  confidence?: number
  /** 更新时间戳（用于排序），demo 按相对时间倒推 */
  ts?: number
}

/* demo 数据已移除 — 非 live 模式返回空列表 */

const pill = ref<'all' | 'risk' | 'stale'>('all')
const keyword = ref('')
const includeTest = ref(false)
watch(includeTest, (v) => {
  if (isLive.value) void liveSetLearnersIncludeTest(v)
})

/* P1-3 列显隐（公共组件 MkCols）：学习者/进度/趋势/疲劳/置信/风险/更新 可隐藏，操作固定 */
const lcColDefs = [
  { key: 'learner', label: '学习者', title: '姓名 + 邮箱' },
  { key: 'progress', label: '当前进度', title: '当前任务 + 路径' },
  { key: 'trend', label: '趋势', title: '近况趋势' },
  { key: 'fatigue', label: '疲劳', title: '疲劳度' },
  { key: 'conf', label: '置信', title: '快照置信度' },
  { key: 'risk', label: '风险摘要', title: '风险原因' },
  { key: 'updated', label: '更新', title: '快照更新时间' },
] as const
const lcHiddenCols = ref<Set<string>>(new Set())

function openDetail(r: Row) {
  openSubPage('learner', r.id, includeTest.value ? { includeTest: true } : undefined)
}

/* —— C2 干预动线：风险学习者 → 查看会话 / 发送站内提醒 —— */
const intervene = ref<Row | null>(null)
const interveneTitle = ref('')
const interveneBody = ref('')
const interveneSending = ref(false)

function openIntervene(r: Row) {
  intervene.value = r
  interveneTitle.value = r.fatigue === '高' ? '学习状态提醒：疲劳度偏高' : '学习状态提醒'
  interveneBody.value = r.risk
    ? `检测到学习状态需关注：${r.risk}。建议调整学习节奏或补充练习。`
    : r.fatigue !== '低'
      ? `检测到疲劳度${r.fatigue}，建议适当休息后继续学习。`
      : '希望保持当前学习节奏，如有困难可随时反馈。'
}
function goInterveneSession(r: Row) {
  intervene.value = null
  openSubPage('learner', r.id, includeTest.value ? { includeTest: true } : undefined)
}
function goInterveneLogs() {
  intervene.value = null
  void import('./store').then(({ intent }) => {
    intent.agentFilter = ''
    intent.statusFilter = ''
    intent.traceId = ''
    intent.errorCategory = ''
    intent.timeRange = ''
    intent.scene = 'execution-logs'
  })
}
async function sendIntervene() {
  const r = intervene.value
  if (!r || !interveneTitle.value.trim()) return
  interveneSending.value = true
  try {
    await adminNotificationsApi.send({
      title: interveneTitle.value.trim(),
      body: interveneBody.value.trim() || undefined,
      kind: 'learning',
      scope: 'user',
      userId: r.id
    })
    toast.success('提醒已发送给「' + r.name + '」')
    intervene.value = null
  } catch (e) {
    toast.error(errMsg(e))
  } finally {
    interveneSending.value = false
  }
}

const demoRows = ref<Row[]>([]) // demo 数据已移除

const rows = computed<Row[]>(() => {
  if (isLive.value) {
    return liveLearners.value.map((m) => ({
      id: m.userId,
      name: m.name,
      email: m.email,
      isTestAccount: m.isTestAccount,
      path: m.pathTitle || '',
      task: m.currentTask || m.currentMilestone || '',
      trend: m.trend,
      fatigue: m.fatigue as Row['fatigue'],
      risk: m.struggling.length
        ? `概念「${m.struggling[0]}」挣扎`
        : m.fatigue === '高'
          ? '疲劳风险高'
          : m.fragile.length
            ? `概念「${m.fragile[0]}」记忆待巩固`
            : '',
      updated: timeAgo(m.generatedAt),
      confidence: m.confidence,
      ts: m.generatedAt ? new Date(m.generatedAt).getTime() : undefined
    }))
  }
  return demoRows.value
})

const pills = [
  { id: 'all' as const, label: '全部' },
  { id: 'risk' as const, label: '需关注' },
  { id: 'stale' as const, label: '低置信' }
]

const isRisk = (r: Row) => r.trend === 'down' || r.fatigue !== '低' || !!r.risk
const riskCount = computed(() => rows.value.filter(isRisk).length)
const lowConfCount = computed(() => rows.value.filter((r) => evidenceLowConfidence(r.confidence ?? 1)).length)

const filtered = computed(() => {
  let list = rows.value
  if (pill.value === 'risk') list = rows.value.filter(isRisk)
  if (pill.value === 'stale') list = rows.value.filter((r) => evidenceLowConfidence(r.confidence ?? 1))
  // 关键词搜索
  const kw = keyword.value.trim().toLowerCase()
  if (kw) {
    list = list.filter((r) =>
      r.name?.toLowerCase().includes(kw) ||
      r.email?.toLowerCase().includes(kw) ||
      r.id?.toLowerCase().includes(kw)
    )
  }
  // 先找有问题的人：风险位优先，组内按更新时间新→旧
  return [...list].sort((a, b) => {
    const riskDiff = Number(isRisk(a)) - Number(isRisk(b))
    if (riskDiff) return -riskDiff
    return (b.ts ?? 0) - (a.ts ?? 0)
  })
})

const statusTone = computed(() => (!rows.value.length ? 'mk-status--muted' : riskCount.value > 0 ? 'mk-status--warn' : 'mk-status--ok'))

/** live 学习者域拉取失败（且列表为空）→ 错误态；空态只在真正无数据时展示 */
const loadFailed = computed(
  () => isLive.value && !liveLoading.value && !!liveFailures.value.learners && !liveLearners.value.length
)
function retryLoad() {
  void loadLiveData()
}

/* 长列表分批渲染：每批 15 行 */
/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   数据全量在客户端（live 拉取 / demo 本地），筛选后按页切片；
   筛选/数据变化自动回第 1 页（watch filtered） */
const page = ref(1)
const pageSize = ref(15)
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
watch(filtered, () => {
  page.value = 1
})

const trendText = (t: string) => (t === 'up' ? '↗ 上升' : t === 'down' ? '↘ 下降' : '→ 稳定')
const trendTitle = (r: Row) =>
  `近况趋势：${trendText(r.trend)}${r.trend === 'down' ? '（需关注）' : r.trend === 'up' ? '（学习状态向好）' : '（状态平稳）'}。趋势基于近期学习表现，详细曲线见详情页`
const fatigueBadge = (f: string) => (f === '高' ? 'mk-badge--bad' : f === '中' ? 'mk-badge--warn' : 'mk-badge--ok')

/* 重算 */
const recomputingAll = ref(false)
const recomputeProgress = ref(0)
/** 行级重算中状态：独立 Set，保证模板能及时响应重渲染 */
const updatingIds = ref<Set<string>>(new Set())
const isUpdating = (id: string) => updatingIds.value.has(id)

async function recompute(row: Row) {
  if (isUpdating(row.id)) return
  const ok = await askConfirm({
    title: '重算快照',
    message: `确认重算「${row.name}」的学习者快照？将重新分析其学习状态与概念掌握情况。`,
    confirmText: '重算',
    danger: false
  })
  if (!ok) return
  updatingIds.value = new Set(updatingIds.value).add(row.id)
  try {
    if (isLive.value) {
      await liveRecomputeLearner(row.id)
      toast.success(`「${row.name}」快照已重算（真实）`)
    } else {
      await new Promise((r) => setTimeout(r, 800))
      row.updated = '刚刚'
      toast.success(`「${row.name}」快照已重算`)
    }
  } catch (e) {
    toast.error(`重算失败：${errMsg(e)}`)
  } finally {
    const next = new Set(updatingIds.value)
    next.delete(row.id)
    updatingIds.value = next
  }
}

async function recomputeAll() {
  if (recomputingAll.value || !rows.value.length) return
  const ok = await askConfirm({
    title: '全部重算快照',
    message: `确认重算全部 ${rows.value.length} 位学习者的快照？将逐个重新生成，耗时取决于人数。`,
    confirmText: '全部重算',
    danger: false
  })
  if (!ok) return
  recomputingAll.value = true
  recomputeProgress.value = 0
  if (isLive.value) {
    let ok = 0
    let fail = 0
    for (const r of rows.value) {
      updatingIds.value = new Set(updatingIds.value).add(r.id)
      try {
        await liveRecomputeLearner(r.id)
        ok++
      } catch {
        fail++
      } finally {
        const next = new Set(updatingIds.value)
        next.delete(r.id)
        updatingIds.value = next
        recomputeProgress.value++
      }
    }
    if (fail) {
      toast.error(`重算完成：${ok} 成功 · ${fail} 失败`)
    } else {
      toast.success(`已重算 ${ok} 个快照（真实）`)
    }
  } else {
    await new Promise((r) => setTimeout(r, 1200))
    demoRows.value.forEach((r) => (r.updated = '刚刚'))
    toast.success(`已重算 ${rows.value.length} 个快照`)
  }
  recomputingAll.value = false
}
</script>

<style scoped>
.lc-row { cursor: pointer; }
/* 页头计数锚点（P0-3）：需关注/低置信可点击筛选 */
.lc-count-link {
  border: 0; background: transparent; padding: 0;
  font: inherit; font-size: 12.5px; font-weight: 700;
  color: var(--mk-muted); cursor: pointer;
  border-radius: 6px;
  transition: color 0.12s ease, background 0.12s ease;
}
.lc-count-link:hover { color: var(--mk-blue); background: rgba(44, 99, 208, 0.08); padding: 2px 6px; margin: -2px -6px; }
.lc-count-link--on { color: var(--mk-blue); background: rgba(44, 99, 208, 0.12); padding: 2px 6px; margin: -2px -6px; }
/* 趋势列（P0-1 信号可视化）：箭头 + 迷你条 + 文字（无历史序列时的三态可视化；
   lssHistory 暴露后可升级真 sparkline） */
.trend { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.trend--up { color: var(--mk-green); }
.trend--down { color: var(--mk-red); }
.trend--flat { color: var(--mk-muted); }
.lc-trend { display: inline-flex; align-items: center; gap: 5px; font-weight: 700; font-size: 12px; color: var(--mk-muted); white-space: nowrap; cursor: help; }
.lc-trend--up { color: var(--mk-green); }
.lc-trend--down { color: var(--mk-red); }
.lc-trend--flat { color: var(--mk-muted); }
.lc-trend__arrow { font-style: normal; }
.lc-trend__bars { display: inline-flex; align-items: flex-end; gap: 1.5px; height: 12px; }
.lc-trend__bar { width: 3px; border-radius: 1px; background: currentColor; opacity: 0.55; }
.lc-trend__bar--1 { height: 5px; }
.lc-trend__bar--2 { height: 8px; }
.lc-trend__bar--3 { height: 11px; }
.lc-trend--up .lc-trend__bar--1 { height: 11px; opacity: 0.85; }
.lc-trend--up .lc-trend__bar--2 { height: 8px; }
.lc-trend--up .lc-trend__bar--3 { height: 5px; opacity: 0.4; }
.lc-trend--down .lc-trend__bar--1 { height: 5px; opacity: 0.4; }
.lc-trend--down .lc-trend__bar--2 { height: 8px; }
.lc-trend--down .lc-trend__bar--3 { height: 11px; opacity: 0.85; }
.progress-title { font-weight: 600; }
.risk-text { color: var(--mk-amber); font-size: 12.5px; }
.conf { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--mk-muted); cursor: help; }
.conf__lack { font-style: normal; font-size: 10.5px; font-weight: 700; color: var(--mk-amber); background: var(--mk-amber-bg); border-radius: 6px; padding: 1px 6px; margin-left: 6px; }
.conf--low { color: var(--mk-amber); }
.lc-tag-test {
  display: inline-block;
  margin-top: 2px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  background: #fef3c7;
  color: #b45309;
}

@media (min-width: 2000px) {
  .risk-text { font-size: 14px; }
}
@media (min-width: 2800px) {
  .risk-text { font-size: 16.5px; }
}

/* ================= C2 干预动线 ================= */
.lc-intervene--hot { color: var(--mk-amber); }
html[data-theme='dark'] .lc-intervene--hot { color: #fbbf24; }
.lc-iv__risk {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--mk-amber-bg);
  border: 1px solid rgba(180, 83, 9, 0.25);
  color: var(--mk-amber);
}
.lc-iv__risk--hot { background: var(--mk-red-bg); border-color: rgba(220, 38, 38, 0.25); color: var(--mk-red); }
.lc-iv__risk strong { font-size: 12px; font-weight: 800; letter-spacing: 0.04em; }
.lc-iv__risk span { font-size: 12.5px; line-height: 1.6; }
.lc-iv__actions { display: flex; gap: 8px; flex-wrap: wrap; }
.lc-iv__hint { margin: 0; font-size: 11.5px; color: var(--mk-faint); line-height: 1.6; }
</style>
