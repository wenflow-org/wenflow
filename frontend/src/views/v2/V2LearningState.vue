<template>
  <div class="state v2-page">
    <V2Nav />

    <main class="state__main">
      <!-- 页头（原型 1948-1953）：学习状态屏直接以 KPI 三卡开头，无 hero 大标题——
           原 h1 + 说明句撤掉，「查看学习历史」ghost 降为 KPI 行右侧的小入口 -->
      <div class="kpis">
        <div class="kpis__grid" role="list" aria-label="学习状态概览">
          <div v-if="kpiLoading" class="kpis__loading" role="listitem">
            <SkeletonLoader variant="lines" :count="2" />
          </div>
          <template v-else>
            <div class="kpi" role="listitem">
              <strong>{{ kpiStreak ?? '—' }}</strong>
              <span>连续天数</span>
            </div>
            <div class="kpi" role="listitem">
              <strong>{{ kpiWeekMinutes ?? '—' }}</strong>
              <span>本周分钟</span>
            </div>
            <div class="kpi" role="listitem">
              <strong>{{ kpiMastered ?? '—' }}</strong>
              <span>已掌握知识点</span>
            </div>
          </template>
        </div>
        <router-link to="/user/learning-history" class="btn-ghost kpis__link">查看学习历史</router-link>
      </div>

      <div class="state__grid">
        <div class="state__col" :class="{ 'state__col--empty': !hasAnyLoad }">
          <!-- 趋势图 -->
          <section class="card band">
            <div class="band__head">
              <div class="band__title">
                <strong>健康度 · 疲劳 · 状态</strong>
                <span class="band__meta">{{ drawnSpanLabel }}</span>
              </div>
              <!-- 窗口选择器只在真的有更长历史可看时出现（数据不足 42 天时两档是同一条图，
                   留着只会让口径与图对不上——2026-09-27 外部走查） -->
              <div v-if="showRangeSeg" class="band__extra">
                <!-- role+aria-pressed（2026-09-27 a11y）：纯视觉的选中底色读屏听不出，与图谱页层级分段同口径 -->
                <div class="seg" role="group" aria-label="趋势时间窗口">
                  <button type="button" class="seg__item" :class="{ 'seg__item--on': range === 42 }" :aria-pressed="range === 42" @click="setRange(42)">42 天</button>
                  <button type="button" class="seg__item" :class="{ 'seg__item--on': range === 90 }" :aria-pressed="range === 90" @click="setRange(90)">90 天</button>
                </div>
              </div>
            </div>

            <div class="band__body">
            <!-- 当前状态四项（原体检卡 vitals：整体状态主指标 + 学习压力/掌握趋势/疲劳程度）：
                 原型该屏只认三张 KPI 卡（连续天数/本周分钟/已掌握知识点），这四项不删、
                 降级为趋势卡内的状态 meta 行——图里画的就是这四个指标，放这里口径自洽 -->
            <div class="vitals vitals--meta">
              <div v-if="vitalsLoading" class="vitals__loading">
                <SkeletonLoader variant="lines" :count="1" />
              </div>
              <template v-else>
                <span class="vitals__main">
                  <small>{{ vitalMain.label }}</small>
                  <b :style="{ color: vitalMain.color }">{{ vitalMain.value }}<i v-if="vitalMain.unit"> {{ vitalMain.unit }}</i></b>
                  <span class="metric__note" :class="`metric__note--${vitalMain.tone}`">{{ vitalMain.note }}</span>
                </span>
                <span v-for="m in vitalSubs" :key="m.key" class="vitals__sub">
                  <small>{{ m.label }}</small>
                  <b :style="{ color: m.color }">{{ m.value }}<i v-if="m.unit"> {{ m.unit }}</i></b>
                  <span class="metric__note" :class="`metric__note--${m.tone}`">{{ m.note }}</span>
                </span>
              </template>
            </div>

            <!-- 图例（批19 术语自然化；2026-09-27 删状态 chip：与上方状态 meta 行重复） -->
            <div class="ff-legend">
              <span><i class="ff-dot ff-dot--fitness"></i>掌握趋势</span>
              <span><i class="ff-dot ff-dot--fatigue"></i>疲劳度</span>
              <span><i class="ff-dot ff-dot--lsb"></i>整体状态（掌握 − 疲劳）</span>
            </div>

            <div v-if="trendLoading" class="chart__loading"><SkeletonLoader variant="lines" :count="3" /></div>
            <div v-else-if="trendError" class="chart__empty">
              <strong>学习状态数据加载失败</strong>
              <p>网络或服务暂时不可用，稍后再试。</p>
              <button type="button" class="chart__retry" @click="loadTrends">重试</button>
            </div>
            <div v-else-if="!hasAnyLoad" class="chart__empty">
              <strong>学习状态正在积累中</strong>
              <p>完成第一个任务后开始记录，连续学习约 3 天即可看到掌握趋势、疲劳度与整体状态曲线。</p>
            </div>
            <template v-else>
              <!-- 触屏补 touchstart/touchmove（2026-09-27 a11y）：历史值此前只认 mousemove，
                   手机上永远看不到。不 preventDefault，手势仍归页面滚动 -->
              <div
                class="ff-chart"
                role="img"
                :aria-label="trendAriaLabel"
                @mousemove="onChartHover" @touchstart="onChartHover" @touchmove="onChartHover" @mouseleave="hoverDay = null"
              >
                <!-- y 轴刻度（原型 wf-trend__yaxis）：贴左留白的绝对定位标签，与 5 条网格线同位 -->
                <div class="ff-yaxis" aria-hidden="true">
                  <span v-for="t in yTicks" :key="t.top" :style="{ top: t.top + '%' }">{{ t.text }}</span>
                </div>
                <!-- 阈值区间标签（原型 wf-trend__zonetag）：40 精力充沛 / 20 最优训练区 -->
                <div class="ff-zones" aria-hidden="true">
                  <span v-for="z in zoneLines" :key="z.v" class="ff-zonetag" :style="{ top: z.top + '%' }">{{ z.v }} {{ z.label }}</span>
                </div>
                <svg :viewBox="`0 0 ${chartW} ${chartH}`" preserveAspectRatio="none" aria-hidden="true">
                  <!-- 横向网格线（2026-09-27 外部评审：原来没有任何坐标参照，曲线悬空感） -->
                  <g class="ff-grid">
                    <line
                      v-for="i in 5" :key="i"
                      :x1="plotX0" :x2="plotX1"
                      :y1="(chartH / 4) * (i - 1)" :y2="(chartH / 4) * (i - 1)"
                      vector-effect="non-scaling-stroke"
                    />
                  </g>
                  <!-- 状态阈值参考线（原型 wf-trend__zone）：40 精力充沛 / 20 最优训练区 -->
                  <line
                    v-for="z in zoneLines" :key="`zone-${z.v}`"
                    class="ff-zone"
                    :x1="plotX0" :x2="plotX1" :y1="z.y" :y2="z.y"
                    vector-effect="non-scaling-stroke"
                  />
                  <rect
                    v-for="p in points" :key="p.date"
                    class="ff-bar"
                    :x="p.bx" :y="p.by" :width="barW" :height="p.bh" rx="1.5"
                  />
                  <path v-if="lsbLineD" :d="lsbLineD" class="ff-line ff-line--lsb" />
                  <path v-if="ktlLineD" :d="ktlLineD" class="ff-line ff-line--fitness" />
                  <path v-if="lfLineD" :d="lfLineD" class="ff-line ff-line--fatigue" />
                  <template v-if="hoverDay">
                    <line class="ff-cursor" :x1="hoverDay.x" :x2="hoverDay.x" y1="0" :y2="chartH" />
                    <circle v-if="hoverDay.ky !== null" class="ff-pt ff-pt--fitness" :cx="hoverDay.x" :cy="hoverDay.ky" r="4" />
                    <circle v-if="hoverDay.ly !== null" class="ff-pt ff-pt--fatigue" :cx="hoverDay.x" :cy="hoverDay.ly" r="4" />
                    <circle v-if="hoverDay.sy !== null" class="ff-pt ff-pt--lsb" :cx="hoverDay.x" :cy="hoverDay.sy" r="4" />
                  </template>
                </svg>
              </div>
              <!-- 500 条上限的口径说明（2026-09-27）：凑满上限说明大概率被截断，
                   早段日子没有背景柱不是故障，先说清楚 -->
              <p v-if="sessionsTruncated" class="ff-trunc">时长背景柱仅统计最近 {{ SESSIONS_LIMIT }} 次学习记录，更早的日子未计入。</p>
              <!-- aria-live：SVG 本体 aria-hidden，唯一的历史值出口在这里，切日时 polite 播报 -->
              <div v-if="displayDay" class="ff-info" aria-live="polite">
                <b>{{ displayDay.label }}</b>
                <span>时长 {{ displayDay.minutes }} 分钟</span>
                <span class="ff-info__fitness">掌握 {{ displayDay.ktl ?? '—' }}</span>
                <span class="ff-info__fatigue">疲劳 {{ displayDay.lf ?? '—' }}</span>
                <span>状态 {{ displayDay.lsb ?? '—' }}（{{ displayDay.zone?.label || '暂无' }}）</span>
              </div>
              <!-- ff-zones 三档阈值行已删（2026-09-27）：口径折进侧栏「指标说明」，图上一行字不占 -->
            </template>
            </div><!-- /band__body -->
          </section>

          <!-- AI 调控建议（原型 wf-advisory，788-793 / 1971-1982）：
               4px 琥珀左边条 + 琥珀星标 head + 正文（guide 结论 / 建议列表 / 预警列表全保留）
               + 主次双按钮 + 成功回执行。skill 生成块走 adaptive-guidance-copy，静态规则兜底。
               新用户空态时靠 order:-1 提到首屏（原 .state__col--empty 选择器改挂本卡） -->
          <section class="card advisory">
            <div class="advisory__head">
              <svg class="advisory__star" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.7 4.6L18 9l-4.3 1.4L12 15l-1.7-4.6L6 9l4.3-1.4z"/></svg>
              <strong>AI 调控建议</strong>
              <span class="band__meta">{{ suggestSource }}</span>
            </div>
            <!-- 加载失败常显（收起也不许吞掉错误，P1 口径）：guidance 失败可见提示、可原地重试，
                 不再冒充"没有数据" -->
            <div v-if="guidanceLoadFailed" class="chart__empty" role="alert">
              AI 建议暂时取不到（生成较慢或失败）。
              <button type="button" class="guide-retry" :disabled="guidanceLoading" @click="loadGuidance">
                {{ guidanceLoading ? '重试中…' : '重试' }}
              </button>
            </div>
            <div class="advisory__body">
            <template v-if="skillCopy">
              <!-- 2026-09-27 重排：一段结论（标题 + 一句说明）+ 一个动作 + 一行脚注。
                   原来四层文本处理（副标 / 琥珀警告框 / 依据行 / 带标签的下一步·节奏两行）堆在一起，
                   且副标与警告框语义重叠——现在副标与警告二选一（取更具体的警告），
                   下一步·节奏合并成一行脚注。 -->
              <div class="guide">
                <h3 class="guide__title">{{ skillCopy.headline }}</h3>
                <p v-if="skillWarning || skillCopy.subtitle" class="guide__sub" :class="{ 'guide__sub--warn': !!skillWarning }">
                  <svg v-if="skillWarning" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12 2 1 21h22L12 2zm0 6 7 12H5l7-12zm-1 4v3h2v-3h-2zm0 4v2h2v-2h-2z"/></svg>
                  {{ skillWarning || skillCopy.subtitle }}
                </p>
              </div>
              <div v-if="guideActions.length" class="suggest__list">
                <article v-for="(a, i) in guideActions" :key="i" class="sug">
                  <span class="sug__icon" :style="{ background: a.bg, color: a.ink }" v-html="a.icon"></span>
                  <div class="sug__body">
                    <strong>{{ a.title }}</strong>
                    <p v-if="a.desc">{{ a.desc }}</p>
                  </div>
                  <router-link :to="a.resolved" class="sug__cta">{{ a.action || '前往' }}</router-link>
                </article>
              </div>
              <p v-if="skillCopy.nextStep || skillCopy.paceHint" class="guide__foot">
                <template v-if="skillCopy.nextStep">下一步：{{ skillCopy.nextStep }}</template>
                <template v-if="skillCopy.nextStep && skillCopy.paceHint"> · </template>
                <template v-if="skillCopy.paceHint">节奏：{{ skillCopy.paceHint }}</template>
              </p>
              <p v-if="evidenceHint" class="guide__evidence">依据：{{ evidenceHint }}（详见下方「学习调控」）</p>
            </template>

            <!-- 状态评审（AI 诊断书）已移至「学习调控」区第三层「诊断依据」（2026-09-27）：
                 它是建议的依据层而非建议本身，放在建议卡内部让人看不懂两者关系 -->

            <!-- 静态规则兜底块 -->
            <template v-else>
              <div v-if="!suggestionCards.length" class="chart__empty">
                {{ guidanceLoadFailed
                  ? 'AI 建议暂时取不到，可点上方重试。'
                  : (hasAnyLoad ? '当前没有特别建议，保持节奏就好。' : '完成第一次学习后，这里会出现 AI 建议。') }}
              </div>
              <div v-else class="suggest__list">
                <article v-for="(s, i) in suggestionCards" :key="i" class="sug" :class="`sug--${s.level}`">
                  <span class="sug__icon" :style="{ background: s.bg, color: s.ink }" v-html="s.icon"></span>
                  <div class="sug__body">
                    <strong>{{ s.title }}</strong>
                    <p>{{ s.message }}</p>
                  </div>
                  <router-link v-if="s.to" :to="s.to" class="sug__cta">{{ s.cta }}</router-link>
                </article>
              </div>
            </template>

            </div><!-- /advisory__body：预警常显，与正文同层 -->

            <!-- 预警（数据告警，两种模式都展示） -->
            <div v-if="warningsLoadFailed" class="chart__empty" role="alert">
              预警数据加载失败，请刷新页面重试。
            </div>
            <div v-if="skillCopy && warningRows.length" class="suggest__list suggest__list--warnings">
              <article v-for="(w, i) in warningRows" :key="i" class="sug" :class="`sug--${w.level}`">
                <span class="sug__icon" :style="{ background: w.bg, color: w.ink }" v-html="w.icon"></span>
                <div class="sug__body">
                  <strong>{{ w.title }}</strong>
                  <p>{{ w.message }}</p>
                </div>
              </article>
            </div>

            <!-- 主次双按钮（原型 wf-advisory__actions）：采用建议 = primary 蓝渐变，保持原计划 = ghost -->
            <div class="advisory__actions">
              <button type="button" class="adv-btn adv-btn--primary" :disabled="replanBusy" @click="adoptSuggestion">采用建议</button>
              <button type="button" class="adv-btn adv-btn--ghost" :disabled="replanBusy" @click="keepSuggestion">保持原计划</button>
            </div>
            <!-- 回执行（原型 wf-advisory__done）：采用 / 保持成功后就地播报，不靠 toast 一次性带过 -->
            <p v-if="advisoryDone" class="advisory__done" role="status">{{ advisoryDone }}</p>

            <!-- 次级区块：学习调控（原型外整块 → 降级进建议卡，功能与按钮原样保留，不删）：
                 待你确认 / 已自动处理 / 已执行的调整。原「AI 决策记录」是纯日志；
                 现在待确认卡带 pathId + advisory 摘要，本页成为完课卡之外的第二确认入口。 -->
            <div class="advisory__sub">
              <div class="advisory__subhead">
                <strong>学习调控</strong>
                <span class="band__meta">{{ pendingAdjust.length ? `${pendingAdjust.length} 条待确认` : '暂无待确认' }}</span>
              </div>
              <!-- 待你确认：课后 advisory，确认走与完课卡同一个 replan 接口 -->
              <section class="ctl">
                <p class="ctl__label">待你确认<b v-if="pendingAdjust.length">{{ pendingAdjust.length }}</b></p>
                <p v-if="!pendingAdjust.length" class="ctl__empty">没有待处理的调整。课后 AI 认为需要调整时，会在这里出现，你可以在这里确认或忽略。</p>
                <article v-for="card in pendingAdjust" :key="card.id" class="ctl-card">
                  <header class="ctl-card__head">
                    <span class="dec__tag dec__tag--blue">{{ card.pathTitle || '当前路径' }}</span>
                    <span v-if="card.mergedCount && card.mergedCount > 1" class="ctl-card__merged">近 {{ card.mergedCount }} 次课反复提示</span>
                    <time v-if="decisionTime(card.at)">{{ decisionTime(card.at) }}</time>
                  </header>
                  <p class="ctl-card__body">{{ card.body || card.judgment }}</p>
                  <p class="ctl-card__evidence">依据：{{ card.captured }}</p>
                  <div v-if="confirmingId !== card.id" class="ctl-card__actions">
                    <button type="button" class="ctl-btn ctl-btn--primary" :disabled="replanBusy" @click="confirmingId = card.id">确认调整</button>
                    <button type="button" class="ctl-btn" :disabled="!card.pathId" @click="jumpToAdjust(card)">查看建议</button>
                    <button type="button" class="ctl-btn ctl-btn--ghost" @click="dismissDecision(card)">保持原计划</button>
                  </div>
                  <div v-else class="ctl-card__confirm">
                    <span>这会调整该路径的后续阶段安排，已完成内容保留不变。</span>
                    <button type="button" class="ctl-btn ctl-btn--primary" :disabled="replanBusy" @click="confirmAdjust(card)">{{ replanBusy ? '正在调整…' : '确认' }}</button>
                    <button type="button" class="ctl-btn ctl-btn--ghost" @click="confirmingId = ''">取消</button>
                  </div>
                </article>
              </section>

              <!-- 系统已自动处理：一句话一条，不再捕获/判断/动作三行铺开 -->
              <section v-if="autoHandled.length" class="ctl">
                <p class="ctl__label">系统已自动处理<b>{{ autoHandled.length }}</b></p>
                <ul class="ctl__rows">
                  <li v-for="card in autoHandled" :key="card.id">
                    <span class="dec__tag" :class="decisionKindMeta[card.kind]?.cls">{{ decisionKindMeta[card.kind]?.label }}</span>
                    <span class="ctl__row-text">{{ card.captured }}。{{ card.action }}</span>
                  </li>
                </ul>
              </section>

              <!-- 已执行的调整：replan 历史 -->
              <section v-if="replannedRows.length" class="ctl">
                <p class="ctl__label">已执行的调整<b>{{ replannedRows.length }}</b></p>
                <ul class="ctl__rows">
                  <li v-for="card in replannedRows" :key="card.id">
                    <span class="dec__tag dec__tag--purple">已调整</span>
                    <span class="ctl__row-text">{{ card.captured }}。{{ card.action }}</span>
                    <time v-if="decisionTime(card.at)" class="ctl__row-time">{{ decisionTime(card.at) }}</time>
                  </li>
                </ul>
              </section>

              <!-- 诊断依据（原「状态评审」）：AI 的诊断书——为什么这么调，默认收起 -->
              <section v-if="reviewNarrative || reviewInsights.length" class="review ctl__review">
                <!-- h3 包 button（2026-09-27 a11y）：button 的内容模型只允许 phrasing，标题进按钮非法；
                     反过来包既保住标题语义又保住整行可点（APG disclosure 惯用式） -->
                <h3 class="review__title">
                  <button type="button" class="review__toggle" :aria-expanded="reviewOpen" @click="reviewOpen = !reviewOpen">
                    诊断依据
                    <span class="review__src">{{ reviewSource === 'model' ? 'AI 诊断' : '规则' }}<template v-if="reviewReliabilityText"> · {{ reviewReliabilityText }}</template></span>
                    <span class="band__chev" :class="{ 'band__chev--open': reviewOpen }" aria-hidden="true">▾</span>
                  </button>
                </h3>
                <div v-show="reviewOpen" class="review__body">
                  <p v-if="reviewNarrative" class="review__narrative">{{ reviewNarrative }}</p>
                  <ul v-if="reviewInsights.length" class="review__list">
                    <li v-for="(it, i) in reviewInsights" :key="i" class="review__item">
                      <strong>{{ it.claim }}</strong>
                      <span v-if="it.action" class="review__action">{{ it.action }}</span>
                    </li>
                  </ul>
                </div>
              </section>
            </div><!-- /advisory__sub -->
          </section><!-- /AI 调控建议 -->

          <!-- 复习台账（原型 1984-1991 wf-reviewlist）：head = 标题 + 右侧 meta，
               行 = 名称 + 84px 进度条 + 百分比。数据全部来自既有接口：
               /ai-teaching/review/due（retention 0-1 → %）+ /ai-teaching/review/plan（课上带几条） -->
          <section class="card band rlist">
            <div class="band__head">
              <div class="band__title">
                <strong>复习台账</strong>
                <span class="band__meta">{{ reviewMeta }}</span>
              </div>
            </div>
            <div class="band__body">
              <div v-if="reviewLoading" class="chart__loading"><SkeletonLoader variant="lines" :count="3" /></div>
              <div v-else-if="reviewLoadFailed" class="chart__empty" role="alert">
                <strong>复习台账暂时取不到</strong>
                <p>网络或服务暂时不可用，稍后再试。</p>
                <button type="button" class="chart__retry" @click="loadReviews">重试</button>
              </div>
              <div v-else-if="!reviewRows.length" class="chart__empty">
                <strong>暂无到期复习</strong>
                <p>学过的知识点进入复习窗口后，会按记忆强度排在这里。</p>
              </div>
              <ul v-else class="rlist__rows">
                <li v-for="r in reviewRows" :key="r.key" class="rlist__row">
                  <span class="rlist__name">{{ r.name }}</span>
                  <span class="wf-bar"><i :style="{ width: r.pct + '%' }"></i></span>
                  <span class="rlist__pct">{{ r.pct }}%</span>
                </li>
              </ul>
            </div>
          </section>

          <!-- 掌握分布（原型 1993-2000 wf-reviewlist）：数据 = 既有 /learning/concept-graph 节点按
               stability 分档（stable=已掌握 / developing·fragile=进行中 / 未测=待学习），
               与首页「已掌握知识点」同一数据源 -->
          <section class="card band rlist">
            <div class="band__head">
              <div class="band__title">
                <strong>掌握分布</strong>
                <span class="band__meta">{{ masteryMeta }}</span>
              </div>
            </div>
            <div class="band__body">
              <div v-if="!masteryLoaded" class="chart__loading"><SkeletonLoader variant="lines" :count="3" /></div>
              <div v-else-if="!masteryOk" class="chart__empty" role="alert">
                <strong>掌握分布暂时取不到</strong>
                <p>网络或服务暂时不可用，稍后再试。</p>
                <button type="button" class="chart__retry" @click="loadMastery">重试</button>
              </div>
              <div v-else-if="!masteryBuckets.total" class="chart__empty">
                <strong>还没有知识点数据</strong>
                <p>开始学习路径后，这里会按已掌握 / 进行中 / 待学习分档统计。</p>
              </div>
              <ul v-else class="rlist__rows">
                <li v-for="row in masteryBuckets.rows" :key="row.key" class="rlist__row">
                  <span class="rlist__name">{{ row.name }}</span>
                  <span class="wf-bar"><i :style="{ width: row.pct + '%' }"></i></span>
                  <span class="rlist__pct">{{ row.count }}</span>
                </li>
              </ul>
            </div>
          </section>
        </div>

        <!-- 原侧栏（原型该屏是单列流，无 300px 侧栏）：并入主列，卡片内容与顺序原样保留 -->
        <aside class="side">
          <!-- P1 修复：learnerCenter 失败提示 -->
          <section v-if="learnerCenterLoadFailed" class="card sidecard" role="alert">
            <span class="kicker">学习画像</span>
            <p class="chart__empty">画像数据加载失败，请刷新页面重试。</p>
          </section>
          <section v-if="preferenceItems.length && hasAnyLoad" class="card band sidecard">
            <div class="band__head">
              <div class="band__title">
                <span class="kicker">学习偏好</span>
                <span class="band__meta">{{ preferenceItems.length }} 项</span>
              </div>
            </div>
            <div class="band__body">
              <ul class="pref">
                <li v-for="(p, i) in preferenceItems" :key="i"><strong>{{ p.label }}</strong><span>{{ p.value }}</span></li>
              </ul>
            </div>
          </section>
          <!-- 2026-09-27：独立「学习记录」卡删除——整卡只有一个链接，入口上移到 hero 按钮 -->
          <section class="card band sidecard">
            <div class="band__head">
              <div class="band__title">
                <span class="kicker">指标说明</span>
              </div>
            </div>
            <div class="band__body">
            <ul class="legend">
              <li><b class="dot dot--blue"></b>掌握趋势：长期学习积累的掌握水平，变化平缓（曲线里的 KTL）</li>
              <li><b class="dot dot--purple"></b>疲劳度：近期学习压力的累积，变化较快（曲线里的 LF）</li>
              <li><b class="dot dot--green"></b>整体状态＝掌握 − 疲劳（曲线里的 LSB）：≥40 精力充沛 · 20–39 最优训练区 · &lt;20 需要休息</li>
              <li><b class="dot dot--amber"></b>保持规律学习让掌握趋势稳步上升；疲劳偏高时安排休息，避免长期处于低状态区</li>
            </ul>
            </div><!-- /band__body -->
          </section>
        </aside>
      </div>
    </main>

    <!-- AI 生成提示 + 页脚：一起沉底 -->
    <div class="state__foot">
      <div class="state__ai-note">
        <AiContentNote />
      </div>
      <V2Footer />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import request from '@/utils/api';
import { toast } from '@/utils/toast';
import { metricsAPI } from '@/api/metrics';
import V2Nav from './V2Nav.vue';
import AiContentNote from '@/components/AiContentNote.vue';
import V2Footer from './V2Footer.vue';
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue';
import { localDateKey, localDateKeyFromIso } from '@/utils/date';
import { unwrap, unwrapArray } from './unwrap';

type MetricKey = 'lsb' | 'lss' | 'ktl' | 'lf';

const current = ref<Record<string, any> | null>(null);
const warnings = ref<Array<Record<string, any>>>([]);
const trendLoading = ref(true);
const trendError = ref(false);
const range = ref<42 | 90>(42);

/* ---------- 卡片常显（2026-09-27）：本页所有 band 全部默认展开，折叠按钮退役——
   藏内容的成本（一次点击 + 预期管理）高于滚动成本（与学习台同口径）。仅
   「诊断依据」保留展开/收起：那是评审向行话，属于需要时才看的参考层。 ---------- */
const reviewOpen = ref(false);

const metricOptions: Array<{ key: MetricKey; label: string }> = [
  { key: 'lsb', label: '整体状态' },
  { key: 'lss', label: '学习压力' },
  { key: 'ktl', label: '掌握趋势' },
  { key: 'lf', label: '疲劳程度' }
];

function toneOf(key: MetricKey, v: number): { tone: string; color: string; note: string } {
  if (v === null || v === undefined || Number.isNaN(v)) return { tone: 'blue', color: 'var(--muted)', note: '积累中' };
  if (key === 'lsb') {
    // LSB = KTL - LF（-100 ~ +100），分档对齐后端 <0/<20/<40/≥40 与状态分档文案
    if (v < 0) return { tone: 'red', color: 'var(--red-ink)', note: '严重疲劳，优先休息' };
    if (v >= 40) return { tone: 'green', color: 'var(--green-ink)', note: '精力充沛' };
    if (v >= 20) return { tone: 'blue', color: 'var(--blue-deep)', note: '最优训练区' };
    return { tone: 'amber', color: 'var(--amber-ink)', note: '需要休息' };
  }
  if (key === 'ktl') {
    if (v > 0) return { tone: 'purple', color: 'var(--accent)', note: '上升' };
    if (v === 0) return { tone: 'blue', color: 'var(--blue-deep)', note: '持平' };
    return { tone: 'amber', color: 'var(--amber-ink)', note: '下降' };
  }
  // lss / lf 越低越好；分档对齐后端 LearningMetricService 建议阈值
  // （lss ≤50 无提示/50-75「压力适中」/>75「压力过大」；lf >60 才提示「疲劳度较高」）——
  // 旧档（35/65）把新用户首课的 40 分就标成「偏高」，与同页「最优训练区」自相矛盾
  if (key === 'lss') {
    if (v <= 50) return { tone: 'green', color: 'var(--green-ink)', note: '适中' };
    if (v <= 75) return { tone: 'amber', color: 'var(--amber-ink)', note: '偏高' };
    return { tone: 'red', color: 'var(--red-ink)', note: '过高' };
  }
  if (v <= 60) return { tone: 'green', color: 'var(--green-ink)', note: '较低' };
  if (v <= 85) return { tone: 'amber', color: 'var(--amber-ink)', note: '偏高' };
  return { tone: 'red', color: 'var(--red-ink)', note: '过高' };
}

const metricCards = computed(() =>
  metricOptions.map((m) => {
    // P1 修复：加载失败显示「读取失败」而非伪装「暂无数据」
    if (currentLoadFailed.value) {
      return { ...m, value: '—', unit: m.key === 'lsb' ? '' : '分', tone: 'red', color: 'var(--red-ink)', note: '读取失败' };
    }
    const v = current.value?.[m.key];
    const t = toneOf(m.key, v);
    return { ...m, value: v ?? '—', unit: m.key === 'lsb' ? '' : '分', ...t };
  })
);

/* 体检卡（批19）：主指标=整体状态，其余三项行内条 */
const vitalsLoading = computed(() => current.value === null && !currentLoadFailed.value);
const vitalMain = computed(() => metricCards.value[0]);
const vitalSubs = computed(() => metricCards.value.slice(1));

/* 页头 hero 已撤（原型 1948-1953：该屏直接以 KPI 开头，无 h1 + 说明句），
   原 heroTitle 动态问候随大标题一起移除（去向：无——原型该位不留文案） */

/* ---------- 状态趋势（权威口径：后端 /state/trends，LSS/KTL/LF/LSB，与指标卡同源） ----------
   此前趋势图在前端用「纯时长 EWMA（42/7 天）」自算 fitness/fatigue/form，与指标卡的
   LSS/KTL/LF/LSB（质量合成）是两套孤儿模型，且图例文案（13.5 天/2 天）与代码矛盾。
   现统一为后端权威趋势，删除前端自算。 */
interface Zone {
  cls: 'fresh' | 'optimal' | 'risk';
  label: string;
}

interface TrendPoint {
  date: string;
  label: string;
  ktl: number | null;   // 掌握趋势
  lf: number | null;    // 疲劳
  lsb: number | null;   // 整体状态 = KTL − LF
  minutes: number;      // 当日时长（仅展示背景柱，不参与状态计算）
  zone: Zone | null;
  x: number;
  ky: number | null;
  ly: number | null;
  sy: number | null;
  bx: number;
  by: number;
  bh: number;
}

const dailyLoad = ref<Array<{ date: string; minutes: number }>>([]);
const stateTrends = ref<Array<{ date: string; ktl: number | null; lf: number | null; lsb: number | null }>>([]);

/** 分区基于 LSB（对齐 learning-state.service：LSB = KTL − LF，0-100） */
function zoneOfLsb(lsb: number | null): Zone | null {
  if (lsb === null) return null;
  if (lsb >= 40) return { cls: 'fresh', label: '精力充沛' };
  if (lsb >= 20) return { cls: 'optimal', label: '最优训练区' };
  if (lsb >= 0) return { cls: 'risk', label: '需要休息' };
  return { cls: 'risk', label: '高风险区' };
}

/* 窗口自适应：左侧从最早数据日 -2 天开始，今天右侧留 2 天余量（新值不贴右边缘） */
const RIGHT_MARGIN = 2;

const earliestDataOffset = computed(() => {
  let earliest = 0;
  for (const d of dailyLoad.value) {
    if (d.minutes > 0) {
      const days = Math.round((Date.now() - new Date(d.date + 'T00:00:00').getTime()) / 86400000);
      earliest = Math.max(earliest, days);
    }
  }
  return earliest;
});

const windowStartOffset = computed(() => {
  // 数据少时窗口自动收缩（但至少约一周）；数据多时用满所选范围
  const base = Math.min(range.value - 1, earliestDataOffset.value + 2);
  return Math.max(base, 7);
});

const series = computed<Array<Omit<TrendPoint, 'x' | 'ky' | 'ly' | 'sy' | 'bx' | 'by' | 'bh'>>>(() => {
  const loadMap = new Map(dailyLoad.value.map((d) => [d.date, d.minutes]));
  const trendMap = new Map(stateTrends.value.map((t) => [t.date, t]));
  const days: Array<Omit<TrendPoint, 'x' | 'ky' | 'ly' | 'sy' | 'bx' | 'by' | 'bh'>> = [];
  for (let i = windowStartOffset.value; i >= -RIGHT_MARGIN; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const t = trendMap.get(key) ?? null;
    const lsb = t?.lsb ?? null;
    days.push({
      date: key,
      label: `${d.getMonth() + 1}月${d.getDate()}日`,
      ktl: t?.ktl ?? null,
      lf: t?.lf ?? null,
      lsb,
      minutes: loadMap.get(key) ?? 0,
      zone: zoneOfLsb(lsb)
    });
  }
  return days;
});

const hasAnyLoad = computed(() => stateTrends.value.some((t) => t.lsb !== null));

const chartW = 760;
const chartH = 240;
const chartPad = 8;
/* 左侧 y 轴留白（原型 AXIS=52/812 ≈ 6.4%）：刻度标签贴这块留白，网格与阈值线从 plotX0 起画 */
const AXIS_W = 46;
const plotX0 = AXIS_W;
const plotX1 = chartW - chartPad;

/* 2026-09-27 外部视觉评审修复：
   ① 裁掉开头无数据日（原来 42 天窗口里曲线只占右侧 40%，左侧空旷悬空）；
   ② y 轴改动态量程（原来固定 0-100，40-50 的曲线压成一条扁线）；
   ③ 活动柱（时长）用自己的刻度且封顶 28% 图高——原来复用指标刻度，
      分钟数大的日子柱条直接画穿画布（y=-7238 那种）。 */
const activeSeries = computed(() => {
  const days = series.value;
  const first = days.findIndex((d) => d.ktl !== null || d.lf !== null || d.lsb !== null || d.minutes > 0);
  if (first <= 1) return days;
  return days.slice(Math.max(0, first - 2));
});

const valueDomain = computed(() => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of activeSeries.value) {
    for (const v of [d.ktl, d.lf, d.lsb]) {
      if (v === null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo)) return { lo: 0, hi: 100 };
  const pad = Math.max(5, (hi - lo) * 0.18);
  const loPad = lo - pad;
  const hiPad = hi + pad;
  return {
    // ① 数据含负值（LSB 可 <0）时不把下界 clamp 到 0——否则那几天的点画到画布外被裁掉、刻度也对不上。
    // ② 量程必须包住语义锚点 40「精力充沛」/ 20「最优训练区」：阈值参考线与区间标签按原型口径
    //    只在量程内绘制，锚点一出图，整张图就没有参照系了。上下各留 4 的余量（16/44），
    //    免得 20 线正好压在画布底边、标签被裁掉一半。
    lo: lo < 0 ? loPad : Math.max(0, Math.min(loPad, 16)),
    hi: Math.max(hiPad, 44)
  };
});

const maxMinutes = computed(() => Math.max(10, ...activeSeries.value.map((d) => d.minutes)));

/* 口径诚实化（2026-09-27 外部走查）：标签按「图里实际画了几天」出，不再照抄请求窗口
   （原来固定写「近 42 天」，数据只有 9 天时口径与图对不上）；历史短于 42 天时
   42/90 两档窗口画出同一条线 → 切换器直接不出现，避免假开关。 */
const drawnSpanLabel = computed(() =>
  activeSeries.value.length ? `近 ${activeSeries.value.length} 天` : '暂无数据'
);
const historyDays = computed(() => {
  const dates = stateTrends.value.map((t) => t.date).filter(Boolean).slice().sort();
  if (dates.length < 2) return dates.length;
  const first = new Date(dates[0]).getTime();
  const last = new Date(dates[dates.length - 1]).getTime();
  if (Number.isNaN(first) || Number.isNaN(last)) return dates.length;
  return Math.round((last - first) / 86400000) + 1;
});
const showRangeSeg = computed(() => historyDays.value > 42);

const points = computed<TrendPoint[]>(() => {
  const n = activeSeries.value.length;
  const usableW = plotX1 - plotX0;
  const step = n > 1 ? usableW / (n - 1) : 0;
  const { lo, hi } = valueDomain.value;
  const span = hi - lo || 1;
  const yOf = (v: number) => chartH - ((v - lo) / span) * chartH;
  const barCap = chartH * 0.28;
  return activeSeries.value.map((d, i) => {
    const x = plotX0 + step * i;
    const bh = Math.min(barCap, (d.minutes / maxMinutes.value) * barCap);
    return {
      ...d,
      x,
      ky: d.ktl !== null ? yOf(d.ktl) : null,
      ly: d.lf !== null ? yOf(d.lf) : null,
      sy: d.lsb !== null ? yOf(d.lsb) : null,
      bx: x - barW.value / 2,
      by: chartH - bh,
      bh
    };
  });
});

const barW = computed(() => {
  const n = activeSeries.value.length || 1;
  return Math.max(2, Math.min(10, ((plotX1 - plotX0) / n) * 0.55));
});

/* ---------- y 轴刻度（原型 4137-4145）：标签与 5 条网格线同位，值 = 量程按四等分取整 ---------- */
const yTicks = computed(() => {
  const { lo, hi } = valueDomain.value;
  const span = hi - lo || 1;
  return [0, 1, 2, 3, 4].map((i) => ({
    top: (i / 4) * 100,
    text: String(Math.round(hi - span * (i / 4)))
  }));
});

/* ---------- 状态阈值参考线 + 区间标签（原型 766-772 / 4147-4157） ----------
   量程已在 valueDomain 里保证包住 40/20，所以两条线恒可见；标签写成「40 精力充沛」的合并样式 */
const ZONE_LINES: Array<{ v: number; label: string }> = [
  { v: 40, label: '精力充沛' },
  { v: 20, label: '最优训练区' }
];

const zoneLines = computed(() => {
  const { lo, hi } = valueDomain.value;
  const span = hi - lo || 1;
  const yOf = (v: number) => chartH - ((v - lo) / span) * chartH;
  return ZONE_LINES.map((z) => {
    const y = yOf(z.v);
    return { ...z, y, top: (y / chartH) * 100 };
  });
});

/** 读屏出口：SVG 本体 aria-hidden，纵轴口径写进容器的 aria-label（原型 1965） */
const trendAriaLabel = computed(
  () =>
    `近 ${activeSeries.value.length} 天的掌握趋势、疲劳度与整体状态曲线，柱为当日学习时长，纵轴标注状态阈值 40 精力充沛 / 20 最优训练区`
);

/** 单线路径：跳过 null 断点（无数据日不连线） */
function linePath(key: 'ktl' | 'lf' | 'lsb') {
  const pts = points.value;
  if (!pts.length) return '';
  const parts: string[] = [];
  let pen: string | null = null;
  for (const p of pts) {
    const y = key === 'ktl' ? p.ky : key === 'lf' ? p.ly : p.sy;
    if (y === null) { pen = null; continue; }
    if (pen === null) {
      parts.push(`M${p.x.toFixed(1)},${y.toFixed(1)}`);
      pen = 'L';
    } else {
      parts.push(`L${p.x.toFixed(1)},${y.toFixed(1)}`);
    }
  }
  return parts.join(' ');
}

const ktlLineD = computed(() => linePath('ktl'));
const lfLineD = computed(() => linePath('lf'));
const lsbLineD = computed(() => linePath('lsb'));

/** 今天本地日期键（与 series 同格式）。图表右侧 2 天是刻意的留白（非真实数据日），
    「当前状态」必须落在今天而非留白日，否则会展示一个未来日期的空数据。 */
const todayKey = computed(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});

const latestDay = computed<TrendPoint | null>(() => {
  const hit = points.value.find((p) => p.date === todayKey.value);
  if (hit) return hit;
  const past = points.value.filter((p) => p.date <= todayKey.value);
  return (past.length ? past[past.length - 1] : points.value[points.value.length - 1]) ?? null;
});
const hoverDay = ref<TrendPoint | null>(null);
const displayDay = computed<TrendPoint | null>(() => hoverDay.value ?? latestDay.value);

/** 鼠标与触屏共用（2026-09-27 a11y）：触屏事件没有顶层 clientX，取第一个触点
 *  （只服务单指走查，多指交给浏览器滚动） */
function onChartHover(e: MouseEvent | TouchEvent) {
  const el = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const x = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
  if (x === undefined) return;
  const relX = ((x - rect.left) / rect.width) * chartW;
  let best: TrendPoint | null = null;
  let bestDist = Infinity;
  for (const p of points.value) {
    const dist = Math.abs(p.x - relX);
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  hoverDay.value = best;
}

/** 时长背景柱（仅展示不参与状态计算）：与 42/90 窗口无关，进页拉一次即可——
 *  切窗口只重拉 trends，省一次 500 条全量请求（2026-09-27 从 loadTrends 拆出） */
const SESSIONS_LIMIT = 500;
const sessionsTruncated = ref(false);
/* KPI 依赖会话汇总：成功与失败都要把 loading 收掉——失败显示「—」，不拿 0 冒充「没学过」 */
const sessionsLoaded = ref(false);
const sessionsOk = ref(false);
async function loadSessions() {
  try {
    const sessionRes = await request.get('/users/me/sessions', { params: { limit: SESSIONS_LIMIT } });
    const list = unwrapArray(sessionRes);
    // 正好顶到上限 → 大概率被截断，图上给出口径说明（见模板 ff-trunc）
    sessionsTruncated.value = list.length >= SESSIONS_LIMIT;
    const map = new Map<string, number>();
    for (const s of list) {
      const key = localDateKeyFromIso(typeof s.startTime === 'string' ? s.startTime : null);
      if (!key) continue;
      const duration = typeof s.durationMinutes === 'number' ? s.durationMinutes : 0;
      map.set(key, (map.get(key) ?? 0) + duration);
    }
    dailyLoad.value = [...map.entries()].map(([date, minutes]) => ({ date, minutes }));
    sessionsOk.value = true;
  } catch {
    // 背景柱是装饰层：失败就少画柱，不值得把整张趋势图打成错误态
  } finally {
    sessionsLoaded.value = true;
  }
}

/* ---------- 顶部三张 KPI（原型 wf-kpis 三等权卡：连续天数 / 本周分钟 / 已掌握知识点） ----------
   三张卡全部由本页已有数据推导，不新增后端接口：
   · 连续天数 = /users/me/sessions 按天汇总的客户端连击推算（与学习台的本地回退同口径，
     今天没学则从昨天起数）；
   · 本周分钟 = 同一份按天汇总里「本周一 ~ 今天」的分钟和（与学习台「本周条」同口径）；
   · 已掌握知识点 = /learning/concept-graph 里 stability=stable 的节点数（与个人中心 KPI 同源）。 */
const minutesByDate = computed(() => {
  const map = new Map<string, number>();
  for (const d of dailyLoad.value) map.set(d.date, d.minutes);
  return map;
});

const kpiStreak = computed<number | null>(() => {
  if (!sessionsOk.value) return null;
  let streak = 0;
  const d = new Date();
  if ((minutesByDate.value.get(localDateKey(d)) ?? 0) === 0) d.setDate(d.getDate() - 1);
  // guard：dailyLoad 只有有限天，往前数到第一个空档必然终止；上限只是防呆
  for (let i = 0; i < 3650; i++) {
    if ((minutesByDate.value.get(localDateKey(d)) ?? 0) <= 0) break;
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  return streak;
});

const kpiWeekMinutes = computed<number | null>(() => {
  if (!sessionsOk.value) return null;
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const start = localDateKey(monday);
  const end = localDateKey(now);
  let sum = 0;
  for (const d of dailyLoad.value) {
    if (d.date >= start && d.date <= end) sum += d.minutes;
  }
  return sum;
});

/* ---------- 掌握分布 +「已掌握知识点」（既有 GET /learning/concept-graph，个人中心同源） ---------- */
interface GraphNode {
  stability?: string | null;
}

const masteryNodes = ref<GraphNode[]>([]);
const masteryLoaded = ref(false);
const masteryOk = ref(false);

async function loadMastery() {
  try {
    const res = await request.get('/learning/concept-graph');
    const graph = unwrap<{ nodes?: GraphNode[] }>(res);
    masteryNodes.value = Array.isArray(graph?.nodes) ? graph.nodes : [];
    masteryOk.value = true;
  } catch {
    masteryOk.value = false;
  } finally {
    masteryLoaded.value = true;
  }
}

/* 三档分账（原型 1996-1998）：stable=已掌握、developing/fragile=进行中、未测(null/unknown)=待学习。
   条宽按各档占总数的百分比，右侧数字是「个数」——与原型一致（原型也是 18 / 8 / 8 的计数） */
const masteryBuckets = computed(() => {
  const nodes = masteryNodes.value;
  const total = nodes.length;
  const mastered = nodes.filter((n) => n.stability === 'stable').length;
  const learning = nodes.filter((n) => n.stability === 'developing' || n.stability === 'fragile').length;
  const pending = Math.max(total - mastered - learning, 0);
  const widthOf = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  return {
    total,
    mastered,
    rows: [
      { key: 'mastered', name: '已掌握', count: mastered, pct: widthOf(mastered) },
      { key: 'learning', name: '进行中', count: learning, pct: widthOf(learning) },
      { key: 'pending', name: '待学习', count: pending, pct: widthOf(pending) }
    ]
  };
});

const kpiMastered = computed<number | null>(() => (masteryOk.value ? masteryBuckets.value.mastered : null));
/** 三张 KPI 全部到齐才出数：任一数据源还在飞就走骨架，避免「0」冒充「没学过」 */
const kpiLoading = computed(() => !sessionsLoaded.value || !masteryLoaded.value);

/* ---------- 复习台账（既有 GET /ai-teaching/review/due + /review/plan，学习台同源） ----------
   due = 全部到期清单（上限 20），retention 0-1 就是条宽与百分比；
   plan = 课内温故计划条数，对应原型卡头 meta 的「课上带 N」 */
const reviewDue = ref<Array<{ conceptKey: string; label: string; retention: number }>>([]);
const reviewPlanned = ref<number | null>(null);
const reviewLoading = ref(true);
const reviewLoadFailed = ref(false);

async function loadReviews() {
  reviewLoading.value = true;
  reviewLoadFailed.value = false;
  const [dueR, planR] = await Promise.allSettled([
    request.get('/ai-teaching/review/due'),
    request.get('/ai-teaching/review/plan')
  ]);
  if (dueR.status === 'fulfilled') {
    const body = unwrap<{ items?: Array<{ conceptKey: string; label?: string; retention?: number }> }>(dueR.value);
    reviewDue.value = (Array.isArray(body?.items) ? body.items : []).map((it) => ({
      conceptKey: String(it.conceptKey ?? ''),
      label: String(it.label || it.conceptKey || ''),
      retention: typeof it.retention === 'number' ? it.retention : 0
    }));
  } else {
    reviewDue.value = [];
    reviewLoadFailed.value = true;
  }
  if (planR.status === 'fulfilled') {
    const body = unwrap<{ items?: unknown[] }>(planR.value);
    reviewPlanned.value = Array.isArray(body?.items) ? body.items.length : null;
  } else {
    reviewPlanned.value = null;
  }
  reviewLoading.value = false;
}

/** 记忆强度最低的排前面（最该复习的先看），最多 5 行——原型卡也是短列表 */
const reviewRows = computed(() =>
  reviewDue.value
    .slice()
    .sort((a, b) => a.retention - b.retention)
    .slice(0, 5)
    .map((r) => ({
      key: r.conceptKey || r.label,
      name: r.label || r.conceptKey,
      pct: Math.min(100, Math.max(0, Math.round(r.retention * 100)))
    }))
);

const reviewMeta = computed(() => {
  const due = reviewDue.value.length;
  if (!due) return '暂无到期';
  const planned = reviewPlanned.value;
  return planned != null && planned > 0 ? `到期 ${due} · 课上带 ${planned}` : `到期 ${due}`;
});

const masteryMeta = computed(() => {
  if (!masteryLoaded.value) return '读取中';
  if (!masteryOk.value) return '读取失败';
  const { mastered, total } = masteryBuckets.value;
  return total ? `${mastered} / ${total} 个知识点` : '暂无知识点';
});

let trendSeq = 0;
async function loadTrends() {
  const seq = ++trendSeq;
  trendLoading.value = true;
  try {
    // 权威口径：后端 /state/trends（LSS/KTL/LF/LSB，与指标卡同源），替代前端自算 EWMA
    const trendRes = await request.get('/state/trends', { params: { days: range.value, range: 'recent' } });
    if (seq !== trendSeq) return;
    const trendData = unwrap<{ trends?: Array<{ date: string; lss: number | null; ktl: number | null; lf: number | null; lsb: number | null }> }>(trendRes);
    stateTrends.value = (trendData?.trends || []).map((t) => ({
      // 后端回的是本地零点 Date 的 ISO 序列化（UTC），必须按本地时区还原，
      // 否则 UTC+8 会整体前移一天（与 V2LearningHistory 同一口径问题）
      date: localDateKeyFromIso(String(t.date)),
      ktl: typeof t.ktl === 'number' ? t.ktl : null,
      lf: typeof t.lf === 'number' ? t.lf : null,
      lsb: typeof t.lsb === 'number' ? t.lsb : null
    }));
    trendError.value = false;
  } catch {
    // 只有最新一次请求的失败才展示错误态（旧请求的失败不覆盖新结果）
    if (seq !== trendSeq) return;
    trendError.value = true;
    stateTrends.value = [];
  } finally {
    if (seq === trendSeq) trendLoading.value = false;
  }
}

function setRange(r: 42 | 90) {
  range.value = r;
  void loadTrends();
}

/* ---------- skill 引导（adaptive-guidance-copy, view=learning-state） ---------- */
const guidance = ref<Record<string, any> | null>(null);

const router = useRouter();
const skillCopy = computed(() => guidance.value?.copy || null);

/* ---------- 状态评审诊断（diagnosis 层，Slice 2c） ---------- */
const reviewDiagnosis = computed(() => guidance.value?.review?.diagnosis || null);
const reviewSource = computed(() => guidance.value?.review?.source || null);
const reviewNarrative = computed(() => reviewDiagnosis.value?.narrative || '');
const reviewInsights = computed<Array<{ type: string; claim: string; action: string }>>(() =>
  Array.isArray(reviewDiagnosis.value?.insights) ? reviewDiagnosis.value.insights : []
);
const reviewCalibration = computed(() => guidance.value?.review?.calibration || null);
const reviewReliabilityText = computed(() => {
  const c = reviewCalibration.value;
  if (!c || !c.n) return '';
  if (c.hitRate == null) return `历史核对 ${c.n} 条 · 样本不足`;
  return `历史核对 ${c.n} 条 · 命中 ${Math.round(c.hitRate * 100)}%`;
});

/* ---------- 学习调控（2026-09-27 重构）：待确认 / 已自动处理 / 已执行的调整 ----------
   原「AI 决策记录」是纯日志；现在 path-adjust 卡带 pathId + advisory 摘要，
   本页成为完课卡之外的第二确认入口。 */
interface DecisionOption {
  key: string;
  label: string;
  description?: string;
}

interface DecisionCard {
  id: string;
  kind: 'path-adjust' | 'path-replanned' | 'kp-carryover' | 'concept-watch' | 'pace';
  captured: string;
  judgment: string;
  action: string;
  priority: 'high' | 'medium' | 'low' | 'info';
  at: string | null;
  pathId?: string | null;
  pathTitle?: string | null;
  recommendation?: string | null;
  body?: string;
  options?: DecisionOption[];
  advisory?: Record<string, any>;
  mergedCount?: number;
}

const decisions = computed<DecisionCard[]>(() =>
  Array.isArray(guidance.value?.decisions) ? guidance.value.decisions : []
);

const decisionKindMeta: Record<string, { label: string; cls: string }> = {
  'path-adjust': { label: '路径调整', cls: 'dec__tag--blue' },
  'path-replanned': { label: '路径调整', cls: 'dec__tag--purple' },
  'kp-carryover': { label: '课程延续', cls: 'dec__tag--cyan' },
  'concept-watch': { label: '持续关注', cls: 'dec__tag--amber' },
  'pace': { label: '节奏调控', cls: 'dec__tag--green' }
};

function decisionTime(at: string | null): string {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/* 三段分组：待确认（可操作，可忽略消账）/ 已自动处理 / 已执行 */
const DISMISS_KEY = 'learning_state_dismissed_advisories';
const dismissedAdvisories = ref<string[]>((() => {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]') as string[]; } catch { return []; }
})());
function dismissDecision(card: DecisionCard) {
  dismissedAdvisories.value = [...dismissedAdvisories.value, card.id];
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify(dismissedAdvisories.value)); } catch { /* ignore */ }
  confirmingId.value = '';
}

const pendingAdjust = computed(() =>
  decisions.value.filter((d) => d.kind === 'path-adjust' && !dismissedAdvisories.value.includes(d.id))
);
const autoHandled = computed(() =>
  decisions.value.filter((d) => d.kind === 'kp-carryover' || d.kind === 'concept-watch' || d.kind === 'pace')
);
const replannedRows = computed(() => decisions.value.filter((d) => d.kind === 'path-replanned'));

/* AI 建议区的依据行：与待确认调控互相引用（此前两块各自为政） */
const evidenceHint = computed(() => pendingAdjust.value[0]?.captured || '');

/* 内联确认：与完课卡同一个 replan 接口、同一份 evidence 语义 */
const confirmingId = ref('');
const replanBusy = ref(false);
const REPLAN_REASON: Record<string, string> = {
  reinforce: '根据课后建议，为下一阶段补强关键薄弱点',
  resequence: '根据课后建议，调整下一阶段顺序以降低理解风险',
  accelerate: '根据课后建议，压缩下一阶段以加快推进',
  slow_down: '根据课后建议，放慢下一阶段节奏'
};

async function confirmAdjust(card: DecisionCard) {
  if (!card.pathId || replanBusy.value) return;
  replanBusy.value = true;
  try {
    await request.post(`/learning/paths/${card.pathId}/replan`, {
      triggerSource: 'ai-teaching',
      mode: 'overwrite',
      reason: REPLAN_REASON[card.recommendation || 'reinforce'] || '根据课后建议调整后续阶段',
      requireConfirmation: false,
      evidence: { advisoryAction: card.recommendation || 'reinforce', advisory: card.advisory || null }
    });
    toast.success(`已调整「${card.pathTitle || '当前路径'}」的后续阶段`);
    // 卡头双按钮的回执行（原型 wf-advisory__done）：确认成功后就地留一行，不只靠 toast 一闪而过
    advisoryDone.value = `已采用建议：「${card.pathTitle || '当前路径'}」的后续阶段已调整，已完成内容保留不变。`;
    dismissDecision(card);
  } catch (e: any) {
    toast.error(e?.message || '调整失败，请稍后再试');
  } finally {
    replanBusy.value = false;
  }
}

function jumpToAdjust(card: DecisionCard) {
  if (!card.pathId) return;
  router.push({ path: `/learning-path/${card.pathId}`, query: { adjust: 'ai' } });
}

/* ---------- 建议卡主次双按钮（原型 wf-advisory__actions + __done） ----------
   采用建议 = 落到「待你确认」里的第一条调整（与调控区同一 replan 接口）；
              没有待确认时转去今日动作（guideActions 第一条），再没有就明确回一行「保持节奏」。
   保持原计划 = 消掉那条待确认（本地忽略，不发请求），与调控区的同名按钮同一语义。
   两条路径的全部动作在下方「学习调控」次级区块里仍然逐条可操作，这里只是把主路径提到卡头。 */
const advisoryDone = ref('');

function adoptSuggestion() {
  const card = pendingAdjust.value[0];
  if (card) {
    void confirmAdjust(card);
    return;
  }
  const action = guideActions.value[0];
  if (action) {
    void router.push(action.resolved);
    return;
  }
  advisoryDone.value = '当前没有需要采用的调整，保持现在的节奏就好。';
}

function keepSuggestion() {
  const card = pendingAdjust.value[0];
  if (card) {
    dismissDecision(card);
    advisoryDone.value = '已保持原计划，这条调整不会再出现在待确认里。';
    return;
  }
  advisoryDone.value = '好的，保持原计划，后续阶段不做改动。';
}

const suggestSource = computed(() => {
  if (!guidance.value) return '系统建议';
  if (guidance.value.source === 'model') return 'AI 生成';
  return '系统建议';
});

const skillWarning = computed(() => {
  const w = skillCopy.value?.warningCopy;
  return w && w !== '当前没有明显风险。' ? w : '';
});

const svgPlay = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
const svgLayers = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="m12 2 10 5-10 5L2 7l10-5zm0 7.6L18.9 7 12 4.4 5.1 7 12 9.6zM2 12l10 5 10-5v2l-10 5L2 14v-2zm0 5 10 5 10-5v2l-10 5L2 19v-2z" opacity=".9"/></svg>';
const svgPlus = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/></svg>';
const svgMedal2 = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2a7 7 0 0 0-4 12.74V22l4-2 4 2v-7.26A7 7 0 0 0 12 2z"/></svg>';
const svgHome = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="m12 3 9 8h-3v9h-4v-6h-4v6H6v-9H3l9-8z"/></svg>';

const guideActions = computed(() => {
  const list = skillCopy.value?.todayActions;
  if (!Array.isArray(list)) return [];
  const pathId = guidance.value?.summary?.path?.pathId || null;
  const taskId = guidance.value?.summary?.path?.taskId || null;
  const resolve = (to?: string): string => {
    switch (to) {
      case 'continue-learning': {
        // 2026-09-27：直达当前任务（summary.path.taskId），不再落路径详情页多一跳
        if (taskId) return pathId ? `/learn/${taskId}?pathId=${pathId}` : `/learn/${taskId}`;
        return pathId ? `/learning-path/${pathId}` : '/dashboard';
      }
      case 'path-detail':
        return pathId ? `/learning-path/${pathId}` : '/learning-paths';
      case 'learning-state':
        return '/learning-state';
      case 'achievements':
        return '/user/achievements';
      case 'create-goal':
        return '/goal-conversation';
      default:
        return '/dashboard';
    }
  };
  const iconFor = (to?: string) => {
    if (to === 'path-detail') return { icon: svgLayers, bg: 'color-mix(in srgb, var(--blue) 12%, transparent)', ink: 'var(--blue-deep)' };
    if (to === 'achievements') return { icon: svgMedal2, bg: 'color-mix(in srgb, var(--accent) 13%, transparent)', ink: 'var(--purple-ink)' };
    if (to === 'create-goal') return { icon: svgPlus, bg: 'color-mix(in srgb, var(--cyan) 14%, transparent)', ink: '#3593b5' };
    if (to === 'learning-state') return { icon: svgBulb, bg: 'color-mix(in srgb, var(--amber) 16%, transparent)', ink: 'var(--amber-ink)' };
    if (to === 'continue-learning') return { icon: svgPlay, bg: 'rgba(49,177,111,.12)', ink: 'var(--green-ink)' };
    return { icon: svgHome, bg: 'color-mix(in srgb, var(--blue) 12%, transparent)', ink: 'var(--blue-deep)' };
  };
  const seen = new Set<string>();
  return list
    .map((item: Record<string, any>) => {
      const resolved = resolve(item?.to);
      return {
        title: String(item?.title || '继续学习'),
        desc: String(item?.desc || ''),
        action: String(item?.action || '前往'),
        resolved,
        ...iconFor(item?.to)
      };
    })
    .filter((a) => {
      // 去重（标题相同只留第一条）+ 过滤指向当前页的动作
      const key = a.title;
      if (seen.has(key) || a.resolved === '/learning-state') return false;
      seen.add(key);
      return true;
    })
    .slice(0, 1);
});

/* 预警行（skill 模式下追加展示） */
const warningRows = computed(() =>
  warnings.value.slice(0, 3).map((w) => {
    const isCritical = w.level === 'critical';
    return {
      title: w.title || '学习预警',
      message: w.message || w.suggestion || '',
      level: isCritical ? 'critical' : 'warning',
      bg: isCritical ? 'color-mix(in srgb, var(--red) 12%, transparent)' : 'color-mix(in srgb, var(--amber) 14%, transparent)',
      ink: isCritical ? 'var(--red-ink)' : 'var(--amber-ink)',
      icon: svgWarn
    };
  })
);
const svgBulb = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9 21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1H9v1zm3-19a7 7 0 0 0-4 12.74c.6.52 1 1.31 1 2.26v1h6v-1c0-.95.4-1.74 1-2.26A7 7 0 0 0 12 2z"/></svg>';
const svgWarn = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2 1 21h22L12 2zm0 6 7 12H5l7-12zm-1 4v3h2v-3h-2zm0 4v2h2v-2h-2z"/></svg>';

const suggestionCards = computed(() => {
  const cards: Array<{ title: string; message: string; level: string; bg: string; ink: string; icon: string; cta?: string; to?: string }> = [];
  const sug = current.value?.suggestion;
  if (sug?.message) {
    cards.push({
      title: '节奏建议',
      message: sug.message + (sug.action ? `（${sug.action}）` : ''),
      level: sug.level || 'info',
      bg: 'color-mix(in srgb, var(--blue) 12%, transparent)', ink: 'var(--blue-deep)', icon: svgBulb,
      cta: '去调整', to: '/learning-paths'
    });
  }
  for (const w of warnings.value.slice(0, 3)) {
    const isCritical = w.level === 'critical';
    cards.push({
      title: w.title || '学习预警',
      message: w.message || w.suggestion || '',
      level: isCritical ? 'critical' : 'warning',
      bg: isCritical ? 'color-mix(in srgb, var(--red) 12%, transparent)' : 'color-mix(in srgb, var(--amber) 14%, transparent)',
      ink: isCritical ? 'var(--red-ink)' : 'var(--amber-ink)',
      icon: svgWarn
    });
  }
  return cards;
});

/* ---------- 偏好 ---------- */
const preferenceItems = computed(() => {
  const items: Array<{ label: string; value: string }> = [];
  const narrative = learnerCenter.value?.profile?.narrativeInsights;
  if (narrative?.contentReceptionPattern) items.push({ label: '适合的方式', value: narrative.contentReceptionPattern });
  if (narrative?.practicePreferenceNote) items.push({ label: '练习偏好', value: narrative.practicePreferenceNote });
  if (narrative?.supportStyleNote) items.push({ label: '支持方式', value: narrative.supportStyleNote });
  return items;
});

const learnerCenter = ref<Record<string, any> | null>(null);
// P1 修复：各数据源失败标记（此前 .catch 吞错 → 错误伪装成无数据）
const currentLoadFailed = ref(false);
const warningsLoadFailed = ref(false);
const learnerCenterLoadFailed = ref(false);
const guidanceLoadFailed = ref(false);
const guidanceLoading = ref(false);

onMounted(() => {
  // 各数据源独立并发，互不阻塞（skill 引导最慢，不应拖住其他区块）
  void loadTrends();
  void loadSessions();
  // 复习台账 / 掌握分布 / 顶部「已掌握知识点」共用这两个既有接口
  void loadReviews();
  void loadMastery();

  metricsAPI.getCurrentState()
    .then((v) => { current.value = v as Record<string, any> | null; })
    .catch(() => { currentLoadFailed.value = true; });

  request.get('/state/warnings')
    .then((r) => {
      const w = unwrap<{ warnings?: Array<Record<string, any>> }>(r);
      warnings.value = w?.warnings ?? (Array.isArray(w) ? (w as unknown as Array<Record<string, any>>) : []);
    })
    .catch(() => { warningsLoadFailed.value = true; });

  request.get('/users/me/learner-center', { params: { scope: 'global' } })
    .then((r) => { learnerCenter.value = unwrap(r) as Record<string, any>; })
    .catch(() => { learnerCenterLoadFailed.value = true; });

  void loadGuidance();
});

/**
 * 拉取 skill 引导文案（最慢的一个数据源，独立于其他区块）。
 * 走查（2026-09-24）：网关慢调用可超过前端超时（实测一次 113.9s）→ 请求失败后
 * 页面此前会回落成「完成第一次学习后…」，对已有学习记录的学员是错误信息。
 * 现在失败只提示失败并可原地重试，不再冒充"没有数据"。
 */
function loadGuidance() {
  guidanceLoading.value = true;
  guidanceLoadFailed.value = false;
  return request.get('/adaptive-guidance/copy', { params: { view: 'learning-state' } })
    .then((r) => { guidance.value = unwrap(r) as Record<string, any> | null; })
    .catch(() => { guidanceLoadFailed.value = true; })
    .finally(() => { guidanceLoading.value = false; });
}
</script>

<style scoped>
/* wrapper 沉底：AI 提示与页脚一起贴近底部 */
.state__foot { margin-top: auto; }
.state__ai-note {
  display: flex; justify-content: center;
  padding: 10px 28px 4px;
}
.state__ai-note :deep(.ai-note) { font-size: 12px; opacity: 0.75; }

/* 原型 924：非学习台屏幕统一 880px 居中。原 1080px + `1fr + 300px` 侧栏栅格已撤——
   原型该屏是单列流，侧栏卡并入主列（见模板 .side 注释） */
.state__main {
  max-width: 880px; margin: 0 auto;
  padding: 24px 28px 48px;
  display: grid; gap: 16px;
}
/* hero 已撤（原型 1948-1953：该屏直接以 KPI 开头，无 h1 + 说明句）；
   .kicker 保留——侧栏两张卡（学习偏好 / 指标说明）还在用 */
.kicker { font-size: 12px; font-weight: 800; letter-spacing: .06em; color: var(--blue-deep); }

/* ---------- 顶部三张 KPI（原型 wf-kpis/wf-kpi，748-755）：等权 3 卡、gap 9px、居中排版 ---------- */
.kpis {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px 12px; flex-wrap: wrap;
}
.kpis__grid {
  flex: 1 1 460px; min-width: 0;
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px;
}
.kpis__loading { grid-column: 1 / -1; padding: 2px 0; }
.kpi {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal); box-shadow: var(--shadow-sm);
  padding: 13px 8px; display: grid; justify-items: center; gap: 2px; text-align: center;
}
.kpi strong {
  font-size: 22px; font-weight: 800; letter-spacing: -.02em;
  font-variant-numeric: tabular-nums; color: var(--ink);
}
/* 原型为 11px → 12px：本仓门禁基础作用域字号下限 12px（同个人中心 KPI 的取舍） */
.kpi span { font-size: 12px; color: var(--faint); }
/* 原 hero 的 ghost 按钮降为本行小入口，贴右（放不下时折到第二行右对齐） */
.kpis__link { flex: 0 0 auto; margin-left: auto; }

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal);
  box-shadow: var(--shadow-sm);
}
/* 2026-09-27 死 CSS 清理：.card-head / .muted 模板已无对应元素（卡头统一走 band__head） */
.btn-ghost {
  padding: 10px 18px; border-radius: var(--mk-radius-xl);
  border: 1px solid var(--line); background: var(--surface, #fff);
  font-size: 14px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}

/* ---------- 状态四项 meta（原体检卡 vitals 的去向） ----------
   原型该屏只认三张 KPI 卡（连续天数 / 本周分钟 / 已掌握知识点），原 1.25fr+3×1fr 的体检卡撤掉：
   整体状态 / 学习压力 / 掌握趋势 / 疲劳程度不删，降级成趋势卡内的单行状态条（卡内 meta）——
   图里画的就是这四个指标，放这张卡里口径自洽；分档胶囊与失败态沿用原 .metric__note 语言。 */
.vitals--meta {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px;
  padding: 0 0 12px; margin-bottom: 12px;
  border-bottom: 1px dashed var(--line);
}
.vitals__loading { flex: 1 1 100%; }
.vitals--meta .vitals__main,
.vitals--meta .vitals__sub {
  display: inline-flex; align-items: center; gap: 7px; min-width: 0;
}
.vitals--meta small { font-size: 12px; color: var(--faint); font-weight: 700; }
.vitals--meta b { font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; }
.vitals--meta b i { font-size: 12px; font-style: normal; font-weight: 600; color: var(--faint); }
.metric__note { width: fit-content; font-size: 12px; font-weight: 800; padding: 3px 9px; border-radius: var(--mk-radius-pill); }
/* 胶囊底色用「前景 ink × 表面」混色：暗色主题自动降饱和（外部评审：原 rgba 撞色在暗底上刺眼） */
.metric__note--green { color: var(--green-ink); background: color-mix(in srgb, var(--green-ink) 13%, var(--surface)); }
.metric__note--blue { color: var(--blue-deep); background: color-mix(in srgb, var(--blue-deep) 13%, var(--surface)); }
.metric__note--purple { color: var(--accent); background: color-mix(in srgb, var(--accent) 13%, var(--surface)); }
.metric__note--amber { color: var(--amber-ink); background: color-mix(in srgb, var(--amber-ink) 14%, var(--surface)); }
.metric__note--red { color: var(--red-ink); background: color-mix(in srgb, var(--red-ink) 13%, var(--surface)); }

/* ---------- 单列流（原型 924 + wf-screen）：主列 880px 居中，原 1fr + 300px 侧栏栅格撤掉 ---------- */
.state__grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
.state__col { display: grid; gap: 16px; }
/* P2-11：新用户（指标为空）时把「AI 调控建议」提到最前，作为首屏主内容；图表空态降级为「积累中」说明
   （原选择器 .band--suggest 随旧卡结构改名，2026-09-30 挂到现役的 wf-advisory 卡） */
.state__col--empty .advisory { order: -1; }

/* ---------- 趋势图 ----------
   2026-09-27 死 CSS 清理：.chart / .suggest 卡级容器模板已无（现役卡是 band），删除 */
/* 42/90 天窗口切换 → 原型 wf-filter 胶囊语言（841-846）：白底 + 1px line 描边，
   选中态去描边 + 蓝 12% 底，不再用灰底轨道 + 内嵌投影（那是分段控件的老语法） */
.seg { display: inline-flex; gap: 6px; }
.seg__item {
  min-height: 36px; padding: 7px 14px;
  border: 1px solid var(--line); background: var(--surface);
  border-radius: 999px;
  font: inherit; font-size: 13px; font-weight: 600; color: var(--muted); cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.seg__item:hover { color: var(--blue-deep); border-color: color-mix(in srgb, var(--blue) 35%, transparent); }
.seg__item--on {
  border-color: transparent;
  background: color-mix(in srgb, var(--blue) 12%, transparent);
  color: var(--blue-deep);
}

/* ---------- AI 建议 ---------- */
.suggest__list { display: grid; gap: 10px; }
.sug {
  display: grid; grid-template-columns: 38px 1fr auto;
  align-items: center; gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 13px;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.sug__icon { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; }
.sug__body strong { font-size: 13.5px; }
.sug__body p { margin: 3px 0 0; font-size: 12.5px; color: var(--muted); line-height: 1.6; }
.sug__cta {
  font-size: 12px; font-weight: 800; color: var(--blue-deep);
  border: 1px solid color-mix(in srgb, var(--blue) 40%, transparent);
  background: color-mix(in srgb, var(--blue) 6%, transparent);
  padding: 7px 13px; border-radius: var(--mk-radius-pill);
  cursor: pointer; white-space: nowrap;
}
.sug__cta:hover { background: color-mix(in srgb, var(--blue) 12%, transparent); }
/* 2026-09-27 死 CSS 清理：.sug--done / .sug__done 的「已完成」形态模板已无（level 只剩 info/warning/critical） */

/* ---------- AI 调控建议卡（原型 wf-advisory，788-793 / 1971-1982） ----------
   4px 琥珀左边条 + 琥珀星标 head + 正文 + 主次双按钮 + 成功回执行 + 次级区块（学习调控）。
   pad 走 16（同 .card band 的内边距节奏），左边条由 border-left 提供，故右侧/下方补 16。 */
.advisory {
  display: grid; gap: 11px;
  padding: 14px 16px 16px;
  border-left: 4px solid var(--amber);
}
.advisory__head {
  display: flex; align-items: center; gap: 7px;
  font-size: 12.5px; font-weight: 800; color: var(--amber-ink);
}
.advisory__head strong { font-size: 14px; }
.advisory__star { width: 15px; height: 15px; flex: 0 0 auto; }
/* 卡头右侧的来源标注（AI 生成 / 系统建议）：跟 head 同色会抢星标语义，压回 meta 灰 */
.advisory__head .band__meta { margin-left: auto; font-weight: 600; color: var(--faint); }
.advisory__body { display: grid; gap: 11px; }
.advisory__actions { display: flex; gap: 9px; flex-wrap: wrap; }
.advisory__done { margin: 0; font-size: 12.5px; font-weight: 700; color: var(--green-ink); }
/* 次级区块（学习调控）：与正文之间用分隔线分层，卡内再分一层，避免与建议正文糊在一起 */
.advisory__sub {
  display: grid; gap: 12px;
  margin-top: 2px; padding-top: 14px;
  border-top: 1px solid var(--line);
}
.advisory__subhead { display: flex; align-items: baseline; gap: 10px; }
.advisory__subhead strong { font-size: 14px; }
.advisory__subhead .band__meta { margin-left: auto; }

/* 主次双按钮（原型 wf-btn 279-286）：primary 蓝渐变 + 44 触控带，ghost 白底 line 描边 */
.adv-btn {
  display: inline-flex; align-items: center; justify-content: center;
  min-height: 44px; padding: 0 18px;
  border: 1px solid transparent; border-radius: var(--mk-radius-xl);
  font: inherit; font-size: 14px; font-weight: 700;
  cursor: pointer; white-space: nowrap;
  transition: transform 0.16s ease, background 0.16s ease, border-color 0.16s ease;
}
.adv-btn:disabled { cursor: default; opacity: 0.7; }
.adv-btn--primary {
  /* 实色 --blue（原蓝渐变退役）；30% 蓝色发光投影一并删除 */
  background: var(--blue);
  /* on-primary token（非硬编码 hex）：亮色下白字压深蓝，暗色下反向取深字压亮蓝 --mk-blue #5b8def */
  color: var(--text-on-primary);
}
.adv-btn--primary:not(:disabled):active { transform: scale(0.98); }
.adv-btn--ghost { background: var(--surface); border-color: var(--line); color: var(--muted); }
.adv-btn--ghost:not(:disabled):hover {
  border-color: color-mix(in srgb, var(--blue) 35%, transparent); color: var(--blue-deep);
}

/* ---------- 两行清单卡（原型 wf-reviewlist，794-799）：名称 + 84px 进度条 + 右对齐数值 ---------- */
.rlist__rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.rlist__row { display: grid; grid-template-columns: 1fr 84px 40px; align-items: center; gap: 10px; font-size: 13px; }
.rlist__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.rlist__pct {
  text-align: right; color: var(--faint); font-size: 12px; font-variant-numeric: tabular-nums;
}
/* 进度条原语（原型 wf-bar 267-268）：6px 轨（--bar-track）+ 蓝→青渐变填充 */
.wf-bar { height: 6px; border-radius: 99px; background: var(--bar-track, color-mix(in srgb, var(--line) 60%, transparent)); overflow: hidden; }
.wf-bar > i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--blue), var(--cyan)); }

/* ---------- 原侧栏（原型该屏单列流，无 300px 侧栏）：并入主列后不再吸顶——
   单列里 sticky 只会在滚动时把两张说明卡悬在内容上，压住下方的复习/掌握卡 ---------- */
.side { display: grid; gap: 12px; }
.sidecard { padding: 16px 18px; display: grid; gap: 10px; }
.pref, .legend { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.pref li { display: grid; gap: 2px; }
.pref strong { font-size: 13px; }
.pref span { font-size: 12.5px; color: color-mix(in srgb, var(--ink) 72%, var(--muted)); }
.legend li { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; color: color-mix(in srgb, var(--ink) 72%, var(--muted)); line-height: 1.65; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: 0 0 auto; }
.dot--green { background: #31b16f; }
.dot--blue { background: var(--blue); }
.dot--purple { background: var(--accent); }
.dot--amber { background: var(--amber); }

@media (max-width: 1100px) {
  .state__main { padding: 16px 14px 32px; }
  /* 42/90 天分段控件是触屏主入口之一：药丸高度抬到触控口径（容器本身已 36px 基线） */
  .seg__item { padding: 8px 12px; }
}
</style>

<style scoped>
/* 2026-09-27 死 CSS 清理：.metric__note--red 与上一块重复、.chart__controls 模板已无 */
.chart__loading { display: grid; justify-items: center; padding: 40px 0; }
.chart__retry {
  margin-top: 10px;
  min-height: 36px;
  font: inherit; font-size: 12px; font-weight: 800; color: var(--blue-deep);
  border: 1px solid color-mix(in srgb, var(--blue) 40%, transparent);
  background: color-mix(in srgb, var(--blue) 6%, transparent);
  padding: 7px 16px; border-radius: var(--mk-radius-pill); cursor: pointer;
}
.chart__retry:hover { background: color-mix(in srgb, var(--blue) 12%, transparent); }
.chart__empty {
  padding: 30px 0; text-align: center; color: var(--faint); font-size: 13px;
  border: 1px dashed var(--line); border-radius: var(--mk-radius-xl); background: var(--canvas, #fafcff);
}
.sug--critical { border-color: color-mix(in srgb, var(--red) 35%, transparent); }
.sug--warning { border-color: color-mix(in srgb, var(--amber) 35%, transparent); }
.state__main { width: 100%; }
</style>

<style scoped>
/* skill 引导块 */
.guide { display: grid; gap: 6px; }
.guide__title { margin: 0; font-size: 16px; letter-spacing: -0.01em; }
.guide__sub { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.65; }
/* 建议与调控互相引用（2026-09-27）：依据行把 AI 建议挂回到调控区的证据条目 */
.guide__evidence { margin: 0; font-size: 12px; color: var(--faint); line-height: 1.6; }
/* 说明句：警告优先（更具体），无警告时用副标——原来两者同屏 + 琥珀实底框，
   四层文本处理堆在一起显乱（2026-09-27 重排） */
.guide__sub--warn {
  display: inline-flex; align-items: flex-start; gap: 6px;
  color: var(--amber-ink);
}
.guide__sub--warn svg { flex: 0 0 auto; margin-top: 3px; }
.guide__foot {
  margin: 0;
  border-top: 1px dashed var(--line);
  padding-top: 10px;
  font-size: 12.5px; line-height: 1.7;
  color: color-mix(in srgb, var(--ink) 72%, var(--muted));
}
.suggest__list--warnings { border-top: 1px dashed var(--line); padding-top: 12px; }

/* ---------- AI 决策记录 ---------- */
/* 诊断依据（原「状态评审」，2026-09-27 移入调控区）：与 ctl 各段同一分隔语言 */
.ctl__review { margin-top: 16px; padding: 14px 0 0; border: 0; border-top: 1px solid var(--line); }
.review__toggle {
  width: 100%; min-height: 36px;
  /* font: inherit：h3 包 button 后，标题字号/字重由 h3 提供（button 默认不吃继承字体） */
  font: inherit;
  display: flex; align-items: center; gap: 8px;
  padding: 0; border: 0; background: none; cursor: pointer; text-align: left;
}
.review__toggle .band__chev { margin-left: auto; }
.review__body { margin-top: 10px; }
.review__title { margin: 0; font-size: 15px; }
.review__src { font-size: 12px; color: var(--faint, #6b7280); }
.review__narrative { margin: 8px 0 0; font-size: 13px; line-height: 1.6; }
.review__list { margin: 10px 0 0; padding-left: 16px; display: grid; gap: 8px; }
.review__item strong { display: block; font-size: 13px; }
.review__action { display: block; margin-top: 2px; font-size: 12px; color: var(--faint, #6b7280); }
/* ---------- 学习调控（2026-09-27）：待确认 / 已自动处理 / 已执行的调整 ---------- */
.ctl { display: grid; gap: 8px; }
.ctl + .ctl { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
.ctl__label { margin: 0; font-size: 12px; font-weight: 800; color: var(--faint); letter-spacing: 0.04em; }
.ctl__label b { margin-left: 6px; color: var(--blue); }
.ctl__empty { margin: 0; font-size: 12.5px; color: var(--faint); line-height: 1.6; }
.ctl-card {
  display: grid; gap: 8px;
  padding: 13px 15px;
  border: 1px solid color-mix(in srgb, var(--blue) 28%, var(--line));
  border-radius: 14px;
  background: color-mix(in srgb, var(--blue) 4%, var(--surface));
}
.ctl-card__head { display: flex; align-items: center; gap: 8px; }
.ctl-card__head time { margin-left: auto; font-size: 12px; color: var(--faint); white-space: nowrap; }
.ctl-card__merged { font-size: 12px; color: var(--amber-ink); }
.ctl-card__body { margin: 0; font-size: 13px; line-height: 1.65; color: var(--ink); }
.ctl-card__evidence { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.6; }
.ctl-card__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ctl-card__confirm {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 12.5px; color: var(--muted);
  padding: 9px 11px;
  border: 1px dashed var(--line); border-radius: var(--mk-radius-lg);
  background: var(--canvas, #fafcff);
}
.ctl-card__confirm > span { flex: 1; min-width: 0; }
.ctl-btn {
  min-height: 36px; padding: 0 14px;
  border: 1px solid var(--line); border-radius: var(--mk-radius-pill);
  background: var(--surface, #fff); color: var(--muted);
  font-size: 12.5px; font-weight: 700; cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}
.ctl-btn:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 30%, transparent); }
.ctl-btn--primary {
  border-color: transparent;
  /* 实色 --blue（原蓝渐变退役），hover 改为加深底色而非 brightness 滤镜 */
  background: var(--blue);
  color: #fff; font-weight: 800;
}
.ctl-btn--primary:not(:disabled):hover { color: #fff; background: var(--wf-color-primary-dark); border-color: transparent; }
.ctl-btn--primary:not(:disabled):active { transform: scale(0.98); }
.ctl-btn--primary:disabled { filter: saturate(0.4); cursor: default; }
.ctl-btn--ghost { border-color: transparent; background: transparent; }
.ctl__rows { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.ctl__rows li { display: flex; align-items: baseline; gap: 10px; }
.ctl__row-text { flex: 1; min-width: 0; font-size: 12.5px; color: color-mix(in srgb, var(--ink) 72%, var(--muted)); line-height: 1.6; }
.ctl__row-time { font-size: 12px; color: var(--faint); white-space: nowrap; }
.dec__tag { font-size: 12px; font-weight: 800; padding: 4px 10px; border-radius: var(--mk-radius-pill); white-space: nowrap; }
.dec__tag--blue { color: var(--blue-ink); background: color-mix(in srgb, var(--blue-deep) 12%, var(--surface)); }
.dec__tag--purple { color: var(--purple-ink); background: color-mix(in srgb, var(--purple-ink) 12%, var(--surface)); }
.dec__tag--cyan { color: #3593b5; background: color-mix(in srgb, var(--cyan) 12%, var(--surface)); }
.dec__tag--amber { color: var(--amber-ink); background: color-mix(in srgb, var(--amber-ink) 13%, var(--surface)); }
.dec__tag--green { color: var(--green-ink); background: color-mix(in srgb, var(--green-ink) 12%, var(--surface)); }
@media (max-width: 640px) {
  /* 确认调整是本页关键动作，触屏抬到 44 触控带（mobile:spec lt44 口径） */
  .ctl-card__actions .ctl-btn,
  .ctl-card__confirm .ctl-btn { min-height: 44px; flex: 1; }
  .ctl__rows li { flex-wrap: wrap; }
}
</style>

<style scoped>
.chart__empty strong { font-size: 14px; color: var(--muted); display: block; margin-bottom: 6px; }
.chart__empty p { margin: 0; font-size: 12.5px; color: var(--faint); }
/* 引导文案加载失败时的原地重试按钮 */
.guide-retry {
  margin-left: 8px; padding: 10px 12px; border-radius: var(--mk-radius-xl, 999px);
  border: 1px solid var(--line); background: var(--surface, #fff);
  font-size: 12.5px; font-weight: 700; color: var(--blue-deep, #1f57cc); cursor: pointer;
}
.guide-retry:disabled { opacity: .6; cursor: default; }
</style>

<style scoped>
/* ---------- intervals.icu 风格负荷图 ---------- */
.ff-legend {
  display: flex; align-items: center; flex-wrap: wrap; gap: 14px;
  font-size: 12px; color: var(--muted);
}
.ff-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 5px; }
.ff-dot--fitness { background: var(--blue); }
.ff-dot--fatigue { background: var(--accent); }
.ff-dot--lsb { background: #31b16f; }

/* ff-chart 现在承载 y 轴刻度与阈值标签的绝对定位层（原型 wf-trend__chart 757-762）→ 必须是定位上下文 */
.ff-chart { position: relative; width: 100%; }
.ff-chart svg { display: block; width: 100%; height: auto; }
/* y 轴刻度（原型 wf-trend__yaxis）：贴左侧 AXIS_W 留白（46/760 ≈ 6.05%），
   与 5 条网格线同位、右对齐，正好落在 grid 的 x1=plotX0 之外的空白里 */
.ff-yaxis { position: absolute; left: 0; top: 0; bottom: 0; width: 6.05%; pointer-events: none; }
.ff-yaxis span {
  position: absolute; right: 6px; transform: translateY(-50%);
  font-size: 12px; line-height: 1; color: var(--faint); font-variant-numeric: tabular-nums;
}
/* 阈值区间标签（原型 wf-trend__zones / __zonetag）：贴右缘、自带 surface 底压住曲线 */
.ff-zones { position: absolute; inset: 0; pointer-events: none; }
.ff-zonetag {
  position: absolute; right: 2px; transform: translateY(-50%);
  font-size: 12px; font-weight: 700; line-height: 1.1;
  color: var(--green-ink); background: var(--surface);
  padding: 0 4px; border-radius: 4px;
}
/* 背景柱 500 条上限的口径说明（见模板 ff-trunc） */
.ff-trunc { margin: 8px 0 0; font-size: 12px; color: var(--faint); }
.ff-bar { fill: color-mix(in srgb, var(--blue) 14%, transparent); }
.ff-grid line { stroke: var(--line); stroke-width: 1; opacity: 0.6; }
/* 状态阈值参考线（原型 wf-trend__zone 766）：绿 55% 透明 + 4/4 虚线，与实线曲线分层 */
.ff-zone {
  stroke: color-mix(in srgb, var(--green) 55%, transparent);
  stroke-width: 1; stroke-dasharray: 4 4;
  vector-effect: non-scaling-stroke;
}
.ff-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.ff-line--fitness { stroke: var(--blue); }
.ff-line--fatigue { stroke: var(--accent); }
.ff-line--lsb { stroke: #31b16f; }
.ff-cursor { stroke: color-mix(in srgb, var(--ink) 20%, transparent); stroke-width: 1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
.ff-pt { stroke: #fff; stroke-width: 2; }
.ff-pt--fitness { fill: var(--blue); }
.ff-pt--fatigue { fill: var(--accent); }
.ff-pt--lsb { fill: #31b16f; }

.ff-info {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px;
  font-size: 12.5px; color: var(--muted);
  border-top: 1px dashed var(--line);
  padding-top: 10px;
}
.ff-info b { color: var(--ink); }
.ff-info__fitness { color: var(--blue-deep); font-weight: 700; }
.ff-info__fatigue { color: var(--accent); font-weight: 700; }
</style>

<style scoped>
/* ===== 移动端密度（2026-09-24）=====
   判据：KPI 数字 16px（2026-09-24 用户指着统计卡数字说「数字也很大」后全站统一）、卡片内边距 12–16px、空态/加载留白 ≤32px。
   实测 390 下整页 3359px（最长的一页）。批19 起 KPI 卡墙改为体检卡（vitals），
   主数值桌面 34px、移动 24px 仍受密度口径约束。放在文件末尾：同权重下后出现者胜。 */
@media (max-width: 1100px) {
  /* 体检卡随原卡结构退役：.vitals__value / .vitals{padding} 两条移动规则已无对应元素（死 CSS 清理），
     现役的 .vitals--meta 是趋势卡内的单行状态条，不做卡级内边距 */
  /* 移动端单列堆叠，同宽卡片必须共用一条内容轨道：sidecard 原来横向 14 而
     band 都是 16，内容左缘落在 29/31 两条线上（2026-09-26 对齐走查）。
     只动横向，竖向 12 是它自己的紧凑节奏。（原 .chart / .suggest 死选择器已清） */
  .sidecard { padding: 12px 16px; }
  .chart__loading { padding: 28px 0; }
  .chart__empty { padding: 24px 0; }
  /* 分段控件（42/90 天）与 AI 建议的 CTA 实测 34px，抬到 36（mobile:spec lt36 门禁）。
     .seg 容器自带 3px 内边距会跟着长高，视觉上仍是同一个药丸。 */
  .seg__item {
    min-height: 36px;
    display: inline-flex;
    align-items: center;
  }
  .sug__cta {
    min-height: 36px;
    display: inline-flex;
    align-items: center;
  }
}

/* ---------- 卡片头（2026-09-27）：本页折叠按钮退役，卡头变静态标题；
   仅「诊断依据」保留 chevron 开合 ---------- */
.band { padding: 0; }
.band__head { display: flex; align-items: center; }
.band__title {
  flex: 1; min-width: 0;
  display: flex; align-items: baseline; gap: 10px;
  padding: 14px 16px;
  text-align: left;
}
.band__title strong, .band__title .kicker { font-size: 14px; }
.band__meta { font-size: 12px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.band__chev { flex: 0 0 auto; color: var(--faint); transition: transform 0.2s ease; }
.band__chev--open { transform: rotate(180deg); }
.band__extra { padding-right: 12px; }
.band__body { padding: 0 16px 16px; }
.band.sidecard .band__title { padding: 12px 16px; }
.band.sidecard .band__body { padding: 0 16px 14px; }

/* 卡头在 390 下会被挤爆（2026-09-26 用户侧对齐走查实测）：标题+副标独占一行、
   42/90 天分段控件落到第二行贴右缘（同权重下后出现者胜，必须放在本条块之后）。 */
@media (max-width: 1100px) {
  .band__head { flex-wrap: wrap; row-gap: 2px; }
  .band__title { flex: 1 1 100%; }
  /* 标题折行读作「本节知识 / 点」那种断词，比截断更难看，直接禁掉 */
  .band__title strong { white-space: nowrap; }
  .band__extra { margin-left: auto; }
}
</style>
