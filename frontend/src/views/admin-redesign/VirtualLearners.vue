<template>
  <div class="mk-page mk-page--fill">
    <!-- 页头（newui/admin pagehead）：页名 + 主操作（新建/批量新建/回收）。
         2026-10-04 页头状态条整体退役（教学会话页 c4ade91b 同款判例）：复读的「共 N 人」删
         （卡头行数已有）；生命周期筛选迁卡头工具栏 chips（该计数唯一来源）；「活动会话」
         并进完成率卡 hint（同一会话漏斗）；「已截断」警示并进卡头 meta（与行数同格就近）。 -->
    <MkPageHead title="虚拟学习者" sub="用合成画像批量压测教学闭环与 Skill 稳定性">
      <template #actions>
        <button
          v-if="partition.stale > 0"
          type="button"
          class="mk-btn mk-btn--sm"
          :disabled="reclaimRef?.state.busy"
          :title="'角标为超过回收阈值的无响应候选运行数（含豁免项）'"
          @click="openReclaimModal()"
        >
          {{ reclaimRef?.state.busy ? '回收中…' : `回收无响应（${partition.stale}）` }}
        </button>
        <button type="button" class="mk-btn mk-btn--sm" title="清理旧账号：按建号时间批量删除旧虚拟学习者（进行中与保留名单自动豁免，先预览再执行）" @click="cleanupRef?.open()">清理旧账号</button>
        <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" title="新建虚拟学习者" @click="openCreate">新建</button>
        <button type="button" class="mk-btn mk-btn--sm" title="批量新建：一次创建多个虚拟学习者（表格批量填写）" @click="openBatchCreate">批量新建</button>
        <!-- 批量入口（2026-10-19 运营走查「批量能力默认不存在」）：选择框列按 2026-10-18 拍板
             默认隐藏，而批量条又要选中才浮现——两个默认叠加，新来的运营在首屏看不到任何批量
             动作，会以为只能一个个点。这里给一枚页头入口，点了就打开选择框列（写的是 MkCols
             同一个存储键，仍算用户的列偏好）；列已可见时它自己让位。 -->
        <button
          v-if="isLive && !isNarrow && hiddenCols.has('check')"
          type="button"
          class="mk-btn mk-btn--sm"
          title="显示选择框列：逐行勾选后可批量启动全部故事、启动或停止自动驾驶、终止、清理无响应、删除"
          @click="revealCheckColumn"
        >批量操作</button>
      </template>
    </MkPageHead>

    <!-- 运行指标带（2026-09-29 从列表卡头搬出；2026-09-29 二次归一；2026-10-05 重排）：
         完成率/失败率/并发/今日调用/速率本来是 MkStatStrip 自由指标条，与全站 KPI 语言
         （共享 .mk-kpi-grid + MkKpi 卡）不是同一套（用户：「这个 kpi 还是很自由的 kpi 啊」），
         现改走共享栅格；每张卡的 hint 给派生口径，不复述数字。 -->
    <div class="vl-kpi">
      <!-- P1#19（2026-10-02 人类可读性）：运行统计三态——此前 stats 拉取失败被 .catch 静默吞掉，
           KPI 恒显「失败率 0%」假绿。现 loading→「…」、error→弱红「不可用」可点重试（调 live 层
           retryLiveVirtualStats）、仅成功后渲染数字。并发/速率两卡不走该统计接口，不受影响。 -->
      <section class="mk-kpi-grid">
        <MkKpi
          label="完成率"
          :value="statsKpiValue(statsKpiPct(completionPct))"
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
          label="系统失败率"
          :value="statsKpiValue(statsKpiPct(runStats.systemFailureRate))"
          :tone="statsState === 'error' ? 'bad' : failureRateTone(runStats.systemFailureRate, runStats.failed)"
          :hint="statsState === 'error' ? STATS_UNAVAILABLE_HINT : statsState === 'loading' ? '统计加载中…' : ''"
          :title="statsState === 'error' ? STATS_RETRY_TITLE : failureTitle"
          :clickable="statsState === 'error'"
          @click="onStatsRetry"
        />
        <MkKpi
          label="并发"
          :value="statsKpiValue(concurrencyText)"
          :tone="concurrencyTone"
          :hint="statsState === 'error' ? STATS_UNAVAILABLE_HINT : ''"
          :title="statsState === 'error' ? STATS_RETRY_TITLE : `${CONCURRENCY_KPI_TITLE}${VL_CHANNEL_LOCATION_TITLE}`"
          :clickable="true"
          @click="openVlChannelSettings"
        />
        <MkKpi
          label="今日调用"
          :value="statsKpiValue(String(runStats.todayCalls ?? 0))"
          :hint="statsState === 'error' ? STATS_UNAVAILABLE_HINT : ''"
          title="今日虚拟学习者与测试账号的调用次数"
          :clickable="statsState === 'error'"
          @click="onStatsRetry"
        />
        <MkKpi
          label="速率"
          :value="rateValue"
          :tone="vlRpmLoadFailed ? 'bad' : ''"
          :hint="rateHint"
          :clickable="true"
          :title="vlRpmLoadFailed ? '设置未加载，可重试' : `${RATE_KPI_TITLE}${vlRpm.queued > 0 ? ` · 当前排队 ${vlRpm.queued}` : ''}${VL_CHANNEL_LOCATION_TITLE}`"
          @click="openVlChannelSettings"
        />
        <!-- P-49（#74）：无响应候选此前只在页头按钮和分区里出现，没有 KPI 位 -->
        <MkKpi
          label="无响应候选"
          :value="statsState === 'error' ? '—' : liveVirtualStaleCount"
          :tone="statsState !== 'error' && liveVirtualStaleCount ? 'warn' : ''"
          :hint="statsState === 'error' ? STATS_UNAVAILABLE_HINT : ''"
          :title="statsState === 'error' ? STATS_RETRY_TITLE : '可用「回收无响应」处理'"
          :clickable="statsState === 'error'"
          @click="onStatsRetry"
        />
      </section>
    </div>

    <!-- 压测参数卡（速率上限 / 最高并发 / 日期模拟）已迁往「模型与接入 · 调用与健康」页签的
         「虚拟学习者通道 / 出站速率」分组（2026-10-13）：最高并发属上游容量治理，与其余接入
         设置同处管理（两条 RPM 上限本就挨着——平台全局管真实用户、VL 通道单独计量）；
         本页只保留并发 / 速率两个只读 KPI，点它们可直接到那处设置。
         运营在此仍可任意启动任意数量。 -->

    <!-- 学习者列表（「批量实验」2026-10-04 下线：批量发起与运行监控统一收在本页，
         资产输入归「学习者卡库」；旧 /admin/batch-experiments 深链重定向到本页） -->
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

    <!-- 日期模拟已并入上方「实验环境」条（2026-10-05 重排）：域级实验控制（模拟日期推进
         影响全部虚拟学习者），不是列表筛选——与速率上限同壳分组，展开体落条内第二行 -->

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
            :title="o.hint ? `${o.label}（${o.hint}）· 点击筛选` : `点击筛选「${o.label}」虚拟学习者`"
            @click="stateFilter = stateFilter === o.key ? 'all' : o.key"
          >{{ o.label }}<span v-if="o.key !== 'all'" class="mk-pill__count">{{ o.count }}</span></button>
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
        </div>
        <div class="mk-card__head-right">
          <!-- 搜索槽位统一（2026-10-15 用户拍板全站列表页）：搜索移到右组首位 -->
          <MkFilterSearch v-model="keyword" placeholder="搜索名称 / 倾向 / ID" />
          <!-- CP1：筛选命中数单源住在分页器（「共 N 条」），卡头不再渲染「X / N 人」；
               截断警示仍在此（数据完整性事实，与行数同格就近） -->
          <!-- 2026-10-05 卡头统一：补「列」按钮（此前全站唯一没有列控制的列表页）；
               窄屏档（isNarrow）仍按视口折叠，列勾选在桌面档生效 -->
          <!-- 选择框列默认隐藏（2026-10-18 用户「多选还是不要先显示」，与 People 同判例）：
               批量回收是低频动作，常驻一整列勾选框顶在身份列前面，会被读成每行都要勾。
               入口保留在「列」菜单（选择框，标了批量操作）。存储键升 v2：v1 存下的隐藏集不含
               check，不升版新默认对老用户无效。 -->
          <MkCols
            :col-defs="vlColDefs"
            storage-key="wf_vl_hidden_cols_v2"
            :default-hidden="['check']"
            v-model:hidden="hiddenCols"
          />
          <span v-if="isLive && liveVirtualsTotal > samples.length" class="mk-card__meta vl-truncated" title="后端一次下发的条数有上限，超出的未载入">
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
      <table class="mk-table">
        <thead>
          <tr>
            <th v-if="isLive && !isNarrow && !hiddenCols.has('check')" scope="col">
              <input type="checkbox" aria-label="全选当前页" title="全选/清空当前页的虚拟学习者" :indeterminate="headerIndeterminate" :checked="allChecked" @change="toggleAll" />
            </th>
            <th
              scope="col"
              class="mk-th--sortable"
              :aria-sort="vlSortState('name')"
              @click="toggleVlSort('name')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('name')">虚拟学习者<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th v-if="!isNarrow && !hiddenCols.has('tendency')">长期倾向</th>
            <th
              v-if="!isNarrow && !hiddenCols.has('story')"
              scope="col"
              class="mk-th--right mk-th--sortable"
              title="故事池条数 / 已生成路径条数（一个故事可衍生多条路径，同一路径的多次运行不重复计）"
              :aria-sort="vlSortState('story')"
              @click="toggleVlSort('story')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('story')">故事 / 路径<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              scope="col"
              class="mk-th--sortable"
              title="当前活跃运行（进行中 + 已暂停）逐条显示，无活跃运行时显示最近一次"
              :aria-sort="vlSortState('running')"
              @click="toggleVlSort('running')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('running')">进行中<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              v-if="showTaskColumn"
              scope="col"
              class="mk-th--right"
              :title="TASK_COL_TITLE"
            >任务</th>
            <th
              v-if="!isNarrow && !hiddenCols.has('sessions')"
              scope="col"
              class="mk-th--right mk-th--sortable"
              :title="SESSIONS_COL_TITLE"
              :aria-sort="vlSortState('sessions')"
              @click="toggleVlSort('sessions')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('sessions')">运行<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              v-if="!isNarrow && !hiddenCols.has('failed')"
              scope="col"
              class="mk-th--right mk-th--sortable"
              :title="FAILED_COL_TITLE"
              :aria-sort="vlSortState('failed')"
              @click="toggleVlSort('failed')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('failed')">失败<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              v-if="!isNarrow && !hiddenCols.has('stalled')"
              scope="col"
              class="mk-th--right mk-th--sortable"
              :title="stalledColTitle"
              :aria-sort="vlSortState('stalled')"
              @click="toggleVlSort('stalled')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('stalled')">无响应<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              v-if="!isNarrow && !hiddenCols.has('created')"
              scope="col"
              class="mk-th--sortable"
              :aria-sort="vlSortState('created')"
              @click="toggleVlSort('created')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('created')">创建<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in paged" :key="s.id">
            <td v-if="isLive && !isNarrow && !hiddenCols.has('check')"><input v-model="selected" type="checkbox" :value="s.id" :aria-label="`选择 ${s.name}`" @click.stop /></td>
            <td>
              <div class="vl-cell vl-cell--click" role="button" tabindex="0" :title="`查看 ${s.name} 的画像：故事池 / 运行记录 / 运行控制`" @click="openSubPage('virtual', s.id)" @keydown.enter="openSubPage('virtual', s.id)" @keydown.space.prevent="openSubPage('virtual', s.id)">
                <!-- 2026-10-15 用户拍板：撤本页私造的「身份哈希八色」头像，改与教学组同款共享原语
                     MkCellAvatar（虚拟学习者=紫）。头像在 .mk-cell-main 外（同 Skills / 教学组名称格结构）：
                     mk-cell-main strong 的 display:block 高特异性会压过 strong 上的 flex，头像留格内会跌回块流 -->
                <MkCellAvatar :name="s.name" tone="virtual" />
                <div class="mk-cell-main">
                  <strong :title="s.name">{{ s.name }}</strong>
                  <span class="mk-cell-sub" :title="`ID ${s.id}`">{{ shortId(s.id) }}</span>
                </div>
              </div>
            </td>
            <td v-if="!isNarrow && !hiddenCols.has('tendency')">
              <span class="mk-cell-text--wrap" :class="{ 'mk-na': !s.goal || s.goal === '—' }" :title="s.goal || undefined">{{ s.goal || '未设置' }}</span>
            </td>
            <td v-if="!isNarrow && !hiddenCols.has('story')" class="mk-num" :title="storyPathTitle(s)">
              <template v-if="s.storyCount > 0">
                <span>{{ s.storyCount }}</span><span class="vl-story-path__sep" aria-hidden="true"> / </span><span :class="{ 'mk-na': s.pathCount === 0 }">{{ s.pathCount }}</span>
              </template>
              <span v-else class="mk-na">—</span>
            </td>
            <td>
              <div class="vl-state-cell" :class="{ 'vl-state-cell--multi': activeRunsOf(s).length > 1 }">
                <!-- 多活跃会话逐条渲染（2026-10-18）：一个学习者可同时跑多条路径，
                     运行在前、暂停在后；每条徽章可点进自己的座舱。
                     无活跃运行时回落到最近一次运行的历史进度，并标「最近」，
                     避免「进行中」列里的进度条被读成现在在跑。 -->
                <template v-if="activeRunsOf(s).length">
                  <div v-for="(run, i) in activeRunsOf(s)" :key="run.sessionId" class="vl-runline">
                    <RunStateBadge
                      :status="run.state"
                      :hint="runBadgeHint(run)"
                      clickable
                      @click.stop="openRun(run.sessionId)"
                    />
                    <span class="vl-stage" :title="runStageTitle(s, run)">
                      <RunStageBar
                        :stage="runStage(run)"
                        :status="run.state"
                        :task-progress="run.taskTotal > 0 ? { done: run.taskDone, total: run.taskTotal } : null"
                        :show-task-text="taskInline"
                      />
                    </span>
                    <!-- 余量跟最后一条同行，任务列逐行对齐不被多出来的一行破坏 -->
                    <span
                      v-if="i === activeRunsOf(s).length - 1 && omittedRuns(s) > 0"
                      class="vl-runmore"
                      :title="`另有 ${omittedRuns(s)} 条活跃运行未展开。逐条最多 ${ACTIVE_RUNS_LIMIT} 条，运行在前、暂停在后，各按最近写入倒序，进画像页看全部`"
                    >+{{ omittedRuns(s) }}</span>
                  </div>
                </template>
                <!-- 聚合说有活跃会话、但样本里拿不到详情（窗口外/缺 id）：不冒领成「最近」或「空闲」 -->
                <span
                  v-else-if="activeCount(s) > 0"
                  class="vl-unlisted"
                  :title="`有 ${activeCount(s)} 条活跃运行，但不在本次载入的运行明细里，进画像页查看`"
                >活跃 {{ activeCount(s) }} 条 · 未展开</span>
                <template v-else-if="s.stageProgress">
                  <div class="vl-runline vl-runline--history">
                    <span class="vl-histmark">最近</span>
                    <span class="vl-stage" :title="historicTitle(s)">
                      <RunStageBar
                        :stage="stageBarStage(s)"
                        :status="null"
                        :task-progress="s.stageProgress.learnStarted && s.stageProgress.taskTotal > 0 ? { done: s.stageProgress.taskDone, total: s.stageProgress.taskTotal } : null"
                        :show-task-text="taskInline"
                      />
                    </span>
                  </div>
                </template>
                <span v-else class="mk-na" title="当前没有进行中的运行">空闲</span>
              </div>
            </td>
            <td v-if="showTaskColumn" class="mk-num">
              <!-- 任务数单列（2026-10-18）：与「进行中」列同一顺序、逐行对齐；
                   无活跃运行时显示最近一次运行的任务数（弱化），多条会话不伪造合计 -->
              <div class="vl-taskcell">
                <span
                  v-for="run in activeRunsOf(s)"
                  :key="run.sessionId"
                  class="vl-tasknum"
                  :title="taskRunTitle(run)"
                >
                  <template v-if="run.taskTotal > 0">{{ run.taskDone }}/{{ run.taskTotal }}</template>
                  <span v-else class="mk-na">—</span>
                </span>
                <span
                  v-if="!activeRunsOf(s).length && activeCount(s) === 0 && s.stageProgress"
                  class="vl-tasknum vl-tasknum--history"
                  title="最近一次运行（已结束）的任务完成数"
                >
                  <template v-if="s.stageProgress.taskTotal > 0">{{ s.stageProgress.taskDone }}/{{ s.stageProgress.taskTotal }}</template>
                  <span v-else class="mk-na">—</span>
                </span>
                <span
                  v-if="!activeRunsOf(s).length && (activeCount(s) > 0 || !s.stageProgress)"
                  class="mk-na"
                  :title="activeCount(s) > 0 ? '活跃运行不在本次载入的运行明细里，任务进度暂不可见' : undefined"
                >—</span>
              </div>
            </td>
            <td v-if="!isNarrow && !hiddenCols.has('sessions')" class="mk-num">{{ s.sessions }}</td>
            <td v-if="!isNarrow && !hiddenCols.has('failed')" class="mk-num">
              <button
                type="button"
                class="vl-faillink mk-num"
                :class="{ 'vl-num--bad': s.failedCount > 0 }"
                :title="failCellTitle(s.failedCount, s.abandonedCount ?? 0)"
                @click.stop="openSubPage('virtual', s.id)"
              >{{ s.failedCount }}</button>
            </td>
            <td v-if="!isNarrow && !hiddenCols.has('stalled')" class="mk-num">
              <span v-if="s.stalledCount > 0" class="vl-num--bad" :title="stalledCellTitle(s)">{{ s.stalledCount }}</span>
              <span v-else class="mk-na" title="当前没有无响应的运行">—</span>
            </td>
            <td v-if="!isNarrow && !hiddenCols.has('created')"><span class="mk-cell-sub" :title="s.createdAt ? `创建于 ${fmtDateTime(s.createdAt)}` : undefined">{{ s.created }}</span></td>
            <td>
              <div class="mk-actions mk-actions--left">
                <!-- live：入口在名称格（画像页），此处行内只留主操作「运行」——原型 .btn--sm 文字钮词汇
                     （原 mk-icon-btn--text 是图标钮套文字的混搭）。
                     2026-10-12 外部批评采纳（操作密度）：低频诊断「测试」收进 ⋯ 菜单，
                     与「行内 ⋯ 菜单：低频/危险操作收进菜单，避免与高频操作平铺」的原语判例一致 -->
                <button
                  v-if="isLive"
                  type="button"
                  class="mk-btn mk-btn--sm"
                  :class="{ 'vl-op--muted': s.storyCount === 0 }"
                  :title="s.storyCount === 0 ? '需先生成故事才能运行' : '启动一次新的实验运行（不影响已有运行）'"
                  @click.stop="openLaunch(s)"
                ><Play :size="14" :stroke-width="1.75" /><span>{{ s.storyCount === 0 ? '需故事' : '运行' }}</span></button>
                <div v-if="isLive" class="mk-menu">
                  <!-- aria-expanded 按行判定（同审核 #168 判例）：menuOpen 是全局布尔，任一行开
                       菜单其余行都报 expanded=true；openMenu 才是「本行是否开」 -->
                  <button type="button" class="mk-menu__btn" aria-label="更多操作（测试 / 来源卡 / 删除）" aria-haspopup="menu" :aria-expanded="openMenu === s.id" :title="'更多操作：单步测试 / 查看来源卡 / 删除（不可恢复）'" @click.stop="toggleMenu(s.id)">⋯</button>
                  <div v-if="openMenu === s.id" class="mk-menu__pop" role="menu" aria-label="更多操作" :style="popStyle" @click.stop>
                    <!-- 低频诊断：用人设和故事直接跑一次 Prompt 对话（不创建用例、不影响正式会话） -->
                    <button type="button" class="mk-menu__item" role="menuitem" title="单步测试：用该人设和故事直接跑一次 Prompt 对话，看输出的字段是否符合预期（不创建用例、不影响正式运行）" @click="openPromptTest(s)">单步测试</button>
                    <!-- 双向互链（卡库 ↔ 虚拟学习者）：卡与本人是同一条档案记录，卡 id 即本行 id -->
                    <button type="button" class="mk-menu__item" role="menuitem" title="查看来源卡：该虚拟学习者在「学习者卡库」里的同一张卡（来源 / 人设 / 已备故事）" @click="menuOpenSourceCard(s)">查看来源卡</button>
                    <div class="mk-menu__sep" aria-hidden="true"></div>
                    <button type="button" class="mk-menu__item mk-menu__item--danger" role="menuitem" :disabled="busyId === s.id" title="删除该虚拟学习者（其运行记录一并删除，不可恢复）" @click="menuRemove(s)">删除</button>
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
        tone="error"
        title="虚拟学习者加载失败"
        description="暂时无法加载虚拟学习者列表。"
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
        unit="位学习者"
      />
    </div>

    <!-- 批量操作条（全局 mk-batchbar：选中后底部浮现） -->
    <VirtualLearnerBatchBar
      v-if="isLive && selected.length"
      v-model:selected="selected"
      :samples="samples"
      @reclaim="onBatchReclaim"
    />

    <!-- 一键回收 / 清理旧账号 / 新建 / 启动 / 批量新建 / 单步测试：拆分为独立子组件（各自 Teleport 到 body）。 -->
    <VirtualLearnerReclaim ref="reclaimRef" @done="onReclaimDone" />
    <VirtualLearnerCleanup ref="cleanupRef" :samples="samples" @done="onReclaimDone" />
    <VirtualLearnerCreate ref="createRef" />
    <VirtualLearnerLaunch ref="launchRef" />
    <VirtualLearnerBatchCreate ref="batchCreateRef" />
    <VirtualLearnerPromptTest ref="promptRef" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, watch, nextTick, onUnmounted } from 'vue'
import { Play } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { openSubPage, intent, isLive } from './store'
import { liveVirtuals, liveDeleteVirtual, liveLoading, liveFailures, loadLiveData, timeAgo, errMsg, shortId, liveVirtualsTotal, liveVirtualSessionStats, liveVirtualStaleCount, liveVirtualRunStats, liveAutopilotConcurrency, liveVirtualStatsLoading, liveVirtualStatsError, retryLiveVirtualStats } from './live'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { useRowMenu } from './useRowMenu'
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
import RunStateBadge from './RunStateBadge.vue'
import RunStageBar from './RunStageBar.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import VirtualLearnerRunningBar from './VirtualLearnerRunningBar.vue'
import VirtualLearnerReclaim from './VirtualLearnerReclaim.vue'
import VirtualLearnerCleanup from './VirtualLearnerCleanup.vue'
import VirtualLearnerCreate from './VirtualLearnerCreate.vue'
import VirtualLearnerLaunch from './VirtualLearnerLaunch.vue'
import VirtualLearnerBatchCreate from './VirtualLearnerBatchCreate.vue'
import VirtualLearnerBatchBar from './VirtualLearnerBatchBar.vue'
import VirtualLearnerPromptTest from './VirtualLearnerPromptTest.vue'
import type { VirtualLearnerRow as Sample, BatchTask, ActiveRun } from './virtualLearnersTypes'

/* ---------- 文案单源（R6 同文件复读治理）：同一句用户可见文案只在此定义一次，模板/脚本就地引用 ---------- */
const STATS_RETRY_TITLE = '运行统计拉取失败：点击重试'
const STATS_UNAVAILABLE_HINT = '统计不可用 · 点击重试'
/* 容量治理去向（2026-10-19 运营走查）：并发上限 / VL 专属 RPM / 日期模拟都在「模型与接入 ·
   调用与健康」页签的「虚拟学习者通道 / 出站速率」分组里。此前三处注释与速率卡的 title 都写着
   「模型与接入 → 虚拟学习者」页签——那个页签 2026-10-15 重组时就没了，照它找必然扑空。 */
const VL_CHANNEL_LOCATION_TITLE = '上限与日期模拟在「模型与接入 · 调用与健康」的「虚拟学习者通道」'
const CONCURRENCY_KPI_TITLE = '自动驾驶同时在跑的运行数占配额比。「已满」是资源占满（后续请求排队），不是故障。'
const RATE_KPI_TITLE = '在途为正在出站的调用数。上限是已保存的速率配置。'
/* 列头口径（表头 title 与「列」菜单共用同一句，避免同页两处漂移） */
const SESSIONS_COL_TITLE = '累计运行数（全部运行，含终态）'
const FAILED_COL_TITLE = '已失败/已终止运行数（全量聚合）'
const TASK_COL_TITLE = '进行中运行已完成的任务数 / 总任务数。多条活跃运行按行与「进行中」对齐，无活跃运行时显示最近一次运行'
/* 「已暂停不计入」必须点名是**哪一种**暂停：本页「已暂停」pill/徽章指的是自动驾驶被停
   （autopilot=stopped），而回收口径排除的是会话页「暂停」写下的 teaching.paused——后者暂停后
   无写入属预期、回收干跑清单也跳过它（VirtualLearnerReclaim 同用「管理员暂停」一词）。
   自动驾驶已暂停的会话仍在回收候选里，写成「已暂停的不计入」会与回收清单对不上。 */
const STALLED_COL_TITLE = '运行中的运行超过回收阈值仍没有新写入的数量。可用「回收无响应」清理，管理员在运行页手动暂停的运行不计入'
/** 逐条活跃会话的展示上限（与后端 deriveActiveRuns 的 ACTIVE_RUNS_LIMIT 同值：
    后端 services/virtual-lab/virtual-run-progress.ts）。改一处必须改另一处——余量文案要用它。 */
const ACTIVE_RUNS_LIMIT = 3

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
    createdAt: String(v.createdAt || ''),
    created: timeAgo(v.createdAt),
    tags: Array.isArray(v.tags) ? v.tags : []
  }))
)

/** 阶段条 stage 取值：按三态还原累计进度（已结算行也能显示 Goal/Path/Learn），
    无进度时回落会话阶段。非活跃行 status 传 null，避免被终态强行涂满或全灰 */
function stageOfProgress(
  p: { learnStarted: boolean; pathReady: boolean; goalReady: boolean } | null | undefined,
  fallback: string | null
): string | null {
  if (p) {
    if (p.learnStarted) return 'learn'
    if (p.pathReady) return 'path'
    if (p.goalReady) return 'goal'
  }
  return fallback
}
function stageBarStage(s: Sample): string | null {
  return stageOfProgress(s.stageProgress, s.currentStage)
}

/* ---------- 「进行中」列：多活跃会话逐条渲染（2026-10-18） ---------- */
function activeRunsOf(s: Sample): ActiveRun[] {
  if (s.activeRuns?.length) return s.activeRuns
  /* 兼容旧缓存/滚动升级中的旧后端：没有 activeRuns 时用原来的单条口径还原一条，
     避免徽章与阶段条一起消失（旧行为是 runningCount>0 就画一条）。 */
  if (s.runningCount > 0 || (s.pausedCount ?? 0) > 0) {
    const state: 'running' | 'paused' = s.runningCount > 0 ? 'running' : 'paused'
    const sessionId = state === 'running' ? s.runningSessionIds[0] : s.pausedSessionIds?.[0]
    if (sessionId) {
      return [{
        sessionId,
        state,
        currentStage: s.currentStage,
        goalReady: !!s.stageProgress?.goalReady,
        pathReady: !!s.stageProgress?.pathReady,
        learnStarted: !!s.stageProgress?.learnStarted,
        taskDone: Number(s.stageProgress?.taskDone) || 0,
        taskTotal: Number(s.stageProgress?.taskTotal) || 0,
        stalled: false,
      }]
    }
  }
  return []
}
/** 活跃会话总数（运行 + 已暂停，全量聚合）：样本窗口外也能如实说「有 N 条」 */
function activeCount(s: Sample): number {
  return Number(s.runningCount || 0) + Number(s.pausedCount || 0)
}
/** 列表逐条上限之外还有几条（后端 activeRunTotal 来自全量聚合）。
    两个数都可能是窗口内的量：取较大者做基准，免得旧缓存缺 activeRunTotal 时算出负数或不披露余量 */
function omittedRuns(s: Sample): number {
  const runs = activeRunsOf(s).length
  const total = Math.max(Number(s.activeRunTotal) || 0, runs)
  return total - runs
}
function runStage(run: ActiveRun): string | null {
  return stageOfProgress(run, run.currentStage)
}
/** 每条活跃会话的徽章提示：说清是运行还是暂停，无响应的那条直接点明 */
function runBadgeHint(run: ActiveRun): string {
  const base = run.state === 'running' ? '该运行正在运行' : '该运行的自动驾驶已暂停'
  const stall = run.stalled ? ' · 超过回收阈值没有新写入（无响应）' : ''
  return `${base}${stall}`
}
/** 每条阶段条的口径：多活跃时说明这是第几条、共几条 */
function runStageTitle(s: Sample, run: ActiveRun): string {
  const idx = activeRunsOf(s).findIndex((r) => r.sessionId === run.sessionId) + 1
  const total = activeRunsOf(s).length
  return total > 1
    ? `第 ${idx} 条活跃运行的阶段进度（共 ${total} 条在列表内）`
    : '这条活跃运行的阶段进度'
}
/** 任务格口径：任务数来自这条会话的已完成/总任务 */
function taskRunTitle(run: ActiveRun): string {
  if (run.taskTotal <= 0) return '这条运行还没有任务维度数据'
  return `这条运行已完成 ${run.taskDone} / ${run.taskTotal} 个任务`
}
/** 历史进度（无活跃会话）的条目标题：明确是最近一次、不是现在在跑 */
function historicTitle(s: Sample): string {
  return s.pathCount > 1
    ? `当前没有活跃运行，显示最近一次运行的阶段进度（该学习者共 ${s.pathCount} 条路径）`
    : '当前没有活跃运行，显示最近一次运行的阶段进度'
}
/** 「无响应」单元格口径：条数 + 阈值 + 哪一种暂停不计入（与表头同一来源） */
function stalledCellTitle(s: Sample): string {
  const t = reclaimThresholdText()
  const within = t ? `超过 ${t}` : '超过回收阈值'
  return `${s.stalledCount} 条进行中的运行${within}仍没有新写入。可用「回收无响应」清理，管理员在运行页手动暂停的运行不计入`
}

/** 「故事 / 路径」单元格 title：故事是复杂情景、路径是从情景里走出来的学习路线，
    一个故事可以衍生多条路径（每次运行生成一条），两个数不等是正常状态。 */
function storyPathTitle(s: Sample): string {
  if (s.storyCount === 0) return '尚未生成故事，需先生成才能运行'
  if (s.pathCount === 0) return `故事池 ${s.storyCount} 条，还没有生成路径（开始运行后生成）`
  const base = `故事池 ${s.storyCount} 条，已生成路径 ${s.pathCount} 条`
  return s.pathCount > s.storyCount
    ? `${base}。一个故事可衍生多条路径，同一路径的多次运行不重复计`
    : base
}

const keyword = ref('')
/** F20 口径分列（2026-10-15）：单元格 title 给系统失败/人为终止的分解——
    合并数读不出「运营信号（人设被反复手动停）vs 工程信号（系统在坏）」的差别；
    分解放进既有 tooltip，不加列（宽表压力不动） */
function failCellTitle(failed: number, abandoned: number): string {
  if (failed <= 0 && abandoned <= 0) return '无失败/终止运行'
  return `系统失败 ${failed} · 人为终止 ${abandoned}（合计 ${failed + abandoned}）`
}
/** 状态过滤（轴 A 生命周期）：'all' = 全部 / running / paused / queued / failed / created
    （哨兵用 'all' 与 useListQueryState 的 pill 约定一致；URL 承载见下方 useListQueryState） */
const stateFilter = ref('all')
/** 状态过滤 chips 计数（与 samples 联动）；hint 进 title（P2 2026-10-02：口径随名披露）。
    2026-10-04 状态条退役后由卡头工具栏 chips 消费（该计数唯一来源） */
const stateFilterOptions = computed(() => {
  const count = (pred: (s: Sample) => boolean) => samples.value.filter(pred).length
  // 列表失败时计数不可信（samples 为空 → 全 0，读作「一条都没有」）；显示 '—' 而非 0
  const failed = statsState.value === 'error'
  const n = (v: number) => (failed ? '—' : v)
  return [
    { key: 'all', label: '全部', count: n(samples.value.length), hint: '' },
    { key: 'running', label: '进行中', count: n(count((s) => s.runningCount > 0)), hint: '有进行中运行的学习者数（同一学习者可同时跑多条路径，行内逐条显示）' },
    // P1-3（2026-10-04 全站评审）：计数谓词与 filtered 的筛选谓词（runningCount===0 && pausedCount>0）同式，
    // 否则 pill「已暂停 2」点进去只筛出 1 条（同时在跑的学习者被计入却被筛掉）
    { key: 'paused', label: '已暂停', count: n(count((s) => s.runningCount === 0 && (s.pausedCount ?? 0) > 0)), hint: '当前无进行中运行、有暂停运行的学习者' },
    // P2（2026-10-02 人类可读性）：原名「需关注」读作当前异常，实为累计曾失败/被终止——正名 + 口径入 title
    { key: 'failed', label: '曾失败', count: n(count((s) => s.failedCount > 0)), hint: '累计有失败或终止运行的虚拟学习者，非当前异常。该数为系统失败+人为终止的合计，分解见「失败」列悬浮说明' },
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
    /* 「进行中」列同时显示运行与已暂停会话，排序按活跃总数，避免暂停多的行被排到空闲区 */
    running: (s) => s.runningCount + (s.pausedCount ?? 0),
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

const isFiltered = computed(() => !!keyword.value.trim() || stateFilter.value !== 'all')
function clearFilters() {
  keyword.value = ''
  stateFilter.value = 'all'
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
  allowedPills: ['all', 'running', 'paused', 'failed']
})

const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
watch([keyword, stateFilter], () => {
  page.value = 1
})

/* ===== 拆分子组件引用与父侧触发入口（弹窗状态在子组件内，父页面只发指令） ===== */
const createRef = ref<InstanceType<typeof VirtualLearnerCreate> | null>(null)
const launchRef = ref<InstanceType<typeof VirtualLearnerLaunch> | null>(null)
const reclaimRef = ref<InstanceType<typeof VirtualLearnerReclaim> | null>(null)
const cleanupRef = ref<InstanceType<typeof VirtualLearnerCleanup> | null>(null)
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

/* 窄屏（≤720）：11 列只保留「名称 / 进行中 / 操作」，次要列（勾选/倾向/故事池/任务/
   会话/失败/卡死/创建）随 useIsNarrow 隐藏——此前整表 860px 最小宽只能横向拖（vlab 大表
   窄屏零降级问题）；行详情（画像页）信息不丢 */
const isNarrow = useIsNarrow()
const router = useRouter()
/* ≤1439 档（LY12 判例）整表已贴容器宽：任务数不单开一列，回落到阶段条尾部；
   宽屏才成列，便于纵向扫读。列被用户手动隐藏时同样回落。 */
const isTableCompact = useIsNarrow(1439)

/* 列显隐（2026-10-05 卡头统一补「列」按钮）：次要列可勾选；名称/进行中/操作是
   身份与动作列不进 colDefs。窄屏（isNarrow）折叠优先于列勾选——窄屏档勾了也不显
   （行详情进画像页，信息不丢）。
   2026-10-18：勾选列进 colDefs 并默认隐藏（用户「多选还是不要先显示」，与 People 同判例）
   2026-10-19：默认隐藏保留，但页头补「批量操作」入口（revealCheckColumn）——唯一入口
   只剩列菜单时，首屏看不到任何批量动作（运营走查原话「批量能力默认不存在」）。 */
const VL_COL_DEFS = [
  /* 列菜单这一项与页头「批量操作」是做同一件事的两个入口：此处可回到隐藏态 */
  { key: 'check', label: '选择框（批量操作）', title: '勾选后可在列表底部批量启动全部故事、启动或停止自动驾驶、终止、清理无响应、删除' },
  { key: 'tendency', label: '长期倾向' },
  { key: 'story', label: '故事 / 路径', title: '故事池条数 / 已生成路径条数（一个故事可衍生多条路径，同一路径的多次运行不重复计）' },
  { key: 'task', label: '任务', title: TASK_COL_TITLE },
  { key: 'sessions', label: '运行', title: SESSIONS_COL_TITLE },
  { key: 'failed', label: '失败', title: FAILED_COL_TITLE },
  { key: 'stalled', label: '无响应', title: STALLED_COL_TITLE },
  { key: 'created', label: '创建' },
] as const
const hiddenCols = ref<Set<string>>(new Set())
/** 任务列是否成列（宽屏且未被用户隐藏）；否则任务数回到每条阶段条尾部 */
const showTaskColumn = computed(() => !isNarrow.value && !isTableCompact.value && !hiddenCols.value.has('task'))
const taskInline = computed(() => !showTaskColumn.value)
/* ≤1439 档任务列本就不成列（回落阶段条尾部），列菜单里的「任务」勾选项在该档是死开关——
   点它没有任何可见变化。按档位把它从菜单里摘掉，菜单只列当前真能生效的列（同「窄屏折叠
   优先于列勾选」的既有判例：不给做不到的承诺）。 */
const vlColDefs = computed(() => VL_COL_DEFS.filter((d) => d.key !== 'task' || showTaskColumn.value))
/** 回收阈值的人话（30 分钟 / 24 小时）：直接写「1440 分钟」没人能立刻换算 */
function reclaimThresholdText(): string {
  const mins = Math.round((Number(liveVirtualRunStats.value.reclaimThresholdMs) || 0) / 60000)
  if (!mins) return ''
  if (mins % 60 === 0) return `${mins / 60} 小时`
  if (mins >= 60) return `${Math.round((mins / 60) * 10) / 10} 小时`
  return `${mins} 分钟`
}
/** 「无响应」表头口径：把阈值直接写出来（用户问「无响应是什么意思」——不能只让人猜） */
const stalledColTitle = computed(() => {
  const t = reclaimThresholdText()
  return t ? `${STALLED_COL_TITLE}（当前阈值 ${t}）` : STALLED_COL_TITLE
})

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
/* P2（2026-10-02 人类可读性）：并发「已满」从红改琥珀——资源占满是容量状态（后续请求排队），
   不是故障；红色留给真实失败信号。≥70% 与已满同档琥珀。
   2026-10-14（KPI 审计）：补失败态。liveAutopilotConcurrency 由**列表** GET 写入
   （live.ts:1642 在列表请求里赋值），列表失败时它保持初值 {used:0,limit:10} →
   不判三态会把「没拉到」画成 0/10 的 ok 绿调（假健康）。statsState 已并入
   liveFailures.virtuals 正是为这一类兜底，这里接上它，与同页其余四卡同口径。
   注：tone 原写作 `concurrencyTone === 'ok' ? 'ok' : 'warn'`，等于把 bad 一档吃掉，一并放开。 */
const concurrencyTone = computed<'ok' | 'warn' | 'bad'>(() => {
  if (statsState.value === 'error') return 'bad'
  const pct = concurrencyPct.value
  if (pct >= 70) return 'warn'
  return 'ok'
})

/* 虚拟学习者专属出站速率（RPM）：仅保留只读运行态读数——「速率」KPI 读 inFlight/queued 与已保存上限；
   速率上限 / 最高并发 / 日期模拟的写控件已迁往「模型与接入 · 调用与健康」的「虚拟学习者通道」分组（2026-10-13）。 */
const vlRpm = reactive({ inFlight: 0, queued: 0, rpm: 0 })
/** 已保存的 RPM 上限：速率卡「上限」分母只认服务端已保存值（写入已在设置页，本页只读展示） */
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

/** 当前有活跃会话的虚拟学习者（"正在运行"条直接列名） */
const runningSamples = computed(() => samples.value.filter((s) => s.runningCount > 0))
/** 已暂停自动驾驶的虚拟人：无进行中会话，但有暂停会话（autopilot=stopped） */
const pausedSamples = computed(() => samples.value.filter((s) => s.runningCount === 0 && (s.pausedCount ?? 0) > 0))

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
    列表接口 sessionStats.running 尚未扣减，与逐画像「进行中」列及完成率卡同屏时会彼此打架，
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

/* ===== P1#19 运行统计三态（2026-10-02 人类可读性）：
     live.ts 导出 liveVirtualStatsLoading/liveVirtualStatsError（stats 拉取失败不再被静默吞掉），
     本页消费：loading→KPI「…」；error→弱红「不可用」可点重试；仅成功后渲染数字。
     并发/速率两卡不依赖该接口，保持常显。 */
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
/** 三态 hint：2026-10-21 起卡面副行只留取数状态（加载中 / 不可用），不再写口径说明 */
/** 点卡片重试（live 层 retryLiveVirtualStats）；非错误态点击是空操作。
    列表域失败也会把 statsState 置 error，故重试要同时重拉列表——否则只重试 stats
    而列表仍是失败态，KPI 会立刻回到 error，用户读作「点了没用」。 */
function onStatsRetry() {
  if (statsState.value !== 'error') return
  void retryLiveVirtualStats()
  void loadLiveData()
}

/** 绝对时间（创建列 title，P1#20）：相对时间一律配绝对时间，10 秒内可判断新旧 */
function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 状态筛选（卡头工具栏 chips，2026-10-04 自页头状态条迁入）：进行中/已暂停/曾失败；点激活项取消筛选 */
const statePillOptions = computed(() => stateFilterOptions.value.filter((o) => o.key))

/** 并发文案：used/limit（满 / 排队） */
const concurrencyText = computed(() => {
  const c = concurrency.value
  if (c.queued > 0) return `${c.used}/${c.limit} · 排队 ${c.queued}`
  if (c.used >= c.limit) return `${c.used}/${c.limit} · 已满`
  return `${c.used}/${c.limit}`
})

/** 速率文案（P1#20）：值与口径分栏——比值「在途 / 上限」进 value、单位与「已保存值」口径进 hint。
    原写法把「在途 N · 上限 X/分」整串塞进 value，183px 卡宽下必换行成两行，把整排 KPI
    拉伸到 180px（连带 220px 的 KPI 带吃掉列表卡高度，裸评审 2026-10-03）；拆开后各占一行。
    上限读已保存值（vlRpmSavedLimit），本页无写控件（改配置在「模型与接入 · 调用与健康」的「虚拟学习者通道」分组） */
const rateValue = computed(() => {
  // #59：设置未加载时不把初始 0 断言成「0 / 不限」，显式「不可用」
  if (vlRpmLoadFailed.value) return '不可用'
  const cap = vlRpmSavedLimit.value > 0 ? `${vlRpmSavedLimit.value}/分` : '不限'
  return `${vlRpm.inFlight} / ${cap}`
})
const rateHint = computed(() => {
  if (vlRpmLoadFailed.value) return '设置未加载 · 点击重试'
  // 2026-10-21：去掉「上限读已保存配置」这类来源说明，只留比例式口径
  return ''
})

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
/** 完成率卡 title：比值口径 + 移出读数行的会话均长 */
/* 2026-10-19 用户走查「hint 在报读数」：原副行「已完成 N / 全部会话 M · 活动会话 K」是读数，
   改由本 title 承载（副行只留「已完成 / 全部会话 · 活动会话另计」这个口径） */
const completionTitle = computed(() => {
  const s = runStats.value
  const parts = [`已完成 ${s.completed} / 全部会话 ${s.totalSessions}`]
  if (activeSessions.value) parts.push(`活动会话 ${activeSessions.value}`)
  parts.push('完成率按会话统计，活动会话含进行中与创建中')
  if (sessionAvgHuman.value) parts.push(`会话均长 ${sessionAvgHuman.value}`)
  return parts.join(' · ')
})
/** 系统失败率卡副行 = 口径（2026-10-19 用户走查「hint 在报读数」）：原副行把
    「系统失败 8 · 人为终止 28 · 已完成 0 · 共 36 场」四项分解当读数报在卡面；
    读数的两处历史歧义（① 比值与数值位大字重复；② 0 完成时两项凑满 100% 被读成
    「失败率 100%」）一并解决——分解式（8+28+0=36 自明）与「失败合计」改为随长释进 title。 */
/** 系统失败率卡 title：四项分解 + 跨页同源声明 + 阈值披露 */
const failureTitle = computed(() => {
  const s = runStats.value
  return `系统失败 ${s.failed} · 人为终止 ${s.abandoned} · 已完成 ${s.completed} · 共 ${s.totalSessions} 场（相加即全部会话）。按全部会话计算，与总览页「系统失败率」统计方式相同。管理员手动停止等人为终止单独统计，两类合计占 ${statsKpiPct(s.failureRate)}。${FAILURE_RATE_THRESHOLD_NOTE}`
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

/** 页头「批量操作」：把选择框列打开（写 MkCols 同一个 hiddenCols，onWatch 会落 localStorage，
    所以这是一次持久的列偏好变更，不是临时态） */
function revealCheckColumn() {
  const next = new Set(hiddenCols.value)
  next.delete('check')
  hiddenCols.value = next
}

/** 并发/速率 KPI 的点击：失败态优先重试（hint 写着「点击重试」），否则去容量治理那处设置。
    两个读数合用一个入口——它们本就是同一组配置的两个面，运营看到读数时正是要改上限的时候。 */
function openVlChannelSettings() {
  if (statsState.value === 'error' || vlRpmLoadFailed.value) {
    if (statsState.value === 'error') onStatsRetry()
    if (vlRpmLoadFailed.value) void loadVlRpm()
    return
  }
  void router.push({ path: '/admin/api-config', query: { tab: 'routing' } })
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
function openRun(sessionId: string) {
  if (sessionId) openSubPage('session', sessionId)
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
/* 名称格 flex 基座：头像 + mk-cell-main（强/副行截断由原语承担，2026-10-03 方言收敛） */
.vl-cell { display: flex; align-items: center; gap: 8px; min-width: 0; }
/* 状态列：进行中胶囊 / 失败数 / 卡死徽章 分列展示（一列一语义）；gap+wrap 归并为一处定义 */
.vl-state-cell { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-height: 26px; }
/* 多活跃会话（2026-10-18）：逐条一行，徽章 + 阶段条；行高 24 与右侧「任务」列逐行对齐 */
.vl-state-cell--multi { display: grid; gap: 2px; justify-items: start; }
.vl-runline { display: flex; align-items: center; gap: 6px; min-height: 24px; min-width: 0; }
.vl-runline--history { gap: 4px; }
/* 历史进度标记：无活跃会话时这条 bar 不是「现在在跑」 */
.vl-histmark {
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-faint-soft);
  background: var(--mk-surface-2);
  border-radius: var(--mk-radius-xs);
  padding: 0 4px;
  white-space: nowrap;
}
/* 聚合有活跃会话、样本里拿不到详情时的如实提示 */
.vl-unlisted { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-muted); white-space: nowrap; }
/* 逐条展示上限之外还有几条（跟最后一行同行，不额外占行高）。
   做成胶囊而不是裸「+1」：右侧紧邻任务列，裸数字会被读成任务数的一部分 */
.vl-runmore {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-muted);
  background: var(--mk-surface-2);
  border-radius: 999px;
  padding: 0 6px;
  line-height: 1.6;
  white-space: nowrap;
}
/* 「任务」列：与进行中列同一顺序、逐行右对齐；无活跃会话时显示最近一次（弱化） */
.vl-taskcell { display: grid; gap: 2px; justify-content: end; justify-items: end; }
.vl-tasknum {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 24px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  white-space: nowrap;
}
.vl-tasknum--history { color: var(--mk-faint-soft); font-weight: 600; }
/* 阶段条 wrapper：只承载口径 title（多活跃会话时每条一行，各带自己的 title） */
.vl-stage { display: inline-flex; min-width: 0; }
/* 「故事 / 路径」两数的分隔符：弱化到次级色，数字本身仍是 mk-num 的等宽口径 */
.vl-story-path__sep { color: var(--mk-faint); padding: 0 1px; }
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
   读写分块判例不变：写控制（速率上限/日期模拟）不进数字栅格，收进下方「压测参数」页签卡。
   卡内进度条 2026-10-16 按用户要求退役（见脚本侧同名注记），本处不再挂 minibar。 */
.vl-kpi {
  display: grid;
  gap: 8px;
  flex: none;
}
/* 压测参数卡的 .vl-settings/.vl-rpm 样式已随卡片迁往 VirtualLabLoadSettings.vue（2026-10-13） */
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
   多活跃会话那一批规则（.vl-state-cell--multi / .vl-runline / .vl-taskcell）就长在媒体块后面。 */
/* ≤1599 档：11 列在 1138px 内容区会超出，收单元格左右内边距 16→12 把整表塞回容器
   （任务列在 ≤1439 档不再单开，回落阶段条尾部，见 isTableCompact）
   （同 Skills.vue 先例，2026-10-03 浏览器巡检） */
@media (max-width: 1599px) {
  .mk-table th, .mk-table td { padding-inline: 12px; }
}
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
