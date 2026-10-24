<template>
  <div class="mk-page mk-page--fill">
    <!-- 2026-10-04 用户拍板：学习状态从「用户与学习者」宿主 tab 释放为独立页（/admin/learner-state，
         同 2026-09-29 教学三页拆页先例）；旧深链 /admin/people?tab=state 与 /admin/learner-center、
         /admin/learner-models 由路由/宿主重定向兼容。一屏工作台：观测栏（KPI + 可点置信分段条）
         静态贴顶 + 表格区内滚，首行 530px 入首屏。 -->
    <MkPageHead title="学习状态" sub="学习者学习状态分布与风险跟踪">
      <template #actions>
        <!-- 口径开关已退役（2026-10-21 用户拍板「没有测试，测试只是备注」）：
             列表 = 全部非虚拟账号；虚拟学习者的学习数据只在虚拟学习者域看 -->
      </template>
    </MkPageHead>
    <!-- 后端学习者域窗口截断口径（2026-10-04 解锁 50→500；2026-10-10 窗口 500→2000，
         有多少加载多少）：只在真截断（total > 已载）时出现并给真实数字，全量加载后整条消失 -->
    <div v-if="learnerTotal != null && learnerTotal > liveLearners.length" class="mk-status mk-status--muted">
      <span class="mk-status__dot"></span>
      <span class="mk-status__meta" title="学习者列表单次加载有上限，搜索仅覆盖已显示的学习者">共 {{ learnerTotal }} 位学习者，当前显示前 {{ liveLearners.length }} 位</span>
    </div>
    <!-- 审核 #17（2026-10-06）：已有旧行时刷新失败此前无任何呈现（loadFailed 要求列表为空），
         页面继续把上次结果当当前值——补一条行内告警 + 重试出口（对照 Feedback.vue 行内告警判例） -->
    <div v-if="refreshFailed" class="mk-alert mk-alert--row" role="alert">
      <span class="mk-alert__msg">快照刷新失败，以下为上次结果。</span>
      <button type="button" class="mk-alert__btn" @click="retryLoad">重试</button>
    </div>

    <!-- 学习状态概览 KPI 带（2026-10-04 用户拍板：按同组形态拆出工作台卡到页级，
         页头/口径条之下、内容卡之上，与记忆复习 KPI 栅格同形同节拍） -->
    <section v-if="rows.length" class="mk-kpi-grid lc-kpi" aria-label="学习状态概览">
      <!-- P1#16 数据层已接线（live.ts liveLearnersTotal）：真窗口显「N · 已载 M」，total 未知才退「已加载 N」。
           审核 #13（2026-10-06）：label 改「学习者账号」。
           2026-10-15 KPI 审计：原 hint 写死「含虚拟学习者与测试账号」，与页头「真实/测试」互斥视角
           矛盾——真实视角下这是错的（读者会以为数里混了虚拟账号）。改为随视角条件式。 -->
      <MkKpi
        label="学习者账号"
        :value="learnerTotalText"
        :hint="learnerKpiHint"
      />
      <!-- P1#17：需关注收窄为真异常（趋势降 ∨ 疲劳高 ∨ 有风险摘要）；
           常态档「疲劳=中」拆到 pills 的「观察」，不再把需关注撑爆 -->
      <MkKpi label="需关注" :value="riskCount" :tone="riskCount ? 'warn' : ''" />
      <!-- 2026-10-21 用户「去掉；如果需要下方加字，那就说明这个卡片的标题起得不对」：
           卡名自带人群（学习者），阈值 50% 归 title 与「置信」列表头 -->
      <MkKpi
        label="低置信学习者"
        :value="lowConfCount"
        :tone="lowConfCount ? 'warn' : ''"
        :title="lowConfTitle"
      />
      <MkKpi
        label="平均置信度"
        :value="avgConfText"
        :hint="avgConfHint"
        :title="avgConfTitle"
      />
      <!-- 2026-10-23 用户「按你推荐走」：疲劳高 / 趋势下降两卡撤除——它们是「需关注」的
           构成项、常态为 0，单列只会把一整排读数摊成七张；需要看单项规模时用「风险摘要」
           列与「观察」pill。数据覆盖率保留：它限定平均置信度代表谁。 -->
      <MkKpi
        label="数据覆盖率"
        :value="confCoverageText"
        :tone="confCoverageText === '—' ? 'muted' : ''"
        :title="`有学习任务且产出置信度的学习者占比。无任务行不计入置信度分布与均值。本次 ${confRows.length} / ${rows.length} 位`"
      />
    </section>

    <!-- 置信度分布带已退役（2026-10-17 用户走查「学习状态也是」）：五档里当前三档为 0、
         实际只有 2 位有任务的学习者分坐两端，图上只剩两段；「低置信」chip 与可排序的
         「置信」列已覆盖定位需求，平均/低置信口径留在 KPI 卡。 -->

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
              :aria-pressed="pill === p.id"
              @click="pill = p.id"
            >
              {{ p.label }}<span v-if="p.id !== 'all' && p.count != null" class="mk-pill__count">{{ p.count }}</span>
              <!-- 计数判例（2026-10-11 用户拍板全站统一）：筛选 pill 一律显命中数，唯「全部」不显
                   （总数单源=分页器）——取代旧「KPI 孪生 pill 不显数」判例（P2 2026-10-04），忽隐忽现消失 -->
            </button>
          </div>
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
        </div>
        <div class="mk-card__head-right">
          <!-- 搜索槽位统一（2026-10-15 用户拍板全站列表页）：搜索移到右组首位 -->
          <MkFilterSearch v-model="keyword" placeholder="搜索名称 / 邮箱 / ID" />
          <button
            v-if="recomputingAll"
            type="button"
            class="mk-btn mk-btn--sm"
            @click="recomputeAbort = true"
          >停止</button>
          <button
            type="button"
            class="mk-btn mk-btn--sm"
            :disabled="recomputingAll || !filtered.length"
            :title="recomputingAll ? '批量重算进行中，可点「停止」中止' : '重算当前筛选命中的全部学习者快照'"
            @click="recomputeAll"
          >{{ recomputingAll ? `重算中 ${recomputeProgress}/${recomputeTotal}…` : '全部重算' }}</button>
          <MkCols
            :col-defs="lcColDefs"
            storage-key="wf_learner_hidden_cols_v3"
            v-model:hidden="lcHiddenCols"
          />
          <!-- 后端学习者域窗口截断口径单源住在页头状态条；筛选命中数单源住在分页器（「共 N 条」），
               卡头不再渲染「N / N 人」——同屏与分页器复读（CP1，2026-10-04 全站评审口径） -->
        </div>
      </div>

      <MockSkeletonTable v-if="liveLoading && !rows.length" :cols="8" />
      <!-- 审核 #17（2026-10-06）：加载失败走原语错误档（红系图标 + role=alert + 重试中反馈），
           不再与中性空态同款 -->
      <MkEmptyState
        v-else-if="loadFailed"
        tone="error"
        icon="◌"
        title="学习者快照加载失败"
        description="无法加载学习者状态，请稍后重试。"
        action-text="重试"
        :action-busy="liveLoading"
        action-busy-text="重试中…"
        @action="retryLoad"
      />
      <!-- 一屏工作台（2026-10-04 用户拍板「顶部紧凑宏观观测 + 下部排查表格」；同日 KPI 已按同组形态
           拆到页级；2026-10-05 置信度分段条随「分段条在上」移出卡到页面级）：点击分段下钻筛选
           表格，表格区内滚升入首屏，分页器保持卡尾吸底。 -->
      <div v-else class="lc-body">

      <!-- 固定列宽（2026-10-22 与教学组三表同判例）：学习者/当前进度/置信/风险四列在 auto 布局下
           按当页最长内容分宽，翻页整表跳动；fixed 后按表头定死，余量按权重摊开。
           长昵称/长任务仍由 mk-cell-main 上限与下方 max-width 截断兜底 -->
      <div class="mk-table-scroll lc-tablewrap">
      <table v-if="filtered.length" class="mk-table mk-table--nowrap mk-table--fixed lc-table">
        <thead>
          <tr>
            <th v-if="!lcHiddenCols.has('learner')" scope="col" class="lc-c-learner">学习者</th>
            <th v-if="!lcHiddenCols.has('progress')" scope="col" class="lc-c-progress">当前进度</th>
            <th v-if="!lcHiddenCols.has('status')" scope="col" class="lc-c-status" title="近况趋势 + 疲劳度">趋势 / 疲劳</th>
            <!-- 审核 #20（2026-10-06）：置信 / 更新接共享 useTableSort（Users.vue 同写法），
                 未点表头时保持默认序「风险优先 → 更新时间新→旧」（写进「操作」列表头 title） -->
            <th
              v-if="!lcHiddenCols.has('conf')"
              scope="col"
              class="mk-th--sortable lc-c-conf"
              title="当前读数的置信度，低于 50% 记为低置信"
              :aria-sort="lcSortState('conf')"
              @click="toggleLcSort('conf')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleLcSort('conf')">置信度<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th v-if="!lcHiddenCols.has('risk')" scope="col" class="lc-c-risk">风险摘要</th>
            <th
              v-if="!lcHiddenCols.has('updated')"
              scope="col"
              class="mk-th--sortable lc-c-updated"
              title="学习证据最后一次变化的时间（课堂 / 目标对话 / 任务完成等），不是快照重算时间"
              :aria-sort="lcSortState('updated')"
              @click="toggleLcSort('updated')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleLcSort('updated')">数据更新<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th scope="col" class="mk-th--right lc-c-act" title="默认排序：风险优先 → 更新时间新→旧">操作</th>
          </tr>
        </thead>
        <tbody>
          <!-- 行点击进学习者详情；键盘等价：tabindex + Enter 触发（对齐 gc-row/oc-row 判例）。
               行内控件的回车不劫持：仅当事件源就是行本身（target === currentTarget）才开详情，
               聚焦「详情/干预/重算」等行内按钮时回车走按钮自身动作（EG1） -->
          <tr v-for="r in paged" :key="r.id" class="lc-row" tabindex="0" @click="openDetail(r)" @keydown.enter="($event.target === $event.currentTarget) && openDetail(r)">
            <td v-if="!lcHiddenCols.has('learner')">
              <div class="lc-celluser">
                <MkCellAvatar :name="r.name" :tone="isVirtualRow(r) ? 'virtual' : r.isTestAccount ? 'test' : 'default'" />
                <div class="mk-cell-main">
                  <strong :title="r.name">{{ r.name }}</strong>
                  <!-- 备注在副行：姓名行保持全额宽度（2026-10-24 压字回归） -->
                  <span class="mk-cell-subline">
                    <span class="mk-cell-sub" :title="r.email">{{ r.email }}</span>
                    <span v-if="r.isTestAccount" class="mk-badge mk-badge--sm mk-badge--test" title="用于测试与审计的账号">测试</span>
                  </span>
                </div>
              </div>
            </td>
            <td v-if="!lcHiddenCols.has('progress')">
              <!-- 审核 #18（2026-10-06）：任务/路径（与邮箱同理）被 max-width 截断，
                   补 title 全值——被截掉的部分不再无处可查 -->
              <div class="mk-cell-main lc-task">
                <strong class="progress-title" :title="r.task || '未开始'">{{ r.task || '未开始' }}</strong>
                <span class="mk-cell-sub" :title="r.path || '尚未开始学习'">{{ r.path || '尚未开始学习' }}</span>
              </div>
            </td>
            <td v-if="!lcHiddenCols.has('status')">
              <div class="lc-status">
                <span class="lc-trend" :class="`lc-trend--${r.trend}`" :title="trendTitle(r)">
                  <i class="lc-trend__arrow" aria-hidden="true">{{ r.trend === 'up' ? '↗' : r.trend === 'down' ? '↘' : '→' }}</i>
                  {{ trendText(r.trend) }}
                </span>
                <!-- 2026-10-23 运营视角：「稳定 低」两个词并排，读者不知道「低」是什么——
                     给疲劳加回标签，与学习者详情同读法「疲劳：低」 -->
                <span class="mk-badge" :class="fatigueBadge(r.fatigue)" :title="`疲劳度：${r.fatigue}（高 / 中 / 低）`">疲劳：{{ r.fatigue }}</span>
              </div>
            </td>
            <td v-if="!lcHiddenCols.has('conf')" class="mk-num lc-conf-cell">
              <span
                v-if="r.confidence != null && r.task"
                class="conf"
                :class="{ 'conf--low': evidenceLowConfidence(r.confidence) }"
                :title="`置信度 ${Math.round(r.confidence * 100)}%。低于 50% 表示证据不足`"
              >
                <span class="mono">{{ Math.round(r.confidence * 100) }}%</span><em v-if="evidenceLowConfidence(r.confidence)" class="conf__lack">证据不足</em>
              </span>
              <span v-else class="mk-na" :title="r.task ? '' : '尚未开始学习，暂无置信度'">—</span>
            </td>
            <td v-if="!lcHiddenCols.has('risk')" class="lc-riskcell" :class="{ 'mk-na': !r.risk }" :title="r.risk || ''"><span class="risk-text">{{ r.risk || '—' }}</span></td>
            <td v-if="!lcHiddenCols.has('updated')">
              <span v-if="isUpdating(r.id)" class="lc-updated">重算中…</span>
              <span v-else-if="r.updated" class="mk-fresh" :class="freshTone(r.ts)" :title="updatedCellTitle(r)">{{ r.updated }}</span>
              <span v-else class="mk-na">—</span>
            </td>
            <td>
              <!-- 2026-10-05 表格方言收敛：icon-only 钮是全站唯一离群（LP/Users/TS/GC/MR 均为
                   mk-btn--sm 文字钮），且 mk-actions--left 与 th--right 左右分家致操作列偏移 -->
              <div class="mk-actions">
                <button type="button" class="mk-btn mk-btn--sm" @click.stop="openDetail(r)">详情</button>
                <button v-if="isLive && !r.isTestAccount" type="button" class="mk-btn mk-btn--sm" :class="{ 'lc-intervene--hot': isRisk(r) }" :title="isRisk(r) ? '该学习者有风险，建议立即干预：查看会话 / 发送提醒' : '干预：查看会话 / 发送提醒'" @click.stop="openIntervene(r)">干预</button>
                <button type="button" class="mk-btn mk-btn--sm" :disabled="recomputingAll || isUpdating(r.id)" :title="recomputingAll ? '批量重算进行中，请先停止' : isUpdating(r.id) ? '重算中…' : '重算：重新拉取该学习者快照'" @click.stop="recompute(r)">{{ isUpdating(r.id) ? '重算中…' : '重算' }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

        <MkEmptyState
          v-else
          :title="isFiltered ? '没有匹配的学习者' : '暂无学习者快照'"
          :description="isFiltered ? '当前搜索 / 筛选条件没有命中任何学习者，可清除筛选或换个关键词。' : '学习者产生学习行为后，状态将自动生成。'"
          :action-text="isFiltered ? '清除筛选' : ''"
          @action="clearFilters"
        />
      </div>
      </div>
      <!-- 客户端分页（统一 mk-pagination 页码器）：筛选后按页切片；lc-body 外 = 卡尾吸底恒可见 -->
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
            <div v-if="intervene.risk" class="lc-iv__risk" :class="{ 'lc-iv__risk--hot': riskBoxHot(intervene) }">
              <strong>风险摘要</strong>
              <span>{{ intervene.risk }}</span>
            </div>
            <div class="lc-iv__actions">
              <button type="button" class="mk-btn mk-btn--ghost" @click="goInterveneSession(intervene)">查看学习详情</button>
              <button type="button" class="mk-btn mk-btn--ghost" @click="goInterveneLogs">查看执行日志</button>
            </div>
            <label class="mk-field">
              <span class="mk-field__label">发送站内提醒 <em class="mk-field__req">*</em></span>
              <input v-model="interveneTitle" class="mk-field__input" placeholder="例如：学习状态提醒" />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">提醒内容</span>
              <textarea v-model="interveneBody" class="mk-field__textarea" rows="3" placeholder="例如：检测到疲劳度偏高，建议休息后继续学习"></textarea>
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
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { openSubPage, isLive, LEARNER_DETAIL_LANDING } from './store'
import { liveLearners, liveLearnersTotal, liveRecomputeLearner, refreshLiveLearners, liveLoading, liveFailures, loadLiveData, timeAgo, errMsg } from './live'
import { evidenceLowConfidence } from './evidence'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkCols from '@/components/mk/MkCols.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkCellAvatar from '@/components/mk/MkCellAvatar.vue'
import { useOverlay, useMaskClose } from './useOverlay'
import { useEscape } from './useEscape'
import { useTableSort } from './useTableSort'
import { useListQueryState } from './learner-profile'
import { adminNotificationsApi, adminLearnerModelsApi } from '@/api/adminApi'
import MkPageHead from '@/components/mk/MkPageHead.vue'

interface Row {
  id: string
  name: string
  email: string
  isVirtualLearner?: boolean
  isTestAccount?: boolean
  path: string
  task: string
  trend: 'up' | 'down' | 'flat'
  fatigue: '低' | '中' | '高'
  risk: string
  updated: string
  /** 快照重建时刻（悬停披露，与「数据更新」区分开） */
  recomputedAt?: string
  confidence?: number
  /** 更新时间戳（用于排序） */
  ts?: number
  /** 当前活跃路径 ID：重算必须带上，否则后端写 global 口径投影而本页读 path 口径 */
  pathId?: string
}

const pill = ref<'all' | 'risk' | 'watch' | 'stale'>('all')
const keyword = ref('')

/* P1-3 列显隐（公共组件 MkCols）：学习者/进度/状态/置信/风险/更新 可隐藏，操作固定
   2026-10-22 用户「信息密度比较高」：趋势与疲劳合并为一列（同为一行内读的「当前状态」，
   两列各只占一句短词）。旧存储键里的 trend/fatigue 已无对应列，不影响合并列显隐。 */
const lcColDefs = [
  { key: 'learner', label: '学习者', title: '姓名 + 邮箱' },
  { key: 'progress', label: '当前进度', title: '当前任务 + 路径' },
  { key: 'status', label: '趋势 / 疲劳', title: '近况趋势 + 疲劳度' },
  { key: 'conf', label: '置信度', title: '当前读数有多可信，低于 50% 记为低置信' },
  { key: 'risk', label: '风险摘要', title: '风险原因' },
  { key: 'updated', label: '数据更新', title: '学习证据最后一次变化的时间，不是快照重算时间' },
] as const
/* 审核 #12（2026-10-06）：风险摘要列不再默认隐藏——它是 KPI「需关注」的判据之一
   （isRisk 含 !!r.risk），默认收起会让「需关注」筛出的行在可见列里全像正常值，看不出被抓原因。
   默认集变更必须升存储键（v2→v3，Users.vue CM8 判例）：旧键已被历史访问写回，
   不升键则老本地配置（risk 隐藏）会盖掉新默认。 */
const lcHiddenCols = ref<Set<string>>(new Set())

/* 更新列新鲜度三档（批B，mk-fresh 原语） */
function freshTone(ts?: number): string {
  if (!ts) return 'mk-fresh--never'
  return Date.now() - ts < 24 * 3600000 ? 'mk-fresh--fresh' : ''
}
/** 数据更新格悬停：先说「哪一刻的数据」，再说「档案什么时候重算过」——
    两者此前混成一个读数，批重建把全表刷成同一分钟（2026-10-23） */
function updatedCellTitle(r: Row): string | undefined {
  const parts: string[] = []
  if (r.ts) parts.push(`数据截至 ${new Date(r.ts).toLocaleString()}`)
  if (r.recomputedAt) parts.push(`档案重算 ${new Date(r.recomputedAt).toLocaleString()}`)
  return parts.length ? parts.join('；') : undefined
}
function openDetail(r: Row) {
  /* 落点页签：本列表读的是趋势 / 疲劳 / 置信 / 风险摘要，同口径内容在详情的「证据」页签
     （判据与常量单点在 store 的 LEARNER_DETAIL_LANDING）——不再一律落「概览」，
     2026-10-18 用户走查。干预弹窗里的「查看学习详情」是泛化措辞，仍落概览。 */
  openSubPage('learner', r.id, { tab: LEARNER_DETAIL_LANDING.learnerState })
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
  openSubPage('learner', r.id)
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
      // 审核 #19（2026-10-06）：kind 只能用后端白名单 ['system','announcement','achievement']，
      // 原 'learning' 会被静默回落成 'system'，通知列表里恒显示「系统」且按学习类筛不出。
      // 直接写 system 与后端实际落库一致；「学习提醒」语义由 title 承载。
      kind: 'system',
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

/** P1#16 数据层接线：liveLearnersTotal=后端分页 total；真窗口显「N · 已载 M」，
 *  total 未知才退「已加载 N」（2026-10-04 解锁 500 窗口后全量加载成常态，等值时念「已加载」=假截断暗示） */
const learnerTotal = computed(() => liveLearnersTotal.value)
const learnerTotalText = computed(() => {
  const t = learnerTotal.value
  if (t != null) return t === rows.value.length ? String(t) : `${t} · 已加载 ${rows.value.length}`
  return rows.value.length ? `已加载 ${rows.value.length}` : '0'
})
/** 「学习者账号」KPI 口径 hint（2026-10-15 KPI 审计）：随页头「真实/测试」互斥视角变化——
    真实视角绝不提虚拟/测试账号（否则读者以为数里混了假账号）；两视角都含未开始学习的账号。 */
/* 2026-10-21 用户「除了 kpi 面板，其他地方也有这种文案」：副行只留「含未开始学习的账号」这条
   会改变读数含义的范围说明；视角（真实 / 测试）由右上角开关表达，不再复述 */
const learnerKpiHint = ''
const rows = computed<Row[]>(() =>
  liveLearners.value.map((m) => {
    /* 数据更新列读「学习证据最后变化」而非快照重建时刻：一次列表请求会把过期投影整批重建，
       用 generatedAt 会让全表显示同一分钟（2026-10-23 用户「怎么都是 37 分钟呢」）。
       dataUpdatedAt 三态：有值＝数据截至那一刻；null＝没有学习证据（显示「—」）；
       undefined＝旧后端还没这个字段（回退旧读数，等后端一起升级）。 */
    const dataAt = m.dataUpdatedAt === undefined ? m.generatedAt : m.dataUpdatedAt
    return {
    id: m.userId,
    name: m.name,
    email: m.email,
    isVirtualLearner: m.isVirtualLearner,
    isTestAccount: m.isTestAccount,
    path: m.pathTitle || '',
    task: m.currentTask || m.currentMilestone || '',
    trend: m.trend,
    fatigue: m.fatigue as Row['fatigue'],
    risk: m.struggling.length
      ? `「${m.struggling[0]}」等 ${m.struggling.length} 个概念掌握薄弱`
      : m.fatigue === '高'
        ? '疲劳风险高'
        : m.fragile.length
          ? `「${m.fragile[0]}」等 ${m.fragile.length} 个概念待巩固`
          : '',
    updated: dataAt ? timeAgo(dataAt) : '',
    confidence: m.confidence,
    ts: dataAt ? new Date(dataAt).getTime() : undefined,
    recomputedAt: m.generatedAt || '',
    pathId: m.pathId
    }
  })
)

/** 虚拟学习者识别（审核 #11）：优先用后端回传的 isVirtualLearner（users 表真列，与
    Users.vue 同源）；旧后端响应无此字段时按创建约定兜底（email = virtual_<uuid>@test.local，
    见 virtual-learners.ts），真实用户口径（REAL_USER_WHERE）已排除该前缀，不会误判。
    仅决定身份标记的「虚拟 / 测试」分档。 */
const isVirtualRow = (r: Row) => r.isVirtualLearner === true || (r.isVirtualLearner === undefined && /^virtual_/i.test(r.email))

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
/** 干预弹窗风险框分档（审核 #15，2026-10-06）：框体渲染条件就是 `intervene.risk`，
    而 isRisk 含 `!!r.risk` → 恒真，琥珀底（需关注语义）成为死样式。分档改用不含摘要
    本身的判据——趋势降 / 疲劳高走红（异常语义），仅概念挣扎 / 待巩固的摘要走琥珀。 */
const riskBoxHot = (r: Row) => r.trend === 'down' || r.fatigue === '高'
const riskCount = computed(() => rows.value.filter(isRisk).length)
const watchCount = computed(() => rows.value.filter(isWatch).length)
/* lowConfCount 随「低置信 KPI 与分档条同口径」移居 confRows 段（惰性求值，先引用后定义无碍） */

/* —— 学习状态分析层（原型 renderPeople state 分支：①统计四卡 ②分布直方图 ③排行）——
   原型以 LSB（学习状态平衡分，-30~30）作逐人评分；本仓快照域（live.ts LiveLearner）
   无该字段，不硬造 LSB，改用快照唯一逐人分数 confidence（0~1）做分布。
   口径 = rows 全集（随「含测试账号」范围联动），不随 pill / 搜索筛选变化；
   有学习任务（r.task）才有有效置信度，与表格置信列的「—」口径一致 */
const confRows = computed(() => rows.value.filter((r) => r.task && r.confidence != null))
/** 低置信 KPI 与均值同一口径（有任务的快照）：无任务行在表里置信列本显「—」，
    计入会与均值对不上。2026-10-21 起这层口径只在卡 title 里说明（卡面不挂副行）。 */
const lowConfCount = computed(() => confRows.value.filter((r) => evidenceLowConfidence(r.confidence ?? 1)).length)
const lowConfTitle = computed(() =>
  confRows.value.length
    ? `置信度低于 50% 的有学习任务学习者数 · 纳入计算的学习者共 ${confRows.value.length} 位`
    : '暂无有学习任务的学习者，低置信无从计数'
)
const avgConfText = computed(() => {
  if (!confRows.value.length) return '—'
  const avg = confRows.value.reduce((s, r) => s + (r.confidence ?? 0), 0) / confRows.value.length
  return Math.round(avg * 100) + '%'
})
/* 2026-10-23：疲劳高 / 趋势下降两个派生计数随卡片撤除（同上注释）——它们仍参与
   isRisk 与「需关注」判定，只是不再单独占一张读数卡。 */
const confCoverageText = computed(() =>
  rows.value.length ? `${Math.round((confRows.value.length / rows.value.length) * 100)}%` : '—'
)
/** 平均值必须带基数：n= 之外的行（无任务/无快照）不进均值，读数才知道它代表谁。
    2026-10-21：这句取数算法不再常驻卡面，只在没有样本时给一句原因；算法进 title */
const avgConfHint = computed(() =>
  confRows.value.length ? '' : '暂无有学习任务的学习者'
)
const avgConfTitle = computed(() =>
  confRows.value.length
    ? `有学习任务且产出置信度的学习者置信度算术平均值 · 本次纳入 ${confRows.value.length} 位`
    : '暂无有学习任务的学习者，均值无从计算'
)
/** 直方图五档已随分布带退役（2026-10-17）：口径阈值仍锚定 50% 低置信线，
    由「低置信」KPI 与 chip 承载（<50%），分档细节交给可排序的「置信」列。 */

/* 表头排序（审核 #20，2026-10-06）：置信 / 更新两列接共享 useTableSort
   （与 Users.vue 同写法：mk-th--sortable + aria-sort + .mk-th__btn）。
   数据完整性：live 学习者域全量拉取（≤500 窗口，窗口截断另有页头状态条如实标注），
   客户端排序口径诚实。 */
const { sortKey: lcSortKey, sortDir: lcSortDir, toggle: toggleLcSort, sortState: lcSortState, sortRows: sortLcRows } = useTableSort<Row>({
  accessors: {
    conf: (r) => r.confidence ?? null,
    updated: (r) => r.ts ?? null
  },
  storageKey: 'wf_learner_sort'
})

const filtered = computed(() => {
  let list = rows.value
  if (pill.value === 'risk') list = rows.value.filter(isRisk)
  if (pill.value === 'watch') list = rows.value.filter(isWatch)
  if (pill.value === 'stale') list = confRows.value.filter((r) => evidenceLowConfidence(r.confidence ?? 1))
  // 关键词搜索
  const kw = keyword.value.trim().toLowerCase()
  if (kw) {
    list = list.filter((r) =>
      r.name?.toLowerCase().includes(kw) ||
      r.email?.toLowerCase().includes(kw) ||
      r.id?.toLowerCase().includes(kw)
    )
  }
  // 审核 #20（2026-10-06）：未点表头排序时保持默认序「先找有问题的人」（风险优先，
  // 组内更新时间新→旧，口径写进「操作」列表头 title）；点「置信」「更新」后由共享 hook 接管。
  if (!lcSortKey.value) {
    return [...list].sort((a, b) => {
      const riskDiff = Number(isRisk(a)) - Number(isRisk(b))
      if (riskDiff) return -riskDiff
      return (b.ts ?? 0) - (a.ts ?? 0)
    })
  }
  return sortLcRows(list)
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
/** 审核 #17（2026-10-06）：已有旧行时刷新失败——loadFailed 不覆盖（它要求列表为空），
    单独给「旧结果 + 行内告警 + 重试」通路，避免失败被静默当成当前值 */
const refreshFailed = computed(
  () => isLive.value && !liveLoading.value && !!liveFailures.value.learners && liveLearners.value.length > 0
)
function retryLoad() {
  void loadLiveData()
}

/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   数据全量在客户端（live 拉取），筛选后按页切片 */
const page = ref(1)
const pageSize = ref(15)

/* 筛选 / 页码 ↔ URL query（F1-2）：进学习者详情时本组件被整个卸载（AdminConsole 用详情
   组件替换当前页），组件内 ref 随之清零——返回（面包屑 / 浏览器后退）后靠 URL 还原搜索词、
   pill、页码与置信分段下钻；深链 / 刷新同样还原。共享单点在 learner-profile.ts；
   调用必须在下一条「筛选变化回第 1 页」watch 之前：URL 落位要先于监听建立，否则挂载时
   还原出来的筛选会被当成用户改筛选、把还原的页码打回 1。 */
useListQueryState({
  pill,
  keyword,
  page,
  pageSize,
  allowedPills: ['all', 'risk', 'watch', 'stale']
})

const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
/* 筛选变化回第 1 页：监听筛选输入而非 filtered 结果（TeachingSessions 判例）——快照重拉 /
   口径切换同样会让 filtered 重算，监听结果会把还原的页码打回 1；越界页码由 Pagination 收敛 */
watch([pill, keyword, lcSortKey, lcSortDir], () => {
  page.value = 1
})

/** 趋势纯文案（箭头由模板的 .lc-trend__arrow 图标渲染，文本再带箭头会「↗ ↗ 上升」双重箭头） */
const trendText = (t: string) => (t === 'up' ? '上升' : t === 'down' ? '下降' : '稳定')
const trendTitle = (r: Row) =>
  `近况趋势：${trendText(r.trend)}${r.trend === 'down' ? '（需关注）' : r.trend === 'up' ? '（学习状态向好）' : '（状态平稳）'}`
const fatigueBadge = (f: string) => (f === '高' ? 'mk-badge--bad' : f === '中' ? 'mk-badge--warn' : 'mk-badge--ok')

/* 重算 */
const recomputingAll = ref(false)
const recomputeProgress = ref(0)
/** 本批目标数（按筛选命中计数，非全窗口 500）与中止标志（审核 #14：可停止、离页即止） */
const recomputeTotal = ref(0)
const recomputeAbort = ref(false)
onBeforeUnmount(() => { recomputeAbort.value = true })
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
    // 必须带 pathId：不带时后端把快照写到 global 口径键，而本页行数据读 path 口径键，
    // 结果「点了重算但行内更新/趋势/置信不变」（详情页早已传 pathId，此处对齐）
    await liveRecomputeLearner(row.id, row.pathId)
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
  // 审核 #14（2026-10-06）：原对 rows 全窗口（上限 500 人）逐个顺序重算——无上限、无中止、
  // 无失败名单，进度只写在按钮文案里，离开页面循环仍在跑。改为：按当前筛选命中计数、
  // 超阈值提示分批、可中止、失败行进 toast 明细、批量中禁用行内重算。
  const targets = filtered.value
  if (recomputingAll.value || !targets.length) return
  const confirmed = await askConfirm({
    title: '重算快照',
    message: `确认重算当前筛选命中的 ${targets.length} 位学习者的快照？将逐个重新生成，耗时取决于人数。`
      + (targets.length > 50 ? `\n当前命中 ${targets.length} 人（超过 50），建议先筛选分批。开始后可随时点「停止」中止。` : ''),
    confirmText: `重算 ${targets.length} 人`,
    danger: false
  })
  if (!confirmed) return
  recomputingAll.value = true
  recomputeAbort.value = false
  recomputeProgress.value = 0
  recomputeTotal.value = targets.length
  const failed: string[] = []
  let ok = 0
  try {
    for (const r of targets) {
      if (recomputeAbort.value) break
      updatingIds.value = new Set(updatingIds.value).add(r.id)
      try {
        // 循环内只调重算接口、不刷列表：liveRecomputeLearner 每次附带全量重拉学习者域，
        // N 人重算会触发 N 次全量请求；改为循环结束统一刷新一次。pathId 与单行重算同口径。
        await adminLearnerModelsApi.recompute(r.id, r.pathId ? { pathId: r.pathId } : undefined)
        ok++
      } catch {
        failed.push(r.name || r.id)
      } finally {
        const next = new Set(updatingIds.value)
        next.delete(r.id)
        updatingIds.value = next
        recomputeProgress.value++
      }
    }
    // 循环结束统一刷新一次（与列表同口径）
    try {
      await refreshLiveLearners()
    } catch {
      toast.error('重算完成，但列表刷新失败，请手动刷新')
    }
    const stopped = recomputeAbort.value ? '已停止：' : '重算完成：'
    if (failed.length) {
      const shown = failed.slice(0, 3).join('、')
      toast.error(`${stopped}${ok} 成功 · ${failed.length} 失败（${shown}${failed.length > 3 ? ' 等' : ''}）`)
    } else if (recomputeAbort.value) {
      toast.error(`${stopped}${ok} 成功 · ${targets.length - ok} 未执行`)
    } else {
      toast.success(`已重算 ${ok} 个快照`)
    }
  } finally {
    recomputingAll.value = false
    recomputeAbort.value = false
    recomputeTotal.value = 0
  }
}
</script>

<style scoped>
.lc-row { cursor: pointer; }
/* 键盘可达（对齐 gc-row/oc-row 判例）：行可聚焦，焦点态描边提示当前位置 */
.lc-row:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: -2px; }
/* ================= 一屏工作台（2026-10-04 用户拍板「观测栏 + 排查表格」） =================
   lc-body 为 flex 列：表格区（lc-tablewrap，带 mk-table-scroll 保 sticky 表头）内滚升入首屏；
   观测栏（置信度分段条）2026-10-05 随「分段条在上」移出卡到页面级（lc-analytics 随撤，
   页面级间距由 .mk-page 的 --mk-stack-gap 统一供）；逐人条形排行与竖向直方图整层退役。 */
.lc-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.lc-tablewrap { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
/* 学习者单元格（原型 celluser：头像 + 主行/副行 + 身份徽章，Users.vue ul-user 同款判例） */
.lc-celluser { display: flex; align-items: center; gap: 9px; min-width: 0; }
.lc-celluser .mk-cell-main { min-width: 0; flex: 1; }
.lc-celluser .mk-cell-sub { max-width: 230px; }
.lc-task .mk-cell-sub { max-width: 240px; }
/* 原型 .tbl td：nowrap（表自动布局判例见 Users.vue；长内容由上方 max-width 截断兜底）。
   2026-10-05 CM6：收敛为全局修饰类 .mk-table--nowrap（表元素已挂该 class）。 */
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
/* 趋势与疲劳同格（2026-10-22 合并列）：趋势在前、疲劳徽章贴后，读作一句状态 */
.lc-status { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }

.progress-title { font-weight: 600; }
.risk-text { display: block; color: var(--mk-amber); font-size: var(--mk-fs-micro); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 固定列宽（2026-10-22 与教学组三表同判例）：学习者/当前进度/置信/风险四列在 auto 布局下
   按当页最长内容分宽（风险摘要曾把列撑到 180px 上限），翻页整表跳动；fixed 后按表头定死。
   宽度按 1280 现值校准并留余量，1200 档无横滚。 */
.lc-c-learner { width: 165px; }
@media (max-width: 1279px) { .lc-c-learner { width: 115px; } }
.lc-c-progress { width: 140px; }
.lc-c-status { width: 132px; }
.lc-c-conf { width: 112px; }
.lc-c-risk { width: 150px; }
.lc-c-updated { width: 84px; }
.lc-c-act { width: 125px; }
/* fixed 档里列宽即契约：换行格 min-width 会把短内容顶出单元格 */
.lc-table .mk-cell-text--wrap, .lc-table .mk-cell-main .mk-cell-text--wrap { min-width: 0; max-width: 100%; }
/* 更新列：相对时间不换行（"4 分钟前"拆行问题） */
.lc-updated { white-space: nowrap; color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.conf { display: inline-flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; font-weight: 700; color: var(--mk-muted); cursor: help; }
.conf__lack { font-style: normal; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-amber); background: var(--mk-amber-bg); border-radius: 6px; padding: 1px 6px; margin-left: 6px; }
.conf--low { color: var(--mk-amber); }
/* 置信格左对齐：百分比 + 「证据不足」徽章左缘起排，各行读数同起点；
   原 56px 迷你条已撤（2026-10-22 用户「信息密度比较高」）——数值本身已带两位有效数字，
   条只重复了同一读数一次，且低置信行多了徽章把条推来推去。 */
.lc-conf-cell { text-align: left; }

@media (min-width: 2000px) {
  .risk-text { font-size: var(--mk-fs-body); }
}

/* ================= C2 干预动线 ================= */
/* 审核 #16（2026-10-06）：原 `html[data-theme='dark'] .lc-intervene--hot { color: #fbbf24; }`
   是零效果死规则（--mk-amber 暗色本身即 #fbbf24）且引入页内私写 hex，已删；描边改走
   color-mix(…, var(--mk-line))，暗色随 --mk-amber/--mk-red 自动翻转，不再是亮色档字面量。 */
.lc-intervene--hot { color: var(--mk-amber); }
.lc-iv__risk {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-amber-bg);
  border: 1px solid color-mix(in srgb, var(--mk-amber) 30%, var(--mk-line));
  color: var(--mk-amber);
}
.lc-iv__risk--hot { background: var(--mk-red-bg); border-color: color-mix(in srgb, var(--mk-red) 30%, var(--mk-line)); color: var(--mk-red); }
.lc-iv__risk strong { font-size: var(--mk-fs-micro); font-weight: 800; letter-spacing: 0.04em; }
.lc-iv__risk span { font-size: var(--mk-fs-micro); line-height: 1.6; }
.lc-iv__actions { display: flex; gap: 8px; flex-wrap: wrap; }
.lc-iv__hint { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); line-height: 1.6; }
</style>
