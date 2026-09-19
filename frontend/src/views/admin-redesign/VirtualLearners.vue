<template>
  <div class="mk-page mk-page--fill">
    <div class="mk-status" :class="samples.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">虚拟学习者</strong>
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
      <span class="mk-status__actions">
        <button
          v-if="partition.stale > 0"
          type="button"
          class="mk-status__action"
          :disabled="reclaimRef?.state.busy"
          :title="'干跑确认清单后批量标记卡死会话为失败'"
          @click="openReclaimModal()"
        >
          {{ reclaimRef?.state.busy ? '回收中…' : `回收卡死（${partition.stale}）` }}
        </button>
        <button type="button" class="mk-status__action mk-status__action--primary" title="新建虚拟学习者：填写名称/目标/故事，生成后可运行实验会话" @click="openCreate">新建</button>
        <button type="button" class="mk-status__action" title="批量新建：一次创建多个虚拟学习者（表格批量填写）" @click="openBatchCreate">批量新建</button>
      </span>
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
        <div class="mk-card__head-right vl-head-stats">
          <!-- 分格指标条：复用 MkStatStrip（标签在上/数值在下的层级 + 窄屏换行），
               取代此前把 5 项指标用 `·` 串成一行的 .vl-runstats —— 后者 nowrap 叠加
               卡头 flex-shrink:0，整条宽度溢出卡片后被 .mk-card 的 overflow:clip 裁掉
               （即「18 / 18 人 · 点…」被切断的成因）。 -->
          <MkStatStrip :items="runStatItems" />
          <!-- VL RPM 是「写」控件，与只读指标条以竖线分隔，避免读/写混作一行 -->
          <label class="vl-rpm" title="虚拟学习者专属出站 RPM 上限（0=不限）；与平台全局速率相互独立，不会挤占真实用户额度">
            <span class="vl-rpm__label">VL RPM</span>
            <input v-model.number="vlRpm.limit" type="number" min="0" max="100000" step="10" class="mk-filter__input vl-rpm__input" @change="saveVlRpm" />
          </label>
        </div>
      </div>

      <SimulatedDaySettings />

      <MockSkeletonTable v-if="liveLoading && !samples.length" :cols="6" />
      <div v-else-if="filtered.length" class="mk-table-scroll vl-table-scroll">
      <table class="mk-table mk-table--click mk-table--fixed">
        <colgroup>
          <col v-if="isLive" style="width:32px">
          <!-- 文本列（虚拟学习者 / 长期倾向）：auto 吸收列，共享剩余宽度；
               固定 token 只用于徽章/数字/时间/操作列。 -->
          <col style="width:var(--mk-col-text)">
          <col style="width:var(--mk-col-text)">
          <col style="width:var(--mk-col-badge)">
          <col style="width:var(--mk-col-num)">
          <col style="width:var(--mk-col-flex-min)">
          <col style="width:var(--mk-col-num)">
          <col style="width:var(--mk-col-num)">
          <col style="width:var(--mk-col-time-full)">
          <col style="width:var(--mk-col-actions-wide)">
        </colgroup>
        <thead>
          <tr>
            <th v-if="isLive" scope="col">
              <input type="checkbox" aria-label="全选" :checked="allChecked" @change="toggleAll" />
            </th>
            <th
              scope="col"
              class="mk-th--sortable"
              :aria-sort="vlSortState('name')"
              @click="toggleVlSort('name')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('name')">虚拟学习者<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th>长期倾向</th>
            <th
              scope="col"
              class="mk-th--sortable"
              :aria-sort="vlSortState('story')"
              @click="toggleVlSort('story')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('story')">故事池<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
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
              scope="col"
              class="mk-th--right mk-th--sortable"
              title="已失败/已终止会话数（全量聚合）"
              :aria-sort="vlSortState('failed')"
              @click="toggleVlSort('failed')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('failed')">失败<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              scope="col"
              class="mk-th--right mk-th--sortable"
              title="超过回收阈值无写入且无活跃租约的会话数（可在状态条一键回收）"
              :aria-sort="vlSortState('stalled')"
              @click="toggleVlSort('stalled')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('stalled')">卡死<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
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
            <td v-if="isLive"><input v-model="selected" type="checkbox" :value="s.id" :aria-label="`选择 ${s.name}`" @click.stop /></td>
            <td>
              <div class="mk-cell-main vl-cell vl-cell--click" role="button" tabindex="0" :title="`查看 ${s.name} 的画像：故事池 / 运行记录 / 会话控制`" @click="openSubPage('virtual', s.id)" @keydown.enter="openSubPage('virtual', s.id)">
                <strong class="vl-name">
                  <span class="vl-avatar" :class="avatarClass(s)" aria-hidden="true">{{ s.name.slice(0, 1) }}</span>
                  <span class="vl-name__text">{{ s.name }}</span>
                </strong>
                <span class="mk-cell-sub">{{ shortId(s.id) }}</span>
              </div>
            </td>
            <td>
              <span class="vl-goal" :class="{ 'vl-goal--empty': !s.goal || s.goal === '—' }" :title="s.goal || undefined">{{ s.goal || '未设置' }}</span>
            </td>
            <td>
              <span class="mk-badge" :class="s.storyCount > 0 ? 'mk-badge--ok' : 'mk-badge--muted'">
                {{ s.storyCount > 0 ? `${s.storyCount} 条` : '未生成' }}
              </span>
            </td>
            <td class="mk-num">{{ s.sessions }}</td>
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
                <span
                  v-if="s.simulation?.enabled"
                  class="mk-badge mk-badge--sm"
                  :title="`日期模拟：第 ${s.simulation.dayIndex} 天${s.simulation.baseDate ? ' · 起点 ' + s.simulation.baseDate : ''}${s.simulation.autoAdvance ? ' · 自动推进' : ''}`"
                >模拟 第 {{ s.simulation.dayIndex }} 天</span>
              </div>
            </td>
            <td class="mk-num">
              <button
                type="button"
                class="vl-faillink mk-num"
                :class="{ 'vl-num--bad': s.failedCount > 0 }"
                :title="s.failedCount > 0 ? `${s.failedCount} 个会话已失败/已终止；点击进入画像页，可对失败会话重试（续传保留进度）` : '无失败/终止会话'"
                @click.stop="openSubPage('virtual', s.id)"
              >{{ s.failedCount }}</button>
            </td>
            <td class="mk-num">
              <span v-if="s.stalledCount > 0" class="mk-badge mk-badge--sm mk-badge--bad" :title="`${s.stalledCount} 个进行中会话已卡死（超过回收阈值无写入），可在状态条一键回收`">卡死 {{ s.stalledCount }}</span>
              <span v-else class="mk-na" title="无卡死会话">—</span>
            </td>
            <td class="mk-na">{{ s.created }}</td>
            <td>
              <div class="mk-actions mk-actions--left">
                <!-- live：整行点击即进入画像详情，此处只留真正的行内操作（运行 / 测试 / 更多） -->
                <button
                  v-if="isLive"
                  type="button"
                  class="mk-icon-btn mk-icon-btn--text"
                  :class="{ 'mk-link--muted': s.storyCount === 0 }"
                  :title="s.storyCount === 0 ? '需先生成故事才能运行' : '运行：启动一次新的实验会话（不影响已有会话）'"
                  @click.stop="openLaunch(s)"
                ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l14 8-14 8V4z"/></svg><span>{{ s.storyCount === 0 ? '需故事' : '运行' }}</span></button>
                <button
                  v-if="isLive"
                  type="button"
                  class="mk-icon-btn mk-icon-btn--text"
                  :title="`单步测试：用「${s.name}」的人设和故事直接跑一次 Prompt 对话，看字段产出是否符合预期（不创建用例、不影响正式会话）`"
                  @click.stop="openPromptTest(s)"
                ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg><span>测试</span></button>
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
        description="新建虚拟学习者后，在画像页生成故事即可运行。"
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
import { computed, ref, reactive, watch, nextTick } from 'vue'
import { openSubPage, intent, isLive } from './store'
import { liveVirtuals, liveDeleteVirtual, liveLoading, liveFailures, loadLiveData, timeAgo, errMsg, shortId, liveVirtualsTotal, liveVirtualSessionStats, liveVirtualStaleCount, liveVirtualRunStats, liveAutopilotConcurrency } from './live'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { useRowMenu } from './useRowMenu'
import { useSafePolling } from '@/composables/useSafePolling'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkStatStrip from '@/components/mk/MkStatStrip.vue'
import type { MkStatItem } from '@/components/mk/MkStatStrip.vue'
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

/* 头像色板：按名称哈希取色，同一人恒定同色 */
const AVATAR_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#64748b']
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
async function loadVlRpm() {
  try {
    const res = await adminVirtualLearnersApi.getVirtualLabSettings()
    const d = res.data?.data ?? {}
    const s = d.settings ?? {}
    const r = d.rpm ?? {}
    vlRpm.limit = Number(s.virtualLearnerRpmLimit ?? 0)
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
    failed: st.failed + st.abandoned,
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

/** 卡头分格指标条（MkStatStrip）：完成率 / 失败率 / 并发 / 今日调用 / 速率 / 学习者。
 *  失败率、并发沿用原有分档着色（>0 标红、满额标红、≥70% 标琥珀），口径与 .vl-runstats 时期一致。 */
const runStatItems = computed<MkStatItem[]>(() => [
  {
    label: '完成率',
    value: `${runStats.value.completionRate ?? 0}%`,
    title: '全量口径：已完成会话 / 全部会话'
  },
  {
    label: '失败率',
    value: `${runStats.value.systemFailureRate ?? 0}%`,
    tone: (runStats.value.systemFailureRate ?? 0) > 0 ? 'bad' : '',
    title: '全量口径：系统失败占比（>0 标红）'
  },
  {
    label: '并发',
    value: concurrencyText.value,
    tone: concurrencyTone.value === 'full' ? 'bad' : concurrencyTone.value === 'warn' ? 'warn' : 'ok',
    title: '自动驾驶并发配额：使用中 / 上限（满额标红，≥70% 标琥珀）'
  },
  {
    label: '今日调用',
    value: runStats.value.todayCalls ?? 0,
    title: '全量口径：今日 AI 调用次数'
  },
  {
    label: '速率',
    value: rateText.value,
    title: '虚拟学习者出站速率：在途 / 上限 RPM（与右侧 VL RPM 上限对应）'
  },
  {
    label: '学习者',
    value: `${filtered.value.length} / ${samples.value.length}`,
    title: '当前筛选后的行数 / 总数；点击行查看画像'
  }
])

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

/** 「进行中」列点击直达会话座舱（画像页入口保持：行点击/画像按钮） */
function openRunningSession(s: Sample) {
  const id = s.runningSessionIds[0]
  if (id) openSubPage('session', id)
}
</script>

<style scoped>
/* 操作列：图标+文字标签按钮 */
.mk-actions .mk-icon-btn--text {
  width: auto;
  padding: 0 5px;
  gap: 3px;
  font-size: var(--mk-fs-11);
  color: var(--mk-faint);
}
.mk-actions .mk-icon-btn--text span { font-size: var(--mk-fs-11); }
.mk-actions .mk-icon-btn--text svg { width: 13px; height: 13px; }
/* 窄屏表格：8 列在 704px 内容区会被压扁操作列，设 min-width 触发 .mk-table-scroll 横向滚动（对齐 AuditLogs 模式） */
.mk-table-scroll .mk-table { min-width: 860px; }
.vl-row { cursor: pointer; }
/* 长期倾向列：单行截断 + title（原可换行撑高行，ADMIN_COLUMN_WIDTH_AUDIT ⑤）；空值统一「未设置」降噪 */
.vl-goal {
  display: inline-block;
  max-width: var(--mk-cell-main-max);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}
.vl-goal--empty { color: var(--mk-faint); font-size: var(--mk-fs-12); }
/* 状态列：进行中胶囊 / 失败数 / 卡死徽章 分列展示（一列一语义） */
.vl-state-cell { display: flex; align-items: center; min-height: 26px; }
.vl-run {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--mk-fs-12);
  font-weight: 700;
  color: var(--mk-faint);
  white-space: nowrap;
}
/* 失败列：全量聚合数字（>0 标红，可点击直达画像页的重试入口） */
.vl-num--bad { color: var(--mk-red, #dc2626); font-weight: 800; }
.vl-faillink {
  border: 0;
  padding: 0;
  background: transparent;
  font: inherit;
  cursor: pointer;
  border-radius: 4px;
  transition: color 0.12s ease, background 0.12s ease;
}
.vl-faillink:hover { color: var(--mk-blue); background: #eff6ff; box-shadow: 0 0 0 3px #eff6ff; }
/* .mk-num--na 已收敛到既有全局 .mk-na（同一张表里两个类表达同一概念） */

/* 卡头右组：内容为「分格指标条 + VL RPM 控件」，必须允许收缩并换行。
   全局 .mk-card__head-right 是 flex-shrink:0（适合单个按钮/短 meta），在本页
   会把整条顶出卡片宽度，再被 .mk-card 的 overflow:clip 裁掉（截断的真正成因）。 */
.vl-head-stats {
  flex-shrink: 1;
  min-width: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}
/* VL RPM（写控件）：与只读指标条以竖线分隔，避免读/写混作一行 */
.vl-rpm {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-left: 12px;
  border-left: 1px solid var(--mk-line);
}
.vl-rpm__label {
  font-size: var(--mk-fs-11);
  font-weight: 600;
  color: var(--mk-faint);
  white-space: nowrap;
}
.vl-rpm__input { width: 72px; }
/* VL 语境收窄文本列：两列 --mk-col-text 320→200，列宽和 1314→1074，
   避免「操作」列越出内容区（超出时仍由 .mk-table-scroll 横向滚动兜底）。 */
.vl-table-scroll { --mk-col-text: 200px; }
.vl-state-cell { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.vl-truncated { color: var(--mk-amber); font-weight: 700; }

/* 名称头像：按名字哈希取色，同一人恒定同色 */
.vl-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: var(--mk-fs-12);
  font-weight: 800;
  flex-shrink: 0;
}
.vl-avatar--0 { background: #3b82f6; }
.vl-avatar--1 { background: #8b5cf6; }
.vl-avatar--2 { background: #10b981; }
.vl-avatar--3 { background: #f59e0b; }
.vl-avatar--4 { background: #ef4444; }
.vl-avatar--5 { background: #06b6d4; }
.vl-avatar--6 { background: #ec4899; }
.vl-avatar--7 { background: #64748b; }
.vl-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
/* 名称列可点击进二级（整行不再监听点击，避免多选勾选时误触） */
.vl-cell--click { cursor: pointer; border-radius: 6px; transition: background 0.12s ease; }
.vl-cell--click:hover { background: rgba(44, 99, 208, 0.06); }
.vl-cell--click:focus-visible { outline: 2px solid rgba(44, 99, 208, 0.4); outline-offset: 1px; }
.vl-name__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* ================= 暗色模式（D1 补完）：虚拟学习者列表 ================= */
html[data-theme='dark'] {
  .vl-faillink:hover { background: rgba(91, 141, 239, 0.14); box-shadow: 0 0 0 3px rgba(91, 141, 239, 0.08); }
  /* 并发条 / 批量详情：已改用 var(--mk-*) token，暗色由全局 token 覆盖，不再需要页面补丁 */
}
</style>
