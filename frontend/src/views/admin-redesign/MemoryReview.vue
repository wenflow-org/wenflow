<template>
  <div class="mr mk-page mk-page--fill">
    <!-- ===== 列表态 / 明细态二选一 =====
         选中用户前：状态条 + KPI 区 + 用户列表（列表卡内部滚动）；
         选中用户后：整页让位给「该用户的记忆复盘」二级页（明细拿到整幅宽高）。
         旧版把明细塞在用户列表卡内部共用一条 flex 列：表网格 flex:1 被明细压成 0 高
         （一选用户列表整条消失），超出的 2000+px 又被 .mk-card 的 overflow:clip 裁掉，
         下半页永远滚不到。二级页形态与「用户与学习者 → 用户详情」「虚拟学习者 → 画像」一致。 -->
    <template v-if="!detail">
    <!-- 页头（newui/admin pagehead）：页名（悬停带口径长注）+ 作用域开关/刷新上移；
         原状态条整体退役 -->
    <MkPageHead
      title="记忆与复习观测"
      sub="遗忘曲线调度 · 到期积压、课内温故与概念归并审计"
      hint="记忆层（用户级、跨 path）：到期积压 · 课内温故配额 · 概念归并审计；归并默认观察模式，只记录建议，不动 memory_traces"
    >
      <template #actions>
        <!-- 作用域开关收在页头（原在「记忆层概览」卡头）：它切换的是整页口径，
             而卡片区读起来像「表格控件」。绝对值移到 KPI 区后页头只留身份 + 作用域 + 操作。 -->
        <label class="mk-status__scope" title="切换后整页重新统计：含虚拟学习者时，用户 / 痕迹 / 到期与归并队列一并纳入仿真账号">
          <input v-model="includeVirtual" type="checkbox" @change="refreshAll" />
          包含虚拟学习者
        </label>
        <button type="button" class="mk-btn mk-btn--sm" :disabled="loading" @click="refreshAll">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </template>
    </MkPageHead>
    <!-- 页头 KPI 区（2026-09-28）：原「状态条散文 3 数 + 概览卡 880px 构成条 + 四张队列卡」
         三处各说一遍同一批数。现在全站页头统一为 MkKpi 卡栅格（同总览/健康中心/成本分析形态），
         页级绝对值只在这里出现一次；口径说明进各卡 title，比例条由「占痕迹 N%」副行承担。 -->
    <section class="mk-kpi-grid">
      <MkKpi
        v-for="card in overviewCards"
        :key="card.label"
        :label="card.label"
        :value="card.value"
        :hint="card.hint"
        :tone="card.tone"
        :title="card.title"
      />
    </section>

    <!-- 到期时间轴 + 记忆强度分布（newui 原型 renderMemory 2029-2034 两卡 grid 原样移植：
         stageband 卡在前（1.5fr）、histo 卡在后（1fr），页头 KPI 之后、用户列表之前）。
         数据源 = adminMemoryTracesApi.list（GET /admin/memory-traces，后端注释即「观察复习调度状态
         与记忆保持率分布」）：逐条 dueAt → 六档到期带（已逾期/今天/明天/2/3/5 天后，distBand 判例 =
         OpsContent 状态分布卡：零值段跳过、图例恒六行）；retrievability（FSRS 可提取率）→ 五桶
         强度直方图（无强度数据的条目不进分母，不硬造）。窗口口径：后端上限 200 条（updatedAt 倒序），
         卡 meta 如实标注「窗口/非全量」（同 TeachingSessions 分布卡判例）；队列口径 = extractionCount>0
         （从未提取过的点不进复习队列，与后端 due 统计一致）。拉取失败或队列为空整块隐藏，不留空卡。 -->
    <section v-if="traceWindowReady" class="mr-bandgrid">
      <div class="mk-card">
        <div class="mk-card__head">
          <span class="mk-card__title">到期时间轴</span>
          <span class="mk-card__meta" :title="`复习队列 = 已被提取过的记忆痕迹（extractionCount>0）；窗口为最近 ${traceRows.length} 条痕迹（updatedAt 倒序），非全量`">按到期日聚合的复习点分布 · 共 {{ queueRows.length }} 个 · 最近 {{ traceRows.length }} 条窗口</span>
        </div>
        <div class="mr-dist__body">
          <div class="stageband" role="img" :aria-label="mrBandAria">
            <span
              v-for="seg in mrDueSegments"
              :key="seg.key"
              :style="{ width: seg.pct, background: seg.tone }"
              :title="`${seg.name} · ${seg.n}`"
            ></span>
          </div>
          <div class="stageband__legend">
            <div v-for="entry in mrDueBand" :key="entry.key" class="sbl" :title="entry.title">
              <span class="sbl__sw" :style="{ background: entry.tone }" aria-hidden="true"></span>
              <span class="sbl__name">{{ entry.name }}</span>
              <span class="sbl__n">{{ entry.n }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="mk-card">
        <div class="mk-card__head">
          <span class="mk-card__title">记忆强度分布</span>
          <span class="mk-card__meta" :title="`记忆强度 = FSRS 可提取率 retrievability；无 FSRS 状态的 ${mrStrengthPending} 条不进分母（不硬造）`">按记忆强度分档 · 平均 {{ mrAvgStrengthPct }}% · 有强度 {{ mrStrengthTotal }}/{{ queueRows.length }} 条</span>
        </div>
        <div class="mr-dist__body">
          <div class="histo" role="img" :aria-label="mrHistoAria">
            <div v-for="b in mrStrengthBuckets" :key="b.label" class="hcol">
              <span class="hval">{{ b.n }}</span>
              <span class="hbar" :style="{ height: b.h + 'px', background: b.tone }" :title="`${b.label} · ${b.n}`"></span>
              <span class="hcap">{{ b.label }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <h3 class="mk-card__title">用户列表</h3>
        <!-- 口径：totals.users 是后端全量统计，列表只取痕迹数倒序前 N 且暂无分页——
             两个数字必须同时给出，否则「页头 137 / 表下共 50」读起来像数据缺失 -->
        <span class="mk-card__meta" :title="`后端口径为全量有记忆痕迹用户；列表按痕迹数倒序只取前 ${rows.length} 名，暂无分页`">共 {{ totals.users }} 位有记忆痕迹用户（展示前 {{ rows.length }}）· 按痕迹数倒序</span>
      </div>
      <p v-if="error" class="mr__error">{{ error }}</p>
      <MockSkeletonTable v-if="loading && !rows.length" :cols="5" :rows="8" />
      <MkEmptyState v-else-if="!loading && !rows.length" title="暂无记忆痕迹数据" description="当前口径内还没有用户产生记忆痕迹。等学习者开始学习并完成概念提取后，这里会按痕迹数倒序列出用户。" />
      <!-- 用户列表（2026-09-27 由 10 列密表收敛；2026-09-28 收回表头）：
           行列表没有表头，右侧两个裸数字（到期积压 / 待人工看）读者无从判断含义。
           保留「只留要动手的信号、其余计数进明细卡」这个决定，只补回表头与排序键：
           用户 | 痕迹（本表倒序键）| 到期 | 需人工看 | 操作。
           原型 .tbl 自动布局：无 colgroup/无 fixed，列宽随内容、td nowrap（同 Users.vue 判例） -->
      <div v-else class="mk-table-scroll">
        <table class="mk-table mk-table--click">
          <thead>
            <tr>
              <th>用户</th>
              <th class="mk-num" title="该用户名下的记忆痕迹总数；本表按此列倒序">痕迹</th>
              <th class="mk-num" title="到该复习而未复习的痕迹数；条内小条 = 占该用户痕迹比例">到期</th>
              <th class="mk-num" title="像但不确定的归并候选，需人工确认，不会自动执行">需人工看</th>
              <th class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <!-- 原型 renderMemory：学习者行/「记忆点」按钮均 data-action="open-learner" → go("learner") 页。
                 行点击改跳学习者详情页（原型铁令：实体行跳页不开浮层）；「明细」钮保留页内复盘二级视图（记忆点子实体明细，原型允许形态）。 -->
            <tr
              v-for="row in rows"
              :key="row.userId"
              :class="{ 'mr__row--active': row.userId === selectedId }"
              tabindex="0"
              @click="openSubPage('learner', row.userId)"
              @keydown.enter.prevent="openSubPage('learner', row.userId)"
            >
              <td>
                <div class="mr__user">
                  <MkCellAvatar :name="row.name" :tone="row.isVirtualLearner ? 'virtual' : 'default'" />
                  <div class="mk-cell-main">
                    <strong>{{ row.name || '未命名' }}</strong>
                    <span class="mk-cell-sub">{{ shortId(row.userId) }}</span>
                  </div>
                  <MkVariantBadge v-if="row.isVirtualLearner" kind="virtual" />
                </div>
              </td>
              <td class="mk-num">{{ row.traces }}</td>
              <td class="mk-num">
                <span class="mr__due" :class="`mr__due--${dueTone(row)}`" :title="`到该复习而未复习 ${row.due} 条，占该用户痕迹 ${duePctOf(row)}%`">
                  <b>{{ row.due }}</b>
                  <span class="mr__due-bar" aria-hidden="true"><i :style="{ width: duePctOf(row) + '%' }"></i></span>
                </span>
              </td>
              <td class="mk-num">
                <span v-if="row.audit?.ambiguous" class="mr__need" :title="`${row.audit.ambiguous} 条归并候选需人工确认，不会自动执行`">{{ row.audit.ambiguous }}</span>
                <span v-else class="mk-na" title="没有待人工确认的归并候选">—</span>
              </td>
              <td class="mk-actions">
                <button type="button" class="mk-btn mk-btn--sm" @click.stop="openDetail(row.userId)">明细</button>
                <button type="button" class="mk-btn mk-btn--sm" :disabled="recomputingId === row.userId" title="对该用户手动跑一次记忆复盘，结果实时刷新；数据源为该用户全部学习路径下的记忆痕迹" @click.stop="recompute(row.userId)">{{ recomputingId === row.userId ? '观察中…' : '重新观察' }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    </template>

    <!-- ===== 明细态（二级页）===== -->
    <template v-else>
      <header class="mk-status" :class="`mk-status--${detailTone}`">
        <button type="button" class="mk-back" title="返回用户列表（Esc）" @click="closeDetail">← 用户列表</button>
        <span class="mk-status__sep"></span>
        <strong class="mk-status__title">记忆复盘 · {{ detail.user.name || '未命名' }}</strong>
        <span
          class="mk-status__meta"
          title="该用户名下记忆痕迹总览：到期 = 到该复习而未复习；同族重复 = 归一化键相同、措辞不同的痕迹（组 / 条）；从未提取 = 一直没被当作复习点接住过"
        >痕迹 {{ detail.summary.traces }} · 到期 {{ detail.summary.due }} · 同族重复 {{ detail.summary.duplicatedFamilies }} 组/{{ detail.summary.duplicatedTraces }} 条 · 从未提取 {{ detail.summary.neverExtracted }} · FSRS {{ detail.summary.withFsrsState }}</span>
        <span class="mk-status__actions">
          <button type="button" class="mk-status__action" title="复制该用户记忆复盘的深链（可分享 / 收藏，打开即落位）" @click="copyDeepLink">复制深链</button>
          <button type="button" class="mk-status__action" :disabled="recomputingId === selectedId" title="对该用户手动跑一次记忆复盘，结果实时刷新；数据源为该用户全部学习路径下的记忆痕迹" @click="recompute(selectedId)">{{ recomputingId === selectedId ? '观察中…' : '重新观察' }}</button>
        </span>
      </header>

      <div class="mr__detail">
      <!-- 1. 课内温故计划：本节该接几个 + 每个记忆点的负担与来源 -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">课内温故计划</h3>
          <span class="mk-card__meta" title="负担单位由后端按学习者状态动态校准；排队中 = 还没排进本节队列的到期痕迹">本节该接几个 · 按负担预算排队</span>
        </div>

        <!-- 温故计划整块按 detail.reviewPlan 有无渲染：reviewPlan=null 时原来只剩一个裸标题 -->
        <template v-if="detail.reviewPlan">
          <div class="mr__strip"><MkStatStrip :items="planKpiItems" /></div>

          <div v-if="detail.reviewPlan?.items.length" class="mk-table-scroll">
          <table class="mk-table">
            <thead>
              <tr><th>概念</th><th class="mk-num">记忆强度</th><th>到期原因</th><th class="mk-num">负担</th><th>负担因子</th><th>来源路径</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in detail.reviewPlan.items" :key="item.conceptKey">
                <td><strong>{{ item.label }}</strong><small class="mr__sub">{{ item.conceptKey }}</small></td>
                <td class="mk-num">
                  <span class="mr-pct" :class="{ 'mr-pct--warn': item.retention < 0.7 }" :title="`记忆强度 ${Math.round(item.retention * 100)}%，低于 70% 优先安排`">
                    <b>{{ Math.round(item.retention * 100) }}%</b>
                    <span class="mr-pct__bar" aria-hidden="true"><i :style="{ width: Math.round(item.retention * 100) + '%' }"></i></span>
                  </span>
                </td>
                <td>{{ item.reason }}</td>
                <td class="mk-num">{{ item.load }}</td>
                <td class="mr__sub">{{ item.loadFactors.join('、') || '—' }}</td>
                <td>{{ item.originPathTitle || '—' }}</td>
              </tr>
            </tbody>
          </table>
          </div>
          <p v-else class="mr__sub">当前没有需要在本节接住的记忆点。</p>

          <div v-if="detail.reviewPlan?.relearnSuggestions.length" class="mr__warn">
            <strong>建议回路径重学：</strong>
            <span v-for="item in detail.reviewPlan.relearnSuggestions" :key="item.conceptKey" class="mr__chip">
              {{ item.label }}（连续 {{ item.consecutiveAgain }} 次没接上）
            </span>
          </div>
        </template>
        <p v-else class="mr__sub">暂无温故计划：该用户名下还没有可安排的记忆痕迹。</p>
      </section>

      <!-- 2. 到期清单预览：到期积压的证据（谁先到期、掌握多少） -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">到期清单预览</h3>
          <span class="mk-card__meta" title="按记忆强度升序：越靠前越该先复习；列表最多前 20 条">前 20 · 记忆强度升序</span>
        </div>
        <div v-if="detail.duePreview.length" class="mk-table-scroll">
          <table class="mk-table">
          <thead><tr><th>概念</th><th class="mk-num">记忆强度</th><th class="mk-num">掌握</th><th class="mk-num">提取次数</th><th>来源</th><th>到期时间</th></tr></thead>
          <tbody>
            <tr v-for="trace in detail.duePreview" :key="trace.conceptKey">
              <!-- 原型记忆明细表首列 = 知识点 strong；同族重复/归并建议首列是裸 key（无人类可读
                   label），维持 mr__sub 降档，不冒充正文 -->
              <td><strong>{{ trace.label }}</strong></td>
              <td class="mk-num">
                <span class="mr-pct" :class="{ 'mr-pct--warn': trace.retention < 0.7 }" :title="`记忆强度 ${Math.round(trace.retention * 100)}%`">
                  <b>{{ Math.round(trace.retention * 100) }}%</b>
                  <span class="mr-pct__bar" aria-hidden="true"><i :style="{ width: Math.round(trace.retention * 100) + '%' }"></i></span>
                </span>
              </td>
              <td class="mk-num">
                <span class="mr-pct" :title="`掌握 ${Math.round(trace.masteryScore * 100)}%`">
                  <b>{{ Math.round(trace.masteryScore * 100) }}%</b>
                  <span class="mr-pct__bar mr-pct__bar--blue" aria-hidden="true"><i :style="{ width: Math.round(trace.masteryScore * 100) + '%' }"></i></span>
                </span>
              </td>
              <td class="mk-num">{{ trace.extractionCount }}</td>
              <td class="mr__sub">{{ trace.source }}</td>
              <td>{{ trace.dueAt ? new Date(trace.dueAt).toLocaleString() : '—' }}</td>
            </tr>
          </tbody>
        </table>
        </div>
        <MkEmptyState v-else title="当前没有到期点" description="该用户的记忆痕迹都还没到复习时间；到期后会按记忆强度升序列在这里（前 20 条）。" />
      </section>

      <!-- 3. 同族重复：措辞不同、说的是同一件事（归并的输入） -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">同族重复</h3>
          <span class="mk-card__meta" title="归一化键相同、措辞不同的痕迹：是「过多过杂」的直接证据，可用下方归并收拢">「过多过杂」的直接证据</span>
        </div>
        <p v-if="!detail.duplicatedFamilies.length" class="mr__sub">没有同族重复。</p>
        <div v-else class="mk-table-scroll">
          <table class="mk-table">
          <thead><tr><th>族（归一化键）</th><th class="mk-num">条数</th><th>成员</th></tr></thead>
          <tbody>
            <tr v-for="family in detail.duplicatedFamilies" :key="family.family">
              <!-- 归一化键没有人类可读 label（后端只回 key）→ 同 负担因子 口径降为 sub，不冒充正文 -->
              <td class="mr__sub">{{ family.family }}</td>
              <td class="mk-num">{{ family.size }}</td>
              <td class="mr__sub">
                <div v-for="member in family.members" :key="member.conceptKey">
                  {{ member.conceptKey }}（提取 {{ member.extractionCount }} · 掌握 {{ Math.round(member.masteryScore * 100) }}%）
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </section>

      <!-- 4. 概念归并审计：可写动作（勾选执行 / 回滚），默认观察模式 -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">概念归并审计</h3>
          <span class="mk-card__meta">
            <template v-if="detail.audit">{{ detail.audit.mode }} 模式 · {{ timeAgo(detail.audit.generatedAt) }}</template>
            <template v-else>尚未观察（点「重新观察」跑一次）</template>
          </span>
        </div>
        <!-- 审计计数（批E）：卡头 6 计数平摊 → 处理队列四格（与概览带同一语言） -->
        <div v-if="detail.audit" class="mr-audit-queue">
          <div class="mr-audit-queue__item">
            <b>{{ detail.audit.stats.candidates }}</b><span>候选</span>
          </div>
          <div class="mr-audit-queue__item">
            <b>{{ detail.audit.stats.proposed }}</b><span>建议</span>
          </div>
          <div class="mr-audit-queue__item" :class="{ 'mr-audit-queue__item--hot': detail.audit.stats.autoApplicable > 0 }">
            <b>{{ detail.audit.stats.autoApplicable }}</b><span>可自动</span>
          </div>
          <div class="mr-audit-queue__item" :class="{ 'mr-audit-queue__item--hot': detail.audit.stats.ambiguous > 0 }">
            <b>{{ detail.audit.stats.ambiguous }}</b><span>需人工看</span>
          </div>
          <div class="mr-audit-queue__item mr-audit-queue__item--quiet">
            <b>{{ detail.audit.stats.applied }}<i>/{{ detail.audit.stats.deleted }}</i></b><span>已执行 / 删除</span>
          </div>
        </div>

        <template v-if="detail.audit">
          <h4 class="mr__h4">
            归并建议（canonical ← aliases）
            <span class="mr__sub-inline">
              勾选后执行；默认只勾选「可自动执行」的（把握度 + 词面闸门都过）。
              执行会改动该用户的 memory_traces，但会留整行前后快照，可回滚。
            </span>
          </h4>
          <div v-if="detail.audit.proposals.length" class="mr__bulk">
            <button type="button" class="mk-btn mk-btn--sm" @click="selectAllApplicable">全选可自动执行</button>
            <button type="button" class="mk-btn mk-btn--sm" @click="clearSelection">清空</button>
            <button
              type="button"
              class="mk-btn mk-btn--sm mk-btn--danger-ghost"
              :disabled="busy || selectedKeys.length === 0"
              @click="applySelected"
            >执行选中（{{ selectedKeys.length }}）</button>
            <span v-if="selectedNeedsReview.length" class="mr__warn-inline">
              {{ selectedNeedsReview.length }} 条属于「需人工确认」，执行前请先看清
            </span>
          </div>
          <div v-if="detail.audit.proposals.length" class="mk-table-scroll">
          <table class="mk-table">
            <thead>
              <tr>
                <th class="mr__th-check">选择</th>
                <th>规范键</th><th>别名</th><th class="mk-num">把握度</th><th class="mk-num">词面相似</th>
                <th>可自动执行</th><th>理由</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="proposal in detail.audit.proposals" :key="proposal.canonical">
                <td>
                  <input
                    type="checkbox"
                    :checked="selected[proposal.canonical] === true"
                    :aria-label="`勾选执行归并：${proposal.canonical}${proposal.autoApplicable ? '' : '（需人工确认）'}`"
                    @change="toggleSelect(proposal.canonical, proposal.autoApplicable)"
                  />
                </td>
                <td class="mr__sub">{{ proposal.canonical }}</td>
                <td class="mr__sub">{{ proposal.aliases.join(' / ') }}</td>
                <td class="mk-num">
                  <span class="mr-pct" :title="`把握度 ${Math.round(proposal.confidence * 100)}%`">
                    <b>{{ Math.round(proposal.confidence * 100) }}%</b>
                    <span class="mr-pct__bar mr-pct__bar--blue" aria-hidden="true"><i :style="{ width: Math.round(proposal.confidence * 100) + '%' }"></i></span>
                  </span>
                </td>
                <td class="mk-num">
                  <span class="mr-pct" :class="{ 'mr-pct--warn': !proposal.autoApplicable }" :title="`词面相似 ${Math.round(proposal.lexicalSimilarity * 100)}%${proposal.autoApplicable ? '' : '（未过词面闸门）'}`">
                    <b>{{ Math.round(proposal.lexicalSimilarity * 100) }}%</b>
                    <span class="mr-pct__bar" aria-hidden="true"><i :style="{ width: Math.round(proposal.lexicalSimilarity * 100) + '%' }"></i></span>
                  </span>
                </td>
                <td>
                  <!-- 词面闸门结果用胶囊（原型记忆域 pill 状态词汇；与上方审计队列「可自动/需人工看」同标签） -->
                  <span
                    class="mk-badge"
                    :class="proposal.autoApplicable ? 'mk-badge--ok' : 'mk-badge--warn'"
                    :title="proposal.autoApplicable ? '把握度 + 词面闸门都过，默认已勾选' : '未过词面闸门或把握度不足，勾选后需人工确认'"
                  >{{ proposal.autoApplicable ? '可自动' : '需人工确认' }}</span>
                </td>
                <td class="mr__sub">{{ proposal.rationale || '—' }}</td>
              </tr>
            </tbody>
          </table>
          </div>
          <p v-else class="mr__sub">本次没有达到把握度阈值的归并建议。</p>

          <h4 class="mr__h4">需人工看（ambiguous，不会被执行）</h4>
          <div v-if="detail.audit.ambiguous.length" class="mk-table-scroll">
          <table class="mk-table">
            <thead><tr><th>A</th><th>B</th><th>理由</th></tr></thead>
            <tbody>
              <tr v-for="(item, index) in detail.audit.ambiguous" :key="`${item.a}-${item.b}-${index}`">
                <td>{{ item.a }}</td>
                <td>{{ item.b }}</td>
                <td class="mr__sub">{{ item.reason || '—' }}</td>
              </tr>
            </tbody>
          </table>
          </div>
          <p v-else class="mr__sub">没有待人工确认项。</p>

          <h4 class="mr__h4">已执行归并（可回滚 · 按次留档）</h4>
          <div v-if="rollbackableMerges.length" class="mk-table-scroll">
          <table class="mk-table">
            <thead><tr><th>规范键</th><th>别名</th><th class="mk-num">删除条数</th><th>执行时间</th><th></th></tr></thead>
            <tbody>
              <tr v-for="merge in rollbackableMerges" :key="merge.mergeId || `${merge.canonical}-${merge.appliedAt}`">
                <td class="mr__sub">{{ merge.canonical }}</td>
                <td class="mr__sub">{{ merge.aliases.join(' / ') }}</td>
                <td class="mk-num">{{ merge.deletedRows }}</td>
                <td>{{ new Date(merge.appliedAt).toLocaleString() }}</td>
                <td>
                  <button type="button" class="mk-btn mk-btn--sm" :disabled="busy" @click="rollbackOne(merge.canonical)">回滚</button>
                </td>
              </tr>
            </tbody>
          </table>
          </div>
          <p v-else class="mr__sub">没有可回滚的归并。</p>
          <p v-if="legacyWindowOnlyMerges.length" class="mr__sub">
            另有 {{ legacyWindowOnlyMerges.length }} 条早期归并：凭据只在审计窗口内（没有长期留档，页面内暂不支持回滚，如需回滚请联系管理员）——
            {{ legacyWindowOnlyMerges.map((m) => m.canonical).slice(0, 3).join('、') }}
          </p>
          <p v-if="rolledBackMerges.length" class="mr__sub">
            已回滚 {{ rolledBackMerges.length }} 条（保留凭据痕迹，不再重复回滚）：
            {{ rolledBackMerges.map((m) => m.canonical).slice(0, 3).join('、') }}
          </p>
        </template>
      </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { adminMemoryReviewApi, adminMemoryTracesApi } from '@/api/adminApi'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkStatStrip from '@/components/mk/MkStatStrip.vue'
import MkCellAvatar from '@/components/mk/MkCellAvatar.vue'
import MkVariantBadge from '@/components/mk/MkVariantBadge.vue'
import MockSkeletonTable from './SkeletonTable.vue'
import type { MkStatItem } from '@/components/mk/MkStatStrip.vue'
import { askConfirm } from './useConfirm'
import { useEscape } from './useEscape'
import { openSubPage } from './store'
import { toast } from '@/utils/toast'
import { errMsg, shortId, timeAgo } from './live'

interface AuditUserSummary {
  mode: string
  generatedAt: string
  candidates: number
  proposed: number
  autoApplicable: number
  ambiguous: number
  drops: number
  applied: number
  deleted: number
}

interface OverviewRow {
  userId: string
  name: string | null
  email: string | null
  isVirtualLearner: boolean
  traces: number
  due: number
  audit: AuditUserSummary | null
  /** 按次留档的归并凭据计数（权威；审计滚动窗口之外的历史归并也计入） */
  merges?: { rollbackable: number; rolledBack: number }
}

interface AppliedMergeView {
  mergeId: string | null
  canonical: string
  aliases: string[]
  appliedAt: string
  rolledBackAt: string | null
  deletedRows: number
}

/** 明细响应类型（P3 量力补齐）：只声明模板/脚本实际读取的字段，后端多余字段不声明 */
interface ReviewPlanItem {
  conceptKey: string
  label: string
  retention: number
  reason?: string
  load: number
  loadFactors: string[]
  originPathTitle?: string | null
  consecutiveAgain?: number
}

interface ReviewDetail {
  user: { name: string | null }
  summary: {
    traces: number
    due: number
    duplicatedFamilies: number
    duplicatedTraces: number
    neverExtracted: number
    withFsrsState: number
  }
  reviewPlan: {
    budget: number
    usedLoad: number
    backlogCount: number
    successRate: number | null
    items: ReviewPlanItem[]
    relearnSuggestions: ReviewPlanItem[]
    daily?: { usedLoad?: number; limitLoad?: number; remainingLoad?: number } | null
    tomorrowCount?: number | null
  } | null
  audit: {
    mode: string
    generatedAt: string
    stats: { candidates: number; proposed: number; autoApplicable: number; ambiguous: number; applied: number; deleted: number }
    proposals: Array<{ canonical: string; aliases: string[]; confidence: number; lexicalSimilarity: number; autoApplicable: boolean; rationale?: string | null }>
    ambiguous: Array<{ a: string; b: string; reason?: string | null }>
  } | null
  appliedMerges?: {
    rollbackable: AppliedMergeView[]
    rolledBack: AppliedMergeView[]
    legacyWindowOnly: AppliedMergeView[]
  }
  duplicatedFamilies: Array<{ family: string; size: number; members: Array<{ conceptKey: string; extractionCount: number; masteryScore: number }> }>
  duePreview: Array<{ conceptKey: string; label: string; retention: number; masteryScore: number; extractionCount: number; source?: string | null; dueAt?: string | null }>
}

const rollbackableMerges = computed<AppliedMergeView[]>(() => detail.value?.appliedMerges?.rollbackable ?? [])
const rolledBackMerges = computed<AppliedMergeView[]>(() => detail.value?.appliedMerges?.rolledBack ?? [])
const legacyWindowOnlyMerges = computed<AppliedMergeView[]>(() => detail.value?.appliedMerges?.legacyWindowOnly ?? [])

const loading = ref(false)
const busy = ref(false)
const error = ref('')
const includeVirtual = ref(false)
const rows = ref<OverviewRow[]>([])
/** 明细态状态点：该用户有到期积压 = 需关注（与列表态同一语义，不猜） */
const detailTone = computed<'ok' | 'warn' | 'muted'>(() => (!detail.value ? 'muted' : detail.value.summary.due > 0 ? 'warn' : 'ok'))
const totals = ref({
  users: 0,
  traces: 0,
  due: 0,
  usersWithAudit: 0,
  proposed: 0,
  autoApplicable: 0,
  ambiguous: 0,
  applied: 0,
  deleted: 0
})

/* ---- 页头 KPI 区（2026-09-28 收口后的派生） ---- */
const duePct = computed(() => (totals.value.traces ? Math.round((totals.value.due / totals.value.traces) * 100) : 0));

/* ===== 到期时间轴 + 记忆强度分布（newui 原型 renderMemory dueBand/distBand + sBuckets/histo 移植）=====
   数据窗口 = adminMemoryTracesApi.list（GET /admin/memory-traces，后端上限 200 条、updatedAt 倒序）。
   队列口径 = extractionCount > 0 且 dueAt 非空（从未提取过的点不进复习队列，与后端 due 统计一致）。
   六档到期带按 dueAt 与今天 0 点的日差分桶：桶名 = 起始日（「3天后」= 3–4 天，「5天后」= 5 天及以远）；
   五桶强度直方图只收 retrievability（FSRS 可提取率）非空的条目——无强度数据的条目不进分母。 */

/** GET /admin/memory-traces 行（只声明本页用到的字段，后端多余字段不声明） */
interface AdminTraceRow {
  id: string
  userId: string
  conceptKey: string
  label: string | null
  extractionCount: number
  dueAt: string | null
  retrievability: number | null
}

const traceRows = ref<AdminTraceRow[]>([])
const traceFailed = ref(false)
let traceSeq = 0

async function loadTraceWindow() {
  const seq = ++traceSeq
  traceFailed.value = false
  try {
    const res: any = await adminMemoryTracesApi.list({ limit: 200, includeVirtual: includeVirtual.value })
    if (seq !== traceSeq) return // 已有更新的窗口请求在途/完成：丢弃过期响应
    const body = res.data?.data ?? res.data ?? {}
    traceRows.value = Array.isArray(body.rows) ? body.rows : []
  } catch {
    if (seq !== traceSeq) return
    traceFailed.value = true // 窗口拉取失败 → 整块静默隐藏（同 OpsContent pathBand 判例），不阻塞页面
  }
}

const queueRows = computed(() => traceRows.value.filter((row) => row.extractionCount > 0 && !!row.dueAt))

/* 原型 tone 对照（OpsContent 移植判例口径）：bad→--mk-red、warn→--mk-amber、brand→--mk-blue、
   #5b8def（2 天后）→ --mk-purple（--mk-* 内最接近的浅蓝紫，避免与「明天」的品牌蓝撞段）、
   ok→--mk-green、faint→--mk-faint */
const MR_DUE_BAND: Array<{ key: string; name: string; tone: string; title: string }> = [
  { key: 'over', name: '已逾期', tone: 'var(--mk-red)', title: '到期时间早于今天' },
  { key: 'today', name: '今天', tone: 'var(--mk-amber)', title: '今天内到期' },
  { key: 'tmrw', name: '明天', tone: 'var(--mk-blue)', title: '明天到期' },
  { key: 'd2', name: '2天后', tone: 'var(--mk-purple)', title: '2 天后到期' },
  { key: 'd3', name: '3天后', tone: 'var(--mk-green)', title: '3–4 天后到期' },
  { key: 'd5', name: '5天后', tone: 'var(--mk-faint)', title: '5 天后及以远到期' }
]

/** 到期日差（天）：按本地日历日取整（UTC 归一，免夏令时/跨日误差），负 = 已逾期 */
function dayIndexFromToday(dueAt: string, epoch: Date): number {
  const due = new Date(dueAt)
  const a = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate())
  const b = Date.UTC(epoch.getFullYear(), epoch.getMonth(), epoch.getDate())
  return Math.round((a - b) / 86400000)
}

const mrDueBand = computed(() => {
  const epoch = new Date()
  const counts = MR_DUE_BAND.map(() => 0)
  for (const row of queueRows.value) {
    const idx = dayIndexFromToday(row.dueAt as string, epoch)
    // 日差 → 桶位（桶名 = 起始日，尾部并档）：负 = 已逾期；0/1/2 = 今天/明天/2天后；
    // 3–4 归「3天后」桶；≥5 归「5天后」桶
    const bucket = idx < 0 ? 0 : idx <= 2 ? idx + 1 : idx <= 4 ? 4 : 5
    counts[bucket] += 1
  }
  return MR_DUE_BAND.map((def, i) => ({ ...def, n: counts[i] }))
})

/* 段宽 = n / 合计（原型 distBand 口径，合计为 0 时按 1 兜底）；零值段不渲染，图例恒六行 */
const mrBandTotal = computed(() => mrDueBand.value.reduce((sum, entry) => sum + entry.n, 0))
const mrDueSegments = computed(() => {
  const total = mrBandTotal.value || 1
  return mrDueBand.value
    .filter((entry) => entry.n > 0)
    .map((entry) => ({ key: entry.key, name: entry.name, n: entry.n, tone: entry.tone, pct: `${(entry.n / total) * 100}%` }))
})
const mrBandAria = computed(() => `到期时间轴：${mrDueBand.value.map((entry) => `${entry.name} ${entry.n}`).join(' · ')}`)

/* 原型 sBuckets 原样移植：边界 min 含、max 不含（0.2 归 20–39%，0.8 归 80–99%）；上限 1.01 兜住 100% */
const MR_STRENGTH_BUCKETS = [
  { label: '0–19%', min: 0, max: 0.2, tone: 'var(--mk-red)' },
  { label: '20–39%', min: 0.2, max: 0.4, tone: 'var(--mk-red)' },
  { label: '40–59%', min: 0.4, max: 0.6, tone: 'var(--mk-amber)' },
  { label: '60–79%', min: 0.6, max: 0.8, tone: 'var(--mk-blue)' },
  { label: '80–99%', min: 0.8, max: 1.01, tone: 'var(--mk-green)' }
]

const mrStrengthRows = computed(() => queueRows.value.filter((row) => typeof row.retrievability === 'number'))
const mrStrengthTotal = computed(() => mrStrengthRows.value.length)
const mrStrengthPending = computed(() => queueRows.value.length - mrStrengthTotal.value)

const mrStrengthBuckets = computed(() => {
  const counts = MR_STRENGTH_BUCKETS.map(() => 0)
  for (const row of mrStrengthRows.value) {
    const value = row.retrievability as number
    const idx = MR_STRENGTH_BUCKETS.findIndex((bucket) => value >= bucket.min && value < bucket.max)
    if (idx >= 0) counts[idx] += 1
  }
  const maxB = Math.max(...counts, 1)
  return MR_STRENGTH_BUCKETS.map((bucket, i) => ({
    ...bucket,
    n: counts[i],
    h: Math.max(6, Math.round((counts[i] / maxB) * 100)) // 原型公式：零桶/极小桶压到 6px 起步
  }))
})

const mrAvgStrengthPct = computed(() => {
  const rows = mrStrengthRows.value
  if (!rows.length) return 0
  return Math.round((rows.reduce((sum, row) => sum + (row.retrievability as number), 0) / rows.length) * 100)
})
const mrHistoAria = computed(() => `记忆强度分布：${mrStrengthBuckets.value.map((bucket) => `${bucket.label} ${bucket.n}`).join(' · ')}`)

/* 窗口拉取失败或队列为空 → 整块隐藏（不留空卡；失败同 OpsContent pathBandReady 判例静默） */
const traceWindowReady = computed(() => !traceFailed.value && queueRows.value.length > 0)

interface OverviewCard {
  label: string
  value: string | number
  hint: string
  title: string
  tone?: 'ok' | 'warn' | 'bad' | ''
}

/** 页级绝对值单一来源：用户 / 痕迹 / 到期 / 归并队列都只在 KPI 区出现一次（原状态条散文与
 *  概览卡 legend 各重说一遍）。到期与需人工看是运营可行动项，>0 才抬琥珀；其余保持中性墨色。 */
const overviewCards = computed<OverviewCard[]>(() => {
  const t = totals.value;
  return [
    {
      label: '用户',
      value: t.users,
      hint: '有记忆痕迹',
      title: '后端口径为全量有记忆痕迹用户；是否含虚拟学习者随状态条开关'
    },
    {
      label: '记忆痕迹',
      value: t.traces,
      hint: '跨全部学习路径',
      title: '记忆层痕迹总数（用户级、跨该用户全部 path）'
    },
    {
      label: '当前到期',
      value: t.due,
      hint: t.traces ? `占痕迹 ${duePct.value}%` : '暂无痕迹',
      tone: t.due > 0 ? 'warn' : '',
      title: `到该复习而未复习 ${t.due} 条，占全部痕迹 ${duePct.value}%`
    },
    {
      label: '需人工看',
      value: t.ambiguous,
      hint: '归并候选 · 不自动执行',
      tone: t.ambiguous > 0 ? 'warn' : '',
      title: '像但不确定的归并候选，需人工确认，不会自动执行'
    },
    {
      label: '待归并建议',
      value: t.proposed,
      hint: `可自动 ${t.autoApplicable} · 已执行 ${t.applied}/${t.deleted}`,
      title: '模型给出的同义候选；「可自动」= 把握度 + 词面闸门都过；「已执行 / 删除」留快照可回滚'
    }
  ];
});

/** 到期压力档：0=安静；占痕迹 ≥50% 或绝对数 ≥12 = 重压（红）；其余 = 提醒（琥珀） */
function dueTone(row: OverviewRow): 'none' | 'warn' | 'high' {
  if (!row.due) return 'none';
  const pct = row.traces ? (row.due / row.traces) * 100 : 100;
  return pct >= 50 || row.due >= 12 ? 'high' : 'warn';
}
function duePctOf(row: OverviewRow): number {
  return row.traces ? Math.min(Math.round((row.due / row.traces) * 100), 100) : row.due ? 100 : 0;
}
/** 明细 · 课内温故计划 KPI 条（MkStatStrip，与虚拟学习者页头同一组件；hint 收进 title） */
const planKpiItems = computed<MkStatItem[]>(() => {
  const plan = detail.value?.reviewPlan
  if (!plan) return []
  return [
    { key: 'budget', label: '负担预算', value: plan.budget, title: '负担单位，动态校准' },
    { key: 'used', label: '已占用', value: plan.usedLoad },
    { key: 'items', label: '本节接几个', value: plan.items.length },
    { key: 'backlog', label: '排队中', value: plan.backlogCount, tone: plan.backlogCount > 15 ? 'warn' : '' },
    {
      key: 'success',
      label: '检索成功率',
      value: plan.successRate === null ? '—' : `${Math.round(plan.successRate * 100)}%`,
      title: '<70% 收缩预算 / >90% 扩张'
    },
    { key: 'relearn', label: '需回路径重学', value: plan.relearnSuggestions.length, tone: 'warn', title: '连续没接上，已退出队列' },
    {
      key: 'daily',
      label: '今日额度',
      value: `${plan.daily?.usedLoad ?? 0}/${plan.daily?.limitLoad ?? '—'}`,
      tone: (plan.daily?.remainingLoad ?? 1) <= 0 ? 'warn' : '',
      title: '跨会话共享，用完顺延到明天'
    },
    { key: 'tomorrow', label: '明日预计', value: plan.tomorrowCount ?? 0, title: '首页明日预告' }
  ]
})
const selectedId = ref('')// detail.appliedMerges = 按次留档的归并凭据视图（rollbackable / rolledBack / legacyWindowOnly）
const detail = ref<ReviewDetail | null>(null)
const route = useRoute()
const router = useRouter()
/** 勾选状态（key = 规范键）；默认只勾「可自动执行」的 */
const selected = ref<Record<string, boolean>>({})

const selectedKeys = computed(() => Object.keys(selected.value).filter((key) => selected.value[key]))
const selectedNeedsReview = computed(() => {
  const proposals = detail.value?.audit?.proposals ?? []
  return selectedKeys.value.filter((key) => {
    const proposal = proposals.find((item: any) => item.canonical === key)
    return proposal && !proposal.autoApplicable
  })
})

function resetSelection(audit?: ReviewDetail['audit']) {
  const next: Record<string, boolean> = {}
  for (const proposal of audit?.proposals ?? []) next[proposal.canonical] = !!proposal.autoApplicable
  selected.value = next
}

function toggleSelect(canonical: string, _auto: boolean) {
  selected.value = { ...selected.value, [canonical]: !selected.value[canonical] }
}

function selectAllApplicable() {
  const next: Record<string, boolean> = {}
  for (const proposal of detail.value?.audit?.proposals ?? []) next[proposal.canonical] = !!proposal.autoApplicable
  selected.value = next
}

function clearSelection() {
  selected.value = {}
}

async function applySelected() {
  const keys = selectedKeys.value
  if (!keys.length) return
  const needsReview = selectedNeedsReview.value.length
  const ok = await askConfirm({
    title: '执行概念归并',
    message: needsReview > 0
      ? `将执行 ${keys.length} 条归并（其中 ${needsReview} 条属于「需人工确认」），会删除该用户的重复记忆痕迹。执行后可回滚，但请先确认这些确实是同一个概念。`
      : `将执行 ${keys.length} 条归并，会删除该用户的重复记忆痕迹（保留合并字段后的那条）。执行后可回滚。`,
    confirmText: '执行归并',
    danger: true,
  })
  if (!ok) return
  busy.value = true
  error.value = ''
  try {
    const res: any = await adminMemoryReviewApi.apply(selectedId.value, keys, { includeNeedsReview: needsReview > 0 })
    const body = res.data?.data ?? res.data ?? {}
    toast.success(`已执行 ${body.applied ?? 0} 条归并${body.skipped?.length ? `，跳过 ${body.skipped.length} 条` : ''}`)
    await openDetail(selectedId.value)
    await loadOverview()
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

async function rollbackOne(canonical: string) {
  const ok = await askConfirm({
    title: '回滚归并',
    message: `将「${canonical}」还原成合并前状态：胜出者恢复原字段，被删除的重复痕迹按快照重建。`,
    confirmText: '回滚',
    danger: true,
  })
  if (!ok) return
  busy.value = true
  error.value = ''
  try {
    const res: any = await adminMemoryReviewApi.rollback(selectedId.value, [canonical])
    const body = res.data?.data ?? res.data ?? {}
    toast.success(body.rolledBack ? '已回滚' : '未找到可回滚的记录')
    await openDetail(selectedId.value)
    await loadOverview()
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

/* last-wins 代际号（P2）：快速点行 / 切「包含虚拟学习者」时，旧响应不得覆盖新状态 */
let overviewSeq = 0
let detailSeq = 0

async function loadOverview() {
  const seq = ++overviewSeq
  loading.value = true
  error.value = ''
  try {
    const res: any = await adminMemoryReviewApi.overview({ limit: 50, includeVirtual: includeVirtual.value })
    if (seq !== overviewSeq) return // 已有更新的概览请求在途/完成：丢弃过期响应
    const body = res.data?.data ?? res.data ?? {}
    rows.value = Array.isArray(body.users) ? body.users : []
    totals.value = { ...totals.value, ...(body.totals || {}) }
  } catch (e) {
    if (seq !== overviewSeq) return
    error.value = errMsg(e)
  } finally {
    // 只有最新一代才能收 loading，否则会把在途新请求的骨架屏提前打断
    if (seq === overviewSeq) loading.value = false
  }
}

async function openDetail(userId: string) {
  const seq = ++detailSeq
  selectedId.value = userId
  busy.value = true
  error.value = ''
  try {
    const res: any = await adminMemoryReviewApi.detail(userId)
    if (seq !== detailSeq) return // 用户已点了另一行：丢弃本次过期明细
    detail.value = res.data?.data ?? res.data ?? null
    resetSelection(detail.value?.audit)
    // 双向深链：选中即写进 URL，页面可收藏/分享（进来时靠 route.query.userId 落位）
    if (route.query.userId !== userId) {
      router.replace({ query: { ...route.query, userId } })
    }
  } catch (e) {
    if (seq !== detailSeq) return
    error.value = errMsg(e)
    // 坏深链（用户不存在/被删除）→ 清掉参数，避免地址栏一直挂着一个打不开的 id
    detail.value = null
    if (route.query.userId) {
      const next = { ...route.query }
      delete next.userId
      router.replace({ query: next })
    }
  } finally {
    if (seq === detailSeq) busy.value = false
  }
}

/** 页头刷新：概览、到期/强度窗口必刷；已选明细一并刷，避免上下两块数据口径不同步 */
async function refreshAll() {
  await Promise.all([loadOverview(), loadTraceWindow()])
  if (selectedId.value) await openDetail(selectedId.value)
}

/** 收起明细：同时清掉 URL 上的 userId（否则刷新又会弹回来） */
function closeDetail() {
  detail.value = null
  selectedId.value = ''
  if (route.query.userId) {
    const next = { ...route.query }
    delete next.userId
    router.replace({ query: next })
  }
}
/* 明细态的返回：Esc 与左上角「← 用户列表」同一条路径（二级页的通用退出口） */
useEscape(() => !!detail.value, closeDetail)

/** 复制当前学习者的深链（供运维贴到工单/IM，不必手拼 URL） */
async function copyDeepLink() {
  const userId = selectedId.value || String(route.query.userId || '')
  if (!userId) return
  const link = `${window.location.origin}${route.path}?userId=${encodeURIComponent(userId)}`
  try {
    await navigator.clipboard.writeText(link)
    toast.success('深链已复制')
  } catch {
    // 剪贴板不可用（非安全上下文等）→ 至少把链接展示出来，不让操作静默失败
    toast.error(link)
  }
}

/** 行内「重新观察」进行中标记：只转该行按钮文案，不锁整页 */
const recomputingId = ref('')

async function recompute(userId: string) {
  busy.value = true
  recomputingId.value = userId
  error.value = ''
  try {
    await adminMemoryReviewApi.recompute(userId)
    await openDetail(userId)
    await loadOverview()
    toast.success('已完成一次记忆复盘')
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    busy.value = false
    recomputingId.value = ''
  }
}

onMounted(async () => {
  await Promise.all([loadOverview(), loadTraceWindow()])
  // 深链：/admin/memory-review?userId=xxx 直接落到该用户明细（供学习者详情等入口跳转）
  const queryUserId = route.query.userId
  if (typeof queryUserId === 'string' && queryUserId) {
    await openDetail(queryUserId)
  }
})
</script>

<style scoped>
.mr { display: flex; flex-direction: column; }

/* ===== 用户列表（2026-09-28：表头回归——行列表没有表头，右侧裸数字无从解读）===== */
/* 身份格：头像 + 名称/shortId + 虚拟徽章；名称溢出由 .mk-cell-main 统一截断 */
.mr__user { display: flex; align-items: center; gap: 9px; min-width: 0; }
.mr__user .mk-cell-main { min-width: 0; flex: 1; }

/* 到期压力条：数字在上、比例条在下；右对齐与同列的数字表头对齐 */
.mr__due { display: grid; gap: 3px; justify-items: end; }
.mr__due b { font-variant-numeric: tabular-nums; font-weight: 700; }
.mr__due--none b { color: var(--mk-faint); font-weight: 400; }
.mr__due--warn b { color: var(--mk-amber); }
.mr__due--high b { color: var(--mk-red-strong); }
.mr__due-bar { display: block; width: 64px; height: 4px; border-radius: var(--mk-radius-pill); background: var(--mk-surface-2); overflow: hidden; }
.mr__due-bar i { display: block; height: 100%; border-radius: var(--mk-radius-pill); background: var(--mk-amber); }
.mr__due--none .mr__due-bar i { background: var(--mk-faint); opacity: 0.35; }
.mr__due--high .mr__due-bar i { background: var(--mk-red-fill); }

/* 记忆分布（newui「教学分组」stageband 原型移植；token 映射：--surface-3→--mk-surface-3、
   --muted→--mk-muted、--fs-micro→--mk-fs-micro、sbl__sw 3px 圆角→--mk-radius-xs）。
   mk-card 没有 body padding 原语 → 本地 .mr-dist__body（非 mk- 前缀）。
   12/16 = 原型 .card__body（--sp-3/--sp-4），与 TeachingSessions 分布卡同一档。 */
.mr-dist__body { padding: 12px 16px 16px; }
.stageband { display: flex; gap: 2px; height: 12px; border-radius: 999px; overflow: hidden; background: var(--mk-surface-3); }
.stageband > span { display: block; height: 100%; }
.stageband__legend { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 10px 18px; margin-top: 14px; }
.sbl { display: flex; align-items: center; gap: 8px; font-size: var(--mk-fs-micro); }
.sbl__sw { width: 10px; height: 10px; border-radius: var(--mk-radius-xs); flex: none; }
.sbl__name { color: var(--mk-muted); }
.sbl__n { margin-left: auto; font-weight: 700; font-variant-numeric: tabular-nums; }

/* 到期带 + 强度直方图两卡 grid（原型 renderMemory 2029 行 grid-template-columns:
   minmax(0,1.5fr) minmax(0,1fr) + align-items:start 原样移植；窄屏收单列） */
.mr-bandgrid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 12px; align-items: start; }
@media (max-width: 960px) { .mr-bandgrid { grid-template-columns: minmax(0, 1fr); } }

/* 强度直方图（newui 原型 .histo 579-584 原样移植；token 映射：--mono→--mk-mono、
   --muted→--mk-muted、--faint→--mk-faint、11px 字号→--mk-fs-micro（设计语言 12px 下限），
   几何尺寸/圆角保持 px 原值） */
.histo { display: flex; align-items: flex-end; gap: 10px; height: 132px; padding-top: 10px; }
.histo .hcol { flex: 1 1 0; min-width: 0; display: grid; align-content: end; justify-items: center; gap: 6px; }
/* 原型 6/6/3/3px → 圆角档 sm6/xs4（项目圆角四档铁律，xs 为最近档） */
.histo .hbar { width: 100%; max-width: 52px; border-radius: var(--mk-radius-sm) var(--mk-radius-sm) var(--mk-radius-xs) var(--mk-radius-xs); min-height: 3px; }
.histo .hval { font-size: var(--mk-fs-micro); font-family: var(--mk-mono); color: var(--mk-muted); }
.histo .hcap { font-size: var(--mk-fs-micro); color: var(--mk-faint); text-align: center; white-space: nowrap; }
@media (max-width: 768px) { .histo { height: 108px; gap: 6px; } }

/* 需人工看：>0 抬成琥珀胶囊；0 压成安静破折号 */
.mr__need {
  display: inline-block; min-width: 22px; text-align: center;
  padding: 1px 8px; border-radius: var(--mk-radius-pill);
  background: color-mix(in srgb, var(--mk-amber) 14%, transparent);
  color: var(--mk-amber); font-weight: 700; font-variant-numeric: tabular-nums;
}

/* 卡内小节标题（归并审计卡里的三段子列表）：左右 16px 与卡头对齐 */
.mr__h4 { margin: 14px 16px 6px; font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); }
/* 归并表勾选列表头：收窄，别把「选择」撑成正文列宽 */
.mr__th-check { width: 40px; }
.mr__sub { display: block; color: var(--mk-muted, #5b6577); font-size: var(--mk-fs-micro); }
/* 卡内说明段（非表格单元格里的 sub 文本）：补 16px 内边距与卡头文字对齐 —— 原来贴着卡左缘，
   看起来像漏排；表格仍按设计通边（单元格自带 padding） */
.mr p.mr__sub { margin: 0; padding: 10px 16px 14px; }
.mr__row--active { background: var(--mk-blue-bg); }
/* 列表卡内的错误行同样要内边距（与卡头对齐） */
.mr__error { margin: 6px 16px; color: var(--mk-red-strong); font-size: var(--mk-fs-micro); }

.mr__warn { margin: 8px 16px 14px; padding: 8px 10px; border-radius: var(--mk-radius-xl); border: 1px solid color-mix(in srgb, var(--mk-amber) 30%, transparent); background: color-mix(in srgb, var(--mk-amber) 6%, transparent); font-size: var(--mk-fs-micro); }
.mr__chip { display: inline-block; margin-left: 8px; }
/* 明细态容器：二级页里自己是滚动容器（头部返回栏常驻）。flex:1 + min-height:0 缺一不可，
   否则卡片按内容撑高、被 .mk-page--fill 的 overflow:hidden 裁掉 */
.mr__detail { display: grid; gap: 12px; align-content: start; flex: 1; min-height: 0; overflow-y: auto; }
/* 温故计划指标条：MkStatStrip 首格 padding-left:0，放进卡里需自备横向内边距 */
.mr__strip { padding: 8px 16px 10px; border-bottom: 1px solid var(--mk-line); }
/* 明细区百分比列（批E）：数字+色阶条，与概览带/用户表同一语言 */
.mr-pct { display: grid; gap: 2px; justify-items: start; }
.mr-pct b { font-variant-numeric: tabular-nums; font-weight: 700; }
.mr-pct__bar { display: block; width: 52px; height: 4px; border-radius: var(--mk-radius-pill); background: var(--mk-surface-2); overflow: hidden; }
.mr-pct__bar i { display: block; height: 100%; border-radius: var(--mk-radius-pill); background: var(--mk-green); }
.mr-pct__bar--blue i { background: var(--mk-blue); }
.mr-pct--warn .mr-pct__bar i { background: var(--mk-amber); }
.mr-pct--warn b { color: var(--mk-amber); }
/* 审计处理队列（批E）：复用概览带队列格语言 */
/* auto-fit：窄屏不挤成 5 等份，宽屏不浪费（原固定 repeat(5) 在窄屏下每格 <100px） */
.mr-audit-queue { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; padding: 10px 16px 4px; }
.mr-audit-queue__item { display: grid; gap: 1px; padding: 8px 11px; border-radius: var(--mk-radius-lg); background: var(--mk-surface-2); }
.mr-audit-queue__item--hot { background: color-mix(in srgb, var(--mk-amber) 10%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mk-amber) 32%, transparent); }
.mr-audit-queue__item--hot b { color: var(--mk-amber); }
.mr-audit-queue__item--quiet { background: transparent; }
.mr-audit-queue__item b { font-size: 18px; font-weight: 800; color: var(--mk-ink); font-variant-numeric: tabular-nums; }
.mr-audit-queue__item b i { font-style: normal; font-size: 12px; font-weight: 600; color: var(--mk-faint); }
.mr-audit-queue__item span { font-size: var(--mk-fs-micro); color: var(--mk-muted); } /* 12px 下限（设计语言规则 5），原 11px */
.mr__sub-inline { margin-left: 8px; font-weight: 400; color: var(--mk-muted, #5b6577); font-size: var(--mk-fs-micro); }
.mr__bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 6px 16px 10px; }
.mr__warn-inline { color: var(--mk-amber); font-size: var(--mk-fs-micro); }
</style>
