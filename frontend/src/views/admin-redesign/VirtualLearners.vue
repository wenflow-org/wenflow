<template>
  <div class="mk-page mk-page--fill">
    <!-- 页头（newui/admin pagehead）：页名 + 主操作（新建/批量新建/回收）上移；
         状态条退位为纯状态摘要（人数/筛选/活动会话/截断提示） -->
    <MkPageHead title="虚拟学习者" sub="用合成画像批量压测教学闭环与 Skill 稳定性">
      <template #actions>
        <button
          v-if="partition.stale > 0"
          type="button"
          class="mk-btn mk-btn--sm"
          :disabled="reclaimRef?.state.busy"
          :title="'干跑确认清单后批量标记卡死会话为失败'"
          @click="openReclaimModal()"
        >
          {{ reclaimRef?.state.busy ? '回收中…' : `回收卡死（${partition.stale}）` }}
        </button>
        <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" title="新建虚拟学习者：填写名称/目标/故事，生成后可运行实验会话" @click="openCreate">新建</button>
        <button type="button" class="mk-btn mk-btn--sm" title="批量新建：一次创建多个虚拟学习者（表格批量填写）" @click="openBatchCreate">批量新建</button>
      </template>
    </MkPageHead>
    <div class="mk-status" :class="samples.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">共 {{ samples.length }} 人</span>
      <button
        v-for="o in statePillOptions"
        :key="o.key"
        type="button"
        class="mk-status__meta-link"
        :class="{ 'mk-status__meta-link--on': stateFilter === o.key }"
        :title="`点击筛选「${o.label}」虚拟学习者`"
        @click="stateFilter = stateFilter === o.key ? '' : o.key"
      >{{ o.label }} {{ o.count }}</button>
      <span class="mk-status__meta" title="当前进行中 + 创建中会话数（含卡死）">活动会话 {{ partition.running + partition.created }}</span>
      <span v-if="isLive && liveVirtualsTotal > samples.length" class="mk-status__meta vl-truncated" :title="`后端共 ${liveVirtualsTotal} 人，列表仅加载前 ${samples.length} 行`">
        已截断 · 共 {{ liveVirtualsTotal }} 人
      </span>
    </div>

    <!-- 运行指标带（2026-09-29 从列表卡头搬出；2026-09-29 二次归一）：
         完成率/失败率/并发/今日调用/速率本来是 MkStatStrip 自由指标条，与全站 KPI 语言
         （共享 .mk-kpi-grid + MkKpi 卡）不是同一套（用户：「这个 kpi 还是很自由的 kpi 啊」），
         现改走共享栅格；每张卡的 hint 给派生口径，不复述数字。
         VL RPM 是「写」控件，与只读 KPI 保持分行/分块，不混进数字栅格。 -->
    <div class="vl-kpi">
      <section class="mk-kpi-grid">
        <MkKpi label="完成率" :value="`${runStats.completionRate ?? 0}%`" :hint="`已完成 ${runStats.completed} / 全部 ${runStats.totalSessions}`" />
        <MkKpi
          label="失败率"
          :value="`${runStats.systemFailureRate ?? 0}%`"
          :tone="(runStats.systemFailureRate ?? 0) > 0 ? 'bad' : ''"
          :hint="`系统失败 ${runStats.failed} · 人为终止 ${runStats.abandoned}`"
        />
        <MkKpi
          label="并发"
          :value="concurrencyText"
          :tone="concurrencyTone === 'full' ? 'bad' : concurrencyTone === 'warn' ? 'warn' : 'ok'"
          hint="自动驾驶并发配额"
        />
        <MkKpi label="今日调用" :value="runStats.todayCalls ?? 0" :hint="todayCallsHint" />
        <MkKpi label="速率" :value="rateText" hint="出站上限，与下方 VL RPM 对应" />
      </section>
      <!-- VL RPM：写控件单独一行——与只读 KPI 分块（读/写不混排），也让 5 张卡在 1280 仍是一行
           （同排时 RPM 抢走 114px，栅格降成 4 列、第 5 张孤零零换行） -->
      <label class="vl-rpm" title="虚拟学习者专属出站 RPM 上限（0=不限）；与平台全局速率相互独立，不会挤占真实用户额度">
        <span class="vl-rpm__label">VL RPM</span>
        <input v-model.number="vlRpm.limit" type="number" min="0" max="100000" step="10" class="mk-filter__input vl-rpm__input" @focus="vlRpmFocused = true" @blur="vlRpmFocused = false" @input="vlRpmDirty = true" @change="saveVlRpm" />
        <span class="vl-rpm__hint">虚拟学习者专属出站上限，0 = 不限；与平台全局速率相互独立，不挤占真实用户额度</span>
      </label>
    </div>

    <!-- 学习者列表（「批量实验」已独立成页：/admin/batch-experiments） -->
    <!-- 正在运行：列出有活跃会话的虚拟学习者（折叠：默认前 8 个，展开看全部）；批量生成也在此显示 -->
    <VirtualLearnerRunningBar
      v-if="(runningSamples.length || pausedSamples.length || batchTask?.active) && isLive"
      :running-samples="runningSamples"
      :paused-samples="pausedSamples"
      :task="batchTask"
      @toggle-detail="batchCreateRef?.toggleDetail()"
      @retry="batchCreateRef?.retry()"
      @dismiss="batchCreateRef?.dismiss()"
    />

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <MkFilterSearch v-model="keyword" placeholder="搜索名称 / 倾向 / ID" />
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
        </div>
        <span class="mk-card__meta" title="当前筛选后的行数 / 总数">{{ filtered.length }} / {{ samples.length }} 人</span>
      </div>

      <SimulatedDaySettings />

      <MockSkeletonTable v-if="liveLoading && !samples.length" :cols="6" />
      <div v-else-if="filtered.length" class="mk-table-scroll vl-table-scroll">
      <!-- 原型 .tbl 词汇：自动布局（无 colgroup），td 靠 nowrap 撑列、长内容列给 px 截断上限；
           超宽由 .mk-table-scroll 横向滚动兜底（此前 fixed+colgroup 是本页私造的另一种表格语言） -->
      <table class="mk-table mk-table--click">
        <thead>
          <tr>
            <th v-if="isLive && !isNarrow" scope="col">
              <input type="checkbox" aria-label="全选（含跨页）" title="全选/清空当前筛选下的全部虚拟学习者（含跨页，不只当前页）" :checked="allChecked" @change="toggleAll" />
            </th>
            <th
              scope="col"
              class="mk-th--sortable"
              :aria-sort="vlSortState('name')"
              @click="toggleVlSort('name')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('name')">虚拟学习者<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th v-if="!isNarrow">长期倾向</th>
            <th
              v-if="!isNarrow"
              scope="col"
              class="mk-th--sortable"
              :aria-sort="vlSortState('story')"
              @click="toggleVlSort('story')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('story')">故事池<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              v-if="!isNarrow"
              scope="col"
              class="mk-th--right mk-th--sortable"
              title="累计会话数（全部会话，含终态）"
              :aria-sort="vlSortState('sessions')"
              @click="toggleVlSort('sessions')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('sessions')">会话<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              scope="col"
              class="mk-th--sortable"
              title="当前进行中/创建中的会话数及最近阶段；点击进入会话座舱"
              :aria-sort="vlSortState('running')"
              @click="toggleVlSort('running')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('running')">进行中<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              v-if="!isNarrow"
              scope="col"
              class="mk-th--right mk-th--sortable"
              title="已失败/已终止会话数（全量聚合）"
              :aria-sort="vlSortState('failed')"
              @click="toggleVlSort('failed')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('failed')">失败<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              v-if="!isNarrow"
              scope="col"
              class="mk-th--right mk-th--sortable"
              title="超过回收阈值无写入且无活跃租约的会话数（可在状态条一键回收）"
              :aria-sort="vlSortState('stalled')"
              @click="toggleVlSort('stalled')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('stalled')">卡死<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              v-if="!isNarrow"
              scope="col"
              class="mk-th--sortable"
              :aria-sort="vlSortState('created')"
              @click="toggleVlSort('created')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('created')">创建<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in paged" :key="s.id" class="vl-row">
            <td v-if="isLive && !isNarrow"><input v-model="selected" type="checkbox" :value="s.id" :aria-label="`选择 ${s.name}`" @click.stop /></td>
            <td>
              <div class="mk-cell-main vl-cell vl-cell--click" role="button" tabindex="0" :title="`查看 ${s.name} 的画像：故事池 / 运行记录 / 会话控制`" @click="openSubPage('virtual', s.id)" @keydown.enter="openSubPage('virtual', s.id)" @keydown.space.prevent="openSubPage('virtual', s.id)">
                <strong class="vl-name">
                  <span class="vl-avatar" :class="avatarClass(s)" aria-hidden="true">{{ s.name.slice(0, 1) }}</span>
                  <span class="vl-name__text">{{ s.name }}</span>
                </strong>
                <span class="mk-cell-sub">{{ shortId(s.id) }}</span>
              </div>
            </td>
            <td v-if="!isNarrow">
              <span class="vl-goal" :class="{ 'vl-goal--empty': !s.goal || s.goal === '—' }" :title="s.goal || undefined">{{ s.goal || '未设置' }}</span>
            </td>
            <td v-if="!isNarrow">
              <span class="mk-badge" :class="s.storyCount > 0 ? 'mk-badge--ok' : 'mk-badge--muted'">
                {{ s.storyCount > 0 ? `${s.storyCount} 条` : '未生成' }}
              </span>
            </td>
            <td v-if="!isNarrow" class="mk-num">{{ s.sessions }}</td>
            <td>
              <div class="vl-state-cell">
                <template v-if="s.runningCount > 0 || (s.pausedCount ?? 0) > 0">
                  <RunStateBadge
                    :status="s.runningCount > 0 ? 'running' : 'paused'"
                    :hint="`${s.runningCount} 个会话进行中 / ${s.pausedCount ?? 0} 个已暂停 · 点击进入会话座舱`"
                    @click.stop="openRunningSession(s)"
                  />
                  <RunStageBar
                    :stage="s.currentStage"
                    :status="s.runningCount > 0 ? 'running' : 'paused'"
                    :task-progress="s.stageProgress?.learnStarted ? { done: s.stageProgress.taskDone, total: s.stageProgress.taskTotal } : null"
                    :show-task-text="false"
                  />
                </template>
                <span v-else class="vl-run vl-run--idle" title="当前没有进行中的会话">空闲</span>
              </div>
            </td>
            <td v-if="!isNarrow" class="mk-num">
              <button
                type="button"
                class="vl-faillink mk-num"
                :class="{ 'vl-num--bad': s.failedCount > 0 }"
                :title="s.failedCount > 0 ? `${s.failedCount} 个会话已失败/已终止；点击进入画像页，可对失败会话重试（续传保留进度）` : '无失败/终止会话'"
                @click.stop="openSubPage('virtual', s.id)"
              >{{ s.failedCount }}</button>
            </td>
            <td v-if="!isNarrow" class="mk-num">
              <span v-if="s.stalledCount > 0" class="mk-badge mk-badge--sm mk-badge--bad" :title="`${s.stalledCount} 个进行中会话已卡死（超过回收阈值无写入），可在状态条一键回收`">卡死 {{ s.stalledCount }}</span>
              <span v-else class="mk-na" title="无卡死会话">—</span>
            </td>
            <td v-if="!isNarrow" class="mk-na">{{ s.created }}</td>
            <td>
              <div class="mk-actions mk-actions--left">
                <!-- live：整行点击即进入画像详情，此处只留真正的行内操作（运行 / 测试 / 更多）
                     —— 原型 .btn--sm 文字钮词汇（原 mk-icon-btn--text 是图标钮套文字的混搭） -->
                <button
                  v-if="isLive"
                  type="button"
                  class="mk-btn mk-btn--sm"
                  :class="{ 'vl-op--muted': s.storyCount === 0 }"
                  :title="s.storyCount === 0 ? '需先生成故事才能运行' : '运行：启动一次新的实验会话（不影响已有会话）'"
                  @click.stop="openLaunch(s)"
                ><Play :size="14" :stroke-width="1.75" /><span>{{ s.storyCount === 0 ? '需故事' : '运行' }}</span></button>
                <button
                  v-if="isLive"
                  type="button"
                  class="mk-btn mk-btn--sm"
                  :title="`单步测试：用「${s.name}」的人设和故事直接跑一次 Prompt 对话，看字段产出是否符合预期（不创建用例、不影响正式会话）`"
                  @click.stop="openPromptTest(s)"
                ><SquareCheckBig :size="14" :stroke-width="1.75" /><span>测试</span></button>
                <div v-if="isLive" class="mk-menu">
                  <button type="button" class="mk-menu__btn" aria-label="更多操作（删除）" aria-haspopup="menu" :aria-expanded="menuOpen" :title="'更多操作：删除（不可恢复）'" @click.stop="toggleMenu(s.id)">⋯</button>
                  <div v-if="openMenu === s.id" class="mk-menu__pop" :style="popStyle" @click.stop>
                    <button type="button" class="mk-menu__item mk-menu__item--danger" :disabled="busyId === s.id" title="删除该虚拟学习者（级联删除，不可恢复）" @click="menuRemove(s)">删除</button>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>

      <MkEmptyState
        v-else-if="loadFailed"
        icon="◌"
        title="虚拟学习者加载失败"
        description="无法从后端拉取虚拟学习者列表。"
        action-text="重试"
        @action="retryLoad"
      />
      <MkEmptyState
        v-else
        :title="samples.length ? '当前筛选无虚拟学习者' : '暂无虚拟学习者'"
        :description="samples.length
          ? '当前筛选条件下没有匹配的虚拟学习者；可换关键词或清除筛选后重试。'
          : '新建虚拟学习者后，在画像页生成故事即可运行。'"
        :action-text="isFiltered && samples.length ? '清除筛选' : ''"
        @action="clearFilters"
      />
      <!-- 客户端分页（统一 mk-pagination 页码器）：筛选后按页切片 -->
      <Pagination
        v-if="filtered.length"
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="filtered.length"
        :showTotal="true"
      />
    </div>

    <!-- 批量操作条（全局 mk-batchbar：选中后底部浮现） -->
    <VirtualLearnerBatchBar
      v-if="isLive && selected.length"
      v-model:selected="selected"
      :samples="samples"
      @reclaim="onBatchReclaim"
    />

    <!-- 一键回收 / 新建 / 启动 / 批量新建 / 单步测试：拆分为独立子组件（各自 Teleport 到 body）。 -->
    <VirtualLearnerReclaim ref="reclaimRef" @done="onReclaimDone" />
    <VirtualLearnerCreate ref="createRef" />
    <VirtualLearnerLaunch ref="launchRef" />
    <VirtualLearnerBatchCreate ref="batchCreateRef" />
    <VirtualLearnerPromptTest ref="promptRef" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, watch, nextTick, onUnmounted } from 'vue'
import { Play, SquareCheckBig } from 'lucide-vue-next'
import { openSubPage, intent, isLive } from './store'
import { liveVirtuals, liveDeleteVirtual, liveLoading, liveFailures, loadLiveData, timeAgo, errMsg, shortId, liveVirtualsTotal, liveVirtualSessionStats, liveVirtualStaleCount, liveVirtualRunStats, liveAutopilotConcurrency } from './live'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { useRowMenu } from './useRowMenu'
import { useIsNarrow } from './useIsNarrow'
import { useSafePolling } from '@/composables/useSafePolling'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import SimulatedDaySettings from './SimulatedDaySettings.vue'
import { useTableSort } from './useTableSort'
import RunStateBadge from './RunStateBadge.vue'
import RunStageBar from './RunStageBar.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import VirtualLearnerRunningBar from './VirtualLearnerRunningBar.vue'
import VirtualLearnerReclaim from './VirtualLearnerReclaim.vue'
import VirtualLearnerCreate from './VirtualLearnerCreate.vue'
import VirtualLearnerLaunch from './VirtualLearnerLaunch.vue'
import VirtualLearnerBatchCreate from './VirtualLearnerBatchCreate.vue'
import VirtualLearnerBatchBar from './VirtualLearnerBatchBar.vue'
import VirtualLearnerPromptTest from './VirtualLearnerPromptTest.vue'
import type { VirtualLearnerRow as Sample, BatchTask } from './virtualLearnersTypes'

/* 头像色板：按名称哈希取色，同一人恒定同色（此处仅取 length 做哈希模，
   色值真身在 .vl-avatar--N 样式，两处须同步；走查 2026-09-27 加深至白字对比度 ≥4.5:1） */
const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#047857', '#b45309', '#dc2626', '#0e7490', '#db2777', '#64748b']
function avatarClass(s: Sample): string {
  let h = 0
  for (let i = 0; i < s.name.length; i++) h = (h * 31 + s.name.charCodeAt(i)) >>> 0
  return `vl-avatar--${h % AVATAR_COLORS.length}`
}

const samples = computed<Sample[]>(() =>
  liveVirtuals.value.map((v) => ({
    id: v.id,
    name: v.name,
    goal: v.goal,
    storyCount: Number(v.storyCount || 0),
    sessions: v.sessions,
    runningCount: Number(v.runningCount || 0),
    pausedCount: Number(v.pausedCount || 0),
    failedCount: Number(v.failedCount || 0),
    stalledCount: Number(v.stalledCount || 0),
    runningSessionIds: v.runningSessionIds,
    currentStage: v.currentStage || null,
    createdAt: String(v.createdAt || ''),
    created: timeAgo(v.createdAt)
  }))
)

const keyword = ref('')
/** 状态过滤（轴 A 生命周期）：'' = 全部 / running / paused / queued / failed / created */
const stateFilter = ref('')
/** 状态过滤 chips 计数（与 samples 联动） */
const stateFilterOptions = computed(() => {
  const count = (pred: (s: Sample) => boolean) => samples.value.filter(pred).length
  return [
    { key: '', label: '全部', count: samples.value.length },
    { key: 'running', label: '进行中', count: count((s) => s.runningCount > 0) },
    { key: 'paused', label: '已暂停', count: count((s) => (s.pausedCount ?? 0) > 0) },
    { key: 'failed', label: '需关注', count: count((s) => s.failedCount > 0) },
  ]
})
/** live 虚拟人域拉取失败（且列表为空）→ 错误态；空态只在真正无数据时展示 */
const loadFailed = computed(
  () => isLive.value && !liveLoading.value && !!liveFailures.value.virtuals && !liveVirtuals.value.length
)
function retryLoad() {
  void loadLiveData()
}
/* 客户端排序：数据全量在客户端（live 全量拉取）→ 排序诚实。
   默认保持服务端顺序（创建时间倒序）；点表头切换，状态 localStorage 记忆。 */
const { toggle: toggleVlSort, sortState: vlSortState, sortRows: sortVlRows } = useTableSort<Sample>({
  accessors: {
    name: (s) => s.name,
    story: (s) => s.storyCount,
    sessions: (s) => s.sessions,
    running: (s) => s.runningCount,
    failed: (s) => s.failedCount,
    stalled: (s) => s.stalledCount,
    created: (s) => (s.createdAt ? new Date(s.createdAt).getTime() : null)
  },
  storageKey: 'wf_virtual_learners_sort'
})

const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  let list = samples.value
  if (q) list = list.filter((s) => `${s.name} ${s.goal} ${s.id}`.toLowerCase().includes(q))
  const sf = stateFilter.value
  if (sf === 'running') list = list.filter((s) => s.runningCount > 0)
  else if (sf === 'paused') list = list.filter((s) => s.runningCount === 0 && (s.pausedCount ?? 0) > 0)
  else if (sf === 'failed') list = list.filter((s) => s.failedCount > 0)
  // queued：预留（服务端排队实现后接入）
  return sortVlRows(list)
})

const isFiltered = computed(() => !!keyword.value.trim() || !!stateFilter.value)
function clearFilters() {
  keyword.value = ''
  stateFilter.value = ''
}

/* 长列表分批渲染：每批 15 行 */
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

/* ===== 拆分子组件引用与父侧触发入口（弹窗状态在子组件内，父页面只发指令） ===== */
const createRef = ref<InstanceType<typeof VirtualLearnerCreate> | null>(null)
const launchRef = ref<InstanceType<typeof VirtualLearnerLaunch> | null>(null)
const reclaimRef = ref<InstanceType<typeof VirtualLearnerReclaim> | null>(null)
const batchCreateRef = ref<InstanceType<typeof VirtualLearnerBatchCreate> | null>(null)
const promptRef = ref<InstanceType<typeof VirtualLearnerPromptTest> | null>(null)

/** 批量创建后台任务（子组件 reactive 对象）→ 顶部「正在运行」条展示 */
const batchTask = computed<BatchTask | null>(() => batchCreateRef.value?.task ?? null)

function openCreate() { createRef.value?.open() }
function openBatchCreate() { batchCreateRef.value?.open() }
function openReclaimModal() { void reclaimRef.value?.open() }
function onReclaimDone() { selected.value = [] }
function openLaunch(s: Sample) { void launchRef.value?.open(s) }
function openPromptTest(s: Sample) {
  closeMenu()
  promptRef.value?.open(s)
}

async function removeSample(s: Sample) {
  const ok = await askConfirm({
    title: '删除虚拟学习者',
    message: `确认删除虚拟学习者「${s.name}」？\n其会话记录将一并清理，该操作不可撤销。`,
    confirmText: '删除',
    busy: true
  })
  if (!ok) return
  busyId.value = s.id
  try {
    await liveDeleteVirtual(s.id)
    toast.success(`「${s.name}」已删除`)
    doneConfirm()
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
    failConfirm()
  } finally {
    busyId.value = null
  }
}

/* AI 生成身份、新建弹窗、单步测试、启动实验均收敛到子组件；此处只保留行内删除互斥标志 */
/** 正在删除的样本 id（ref 驱动 :disabled，computed map 出的普通对象上写 busy 不触发重渲染） */
const busyId = ref<string | null>(null)

/* ===== A1 行内 ⋯ 菜单：先关菜单再执行删除 ===== */
const { openMenu, toggleMenu, closeMenu, menuOpen, popStyle } = useRowMenu()
function menuRemove(s: Sample) {
  closeMenu()
  void removeSample(s)
}

/* 窄屏（≤720）：10 列只保留「名称 / 进行中 / 操作」，次要列（勾选/倾向/故事池/会话/
   失败/卡死/创建）随 useIsNarrow 隐藏——此前整表 860px 最小宽只能横向拖（vlab 大表
   窄屏零降级问题）；行详情（画像页）信息不丢 */
const isNarrow = useIsNarrow()

/* ===== intent 快捷动作：直达并打开新建弹窗（子组件挂载后触发，保持深链行为） ===== */
watch(
  () => intent.quickAction,
  async (a) => {
    if (a === 'create-virtual') {
      intent.quickAction = ''
      await nextTick()
      createRef.value?.open()
    }
  },
  { immediate: true }
)

/** 自动驾驶并发配额条数据（used/limit/queued + 分档色调） */
const concurrency = computed(() => ({
  used: Number(liveAutopilotConcurrency.value?.used ?? 0),
  limit: Math.max(1, Number(liveAutopilotConcurrency.value?.limit ?? 5)),
  queued: Number(liveAutopilotConcurrency.value?.queued ?? 0),
}))
const concurrencyPct = computed(() => Math.min(100, Math.round((concurrency.value.used / concurrency.value.limit) * 100)))
const concurrencyTone = computed(() => {
  const pct = concurrencyPct.value
  if (pct >= 100) return 'full'
  if (pct >= 70) return 'warn'
  return 'ok'
})

/* 虚拟学习者专属出站速率（RPM）：设置 + 运行态。与平台全局速率相互独立。 */
const vlRpm = reactive({ limit: 0, inFlight: 0, queued: 0, rpm: 0 })
/* 轮询回填保护：limit 是输入框 v-model（写控件），若 10s 轮询无条件覆写，
   会冲掉管理员正在输入/未保存的值 → 仅在非聚焦且无未保存编辑时回填 limit，
   rpm/inFlight/queued 是只读展示字段，始终照常刷新 */
const vlRpmFocused = ref(false)
const vlRpmDirty = ref(false)
async function loadVlRpm() {
  try {
    const res = await adminVirtualLearnersApi.getVirtualLabSettings()
    const d = res.data?.data ?? {}
    const s = d.settings ?? {}
    const r = d.rpm ?? {}
    if (!vlRpmFocused.value && !vlRpmDirty.value) {
      vlRpm.limit = Number(s.virtualLearnerRpmLimit ?? 0)
    }
    vlRpm.rpm = Number(r.rpm ?? 0)
    vlRpm.inFlight = Number(r.inFlight ?? 0)
    vlRpm.queued = Number(r.queued ?? 0)
  } catch { /* 保留上次值 */ }
}
async function saveVlRpm() {
  const value = Math.max(0, Math.min(100000, Math.round(Number(vlRpm.limit) || 0)))
  vlRpm.limit = value
  try {
    const res = await adminVirtualLearnersApi.updateVirtualLabSettings({ virtualLearnerRpmLimit: value })
    vlRpmDirty.value = false /* 已保存：服务端值与输入一致，恢复轮询回填 */
    const r = res.data?.data?.rpm
    if (r) {
      vlRpm.rpm = Number(r.rpm ?? value)
      vlRpm.inFlight = Number(r.inFlight ?? 0)
      vlRpm.queued = Number(r.queued ?? 0)
    }
    toast.success(value > 0 ? `虚拟学习者 RPM 上限已设为 ${value}` : '虚拟学习者 RPM 已设为不限')
  } catch (e) {
    toast.error(errMsg(e) || '保存失败')
  }
}
const vlRpmPolling = useSafePolling(() => loadVlRpm(), {
  interval: 10000,
  maxBackoff: 30000,
  circuitBreakerThreshold: 5,
  skipWhenHidden: true,
  immediate: true
})
vlRpmPolling.start()
// 离开页面必须停：轮询是组件级副作用，卸载后继续打接口会打到已卸载页（泄漏到下一个页面）
onUnmounted(() => vlRpmPolling.stop())

/** 当前有活跃会话的虚拟学习者（"正在运行"条直接列名） */
const runningSamples = computed(() => samples.value.filter((s) => s.runningCount > 0))
/** 已暂停自动驾驶的虚拟人：无进行中会话，但有暂停会话（autopilot=stopped） */
const pausedSamples = computed(() => samples.value.filter((s) => s.runningCount === 0 && (s.pausedCount ?? 0) > 0))

/* ===== A2 生命周期分区：全量聚合口径（后端 sessionStats/staleCount），替代样本口径状态条 ===== */
const partition = computed(() => {
  const st = liveVirtualSessionStats.value
  return {
    created: st.created,
    running: st.running,
    stale: liveVirtualStaleCount.value
  }
})

/* ===== A5 运行统计：完成率/失败率/平均时长/卡死最长分钟（GET /virtual-learners/stats） ===== */
const runStats = computed(() => liveVirtualRunStats.value)

/** 状态筛选（页头 meta-link）：进行中/已暂停/需关注；点激活项取消筛选 */
const statePillOptions = computed(() => stateFilterOptions.value.filter((o) => o.key))

/** 并发文案：used/limit（满 / 排队） */
const concurrencyText = computed(() => {
  const c = concurrency.value
  if (c.queued > 0) return `${c.used}/${c.limit} · 排队 ${c.queued}`
  if (c.used >= c.limit) return `${c.used}/${c.limit} · 已满`
  return `${c.used}/${c.limit}`
})

/** 速率文案：在途 / 上限 RPM（排队） */
const rateText = computed(() => {
  const cap = vlRpm.limit ? `${vlRpm.limit} RPM` : '不限'
  return vlRpm.queued > 0
    ? `${vlRpm.inFlight} 在途 / ${cap} · 排队 ${vlRpm.queued}`
    : `${vlRpm.inFlight} 在途 / ${cap}`
})

/** 「今日调用」卡的 hint：有调用给平均耗时（派生口径，数字不复述），没有就点明计数口径 */
const todayCallsHint = computed(() => {
  const s = runStats.value
  if (!s.todayCalls) return '虚拟/测试账号口径'
  const ms = s.avgDurationMs
  const human = ms >= 60000 ? `${Math.round(ms / 60000)} 分钟` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} 秒` : `${Math.round(ms)} 毫秒`
  return `平均耗时 ${human}`
})

/** 运行指标已改走共享 KPI 栅格（模板内 MkKpi ×5）：原先的 MkStatStrip 自由指标条
 *  （含下面这份 runStatItems）已删除，口径数据（全量会话/系统失败/人为终止/平均耗时）
 *  改为卡片 hint 直接取 runStats 字段。 */

/* 仿真概览结论已收敛到单行状态条（KPI/结论随状态条 meta 展示，双块移除） */

/* ===== A1 批量操作：复选框（批量条拆分为 VirtualLearnerBatchBar 子组件） ===== */
const selected = ref<string[]>([])
const selectable = computed(() => filtered.value)
const allChecked = computed(() => selectable.value.length > 0 && selected.value.length === selectable.value.length)

function toggleAll() {
  selected.value = allChecked.value ? [] : selectable.value.map((s) => s.id)
}

/** 批量条子组件请求清理卡死：打开回收弹窗（dryRun 清单） */
function onBatchReclaim(ids: string[]) {
  void reclaimRef.value?.open(ids)
}

/** 「进行中」列点击直达会话座舱（画像页入口保持：行点击/画像按钮）。
 *  仅暂停行（无进行中 id）回退到已暂停会话 id：徽章 title 承诺「点击进入会话座舱」，
 *  否则该行点击无响应，等于一个说了不做的交互承诺 */
function openRunningSession(s: Sample) {
  const id = s.runningSessionIds[0] || s.pausedSessionIds?.[0]
  if (id) openSubPage('session', id)
}
</script>

<style scoped>
/* 操作列已换 .mk-btn--sm 文字钮（原型 .btn--sm 词汇），图标对齐微调：
   mk-btn 给 svg 的 6px 右距在本钮偏松，收到与文字同组的 4px */
.mk-actions .mk-btn--sm svg { margin-right: 4px; }
/* 无故事的「运行」弱化档（原 mk-link--muted 是链接词汇，误用在按钮上） */
.vl-op--muted { color: var(--mk-muted); }
/* 窄屏表格：8 列在 704px 内容区会被压扁操作列，设 min-width 触发 .mk-table-scroll 横向滚动（对齐 AuditLogs 模式） */
.mk-table-scroll .mk-table { min-width: 860px; }
/* 窄屏（≤720）次要列已随 useIsNarrow 隐藏，仅剩 3 列可完整放下，不再强制最小宽 */
@media (max-width: 720px) {
  .mk-table-scroll .mk-table { min-width: 0; }
}
.vl-row { cursor: pointer; }
/* 长期倾向列：自动布局下给 px 截断上限（原 max-width:100% 依赖 fixed 列宽才成立）；
   空值统一「未设置」降噪（ADMIN_COLUMN_WIDTH_AUDIT ⑤） */
.vl-goal {
  display: inline-block;
  max-width: 240px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}
.vl-goal--empty { color: var(--mk-faint); font-size: var(--mk-fs-micro); }
/* 状态列：进行中胶囊 / 失败数 / 卡死徽章 分列展示（一列一语义）；gap+wrap 归并为一处定义 */
.vl-state-cell { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-height: 26px; }
.vl-run {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-faint);
  white-space: nowrap;
}
/* 失败列：全量聚合数字（>0 标红，可点击直达画像页的重试入口）；hover 环走 token（原 #eff6ff 硬编码无暗色适配） */
.vl-num--bad { color: var(--mk-red, #dc2626); font-weight: 800; }
.vl-faillink {
  border: 0;
  /* 走查 2026-09-27：数字裸按钮可点区仅约 9×25px，宽度远低于 24px 下限——
     补横向 padding 与 24px 最小可点尺寸，视觉仍是行内紧凑数字 */
  padding: 0 9px;
  min-width: 24px;
  min-height: 24px;
  background: transparent;
  font: inherit;
  cursor: pointer;
  border-radius: 4px;
  transition: color 0.12s ease, background 0.12s ease;
}
.vl-faillink:hover { color: var(--mk-blue); background: var(--mk-blue-bg); box-shadow: 0 0 0 3px color-mix(in srgb, var(--mk-blue) 18%, transparent); }

/* 运行指标带：KPI 独占整行（共享 .mk-kpi-grid + MkKpi，卡自带面/描边，外层不套盒子）；
   下一行是 VL RPM 写控件（读/写分块），一行小字说明口径，省掉只有 hover 才看得见的 title */
.vl-kpi {
  display: grid;
  gap: 8px;
  flex: none;
}
.vl-rpm {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.vl-rpm__label {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--mk-muted);
  white-space: nowrap;
}
.vl-rpm__input { width: 84px; }
.vl-rpm__hint {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 表格已换自动布局（原型 .tbl 词汇），fixed/colgroup 的列宽变量覆写随之删除；
   长内容截断上限收敛到各内容类（.vl-goal / .mk-cell-main strong） */
.vl-truncated { color: var(--mk-amber); font-weight: 700; }

/* 走查 2026-09-27：「正在运行」条胶囊按钮由子组件 VirtualLearnerRunningBar 渲染，
   实测高 23px 低于 24px 可点下限——本页 :deep 提最小高度补足 1px，padding 不动、视觉不变 */
.vl-running :deep(.vl-running__chip) { min-height: 24px; }

/* 名称头像：按名字哈希取色，同一人恒定同色。
   色板整改（走查 2026-09-27）：彩底白字对比度须 ≥4.5:1，各色保持色相加深至达标
   （emerald/amber/cyan 需取 700 档；slate 原 #64748b 已 4.76:1 达标不动），
   26px 尺寸不变；行尾为对比白的前后比值，与 JS 侧 AVATAR_COLORS 同步维护 */
.vl-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--mk-on-fill);
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  flex-shrink: 0;
}
.vl-avatar--0 { background: #2563eb; } /* 蓝 3.68→5.17 */
.vl-avatar--1 { background: #7c3aed; } /* 紫 4.23→5.70 */
.vl-avatar--2 { background: #047857; } /* 绿 2.54→5.48 */
.vl-avatar--3 { background: #b45309; } /* 琥珀 2.15→5.02 */
.vl-avatar--4 { background: #dc2626; } /* 红 3.76→4.83 */
.vl-avatar--5 { background: #0e7490; } /* 青 2.43→5.36 */
.vl-avatar--6 { background: #db2777; } /* 粉 3.53→4.60 */
.vl-avatar--7 { background: #64748b; } /* 灰 4.76 原值已达标 */
.vl-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
/* 名称列可点击进二级（整行不再监听点击，避免多选勾选时误触） */
.vl-cell--click { cursor: pointer; border-radius: 6px; transition: background 0.12s ease; }
.vl-cell--click:hover { background: color-mix(in srgb, var(--mk-blue) 6%, transparent); }
.vl-cell--click:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 1px; }
.vl-name__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* 暗色模式：全量走 var(--mk-*) token（faillink hover 也已 token 化），不再需要页面补丁 */
</style>
