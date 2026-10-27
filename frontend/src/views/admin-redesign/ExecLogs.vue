<template>
  <div class="mk-page mk-page--fill">
    <!-- 页头：页名 + 时间窗 + 导出。时间窗放这里而不是卡头，日志 / Trace 两个页签下都可见 -->
    <MkPageHead title="执行日志">
      <template #actions>
        <div class="logs-window">
          <MkPillSelect
            :model-value="timeRange"
            label="时间范围"
            aria-label="时间范围"
            :options="timeRangeOptions"
            :active="timeRangeActive"
            @update:model-value="onTimeRangeChange($event)"
          />
          <div v-if="timeRange === 'custom'" class="logs-window__custom">
            <label class="logs-window__field">
              <span class="mk-cell-sub">开始时间</span>
              <input v-model="customStart" type="datetime-local" class="mk-filter__input" aria-label="开始时间" :aria-invalid="customRangeInvalid" @change="applyServerQuery()" />
            </label>
            <label class="logs-window__field" :class="{ 'mk-field--error': customRangeInvalid }">
              <span class="mk-cell-sub">结束时间</span>
              <input v-model="customEnd" type="datetime-local" class="mk-filter__input" aria-label="结束时间" :aria-invalid="customRangeInvalid" @change="applyServerQuery()" />
              <span v-if="customRangeInvalid" class="mk-field__err">开始时间需早于结束时间</span>
            </label>
          </div>
        </div>
        <button v-if="elTab === 'logs'" type="button" class="mk-btn mk-btn--sm" :disabled="!logs.length" @click="exportJson">导出日志本页</button>
      </template>
    </MkPageHead>
    <!-- 页级 KPI 带（2026-10-27 用户「执行日志的 kpi 设计和其他的都不一样」）：
         此前用 MkStatStrip layout=grid——那是详情页 hero 下面的一行读数条（无白面卡片、
         数值 18px 级），在本页既不成卡也不成带，与目标对话 / 教学会话 / 学习路径的 KPI
         带是两副面孔。改回列表页统一形态：section.mk-kpi-grid + MkKpi。
         失败数仍不在此重复（卡头「失败」pill 角标单源）。
         也不随 logs.length 隐藏：无行时读数是「—」（与目标对话同语义），
         整条消失会让下面的页签与明细卡整体上跳。 -->
    <section class="mk-kpi-grid" aria-label="执行读数">
      <MkKpi label="成功率" :value="successRateText" :tone="successKpiTone" />
      <MkKpi label="耗时 P50" :value="latencyP50" />
      <MkKpi label="耗时 P99" :value="latencyP99" />
    </section>

    <!-- 视图切换（2026-10-14 用户评审：此前贴在表格卡顶、通栏一条下划线，读起来像表格的表头）：
         移到页面级槽位——读数带之下、明细卡之上；卡片顶部回归「筛选头 + 表头」。
         与 Skills / Orchestrator / OpsHub / OpsAchievements 的页面级页签同形（原型 renderObserve 的
         card > .tabs 是卡内做法，本页不再沿用）。页签 2026-10-01 由 mk-pills 胶囊迁入下划线页签 -->
    <!-- 审核 #122：ARIA tabs 补全关联——页签有 id/aria-controls，两个页签体各有
         role=tabpanel + aria-labelledby（方向键切换留待后续，roving 未承诺） -->
    <div class="tabs" role="tablist" aria-label="执行日志视图切换" @keydown="onTabKeydown">
      <button type="button" role="tab" id="el-tab-logs" :ref="(el) => setTabRef(el, 0)" aria-controls="el-panel-logs" class="tab" :aria-selected="elTab === 'logs'" :tabindex="elTab === 'logs' ? 0 : -1" @click="switchElTab('logs')">日志</button>
      <button type="button" role="tab" id="el-tab-trace" :ref="(el) => setTabRef(el, 1)" aria-controls="el-panel-trace" class="tab" :aria-selected="elTab === 'trace'" :tabindex="elTab === 'trace' ? 0 : -1" @click="switchElTab('trace')">Trace 链路</button>
    </div>

    <!-- 单卡容器（原型 renderObserve：筛选头 + 页签体同卡）：日志 / Trace 链路（Trace 为执行日志
         下钻视图）两个页签体共用一张卡；成本分析 2026-09-29 拆回独立页 /admin/token-cost -->
    <div class="mk-card mk-card--fill">
      <!-- ===== Tab2: Trace 链路（嵌入 TraceWaterfall 组件；embedded 根节点 display:contents，
           子元素直接成为本卡的 flex 子项，与日志页签体同卡）。id/role/aria-labelledby 经
           属性透传落到组件根节点（未设 inheritAttrs:false），display:contents 不影响 aria 属性 ===== -->
      <TraceWaterfall v-if="elTab === 'trace'" v-model:failures-only="traceFailuresOnly" embedded id="el-panel-trace" role="tabpanel" aria-labelledby="el-tab-trace" />

      <!-- ===== Tab1: 日志流（默认） ===== -->
      <!-- 卡片常驻（对齐 Users.vue：页签 + 常驻筛选头同卡，骨架/错误/空态/表格/分页都在卡片内）。
           旧实现把渲染条件挂在卡片外壳（v-else-if="filtered.length"），空列表时状态 pills / 搜索 /
           筛选 / 列设置 / 保存视图 / 页码器整组消失，只剩一页没有任何筛选出口的死路空态 -->
      <div v-if="elTab === 'logs'" id="el-panel-logs" role="tabpanel" aria-labelledby="el-tab-logs" class="exec-tabpanel">
      <div class="mk-card__head">
        <!-- 左侧筛选组（对齐 Users：pills + 搜索框） -->
        <div class="mk-filter">
          <MkPillSelect
            v-model="agentFilter"
            label="节点"
            aria-label="按节点（Skill）筛选"
            mono
            :options="agentSelectOptions"
            :active="!!agentFilter"
          />
          <!-- 2026-10-27 筛选语法对齐教学会话（M3：同页 chip 组不得一组单选一组多选）：
               失败/超时/成功一组单选；「仅看测试」是可叠加开关 → 独立「标志筛选」组 + 激活前缀勾 -->
          <MkPillSelect
            v-model="statusFilter"
            label="状态"
            aria-label="按状态筛选"
            :options="statusSelectOptions"
            :active="!!statusFilter"
          />
          <div class="mk-pills" role="group" aria-label="标志筛选">
            <button
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': testFilter !== '' }"
              :aria-pressed="testFilter !== ''"
              @click="toggleTestFilter"
            ><Check v-if="testFilter !== ''" :size="12" :stroke-width="2.5" aria-hidden="true" />仅看测试<span class="mk-pill__count">{{ testCount ?? '—' }}</span></button>
          </div>
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilter">清除筛选</button>
          <!-- 保存视图：筛选组合命名存档（localStorage），pill 一键恢复 -->
          <SavedViewsBar
            :views="savedViews"
            :active-name="activeSavedViewName"
            :can-save="isFiltered"
            :suggest-name="filterLabel"
            :title-of="savedViewTitle"
            @apply="applySavedView"
            @remove="removeView"
            @save="onSaveView"
          />
        </div>
        <!-- 右侧：自动刷新 / 列 / 筛选（筛选=节点 / Trace ID / 会话 ID 三个精确定位项；
             触发钮与「列」同为文字动作，激活时带生效数角标） -->
        <div class="mk-card__head-right">
          <!-- 搜索槽位统一（2026-10-15 用户拍板全站列表页）：搜索移到右组首位。
               审核 #127：搜索框补 aria-label（MkFilterSearch inheritAttrs:false + v-bind="$attrs"，
               属性直达内层 input），与同工具栏 Trace ID / 会话输入的显式标签口径一致 -->
          <MkFilterSearch v-model="keyword" placeholder="搜调用内容或错误" aria-label="搜调用内容或错误（回车查询）" @keydown.enter="applyServerQuery()" />
          <label class="log-auto"><input type="checkbox" v-model="autoRefresh" /> 自动刷新</label>
          <MkCols :col-defs="colDefs" :storage-key="COLS_KEY" :default-hidden="DEFAULT_HIDDEN" v-model:hidden="hiddenCols" />
          <div class="mk-adv">
            <button
              type="button"
              class="mk-link mk-adv-trigger"
              :class="{ 'mk-link--active': advOpen }"
              :aria-expanded="advOpen"
              @click="advOpen = !advOpen"
            >
              <Filter :size="14" :stroke-width="1.75" />按 ID 定位<span v-if="advancedFilterCount" class="mk-pill__count">{{ advancedFilterCount }}</span>
            </button>
            <div v-if="advOpen" class="mk-adv__mask" @click="advOpen = false"></div>
            <div v-show="advOpen" class="mk-adv__pop" @click.stop>
              <label class="mk-adv__field">
                <span class="mk-cell-sub">{{ TRACE_FIELD_LABEL }}</span>
                <input v-model="traceId" class="mk-filter__input" :aria-label="TRACE_FIELD_LABEL" @keydown.enter="applyServerQuery()" />
              </label>
              <label class="mk-adv__field">
                <span class="mk-cell-sub">会话 ID</span>
                <input v-model="sessionId" class="mk-filter__input" aria-label="按会话 ID 筛选" @keydown.enter="applyServerQuery()" />
              </label>
            </div>
          </div>
          <button type="button" class="mk-link" @click="goHealthCenter">健康中心</button>
          <span class="mk-card__meta" v-if="errorCategory">类别「{{ errorCategory }}」<button type="button" class="mk-link" @click="errorCategory = ''; applyServerQuery()">×</button></span>
          <span v-if="listRefreshing" class="mk-card__meta exec-updating" role="status" aria-live="polite">更新中…</span>
        </div>
      </div>
      <!-- 三态均在卡片内（对齐 Users.vue）：首载骨架 / 加载失败 / 表格；筛选头常驻不随数据空否消失。
           骨架撑满卡片剩余高度（行高均分），分页位同时占位，避免卡底一大片空白 -->
      <div v-if="skeletonVisible" class="exec-skel">
        <MockSkeletonTable class="exec-skel__table" :cols="visibleColCount" :rows="6" />
        <div class="exec-skel__foot" aria-hidden="true"></div>
      </div>
      <MkEmptyState
        v-else-if="liveLogsError && !logs.length"
        min
        icon="◌"
        tone="error"
        title="日志加载失败"
        :description="liveLogsError"
        action-text="重试"
        @action="retryLiveLogs"
      />
      <div v-else-if="logs.length" class="mk-table-scroll" :class="{ 'exec-table-refreshing': listRefreshing }">
        <!-- 固定列宽（2026-10-22 与教学组三表同判例）：Skill / Trace / 消息三列在 auto 布局下
             按当页最长内容分宽（消息列 348→437px），翻页整表跳动；改 fixed + 逐列表头宽度，
             余量按权重摊开。长内容列仍由 max-width 截断兜底；列全开时容器横向滚动，见 .mk-table-scroll -->
        <table class="mk-table mk-table--click mk-table--fixed mk-table--nowrap exec-table">
          <thead>
            <tr>
              <!-- 列序 = 原型 renderObserve 日志表：时间 | 级别 | Skill | Trace | 消息 | 耗时
                   （2026-10-02 用户拍板「表格的列按新UI调整」）；类型/模型/输入输出为
                   真实数据扩展列，收进列设置 -->
              <th
                v-if="!hiddenCols.has('time')"
                scope="col"
                class="mk-th--sortable ex-c-time"
                :aria-sort="logSortState('calledAt')"
                @click="toggleLogSort('calledAt')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleLogSort('calledAt')">时间<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th v-if="!hiddenCols.has('status')" scope="col" class="ex-c-level">级别</th>
              <th v-if="!hiddenCols.has('kind')" scope="col" class="ex-c-kind">类型</th>
              <th v-if="!hiddenCols.has('agent')" scope="col" class="ex-c-agent">Skill</th>
              <th v-if="!hiddenCols.has('trace')" scope="col" class="ex-c-trace">Trace</th>
              <th v-if="!hiddenCols.has('msg')" scope="col" class="ex-c-msg">消息</th>
              <th v-if="!hiddenCols.has('model')" scope="col" class="ex-c-model">模型</th>
              <th v-if="!hiddenCols.has('tokens')" scope="col" class="ex-c-tokens">输入 / 输出</th>
              <th
                v-if="!hiddenCols.has('dur')"
                scope="col"
                class="right mk-th--sortable ex-c-dur"
                :aria-sort="logSortState('durationMs')"
                @click="toggleLogSort('durationMs')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleLogSort('durationMs')">耗时<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="log in shown" :key="log.id">
              <!-- 行可键盘展开：审核 #107 去掉 role=button（保留 tr 行语义/列头关联），
                   保留 tabindex/aria-expanded/@click，补 Space 处理（非 button 元素 Space 默认滚页） -->
              <tr class="exec-row" :class="[`exec-row--${log.status}`, { 'exec-row--test': isTestLog(log), 'exec-row--open': openId === log.id }]" tabindex="0" :aria-expanded="openId === log.id" @click="toggleRowOpen(log.id)" @keydown.enter.prevent="toggleRowOpen(log.id, $event)" @keydown.space.prevent="toggleRowOpen(log.id, $event)">
                <td v-if="!hiddenCols.has('time')"><span class="mono exec-time" :title="fmtFull(log.ts)">{{ fmtTime(log.ts) }}</span></td>
                <td v-if="!hiddenCols.has('status')"><span class="exec-status" :class="`exec-status--${log.status}`">{{ statusText[log.status] }}</span></td>
                <td v-if="!hiddenCols.has('kind')">
                  <span class="exec-kind-group">
                    <span class="mk-badge" :class="`mk-badge--${kindTone(log)}`">{{ kindText(log) }}</span>
                    <span v-if="isTestLog(log)" class="exec-test-tag">测试</span>
                  </span>
                </td>
                <!-- Skill 格显完整名（原型 Skill 列=真实名；此前只给短标签、全名藏在 title 提示里） -->
                <td v-if="!hiddenCols.has('agent')"><span class="mono exec-stage" :title="log.agent" role="button" tabindex="0" :aria-label="`查看 ${log.agent} 详情`" @click.stop="openSkillDrawer(log.agent)" @keydown.enter.stop.prevent="openSkillDrawer(log.agent)" @keydown.space.stop.prevent="openSkillDrawer(log.agent)">{{ log.agent }}</span></td>
                <td v-if="!hiddenCols.has('trace')">
                  <span class="exec-tracecell">
                    <span class="mono exec-trace" :title="log.traceId" role="button" tabindex="0" :aria-label="`查看链路 ${shortTrace(log.traceId)}`" @click.stop="showTrace(log.traceId)" @keydown.enter.stop.prevent="showTrace(log.traceId)" @keydown.space.stop.prevent="showTrace(log.traceId)">{{ shortTrace(log.traceId) }}</span>
                    <button
                      type="button"
                      class="exec-copy-btn"
                      :title="`复制 Trace ID：${log.traceId}`"
                      :aria-label="`复制 Trace ID ${log.traceId}`"
                      @click.stop="copyTrace(log.traceId)"
                    >
                      <Copy :size="14" :stroke-width="1.75" />
                    </button>
                  </span>
                </td>
                <td v-if="!hiddenCols.has('msg')">
                  <div class="exec-cell">
                    <div class="exec-cell__line">
                      <!-- 主行：错误行显示错误摘要（红）；成功行显示调用内容预览（prompt 提取），
                           无内容时弱化「执行完成」——避免与级别列"成功"重复占位（原恒显"执行完成"零信息量）。
                           链路入口/复制已前移到 Trace 列（原型 renderObserve 的列位），本格只留消息 -->
                      <strong v-if="log.status === 'err'" class="exec-title exec-title--err" :title="log.title || log.detail">{{ log.title || log.detail }}</strong>
                      <strong v-else-if="contentPreview(log)" class="exec-title exec-title--preview" :title="contentPreview(log)">{{ contentPreview(log) }}</strong>
                      <strong v-else class="exec-title exec-title--ok" :title="log.title">{{ log.title }}</strong>
                    </div>
                    <div class="exec-cell__line exec-cell__sub">
                      <span v-if="log.errorCode" class="tline__errcode mono" :title="log.errorCode">{{ errorCodeLabel(log.errorCode) ?? `[${log.errorCategory || 'err'}] ${log.errorCode}` }}</span>
                      <span v-if="log.statusCode && log.statusCode >= 400" class="tline__http mono">HTTP {{ log.statusCode }}</span>
                      <span v-if="log.recoveredByRetry" class="tline__recovered">重试 {{ (log.attempts || 1) - 1 }} 次后成功</span>
                      <span v-if="promptOf(log)?.drift" class="tline__drift">{{ TERMS.driftRuntime }}</span>
                      <span v-if="log.sessionId" class="tline__session mono" role="button" tabindex="0" :aria-label="`查看会话 ${log.sessionId} 链路`" @click.stop="showTrace(undefined, log.sessionId)" @keydown.enter.stop.prevent="showTrace(undefined, log.sessionId)" @keydown.space.stop.prevent="showTrace(undefined, log.sessionId)">会话 {{ shortTrace(log.sessionId) }}</span>
                    </div>
                  </div>
                </td>
                <td v-if="!hiddenCols.has('model')"><span class="mono exec-model__name" :title="log.model || undefined">{{ log.model || '—' }}</span></td>
                <td v-if="!hiddenCols.has('tokens')">
                  <div class="exec-tok" :title="tokensTitle(log)">
                    <b v-if="tokensSum(log) != null" class="exec-tok__num">{{ tokensSum(log)!.toLocaleString() }}</b>
                    <span v-else class="mk-na">未统计</span>
                    <span class="mk-cell-sub">{{ tokensSplitText(log) }}</span>
                  </div>
                </td>
                <td v-if="!hiddenCols.has('dur')" class="right"><span class="mk-latency exec-dur" :class="latencyTone(log.durationMs)" :title="`${fmtMs(log.durationMs)}（P90 ${latencyP90} · P99 ${latencyP99}）`">{{ fmtMs(log.durationMs) }}</span></td>
              </tr>
              <tr v-if="openId === log.id" class="exec-detail">
                <td :colspan="visibleColCount">
                  <div class="exec-detail__box">
                    <div class="tline__payload-meta">
                      <!-- 展开区同款口径：短 Trace 显示 + title 全值（不裸奔整条 UUID） -->
                      <span class="mono" :title="log.traceId">trace {{ shortTrace(log.traceId) }}</span>
                    </div>
                    <!-- 摘要行：表格弱化列的完整值（类型/模型/输入输出），展开即看全不丢信息 -->
                    <div class="exec-detail__meta mono">
                      <span class="mk-badge" :class="`mk-badge--${kindTone(log)}`">{{ kindText(log) }}</span>
                      <span v-if="detailCache[log.id]?.fallbackFrom" class="tline__recovered">已从 {{ detailCache[log.id]?.fallbackFrom }} 降级</span>
                      <span v-if="log.model" :title="log.model">{{ log.model }}</span>
                      <span v-if="log.promptTokens != null || log.completionTokens != null || promptOf(log)?.tokens" :title="tokensTitle(log)">{{ tokensText(log) }}</span>
                      <span v-if="log.errorCode" class="tline__errcode">{{ errorCodeLabel(log.errorCode) ?? log.errorCode }}</span>
                      <span v-if="log.statusCode && log.statusCode >= 400">HTTP {{ log.statusCode }}</span>
                    </div>
                    <MkLoading v-if="detailLoading === log.id" inline text="拉取日志详情中…" />
                      <template v-else-if="detailCache[log.id]">
                        <!-- 重试时间线：网关升级后的逐次尝试遥测 -->
                        <div v-if="detailCache[log.id].attempts.length" class="tline__section">
                          <span class="tline__label">调用时间线{{ detailCache[log.id].attemptCount > 1 ? ` · 已尝试 ${detailCache[log.id].attemptCount}/${detailCache[log.id].maxAttempts} 次` : '' }}</span>
                          <div class="tline-attempts">
                            <div v-for="(a, i) in detailCache[log.id].attempts" :key="i" class="tline-attempt" :class="{ 'tline-attempt--fail': !a.success, 'tline-attempt--retry': a.willRetry }">
                              <div class="tline-attempt__head">
                                <span class="tline-attempt__no">第 {{ a.promptAttemptNo }} 次调用 · 第 {{ a.transportAttemptNo }} 次发送</span>
                                <span class="mk-badge" :class="a.success ? 'mk-badge--ok' : 'mk-badge--bad'">{{ a.success ? '成功' : '失败' }}</span>
                                <span v-if="a.willRetry" class="tline-attempt__retry">将在 {{ a.backoffMs ?? '—' }}ms 后自动重试</span>
                                <span class="tline-attempt__dur mono">{{ fmtMs(a.durationMs) }}</span>
                              </div>
                              <div class="tline-attempt__meta mono">
                                <span>{{ a.provider || 'provider?' }}</span>
                                <span>{{ a.model || 'model?' }}</span>
                                <span v-if="a.statusCode">HTTP {{ a.statusCode }}</span>
                                <span v-if="a.promptTokens != null">输入 {{ a.promptTokens }} / 输出 {{ a.completionTokens ?? 0 }}</span>
                                <span v-if="a.ttftMs != null" :title="'TTFT（首字节）'">TTFT {{ a.ttftMs }}ms</span>
                                <span v-if="a.promptCacheHitTokens" class="tline-attempt__cache" :title="'DeepSeek 自动前缀缓存命中'">缓存 {{ a.promptCacheHitTokens }} token</span>
                                <span v-if="a.routeSource" :title="a.routeSource">路由 {{ routeSourceLabel(a.routeSource) ?? a.routeSource }}</span>
                                <span v-if="a.endpointHost">{{ a.endpointHost }}</span>
                              </div>
                              <p v-if="a.errorMessage" class="tline-attempt__err">{{ a.errorCode ? `${errorCodeLabel(a.errorCode) ?? a.errorCode} · ` : '' }}{{ a.errorMessage }}</p>
                            </div>
                          </div>
                        </div>
                        <div v-if="detailCache[log.id].error" class="tline__section">
                          <span class="tline__label tline__label--err">错误</span>
                          <pre>{{ detailCache[log.id].error }}</pre>
                        </div>
                        <div v-if="log.gatewayDurMs" class="tline__section">
                          <span class="tline__label">网关合并</span>
                          <p class="tline__none">{{ fmtMs(log.gatewayDurMs) }}</p>
                        </div>
                        <div v-if="detailCache[log.id].input" class="tline__section">
                          <span class="tline__label">输入</span>
                          <!-- 负载美化（2026-10-04 外部评审）：紧凑单行 JSON 两格缩进展示，非 JSON 原样 -->
                          <pre>{{ prettyPayload(detailCache[log.id].input) }}</pre>
                        </div>
                        <div v-if="detailCache[log.id].output" class="tline__section">
                          <span class="tline__label">输出</span>
                          <pre>{{ prettyPayload(detailCache[log.id].output) }}</pre>
                        </div>
                        <!-- Prompt 契约维度（prompt_call_logs，同 traceId 关联） -->
                        <div v-if="promptOf(log)" class="tline__section tline__prompt">
                          <span class="tline__label">Prompt 契约</span>
                          <div class="tline__prompt-meta mono">
                            <span>版本 v{{ promptOf(log)!.version || '—' }}</span>
                            <span v-if="promptOf(log)!.drift" class="tline__prompt-drift">{{ TERMS.driftRuntime }}</span>
                            <span v-if="promptOf(log)!.tokens">{{ promptOf(log)!.tokens }}</span>
                            <span v-if="promptOf(log)!.errorCode">{{ errorCodeLabel(promptOf(log)!.errorCode) ?? `[${promptOf(log)!.errorCode}]` }} {{ promptOf(log)!.errorMessage }}</span>
                          </div>
                          <pre v-if="promptOf(log)!.userPayload">{{ prettyPayload(promptOf(log)!.userPayload) }}</pre>
                          <pre v-if="promptOf(log)!.rawModelOutput">{{ prettyPayload(promptOf(log)!.rawModelOutput) }}</pre>
                          <pre v-if="promptOf(log)!.extractedJson">{{ prettyPayload(promptOf(log)!.extractedJson) }}</pre>
                          <pre v-if="promptOf(log)!.normalizedOutput">{{ prettyPayload(promptOf(log)!.normalizedOutput) }}</pre>
                        </div>
                        <p v-if="detailFailed[log.id]" class="tline__none tline__none--err">详情拉取失败，请稍后重试</p>
                        <p v-else-if="!detailCache[log.id].attempts.length && !detailCache[log.id].error && !detailCache[log.id].input && !detailCache[log.id].output" class="tline__none">无请求内容记录</p>
                      </template>
                      <div v-else class="tline__section">
                        <span class="tline__label tline__label--err">{{ detailFailed[log.id] ? '详情拉取失败' : '详情不可用' }}</span>
                        <button v-if="detailFailed[log.id]" type="button" class="mk-btn mk-btn--ghost mk-btn--sm" @click.stop="retryDetail(log.id)">重试拉取</button>
                      </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- 空态（卡片内，对齐 Users.vue）：区分「筛选无结果 / 直达未命中 / 真的没日志」，
           自带 description 与逃生动作，最低高度撑满卡片剩余空间而不是一行标题 -->
      <MkEmptyState
        v-else
        min
        icon="◌"
        :title="emptyTitle"
        :description="emptyDesc"
        :action-text="emptyActionText"
        @action="emptyAction"
      />
      <Pagination v-if="logs.length" v-model:page="currentPage" v-model:pageSize="currentPageSize" :total="liveLogsTotal" :loading="liveLogsLoading" unit="条记录" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Copy, Check, Filter } from 'lucide-vue-next'
import { useEscape } from './useEscape'
import { useRoute, useRouter } from 'vue-router'
import { useTablistKeyboard } from '@/composables/useTablistKeyboard'
import { toast } from '@/utils/toast'
import { intent, openSkillDrawer, clearInvestigation, dataSource, liveSkillStatsMap } from './store'
import { fetchLogDetail, reloadLiveSpans, liveLoading, liveLogsLoading, liveLogsError, liveLogsTotal, liveLogsPage, liveLogsPageSize, liveLogStats, livePromptIndex, liveLogsFiltered, loadPromptIndex, type LogDetail, type PromptMetaRow, type SpanQuery } from './live'
import { useSafePolling } from '@/composables/useSafePolling'
import MockSkeletonTable from './SkeletonTable.vue'
import MkCols from '@/components/mk/MkCols.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkPillSelect from '@/components/mk/MkPillSelect.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import TraceWaterfall from './TraceWaterfall.vue'
/* 文案单源（R6 复读单源化）：筛选项可见标签与其 aria-label 共用一份 */
const TRACE_FIELD_LABEL = '链路 ID'
/* shortTrace 单源自 terms.ts（2026-10-06 审核 #121）：Trace 页签（TraceWaterfall）同规则，
   同一 traceId/sessionId 跨页签形态一致 */
import { TERMS, errorCodeLabel, routeSourceLabel, shortTrace } from './terms'
import { prettyPayload } from './payload-format'
import { useTableSort } from './useTableSort'
import SavedViewsBar from './SavedViewsBar.vue'
import { useSavedViews, sameViewQuery, type SavedView } from './useSavedViews'

/* 日志 / Trace 链路 tab（Trace 为执行日志下钻视图） */
const EL_TABS = ['logs', 'trace'] as const
type ElTab = (typeof EL_TABS)[number]
const elTab = ref<ElTab>('logs')
const route = useRoute()
const router = useRouter()
/* URL ↔ tab 双向同步：?tab=logs|trace|cost（深链/刷新可寻址；合并宿主页统一约定） */
watch(
  () => route.query.tab,
  (t) => {
    const v = typeof t === 'string' && (EL_TABS as readonly string[]).includes(t) ? (t as ElTab) : null
    if (t === 'cost') {  // 成本分析 2026-09-29 拆回独立页：深链转投 /admin/token-cost
      const q = { ...route.query }
      delete q.tab
      void router.replace({ path: '/admin/token-cost', query: q })
      return
    }
    if (v && v !== elTab.value) elTab.value = v
    else if (!v && elTab.value !== 'logs') elTab.value = 'logs'
  },
  { immediate: true }
)
/** 切 tab（同步 ?tab= URL，深链/刷新可寻址） */
function switchElTab(t: ElTab) {
  elTab.value = t
  if (route.query.tab !== t) void router.replace({ query: { ...route.query, tab: t } })
}
/* 页签 ARIA 契约（#75）：roving tabindex + 方向键/Home/End */
const { setTabRef, onTabKeydown } = useTablistKeyboard(EL_TABS, elTab, switchElTab)

/** 下一步：这批失败是不是系统性问题，答案在健康中心 */
function goHealthCenter() {
  void router.push('/admin/health-center')
}


/** 切到 Trace tab 并让瀑布聚焦指定链路/会话（openTrace/openSession 深链接入） */
function showTrace(traceId?: string, sessionId?: string) {
  elTab.value = 'trace'
  if (sessionId) intent.sessionId = sessionId
  else if (traceId) intent.traceId = traceId
  if (route.query.tab !== 'trace') void router.replace({ query: { ...route.query, tab: 'trace' } })
}
/* 深链：openTrace/openSession 设置 intent.traceFocus 后导航到本页 → 自动切 Trace tab */
watch(
  () => intent.traceFocus,
  (focus) => {
    if (focus) {
      intent.traceFocus = false
      elTab.value = 'trace'
    }
  },
  { immediate: true }
)

const openId = ref('')
const statusFilter = ref('')
const agentFilter = ref('')
/* 时间档：快捷枚举（today/yesterday/week/month/all）+ 小时级自定义窗（15m/1h，排障最常用
   的「最近一刻钟/一小时」档）+ 自定义时间段（custom，始末任选，2026-10-16 用户走查新增）。
   后两类都不传 timeRange（后端枚举校验会 400），换算成 startTime/endTime（ISO）下发——
   后端精确时间优先且 statsWhere 与行查询同窗口，口径一致。 */
type ExecTimeRange = 'today' | 'yesterday' | 'week' | 'month' | 'all' | '15m' | '1h' | 'custom'
const timeRange = ref<ExecTimeRange>('today')
const timeRangeOptions: Array<{ value: ExecTimeRange; label: string }> = [
  { value: '15m', label: '近 15 分钟' },
  { value: '1h', label: '近 1 小时' },
  { value: 'today', label: '今天' },
  { value: 'yesterday', label: '昨天' },
  { value: 'week', label: '近 7 天' },
  { value: 'month', label: '近 30 天' },
  { value: 'all', label: '全部' },
  { value: 'custom', label: '自定义时间段' },
]
/* 自定义时间段的本地输入值（datetime-local，无时区；下发前转 ISO，避免时区漂移）。
   两端都可留空 = 只设一端（只看某时点之前 / 之后），与后端 startTime/endTime 各自可选一致。 */
const customStart = ref('')
const customEnd = ref('')
/** ISO → datetime-local 输入值（本地时区），与 Announcements.toLocalInput 同口径 */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
/** datetime-local（无时区本地值）→ ISO；空/非法返回 ''（不下发该端） */
function localInputToIso(v: string): string {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}
/** 开始晚于结束 = 矛盾区间：行内报错并拦住查询，不把空结果伪装成「该时段无日志」 */
const customRangeInvalid = computed(() => {
  if (timeRange.value !== 'custom') return false
  const s = localInputToIso(customStart.value)
  const e = localInputToIso(customEnd.value)
  return !!s && !!e && new Date(s).getTime() > new Date(e).getTime()
})
/** 快捷档 → 始末本地输入值（切入自定义时回填，省得从空白手填；'all' 留空=不限两端）。
    本地日界用 getFullYear/Month/Date 构造，不用 toISOString 切片（UTC 切日会错一天）。 */
function presetToRange(r: ExecTimeRange): { start: string; end: string } {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  switch (r) {
    case '15m': return { start: toLocalInput(new Date(now.getTime() - 15 * 60_000).toISOString()), end: '' }
    case '1h': return { start: toLocalInput(new Date(now.getTime() - 3_600_000).toISOString()), end: '' }
    case 'yesterday': {
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
      const s = dayStart(y)
      const e = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59)
      return { start: `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}T00:00`, end: `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}T23:59` }
    }
    case 'week': return { start: toLocalInput(new Date(dayStart(now).getTime() - 7 * 86_400_000).toISOString()), end: '' }
    case 'month': return { start: toLocalInput(new Date(dayStart(now).getTime() - 30 * 86_400_000).toISOString()), end: '' }
    case 'all': return { start: '', end: '' }
    case 'custom': return { start: '', end: '' }
    default: return { start: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T00:00`, end: '' } // today
  }
}
/** 上一次非自定义档（切入自定义时按它回填始末） */
let lastPresetRange: ExecTimeRange = 'today'
/** 切档：入自定义先按上一档回填，随后下发；区间矛盾（开始晚于结束）时不下发，行内已报错。
    始末输入就地展开在时间胶囊下方，不再打开「按 ID 定位」弹层。 */
function onTimeRangeChange(value: string) {
  timeRange.value = value as ExecTimeRange
  if (timeRange.value === 'custom') {
    if (!customStart.value && !customEnd.value) {
      const { start, end } = presetToRange(lastPresetRange)
      customStart.value = start
      customEnd.value = end
    }
  } else {
    lastPresetRange = timeRange.value
  }
  if (!customRangeInvalid.value) void applyServerQuery()
}
const CUSTOM_WINDOW_MS: Partial<Record<ExecTimeRange, number>> = { '15m': 15 * 60_000, '1h': 3_600_000 }
const isCustomWindow = (r: ExecTimeRange): r is '15m' | '1h' => r in CUSTOM_WINDOW_MS
/** 自定义窗起点取整到分钟：同档内查询签名稳定（不因 Date.now 漂移绕过 applyServerQuery 去重） */
function customWindowStart(r: '15m' | '1h'): string {
  const ms = CUSTOM_WINDOW_MS[r] ?? 3_600_000
  return new Date(Math.floor((Date.now() - ms) / 60_000) * 60_000).toISOString()
}
const keyword = ref('')
const traceId = ref('')
const sessionId = ref('')
const errorCategory = ref('')
/** 测试日志筛选（服务端参数）：'' = 默认（后端已排除测试）/ only = 仅看测试 */
const testFilter = ref<'only' | ''>('')
const autoRefresh = ref(false)
const advOpen = ref(false)
/* 弹层 Esc 关闭走共享 useEscape（与教学会话同一外壳 .mk-adv*） */
useEscape(() => advOpen.value, () => { advOpen.value = false })

/** 行展开切换（click / Enter 复用）：键盘事件仅目标为行自身时生效，
    避免行内按钮（trace 入口/节点链接）的 Enter 冒泡误触发展开 */
function toggleRowOpen(id: string, e?: Event) {
  if (e && e.target !== e.currentTarget) return
  openId.value = openId.value === id ? '' : id
}

/* —— 复制 trace（原型契约：执行日志行内复制 trace → toast 反馈）——
   navigator.clipboard 在 http 非安全上下文不存在（或权限被拒）：
   先走 Clipboard API，失败回退 execCommand('copy')；两者都失败必须 toast.error 明示，
   绝不静默失败（用户至少能拿到完整 Trace ID 手动复制）。 */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
async function copyTrace(traceId: string) {
  if (!traceId) {
    toast.error('该行没有 Trace ID')
    return
  }
  let ok = false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(traceId)
      ok = true
    }
  } catch {
    ok = false
  }
  if (!ok) ok = legacyCopy(traceId)
  if (ok) toast.success(`已复制 trace ${traceId}`)
  else toast.error(`复制失败，请手动复制：${traceId}`)
}

/* D3 表格增强：列显隐（localStorage 持久化）。列集/列序 2026-10-02 对齐原型 renderObserve
   （时间|级别|Skill|Trace|消息|耗时），key 升 v2：旧存储按旧列集持久化，不清会盖掉新默认 */
const COLS_KEY = 'wf_exec_hidden_cols_v2'
const colDefs = [
  { key: 'time', label: '时间' },
  { key: 'status', label: '级别' },
  { key: 'kind', label: '类型' },
  { key: 'agent', label: 'Skill' },
  { key: 'trace', label: 'Trace' },
  { key: 'msg', label: '消息' },
  { key: 'model', label: '模型' },
  { key: 'tokens', label: '输入 / 输出' },
  { key: 'dur', label: '耗时' },
] as const
/* 类型是同一 trace 的网关行与 Skill 行合并后唯一能分辨来源的列，默认可见；
   模型 / 输入输出为真实数据扩展列，收进列设置。 */
const DEFAULT_HIDDEN = ['model', 'tokens']
const hiddenCols = ref<Set<string>>(new Set())
const visibleColCount = computed(() => colDefs.length - hiddenCols.value.size)

/* prompt 契约维度：与执行日志同 traceId 关联（版本/漂移/tokens/JSON） */
onMounted(() => {
  void loadPromptIndex()
  // 首屏必须触发服务端查询：liveLogsFiltered 只有 applyServerQuery 一个写入点，
  // 不查则页面永远空列表（后端有数据也显示「暂无日志」）
  void applyServerQuery()
})
watch(dataSource, () => {
  void loadPromptIndex()
  // 数据源/注册表切换即使查询参数未变也必须重拉，force 绕过同签名去重
  void applyServerQuery(true)
})
function promptOf(log: { traceId: string; agent: string }): PromptMetaRow | undefined {
  const list = livePromptIndex.value[log.traceId]
  if (!list?.length) return undefined
  const agentId = `skill:${log.agent}`
  return list.find((p) => p.agentId === agentId || p.agentId.replace(/^skill:/, '') === log.agent)
}

/* 成功调用的内容预览（消息列主行）：从契约层提取输出摘要，
   让列表行有信息量而非恒显「执行完成」（与状态列冗余）。
   优先级：extractedJson 的键列表 > normalizedOutput 摘要 > userPayload 摘要；均无则空（回落弱化「执行完成」）。 */
/** 内容预览：返回单行全量文本，由 .exec-title 的 ellipsis 负责视觉截断（title 悬停看全）。
 *  2026-10-24 修复：原在数据层硬切 32 字并补「…」，title 却挂的是「执行完成」——
 *  截掉的部分无处可查；纯 JSON 键名预览（{"a":…}）无信息量，回落「执行完成」。 */
function contentPreview(log: { traceId: string; agent: string }): string {
  const p = promptOf(log)
  if (!p) return ''
  const out = p.normalizedOutput?.trim() || p.userPayload?.trim()
  if (!out) return ''
  if (/^[{[]/.test(out)) return ''
  return out.replace(/\s+/g, ' ').trim()
}

/* Tokens 列语义（P2）：传输层（agent_call_logs.promptTokens/completionTokens）优先——
   有真实用量展示实际值；无 token 数据的行显示「未统计」（区别于 0，工具提示说明数据来源与含义） */
type TokenRow = { traceId: string; agent: string; promptTokens?: number | null; completionTokens?: number | null }
function tokensText(log: TokenRow): string {
  if (log.promptTokens != null || log.completionTokens != null) {
    return `输入 ${log.promptTokens ?? 0} · 输出 ${log.completionTokens ?? 0}`
  }
  const p = promptOf(log)
  return p?.tokens || '未统计'
}
function tokensSum(log: TokenRow): number | null {
  if (log.promptTokens != null || log.completionTokens != null) return (log.promptTokens ?? 0) + (log.completionTokens ?? 0)
  return null
}
function tokensSplitText(log: TokenRow): string {
  if (log.promptTokens != null || log.completionTokens != null) return `输入 ${log.promptTokens ?? 0} · 输出 ${log.completionTokens ?? 0}`
  const p = promptOf(log)
  return p?.tokens || '未统计'
}
function tokensTitle(log: TokenRow): string {
  if (log.promptTokens != null || log.completionTokens != null) {
    return `输入 ${log.promptTokens ?? 0} / 输出 ${log.completionTokens ?? 0} token（网关记录）`
  }
  const p = promptOf(log)
  if (p?.tokens) return `${p.tokens}（调用记录）`
  return '该日志未记录 token 用量'
}

/* live 模式：服务端筛选（时间范围/关键词/状态/节点/traceId/sessionId/错误类别）。
   reloadLiveSpans 写入独立的 liveLogsFiltered（不污染全局 liveSpans）；
   并发与 last-wins 由 live.ts 串行化保证（loading 反馈见 liveLogsLoading） */
/* 服务端排序：复用 useTableSort 的状态/语义（排序在后端执行，不调用 sortRows）。
   默认时间倒序；点表头「时间 / 耗时」切换，变更后回第 1 页重查。
   只暴露列表自身列——token 列是网关行合并口径，不适合服务端排序。 */
const {
  sortKey: logSortKey,
  sortDir: logSortDir,
  toggle: toggleLogSort,
  sortState: logSortState,
} = useTableSort({
  keys: ['calledAt', 'durationMs'],
  defaultKey: 'calledAt',
  defaultDir: 'desc',
  storageKey: 'wf_exec_logs_sort'
})

function currentQuery(): SpanQuery {
  const status = statusFilter.value === 'err' ? 'error' : statusFilter.value === 'warn' ? 'timeout' : statusFilter.value === 'ok' ? 'success' : undefined
  const range = timeRange.value
  const base: SpanQuery = {
    keyword: keyword.value.trim() || undefined,
    status,
    agentId: agentFilter.value || undefined,
    traceId: traceId.value.trim() || undefined,
    sessionId: sessionId.value.trim() || undefined,
    errorCategory: errorCategory.value || undefined,
    /* 测试日志筛选上移服务端（P0 分页正确性）：仅看测试 = sourceEntry=system-canary；
       默认/排除态不传该参数（后端默认视图已排除 canary），页码 total 与行数保持一致 */
    sourceEntry: testFilter.value === 'only' ? 'system-canary' : undefined,
    sort: (logSortKey.value || undefined) as SpanQuery['sort'],
    order: logSortDir.value
  }
  /* 小时级自定义窗（15m/1h）换算 startTime 下发（后端枚举不认这两档，传了会 400） */
  if (isCustomWindow(range)) return { ...base, startTime: customWindowStart(range) }
  /* 自定义时间段（custom）：始末任选，两端都空视为「全部」；矛盾区间（开始晚于结束）不发查询，
     返回最近一次已生效的查询以免把矛盾区间当成「无结果」（见 customRangeInvalid 行内报错） */
  if (range === 'custom') {
    if (customRangeInvalid.value) return lastAppliedQuery ?? { ...base, timeRange: 'all' }
    const startTime = localInputToIso(customStart.value)
    const endTime = localInputToIso(customEnd.value)
    if (!startTime && !endTime) return { ...base, timeRange: 'all' }
    return { ...base, ...(startTime ? { startTime } : {}), ...(endTime ? { endTime } : {}) }
  }
  return { ...base, timeRange: range }
}
/* 最近一次已生效的查询（矛盾区间期间沿用，避免把「填错」伪装成「该时段无日志」） */
let lastAppliedQuery: SpanQuery | null = null

/* 上次已下发查询签名：同签名重复触发（显式调用与 watch 叠加、URL 回写回环）直接跳过，
   消除深链/筛选改动造成的重复请求；真正变化仍每次下发（last-wins 串行化由 live.ts 保证） */
let lastQuerySig = ''
async function applyServerQuery(force = false) {
  const q = currentQuery()
  const sig = JSON.stringify(q)
  if (!force && sig === lastQuerySig) return
  lastQuerySig = sig
  lastAppliedQuery = q
  /* 筛选/搜索/traceId/sessionId 直达/每页条数等变化：回第 1 页（传统分页语义） */
  await reloadLiveSpans(q)
}

/** 自动刷新：保留当前页码重查（区别于筛选变化回第 1 页） */
function refreshLivePage() {
  return reloadLiveSpans(currentQuery(), liveLogsPage.value)
}

/* 传统分页：页码器 v-model 桥接。翻页 = reloadLiveSpans(page) 整页替换 + 滚动回顶；
   每页条数变更 = 回第 1 页 + 按新 pageSize 重查 */
const currentPage = computed({
  get: () => liveLogsPage.value,
  set: (p: number) => {
    void goPage(p)
  }
})
const currentPageSize = computed({
  get: () => liveLogsPageSize.value,
  set: (s: number) => {
    if (s === liveLogsPageSize.value) return
    liveLogsPageSize.value = s
    void reloadLiveSpans(currentQuery())
  }
})
async function goPage(p: number) {
  if (p < 1 || p === liveLogsPage.value) return
  await reloadLiveSpans(currentQuery(), p)
  /* 翻页替换列表后滚动回顶部（列表长于视口时保持位置感） */
  window.scrollTo(0, 0)
}

/* P0 分页正确性：状态/节点/测试过滤上移服务端（status/agentId/sourceEntry 参数，API 已支持），
   消除「本地过滤 × 服务端分页」组合缺陷（旧实现下第 2 页整页被滤掉时，
   「加载更多」空转无感知变化） */
watch([statusFilter, agentFilter, testFilter], () => {
  void applyServerQuery()
})

/* 服务端排序变化：与筛选同义，回第 1 页重查 */
watch([logSortKey, logSortDir], () => {
  void applyServerQuery()
})

/* P0 修复：错误横幅重试（同签名也必须重发，force 绕过去重） */
function retryLiveLogs() {
  void applyServerQuery(true)
}

/* 自动刷新：setTimeout 链 + 并发守卫 + 指数退避 */
const { start: startAutoRefresh, stop: stopAutoRefresh } = useSafePolling(
  () => refreshLivePage(),
  {
    interval: 10000,
    maxBackoff: 60000,
    circuitBreakerThreshold: 5,
    skipWhenHidden: true,
  }
)
watch(autoRefresh, (on) => {
  if (on) {
    startAutoRefresh()
  } else {
    stopAutoRefresh()
  }
})

/* 导出当前筛选结果为 JSON */
function exportJson() {
  const blob = new Blob([JSON.stringify(filtered.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `execution-logs-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/* 「只看失败」次按钮与错误摘要条均已撤（2026-10-04 外部评审 / 2026-10-11 用户拍板）：
   失败筛选单源留在卡头失败 pill；错误分布与健康入口走健康中心页。 */

/* live 模式：展开行时拉真实 input/output + 重试时间线 */
const DETAIL_CACHE_MAX = 50
const detailCache = ref<Record<string, LogDetail>>({})
const detailLoading = ref('')
/** 详情拉取失败标记（与「无 payload 记录」区分） */
const detailFailed = ref<Record<string, boolean>>({})

/** 简单 LRU：插入新条目，超过上限时淘汰最早插入的条目 */
function setDetail(id: string, d: LogDetail) {
  const next = { ...detailCache.value, [id]: d }
  const keys = Object.keys(next)
  if (keys.length > DETAIL_CACHE_MAX) {
    for (const k of keys.slice(0, keys.length - DETAIL_CACHE_MAX)) delete next[k]
  }
  detailCache.value = next
}

async function loadDetail(id: string) {
  if (detailCache.value[id]) return
  detailLoading.value = id
  try {
    const d = await fetchLogDetail(id)
    setDetail(id, d)
    const f = { ...detailFailed.value }
    delete f[id]
    detailFailed.value = f
  } catch {
    // 不写占位缓存:此前失败详情被空缓存占位后无法重试(仅 LRU 淘汰才能重拉)
    detailFailed.value = { ...detailFailed.value, [id]: true }
  } finally {
    if (detailLoading.value === id) detailLoading.value = ''
  }
}
function retryDetail(id: string) {
  detailFailed.value = { ...detailFailed.value, [id]: false }
  void loadDetail(id)
}
watch(openId, (id) => {
  if (id) void loadDetail(id)
})

// 从排查意图进入时应用过滤（含失败归因跳转的错误类别与时间范围）。
// 消费即清（防幽灵重放）：intent 是模块级单例，应用后若保留，之后从侧栏普通点进
// 执行日志会被 AdminConsole 的 intentQueryParams 再次带上旧 agent/status。
// 筛选本体已落在本地 ref + URL query，清 intent 不影响当前视图；
// clearInvestigation 会再触发本 watch 一次，consuming 标志跳过该次回环。
let consumingIntent = false
watch(
  () => [intent.agentFilter, intent.statusFilter, intent.errorCategory, intent.timeRange],
  () => {
    if (consumingIntent) {
      consumingIntent = false
      return
    }
    agentFilter.value = intent.agentFilter
    statusFilter.value = intent.statusFilter
    if (intent.errorCategory) errorCategory.value = intent.errorCategory
    const TR = ['today', 'yesterday', 'week', 'month', 'all', '15m', '1h'] as const
    if ((TR as readonly string[]).includes(intent.timeRange)) timeRange.value = intent.timeRange as typeof timeRange.value
    consumingIntent = true
    clearInvestigation()
  },
  { immediate: true }
)

/* —— 筛选 ↔ URL query 双向同步（P0 动线修复：总览「去排查」的故障视图刷新/分享不再丢失）——
   全量快照语义：agent/status/cat/range/q/trace/session/test，缺省参数 = 该项默认值。
   URL → 筛选（深链/刷新/前进后退）；筛选 → URL（replace，不压历史栈）。
   注册在 intent watch 之后：深链直达时 URL 权威（覆盖 intent 空值回写）；
   站内跳转时 AdminConsole 已把 intent 带进 query，两源一致不抖动。 */
const FILTER_QUERY_KEYS = ['agent', 'status', 'cat', 'range', 'q', 'trace', 'session', 'test', 'from', 'to'] as const
const EL_TIME_RANGES = ['today', 'yesterday', 'week', 'month', 'all', '15m', '1h', 'custom'] as const
/** 自定义档在 URL 里拆成 from/to 两个本地时间串（range=custom）；两者都空 = 不限期 */
const queryVal = (v: unknown): string => (typeof v === 'string' ? v : '')
/* 上次 URL 筛选签名：route watch 对比完整查询签名，任一筛选变化即重查。
   此前仅 status/agent/test 的 ref watch 触发重查，前进/后退/深链改
   q/trace/session 时只改 URL 列表不刷新 */
let lastUrlSig = FILTER_QUERY_KEYS.map((k) => queryVal(route.query[k])).join('\u0001')
/* G1（2026-10-10）：q/trace/session 是「回车查询」语义（placeholder/aria-label 均注明回车查询，
   输入项不在 applyServerQuery 的 ref watch 内），但筛选→URL 回写 watch 会把每次键入 router.replace
   成 ?q=，环回触发本 watch → applyServerQuery，退化成逐键打服务端查询。
   修法：非首次触发（oldVals 存在）且新旧 query 差异仅在 q/trace/session 三键（其余键全等）时，
   只把三个输入 ref 同步成 URL 值、不调 applyServerQuery——输入项的查询触发只留 Enter/显式控件。
   取舍：浏览器后退改了 q 的场景同样只同步不重查（列表仍是旧关键词结果），用户按 Enter 再查；
   immediate 首跑保持现行为（深链 ?q= 仍全量应用，刷新/分享可还原不受影响）。 */
const INPUT_ONLY_QUERY_KEYS = new Set(['q', 'trace', 'session'])
watch(
  () => FILTER_QUERY_KEYS.map((k) => route.query[k]),
  (vals, oldVals) => {
    const [agent, status, cat, range, q, trace, session, test, from, to] = vals.map(queryVal)
    agentFilter.value = agent
    statusFilter.value = ['err', 'warn', 'ok'].includes(status) ? status : ''
    errorCategory.value = cat
    keyword.value = q
    traceId.value = trace
    sessionId.value = session
    timeRange.value = (EL_TIME_RANGES as readonly string[]).includes(range)
      ? (range as typeof timeRange.value)
      : 'today'
    /* 自定义档的始末：URL 存本地 datetime-local 串，直接回填输入框（不转 ISO，避免时区往返） */
    customStart.value = range === 'custom' ? from : ''
    customEnd.value = range === 'custom' ? to : ''
    testFilter.value = test === 'only' ? 'only' : ''
    const sig = vals.map(queryVal).join('\u0001')
    if (sig === lastUrlSig) return
    lastUrlSig = sig
    /* 仅回车查询三键变化：ref 已同步为 URL 值（上方赋值），此处不再触发服务端重查 */
    if (oldVals) {
      const changed = FILTER_QUERY_KEYS.filter((_, i) => queryVal(vals[i]) !== queryVal(oldVals[i]))
      if (changed.length > 0 && changed.every((k) => INPUT_ONLY_QUERY_KEYS.has(k))) return
    }
    void applyServerQuery()
  },
  { immediate: true }
)
/** 当前筛选快照（仅含非默认值；键与 URL query 同名——保存视图与深链共用同一形状） */
function filterSnapshot(): Record<string, string> {
  const desired: Record<string, string> = {}
  if (agentFilter.value) desired.agent = agentFilter.value
  if (statusFilter.value) desired.status = statusFilter.value
  if (errorCategory.value) desired.cat = errorCategory.value
  if (timeRange.value !== 'today') desired.range = timeRange.value
  /* 自定义档：始末各占一键（缺端不写），URL 存本地串以便刷新/分享精确还原 */
  if (timeRange.value === 'custom') {
    if (customStart.value) desired.from = customStart.value
    if (customEnd.value) desired.to = customEnd.value
  }
  if (keyword.value.trim()) desired.q = keyword.value.trim()
  if (traceId.value.trim()) desired.trace = traceId.value.trim()
  if (sessionId.value.trim()) desired.session = sessionId.value.trim()
  if (testFilter.value) desired.test = testFilter.value
  return desired
}

watch(
  [statusFilter, agentFilter, timeRange, keyword, traceId, sessionId, errorCategory, testFilter, customStart, customEnd],
  () => {
    const desired = filterSnapshot()
    const cur = route.query
    if (FILTER_QUERY_KEYS.every((k) => queryVal(cur[k]) === (desired[k] || ''))) return
    const next = { ...cur }
    for (const k of FILTER_QUERY_KEYS) delete next[k]
    Object.assign(next, desired)
    void router.replace({ query: next })
  },
  { immediate: true }
)

/* —— 保存视图：筛选组合命名存档（localStorage），pill 一键恢复 —— */
const { views: savedViews, save: saveViewToStore, remove: removeView } = useSavedViews('wf_exec_saved_views')

/** 快照可读摘要（pill 悬停说明），与 filterLabel 同一套措辞 */
function describeQuery(q: Record<string, string>): string {
  const parts: string[] = []
  if (q.range === 'custom') {
    const s = q.from || ''
    const e = q.to || ''
    parts.push(`时间「${s && e ? `${s.replace('T', ' ')} ~ ${e.replace('T', ' ')}` : s ? `${s.replace('T', ' ')} 起` : e ? `截至 ${e.replace('T', ' ')}` : '全部'}」`)
  } else if (q.range) {
    parts.push(timeRangeLabels[q.range as keyof typeof timeRangeLabels] || q.range)
  }
  if (q.test === 'only') parts.push('仅看测试')
  if (q.agent) parts.push(q.agent)
  if (q.status === 'err') parts.push('仅失败')
  else if (q.status === 'warn') parts.push('仅超时')
  else if (q.status === 'ok') parts.push('仅成功')
  if (q.cat) parts.push(`类别「${q.cat}」`)
  if (q.q) parts.push(`关键词「${q.q}」`)
  if (q.trace) parts.push(`trace「${q.trace}」`)
  if (q.session) parts.push(`会话「${q.session}」`)
  return parts.join(' · ') || '默认筛选'
}
function savedViewTitle(v: SavedView): string {
  return describeQuery(v.query)
}

/** 应用保存视图：整体重写筛选 refs 后服务端重查（URL 同步 watch 会随之回写 ?query） */
function applySavedView(v: SavedView) {
  const q = v.query || {}
  agentFilter.value = q.agent || ''
  statusFilter.value = ['err', 'warn', 'ok'].includes(q.status) ? q.status : ''
  errorCategory.value = q.cat || ''
  keyword.value = q.q || ''
  traceId.value = q.trace || ''
  sessionId.value = q.session || ''
  timeRange.value = (EL_TIME_RANGES as readonly string[]).includes(q.range)
    ? (q.range as typeof timeRange.value)
    : 'today'
  customStart.value = q.range === 'custom' ? (q.from || '') : ''
  customEnd.value = q.range === 'custom' ? (q.to || '') : ''
  testFilter.value = q.test === 'only' ? 'only' : ''
  /* keyword/trace/session 等输入项不在 watch 内（输入即查询防抖动），需显式重查 */
  void applyServerQuery()
}

/** 当前筛选恰好命中的保存视图名（高亮该 pill；默认视图不高亮） */
const activeSavedViewName = computed(() => {
  const snap = filterSnapshot()
  if (!Object.keys(snap).length) return ''
  return savedViews.value.find((v) => sameViewQuery(v.query, snap))?.name || ''
})

function onSaveView(name: string) {
  saveViewToStore(name, filterSnapshot())
}

const logs = computed(() => liveLogsFiltered.value)
/** 失败状态跨页签同源：日志页签的 status=err 与 Trace 页签的「仅失败」是同一个开关 */
const traceFailuresOnly = computed({
  get: () => statusFilter.value === 'err',
  set: (v: boolean) => { statusFilter.value = v ? 'err' : '' }
})
/** 首载骨架：查询在途且还没有行 */
const skeletonVisible = computed(() => (liveLoading.value || liveLogsLoading.value) && !logs.value.length)
/* 列表可见加载态（EG7）：已有数据时的重查（排序/筛选/翻页）此前无任何反馈，
   该查询实测可达 30s，用户易误判「箭头变了、数据没变」。卡片头「更新中」角标 +
   表格降透明，收起骨架条件（骨架只在无数据首载显示）。 */
const listRefreshing = computed(() => (liveLoading.value || liveLogsLoading.value) && logs.value.length > 0)
/* 筛选弹层生效计数（EG17）：目前面板内仅 Trace ID / 会话 ID 两项；
   面板收起时按钮上仍有徽章，状态不丢。 */
/** 时间档是否偏离默认（'today'）：自定义档即便两端留空也算非默认（用户显式选过自定义）。
    与 isFiltered、清除筛选同一判据（单源，勿各写一遍）。 */
const timeRangeActive = computed(() => timeRange.value !== 'today')
/** 「按 ID 定位」弹层生效数：Trace ID / 会话 ID 任一激活即计（收起也不丢状态）。
    节点与时间档已提上主行，不再计入。 */
const advancedFilterCount = computed(
  () => (traceId.value.trim() ? 1 : 0) + (sessionId.value.trim() ? 1 : 0)
)
/* 节点下拉数据源不能只来自当前页 30 行（截断后筛不到页外的 skill）。
   组合三源：注册表 skill 全集（liveSkillStatsMap，boot 域预载，去掉 skill: 前缀与行内
   agent 口径对齐）+ 当前页实际出现的节点（网关/流程行不在注册表）+ 保存视图历史用过的节点 */
const agentOptions = computed(() => {
  const set = new Set<string>()
  for (const k of Object.keys(liveSkillStatsMap.value ?? {})) set.add(k.replace(/^skill:/, ''))
  for (const s of logs.value) set.add(s.agent)
  for (const v of savedViews.value) if (v.query?.agent) set.add(v.query.agent)
  return [...set].sort()
})
/** 胶囊内嵌下拉的选项形态（首项「全部」= 清空该维） */
const agentSelectOptions = computed(() => [
  { value: '', label: '全部' },
  ...agentOptions.value.map((a) => ({ value: a, label: a }))
])

/** 连通性/探活测试日志识别：sourceEntry = system-canary（模型接入页探活 + 测试连接产生） */
const isTestLog = (l: { sourceEntry?: string }) => l.sourceEntry === 'system-canary'
/* testFilter 声明在上方筛选 ref 区（需早于 requery watch 引用）。
   旧三态的「排除测试」与默认视图语义重合（后端默认排除 canary），已并入默认态 */

/* P0 分页正确性：测试日志筛选随查询上移服务端（sourceEntry 参数），
   与 status/agentId 同批修复「本地过滤 × 服务端分页」组合缺陷。
   节点/状态复滤已删：服务端按 agentId 过滤（skill:/agent: 前缀规范化，兼容裸名），
   行内 agent 是去前缀的裸名——URL 带 skill: 前缀时旧客户端复滤会把整表滤空 */
const filtered = computed(() => logs.value)

const shown = computed(() => filtered.value)

/* 口径与 AuditLogs 一致：时间范围非默认值也计入筛选态，空态才显示「当前筛选无日志」而非「暂无日志」 */
const isFiltered = computed(() => !!(testFilter.value || agentFilter.value || statusFilter.value || keyword.value.trim() || traceId.value.trim() || sessionId.value.trim() || errorCategory.value || timeRangeActive.value))
/* traceId/sessionId 服务端查询未命中时的空态提示（与 TraceWaterfall 的 wf-notice「样本截断」兜底互补：
   此处是服务端精确查询的直接未命中）。返回裸值，展示层做 shortTrace 截断 + 完整值回显 */
const traceMiss = computed(() => {
  if (filtered.value.length) return ''
  if (traceId.value.trim()) return traceId.value.trim()
  if (sessionId.value.trim()) return sessionId.value.trim()
  return ''
})
/* 空态：只留一句事实 + 一个出口。有筛选 → 只放宽时间范围；无筛选 → 切近 7 天 */
const emptyTitle = computed(() =>
  traceMiss.value
    ? `未找到「${shortTrace(traceMiss.value)}」的日志`
    : isFiltered.value ? '当前筛选无日志' : '暂无日志'
)
const emptyDesc = computed(() =>
  traceMiss.value
    ? `完整值为 ${traceMiss.value}`
    : timeRange.value === 'today' ? '今天没有执行记录' : ''
)
const emptyActionText = computed(() =>
  timeRange.value !== 'all' ? '查看全部时间' : isFiltered.value ? '清除筛选' : ''
)
function emptyAction() {
  if (timeRange.value !== 'all') {
    timeRange.value = 'all'
    lastPresetRange = 'all'
    void applyServerQuery()
    return
  }
  clearFilter()
}
/* 全量统计来自后端 stats（非 200 行样本）。B22/F8-1：liveStats 只由本页查询写入
   （live.ts reloadLiveSpans 单源），与表格行同一次响应、同窗口同筛选；
   壳层 week/200 行采样不再写它，页首读数不会因 Shell 刷新翻成周数字。
   查询在途（读数已作废）/查询失败 → liveStats 为 null，页首回落样本或「—」。 */
const liveStats = computed(() => liveLogStats.value)
/** 读数作废在途：窗口/筛选刚变化（live.ts 已清空旧读数）且新查询未落地——
    此间不得用上一窗口的表格样本冒充当前窗口读数（B22/F8-1） */
const statsPending = computed(() => liveLogsLoading.value && liveStats.value === null)
/* 成功率：stats 就绪 → 全窗口口径；作废在途 → 「—」（骨架语义，不给 0/旧窗数字）；
   其余（响应缺 stats 的兜底）→ 本页样本估算并在 hint 披露。 */
const successRate = computed(() => {
  const st = liveStats.value
  if (st) return st.total ? Math.round((st.success / st.total) * 100) : '—'
  if (statsPending.value) return '—'
  if (!logs.value.length) return '—'
  const ok = logs.value.filter((l) => l.status === 'ok').length
  return Math.round((ok / logs.value.length) * 100)
})
/** KPI 显示值：数字档补 %；未就绪档直接「—」（不出现「—%」这种残缺读数） */
const successRateText = computed(() => (successRate.value === '—' ? '—' : `${successRate.value}%`))

/* B3 观测深度：延迟分位（P50/P99，仅成功日志；对标 Langfuse 观测台核心指标）。
   用后端 stats（含 latencyPercentiles 时优先），否则样本计算 */
const latencyP50 = computed(() => {
  const st = liveStats.value
  if (st && st.latencyPercentiles?.p50 != null) return fmtMs(st.latencyPercentiles.p50)
  return percentileOf(logs.value.filter((l) => l.status === 'ok').map((l) => l.durationMs), 0.5)
})
const latencyP99 = computed(() => {
  const st = liveStats.value
  if (st && st.latencyPercentiles?.p99 != null) return fmtMs(st.latencyPercentiles.p99)
  return percentileOf(logs.value.filter((l) => l.status === 'ok').map((l) => l.durationMs), 0.99)
})
function percentileOf(durations: number[], q: number): string {
  const arr = durations.filter((d) => typeof d === 'number' && d >= 0).sort((a, b) => a - b)
  if (!arr.length) return '—'
  const idx = Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * q)))
  return fmtMs(arr[idx])
}
function percentileMsOf(durations: unknown[], q: number): number | null {
  const arr = durations.filter((d): d is number => typeof d === 'number' && d >= 0).sort((a, b) => a - b)
  if (!arr.length) return null
  const idx = Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * q)))
  return arr[idx]
}
/* 行级设计（批B）：行耗时 vs 全局分位 → 三档 tone（≥P99 红 / ≥P90 琥珀 / 其余默认）。
   审核 #105：琥珀档原用 P50（中位数）→ 约半数行被着色，分级失去「把慢行挑出来」的区分度；
   提到 P90（后端 stats 有 p90 就用，否则成功样本取 0.9 分位）。 */
const latencyP99Ms = computed(() => {
  const st = liveStats.value
  if (st && st.latencyPercentiles?.p99 != null) return st.latencyPercentiles.p99
  return percentileMsOf(logs.value.filter((l) => l.status === 'ok').map((l) => l.durationMs), 0.99)
})
const latencyP90Ms = computed(() => {
  const st = liveStats.value
  const backendP90 = st?.latencyPercentiles?.p90
  if (backendP90 != null) return backendP90
  return percentileMsOf(logs.value.filter((l) => l.status === 'ok').map((l) => l.durationMs), 0.9)
})
const latencyP90 = computed(() => {
  const st = liveStats.value
  const backendP90 = st?.latencyPercentiles?.p90
  if (backendP90 != null) return fmtMs(backendP90)
  return percentileOf(logs.value.filter((l) => l.status === 'ok').map((l) => l.durationMs), 0.9)
})
function latencyTone(durationMs: unknown): string {
  const d = typeof durationMs === 'number' ? durationMs : -1
  if (d < 0) return ''
  if (latencyP99Ms.value != null && d >= latencyP99Ms.value) return 'mk-latency--slow'
  if (latencyP90Ms.value != null && d >= latencyP90Ms.value) return 'mk-latency--warn'
  return ''
}
/* 2026-10-04 状态条退役：原状态条基调 statusTone（muted/bad/ok）随条删除，ok/bad 语义改由
   成功率 KPI 卡着色承载；muted 空态档不再需要（KPI 带 v-if="logs.length"）。
   2026-10-04 外部评审拍板再解耦：成功率是监控指标不是故障告警——「有失败就标红」把 95%
   的健康读数读成系统故障（红 KPI + 红告警条上下夹页签）。改只跟数值走：<90% 红，否则绿；
   错误信号由卡内告警条单源承载，同一事实只出现一次。 */
const HEALTHY_RATE = 90
/* 未就绪档（successRate 为「—」）不着色：Number('—')=NaN，原写法 NaN<90=false 落到 'ok' 绿——
   把「读数还没加载/无样本」染成健康的绿是伪读数（2026-10-15 KPI 审计）。非有限数走 muted。 */
const successKpiTone = computed<'ok' | 'bad' | 'muted'>(() => {
  const rate = Number(successRate.value)
  if (!Number.isFinite(rate)) return 'muted'
  return rate < HEALTHY_RATE ? 'bad' : 'ok'
})
/** 测试日志计数：默认态读后端 stats.canary（默认视图已排除 canary，行内数不到）；
    仅看测试态 = 该查询的 total（口径即测试行数）。
    B22/F8-1：默认态 stats 未就绪时返回 null（模板渲染「—」）——0 会被读成
    「本窗口 0 条测试日志」的伪读数；入口 pill 本身常驻可点不变。 */
const testCount = computed<number | null>(() => {
  if (testFilter.value === 'only') return liveLogsTotal.value
  return liveStats.value ? liveStats.value.canary ?? 0 : null
})
/** 测试筛选两态切换：默认（已排除测试）→ 仅看测试 → 默认（重查由 status/agent/test watch 触发） */
function toggleTestFilter() {
  testFilter.value = testFilter.value === '' ? 'only' : ''
}
/* 排查徽章：读本地筛选（修复此前读 intent 导致的空值）；live 下补充关键词/时间范围/trace/会话 */
const timeRangeLabels = { '15m': '近 15 分钟', '1h': '近 1 小时', today: '今天', yesterday: '昨天', week: '近 7 天', month: '近 30 天', all: '全部', custom: '自定义时间段' } as const
/** 自定义时间段的可见措辞（读始末输入，缺一端说「起/至」，都缺=全部） */
const customRangeLabel = computed(() => {
  const s = customStart.value
  const e = customEnd.value
  if (s && e) return `${s.replace('T', ' ')} ~ ${e.replace('T', ' ')}`
  if (s) return `${s.replace('T', ' ')} 起`
  if (e) return `截至 ${e.replace('T', ' ')}`
  return '全部'
})
const filterLabel = computed(() =>
  [
    timeRange.value === 'custom' ? `时间「${customRangeLabel.value}」` : timeRange.value !== 'today' ? timeRangeLabels[timeRange.value] : '',
    testFilter.value === 'only' ? '仅看测试' : '',
    agentFilter.value || '',
    statusFilter.value === 'err' ? '仅失败' : statusFilter.value === 'warn' ? '仅超时' : statusFilter.value === 'ok' ? '仅成功' : '',
    errorCategory.value ? `类别「${errorCategory.value}」` : '',
    keyword.value.trim() ? `关键词「${keyword.value.trim()}」` : '',
    traceId.value.trim() ? `trace「${traceId.value.trim()}」` : '',
    sessionId.value.trim() ? `会话「${sessionId.value.trim()}」` : ''
  ]
    .filter(Boolean)
    .join(' · ')
)

/* 状态 pills（失败/超时/成功）：计数来自当前窗口 stats（与表格同源）。B22/F8-1：
   stats 未就绪（查询在途 / 失败）时不显示 0——0 会被读成「本窗口 0 条失败」的伪读数；
   置 undefined 使模板不渲染计数角标（与「测试」pill 的常驻入口语义一致）。 */
const statusPills = computed(() => {
  const st = liveStats.value
  return [
    { id: 'err', label: '失败', count: st?.error },
    { id: 'warn', label: '超时', count: st?.timeout },
    { id: 'ok', label: '成功', count: st?.success }
  ]
})

/** 卡头「状态」下拉：计数取当前窗口 stats；未就绪时不显计数（不把未知读成 0） */
const statusSelectOptions = computed(() => [
  { value: '', label: '全部状态' },
  ...statusPills.value.map((p) => ({
    value: p.id,
    label: p.count != null ? `${p.label}（${p.count}）` : p.label
  }))
])

function clearFilter() {
  testFilter.value = ''
  agentFilter.value = ''
  statusFilter.value = ''
  keyword.value = ''
  traceId.value = ''
  sessionId.value = ''
  errorCategory.value = ''
  timeRange.value = 'today' // 时间范围计入 isFiltered 口径，清除时需一并还原（默认=当天）
  lastPresetRange = 'today'
  customStart.value = ''
  customEnd.value = ''
  clearInvestigation()
  /* 服务端筛选下必须重查：仅清本地值不会刷新列表（traceId/sessionId 不在 watch 内，
     避免输入即查询；状态/节点变化由 watch 触发，此处兜底全清场景） */
  void applyServerQuery()
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)
/* 绝对时间：统一 MM-DD HH:MM:SS（日志可能跨天，全部带日期避免同一列表两种格式；
   年/完整时区由 tooltip fmtFull 提供） */
function fmtTime(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
/* 短标识：单源自 ./terms 的 shortTrace（2026-10-06 审核 #121），本页不再私持实现。
   旧实现 `/^(\w{2}):?([\w-]+)$/` 会给无冒号的纯 ID 造出「17:」「14:」这种假前缀，已废弃。 */
/* 绝对时间 tooltip：YYYY-MM-DD HH:MM:SS（与审计页同格式）；ts 为 epoch 毫秒 */
function fmtFull(ts?: number | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
/* 类型列：按执行层（api-gateway→网关 / skill→Skill） */
function kindText(log: { kind: 'flow' | 'call'; execLayer?: string }): string {
  if (log.kind === 'flow') return '流程'
  if (log.execLayer === 'skill') return 'Skill'
  if (log.execLayer === 'api-gateway') return '网关'
  return '调用'
}
function kindTone(log: { kind: 'flow' | 'call'; execLayer?: string }): string {
  if (log.kind === 'flow') return 'flow'
  if (log.execLayer === 'skill') return 'skill'
  return 'call'
}
/* 状态列文本（旧 statusBadge 语义：成功/超时/失败） */
const statusText = { ok: '成功', warn: '超时', err: '失败' } as const
</script>

<style scoped>
/* 固定列宽（2026-10-22 用户「翻页不同页码时候，列宽怎么还在变呢」）：Skill / Trace / 消息
   三列在 auto 布局下按当页最长内容分宽（消息列 348→437px），翻页跳动；fixed 后按表头定死。
   宽度按 1280 现值校准并留余量：默认 6 列合计 ≤914，全列（列菜单打开类型/模型/输入输出）≤1138。 */
.ex-c-time { width: 115px; }
.ex-c-level { width: 68px; }
.ex-c-kind { width: 70px; }
.ex-c-agent { width: 160px; }
.ex-c-trace { width: 120px; }
.ex-c-msg { width: 240px; }
.ex-c-model { width: 120px; }
.ex-c-tokens { width: 100px; }
.ex-c-dur { width: 68px; }
/* fixed 档里行内 max-width（260/220px）会超出本列把内容顶到邻列：统一改成随单元格收缩，
   由各自已有的省略号 + title 兜底（长 Skill 名 / 长错误码 / 长 Trace）。 */
.exec-table .exec-stage,
.exec-table .exec-model__name,
.exec-table .exec-trace { max-width: 100%; }
.exec-table .exec-cell { max-width: 100%; overflow: hidden; }
.exec-table .exec-cell__sub > * { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.exec-table .exec-cell__line { max-width: 100%; overflow: hidden; }
.exec-table .exec-tracecell { min-width: 0; max-width: 100%; overflow: hidden; }

/* 视图切换（原型 .tabs 下划线页签）：样式 2026-10-05 CM1 收敛到全局 .tabs/.tab
   （mk-primitives.css），本页不再私持拷贝。 */
/* 日志页签体（审核 #122 补 role=tabpanel 的容器）：display:contents 保持原布局
   （其子元素仍是 .mk-card--fill 的 flex 子项，与嵌入态 TraceWaterfall 根节点同法） */
.exec-tabpanel { display: contents; }
/* display:contents 的包装器不影响布局，但**选择器仍按 DOM 结构匹配**——共享规则
   `.mk-card--fill > .mk-empty--min` 匹配不到这一层，空态会退回视口常量（实测比卡高多 47px、
   盒底越出卡片被 overflow:clip 裁掉）。按同一口径在本页补一条（2026-10-24 全站空态收齐）。 */
.exec-tabpanel > .mk-empty--min { flex: 1; min-height: 0; }
/* 首载骨架：撑满卡片剩余高度，行高均分（骨架自身不带卡片外壳，避免卡中卡）；
   尾部留出分页器高度占位，加载完成时表格/分页不整块下移 */
.exec-skel { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.exec-skel__table {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.exec-skel__table :deep(.skl) { flex: 1; min-height: 0; }
.exec-skel__foot { height: 47px; border-top: 1px solid var(--mk-line); }

/* 状态条筛选徽章 / 清除按钮已随 2026-10-04 状态条退役删除，本页不再保留其字号覆写（全局类定义见 shared.css） */

.log-auto {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  cursor: pointer;
  white-space: nowrap;
}

/* 时间范围 / 节点两个维度下拉（2026-10-26）：形态统一走共享 MkPillSelect
   （原 .logs-range / .logs-agent 两份逐字重复的私有 CSS 已删） */
.logs-window { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.logs-window__custom { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.logs-window__field { display: inline-flex; align-items: center; gap: 6px; }
/* 列表可见加载态（EG7：「更新中」角标 + 表格降透明）——排序/筛选/翻页重查时该查询
   实测可达 30s，无反馈时用户误判「箭头变了、数据没变」。仅在有数据时出现（首载走骨架）。 */
.exec-updating { color: var(--mk-blue); font-weight: 600; white-space: nowrap; }
.exec-table-refreshing { opacity: 0.55; transition: opacity 0.15s ease; }

/* 加载失败横幅：外形走 .mk-alert--row（shared.css），已不再需要本页私有样式 */

/* 表头与列表布局见下方 exec-* 区块 */

/* ========== 日志表（mk-table 自动布局，2026-10-01 去 colgroup/fixed 对齐 Users 判例） ==========
   列按内容自然分宽、单元格 nowrap；长内容列给 max-width 截断兜底（自动布局下列的
   max-content 由内容决定，不设上限时长消息会把整列撑到不可读）：
   - 调用：.exec-cell max-width 460px，主行标题 ellipsis（展开行看全量）
   - 节点 / 模型：160px / 150px 单行截断（title 全值）
   - 时间 / 耗时 / Trace：短内容自然宽，右对齐列走 .right
   视觉基调与审计日志对齐（2026-09）：主体统一 12.5px、行 padding 8px 13px、
   失败行不再整行红底（错误语义交给红标题 + 状态 pill），整体更清爽易扫。 */
.exec-table th.right,
.exec-table td.right { text-align: right; }
/* 行高对齐审计日志节奏（2026-09 统一：td 8px 13px ≈ 43px 行高）：
   双行消息列因副行略高，但主行 12.5px 后整体与审计页同密度 */

.exec-row--open { background: var(--mk-table-row-hover-bg); }
/* 失败行层级（2026-10-24）：同一屏里失败行原先与成功行只差一枚红色状态词；
   左缘 2px 红条给出扫读锚点，悬停/展开仍回常态底。 */
.exec-row--err td:first-child { box-shadow: inset 2px 0 0 var(--mk-red); }
.exec-row--err:not(.exec-row--open) { background: color-mix(in srgb, var(--mk-red) 3%, transparent); }
/* 副行错误码降一档：错误摘要已在主行用红字说清，副行不再用同档红字与主行抢层级 */
.exec-cell__sub .tline__errcode,
.exec-cell__sub .tline__http { color: var(--mk-muted); font-weight: 500; }
/* 连通性/探活测试行：弱化——审核 #103：原整行 opacity:.62 把正文对比度压到 2.46:1（AA 需 4.5:1），
   改为降一档文字色（--mk-faint-soft，亮/暗两档都在可读线以上），正文保持 ≥4.5:1；
   hover / 展开时回常态色，弱化语义不变 */
.exec-row--test:not(:hover):not(.exec-row--open) .exec-time,
.exec-row--test:not(:hover):not(.exec-row--open) .exec-title:not(.exec-title--err),
.exec-row--test:not(:hover):not(.exec-row--open) .exec-trace { color: var(--mk-faint-soft); }
.exec-kind-group { display: inline-flex; align-items: center; gap: 5px; }
/* 类型徽章（流程/Skill/网关/调用）：中性浅灰 pill，与审计动作 chip 同风格——低调可读不抢色 */
.exec-kind-group .mk-badge {
  background: var(--mk-surface-3);
  color: var(--mk-muted, #5b6577);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  padding: 1px 7px;
}
html[data-theme='dark'] .exec-kind-group .mk-badge { background: #2d2d2f; color: var(--mk-muted); }
/* 测试标签：灰底小徽章（与类型徽章并排，业务日志不出现） */
.exec-test-tag {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  letter-spacing: 0.03em;
  padding: 1px 6px;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-line, #e6ebf4);
  color: var(--mk-muted, #5b6577);
  white-space: nowrap;
}
html[data-theme='dark'] .exec-test-tag { background: #313235; color: var(--mk-muted); }
/* 消息列：自动布局下由 max-width 兜底（长调用文本不独吃列宽），主行标题在列内 ellipsis */
.exec-cell { min-width: 0; max-width: 460px; }
.exec-cell__line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.exec-cell__line + .exec-cell__line { margin-top: 1px; }
/* 消息主行：标题截断不换行（title 全值）；12.5px 与审计日志主体同字号，
   用字重/颜色表达语义差异（红=错误摘要，灰蓝=内容预览，弱化=成功），
   不再用更大字号抢视觉——整表更清爽、可扫性更强 */
.exec-title {
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  min-width: 0;
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 消息列语义变体：错误摘要(红) / 内容预览(灰蓝) / 成功弱化——告别恒显「执行完成」与状态列重复 */
.exec-title--err { color: var(--mk-red, #dc2626); font-weight: 650; }
.exec-title--err:hover { text-decoration: underline; }
.exec-title--preview { color: var(--mk-muted, #5b6577); font-weight: 550; }
.exec-title--ok { color: var(--mk-faint, #5f6f8c); font-weight: 500; }
/* 复制 trace 图标按钮：Trace 列内与短 ID 并排（28px 可点），失败/非安全上下文由 copyTrace 走兜底 + toast */
.exec-copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--mk-faint);
  cursor: pointer;
  padding: 0;
  transition: background 0.12s, color 0.12s;
}
.exec-copy-btn svg { width: 14px; height: 14px; }
.exec-copy-btn:hover { background: var(--mk-blue-bg, #eff6ff); color: var(--mk-blue, #2f6ae0); }
.exec-cell__sub { flex-wrap: wrap; gap: 5px; }
/* 节点列：等宽短名，长名 ellipsis（title 全值，点击开 Skill 抽屉）。
   display:inline-block 必须显式声明——span 为 inline 元素时 max-width/overflow/ellipsis 全部失效；
   自动布局下 max-content 决定列宽，需固定截断上限防长节点名撑列。
   260px（2026-10-04 外部评审拍板，原 160px）：覆盖 virtual-learner-* 家族全名（实测最长
   253px/35 字符）在 1280 视口下完整可辨——1920 列宽本就分到 292px，160px 上限是列有空间
   不给显；更长名字（46 字符级）仍截断由 title 兜底。 */
.exec-stage {
  display: inline-block;
  font-size: var(--mk-fs-micro);
  color: var(--mk-blue);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
}
.exec-stage:hover { text-decoration: underline; }
/* 模型 / Tokens 独立列：单行截断（同为 inline span，需 inline-block 让截断生效；
   自动布局下同样给固定上限，模型名过长不撑列） */
.exec-model__name {
  display: inline-block;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}
/* 状态列徽章（成功/超时/失败） */
.exec-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  border-radius: 999px;
  padding: 1px 8px;
  white-space: nowrap;
}
.exec-status--ok { background: var(--mk-green-bg); color: var(--mk-green); }
.exec-status--warn { background: var(--mk-amber-bg); color: var(--mk-amber); }
.exec-status--err { background: var(--mk-red-bg); color: var(--mk-red); }
/* 时间/耗时/Trace 等宽数字列 */
.exec-time {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* tokens 列主副行（批B） */
.exec-tok { display: grid; gap: 2px; justify-items: start; }
.exec-tok__num { font-variant-numeric: tabular-nums; font-weight: 600; }
/* 耗时不在这里定颜色：.mk-latency--warn/--slow 的阈值色阶必须能生效
   （2026-10-24 修复：本规则与 .mk-latency--* 同特异性且后加载，把琥珀/红压回灰） */
.exec-dur {
  font-size: var(--mk-fs-micro);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.exec-trace {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  white-space: nowrap;
  cursor: pointer;
}
.exec-trace:hover { color: var(--mk-amber); text-decoration: underline; }
/* Trace 独立列（原型 renderObserve 列位）：短 ID（点击看链路）+ 复制钮同格 */
.exec-tracecell { display: inline-flex; align-items: center; gap: 5px; }

/* 展开详情行（colspan=动态列数）：浅底 + 内容盒内聚，干扰最小化；
   文本可换行（列表行的 nowrap 不下探进详情区）。
   它是「行内抽屉」不是数据行：上下留白归内层 .exec-detail__box 管，
   单元格本身只留左右内衬，纵向不另加 padding（否则数据行与详情行两种节奏同屏打架）。 */
.exec-detail td {
  padding-inline: 14px;
  padding-block: 0;
  background: var(--mk-surface-2);
  vertical-align: top;
  white-space: normal;
}
/* 审核 #125：此处原有 `html[data-theme='dark'] .exec-detail td{background:#161718}`，与文件末尾暗色块内
   同选择器的 #19191a 同特异性、后者在后取胜——一行永不生效的死规则，删 */
.exec-detail__box {
  display: grid;
  gap: 8px;
  padding: 10px 14px;
  border-left: 3px solid var(--mk-line);
  border-radius: 0 var(--mk-radius-sm) var(--mk-radius-sm) 0;
  background: var(--mk-surface);
}

/* 展开区摘要行：次要列完整值(类型/模型/输入输出/错误码)，与 trace 行同层级 */
.exec-detail__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 0 2px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.exec-detail__meta .mk-badge {
  background: var(--mk-surface-3);
  color: var(--mk-muted, #5b6577);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  padding: 1px 7px;
}
html[data-theme='dark'] .exec-detail__meta .mk-badge { background: #2d2d2f; color: var(--mk-muted); }
.exec-detail__meta > span { white-space: nowrap; }

/* 窄屏自适应：min-width 只保证默认 5 列(时间/节点/调用/耗时/状态)在窄容器内不塌陷 ≈620px;
   用户开启全部 9 列时由列定宽自然撑超(≈962px),容器横向滚动(AntD Table 标准行为)。
   原 min-width:962px 在 5 列默认下也硬撑导致 1080px 视口多余滚动。 */
.mk-table-scroll .exec-table { min-width: 620px; }

/* 笔记本带收拾档（LY12，≤1365）：多列表格在 1280（内容宽 ~994）容器级横滚 63px。
   只收本页内容上限与单元格内边距，不动列序/截断契约；1440（内容宽 1138）不受影响
   （实测该档 dx=0），故断点取 1365 而非全站中宽档 1599。 */
@media (max-width: 1365px) {
  .exec-table th,
  .exec-table td { padding-inline: 10px; }
  .exec-cell { max-width: 380px; }
  .exec-stage { max-width: 210px; }
}

/* ---------- 行内 chip（沿用；2026-09 降噪：与主行字号差从 3px 收窄到 ~1px，
   错误码红底 chip 改为轻红文字——错误语义由红标题与状态 pill 承担，副行只作元数据） ---------- */
.tline__errcode {
  flex-shrink: 0;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-red, #dc2626);
  white-space: nowrap;
}
.tline__http {
  flex-shrink: 0;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-red, #dc2626);
  white-space: nowrap;
}
.tline__recovered {
  flex-shrink: 0;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-amber);
  white-space: nowrap;
}
.tline__drift {
  flex-shrink: 0;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-amber);
  white-space: nowrap;
}
.tline__session { font-size: var(--mk-fs-micro); color: var(--mk-blue, #2f6ae0); cursor: pointer; }
.tline__session:hover { text-decoration: underline; }
/* Prompt 契约展开区 */
.tline__prompt { border-left: 3px solid rgba(217, 119, 6, 0.4); padding-left: 10px; }
.tline__prompt-meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.tline__prompt-drift { color: var(--mk-amber); font-weight: 700; }

.exec-detail__box pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-code-bg);
  color: var(--mk-code-fg);
  font: 11px/1.6 var(--mk-mono);
  overflow: auto;
  max-height: 240px;
  white-space: pre-wrap;
  word-break: break-all;
}
.tline__payload-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  font-family: var(--mk-mono);
}
.tline__none { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.tline__none--err { color: var(--mk-red); font-weight: 600; }
.tline__section { display: grid; gap: 4px; }
.tline__label { font-size: var(--mk-fs-micro); font-weight: 700; letter-spacing: 0.06em; color: var(--mk-faint); }
.tline__label--err { color: var(--mk-red); }

/* 重试时间线 */
.tline-attempts { display: grid; gap: 6px; }
.tline-attempt {
  border: 1px solid var(--mk-line);
  border-left: 3px solid var(--mk-green);
  border-radius: var(--mk-radius-sm);
  padding: 8px 10px;
  display: grid;
  gap: 4px;
  background: var(--mk-surface);
}
.tline-attempt--fail { border-left-color: var(--mk-red); background: var(--mk-surface); }
html[data-theme='dark'] .tline-attempt--fail { background: rgba(220, 38, 38, 0.08); }
.tline-attempt--retry { border-left-color: var(--mk-amber); }
.tline-attempt__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tline-attempt__no { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); font-weight: 800; color: var(--mk-muted); }
.tline-attempt__retry { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-amber); }
.tline-attempt__cache { font-weight: 700; color: var(--mk-green, #15803d); }
.tline-attempt__dur { margin-left: auto; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.tline-attempt__meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.tline-attempt__err { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-red); word-break: break-all; }

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3，高度换算回逻辑坐标） ========== */
@media (min-width: 2000px) {
  .log-auto { font-size: var(--mk-fs-micro); }
  /* 列宽：时间列由 shared.css 4K token 覆盖（--mk-col-time-full），固定列 4K 档字号放大 */
  .exec-time,
  .exec-dur,
  .exec-trace,
  .exec-stage,
  .exec-model__name { font-size: var(--mk-fs-micro); }
  .exec-title { font-size: var(--mk-fs-body); }
  .exec-tok__num,
  .exec-status { font-size: var(--mk-fs-micro); }
  .tline__errcode,
  .tline__http,
  .tline__recovered,
  .tline__drift { font-size: var(--mk-fs-micro); }
  .tline__session,
  .tline__prompt-meta,
  .tline__payload-meta { font-size: var(--mk-fs-micro); }
  .tline__none,
  .tline__label { font-size: var(--mk-fs-micro); }
  .tline-attempt__retry,
  .tline-attempt__dur { font-size: var(--mk-fs-micro); }
  .tline-attempt__err { font-size: var(--mk-fs-micro); }
  .exec-detail__box pre { font-size: var(--mk-fs-micro); }
  .tline-attempt__no { font-size: var(--mk-fs-micro); }
  .tline-attempt__meta { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号沿用 2000px 档 */
}
@media (min-width: 3600px) {
  /* zoom 1.3 档：字号继续放大 */
  .log-auto { font-size: var(--mk-fs-micro); }
  .exec-table { }
  .exec-time,
  .exec-dur,
  .exec-trace,
  .exec-stage,
  .exec-model__name { font-size: var(--mk-fs-micro); }
  .exec-title { font-size: var(--mk-fs-body); }
  .exec-tok__num,
  .exec-status { font-size: var(--mk-fs-micro); }
  .tline__errcode,
  .tline__http,
  .tline__recovered,
  .tline__drift { font-size: var(--mk-fs-micro); }
  .tline__session,
  .tline__prompt-meta,
  .tline__payload-meta { font-size: var(--mk-fs-micro); }
  .tline__none,
  .tline__label { font-size: var(--mk-fs-micro); }
  .tline-attempt__retry,
  .tline-attempt__dur { font-size: var(--mk-fs-micro); }
  .tline-attempt__err { font-size: var(--mk-fs-micro); }
  .exec-detail__box pre { font-size: var(--mk-fs-micro); }
  .tline-attempt__no { font-size: var(--mk-fs-micro); }
  .tline-attempt__meta { font-size: var(--mk-fs-micro); }
}

/* ================= 暗色模式（D1 补完）：执行日志终端页 ================= */
html[data-theme='dark'] {

  .exec-row--open { background: #252627; }
  .exec-detail td { background: #19191a; }
  .exec-detail__box { background: var(--wf-bg-body); border-color: var(--wf-border-light); }
  .exec-detail__box pre { color: var(--mk-pre-fg); }
  /* 审核 #125：原 `.tline { background:#19191a; border-color:… }` 是死类——模板从不输出裸
     `.tline`（只有 tline__* / tline-attempt*），且白占两条硬编码 hex，删 */
  .tline-attempt { background: var(--wf-bg-subtle); border-color: var(--wf-border-light); }
  .tline-attempt--fail { background: #241a1a; border-left-color: var(--mk-red); }


}

/* ================= D3 表格增强：列设置菜单 ================= */









</style>
