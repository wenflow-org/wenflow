<template>
  <div class="mk-page mk-page--fill">
    <!-- 页头（newui/admin pagehead）：页名 + 主操作（派生 / 维护）。
         2026-10-04 页头状态条整体退役：复读的「共 N 人」删（卡头行数已有）；
         生命周期筛选迁卡头工具栏 chips（该计数唯一来源）；「已截断」警示并进卡头 meta。 -->
    <MkPageHead title="虚拟学习者">
      <template #actions>
        <!-- 2026-10-25 口径收口（用户「不播种，都派生」）：本页不再直接建号。
             身份一律在卡库里生产（导入卡 / 平台生产 / 预置一键加载），本页只负责把身份卡派生成
             实例并运行 → 主操作「从卡库派生」在本页弹层里选卡（2026-10-26：原跳卡库会把
             创建完的人留在卡墙，还得自己找回来）。 -->
        <button
          type="button"
          class="mk-btn mk-btn--sm mk-btn--primary"
          @click="openDerivePicker"
        >从卡库派生</button>
        <div class="vl-headmenu">
          <button
            type="button"
            class="mk-btn mk-btn--sm"
            aria-haspopup="menu"
            :aria-expanded="headMenu === 'maint'"
            @click="toggleHeadMenu('maint')"
          >维护</button>
          <div v-if="headMenu === 'maint'" class="mk-menu__pop vl-headmenu__pop" role="menu" aria-label="维护">
            <button
              type="button"
              class="mk-menu__item"
              role="menuitem"
              @click="openSettingsFromMenu"
            >容量与实验环境</button>
            <button
              type="button"
              class="mk-menu__item"
              role="menuitem"
              :disabled="partition.stale === 0"
              @click="openReclaimFromMenu"
            >回收无响应（{{ partition.stale }}）</button>
            <button
              type="button"
              class="mk-menu__item"
              role="menuitem"
              @click="openCleanupFromMenu"
            >按创建时间清理</button>
          </div>
        </div>
        <div v-if="headMenu" class="vl-headmenu__mask" aria-hidden="true" @click="headMenu = ''"></div>
      </template>
    </MkPageHead>

    <!-- 运行指标带（2026-09-29 从列表卡头搬出；2026-09-29 二次归一；2026-10-05 重排）：
         完成率/失败率/今日调用/无响应候选走共享 KPI 栅格。
         2026-10-26：并发 / 速率两卡撤出数字栅格——它们读的就是「容量与实验环境」里的两条上限，
         同屏两处同一配置、两处都能点；读数并进设置卡对应输入行（卡内读数，不是另一张卡）。 -->
    <div class="vl-kpi">
      <!-- P1#19（2026-10-02 人类可读性）：运行统计三态——此前 stats 拉取失败被 .catch 静默吞掉，
           KPI 恒显「失败率 0%」假绿。现 loading→「…」、error→弱红「不可用」可点重试（调 live 层
           retryLiveVirtualStats）、仅成功后渲染数字。 -->
      <section class="mk-kpi-grid">
        <MkKpi
          label="完成率（全部会话）"
          :value="statsKpiValue(completionKpiText)"
          :tone="statsState === 'error' ? 'bad' : ''"
          :hint="statsState === 'error' ? STATS_UNAVAILABLE_HINT : statsState === 'loading' ? '统计加载中…' : ''"
          :title="statsState === 'error' ? STATS_RETRY_TITLE : completionTitle"
          :clickable="statsState === 'error'"
          @click="onStatsRetry"
        />
        <!-- B8-F4-4 口径对齐：本卡值取 systemFailureRate（failed / 全部），原 label「失败率」
             配 hint 里并列的「人为终止 1096」让 24% 被读成「全部失败占比」（真值 97%）。
             总览页同事实标作「系统失败率」（Overview.vue:506 同判例），此处跟随；
             hint 补分母与「人为终止另计，合计 X%」，运营不再低估。
             2026-10-16 用户拍板「不要非零就红」：着色改走 rate-utils 的跨页单源
             failureRateTone（≥50 红 / ≥20 或有失败 黄）——本页是历史累计口径，一条旧失败
             就把整卡染红会让红灯失去区分度。 -->
        <MkKpi
          label="系统失败率（全部会话）"
          :value="statsKpiValue(failureKpiText)"
          :tone="statsState === 'error' ? 'bad' : failureRateTone(runStats.systemFailureRate, runStats.failed)"
          :hint="statsState === 'error' ? STATS_UNAVAILABLE_HINT : statsState === 'loading' ? '统计加载中…' : ''"
          :title="statsState === 'error' ? STATS_RETRY_TITLE : failureTitle"
          :clickable="statsState === 'error'"
          @click="onStatsRetry"
        />
        <MkKpi
          label="今日调用"
          :value="statsKpiValue(String(runStats.todayCalls ?? 0))"
          :hint="statsState === 'error' ? STATS_UNAVAILABLE_HINT : ''"
          :clickable="statsState === 'error'"
          @click="onStatsRetry"
        />
        <!-- P-49（#74）：无响应候选此前只在页头按钮和分区里出现，没有 KPI 位。
             2026-10-26：这张卡就是回收入口本身——点击打开「回收无响应」预览弹层（与维护菜单
             同一个弹窗）。此前只在统计失败态才可点，正常态点了没反应。
             同日动线收口：候选为 0 时同样不可点——`clickable` 原先恒 true，于是空列表下
             卡片带指针、点了什么都不发生（与「停滞目标对话」同批修的「空动作」缺陷）。 -->
        <MkKpi
          label="无响应候选"
          :value="statsState === 'error' ? '—' : liveVirtualStaleCount"
          :tone="statsState !== 'error' && liveVirtualStaleCount ? 'warn' : ''"
          :hint="statsState === 'error' ? STATS_UNAVAILABLE_HINT : ''"
          :clickable="statsState === 'error' || liveVirtualStaleCount > 0"
          @click="onStaleKpiClick"
        />
      </section>
    </div>

    <!-- 学习者列表（「批量实验」2026-10-04 下线：批量发起与运行监控统一收在本页，
         资产输入归「学习者卡库」；旧 /admin/batch-experiments 深链重定向到本页） -->
    <!-- 正在运行：列出有活跃会话的虚拟学习者（折叠：默认前 8 个，展开看全部） -->
    <VirtualLearnerRunningBar
      v-if="runningSamples.length && isLive"
      :running-samples="runningSamples"
    />

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <!-- 生命周期筛选（原页头状态条的 meta-link 迁入，2026-10-04）：点选筛选 / 再点取消，
               胶囊形态对齐全站工具条 chips（同 TeachingSessions）。计数判例（2026-10-11 全站统一）：
               筛选 pill 一律显命中数，唯「全部」不显（总数单源=分页器「共 N 条」）；
               搜索槽位归一：pills 之后（2026-10-11 卡头走查） -->
          <button
            v-for="o in statePillOptions"
            :key="o.key"
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': stateFilter === o.key }"
            :aria-pressed="stateFilter === o.key"
            @click="stateFilter = stateFilter === o.key ? 'all' : o.key"
          >{{ o.label }}<span v-if="o.key !== 'all'" class="mk-pill__count">{{ o.count }}</span></button>
        </div>
        <div class="mk-card__head-right">
          <!-- 搜索槽位统一（2026-10-15 用户拍板全站列表页）：搜索移到右组首位 -->
          <MkFilterSearch v-model="keyword" placeholder="搜索名称 / 倾向" />
          <!-- CP1：筛选命中数单源住在分页器（「共 N 条」），卡头不再渲染「X / N 人」；
               截断警示仍在此（数据完整性事实，与行数同格就近） -->
          <!-- 批量入口（2026-10-26）：从「列」菜单挪到卡头一枚按钮。列菜单此前是唯一入口，
               而列菜单读作「列设置」，第一次进这页的人读不出这页能批量跑。
               多选默认仍不出来（2026-10-17 用户拍板），按钮只负责把勾选列打开。 -->
          <button
            v-if="isLive && !isNarrow"
            type="button"
            class="mk-btn mk-btn--sm vl-batch-toggle"
            :class="{ 'vl-batch-toggle--on': batchMode }"
            :aria-pressed="batchMode"
            @click="toggleBatchMode"
          >批量</button>
          <MkCols
            :col-defs="vlColDefs"
            storage-key="wf_vl_hidden_cols_v3"
            :default-hidden="['check', 'sessions']"
            v-model:hidden="hiddenCols"
          />
          <span v-if="isLive && liveVirtualsTotal > samples.length" class="mk-card__meta vl-truncated">
            共 {{ liveVirtualsTotal }} 位学习者 · 本次载入 {{ samples.length }} 位
          </span>
        </div>
      </div>

      <MockSkeletonTable v-if="liveLoading && !samples.length" :cols="6" />
      <div v-else-if="filtered.length" class="mk-table-scroll vl-table-scroll">
      <!-- 原型 .tbl 词汇：自动布局（无 colgroup），td 靠 nowrap 撑列、长内容列给 px 截断上限；
           超宽由 .mk-table-scroll 横向滚动兜底（此前 fixed+colgroup 是本页私造的另一种表格语言）。
           不用 mk-table--click：整行点击已刻意退役（避免勾选误触），入口=名称格 vl-cell--click，
           整行 pointer 光标是对「点了没反应」的假承诺 -->
      <table class="mk-table mk-table--fixed vl-table">
        <thead>
          <tr>
            <th v-if="isLive && !isNarrow && !hiddenCols.has('check')" scope="col" class="vl-c-check">
              <input type="checkbox" aria-label="全选当前页" :indeterminate="headerIndeterminate" :checked="allChecked" @change="toggleAll" />
            </th>
            <th
              scope="col"
              class="mk-th--sortable vl-c-name"
              :aria-sort="vlSortState('name')"
              @click="toggleVlSort('name')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('name')">虚拟学习者<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th v-if="!isNarrow && !isCompact && !hiddenCols.has('tendency')" scope="col" class="vl-c-tendency">长期倾向</th>
            <th
              v-if="!isNarrow && !hiddenCols.has('story')"
              scope="col"
              class="mk-th--right mk-th--sortable vl-c-story"
              :aria-sort="vlSortState('story')"
              @click="toggleVlSort('story')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('story')">故事 / 路径<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              scope="col"
              class="mk-th--sortable vl-c-running"
              title="这个学习者现在在跑还是不在跑"
              :aria-sort="vlSortState('running')"
              @click="toggleVlSort('running')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('running')">运行状态<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <!-- 累计运行是历史累计量，不是当下状态：默认隐藏，列菜单可开（2026-10-21）。 -->
            <th
              v-if="!isNarrow && !hiddenCols.has('sessions')"
              scope="col"
              class="mk-th--right mk-th--sortable vl-c-runs"
              :title="SESSIONS_COL_TITLE"
              :aria-sort="vlSortState('sessions')"
              @click="toggleVlSort('sessions')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('sessions')">累计运行<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <!-- 失败与无响应合并成一列「异常」（2026-10-21 用户「这都是什么，是运营看的吗」）：
                 两个都是问题信号、又各自大多为 0，分两列时整片「0 0」最响；合并后只在非零时出声。 -->
            <th
              v-if="!isNarrow && !hiddenCols.has('abnormal')"
              scope="col"
              class="mk-th--right mk-th--sortable vl-c-abnormal"
              :title="ABNORMAL_COL_TITLE"
              :aria-sort="vlSortState('abnormal')"
              @click="toggleVlSort('abnormal')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('abnormal')">异常<span class="mk-th__caret" aria-hidden="true"></span></button><button
              type="button"
              class="vl-th-filter"
              :class="{ 'vl-th-filter--on': onlyAbnormal }"
              :aria-pressed="onlyAbnormal"
              title="只看有失败或无响应运行的学习者"
              @click.stop="onlyAbnormal = !onlyAbnormal"
            ><Filter :size="13" :stroke-width="1.75" /></button></th>
            <th
              v-if="!isNarrow && !isCompact && !hiddenCols.has('created')"
              scope="col"
              class="mk-th--sortable vl-c-created"
              :aria-sort="vlSortState('created')"
              @click="toggleVlSort('created')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('created')">创建<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th scope="col" class="vl-c-act">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in paged" :key="s.id" :class="{ 'vl-row--fresh': freshIds.includes(s.id) }">
            <td v-if="isLive && !isNarrow && !hiddenCols.has('check')"><input v-model="selected" type="checkbox" :value="s.id" :aria-label="`选择 ${s.name}`" @click.stop /></td>
            <td>
              <div class="vl-cell vl-cell--click" role="button" tabindex="0" :title="s.name" @click="openSubPage('virtual', s.id)" @keydown.enter="openSubPage('virtual', s.id)" @keydown.space.prevent="openSubPage('virtual', s.id)">
                <!-- 2026-10-15 用户拍板：撤本页私造的「身份哈希八色」头像，改与教学组同款共享原语
                     MkCellAvatar（虚拟学习者=紫）。头像在 .mk-cell-main 外（同 Skills / 教学组名称格结构）：
                     mk-cell-main strong 的 display:block 高特异性会压过 strong 上的 flex，头像留格内会跌回块流 -->
                <MkCellAvatar :name="s.name" tone="virtual" />
                <div class="mk-cell-main">
                  <strong :title="s.name">{{ s.name }}</strong>
                </div>
              </div>
            </td>
            <td v-if="!isNarrow && !isCompact && !hiddenCols.has('tendency')">
              <span class="mk-cell-text--wrap" :class="{ 'mk-na': !s.goal || s.goal === '—' }" :title="s.goal || undefined">{{ s.goal || '未设置' }}</span>
            </td>
            <td v-if="!isNarrow && !hiddenCols.has('story')" class="mk-num" :title="storyPathTitle(s)">
              <template v-if="s.storyCount > 0">
                <span>{{ s.storyCount }}</span><span class="vl-story-path__sep" aria-hidden="true"> / </span><span :class="{ 'mk-na': s.pathCount === 0 }">{{ s.pathCount }}</span>
              </template>
              <span v-else class="mk-na">—</span>
            </td>
            <td>
              <div class="vl-state-cell">
                <!-- 2026-10-21 晚（用户「只反映是运行，还是停滞，还是停止，不显示阶段」）：
                     这一格只回答「这个人在跑还是不在跑」，阶段/路径/任务/终态一律不进列表，
                     要看跑到哪一步点进画像页。 -->
                <span
                  class="vl-runstate"
                  :class="`vl-runstate--${runPhaseOf(s)}`"
                  :title="runPhaseTitle(s)"
                ><i class="vl-runstate__dot" aria-hidden="true"></i>{{ runPhaseLabel(s) }}</span>
              </div>
            </td>
            <td v-if="!isNarrow && !hiddenCols.has('sessions')" class="mk-num">{{ s.sessions }}</td>
            <td v-if="!isNarrow && !hiddenCols.has('abnormal')" class="vl-abnormal">
              <template v-if="s.failedCount > 0 || s.stalledCount > 0">
                <span
                  v-if="s.failedCount > 0"
                  class="vl-abn vl-abn--fail"
                  :title="failCellTitle(s.failedCount, s.abandonedCount ?? 0)"
                >失败 {{ s.failedCount }}</span>
                <span
                  v-if="s.stalledCount > 0"
                  class="vl-abn vl-abn--stall"
                  :title="stalledCellTitle(s)"
                >无响应 {{ s.stalledCount }}</span>
              </template>
              <span v-else class="mk-na">—</span>
            </td>
            <td v-if="!isNarrow && !isCompact && !hiddenCols.has('created')"><span class="mk-cell-sub" :title="s.createdAt ? `创建于 ${fmtDateTime(s.createdAt)}` : undefined">{{ s.created }}</span></td>
            <td>
              <div class="mk-actions mk-actions--left">
                <!-- 行内只留「这个状态下的下一步」：运行中→暂停、已暂停/停滞→继续、已停止→运行。
                     不可逆的「终止」不占行主位（进 ⋯ 菜单）；没故事时真禁用，不改字冒充。 -->
                <button
                  v-if="isLive"
                  type="button"
                  class="mk-btn mk-btn--sm"
                  :disabled="rowActionOf(s).disabled || busyId === s.id"
                  :title="rowActionOf(s).title"
                  @click.stop="onRowAction(s)"
                >
                  <Pause v-if="rowActionOf(s).key === 'pause'" :size="14" :stroke-width="1.75" />
                  <!-- 继续是「接着跑」，用带圈的播放与「运行」（从没跑过、新开一条）区分 -->
                  <CirclePlay v-else-if="rowActionOf(s).key === 'resume'" :size="14" :stroke-width="1.75" />
                  <Play v-else :size="14" :stroke-width="1.75" />
                  <span>{{ busyId === s.id ? '处理中…' : rowActionOf(s).label }}</span>
                </button>
                <div v-if="isLive" class="mk-menu">
                  <!-- aria-expanded 按行判定（同审核 #168 判例）：menuOpen 是全局布尔，任一行开
                       菜单其余行都报 expanded=true；openMenu 才是「本行是否开」 -->
                  <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="openMenu === s.id" @click.stop="toggleMenu(s.id)">⋯</button>
                  <div v-if="openMenu === s.id" class="mk-menu__pop" role="menu" aria-label="更多操作" :style="popStyle" @click.stop>
                    <!-- 主按钮是「暂停/继续」时，新开一次运行只能从这里进（否则暂停过的学习者再也开不了新运行） -->
                    <button
                      v-if="rowActionOf(s).key !== 'launch' && s.storyCount > 0"
                      type="button"
                      class="mk-menu__item"
                      role="menuitem"
                      @click="openLaunch(s)"
                    >再跑一次</button>
                    <button type="button" class="mk-menu__item" role="menuitem" @click="openPromptTest(s)">提示词试跑</button>
                    <div class="mk-menu__sep" aria-hidden="true"></div>
                    <button type="button" class="mk-menu__item" role="menuitem" @click="menuOpenSourceCard(s)">查看来源卡</button>
                    <div class="mk-menu__sep" aria-hidden="true"></div>
                    <button
                      v-if="runPhaseOf(s) !== 'stopped'"
                      type="button"
                      class="mk-menu__item mk-menu__item--danger"
                      role="menuitem"
                      :disabled="busyId === s.id"
                      title="终止后会话标记为已放弃，数据保留，不可撤销"
                      @click="terminateSample(s)"
                    >终止</button>
                    <button type="button" class="mk-menu__item mk-menu__item--danger" role="menuitem" :disabled="busyId === s.id" title="运行记录一并删除，不可恢复" @click="menuRemove(s)">删除</button>
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
        min
        tone="error"
        title="虚拟学习者加载失败"
        action-text="重试"
        @action="retryLoad"
      />
      <MkEmptyState
        v-else
        min
        :title="samples.length ? '当前筛选无虚拟学习者' : '还没有派生过虚拟学习者'"
        :action-text="isFiltered && samples.length ? '清除筛选' : '从卡库派生'"
        @action="isFiltered && samples.length ? clearFilters() : openDerivePicker()"
      />
      <!-- 客户端分页（统一 mk-pagination 页码器）：筛选后按页切片。
           单页容得下时不渲染（与卡库页同款守卫）：2 条数据时整行页码器只有禁用钮。 -->
      <Pagination
        v-if="filtered.length > pageSize"
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="filtered.length"
        :showTotal="true"
        unit="位学习者"
      />
    </div>

    <!-- 容量与实验环境已收进页头「维护」菜单 → 右侧抽屉（2026-10-26 用户「这个设计一下，
         功能看看放在右上角维护？」）。原先是列表下方一整张卡：低频设置占满整行、下半截
         全空，首屏还要滚过它才看得到分页器。设置不占版面，需要时从维护菜单展开。 -->

    <!-- 批量操作条（全局 mk-batchbar：选中后底部浮现） -->
    <VirtualLearnerBatchBar
      v-if="isLive && selected.length"
      v-model:selected="selected"
      :samples="samples"
      @reclaim="onBatchReclaim"
    />

    <!-- 一键回收 / 按创建时间清理 / 启动 / 单步测试 / 从卡库派生：拆分为独立子组件（各自 Teleport 到 body）。
         2026-10-25：「新建 / 批量新建」两个弹窗随「不播种、都派生」一起退役——建号只在卡库
         （导入卡 / 平台生产 / 预置一键加载 + 选角派生），本页不再有第二条创建路径。 -->
    <VirtualLearnerReclaim ref="reclaimRef" @done="onReclaimDone" />
    <VirtualLearnerCleanup ref="cleanupRef" :samples="samples" @done="onReclaimDone" />
    <VirtualLearnerLaunch ref="launchRef" />
    <VirtualLearnerPromptTest ref="promptRef" />
    <VirtualLearnerSettingsDrawer
      ref="settingsDrawerRef"
      :concurrency="concurrency"
      :concurrency-unavailable="statsState === 'error'"
      :rpm="vlRpm"
      :rpm-saved-limit="vlRpmSavedLimit"
      :rpm-unavailable="vlRpmLoadFailed"
    />
    <CardDeriveDialog ref="deriveRef" @created="onDerived" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, watch, onUnmounted } from 'vue'
import { CirclePlay, Filter, Pause, Play } from 'lucide-vue-next'
import { openSubPage, intent, isLive } from './store'
import { liveVirtuals, refreshLiveVirtuals, liveDeleteVirtual, liveLoading, liveFailures, loadLiveData, timeAgo, errMsg, liveVirtualsTotal, liveVirtualSessionStats, liveVirtualStaleCount, liveVirtualRunStats, liveAutopilotConcurrency, liveVirtualStatsLoading, liveVirtualStatsError, retryLiveVirtualStats } from './live'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { useRowMenu } from './useRowMenu'
import { pauseAutopilotOf, resumeAutopilotOf, terminateRunsOf } from './virtualRunControl'
import { useIsNarrow } from './useIsNarrow'
import { useSafePolling } from '@/composables/useSafePolling'
import { failureRateTone, FAILURE_RATE_THRESHOLD_NOTE } from './rate-utils'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkCols from '@/components/mk/MkCols.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkCellAvatar from '@/components/mk/MkCellAvatar.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import { useTableSort } from './useTableSort'
import { useListQueryState } from './learner-profile'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import VirtualLearnerRunningBar from './VirtualLearnerRunningBar.vue'
import VirtualLearnerReclaim from './VirtualLearnerReclaim.vue'
import VirtualLearnerCleanup from './VirtualLearnerCleanup.vue'
import VirtualLearnerLaunch from './VirtualLearnerLaunch.vue'
import VirtualLearnerBatchBar from './VirtualLearnerBatchBar.vue'
import VirtualLearnerPromptTest from './VirtualLearnerPromptTest.vue'
import VirtualLearnerSettingsDrawer from './VirtualLearnerSettingsDrawer.vue'
import CardDeriveDialog from './CardDeriveDialog.vue'
import type { VirtualLearnerRow as Sample } from './virtualLearnersTypes'

/* ---------- 文案单源（R6 同文件复读治理）：同一句用户可见文案只在此定义一次，模板/脚本就地引用 ---------- */
const STATS_RETRY_TITLE = '运行统计拉取失败：点击重试'
const STATS_UNAVAILABLE_HINT = '统计不可用 · 点击重试'
/* 列头口径（表头 title 与「列」菜单共用同一句，避免同页两处漂移） */
const SESSIONS_COL_TITLE = '累计运行数（全部运行，含终态）'
const ABNORMAL_COL_TITLE = '系统失败的运行数 + 当前无响应的运行数。人为终止不计入'
const samples = computed<Sample[]>(() =>
  liveVirtuals.value.map((v) => ({
    id: v.id,
    name: v.name,
    goal: v.goal,
    storyCount: Number(v.storyCount || 0),
    pathCount: Number(v.pathCount || 0),
    sessions: v.sessions,
    runningCount: Number(v.runningCount || 0),
    pausedCount: Number(v.pausedCount || 0),
    failedCount: Number(v.failedCount || 0),
    abandonedCount: Number(v.abandonedCount || 0),
    stalledCount: Number(v.stalledCount || 0),
    runningSessionIds: v.runningSessionIds,
    /* G2（2026-10-10）：已暂停会话 id 必须随行带出——否则「正在运行」条的暂停样本拿不到
       可回退的会话 id。列表本行的逐条徽章已改用 activeRuns，但这两列仍供运行条消费。 */
    pausedSessionIds: v.pausedSessionIds,
    currentStage: v.currentStage || null,
    /* 阶段进度必须随行带出：此前漏拷，模板 :task-progress 恒为 null（走查 #39） */
    stageProgress: v.stageProgress || null,
    /* 逐条活跃会话（2026-10-18）：多路径同时运行时按行展开，不再只画第一条 */
    activeRuns: Array.isArray(v.activeRuns) ? v.activeRuns : [],
    activeRunTotal: Number(v.activeRunTotal ?? 0),
    /* 历史摘要按路径归并（2026-10-21）：没有活跃运行时按「每条路径一行」渲染最近一次运行 */
    recentRuns: Array.isArray(v.recentRuns) ? v.recentRuns : [],
    recentRunTotal: Number(v.recentRunTotal ?? 0),
    createdAt: String(v.createdAt || ''),
    created: timeAgo(v.createdAt),
    tags: Array.isArray(v.tags) ? v.tags : []
  }))
)

/** 行主操作：永远是这个状态下的下一步，而不是固定的「运行」。
 *  不可逆的「终止」不占行主位（收进 ⋯ 菜单）；暂停与无响应同时存在时给「继续」。 */
type RowAction = { key: 'launch' | 'pause' | 'resume'; label: string; title: string; disabled: boolean }

function rowActionOf(s: Sample): RowAction {
  const phase = runPhaseOf(s)
  if (phase === 'running') {
    return { key: 'pause', label: '暂停', title: '暂停自动驾驶，进度与对话保留', disabled: false }
  }
  if (phase === 'paused' || phase === 'stalled') {
    return { key: 'resume', label: '继续', title: '重新开启自动驾驶，从上次的进度继续', disabled: false }
  }
  const noStory = Number(s.storyCount) === 0
  return {
    key: 'launch',
    label: '运行',
    title: noStory ? '还没有故事，先到画像页生成故事' : '',
    disabled: noStory
  }
}

async function onRowAction(s: Sample) {
  const action = rowActionOf(s)
  if (action.disabled || busyId.value === s.id) return
  if (action.key === 'launch') {
    openLaunch(s)
    return
  }
  busyId.value = s.id
  try {
    const result = action.key === 'pause' ? await pauseAutopilotOf(s.id) : await resumeAutopilotOf(s.id)
    if (result.done) {
      toast.success(
        action.key === 'pause'
          ? `已暂停「${s.name}」的 ${result.done} 个会话（进度保留）`
          : `已继续「${s.name}」的 ${result.done} 个会话`
      )
    } else if (result.failed) {
      toast.error(`${action.key === 'pause' ? '暂停' : '继续'}失败，请稍后重试`)
    } else {
      toast.info(action.key === 'pause' ? '没有可暂停的会话' : '没有可继续的会话')
    }
    if (result.done || result.failed) void refreshLiveVirtuals()
  } finally {
    busyId.value = null
  }
}

/** 终止（不可逆）：只从 ⋯ 菜单进 */
async function terminateSample(s: Sample) {
  closeMenu()
  if (busyId.value === s.id) return
  const n = (Number(s.stalledCount) || 0) + (Number(s.pausedCount) || 0) + (Number(s.runningCount) || 0)
  const ok = await askConfirm({
    title: '终止会话',
    message: `「${s.name}」还有 ${n} 条未结束的会话。
终止后标记为「已放弃」，数据保留，不可撤销。确认终止？`,
    confirmText: '终止',
    danger: true
  })
  if (!ok) return
  busyId.value = s.id
  try {
    const result = await terminateRunsOf(s.id)
    if (result.failed) toast.error('终止失败，请稍后重试')
    else toast.success(`已终止「${s.name}」的未结束会话`)
    if (result.done || result.failed) void refreshLiveVirtuals()
  } finally {
    busyId.value = null
  }
}

/** 四档状态：在跑 / 已暂停（运营主动停）/ 停滞（超阈值无写入）/ 没在跑。
 *  暂停与停滞必须分开：前者是主动操作、后者是故障，同词同色会让黄灯失去区分度。 */
type RunPhase = 'running' | 'paused' | 'stalled' | 'stopped'

function runPhaseOf(s: Sample): RunPhase {
  /* 2026-10-21 口径统一：后端已按 autopilot 状态分好类（runningCount 只含在推进的会话，
     停滞单独计数），前端不再自己拿 activeRuns 二次判断——两处判断就是两套口径。 */
  if ((Number(s.runningCount) || 0) > 0) return 'running'
  if ((Number(s.stalledCount) || 0) > 0) return 'stalled'
  if ((Number(s.pausedCount) || 0) > 0) return 'paused'
  return 'stopped'
}

const RUN_PHASE_LABEL: Record<RunPhase, string> = {
  running: '运行中',
  paused: '已暂停',
  stalled: '停滞',
  stopped: '已停止'
}

function runPhaseLabel(s: Sample): string {
  return RUN_PHASE_LABEL[runPhaseOf(s)]
}

/** 这一档的读数（条数 + 阈值），不写「去哪看」 */
function runPhaseTitle(s: Sample): string {
  const running = Number(s.runningCount) || 0
  const paused = Number(s.pausedCount) || 0
  const stalled = Number(s.stalledCount) || 0
  const phase = runPhaseOf(s)
  if (phase === 'running') {
    return paused > 0 ? `${running} 条会话正在运行 · ${paused} 条已暂停` : `${running} 条会话正在运行`
  }
  if (phase === 'stalled') {
    const t = reclaimThresholdText()
    const within = t ? `超过回收阈值（${t}）无新写入` : '超过回收阈值无新写入'
    return paused > 0 ? `${stalled} 条${within} · ${paused} 条已暂停` : `${stalled} 条${within}`
  }
  if (phase === 'paused') return `${paused} 条会话已暂停自动驾驶`
  return Number(s.sessions) > 0 ? '没有运行中的会话' : '没有运行过'
}

/** 「无响应」标签口径：条数 + 阈值 + 哪一种暂停不计入 */
function stalledCellTitle(s: Sample): string {
  const t = reclaimThresholdText()
  const within = t ? `超过 ${t}` : '超过回收阈值'
  return `${s.stalledCount} 条进行中的运行${within}仍没有新写入`
}

/** 「故事 / 路径」单元格 title：两个读数 */
function storyPathTitle(s: Sample): string {
  if (s.storyCount === 0) return '还没有故事'
  return s.pathCount === 0
    ? `故事池 ${s.storyCount} 条 · 还没有生成路径`
    : `故事池 ${s.storyCount} 条 · 已生成路径 ${s.pathCount} 条`
}

const keyword = ref('')
/** F20 口径分列（2026-10-15）：单元格 title 给系统失败/人为终止的分解 */
function failCellTitle(failed: number, abandoned: number): string {
  if (failed <= 0 && abandoned <= 0) return '无失败运行'
  return `系统失败 ${failed} · 人为终止 ${abandoned}`
}
/** 状态过滤（轴 A 生命周期）：与「运行状态」列同源 */
const stateFilter = ref('all')
/** 异常列的「只看有异常」开关（原「曾失败」pill，2026-10-21 迁到列头） */
const onlyAbnormal = ref(false)
const stateFilterOptions = computed(() => {
  const failed = statsState.value === 'error'
  const n = (v: number) => (failed ? '—' : v)
  const byPhase = (p: RunPhase) => samples.value.filter((s) => runPhaseOf(s) === p).length
  return [
    { key: 'all', label: '全部', count: n(samples.value.length) },
    { key: 'running', label: '运行中', count: n(byPhase('running')) },
    { key: 'paused', label: '已暂停', count: n(byPhase('paused')) },
    { key: 'stalled', label: '停滞', count: n(byPhase('stalled')) },
    { key: 'stopped', label: '已停止', count: n(byPhase('stopped')) },
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
    /* 「运行状态」列按活跃总数排序（运行 + 暂停），避免暂停多的行被排到已停止区 */
    running: (s) => s.runningCount + (s.pausedCount ?? 0),
    /* 「异常」= 失败运行数 + 当前无响应运行数：两个字都是问题信号，合计排序让有事的行冒头 */
    abnormal: (s) => s.failedCount + s.stalledCount,
    created: (s) => (s.createdAt ? new Date(s.createdAt).getTime() : null)
  },
  storageKey: 'wf_virtual_learners_sort'
})

const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  let list = samples.value
  if (q) list = list.filter((s) => `${s.name} ${s.goal} ${s.id}`.toLowerCase().includes(q))
  /* 与状态列同源：pill 与「运行状态」列都走 runPhaseOf，不另写一套谓词 */
  const sf = stateFilter.value
  if (sf === 'running' || sf === 'paused' || sf === 'stalled' || sf === 'stopped') {
    list = list.filter((s) => runPhaseOf(s) === sf)
  }
  if (onlyAbnormal.value) list = list.filter((s) => s.failedCount > 0 || s.stalledCount > 0)
  return sortVlRows(list)
})

const isFiltered = computed(() => !!keyword.value.trim() || stateFilter.value !== 'all' || onlyAbnormal.value)
function clearFilters() {
  keyword.value = ''
  stateFilter.value = 'all'
  onlyAbnormal.value = false
}

/* 长列表分批渲染：每批 15 行 */
/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   数据全量在客户端（live 拉取），筛选后按页切片。
   回第 1 页只监听筛选输入（G9，2026-10-10，对齐 TeachingSessions/OpsContent 判例）：
   此前监听 filtered 结果——10s 轮询回填数据/删除行也会把页码拽回第 1 页，
   用户正看第 3 页时被无故弹回；越界收敛由 Pagination 自带 watcher 兜底 */
const page = ref(1)
const pageSize = ref(15)

/* 筛选 / 页码 ↔ URL query（2026-10-13 运营走查 O2）：本页数据全在客户端，筛选后
   刷新 / 分享 / 收藏都还原不了（URL 只有一个裸路径）。与 用户与学习者 / 学习状态
   同一组合式单点（learner-profile.ts useListQueryState）。
   必须在下方「筛选变化回第 1 页」的 watch 之前调用：URL 落位要发生在监听建立之前，
   否则挂载时还原出来的筛选会被当成用户改筛选、把还原的页码打回 1（Users.vue 判例）。 */
useListQueryState({
  pill: stateFilter,
  keyword,
  page,
  pageSize,
  allowedPills: ['all', 'running', 'paused', 'stalled', 'stopped']
})

const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
watch([keyword, stateFilter], () => {
  page.value = 1
})

/* ===== 拆分子组件引用与父侧触发入口（弹窗状态在子组件内，父页面只发指令） ===== */
/** 页头维护菜单展开态；点遮罩关闭 */
const headMenu = ref<'' | 'maint'>('')
function toggleHeadMenu(key: 'maint') {
  headMenu.value = headMenu.value === key ? '' : key
}
function openCleanupFromMenu() {
  headMenu.value = ''
  cleanupRef.value?.open()
}
function openReclaimFromMenu() {
  headMenu.value = ''
  openReclaimModal()
}

const launchRef = ref<InstanceType<typeof VirtualLearnerLaunch> | null>(null)
const reclaimRef = ref<InstanceType<typeof VirtualLearnerReclaim> | null>(null)
const cleanupRef = ref<InstanceType<typeof VirtualLearnerCleanup> | null>(null)
const promptRef = ref<InstanceType<typeof VirtualLearnerPromptTest> | null>(null)

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
    message: `确认删除虚拟学习者「${s.name}」？\n其运行记录将一并清理，该操作不可撤销。`,
    confirmText: '删除',
    busy: true
  })
  if (!ok) return
  busyId.value = s.id
  try {
    await liveDeleteVirtual(s.id)
    // 行内删除成功：把该 id 从选中集合摘除，批量条不残留已删除对象（审核 #57）
    selected.value = selected.value.filter((id) => id !== s.id)
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

/* ===== A1 行内 ⋯ 菜单：先关菜单再执行 ===== */
const { openMenu, toggleMenu, closeMenu, popStyle } = useRowMenu()
function menuRemove(s: Sample) {
  closeMenu()
  void removeSample(s)
}
/** 来源卡（双向互链）：卡与虚拟学习者同一条档案记录，卡库 id 即本表行 id；
    跨页导航按本文件与画像页判例收进 ⋯ 菜单，不占行内按钮位。 */
function menuOpenSourceCard(s: Sample) {
  closeMenu()
  openSubPage('card', s.id)
}

/* 窄屏（≤720）：11 列只保留「名称 / 运行状态 / 操作」，次要列（勾选/倾向/故事池/任务/
   会话/失败/卡死/创建）随 useIsNarrow 隐藏——此前整表 860px 最小宽只能横向拖（vlab 大表
   窄屏零降级问题）；行详情（画像页）信息不丢 */
const isNarrow = useIsNarrow()
/* ≤1279 档再收一列「长期倾向」（自由文本，画像页有全文）：1080 档七列会顶出 68px 横滚，
   收起后表格贴容器宽。与窄屏同一判例：收起优先于列勾选，列菜单也不给死开关。 */
const isCompact = useIsNarrow(1279)

/* ===== 从卡库派生（2026-10-26）：同页弹层选卡 → 创建，创建成功回刷本页并高亮新行。
   原实现跳 /admin/virtual-learner-cards：创建完人停在卡墙，实例不在那面墙上，
   还得自己想到回本页、也认不出刚建的是哪一条。 ===== */
const deriveRef = ref<InstanceType<typeof CardDeriveDialog> | null>(null)
const deriveCards = ref<Array<{ profileId: string; name: string }>>([])
/** 刚创建的实例 id（短暂高亮） */
const freshIds = ref<string[]>([])

async function openDerivePicker() {
  headMenu.value = ''
  try {
    const res = await adminVirtualLearnersApi.cardsIndex()
    const d = (res.data?.data ?? res.data) as { cards?: Array<{ profileId: string; name: string }> }
    deriveCards.value = (d?.cards ?? []).map((c) => ({ profileId: c.profileId, name: c.name }))
  } catch (e) {
    toast.error(errMsg(e) || '卡库加载失败')
    return
  }
  if (!deriveCards.value.length) {
    toast.info('卡库里还没有身份卡')
    return
  }
  deriveRef.value?.openPicker(deriveCards.value)
}

/** 创建成功：清筛选让新实例可见（列表按创建时间倒序，新行在最前），并标记高亮 */
let freshTimer: ReturnType<typeof setTimeout> | null = null
function onDerived(created: Array<{ profileId: string }>) {
  freshIds.value = created.map((c) => c.profileId)
  clearFilters()
  page.value = 1
  void refreshLiveVirtuals()
  if (freshTimer) clearTimeout(freshTimer)
  freshTimer = setTimeout(() => { freshIds.value = [] }, 4000)
}
onUnmounted(() => { if (freshTimer) clearTimeout(freshTimer) })

/* 列显隐（2026-10-05 卡头统一补「列」按钮）：次要列可勾选；名称/运行状态/操作是
   身份与动作列不进 colDefs。窄屏（isNarrow）折叠优先于列勾选——窄屏档勾了也不显
   （行详情进画像页，信息不丢）。
   2026-10-18：勾选列进 colDefs 并默认隐藏（用户「多选还是不要先显示」，与 People 同判例）
   2026-10-19：默认隐藏保留，页头曾补「批量操作」按钮兜底；
   2026-10-21 逻辑重整：该按钮退回列菜单——它本质是列设置，页头只留新建与维护。 */
const VL_COL_DEFS = [
  { key: 'check', label: '选择框' },
  { key: 'tendency', label: '长期倾向' },
  { key: 'story', label: '故事 / 路径', title: '故事池条数 / 已生成路径条数（一个故事可衍生多条路径，同一路径的多次运行不重复计）' },
  /* 任务进度恒定贴在阶段条尾部（任务数只在「跑到哪一步」的上下文里有意义），不再单开列 */
  { key: 'sessions', label: '累计运行', title: SESSIONS_COL_TITLE },
  { key: 'abnormal', label: '异常', title: ABNORMAL_COL_TITLE },
  { key: 'created', label: '创建' },
] as const
const hiddenCols = ref<Set<string>>(new Set())
const vlColDefs = computed(() => VL_COL_DEFS.filter(
  (d) => !isCompact.value || (d.key !== 'tendency' && d.key !== 'created')
))
/** 回收阈值的人话（30 分钟 / 24 小时）：直接写「1440 分钟」没人能立刻换算 */
function reclaimThresholdText(): string {
  const mins = Math.round((Number(liveVirtualRunStats.value.reclaimThresholdMs) || 0) / 60000)
  if (!mins) return ''
  if (mins % 60 === 0) return `${mins / 60} 小时`
  if (mins >= 60) return `${Math.round((mins / 60) * 10) / 10} 小时`
  return `${mins} 分钟`
}

/* ===== intent 快捷动作：直达派生入口（2026-10-26 起在本页弹层完成，不再跳卡库） ===== */
watch(
  () => intent.quickAction,
  (a) => {
    if (a === 'create-virtual') {
      intent.quickAction = ''
      void openDerivePicker()
    }
  },
  { immediate: true }
)

/** 自动驾驶并发配额（读数列进「容量与实验环境」的并发输入行：used/limit/queued） */
const concurrency = computed(() => ({
  used: Number(liveAutopilotConcurrency.value?.used ?? 0),
  limit: Math.max(1, Number(liveAutopilotConcurrency.value?.limit ?? 5)),
  queued: Number(liveAutopilotConcurrency.value?.queued ?? 0),
}))

/* 虚拟学习者专属出站速率（RPM）：KPI 读 inFlight/queued 与已保存上限；
   写控件在下方「容量与实验环境」卡（2026-10-25 搬回本页）。 */
const vlRpm = reactive({ inFlight: 0, queued: 0, rpm: 0 })
/** 已保存的 RPM 上限：速率卡「上限」分母只认服务端已保存值（写入在下方的容量卡） */
const vlRpmSavedLimit = ref(0)
/** 设置未加载位：getVirtualLabSettings 失败时置位——速率卡改显「不可用」，不把「没拉到」说成「0 / 不限」 */
const vlRpmLoadFailed = ref(false)
async function loadVlRpm() {
  try {
    const res = await adminVirtualLearnersApi.getVirtualLabSettings()
    const d = res.data?.data ?? {}
    const s = d.settings ?? {}
    const r = d.rpm ?? {}
    vlRpmSavedLimit.value = Number(s.virtualLearnerRpmLimit ?? 0)
    vlRpm.rpm = Number(r.rpm ?? 0)
    vlRpm.inFlight = Number(r.inFlight ?? 0)
    vlRpm.queued = Number(r.queued ?? 0)
    vlRpmLoadFailed.value = false
  } catch {
    /* 保留上次值（若有）；首访失败置 loadFailed，速率卡不把「没拉到」说成「0 / 不限」 */
    vlRpmLoadFailed.value = true
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

/** 容量与实验环境：抽屉承载（保存与脏态都在抽屉里，页面只负责打开） */
const settingsDrawerRef = ref<InstanceType<typeof VirtualLearnerSettingsDrawer> | null>(null)
function openSettingsFromMenu() {
  headMenu.value = ''
  settingsDrawerRef.value?.open()
}

/** 当前有活跃会话的虚拟学习者（"正在运行"条直接列名） */
const runningSamples = computed(() => samples.value.filter((s) => s.runningCount > 0))

/* ===== A2 生命周期分区：全量聚合口径（后端 sessionStats/staleCount）。
   2026-10-04 页头状态条退役后：stale 供页头「回收卡死」钮、活动会话（running+created）
   供完成率卡 hint（同一会话漏斗，读数不消失只换位） ===== */
const partition = computed(() => {
  const st = liveVirtualSessionStats.value
  return {
    created: st.created,
    running: st.running,
    stale: liveVirtualStaleCount.value
  }
})
/** 活动会话（全量会话口径）= 当前进行中 + 创建中（含卡死）；原状态条读数，2026-10-04 迁入完成率卡 hint。
    2026-10-15 KPI 审计：running 改取 /stats 的 F20 口径（已扣 autopilot=stopped 的已暂停会话）——
    列表接口 sessionStats.running 尚未扣减，与逐画像「运行状态」列及完成率卡同屏时会彼此打架，
    也与本卡同源的 completed/totalSessions（都来自 /stats）不同源。两处 running 都落到 /stats 单源。 */
const activeSessions = computed(() => {
  if (statsState.value === 'ready') return runStats.value.running + runStats.value.created
  return partition.value.running + partition.value.created
})

/* ===== A5 运行统计：完成率/失败率/平均时长/卡死最长分钟（GET /virtual-learners/stats） ===== */
const runStats = computed(() => liveVirtualRunStats.value)
/** P3（2026-10-04 全站评审）：完成率用原始分子/分母现算——后端 completionRate 是整数舍入值，
    3/685≈0.44% 被舍成 0% 后显「0%」读作「没有任何完成」（假零）；现算值交给 statsKpiPct 出「<1%」 */
const completionPct = computed(() => {
  const s = runStats.value
  return s.totalSessions > 0 ? (s.completed / s.totalSessions) * 100 : 0
})
/* 无会话时显「—」而不是 0%：0% 会被读成「跑过但全没完成」 */
const completionKpiText = computed(() => (runStats.value.totalSessions > 0 ? statsKpiPct(completionPct.value) : '—'))
const failureKpiText = computed(() => (runStats.value.totalSessions > 0 ? statsKpiPct(runStats.value.systemFailureRate) : '—'))

/* ===== P1#19 运行统计三态（2026-10-02 人类可读性）：
     live.ts 导出 liveVirtualStatsLoading/liveVirtualStatsError（stats 拉取失败不再被静默吞掉），
     本页消费：loading→KPI「…」；error→弱红「不可用」可点重试；仅成功后渲染数字。 */
const statsState = computed<'loading' | 'error' | 'ready'>(() => {
  if (liveVirtualStatsLoading.value) return 'loading'
  if (liveVirtualStatsError.value) return 'error'
  // 列表域失败必须并入：live.ts 只在列表 GET 成功后才去拉 stats（live.ts:1598），
  // 列表失败时 stats 保持初值 0 且 liveVirtualStatsError 仍为 false，
  // 于是「没拉到」被渲染成真实 0（完成率 0%、并发 0/10 还带 ok 绿调）。
  if (liveFailures.value.virtuals) return 'error'
  return 'ready'
})
/** 三态取值：仅 ready 渲染真实数字 */
function statsKpiValue(ready: string): string {
  if (statsState.value === 'loading') return '…'
  if (statsState.value === 'error') return '不可用'
  return ready
}
/** P3（2026-10-04 全站评审）：0<rate<1 显「<1%」——3/685≈0.44% 整数舍入成「0%」会被读成
    「没有任何完成」（假零）；真 0（无分母/无完成）照常显 0%。
    2026-10-11 走查：一般值原样插值，前端现算的完成率（completed/totalSessions 不是整数比）
    渲染成「3.8461538461538463%」——统一取整，与后端整数百分号 / 全站 Math.round 判例一致。 */
function statsKpiPct(rate: number | null | undefined): string {
  const v = rate ?? 0
  return v > 0 && v < 1 ? '<1%' : `${Math.round(v)}%`
}
/** 点卡片重试（live 层 retryLiveVirtualStats）。
    列表域失败也会把 statsState 置 error，故重试要同时重拉列表——否则只重试 stats
    而列表仍是失败态，KPI 会立刻回到 error，用户读作「点了没用」。 */
function onStatsRetry() {
  if (statsState.value !== 'error') return
  void retryLiveVirtualStats()
  void loadLiveData()
}

/** 「无响应候选」KPI：常可点——点击打开回收预览（统计失败态时改为重试） */
function onStaleKpiClick() {
  if (statsState.value === 'error') {
    onStatsRetry()
    return
  }
  if (partition.value.stale > 0) openReclaimModal()
}

/** 绝对时间（创建列 title，P1#20）：相对时间一律配绝对时间，10 秒内可判断新旧 */
function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 状态筛选（卡头工具栏 chips）：点激活项取消筛选 */
const statePillOptions = computed(() => stateFilterOptions.value.filter((o) => o.key))

/** 「今日调用」卡 hint（2026-10-05 口径纠偏）：只报口径不复述数字。原 hint「平均耗时」
    实为 avgDurationMs = 终态会话「创建→结束」平均墙钟时长（virtual-learners.ts:1704），
    挂在单次调用计数卡下读作「单次调用延迟 1494 分钟」（外部评审命中）——已迁完成率卡改标「会话均长」 */
const sessionAvgHuman = computed(() => {
  const ms = runStats.value.avgDurationMs || 0
  if (!ms) return ''
  if (ms >= 2 * 86400000) return `${(ms / 86400000).toFixed(1)} 天`
  if (ms >= 3600000) return `${Math.round(ms / 3600000)} 小时`
  if (ms >= 60000) return `${Math.round(ms / 60000)} 分钟`
  return `${Math.round(ms / 1000)} 秒`
})
/** 完成率卡 title：比值口径 + 会话均长 */
const completionTitle = computed(() => {
  const s = runStats.value
  const parts = [`已完成 ${s.completed} / 全部会话 ${s.totalSessions}`]
  if (activeSessions.value) parts.push(`活动会话 ${activeSessions.value}`)
  if (sessionAvgHuman.value) parts.push(`会话均长 ${sessionAvgHuman.value}`)
  return parts.join(' · ')
})
/** 系统失败率卡 title：四项分解 + 阈值披露 */
const failureTitle = computed(() => {
  const s = runStats.value
  return `系统失败 ${s.failed} · 人为终止 ${s.abandoned} · 已完成 ${s.completed} · 共 ${s.totalSessions} 场。两类合计占 ${statsKpiPct(s.failureRate)}。${FAILURE_RATE_THRESHOLD_NOTE}`
})
/* 卡内进度条已退役（2026-10-16 用户拍板「kpi 面板内部进度条不要出现」）：
   完成率/并发两张卡曾各挂一根 .mk-minibar 进度槽，读数已经在数值位与 hint 里说全了，
   卡内再画一根轨道只是重复表达、还把卡面高度撑高；读数类卡保持「label + 数值 + 一句口径」。 */

/** 运行指标已改走共享 KPI 栅格（模板内 MkKpi ×5）：原先的 MkStatStrip 自由指标条
 *  （含下面这份 runStatItems）已删除，口径数据（全量会话/系统失败/人为终止/平均耗时）
 *  改为卡片 hint 直接取 runStats 字段。 */

/* 仿真概览结论已收敛到单行状态条（KPI/结论随状态条 meta 展示，双块移除） */

/* ===== A1 批量操作：复选框（批量条拆分为 VirtualLearnerBatchBar 子组件） ===== */
const selected = ref<string[]>([])
/** 多选态 = 勾选列可见。默认不显示（2026-10-17 用户拍板），卡头「批量」按钮负责打开。 */
const batchMode = computed(() => !hiddenCols.value.has('check'))
function toggleBatchMode() {
  const next = new Set(hiddenCols.value)
  if (next.has('check')) next.delete('check')
  else {
    next.add('check')
    selected.value = []
  }
  hiddenCols.value = next
}

/* 表头全选 = 当前页全选（2026-10-11 用户拍板，与用户页同规则：跨页全量勾选对批量
   终止/删除太易误伤）。再点一次只清当前页；跨页仍可手动逐个勾（selected 保留）。 */
const pageSelectable = computed(() => paged.value)
const allChecked = computed(() => pageSelectable.value.length > 0 && pageSelectable.value.every((s) => selected.value.includes(s.id)))
const headerIndeterminate = computed(() => !allChecked.value && pageSelectable.value.some((s) => selected.value.includes(s.id)))

/* 选中集合随筛选与数据刷新收敛（审核 #57）：先勾选再筛掉后，批量条不得继续按
   视口外的旧集合执行批量终止/删除/自动驾驶——筛选条件一变即清空选中。 */
watch([keyword, stateFilter], () => {
  selected.value = []
})
/* 数据刷新（行已在别处删除）后按存活 id 收敛，宁可让批量条消失也不误伤已删对象 */
watch(samples, (list) => {
  if (!selected.value.length) return
  const alive = new Set(list.map((s) => s.id))
  const next = selected.value.filter((id) => alive.has(id))
  if (next.length !== selected.value.length) selected.value = next
})

function toggleAll() {
  const pageIds = pageSelectable.value.map((s) => s.id)
  const allOn = pageIds.length > 0 && pageIds.every((id) => selected.value.includes(id))
  if (allOn) {
    const drop = new Set(pageIds)
    selected.value = selected.value.filter((id) => !drop.has(id))
  } else {
    selected.value = [...new Set([...selected.value, ...pageIds])]
  }
}

/** 批量条子组件请求清理卡死：打开回收弹窗（dryRun 清单） */
function onBatchReclaim(ids: string[]) {
  void reclaimRef.value?.open(ids)
}

/** 「进行中」列每条会话的徽章点击直达该会话座舱（2026-10-18 多活跃会话：
 *  不再一律打开第一条——徽章挂在谁身上就打开谁，保证「点哪条进哪条」）。 */
</script>

<style scoped>
/* 固定列宽（2026-10-22 与教学组三表同判例）：虚拟学习者 / 长期倾向 / 进行中三列在
   auto 布局下按当页最长内容分宽，翻页整表跳动；fixed 后按表头定死，余量按权重摊开。
   宽度按 1280 现值校准并留余量，1200 档无横滚。 */
.vl-c-check { width: 36px; }
.vl-c-name { width: 160px; }
/* 长期倾向是自由文本、需要两行语义骨架；2026-10-24 把运行状态列的富余宽度让回这里 */
.vl-c-tendency { width: 240px; }
.vl-c-story { width: 84px; }
/* 运行状态只出一个「点 + 词」，按内容收缩到 ~90px（原 200px 让中段空出大片白） */
.vl-c-running { width: 84px; }
.vl-c-runs { width: 72px; }
/* 异常列要同时容下「失败 N」「无响应 N」两枚标签 */
.vl-c-abnormal { width: 124px; }
.vl-c-created { width: 70px; }
.vl-c-act { width: 96px; }
@media (max-width: 1279px) {
  /* 窄档同宽：状态列内容不变，不随断点回宽 */
  .vl-c-running { width: 84px; }
}
/* fixed 档列宽即契约：换行格的 220px min-width 会把短名顶出单元格 */
.vl-table .mk-cell-text--wrap, .vl-table .mk-cell-main .mk-cell-text--wrap { min-width: 0; max-width: 100%; }

/* 操作列已换 .mk-btn--sm 文字钮（原型 .btn--sm 词汇），图标对齐微调：
   mk-btn 给 svg 的 6px 右距在本钮偏松，收到与文字同组的 4px */
.mk-actions .mk-btn--sm svg { margin-right: 4px; }
/* 窄屏表格：列被压扁时靠 min-width 触发 .mk-table-scroll 横向滚动（对齐 AuditLogs 模式）。
   2026-10-21 列收敛后可见列从 10 → 7（窄档 5），min-width 跟着从 860 降到 720：
   1080 档内容区 794px，860 会多出一条 66px 的横滚。 */
.mk-table-scroll .mk-table { min-width: 720px; }
/* 名称格 flex 基座：头像 + mk-cell-main（强/副行截断由原语承担，2026-10-03 方言收敛） */
.vl-cell { display: flex; align-items: center; gap: 8px; min-width: 0; }
/* 运行状态列（2026-10-21 晚，用户「只反映是运行，还是停滞，还是停止，不显示阶段」）：
   一格里只有一个点 + 一个词，回答「这个人在跑还是不在跑」；阶段/路径/任务/终态一律进画像页。 */
.vl-state-cell { display: flex; align-items: center; min-height: 26px; }
.vl-runstate {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--mk-fs-body);
  font-weight: 600;
  white-space: nowrap;
}
.vl-runstate__dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--mk-faint-soft); }
.vl-runstate--running { color: var(--mk-green); }
.vl-runstate--running .vl-runstate__dot { background: var(--mk-green); }
/* 已暂停是运营主动停（不是故障）：中性灰；琥珀只留给超阈值无写入的「停滞」 */
.vl-runstate--paused { color: var(--mk-muted); }
.vl-runstate--paused .vl-runstate__dot { background: var(--mk-muted); }
.vl-runstate--stalled { color: var(--mk-amber); }
.vl-runstate--stalled .vl-runstate__dot { background: var(--mk-amber); }
.vl-runstate--stopped { color: var(--mk-muted); }
.vl-runstate--stopped .vl-runstate__dot { background: var(--mk-faint-soft); }
/* 刚派生的行：短暂高亮，让「创建完在哪一条」一眼可见（绿=成功，蓝色只留给可交互/选中） */
.vl-row--fresh { background: var(--mk-green-bg); }
.vl-row--fresh td:first-child { box-shadow: inset 2px 0 0 var(--mk-green); }
/* 「故事 / 路径」两数的分隔符：弱化到次级色，数字本身仍是 mk-num 的等宽口径 */
.vl-story-path__sep { color: var(--mk-faint); padding: 0 1px; }
/* 异常列：两类问题信号各自带词，零值时整格「—」不出声（用户：分两列时整片 0 0 最响） */
.vl-abnormal { white-space: nowrap; text-align: right; }
.vl-abn {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.6;
}
.vl-abn:first-child { margin-left: 0; }
.vl-abn--fail { color: var(--mk-red, #dc2626); background: var(--mk-red-bg); }
.vl-abn--stall { color: var(--mk-amber); background: var(--mk-amber-bg); }

/* 运行指标带：KPI 独占整行（共享 .mk-kpi-grid + MkKpi，卡自带面/描边，外层不套盒子）。
   2026-10-26 撤掉并发 / 速率两张卡：读数并进「容量与实验环境」的输入行。
   C 轮（2026-10-26 用户走查「kpi 面板设计配色和其他的不一样」）：撤本页私有覆写——
   原先这里把卡面刷成 --mk-surface-2（灰蓝）并按卡数写死 4/2 列，别的页是白面 + 共享
   弹性栅格；同一原语两套皮肤正是「每页各像各的」的来源。现在只留外层间距，列数与卡面
   全部交回 .mk-kpi-grid / .mk-kpi。 */
.vl-kpi {
  display: grid;
  gap: 8px;
  flex: none;
}
/* 页头两枚下拉（维护 / 新建）：触发钮 + 与工具条同一套弹层。
   遮罩用 fixed 铺满视口接外点，层级压在弹层下一档（--mk-z-menu 是 60） */
/* 异常列表头的「只看有异常」开关：24px 方形点击区，开着时蓝描边 */
.vl-th-filter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: 6px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--mk-radius-xs);
  background: transparent;
  color: var(--mk-muted);
  cursor: pointer;
  vertical-align: middle;
}
.vl-th-filter:hover { background: var(--mk-surface-2); color: var(--mk-ink); }
.vl-th-filter--on { border-color: var(--mk-blue); background: var(--mk-blue-bg); color: var(--mk-blue); }
.vl-headmenu { position: relative; display: inline-flex; }
.vl-headmenu__mask { position: fixed; inset: 0; z-index: var(--mk-z-menu); }
.vl-headmenu__pop { z-index: calc(var(--mk-z-menu) + 1); top: calc(100% + 6px); }
/* 批量态：蓝色只给「选中/可交互」——开着的批量按钮与勾选列同一状态 */
.vl-batch-toggle--on { border-color: var(--mk-blue); background: var(--mk-blue-bg); color: var(--mk-blue); }
/* 表格已换自动布局（原型 .tbl 词汇），fixed/colgroup 的列宽变量覆写随之删除；
   长内容截断上限收敛到共享原语（.mk-cell-text / .mk-cell-main strong） */
.vl-truncated { color: var(--mk-amber); font-weight: 700; }

/* 走查 2026-09-27：「正在运行」条胶囊按钮由子组件 VirtualLearnerRunningBar 渲染，
   实测高 23px 低于 24px 可点下限——本页 :deep 提最小高度补足 1px，padding 不动、视觉不变 */
.vl-running :deep(.vl-running__chip) { min-height: 24px; }

/* 名称头像（2026-10-15 用户拍板）：撤本页私造的「身份哈希八色」，改与教学组同款共享原语
   MkCellAvatar（虚拟学习者=紫）。本页私有 .vl-avatar / .vl-avatar--N 退役；
   mk/vlAvatar.ts 与 --mk-vl-avatar-* 仍由学习者卡库（VirtualLearnerCards）消费，保留 */
/* 名称列可点击进二级（整行不再监听点击，避免多选勾选时误触） */
.vl-cell--click { cursor: pointer; border-radius: 6px; transition: background 0.12s ease; }
.vl-cell--click:hover { background: color-mix(in srgb, var(--mk-blue) 6%, transparent); }
.vl-cell--click:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 1px; }

/* 暗色模式：全量走 var(--mk-*) token（faillink hover 也已 token 化），不再需要页面补丁 */

/* ===== 响应式覆写（必须留在文件末尾） =====
   同类规则散布多个位置时，插在前面的媒体块会被后面的桌面规则按同特异性覆盖成死代码——
   多活跃会话那一批规则（.vl-state-cell--multi / .vl-runline）就长在媒体块后面。 */
/* ≤1599 档：11 列在 1138px 内容区会超出，收单元格左右内边距 16→12 把整表塞回容器
   （任务进度恒定贴在阶段条尾部，任务不再单开列）
   （同 Skills.vue 先例，2026-10-03 浏览器巡检） */
/* LY12（1280 实测）：10 列内容宽 1071 vs 容器 994，最右「操作」列被卡片裁掉 77px。
   ≤1439 档再收紧：单元格内边距 12→10（×10 列 ≈40px）+「长期倾向」换行格
   min/max 220/320 → 120/160（该列是唯一可换行的宽列，收窄仍保两行语义骨架）
   → 整表塞回容器，1280 dx 归零。 */
@media (max-width: 1439px) {
  .mk-table th, .mk-table td { padding-inline: 10px; }
  .mk-table .mk-cell-text--wrap { min-width: 120px; max-width: 160px; }
}
/* 窄屏（≤720）次要列已随 useIsNarrow 隐藏，仅剩 3 列可完整放下，不再强制最小宽 */
@media (max-width: 720px) {
  .mk-table-scroll .mk-table { min-width: 0; }
}
</style>
