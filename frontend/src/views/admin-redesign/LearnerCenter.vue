<template>
  <div :class="embedded ? 'mk-page--fill lc-embedded' : 'mk-page mk-page--fill'">
    <!-- （原非嵌入模式状态条已删，2026-10-02 死代码确认：/admin/learner-center 路由已重定向
         /admin/people?tab=state（router/index.ts），本组件全仓仅 People 以 embedded 挂载
         （merged-tabs.smoke.test.ts 同）——v-if="!embedded" 分支永不渲染，且其「需关注」计数
         已被下方 pills/KPI 承接。计数入口收敛到卡头 pills，同屏不再四处重复。 -->

    <div class="mk-card mk-card--fill">
      <!-- 视图切换（原型 card > .tabs 下划线页签）：tab 状态由宿主 People 持有 -->
      <div v-if="embedded" class="tabs" role="tablist" aria-label="视图切换">
        <button type="button" class="tab" role="tab" :aria-selected="tab === 'account'" @click="$emit('switch', 'account')">账号管理</button>
        <button type="button" class="tab" role="tab" :aria-selected="tab === 'state'" @click="$emit('switch', 'state')">学习状态</button>
      </div>
      <div class="mk-card__head">
        <div class="mk-filter">
          <div class="mk-pills">
            <button
              v-for="p in pills"
              :key="p.id"
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': pill === p.id }"
              :aria-pressed="pill === p.id"
              @click="pill = p.id"
            >
              {{ p.label }}<span v-if="p.id === 'watch'" class="mk-pill__count">{{ p.count }}</span>
              <!-- P2（2026-10-04 全站评审）：pill 计数只留在没有 KPI 孪生的「观察」上（判例=Users：
                   筛选命中数是 pills 独有事实才保留）；需关注/低置信/全部的数字已由分析层 KPI 卡
                   与「学习者」卡承载，pill 退为纯筛选开关，同组数字不再同屏念两遍 -->
            </button>
          </div>
          <MkFilterSearch v-model="keyword" style="width: 200px;" placeholder="搜索名称 / 邮箱 / ID" />
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
        </div>
        <div class="mk-card__head-right">
          <button
            v-if="embedded"
            type="button"
            class="mk-btn mk-btn--sm"
            :disabled="recomputingAll || !rows.length"
            @click="recomputeAll"
          >{{ recomputingAll ? `重算中 ${recomputeProgress}/${rows.length}…` : '全部重算' }}</button>
          <DataScopeToggle v-if="isLive" v-model="includeTest" />
          <MkCols
            :col-defs="lcColDefs"
            storage-key="wf_learner_hidden_cols"
            v-model:hidden="lcHiddenCols"
          />
          <!-- 后端学习者域 limit=50 截断口径单源住在 People 页状态条（P2 2026-10-04 全站评审：
               此处卡头同句与「50 / 50 人」撤——截断说明不在同屏念三遍） -->
          <span v-if="filtered.length !== rows.length" class="mk-card__meta">{{ filtered.length }} / {{ rows.length }} 人</span>
        </div>
      </div>

      <MockSkeletonTable v-if="liveLoading && !rows.length" :cols="8" />
      <MkEmptyState
        v-else-if="loadFailed"
        icon="◌"
        title="学习者快照加载失败"
        description="无法从后端拉取学习者状态。"
        action-text="重试"
        @action="retryLoad"
      />
      <!-- fill 滚动契约（.mk-card--fill > .mk-table-scroll 接管纵向滚动，sticky 表头依赖该类名）：
           原型 state 分支的分析层（四卡 → 直方图 → 排行）与列表同区滚动，分页器仍在卡尾吸底 -->
      <div v-else class="mk-table-scroll lc-body">
        <!-- 学习状态分析层（原型 renderPeople state 分支）：统计四卡 → 置信度分布直方图 → 排行。
             口径 = 当前加载的学习者快照全集（随「含测试账号」范围联动），
             不随下方 pill / 搜索筛选变化（与原型从全体学习者聚合一致） -->
        <div v-if="rows.length" class="lc-analytics">
          <section class="mk-kpi-grid" aria-label="学习状态概览">
            <!-- P1#16 数据层已接线（live.ts liveLearnersTotal）：有 total 显「N · 已载 M」，仅窗口时显「已加载 N」。
                 P2（2026-10-04 全站评审）：hint 撤截断句（单源=页状态条），只留口径差异 -->
            <MkKpi
              label="学习者"
              :value="learnerTotalText"
              :hint="`口径：${includeTest ? '含测试账号' : '不含测试账号'}${learnerTotal == null ? '；全量总数接口未返回' : ''}`"
            />
            <!-- P1#17：需关注收窄为真异常（趋势降 ∨ 疲劳高 ∨ 有风险摘要）；
                 常态档「疲劳=中」拆到 pills 的「观察」，不再把需关注撑爆 -->
            <MkKpi label="需关注" :value="riskCount" :tone="riskCount ? 'warn' : ''" hint="趋势下降 / 疲劳高 / 有风险摘要" />
            <MkKpi label="低置信" :value="lowConfCount" :tone="lowConfCount ? 'warn' : ''" hint="快照置信度低于 50%" />
            <MkKpi label="平均置信度" :value="avgConfText" :hint="avgConfHint" />
          </section>

          <template v-if="confRows.length">
            <div class="lc-section-head">
              <span class="lc-section-title">置信度分布</span>
              <span class="lc-section-sub">学习者按快照置信度分档 · 共 {{ confRows.length }} 个快照</span>
            </div>
            <!-- 原型 .histo：.hcol（hval 数值 + hbar 柱 + hcap 档位帽），柱高 = n / maxBin -->
            <div class="lc-histo" role="img" :aria-label="histoAria">
              <div v-for="b in histoBins" :key="b.label" class="lc-hcol">
                <span class="lc-hval">{{ b.n }}</span>
                <span class="lc-hbar" :class="`lc-hbar--${b.tone}`" :style="{ height: b.h + 'px' }"></span>
                <span class="lc-hcap">{{ b.label }}</span>
              </div>
            </div>
          </template>

          <template v-if="rankRows.length">
            <div class="lc-section-head">
              <span class="lc-section-title">学习状态分布 · 置信度由低到高</span>
            </div>
            <!-- 原型 .ranklist/.rankrow：meterrow 迷你条 + mono 数值，行点击进详情（按钮化保键盘可达） -->
            <div class="lc-ranklist">
              <button
                v-for="r in rankRows"
                :key="r.row.id"
                type="button"
                class="lc-rankrow"
                :title="`查看 ${r.name} 的学习详情`"
                @click="openDetail(r.row)"
              >
                <span class="lc-rankrow__name">{{ r.name }}</span>
                <span class="mk-minibar lc-rankrow__bar" aria-hidden="true">
                  <i class="mk-minibar__fill" :data-tone="r.tone" :style="{ width: r.pct + '%' }"></i>
                </span>
                <span class="lc-rankrow__val">{{ r.label }}</span>
              </button>
            </div>
          </template>
        </div>

      <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed），单元格 nowrap、
           列按内容自然分宽；长昵称/长任务由 mk-cell-main 上限与下方 max-width 截断兜底 -->
      <table v-if="filtered.length" class="mk-table">
        <thead>
          <tr>
            <th v-if="!lcHiddenCols.has('learner')">学习者</th>
            <th v-if="!lcHiddenCols.has('progress')">当前进度</th>
            <th v-if="!lcHiddenCols.has('trend')">趋势</th>
            <th v-if="!lcHiddenCols.has('fatigue')">疲劳</th>
            <th v-if="!lcHiddenCols.has('conf')" title="快照置信度：模型对该学习者状态的把握程度，低于 50% 为低置信">置信</th>
            <th v-if="!lcHiddenCols.has('risk')">风险摘要</th>
            <th v-if="!lcHiddenCols.has('updated')">更新</th>
            <th class="mk-th--right">操作</th>
          </tr>
        </thead>
        <tbody>
          <!-- 行点击进学习者详情；键盘等价：tabindex + Enter 触发（对齐 gc-row/oc-row 判例），
               行内控件已 stopPropagation，聚焦自身即可回车，不产生双份焦点停靠 -->
          <tr v-for="r in paged" :key="r.id" class="lc-row" tabindex="0" @click="openDetail(r)" @keydown.enter.prevent="openDetail(r)">
            <td v-if="!lcHiddenCols.has('learner')">
              <div class="lc-celluser">
                <MkCellAvatar :name="r.name" :tone="r.isTestAccount ? 'test' : 'default'" />
                <div class="mk-cell-main">
                  <strong>{{ r.name }}</strong>
                  <span class="mk-cell-sub">{{ r.email }}</span>
                </div>
                <MkVariantBadge v-if="r.isTestAccount" kind="test" />
              </div>
            </td>
            <td v-if="!lcHiddenCols.has('progress')">
              <div class="mk-cell-main lc-task">
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
                <span class="mk-minibar lc-conf__bar" aria-hidden="true"><i class="mk-minibar__fill" :data-tone="evidenceLowConfidence(r.confidence) ? 'warn' : undefined" :style="{ width: Math.round(r.confidence * 100) + '%' }"></i></span>
              </span>
              <span v-else class="mk-na" :title="r.task ? '' : '尚未开始学习，暂无置信度'">—</span>
            </td>
            <td v-if="!lcHiddenCols.has('risk')" class="risk-text" :class="{ 'mk-na': !r.risk }" :title="r.risk || ''">{{ r.risk || '—' }}</td>
            <td v-if="!lcHiddenCols.has('updated')">
              <span v-if="isUpdating(r.id)" class="lc-updated">重算中…</span>
              <span v-else-if="r.updated" class="mk-fresh" :class="freshTone(r.ts)" :title="r.ts ? new Date(r.ts).toLocaleString() : undefined">{{ r.updated }}</span>
              <span v-else class="mk-na">—</span>
            </td>
            <td>
              <div class="mk-actions mk-actions--left">
                <button type="button" class="mk-icon-btn" title="详情" @click.stop="openDetail(r)"><UserRound :size="15" :stroke-width="1.75" /></button>
                <button v-if="isLive && !r.isTestAccount" type="button" class="mk-icon-btn" :class="{ 'lc-intervene--hot': isRisk(r) }" title="干预：查看会话 / 发送提醒" @click.stop="openIntervene(r)"><Bell :size="15" :stroke-width="1.75" /></button>
                <button type="button" class="mk-icon-btn" :disabled="isUpdating(r.id)" :title="isUpdating(r.id) ? '重算中…' : '重算'" @click.stop="recompute(r)"><RotateCw :size="15" :stroke-width="1.75" /></button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

        <MkEmptyState
          v-else
          :title="pill === 'all' ? '暂无学习者快照' : '当前分组暂无学习者'"
          :description="pill === 'all' ? '学习者产生学习行为后，快照将自动生成。' : '该风险分组暂无匹配的学习者。'"
          :action-text="isFiltered ? '清除筛选' : ''"
          @action="clearFilters"
        />
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
      <div v-if="intervene" ref="interveneMaskRef" class="mk-modal">
        <div ref="intervenePanelRef" class="mk-modal__panel" role="dialog" aria-label="学习者干预">
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
            <p class="lc-iv__hint">提醒将出现在该学习者的站内通知中。</p>
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
import { liveLearners, liveLearnersTotal, liveRecomputeLearner, liveSetLearnersIncludeTest, liveLoading, liveFailures, loadLiveData, timeAgo, errMsg } from './live'
import { evidenceLowConfidence } from './evidence'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import DataScopeToggle from './DataScopeToggle.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkCols from '@/components/mk/MkCols.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkCellAvatar from '@/components/mk/MkCellAvatar.vue'
import MkVariantBadge from '@/components/mk/MkVariantBadge.vue'
import { Bell, RotateCw, UserRound } from 'lucide-vue-next'
import { useOverlay, useMaskClose } from './useOverlay'
import { useEscape } from './useEscape'
import { adminNotificationsApi, adminLearnerModelsApi } from '@/api/adminApi'

/** 嵌入模式：作为「用户与学习者」页「学习状态」tab 渲染（仅去掉外层壳，状态条/列表/干预弹窗保留）。
    tab/switch：宿主持有的视图页签状态（原型 card > .tabs，页签在卡内顶部） */
withDefaults(defineProps<{ embedded?: boolean; tab?: string }>(), { embedded: false, tab: 'state' })
defineEmits<{ (e: 'switch', tab: 'account' | 'state'): void }>()

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
  /** 更新时间戳（用于排序） */
  ts?: number
}

const pill = ref<'all' | 'risk' | 'watch' | 'stale'>('all')
const keyword = ref('')
const includeTest = ref(false)
watch(includeTest, (v) => {
  // 切换失败不静默：用户以为已切到全量/仅真实口径，实际列表还是旧口径
  if (isLive.value) {
    liveSetLearnersIncludeTest(v).catch((e) => toast.error(`切换数据范围失败：${errMsg(e)}`))
  }
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

/* 更新列新鲜度三档（批B，mk-fresh 原语） */
function freshTone(ts?: number): string {
  if (!ts) return 'mk-fresh--never'
  return Date.now() - ts < 24 * 3600000 ? 'mk-fresh--fresh' : ''
}
function openDetail(r: Row) {
  openSubPage('learner', r.id, includeTest.value ? { includeTest: true } : undefined)
}

/* —— C2 干预动线：风险学习者 → 查看会话 / 发送站内提醒 —— */
const intervene = ref<Row | null>(null)
const interveneTitle = ref('')
const interveneBody = ref('')
const interveneSending = ref(false)
/* 干预弹窗行为四件套（2026-09-26 弹层对齐）：此前全目录唯一一个零钩子弹窗 */
const interveneMaskRef = ref<HTMLElement | null>(null)
const intervenePanelRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => !!intervene.value), intervenePanelRef)
useMaskClose(interveneMaskRef, () => { intervene.value = null })
useEscape(() => !!intervene.value, () => { intervene.value = null })

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

/** P1#16 数据层接线：liveLearnersTotal=后端分页 total；仅窗口时如实「已加载 N」 */
const learnerTotal = computed(() => liveLearnersTotal.value)
const learnerTotalText = computed(() => {
  const t = learnerTotal.value
  if (t != null && t !== rows.value.length) return `${t} · 已载 ${rows.value.length}`
  return rows.value.length ? `已加载 ${rows.value.length}` : '0'
})
const rows = computed<Row[]>(() =>
  liveLearners.value.map((m) => ({
    id: m.userId,
    name: m.name,
    email: m.email,
    isTestAccount: m.isTestAccount,
    path: m.pathTitle || '',
    task: m.currentTask || m.currentMilestone || '',
    trend: m.trend,
    fatigue: m.fatigue as Row['fatigue'],
    risk: m.struggling.length
      ? `「${m.struggling[0]}」等 ${m.struggling.length} 个概念挣扎`
      : m.fatigue === '高'
        ? '疲劳风险高'
        : m.fragile.length
          ? `「${m.fragile[0]}」等 ${m.fragile.length} 个概念待巩固`
          : '',
    updated: timeAgo(m.generatedAt),
    confidence: m.confidence,
    ts: m.generatedAt ? new Date(m.generatedAt).getTime() : undefined
  }))
)

const pills = computed(() => [
  { id: 'all' as const, label: '全部', count: rows.value.length },
  { id: 'risk' as const, label: '需关注', count: riskCount.value },
  { id: 'watch' as const, label: '观察', count: watchCount.value },
  { id: 'stale' as const, label: '低置信', count: lowConfCount.value }
])

/* P1#17 告警拆档：原 isRisk 把「疲劳=中」（常见常态档）也计入需关注 → 计数虚高、告警疲劳。
   收窄：趋势降 ∨ 疲劳高 ∨ 有风险摘要 = 需关注；疲劳=中 且非需关注 = 「观察」（单独 pill 计数） */
const isRisk = (r: Row) => r.trend === 'down' || r.fatigue === '高' || !!r.risk
const isWatch = (r: Row) => !isRisk(r) && r.fatigue === '中'
const riskCount = computed(() => rows.value.filter(isRisk).length)
const watchCount = computed(() => rows.value.filter(isWatch).length)
const lowConfCount = computed(() => rows.value.filter((r) => evidenceLowConfidence(r.confidence ?? 1)).length)

/* —— 学习状态分析层（原型 renderPeople state 分支：①统计四卡 ②分布直方图 ③排行）——
   原型以 LSB（学习状态平衡分，-30~30）作逐人评分；本仓快照域（live.ts LiveLearner）
   无该字段，不硬造 LSB，改用快照唯一逐人分数 confidence（0~1）做分布。
   口径 = rows 全集（随「含测试账号」范围联动），不随 pill / 搜索筛选变化；
   有学习任务（r.task）才有有效置信度，与表格置信列的「—」口径一致 */
const confRows = computed(() => rows.value.filter((r) => r.task && r.confidence != null))
const avgConfText = computed(() => {
  if (!confRows.value.length) return '—'
  const avg = confRows.value.reduce((s, r) => s + (r.confidence ?? 0), 0) / confRows.value.length
  return Math.round(avg * 100) + '%'
})
/** 平均值必须带基数：n= 之外的行（无任务/无快照）不进均值，读数才知道它代表谁 */
const avgConfHint = computed(() =>
  confRows.value.length
    ? `有学习任务的快照 · n=${confRows.value.length}（其余无任务/无快照不入均值） · 全体口径`
    : '暂无有学习任务的快照'
)
/** 直方图五档（原型 .histo bad→ok 自左向右）：阈值锚定产品既定的 50% 低置信线，
    <50 区按严重度再分 <25（红）/ 25–49（琥珀）两档；柱高 = n / maxBin（6px 下限，原型同款） */
const HISTO_BINS = [
  { label: '< 25%', min: 0, tone: 'bad' },
  { label: '25–49%', min: 25, tone: 'warn' },
  { label: '50–74%', min: 50, tone: 'faint' },
  { label: '75–89%', min: 75, tone: 'brand' },
  { label: '≥ 90%', min: 90, tone: 'ok' }
] as const
const histoBins = computed(() => {
  const counts = HISTO_BINS.map((b, i) =>
    confRows.value.filter((r) => {
      const v = (r.confidence ?? 0) * 100
      return v >= b.min && (i === HISTO_BINS.length - 1 || v < HISTO_BINS[i + 1].min)
    }).length
  )
  const max = Math.max(1, ...counts)
  return HISTO_BINS.map((b, i) => ({ ...b, n: counts[i], h: Math.max(6, Math.round((counts[i] / max) * 100)) }))
})
const histoAria = computed(() => histoBins.value.map((b) => `${b.label}：${b.n} 人`).join('，'))
/** 排行（原型 .ranklist slice(0,10)）：置信度由低到高，最不确定的排最前
    （与列表「先找有问题的人」同取向），行点击进详情；row 携带原行供 openDetail */
const rankRows = computed(() =>
  [...confRows.value]
    .sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0))
    .slice(0, 10)
    .map((row) => {
      const pct = Math.round((row.confidence ?? 0) * 100)
      return { row, name: row.name, pct, label: `${pct}%`, tone: pct >= 90 ? 'ok' as const : pct >= 50 ? undefined : 'warn' as const }
    })
)

const filtered = computed(() => {
  let list = rows.value
  if (pill.value === 'risk') list = rows.value.filter(isRisk)
  if (pill.value === 'watch') list = rows.value.filter(isWatch)
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

const isFiltered = computed(() => pill.value !== 'all' || !!keyword.value.trim())
function clearFilters() {
  pill.value = 'all'
  keyword.value = ''
}

/** live 学习者域拉取失败（且列表为空）→ 错误态；空态只在真正无数据时展示 */
const loadFailed = computed(
  () => isLive.value && !liveLoading.value && !!liveFailures.value.learners && !liveLearners.value.length
)
function retryLoad() {
  void loadLiveData()
}
/* 宿主刷新联动（用户与学习者合并宿主「刷新」按钮 → 重拉 live 学习者域） */
defineExpose({ refresh: () => { void loadLiveData() } })

/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   数据全量在客户端（live 拉取），筛选后按页切片；
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

/** 趋势纯文案（箭头由模板的 .lc-trend__arrow 图标渲染，文本再带箭头会「↗ ↗ 上升」双重箭头） */
const trendText = (t: string) => (t === 'up' ? '上升' : t === 'down' ? '下降' : '稳定')
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
    await liveRecomputeLearner(row.id)
    toast.success(`「${row.name}」快照已重算`)
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
  const confirmed = await askConfirm({
    title: '全部重算快照',
    message: `确认重算全部 ${rows.value.length} 位学习者的快照？将逐个重新生成，耗时取决于人数。`,
    confirmText: '全部重算',
    danger: false
  })
  if (!confirmed) return
  recomputingAll.value = true
  recomputeProgress.value = 0
  let ok = 0
  let fail = 0
  for (const r of rows.value) {
    updatingIds.value = new Set(updatingIds.value).add(r.id)
    try {
      // 循环内只调重算接口、不刷列表：liveRecomputeLearner 每次附带全量重拉学习者域，
      // N 人重算会触发 N 次全量请求；改为循环结束统一刷新一次
      await adminLearnerModelsApi.recompute(r.id)
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
  // 循环结束统一刷新一次（带当前「含模拟」口径，保持列表范围一致）
  try {
    await liveSetLearnersIncludeTest(includeTest.value)
  } catch {
    toast.error('重算完成，但列表刷新失败，请手动刷新')
  }
  if (fail) {
    toast.error(`重算完成：${ok} 成功 · ${fail} 失败`)
  } else {
    toast.success(`已重算 ${ok} 个快照`)
  }
  recomputingAll.value = false
}
</script>

<style scoped>
/* 嵌入模式（宿主 People 页 flex 列内）：占满剩余高度，表格区内滚（对齐 oc-embedded 先例） */
.lc-embedded { flex: 1; min-height: 0; overflow: hidden; }
/* 视图切换（原型 .tabs 下划线页签，卡内顶部） */
.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--mk-line); }
.tab {
  border: 0; background: transparent; color: var(--mk-muted);
  padding: 9px 12px; cursor: pointer; font-weight: 600;
  font-size: var(--mk-fs-micro); border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.tab[aria-selected='true'] { color: var(--mk-blue); border-bottom-color: var(--mk-blue); }
.lc-row { cursor: pointer; }
/* 键盘可达（对齐 gc-row/oc-row 判例）：行可聚焦，焦点态描边提示当前位置 */
.lc-row:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: -2px; }
/* ================= 学习状态分析层（原型 renderPeople state 分支） =================
   ①统计四卡 = 共享 .mk-kpi-grid + MkKpi；②直方图复刻原型 .histo（hval/hbar/hcap，
   柱高 = n/max；原型 11px 字级抬到 12px 下限，6/6/3/3 圆角收进 token 档 6/6/4/4）；
   ③排行复刻 .ranklist/.rankrow（迷你条 + mono 数值，行点击进详情） */
.lc-analytics { display: grid; gap: 14px; padding: 14px 16px 6px; }
.lc-section-head { display: flex; align-items: baseline; gap: 8px; }
.lc-section-title { font-weight: 700; font-size: var(--mk-fs-emphasis); color: var(--mk-ink); }
.lc-section-sub { color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.lc-histo { display: flex; align-items: flex-end; gap: 10px; height: 132px; padding-top: 10px; }
.lc-hcol { flex: 1 1 0; min-width: 0; display: grid; align-content: end; justify-items: center; gap: 6px; }
.lc-hbar {
  width: 100%; max-width: 52px; min-height: 3px;
  border-radius: var(--mk-radius-sm) var(--mk-radius-sm) var(--mk-radius-xs) var(--mk-radius-xs);
  background: var(--mk-blue);
}
.lc-hbar--bad { background: var(--mk-red); }
.lc-hbar--warn { background: var(--mk-amber); }
.lc-hbar--faint { background: var(--mk-faint); }
.lc-hbar--ok { background: var(--mk-green); }
.lc-hval { font-size: var(--mk-fs-micro); font-family: var(--mk-mono); font-variant-numeric: tabular-nums; color: var(--mk-muted); }
.lc-hcap { font-size: var(--mk-fs-micro); color: var(--mk-faint); text-align: center; white-space: nowrap; }
@media (max-width: 768px) { .lc-histo { height: 108px; gap: 6px; } }
.lc-ranklist { display: grid; gap: 2px; }
.lc-rankrow {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 0;
  border: 0; border-bottom: 1px solid var(--mk-line);
  background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.lc-rankrow:last-child { border-bottom: 0; }
.lc-rankrow__name { flex: 0 1 auto; min-width: 0; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.lc-rankrow:hover .lc-rankrow__name { color: var(--mk-blue); }
.lc-rankrow__bar { flex: 1 1 0; width: auto; min-width: 40px; }
.lc-rankrow__val { flex: none; width: 44px; text-align: right; font-family: var(--mk-mono); font-variant-numeric: tabular-nums; font-weight: 600; }
/* 学习者单元格（原型 celluser：头像 + 主行/副行 + 身份徽章，Users.vue ul-user 同款判例） */
.lc-celluser { display: flex; align-items: center; gap: 9px; min-width: 0; }
.lc-celluser .mk-cell-main { min-width: 0; flex: 1; }
.lc-celluser .mk-cell-sub { max-width: 230px; }
.lc-task .mk-cell-sub { max-width: 240px; }
/* 原型 .tbl td：nowrap（表自动布局判例见 Users.vue；长内容由上方 max-width 截断兜底） */
.mk-table td { white-space: nowrap; }
/* （原页头计数锚点 .mk-status__meta-link 的暗色覆盖随死状态条删除；
   该暗色规则早已提升为 shared.css 全局，其余页面的计数锚点不受影响） */
/* 趋势列（P0-1 信号可视化）：箭头 + 迷你条 + 文字（无历史序列时的三态可视化；
   lssHistory 暴露后可升级真 sparkline） */
.trend { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.lc-trend { display: inline-flex; align-items: center; gap: 5px; font-weight: 700; font-size: var(--mk-fs-micro); color: var(--mk-muted); white-space: nowrap; cursor: help; }
.lc-trend--up { color: var(--mk-green); }
.lc-trend--down { color: var(--mk-red); }
.lc-trend--flat { color: var(--mk-muted); }
.lc-trend__arrow { font-style: normal; }
.lc-trend__bars { display: inline-flex; align-items: flex-end; gap: 1.5px; height: 12px; }
.lc-trend__bar { width: 3px; border-radius: var(--mk-radius-xs); background: currentColor; opacity: 0.55; }
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
.risk-text { color: var(--mk-amber); font-size: var(--mk-fs-micro); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 更新列：相对时间不换行（"4 分钟前"拆行问题） */
.lc-updated { white-space: nowrap; color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.conf { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--mk-muted); cursor: help; }
.conf__lack { font-style: normal; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-amber); background: var(--mk-amber-bg); border-radius: 6px; padding: 1px 6px; margin-left: 6px; }
.conf--low { color: var(--mk-amber); }
.lc-conf__bar { display: block; width: 56px; margin-top: 3px; }

@media (min-width: 2000px) {
  .risk-text { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {
  .risk-text { font-size: var(--mk-fs-body); }
}

/* ================= C2 干预动线 ================= */
.lc-intervene--hot { color: var(--mk-amber); }
html[data-theme='dark'] .lc-intervene--hot { color: #fbbf24; }
.lc-iv__risk {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-amber-bg);
  border: 1px solid rgba(180, 83, 9, 0.25);
  color: var(--mk-amber);
}
.lc-iv__risk--hot { background: var(--mk-red-bg); border-color: rgba(220, 38, 38, 0.25); color: var(--mk-red); }
.lc-iv__risk strong { font-size: var(--mk-fs-micro); font-weight: 800; letter-spacing: 0.04em; }
.lc-iv__risk span { font-size: var(--mk-fs-micro); line-height: 1.6; }
.lc-iv__actions { display: flex; gap: 8px; flex-wrap: wrap; }
.lc-iv__hint { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); line-height: 1.6; }
</style>
