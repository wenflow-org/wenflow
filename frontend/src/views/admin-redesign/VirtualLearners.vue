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
          :title="'角标 = 超阈值卡死候选数（含 hold/租约等豁免项）；点击干跑确认清单，逐条列出可回收与豁免原因后批量标记'"
          @click="openReclaimModal()"
        >
          {{ reclaimRef?.state.busy ? '回收中…' : `回收卡死（${partition.stale}）` }}
        </button>
        <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" title="新建虚拟学习者：填写名称/目标/故事，生成后可运行实验会话" @click="openCreate">新建</button>
        <button type="button" class="mk-btn mk-btn--sm" title="批量新建：一次创建多个虚拟学习者（表格批量填写）" @click="openBatchCreate">批量新建</button>
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
          :hint="statsKpiHint(completionHint)"
          :title="statsState === 'error' ? '运行统计拉取失败：点击重试' : '活动会话 = 当前进行中 + 创建中会话数（含卡死），全库口径；会话均长 = 终态会话「创建→结束」的平均墙钟时长（非单次调用延迟，2026-10-05 口径纠偏：原挂「今日调用」卡下标「平均耗时」）'"
          :clickable="statsState === 'error'"
          @click="onStatsRetry"
        >
          <span class="mk-minibar" aria-hidden="true"><i class="mk-minibar__fill" :style="{ width: completionBarPct }"></i></span>
        </MkKpi>
        <!-- B8-F4-4 口径对齐：本卡值取 systemFailureRate（failed / 全部），原 label「失败率」
             配 hint 里并列的「人为终止 1096」让 24% 被读成「全部失败占比」（真值 97%）。
             总览页同事实标作「系统失败率」（Overview.vue:506 同判例），此处跟随；
             hint 补分母与「人为终止另计，合计 X%」，运营不再低估。 -->
        <MkKpi
          label="系统失败率"
          :value="statsKpiValue(statsKpiPct(runStats.systemFailureRate))"
          :tone="statsState === 'error' ? 'bad' : (runStats.systemFailureRate ?? 0) > 0 ? 'bad' : ''"
          :hint="statsKpiHint(`系统失败 ${runStats.failed} / 全部会话 ${runStats.totalSessions} · 人为终止 ${runStats.abandoned} 另计（合计 ${statsKpiPct(runStats.failureRate)}）`)"
          :title="statsState === 'error' ? '运行统计拉取失败：点击重试' : '本值 = 系统失败率（failed / 全部会话），与总览页「系统失败率」同口径；人为终止（abandoned：管理员止停/批量终止/僵尸回收/学习者放弃）另计，两者合计见 hint（2026-08-21 口径拆分）'"
          :clickable="statsState === 'error'"
          @click="onStatsRetry"
        />
        <MkKpi
          label="并发"
          :value="concurrencyText"
          :tone="concurrencyTone === 'ok' ? 'ok' : 'warn'"
          hint="自动驾驶并发配额"
          title="并发 = 自动驾驶同时在跑的会话数占配额比；「已满」是资源占满（后续请求排队），不是故障"
        >
          <span class="mk-minibar" aria-hidden="true"><i class="mk-minibar__fill" :style="{ width: concurrencyBarPct }"></i></span>
        </MkKpi>
        <MkKpi
          label="今日调用"
          :value="statsKpiValue(String(runStats.todayCalls ?? 0))"
          :hint="statsKpiHint('虚拟/测试账号口径')"
          title="今日虚拟/测试账号出站调用数（仿真看板口径；总览页「今日调用」为真实用户口径，两者相加为全平台）。2026-10-05 口径纠偏：原 hint「平均耗时」实为终态会话平均墙钟时长（最长以天计），已迁完成率卡改标「会话均长」"
          :clickable="statsState === 'error'"
          @click="onStatsRetry"
        />
        <MkKpi
          label="速率"
          :value="rateValue"
          :tone="vlRpmLoadFailed ? 'bad' : ''"
          :hint="rateHint"
          :clickable="vlRpmLoadFailed"
          :title="vlRpmLoadFailed ? '设置未加载：点击重试' : '在途 = 正在出站的调用数；上限 = 已保存的 VL RPM 配置（不含输入框未保存的改动）'"
          @click="vlRpmLoadFailed && loadVlRpm()"
        />
      </section>
    </div>

    <!-- 压测参数卡（2026-10-08 重做）：原先是「无标题卡 + 41px 通栏下划线页签条」——
         1603px 的线只为两个短标签而画，卡体 90% 空白，输入框连可见字段名都没有
         （含义只存在于 aria-label 与页签名里），切页签还会让卡高在百来 px 与整张
         日期表单之间跳；那条 .tabs 也是本页手搓的，缺 roving tabindex/方向键/aria-controls，
         与平台 tab 契约不符。现在：标题进卡头、视图切换换成分段控件（.mk-seg，宽随内容、贴右），
         速率行补可见字段名（.mk-field--row）。
         分组不变（2026-10-05 拍板：两组设置不同屏并排，避免双保存各占一角）；
         EG4 守卫不变：显式「保存」+「未保存」脏态 + 回车等价保存。 -->
    <div class="mk-card vl-settings">
      <div class="mk-card__head">
        <h3 class="mk-card__title">压测参数</h3>
        <div class="mk-card__head-right">
          <div class="mk-seg" role="group" aria-label="压测参数视图">
            <button
              type="button"
              class="mk-seg__item"
              :class="{ 'mk-seg__item--active': settingsTab === 'rate' }"
              :aria-pressed="settingsTab === 'rate'"
              @click="settingsTab = 'rate'"
            >速率上限</button>
            <button
              type="button"
              class="mk-seg__item"
              :class="{ 'mk-seg__item--active': settingsTab === 'date' }"
              :aria-pressed="settingsTab === 'date'"
              @click="settingsTab = 'date'"
            >
              日期模拟<span v-if="dateSimEnabled" class="vl-settings__on">已开启</span>
            </button>
          </div>
        </div>
      </div>
      <div v-show="settingsTab === 'rate'" class="vl-settings__pane">
        <label
          class="mk-field mk-field--row"
          title="虚拟学习者专属出站上限（每分钟调用数）；与平台全局速率相互独立，不挤占真实用户额度"
        >
          <span class="mk-field__label">出站速率上限</span>
          <span class="vl-rpm__ctl">
            <input
              v-model.number="vlRpm.limit"
              type="number"
              min="0"
              max="100000"
              step="10"
              class="mk-filter__input vl-rpm__input"
              aria-label="虚拟学习者专属出站 RPM 上限"
              :disabled="vlRpmLoadFailed"
              :title="vlRpmLoadFailed ? '设置未加载：为避免用错底数覆盖服务端配置，已禁用编辑' : undefined"
              @focus="vlRpmFocused = true"
              @blur="vlRpmFocused = false"
              @input="vlRpmDirty = true"
              @keydown.enter.prevent="saveVlRpm"
            />
            <span class="vl-rpm__unit">/分</span>
          </span>
        </label>
        <button type="button" class="mk-btn mk-btn--sm" :disabled="!vlRpmDirty || vlRpmSaving || vlRpmLoadFailed" @click="saveVlRpm">
          {{ vlRpmSaving ? '保存中…' : '保存' }}
        </button>
        <span v-if="vlRpmDirty" class="vl-rpm__dirty">未保存</span>
        <span v-if="vlRpmLoadFailed" class="vl-rpm__failed" role="alert">设置未加载，保存已禁用（请刷新重试）</span>
        <span v-else class="vl-rpm__hint">虚拟学习者专属 · 0 = 不限 · 不占真实用户额度</span>
      </div>
      <div v-show="settingsTab === 'date'" class="vl-settings__pane">
        <SimulatedDaySettings @enabled="dateSimEnabled = $event" />
      </div>
    </div>

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
          <MkFilterSearch v-model="keyword" placeholder="搜索名称 / 倾向 / ID" />
          <!-- 生命周期筛选（原页头状态条的 meta-link 迁入，2026-10-04）：这三个计数在本页
               仅此一处；点选筛选 / 再点取消，胶囊形态对齐全站工具条 chips（同 TeachingSessions） -->
          <button
            v-for="o in statePillOptions"
            :key="o.key"
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': stateFilter === o.key }"
            :aria-pressed="stateFilter === o.key"
            :title="o.hint ? `${o.label}（${o.hint}）· 点击筛选` : `点击筛选「${o.label}」虚拟学习者`"
            @click="stateFilter = stateFilter === o.key ? '' : o.key"
          >{{ o.label }}<span class="mk-pill__count">{{ o.count }}</span></button>
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
        </div>
        <div class="mk-card__head-right">
          <!-- CP1：筛选命中数单源住在分页器（「共 N 条」），卡头不再渲染「X / N 人」；
               截断警示仍在此（数据完整性事实，与行数同格就近） -->
          <!-- 2026-10-05 卡头统一：补「列」按钮（此前全站唯一没有列控制的列表页）；
               窄屏档（isNarrow）仍按视口折叠，列勾选在桌面档生效 -->
          <MkCols :col-defs="vlColDefs" storage-key="wf_vl_hidden_cols_v1" v-model:hidden="hiddenCols" />
          <span v-if="isLive && liveVirtualsTotal > samples.length" class="mk-card__meta vl-truncated" :title="`后端共 ${liveVirtualsTotal} 人，列表仅加载前 ${samples.length} 行`">
            已截断 · 共 {{ liveVirtualsTotal }} 人
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
            <th v-if="isLive && !isNarrow" scope="col">
              <input type="checkbox" aria-label="全选（含跨页）" title="全选/清空当前筛选下的全部虚拟学习者（含跨页，不只当前页）" :checked="allChecked" @change="toggleAll" />
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
              title="已生成故事条数（0 = 未生成，需先生成才能运行）"
              :aria-sort="vlSortState('story')"
              @click="toggleVlSort('story')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('story')">故事池<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              scope="col"
              class="mk-th--sortable"
              title="当前进行中/创建中的会话数及最近阶段；点击进入会话座舱"
              :aria-sort="vlSortState('running')"
              @click="toggleVlSort('running')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('running')">进行中<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              v-if="!isNarrow && !hiddenCols.has('sessions')"
              scope="col"
              class="mk-th--right mk-th--sortable"
              title="累计会话数（全部会话，含终态）"
              :aria-sort="vlSortState('sessions')"
              @click="toggleVlSort('sessions')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('sessions')">会话<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              v-if="!isNarrow && !hiddenCols.has('failed')"
              scope="col"
              class="mk-th--right mk-th--sortable"
              title="已失败/已终止会话数（全量聚合）"
              :aria-sort="vlSortState('failed')"
              @click="toggleVlSort('failed')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('failed')">失败<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              v-if="!isNarrow && !hiddenCols.has('stalled')"
              scope="col"
              class="mk-th--right mk-th--sortable"
              title="超过回收阈值无写入且无活跃租约的会话数（可在状态条一键回收）"
              :aria-sort="vlSortState('stalled')"
              @click="toggleVlSort('stalled')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleVlSort('stalled')">卡死<span class="mk-th__caret" aria-hidden="true"></span></button></th>
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
            <td v-if="isLive && !isNarrow"><input v-model="selected" type="checkbox" :value="s.id" :aria-label="`选择 ${s.name}`" @click.stop /></td>
            <td>
              <div class="vl-cell vl-cell--click" role="button" tabindex="0" :title="`查看 ${s.name} 的画像：故事池 / 运行记录 / 会话控制`" @click="openSubPage('virtual', s.id)" @keydown.enter="openSubPage('virtual', s.id)" @keydown.space.prevent="openSubPage('virtual', s.id)">
                <!-- 头像在 .mk-cell-main 外（同 Skills 名称格结构）：mk-cell-main strong 的
                     display:block 高特异性会压过 strong 上的 flex，头像留格内会跌回块流 -->
                <span class="vl-avatar" :class="avatarClass(s)" aria-hidden="true">{{ s.name.slice(0, 1) }}</span>
                <div class="mk-cell-main">
                  <strong :title="s.name">{{ s.name }}</strong>
                  <span class="mk-cell-sub" :title="`ID ${s.id}`">{{ shortId(s.id) }}</span>
                </div>
              </div>
            </td>
            <td v-if="!isNarrow && !hiddenCols.has('tendency')">
              <span class="mk-cell-text--wrap" :class="{ 'mk-na': !s.goal || s.goal === '—' }" :title="s.goal || undefined">{{ s.goal || '未设置' }}</span>
            </td>
            <td v-if="!isNarrow && !hiddenCols.has('story')" class="mk-num" :title="s.storyCount > 0 ? `故事池 ${s.storyCount} 条` : '尚未生成故事，需先生成才能运行'">
              <span v-if="s.storyCount > 0">{{ s.storyCount }}</span>
              <span v-else class="mk-na">—</span>
            </td>
            <td>
              <div class="vl-state-cell">
                <template v-if="s.runningCount > 0 || (s.pausedCount ?? 0) > 0">
                  <RunStateBadge
                    :status="s.runningCount > 0 ? 'running' : 'paused'"
                    :hint="`${s.runningCount} 个会话进行中 / ${s.pausedCount ?? 0} 个已暂停 · 点击进入会话座舱`"
                    clickable
                    @click.stop="openRunningSession(s)"
                  />
                  <RunStageBar
                    :stage="s.currentStage"
                    :status="s.runningCount > 0 ? 'running' : 'paused'"
                    :task-progress="s.stageProgress?.learnStarted ? { done: s.stageProgress.taskDone, total: s.stageProgress.taskTotal } : null"
                    :show-task-text="false"
                  />
                </template>
                <span v-else class="mk-na" title="当前没有进行中的会话">空闲</span>
              </div>
            </td>
            <td v-if="!isNarrow && !hiddenCols.has('sessions')" class="mk-num">{{ s.sessions }}</td>
            <td v-if="!isNarrow && !hiddenCols.has('failed')" class="mk-num">
              <button
                type="button"
                class="vl-faillink mk-num"
                :class="{ 'vl-num--bad': s.failedCount > 0 }"
                :title="s.failedCount > 0 ? `${s.failedCount} 个会话已失败/已终止；点击进入画像页，可对失败会话重试（续传保留进度）` : '无失败/终止会话'"
                @click.stop="openSubPage('virtual', s.id)"
              >{{ s.failedCount }}</button>
            </td>
            <td v-if="!isNarrow && !hiddenCols.has('stalled')" class="mk-num">
              <span v-if="s.stalledCount > 0" class="vl-num--bad" :title="`${s.stalledCount} 个进行中会话已卡死（超过回收阈值无写入），可在状态条一键回收`">{{ s.stalledCount }}</span>
              <span v-else class="mk-na" title="无卡死会话">—</span>
            </td>
            <td v-if="!isNarrow && !hiddenCols.has('created')"><span class="mk-cell-sub" :title="s.createdAt ? `创建于 ${fmtDateTime(s.createdAt)}` : undefined">{{ s.created }}</span></td>
            <td>
              <div class="mk-actions mk-actions--left">
                <!-- live：入口在名称格（画像页），此处只留真正的行内操作（运行 / 测试 / 更多）
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
                  <!-- aria-expanded 按行判定（同审核 #168 判例）：menuOpen 是全局布尔，任一行开
                       菜单其余行都报 expanded=true；openMenu 才是「本行是否开」 -->
                  <button type="button" class="mk-menu__btn" aria-label="更多操作（删除）" aria-haspopup="menu" :aria-expanded="openMenu === s.id" :title="'更多操作：删除（不可恢复）'" @click.stop="toggleMenu(s.id)">⋯</button>
                  <div v-if="openMenu === s.id" class="mk-menu__pop" role="menu" aria-label="更多操作" :style="popStyle" @click.stop>
                    <button type="button" class="mk-menu__item mk-menu__item--danger" role="menuitem" :disabled="busyId === s.id" title="删除该虚拟学习者（级联删除，不可恢复）" @click="menuRemove(s)">删除</button>
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
        note="行数 = 虚拟学习者；上方「全部会话」为会话口径，两者不同源"
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
import { liveVirtuals, liveDeleteVirtual, liveLoading, liveFailures, loadLiveData, timeAgo, errMsg, shortId, liveVirtualsTotal, liveVirtualSessionStats, liveVirtualStaleCount, liveVirtualRunStats, liveAutopilotConcurrency, liveVirtualStatsLoading, liveVirtualStatsError, retryLiveVirtualStats } from './live'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { useRowMenu } from './useRowMenu'
import { useIsNarrow } from './useIsNarrow'
import { useSafePolling } from '@/composables/useSafePolling'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkCols from '@/components/mk/MkCols.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import { vlAvatarIndexOf } from '@/components/mk/vlAvatar'
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

/* 头像按名称哈希取色，同一人恒定同色；八色板单源 = main.css --mk-vl-avatar-* +
   mk/vlAvatar.ts 的共享哈希（CM3：原 TS 数组 + 两页 CSS 三份拷贝收敛） */
function avatarClass(s: Sample): string {
  return `vl-avatar--${vlAvatarIndexOf(s.name)}`
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
/** 状态过滤 chips 计数（与 samples 联动）；hint 进 title（P2 2026-10-02：口径随名披露）。
    2026-10-04 状态条退役后由卡头工具栏 chips 消费（该计数唯一来源） */
const stateFilterOptions = computed(() => {
  const count = (pred: (s: Sample) => boolean) => samples.value.filter(pred).length
  // 列表失败时计数不可信（samples 为空 → 全 0，读作「一条都没有」）；显示 '—' 而非 0
  const failed = statsState.value === 'error'
  const n = (v: number) => (failed ? '—' : v)
  return [
    { key: '', label: '全部', count: n(samples.value.length), hint: '' },
    { key: 'running', label: '进行中', count: n(count((s) => s.runningCount > 0)), hint: '' },
    // P1-3（2026-10-04 全站评审）：计数谓词与 filtered 的筛选谓词（runningCount===0 && pausedCount>0）同式，
    // 否则 pill「已暂停 2」点进去只筛出 1 条（同时在跑的学习者被计入却被筛掉）
    { key: 'paused', label: '已暂停', count: n(count((s) => s.runningCount === 0 && (s.pausedCount ?? 0) > 0)), hint: '口径：当前无进行中会话、有暂停会话的学习者' },
    // P2（2026-10-02 人类可读性）：原名「需关注」读作当前异常，实为累计曾失败/被终止——正名 + 口径入 title
    { key: 'failed', label: '曾失败', count: n(count((s) => s.failedCount > 0)), hint: '口径：累计有失败/终止会话的虚拟学习者，非当前异常' },
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

/* ===== A1 行内 ⋯ 菜单：先关菜单再执行删除 ===== */
const { openMenu, toggleMenu, closeMenu, popStyle } = useRowMenu()
function menuRemove(s: Sample) {
  closeMenu()
  void removeSample(s)
}

/* 窄屏（≤720）：10 列只保留「名称 / 进行中 / 操作」，次要列（勾选/倾向/故事池/会话/
   失败/卡死/创建）随 useIsNarrow 隐藏——此前整表 860px 最小宽只能横向拖（vlab 大表
   窄屏零降级问题）；行详情（画像页）信息不丢 */
const isNarrow = useIsNarrow()

/* 列显隐（2026-10-05 卡头统一补「列」按钮）：六个次要列可勾选；名称/进行中/操作是
   身份与动作列不进 colDefs，勾选列仍随 live+窄屏逻辑。窄屏（isNarrow）折叠优先于列
   勾选——窄屏档勾了也不显（行详情进画像页，信息不丢） */
const vlColDefs = [
  { key: 'tendency', label: '长期倾向' },
  { key: 'story', label: '故事池', title: '已生成故事条数（0 = 未生成，需先生成才能运行）' },
  { key: 'sessions', label: '会话', title: '累计会话数（全部会话，含终态）' },
  { key: 'failed', label: '失败', title: '已失败/已终止会话数（全量聚合）' },
  { key: 'stalled', label: '卡死', title: '超过回收阈值无写入且无活跃租约的会话数（可在状态条一键回收）' },
  { key: 'created', label: '创建' },
] as const
const hiddenCols = ref<Set<string>>(new Set())

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
   不是故障；红色留给真实失败信号。≥70% 与已满同档琥珀。 */
const concurrencyTone = computed(() => {
  const pct = concurrencyPct.value
  if (pct >= 70) return 'warn'
  return 'ok'
})

/* 虚拟学习者专属出站速率（RPM）：设置 + 运行态。与平台全局速率相互独立。 */
const vlRpm = reactive({ limit: 0, inFlight: 0, queued: 0, rpm: 0 })
/* 压测参数卡页签（2026-10-05 tab 化）：默认速率上限（轻页签日常位）；日期模拟开启态徽标 */
const settingsTab = ref<'rate' | 'date'>('rate')
const dateSimEnabled = ref(false)
/** 已保存的 RPM 上限（P1#20）：速率卡「上限」分母只认服务端已保存值/保存成功回执，
    不吃输入框脏值——管理员改到一半的数字不该出现在只读 KPI 里 */
const vlRpmSavedLimit = ref(0)
/* 轮询回填保护：limit 是输入框 v-model（写控件），若 10s 轮询无条件覆写，
   会冲掉管理员正在输入/未保存的值 → 仅在非聚焦且无未保存编辑时回填 limit，
   rpm/inFlight/queued 是只读展示字段，始终照常刷新 */
const vlRpmFocused = ref(false)
const vlRpmDirty = ref(false)
/** 保存中位（EG4）：显式保存钮的忙碌态，防重复提交 */
const vlRpmSaving = ref(false)
/** 设置未加载位（#59）：getVirtualLabSettings 失败时置位——速率卡改显「不可用」、
   保存钮与输入框禁用，禁止管理员拿初始 0 当底数覆盖服务端配置（对齐 SimulatedDaySettings.loadFailed） */
const vlRpmLoadFailed = ref(false)
async function loadVlRpm() {
  try {
    const res = await adminVirtualLearnersApi.getVirtualLabSettings()
    const d = res.data?.data ?? {}
    const s = d.settings ?? {}
    const r = d.rpm ?? {}
    vlRpmSavedLimit.value = Number(s.virtualLearnerRpmLimit ?? 0)
    if (!vlRpmFocused.value && !vlRpmDirty.value) {
      vlRpm.limit = Number(s.virtualLearnerRpmLimit ?? 0)
    }
    vlRpm.rpm = Number(r.rpm ?? 0)
    vlRpm.inFlight = Number(r.inFlight ?? 0)
    vlRpm.queued = Number(r.queued ?? 0)
    vlRpmLoadFailed.value = false
  } catch {
    /* 保留上次值（若有）；首访失败置 loadFailed，速率卡不把「没拉到」说成「0 / 不限」 */
    vlRpmLoadFailed.value = true
  }
}
async function saveVlRpm() {
  if (vlRpmSaving.value || !vlRpmDirty.value || vlRpmLoadFailed.value) return
  const value = Math.max(0, Math.min(100000, Math.round(Number(vlRpm.limit) || 0)))
  vlRpm.limit = value
  vlRpmSaving.value = true
  try {
    const res = await adminVirtualLearnersApi.updateVirtualLabSettings({ virtualLearnerRpmLimit: value })
    vlRpmDirty.value = false /* 已保存：服务端值与输入一致，恢复轮询回填 */
    vlRpmSavedLimit.value = value /* 保存成功：速率卡「上限」分母随之更新（回执口径） */
    const r = res.data?.data?.rpm
    if (r) {
      vlRpm.rpm = Number(r.rpm ?? value)
      vlRpm.inFlight = Number(r.inFlight ?? 0)
      vlRpm.queued = Number(r.queued ?? 0)
    }
    toast.success(value > 0 ? `虚拟学习者 RPM 上限已设为 ${value}` : '虚拟学习者 RPM 已设为不限')
  } catch (e) {
    toast.error(errMsg(e) || '保存失败')
  } finally {
    vlRpmSaving.value = false
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
/** 活动会话（全量会话口径）= 当前进行中 + 创建中（含卡死）；原状态条读数，2026-10-04 迁入完成率卡 hint */
const activeSessions = computed(() => partition.value.running + partition.value.created)

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
    「没有任何完成」（假零）；真 0（无分母/无完成）照常显 0% */
function statsKpiPct(rate: number | null | undefined): string {
  const v = rate ?? 0
  return v > 0 && v < 1 ? '<1%' : `${v}%`
}
/** 三态 hint：error 档给出动作出口 */
function statsKpiHint(ready: string): string {
  if (statsState.value === 'loading') return '统计加载中…'
  if (statsState.value === 'error') return '统计不可用 · 点击重试'
  return ready
}
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
    上限读已保存值（vlRpmSavedLimit），不用输入框脏值 */
const rateValue = computed(() => {
  // #59：设置未加载时不把初始 0 断言成「0 / 不限」，显式「不可用」
  if (vlRpmLoadFailed.value) return '不可用'
  const cap = vlRpmSavedLimit.value > 0 ? `${vlRpmSavedLimit.value}/分` : '不限'
  return `${vlRpm.inFlight} / ${cap}`
})
const rateHint = computed(() => {
  if (vlRpmLoadFailed.value) return '设置未加载 · 点击重试'
  return vlRpm.queued > 0 ? `在途 / 上限（已保存值）· 排队 ${vlRpm.queued}` : '在途 / 上限（已保存值）'
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
const completionHint = computed(() => {
  // 「全部」是分母＝全部会话数，而本页表格与页脚计数的是虚拟学习者行数——
  // 两个数字同屏且都不写口径，读者会把「全部 10」当成学习者总数（走查：与页脚
  // 「共 N 条」、侧栏徽标打架）。分母带上「会话」二字，口径落到明面。
  const parts = [`已完成 ${runStats.value.completed} / 全部会话 ${runStats.value.totalSessions}`, `活动会话 ${activeSessions.value}`]
  if (sessionAvgHuman.value) parts.push(`会话均长 ${sessionAvgHuman.value}`)
  return parts.join(' · ')
})
/* 卡内进度槽（.mk-minibar 家族原语）：完成率宏观推进比 / 并发配额利用率 */
const completionBarPct = computed(() => `${Math.min(Math.max(completionPct.value, 0), 100)}%`)
const concurrencyBarPct = computed(() => {
  const c = concurrency.value
  return c.limit > 0 ? `${Math.min((c.used / c.limit) * 100, 100)}%` : '0%'
})

/** 运行指标已改走共享 KPI 栅格（模板内 MkKpi ×5）：原先的 MkStatStrip 自由指标条
 *  （含下面这份 runStatItems）已删除，口径数据（全量会话/系统失败/人为终止/平均耗时）
 *  改为卡片 hint 直接取 runStats 字段。 */

/* 仿真概览结论已收敛到单行状态条（KPI/结论随状态条 meta 展示，双块移除） */

/* ===== A1 批量操作：复选框（批量条拆分为 VirtualLearnerBatchBar 子组件） ===== */
const selected = ref<string[]>([])
const selectable = computed(() => filtered.value)
const allChecked = computed(() => selectable.value.length > 0 && selected.value.length === selectable.value.length)

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
/* ≤1599 档：10 列在 1138px 内容区超出（改前 1185 / 现 1167 vs 容器 1138），
   操作列被挤出可视区——收单元格左右内边距 16→12 把整表塞回容器
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
/* 名称格 flex 基座：头像 + mk-cell-main（强/副行截断由原语承担，2026-10-03 方言收敛） */
.vl-cell { display: flex; align-items: center; gap: 8px; min-width: 0; }
/* 状态列：进行中胶囊 / 失败数 / 卡死徽章 分列展示（一列一语义）；gap+wrap 归并为一处定义 */
.vl-state-cell { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-height: 26px; }
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
   读写分块判例不变：写控制（速率上限/日期模拟）不进数字栅格，收进下方「压测参数」页签卡；
   完成率/并发卡内附挂 .mk-minibar 进度槽（MkKpi 默认 slot，家族原语） */
.vl-kpi {
  display: grid;
  gap: 8px;
  flex: none;
}
/* 压测参数卡（2026-10-08 重做）：标题与视图切换进 .mk-card__head（分段控件贴右、宽随内容），
   卡体只放当前设置行；写控件不进 KPI 数字栅格（读/写分块判例不变）。
   原「.tabs 通栏贴卡顶」的通栏下划线页签条退役——1603px 的线为两个短标签而画，且缺键盘契约。 */
.vl-settings { flex: none; }
.vl-settings__pane { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px 16px 14px; }
.vl-settings__on {
  margin-left: 6px;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-green);
}
.vl-rpm__ctl { display: inline-flex; align-items: center; gap: 8px; }
.vl-rpm__input { width: 84px; }
.vl-rpm__unit {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  white-space: nowrap;
}
.vl-rpm__dirty {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-amber);
  white-space: nowrap;
}
/* 设置未加载提示（#59）：失败态红字，与「未保存」脏态区分 */
.vl-rpm__failed {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-red);
  white-space: nowrap;
}
.vl-rpm__hint {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 表格已换自动布局（原型 .tbl 词汇），fixed/colgroup 的列宽变量覆写随之删除；
   长内容截断上限收敛到共享原语（.mk-cell-text / .mk-cell-main strong） */
.vl-truncated { color: var(--mk-amber); font-weight: 700; }

/* 走查 2026-09-27：「正在运行」条胶囊按钮由子组件 VirtualLearnerRunningBar 渲染，
   实测高 23px 低于 24px 可点下限——本页 :deep 提最小高度补足 1px，padding 不动、视觉不变 */
.vl-running :deep(.vl-running__chip) { min-height: 24px; }

/* 名称头像：按名字哈希取色，同一人恒定同色。
   色板整改（走查 2026-09-27）：彩底白字对比度须 ≥4.5:1，各色保持色相加深至达标
   （emerald/amber/cyan 需取 700 档；slate 原 #64748b 已 4.76:1 达标不动），
   26px 尺寸不变；行尾为对比白的前后比值。色值单源 = main.css --mk-vl-avatar-*（CM3） */
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
.vl-avatar--0 { background: var(--mk-vl-avatar-0); } /* 蓝 5.17 */
.vl-avatar--1 { background: var(--mk-vl-avatar-1); } /* 紫 5.70 */
.vl-avatar--2 { background: var(--mk-vl-avatar-2); } /* 绿 5.48 */
.vl-avatar--3 { background: var(--mk-vl-avatar-3); } /* 琥珀 5.02 */
.vl-avatar--4 { background: var(--mk-vl-avatar-4); } /* 红 4.83 */
.vl-avatar--5 { background: var(--mk-vl-avatar-5); } /* 青 5.36 */
.vl-avatar--6 { background: var(--mk-vl-avatar-6); } /* 粉 4.60 */
.vl-avatar--7 { background: var(--mk-vl-avatar-7); } /* 灰 4.76 原值已达标 */
/* 名称列可点击进二级（整行不再监听点击，避免多选勾选时误触） */
.vl-cell--click { cursor: pointer; border-radius: 6px; transition: background 0.12s ease; }
.vl-cell--click:hover { background: color-mix(in srgb, var(--mk-blue) 6%, transparent); }
.vl-cell--click:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 1px; }

/* 暗色模式：全量走 var(--mk-*) token（faillink hover 也已 token 化），不再需要页面补丁 */
</style>
