<template>
  <div ref="rootEl" class="mr mk-page mk-page--fill">
    <!-- ===== 列表态 / 明细态二选一 =====
         选中用户前：状态条 + KPI 区 + 用户列表（列表卡内部滚动）；
         选中用户后：整页让位给「该用户的记忆复盘」二级页（明细拿到整幅宽高）。
         旧版把明细塞在用户列表卡内部共用一条 flex 列：表网格 flex:1 被明细压成 0 高
         （一选用户列表整条消失），超出的 2000+px 又被 .mk-card 的 overflow:clip 裁掉，
         下半页永远滚不到。二级页形态与「用户与学习者 → 用户详情」「虚拟学习者 → 画像」一致。 -->
    <!-- ===== 明细取数中：骨架占位（T2 硬约束 4；此前无任何加载反馈，2026-10-06 审核 #45） ===== -->
    <template v-if="detailLoading && !detail">
      <div class="mr__detail">
        <MockSkeletonTable :cols="4" :rows="4" />
      </div>
    </template>

    <template v-else-if="!detail">
    <!-- 页头（newui/admin pagehead）：页名（悬停带口径长注）+ 作用域开关/刷新上移；
         原状态条整体退役 -->
    <MkPageHead
      title="记忆与复习观测"
      sub="遗忘曲线调度 · 到期积压、课内温故与概念归并审计"
      hint="记忆层（用户级、跨 path）：到期积压 · 课内温故配额 · 概念归并审计；归并默认观察模式，只记录建议，不动 memory_traces"
    >
      <template #actions>
        <!-- 口径开关收在页头（原在「记忆层概览」卡头 → 原生 checkbox；2026-10-04 整组统一为
             DataScopeToggle：学习组六页同一位、同一状态，撤页头刷新钮）。
             它切换的是整页口径：含虚拟学习者时，用户 / 痕迹 / 到期与归并队列一并纳入仿真账号 -->
        <DataScopeToggle v-model="includeVirtual" />
      </template>
    </MkPageHead>
    <!-- 页头 KPI 区（2026-09-28）：原「状态条散文 3 数 + 概览卡 880px 构成条 + 四张队列卡」
         三处各说一遍同一批数。现在全站页头统一为 MkKpi 卡栅格（同总览/健康中心/成本分析形态），
         页级绝对值只在这里出现一次；口径说明进各卡 title，比例条由「占痕迹 N%」副行承担。
         B5-F3-2：取数未落定前显「—」+「取数中…」（不再渲染裸 0 与肯定性副文案），
         栅格挂 aria-busy 让读屏也能感知加载窗口。 -->
    <section class="mk-kpi-grid" :aria-busy="kpiPending || undefined">
      <MkKpi
        v-for="card in overviewCards"
        :key="card.label"
        :label="card.label"
        :value="card.value"
        :hint="card.hint"
        :tone="card.tone"
        :title="card.title"
        :aria-busy="kpiPending || undefined"
      />
    </section>

    <!-- 到期时间轴（教学组标准件 MkDistBand；2026-10-05 用户拍板「分段条在上」：回到用户列表卡
         上方页面级）——点某档 = 只看窗口内该档有到期痕迹的学习者。口径不变：复习队列 =
         extractionCount>0，窗口 = 最近 200 条痕迹（updatedAt 倒序），非全量——全量到期数见
         页头 KPI「当前到期」；下钻命中集同样只含窗口内学习者 -->
    <MkDistBand
      v-if="traceWindowReady"
      card
      class="mr-distband"
      title="到期时间轴"
      :sub="`点击分段只看该档学习者 · 窗口内 ${queueRows.length} 个复习点（最近 ${traceRows.length} 条痕迹，非全量）`"
      unit="个"
      aria-label="按到期时间筛选学习者"
      :bins="mrDueBins"
      :active-key="dueBandFilter"
      @select="toggleDueBand"
    />

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <h3 class="mk-card__title">用户列表</h3>
        <!-- 口径：totals.users 是后端全量统计，唯一住在页头 KPI「用户」卡；卡头只报本列表的窗口事实
             （展示前 N、排序键、下钻命中），不再复读全量数（CP6：同屏 KPI 与卡头两处同数） -->
        <!-- 口径：totals.users 是后端全量统计，唯一住在页头 KPI「用户」卡；卡头只报本列表的窗口事实
             （页码/页大小、排序键、下钻命中），不再复读全量数（CP6：同屏 KPI 与卡头两处同数）。
             #41：列表已接服务端分页（offset），「暂无分页」自述删除 -->
        <span class="mk-card__meta" :title="`按待复习（到期）量倒序服务端分页，每页 ${userPageSize} 位；全量有记忆痕迹用户数见页头 KPI${dueBandFilter ? '。当前按到期档下钻，命中集只含当前窗口内学习者' : ''}`">第 {{ userPage }} 页 · 每页 {{ userPageSize }} 位 · 按待复习量倒序<template v-if="dueBandFilter"> · 已筛 {{ visibleRows.length }} 位</template></span>
      </div>
      <!-- 取数失败不得渲染成「暂无数据」（R2）：总览失败且无行 → MkEmptyState tone="error" + 重试；
           有旧行时保留旧行并在上方给出带重试的 .mk-alert（失败原因不静默） -->
      <div v-if="error && rows.length" class="mk-alert mk-alert--row" role="alert">
        <span class="mk-alert__msg">{{ error }}</span>
        <button type="button" class="mk-alert__btn" :disabled="loading" @click="refreshAll">{{ loading ? '重试中…' : '重试' }}</button>
      </div>
      <MkEmptyState
        v-if="error && !rows.length"
        tone="error"
        :title="error"
        description="总览取数失败，页面数字不可信。"
        action-text="重试"
        :action-busy="loading"
        action-busy-text="重试中…"
        @action="refreshAll"
      />
      <MockSkeletonTable v-else-if="loading && !rows.length" :cols="7" :rows="8" />
      <MkEmptyState v-else-if="!loading && !rows.length" title="暂无记忆痕迹数据" description="当前口径内还没有用户产生记忆痕迹。等学习者开始学习并完成概念提取后，这里会按待复习量倒序列出用户。" />
      <!-- 用户列表（列集 = 原型 renderMemory：学习者 | 待复习 | 薄弱项 | 平均记忆强度 | 最近复习 | 操作；
           2026-10-02 用户拍板「这个列表的列按新UI来」：撤痕迹列（排序键改到期量，与原型
           「按待复习量排序」同口径），补薄弱/平均强度 meter/最近复习三列；类型列不设——
           虚拟标记已住在学习者格 MkVariantBadge（全站判例），另设一列同信息两处渲染。
           需人工看为本地真实运营信号（归并候选），原型无此列、保留。
           原型 .tbl 自动布局：无 colgroup/无 fixed，列宽随内容、td nowrap（同 Users.vue 判例） -->
      <div v-else class="mk-table-scroll">
        <table v-if="visibleRows.length" class="mk-table mk-table--click">
          <thead>
            <tr>
              <th>学习者</th>
              <th class="mk-num" title="到该复习而未复习的痕迹数；条内小条 = 占该用户痕迹比例；本表按此列倒序">待复习</th>
              <th class="mk-num" title="像但不确定的归并候选，需人工确认，不会自动执行">需人工看</th>
              <th class="mk-num" title="记忆强度（FSRS 可提取率）< 40% 的痕迹数——临近遗忘，复习优先级最高">薄弱项</th>
              <th class="mk-num" title="该用户全部有强度痕迹的 FSRS 可提取率均值；无强度数据时显示 —">平均记忆强度</th>
              <th title="该用户最近一次有强度痕迹的看到时间（lastSeenAt 最大值）">最近复习</th>
              <th class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <!-- 原型 renderMemory：学习者行/「记忆点」按钮均 data-action="open-learner" → go("learner") 页。
                 行点击改跳学习者详情页（原型铁令：实体行跳页不开浮层）；「明细」钮保留页内复盘二级视图（记忆点子实体明细，原型允许形态）。
                 EG1：回车不劫持行内按钮——仅行本身聚焦时 Enter 跳页（.self），聚焦「明细/重新观察」时走按钮自身动作 -->
            <tr
              v-for="row in visibleRows"
              :key="row.userId"
              :data-mr-row="row.userId"
              :class="{ 'mr__row--active': row.userId === selectedId }"
              tabindex="0"
              @click="openSubPage('learner', row.userId)"
              @keydown.enter.self.prevent="openSubPage('learner', row.userId)"
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
              <td class="mk-num">
                <!-- 2026-10-05 表格方言收敛：数字在上+条在下（堆叠档）退役，与右邻「平均记忆强度」
                     同语法 = 条 + 数值右侧（全站进度表达唯一：mk-minibar + mono 值） -->
                <span class="mr__due" :class="`mr__due--${dueTone(row)}`" :title="`到该复习而未复习 ${row.due} 条，占该用户痕迹 ${duePctOf(row)}%`">
                  <span class="mk-minibar mr__bar" aria-hidden="true"><i class="mk-minibar__fill" :data-tone="dueTone(row) === 'high' ? 'bad' : dueTone(row) === 'warn' ? 'warn' : undefined" :style="{ width: duePctOf(row) + '%' }"></i></span>
                  <b>{{ row.due }}</b>
                </span>
              </td>
              <td class="mk-num">
                <span v-if="row.audit?.ambiguous" class="mk-badge mk-badge--sm mk-badge--warn mr__need" :title="`${row.audit.ambiguous} 条归并候选需人工确认，不会自动执行`">{{ row.audit.ambiguous }}</span>
                <span v-else class="mk-na" title="没有待人工确认的归并候选">—</span>
              </td>
              <td class="mk-num">
                <span v-if="row.weak > 0" class="mk-badge mk-badge--sm mk-badge--warn mr__need" :title="`${row.weak} 条痕迹强度已跌破 40%，临近遗忘`">{{ row.weak }}</span>
                <span v-else class="mk-na" title="没有跌破 40% 的痕迹">—</span>
              </td>
              <td class="mk-num">
                <span v-if="row.avgStrength != null" class="mr__strength" :title="`全部有强度痕迹的 FSRS 可提取率均值 ${Math.round(row.avgStrength * 100)}%`">
                  <span class="mk-minibar mr__bar"><i class="mk-minibar__fill" :style="{ width: Math.round(row.avgStrength * 100) + '%' }"></i></span>
                  <span class="mono">{{ Math.round(row.avgStrength * 100) }}%</span>
                </span>
                <span v-else class="mk-na" title="该用户的痕迹都还没有 FSRS 强度数据">—</span>
              </td>
              <td :title="row.lastReviewedAt ? new Date(row.lastReviewedAt).toLocaleString('zh-CN', { hour12: false }) : undefined">
                <span class="mk-cell-sub mono">{{ row.lastReviewedAt ? timeAgo(row.lastReviewedAt) : '—' }}</span>
              </td>
              <td>
                <div class="mk-actions">
                <button type="button" class="mk-btn mk-btn--sm" :disabled="detailLoading" title="打开该用户的记忆复盘明细" @click.stop="openDetail(row.userId)">明细</button>
                <button type="button" class="mk-btn mk-btn--sm" :disabled="recomputingId === row.userId" title="对该用户手动跑一次记忆复盘，结果实时刷新；数据源为该用户全部学习路径下的记忆痕迹" @click.stop="recompute(row.userId, row.name)">{{ recomputingId === row.userId ? '观察中…' : '重新观察' }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <!-- 到期档下钻筛空：两种口径要分开说。下钻命中的是「当前窗口内该档有到期痕迹的学习者」，
             列表是服务端分页窗口（每页 N，随分页器条数变化）——两者求交集为空时，断言「窗口内没有
             学习者的到期痕迹」是错的（实测「明天」档窗口内 42 痕 / 12 人，交集 0，界面却报窗口内没有）。 -->
        <MkEmptyState
          v-else-if="dueBandFilter"
          :title="dueBandEmpty.title"
          :description="dueBandEmpty.desc"
        />
      </div>
      <!-- 服务端分页（审核 #41，T1 硬约束「列表必须分页」）：total=后端全量有痕迹用户数
           （totals.users，与页头 KPI 同源）；与 AuditLogs 同一分页器形态，作为 .mk-card--fill
           的直接子元素吸底。
           2026-10-07 审核 B5-F3-1：此前只传 :page-size（固定 50）而没接 v-model:pageSize，
           下拉 emit 的 update:pageSize 无人接 → 选条数只回弹 value、列表不重拉；
           现接 v-model:pageSize，条数变更回第 1 页并按新条数重查（AuditLogs 判例） -->
      <Pagination
        v-model:page="userPage"
        v-model:pageSize="userPageSize"
        :total="totals.users"
        :loading="loading"
      />
    </div>
    </template>

    <!-- ===== 明细态（二级页）===== -->
    <template v-else>
      <header class="mk-status" :class="`mk-status--${detailTone}`">
        <!-- 状态点补齐（2026-10-06 审核 #60）：tone 语义由 .mk-status__dot 唯一承载
             （原语层 CSS 的 tone 只给 __dot 上色、图例文案挂 __dot::after），
             此前无 dot → warn 只剩染底、ok/muted 相对默认卡面零差异 -->
        <span class="mk-status__dot" aria-hidden="true"></span>
        <button type="button" class="mk-back mr__back" title="返回用户列表（Esc）" @click="closeDetail">← 用户列表</button>
        <span class="mk-status__sep"></span>
        <strong ref="detailTitleEl" class="mk-status__title" tabindex="-1">记忆复盘 · {{ detail.user.name || '未命名' }}</strong>
        <span
          class="mk-status__meta"
          title="该用户名下记忆痕迹总览：到期 = 到该复习而未复习；同族重复 = 归一化键相同、措辞不同的痕迹（组 / 条）；从未提取 = 一直没被当作复习点接住过。「有 FSRS 状态」只数显式落库 fsrsStability 的痕迹——到期预览里没有 FSRS 状态的旧痕迹按掌握度回退估算强度（见「到期清单预览」卡头标注），两者来源不同。状态点示警阈值：占该用户痕迹 ≥20% 或到期 ≥5 条（阈值内为间隔复习的常态积压，不亮警示）"
        >痕迹 {{ detail.summary.traces }} · 到期 {{ detail.summary.due }} · 同族重复 {{ detail.summary.duplicatedFamilies }} 组/{{ detail.summary.duplicatedTraces }} 条 · 从未提取 {{ detail.summary.neverExtracted }} · 有 FSRS 状态 {{ detail.summary.withFsrsState }}<template v-if="detail.summary.strengthFromLegacy">（另有 {{ detail.summary.strengthFromLegacy }} 条回退估算）</template></span>
        <span class="mk-status__actions">
          <button type="button" class="mk-status__action" title="复制该用户记忆复盘的深链（可分享 / 收藏，打开即落位）" @click="copyDeepLink">复制深链</button>
          <button type="button" class="mk-status__action" :disabled="recomputingId === selectedId" title="对该用户手动跑一次记忆复盘，结果实时刷新；数据源为该用户全部学习路径下的记忆痕迹" @click="recompute(selectedId, detail.user.name)">{{ recomputingId === selectedId ? '观察中…' : '重新观察' }}</button>
        </span>
      </header>

      <!-- 明细态 error 出口（P1#12 + 审核 #40）：写动作/明细取数失败时人类必须可感知；
           形态回归共享 .mk-alert（红底 + 正文档），不再用页私有 micro 字号横条 -->
      <p v-if="error" class="mk-alert mr__detail-error" role="alert">{{ error }}</p>

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
                <!-- 概念格（2026-10-06 审核 #65）：后端 label 与 conceptKey 常同值（本库 23/23），
                     相同时不再重复渲染第二行（看着像渲染故障，也把行高撑成两行） -->
                <td><strong>{{ item.label }}</strong><small v-if="item.conceptKey && item.conceptKey !== item.label" class="mr__sub">{{ item.conceptKey }}</small></td>
                <td class="mk-num">
                  <span class="mr-pct" :class="{ 'mr-pct--warn': item.retention < 0.7 }" :title="`记忆强度 ${Math.round(item.retention * 100)}%，低于 70% 优先安排`">
                    <b>{{ Math.round(item.retention * 100) }}%</b>
                    <span class="mk-minibar mr__bar mr__bar--sm" aria-hidden="true"><i class="mk-minibar__fill" :data-tone="item.retention < 0.7 ? 'warn' : undefined" :style="{ width: Math.round(item.retention * 100) + '%' }"></i></span>
                  </span>
                </td>
                <td :title="item.reason ? `后端枚举：${item.reason}` : undefined">{{ reasonText(item.reason) }}</td>
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
          <span class="mk-card__meta" :title="`按记忆强度升序：越靠前越该先复习；列表最多前 20 条。强度来源：有 FSRS 状态的痕迹 = FSRS 可提取率；无 FSRS 状态的旧痕迹按掌握度回退估算${duePreviewLegacyCount ? `（本页 ${duePreviewLegacyCount} 条为回退估算）` : ''}`">前 20 · 记忆强度升序<template v-if="duePreviewLegacyCount"> · 含 {{ duePreviewLegacyCount }} 条回退估算</template></span>
        </div>
        <div v-if="detail.duePreview.length" class="mk-table-scroll">
          <table class="mk-table">
          <thead><tr><th>概念</th><th class="mk-num" title="有 FSRS 状态的痕迹 = FSRS 可提取率；无 FSRS 状态的旧痕迹按掌握度回退估算（逐格悬停可见来源）">记忆强度</th><th class="mk-num">掌握</th><th class="mk-num">提取次数</th><th>来源</th><th title="相对表达：已逾期 N 天 / 今天 / 明天 / N 天后；绝对到期时刻进悬停">到期</th></tr></thead>
          <tbody>
            <tr v-for="trace in detail.duePreview" :key="trace.conceptKey">
              <!-- 原型记忆明细表首列 = 知识点 strong；同族重复/归并建议首列是裸 key（无人类可读
                   label），维持 mr__sub 降档，不冒充正文 -->
              <td><strong>{{ trace.label }}</strong></td>
              <td class="mk-num">
                <span class="mr-pct" :class="{ 'mr-pct--warn': trace.retention < 0.7 }" :title="strengthTitle(trace)">
                  <b>{{ Math.round(trace.retention * 100) }}%</b>
                  <span class="mk-minibar mr__bar mr__bar--sm" aria-hidden="true"><i class="mk-minibar__fill" :data-tone="trace.retention < 0.7 ? 'warn' : undefined" :style="{ width: Math.round(trace.retention * 100) + '%' }"></i></span>
                </span>
              </td>
              <td class="mk-num">
                <span class="mr-pct" :title="`掌握 ${Math.round(trace.masteryScore * 100)}%`">
                  <b>{{ Math.round(trace.masteryScore * 100) }}%</b>
                  <span class="mk-minibar mr__bar mr__bar--sm" aria-hidden="true"><i class="mk-minibar__fill" :style="{ width: Math.round(trace.masteryScore * 100) + '%' }"></i></span>
                </span>
              </td>
              <td class="mk-num">{{ trace.extractionCount }}</td>
              <td class="mr__sub" :title="trace.source ? `后端枚举：${trace.source}` : undefined">{{ sourceText(trace.source) }}</td>
              <!-- 到期列（P1#13）：裸绝对时刻读不出「急不急」，改相对表达（已逾期 N 天 / N 天后）
                   并给逾期着色；绝对时刻进 title（P2 到期带判例同源） -->
              <td>
                <span
                  v-if="dueCell(trace).text !== '—'"
                  :class="{ 'mr__overdue': dueCell(trace).overdue }"
                  :title="dueCell(trace).title"
                >{{ dueCell(trace).text }}</span>
                <span v-else class="mk-na" title="该痕迹没有到期时间">—</span>
              </td>
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
                    class="mr__check"
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
                    <span class="mk-minibar mr__bar mr__bar--sm" aria-hidden="true"><i class="mk-minibar__fill" :style="{ width: Math.round(proposal.confidence * 100) + '%' }"></i></span>
                  </span>
                </td>
                <td class="mk-num">
                  <span class="mr-pct" :class="{ 'mr-pct--warn': !proposal.autoApplicable }" :title="`词面相似 ${Math.round(proposal.lexicalSimilarity * 100)}%${proposal.autoApplicable ? '' : '（未过词面闸门）'}`">
                    <b>{{ Math.round(proposal.lexicalSimilarity * 100) }}%</b>
                    <span class="mk-minibar mr__bar mr__bar--sm" aria-hidden="true"><i class="mk-minibar__fill" :data-tone="proposal.autoApplicable ? undefined : 'warn'" :style="{ width: Math.round(proposal.lexicalSimilarity * 100) + '%' }"></i></span>
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
            <!-- 表头补明「候选 A / B 是概念键」（2026-10-06 审核 #62）：原表头只写 A / B
                 两个单字母；A/B 两列是无人类可读 label 的裸 conceptKey，与另三表同降 .mr__sub 档 -->
            <thead><tr><th>候选 A（概念键）</th><th>候选 B（概念键）</th><th>理由</th></tr></thead>
            <tbody>
              <tr v-for="(item, index) in detail.audit.ambiguous" :key="`${item.a}-${item.b}-${index}`">
                <td class="mr__sub">{{ item.a }}</td>
                <td class="mr__sub">{{ item.b }}</td>
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
                <td><span class="mk-cell-sub mono" :title="merge.appliedAt">{{ fmtDateTime(merge.appliedAt) }}</span></td>
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
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { adminMemoryReviewApi, adminMemoryTracesApi } from '@/api/adminApi'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkStatStrip from '@/components/mk/MkStatStrip.vue'
import MkCellAvatar from '@/components/mk/MkCellAvatar.vue'
import MkVariantBadge from '@/components/mk/MkVariantBadge.vue'
import MkDistBand from '@/components/mk/MkDistBand.vue'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import DataScopeToggle from './DataScopeToggle.vue'
import type { MkStatItem } from '@/components/mk/MkStatStrip.vue'
import { askConfirm } from './useConfirm'
import { useEscape } from './useEscape'
import { openSubPage } from './store'
import { toast } from '@/utils/toast'
import { errMsg, shortId, timeAgo, liveIncludeVirtual, liveSetIncludeVirtual } from './live'

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
  /* 原型 renderMemory 三列（薄弱项/平均记忆强度/最近复习）：薄弱 = FSRS 强度<40% 的痕迹数；
     平均强度 0-1，null = 该用户没有任何带 FSRS 强度的痕迹（不硬造 0）；最近复习 = lastSeenAt 最大值 */
  weak: number
  avgStrength: number | null
  lastReviewedAt: string | null
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
    /** 无 FSRS 状态、强度按掌握度回退估算的痕迹数（B5-F3-3；旧后端无此字段 → 可选） */
    strengthFromLegacy?: number
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
  duePreview: Array<{ conceptKey: string; label: string; retention: number; masteryScore: number; extractionCount: number; source?: string | null; dueAt?: string | null; fsrsScheduled?: boolean }>
}

const rollbackableMerges = computed<AppliedMergeView[]>(() => detail.value?.appliedMerges?.rollbackable ?? [])
const rolledBackMerges = computed<AppliedMergeView[]>(() => detail.value?.appliedMerges?.rolledBack ?? [])
const legacyWindowOnlyMerges = computed<AppliedMergeView[]>(() => detail.value?.appliedMerges?.legacyWindowOnly ?? [])
/** 到期预览中按旧痕迹回退估算强度的条数（B5-F3-3）：头部「有 FSRS 状态」只数显式
 *  fsrsStability 的痕迹，而预览的强度对无 FSRS 状态的旧痕迹走 fsrsStateFromLegacy 回退——
 *  两个数字来源不同，这里把回退条数公开给卡头，同屏各自标明来源，不再互相打架。 */
const duePreviewLegacyCount = computed(() => {
  const preview = detail.value?.duePreview ?? []
  if (!preview.length) return 0
  /* 首选逐行来源标注（新后端 fsrsScheduled）；旧后端无该字段时退回 summary.strengthFromLegacy */
  if (preview.some((trace) => trace.fsrsScheduled !== undefined)) {
    return preview.filter((trace) => trace.fsrsScheduled === false).length
  }
  return detail.value?.summary.strengthFromLegacy ?? 0
})

const loading = ref(false)
const busy = ref(false)
const error = ref('')
/* 口径整组统一（2026-10-04 用户拍板）：get/set 走 live.ts 共享态（页头 DataScopeToggle 同源），
   本页 watch 负责整页重新统计（原 checkbox @change 的职责） */
const includeVirtual = computed({
  get: () => liveIncludeVirtual.value,
  set: (v) => liveSetIncludeVirtual(v)
})
watch(includeVirtual, () => {
  userPage.value = 1
  void refreshAll()
})
const rows = ref<OverviewRow[]>([])
/* 用户列表服务端分页（审核 #41，T1 硬约束「列表必须分页」）：此前后端只接 limit、
   前端固定拉前 50 名，101 位有痕迹用户里第 51 位起不可达也不可搜。页码驱动 offset，
   totals.users（全量有痕迹用户数）作分页 total；到期档下钻仍是对当前窗口的本地过滤。
   B5-F3-1：每页条数由分页器下拉驱动（可选 15/30/50/100，默认 50），不再写死常量。 */
const userPage = ref(1)
const userPageSize = ref(50)
watch(userPage, () => {
  void loadOverview()
})
/* 每页条数变更：回第 1 页并按新条数重查（AuditLogs 的 currentPageSize 判例）；
   已回第 1 页时 page watcher 不触发，必须显式补一次 loadOverview，否则改了条数不重拉。 */
watch(userPageSize, () => {
  if (userPage.value !== 1) {
    userPage.value = 1 // 由 page watcher 触发重查
  } else {
    void loadOverview()
  }
})
/** 明细态状态点：与页头 KPI 同一阈值语义（P1#13）——占该用户痕迹 ≥20% 或到期 ≥5 条才亮
 *  需关注；阈值内是间隔复习的常态积压，不着琥珀（否则告警常亮、琥珀失去语义）。 */
const detailTone = computed<'ok' | 'warn' | 'muted'>(() => {
  if (!detail.value) return 'muted'
  const s = detail.value.summary
  if (!s.due) return 'ok'
  const pct = s.traces ? (s.due / s.traces) * 100 : 100
  return pct >= DUE_WARN_PCT || s.due >= DUE_WARN_PER_USER ? 'warn' : 'ok'
})
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
/** 总览是否已落定一次（B5-F3-2）：首屏取数在途时 totals 还是初值 0，未落定前 KPI
 *  不得把初值当真实数渲染（与「确实是 0」不可区分）；失败态由 error 另行兜底。 */
const overviewReady = ref(false)
/** 首屏 KPI 取数在途（未落定且未失败）：值显 '—'、副文案显「取数中…」，栅格挂 aria-busy */
const kpiPending = computed(() => !overviewReady.value && !error.value)

/* ---- 页头 KPI 区（2026-09-28 收口后的派生） ---- */
const duePct = computed(() => (totals.value.traces ? Math.round((totals.value.due / totals.value.traces) * 100) : 0));

/* 到期示警阈值（P1#13，2026-10-02）：此前「due>0 即琥珀」→ 间隔复习系统里告警永远亮着，
   琥珀失去语义。收敛为：占全部痕迹 ≥20% 或人均 ≥5 条才抬警示；阈值写入 KPI title 披露。
   （列表行内的到期压力档仍用行级阈值 ≥50%/≥12 条，那是单用户刻度，两处不共用一个数是刻度不同。） */
const DUE_WARN_PCT = 20
const DUE_WARN_PER_USER = 5
const dueWarn = computed(() => {
  const t = totals.value
  if (!t.due) return false
  const pct = t.traces ? (t.due / t.traces) * 100 : 100
  const perUser = t.users ? t.due / t.users : t.due
  return pct >= DUE_WARN_PCT || perUser >= DUE_WARN_PER_USER
})
const dueCardTitle = computed(() => {
  const t = totals.value
  return `到该复习而未复习 ${t.due} 条，占全部痕迹 ${duePct.value}%；示警阈值：占痕迹 ≥${DUE_WARN_PCT}% 或人均 ≥${DUE_WARN_PER_USER} 条（阈值内为间隔复习的常态积压，不着警示色）`
})

/* ===== 到期时间轴（newui 原型 renderMemory dueBand/distBand 移植；强度直方图 2026-10-05 用户令退役）=====
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

/** 到期清单预览 · 到期格（P1#13）：相对表达（已逾期 N 天 / 今天 / 明天 / N 天后）+ 逾期着色，
 *  绝对时刻进 title——裸 toLocaleString 读不出「急不急」，未来时刻还会被读成「已经到期」。 */
function dueCell(trace: { dueAt?: string | null }): { text: string; overdue: boolean; title: string } {
  if (!trace.dueAt) return { text: '—', overdue: false, title: '' }
  const ts = new Date(trace.dueAt).getTime()
  if (!Number.isFinite(ts)) return { text: '—', overdue: false, title: '' }
  const abs = new Date(ts).toLocaleString('zh-CN', { hour12: false })
  const days = dayIndexFromToday(trace.dueAt, new Date())
  if (days < 0) return { text: `已逾期 ${-days} 天`, overdue: true, title: `到期时刻 ${abs}（已逾期 ${-days} 天）` }
  if (days === 0) return { text: '今天到期', overdue: false, title: `到期时刻 ${abs}（今天内到期）` }
  if (days === 1) return { text: '明天到期', overdue: false, title: `到期时刻 ${abs}（明天到期）` }
  return { text: `${days} 天后`, overdue: false, title: `到期时刻 ${abs}（${days} 天后到期）` }
}

/** 到期预览 · 记忆强度格 title（B5-F3-3）：来源随痕迹而异——有 FSRS 状态 = FSRS 可提取率；
 *  旧痕迹（无 fsrsStability）= 由掌握度/提取次数回退估算。头部「有 FSRS 状态」只数前者，
 *  两处口径不同，故每格注明来源（后端 fsrsScheduled 字段）。 */
function strengthTitle(trace: { retention: number; fsrsScheduled?: boolean }): string {
  const pct = Math.round(trace.retention * 100)
  return trace.fsrsScheduled === false
    ? `记忆强度 ${pct}%（该痕迹没有 FSRS 状态，按掌握度回退估算）`
    : `记忆强度 ${pct}%（FSRS 可提取率）`
}

/* 枚举中文化（R5：面向运营页主视觉位禁止直出内部标识；2026-10-06 审核 #44）。
   未命中映射时回落原文，原文恒进 title 供排查。 */
const REASON_ZH: Record<string, string> = {
  'interval-elapsed': '间隔到期',
  overdue: '已逾期',
  scheduled: '计划到期',
  'new-trace': '新痕迹首排'
}
const SOURCE_ZH: Record<string, string> = {
  derived: '概念派生',
  'review-event': '复习事件',
  manual: '人工添加',
  consolidated: '归并合并'
}
const reasonText = (r?: string | null) => (r ? REASON_ZH[r] || r : '—')
const sourceText = (s?: string | null) => (s ? SOURCE_ZH[s] || s : '—')

/** 日期时间格式化（#66）：与最近复习列同参（zh-CN 24 小时制带分组），
 *  避免同屏两处时间格式不同（执行时间列原用无参 toLocaleString，随浏览器 locale 变） */
function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—'
}

/** 日差 → 桶位（桶名 = 起始日，尾部并档）：负 = 已逾期；0/1/2 = 今天/明天/2天后；
    3–4 归「3天后」桶；≥5 归「5天后」桶。分档计数与下钻命中集共用同一分桶。 */
function dueBucketIndexOf(dueAt: string, epoch: Date): number {
  const idx = dayIndexFromToday(dueAt, epoch)
  return idx < 0 ? 0 : idx <= 2 ? idx + 1 : idx <= 4 ? 4 : 5
}

const mrDueBand = computed(() => {
  const epoch = new Date()
  const counts = MR_DUE_BAND.map(() => 0)
  for (const row of queueRows.value) {
    counts[dueBucketIndexOf(row.dueAt as string, epoch)] += 1
  }
  return MR_DUE_BAND.map((def, i) => ({ ...def, n: counts[i] }))
})

/* ===== 到期带下钻（2026-10-04 晚贴表分布条）：点某档 = 窗口内该档有到期痕迹的学习者 =====
   队列行自带 userId，可直接归组；再点取消；下钻与列表共用 dueBucketIndexOf 分桶。 */
const dueBandFilter = ref<string | null>(null)
function toggleDueBand(key: string) {
  dueBandFilter.value = dueBandFilter.value === key ? null : key
}
/** 桶 key → 窗口内该档有到期痕迹的学习者集合 */
const dueBucketUsers = computed(() => {
  const map = new Map<string, Set<string>>()
  const epoch = new Date()
  for (const row of queueRows.value) {
    const key = MR_DUE_BAND[dueBucketIndexOf(row.dueAt as string, epoch)].key
    let set = map.get(key)
    if (!set) {
      set = new Set()
      map.set(key, set)
    }
    set.add(row.userId)
  }
  return map
})
/** 下钻后的用户列表（无下钻 = 原列表）；下钻只可能命中窗口内学习者，属已披露口径 */
const visibleRows = computed(() =>
  dueBandFilter.value
    ? rows.value.filter((r) => dueBucketUsers.value.get(dueBandFilter.value!)?.has(r.userId))
    : rows.value
)
/** MkDistBand bins：图例恒六档（含 0 值档），段仅非零（组件内 v-show） */
const mrDueBins = computed(() =>
  mrDueBand.value.map((entry) => ({ key: entry.key, label: entry.name, n: entry.n, tone: entry.tone }))
)

/** 下钻筛空的诚实文案：窗口口径与「前 50 名」口径不同，不能把交集为空说成「窗口内没有」。 */
const dueBandEmpty = computed(() => {
  const band = dueBandFilter.value
  const inWindow = band ? (dueBucketUsers.value.get(band)?.size ?? 0) : 0
  const label = band ? (mrDueBins.value.find((b) => b.key === band)?.label ?? band) : ''
  if (inWindow > 0) {
    return {
      title: `前 ${userPageSize.value} 名里没有该档学习者`,
      desc: `窗口内「${label}」档有 ${inWindow} 位学习者带到期痕迹，但都不在列表前 ${userPageSize.value} 名内（列表按当前每页条数取前 N 名）。再点一次分布条上的同档分段即可取消筛选。`
    }
  }
  return {
    title: '该到期档暂无学习者',
    desc: '窗口内没有学习者的到期痕迹落在这个时间档。再点一次分布条上的同档分段即可取消筛选。'
  }
})

/* 窗口拉取失败或队列为空 → 整块隐藏（不留空卡；失败同 OpsContent pathBandReady 判例静默） */
const traceWindowReady = computed(() => !traceFailed.value && queueRows.value.length > 0)

interface OverviewCard {
  label: string
  value: string | number
  hint: string
  title: string
  tone?: 'ok' | 'warn' | 'bad' | 'muted' | ''
}

/** 页级绝对值单一来源：用户 / 痕迹 / 到期 / 归并队列都只在 KPI 区出现一次（原状态条散文与
 *  概览卡 legend 各重说一遍）。到期与需人工看是运营可行动项，>0 才抬琥珀；其余保持中性墨色。
 *  取数失败（error 非空）时值一律 '—'，禁止把失败静默归零（R2；2026-10-06 审核 #40）；
 *  首屏取数未落定（!overviewReady）时同样显 '—'，不把初值 0 当成真实读数
 *  （B5-F3-2：此前加载中渲染裸 0 + 肯定性副文案「暂无痕迹」，与「确实是 0」不可区分）。 */
const overviewCards = computed<OverviewCard[]>(() => {
  const t = totals.value;
  const failed = !!error.value
  /* 未落定/失败一律 '—'：加载中用中性 muted，失败用 bad（取数不可信） */
  const pending = kpiPending.value
  const na = failed || pending
  const val = (v: number) => (na ? '—' : v)
  const numTone = (tone: OverviewCard['tone']): OverviewCard['tone'] => (failed ? 'bad' : pending ? 'muted' : tone)
  const numHint = (text: string) => (failed ? '取数失败' : pending ? '取数中…' : text)
  return [
    {
      label: '用户',
      value: val(t.users),
      hint: numHint('有记忆痕迹'),
      tone: numTone(''),
      title: '后端口径为全量有记忆痕迹用户；是否含虚拟学习者随状态条开关'
    },
    {
      label: '记忆痕迹',
      value: val(t.traces),
      hint: numHint('跨全部学习路径'),
      tone: numTone(''),
      title: '记忆层痕迹总数（用户级、跨该用户全部 path）'
    },
    {
      label: '当前到期',
      value: val(t.due),
      hint: numHint(t.traces ? `占痕迹 ${duePct.value}%` : '暂无痕迹'),
      tone: numTone(dueWarn.value ? 'warn' : ''),
      title: dueCardTitle.value
    },
    {
      label: '需人工看',
      value: val(t.ambiguous),
      hint: numHint('归并候选 · 不自动执行'),
      tone: numTone(t.ambiguous > 0 ? 'warn' : ''),
      title: '像但不确定的归并候选，需人工确认，不会自动执行'
    },
    {
      label: '待归并建议',
      value: val(t.proposed),
      hint: numHint(`可自动 ${t.autoApplicable} · 已执行 ${t.applied}/${t.deleted}`),
      tone: numTone(''),
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
    { key: 'relearn', label: '需回路径重学', value: plan.relearnSuggestions.length, tone: plan.relearnSuggestions.length > 0 ? 'warn' : '', title: '连续没接上，已退出队列' },
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
/** 明细取数中（T2 硬约束 4：详情加载态用骨架；行内「明细」钮据此禁用，2026-10-06 审核 #45） */
const detailLoading = ref(false)
/** 明细页头标题（打开成功后 nextTick 聚焦，键盘用户不被抛回页顶） */
const detailTitleEl = ref<HTMLElement | null>(null)
/** 本组件根（关闭明细后按 data-mr-row 回焦到触发行） */
const rootEl = ref<HTMLElement | null>(null)
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
    /* 写动作后口径同步（#42）：执行归并会删行，到期时间轴的痕迹窗口/档位计数必须同刷，
       否则窗口内容长期停在旧值（各请求自带 last-wins 代际号，并发安全） */
    await Promise.all([openDetail(selectedId.value), loadOverview(), loadTraceWindow()])
  } catch (e) {
    error.value = errMsg(e)
    // 明细态失败必须有感知（P1#12）：error 渲染点在明细区之外还可能在滚动视野外，toast 兜底
    toast.error(`执行归并失败：${errMsg(e)}`)
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
    /* 回滚会重建被删痕迹：概览 + 明细 + 到期窗口三处口径同刷（#42） */
    await Promise.all([openDetail(selectedId.value), loadOverview(), loadTraceWindow()])
  } catch (e) {
    error.value = errMsg(e)
    toast.error(`回滚失败：${errMsg(e)}`)
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
    const res: any = await adminMemoryReviewApi.overview({ limit: userPageSize.value, offset: (userPage.value - 1) * userPageSize.value, includeVirtual: includeVirtual.value })
    if (seq !== overviewSeq) return // 已有更新的概览请求在途/完成：丢弃过期响应
    const body = res.data?.data ?? res.data ?? {}
    rows.value = Array.isArray(body.users) ? body.users : []
    // 越界页（数据收缩/重算后本页无行）回第 1 页重查一次；已在第 1 页仍空则如实显示空态
    if (!rows.value.length && userPage.value > 1) {
      userPage.value = 1
      return
    }
    totals.value = { ...totals.value, ...(body.totals || {}) }
    overviewReady.value = true
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
  const wasOpen = !!detail.value
  selectedId.value = userId
  detailLoading.value = true
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
    // 首次打开（非刷新）时把焦点移进明细标题（tabindex=-1），键盘用户不被抛回页顶
    if (!wasOpen) {
      await nextTick()
      detailTitleEl.value?.focus()
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
    if (seq === detailSeq) {
      busy.value = false
      detailLoading.value = false
    }
  }
}

/** 页头刷新：概览、到期/强度窗口必刷；已选明细一并刷，避免上下两块数据口径不同步 */
async function refreshAll() {
  await Promise.all([loadOverview(), loadTraceWindow()])
  if (selectedId.value) await openDetail(selectedId.value)
}

/** 收起明细：同时清掉 URL 上的 userId（否则刷新又会弹回来）；
 *  关闭后把焦点还给触发行（键盘用户不被抛回页顶，2026-10-06 审核 #45） */
function closeDetail() {
  const backTo = selectedId.value
  detail.value = null
  selectedId.value = ''
  if (route.query.userId) {
    const next = { ...route.query }
    delete next.userId
    router.replace({ query: next })
  }
  if (backTo) {
    void nextTick(() => {
      rootEl.value?.querySelector<HTMLElement>(`[data-mr-row="${backTo}"]`)?.focus()
    })
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

async function recompute(userId: string, name?: string | null) {
  if (recomputingId.value) return
  /* B5-F3-5：行级写动作补确认——与同后台「学习状态」页的行级「重算」同一口径
     （LearnerCenter askConfirm 判例）。此前点一下就直接 POST /recompute 并跳明细态，
     按其它页习惯点击的运营会无感知地触发写操作（服务端 observe 语义，仍写审计投影行）。 */
  const ok = await askConfirm({
    title: '重新观察',
    message: `确认对「${name || shortId(userId)}」重新跑一次记忆复盘？将重新观察其记忆痕迹与归并建议（只记录建议，不改动记忆痕迹），结果实时刷新。`,
    confirmText: '重新观察',
    danger: false
  })
  if (!ok) return
  busy.value = true
  recomputingId.value = userId
  error.value = ''
  try {
    await adminMemoryReviewApi.recompute(userId)
    /* 重新观察会改到期时刻：概览 + 明细 + 到期窗口三处口径同刷（#42） */
    await Promise.all([openDetail(userId), loadOverview(), loadTraceWindow()])
    toast.success('已完成一次记忆复盘')
  } catch (e) {
    error.value = errMsg(e)
    toast.error(`重新观察失败：${errMsg(e)}`)
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
.mr__due { display: inline-flex; align-items: center; gap: 6px; }
.mr__due b { font-variant-numeric: tabular-nums; font-weight: 700; }
.mr__due--none b { color: var(--mk-faint); font-weight: 400; }
.mr__due--warn b { color: var(--mk-amber); }
.mr__due--high b { color: var(--mk-red-strong); }
/* 比例条已换共享 mk-minibar（tone=warn/bad 由模板 data-tone 驱动；due=0 时宽度为 0 不可见）；页私有只留列内宽度 */
.mr__bar { width: 64px; }
.mr__bar--sm { width: 52px; }

/* 平均记忆强度格（原型 meterrow：小条 + mono %；mk-minibar 全局原语管形状，这里只管排布） */
.mr__strength { display: inline-flex; align-items: center; gap: 8px; }
.mr__strength .mono { color: var(--mk-muted); font-size: var(--mk-fs-micro); }


/* 需人工看：>0 抬成琥珀胶囊；0 压成安静破折号 */
/* 数字胶囊已换共享 mk-badge--sm--warn（私有 color-mix 复刻退役，2026-10-03）；页私有只留数字对齐 */
.mr__need { min-width: 22px; font-variant-numeric: tabular-nums; justify-content: center; }

/* 卡内小节标题（归并审计卡里的三段子列表）：左右 16px 与卡头对齐 */
.mr__h4 { margin: 14px 16px 6px; font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); }
/* 归并表勾选列表头：收窄，别把「选择」撑成正文列宽 */
.mr__th-check { width: 40px; }
/* 归并建议勾选框配色（2026-10-06 审核 #63）：尺寸 16px 属原语层登记豁免
   （mk-primitives.css「checkbox 24px 下限按平台惯例例外」），仅把 accent-color
   从浏览器默认蓝收回品牌蓝（同 .mk-status__scope input 判例） */
.mr__check { accent-color: var(--mk-blue); }
.mr__sub { display: block; color: var(--mk-muted); font-size: var(--mk-fs-micro); }
/* 但写在 <td> 上的降档文本必须是 table-cell：display:block 会把 td 移出表格布局，
   浏览器把连续的非单元格子元素包进同一个匿名单元格，整行自「别名」列起左移一列
   （实测：95% 落在「别名」表头下、理由长文落在「可自动执行」列，最右「理由」恒空）。
   归并建议表与已执行归并表均受影响；非单元格场景（p / small）仍按块渲染。 */
td.mr__sub { display: table-cell; }
/* 卡内说明段（非表格单元格里的 sub 文本）：补 16px 内边距与卡头文字对齐 —— 原来贴着卡左缘，
   看起来像漏排；表格仍按设计通边（单元格自带 padding） */
.mr p.mr__sub { margin: 0; padding: 10px 16px 14px; }
.mr__row--active { background: var(--mk-blue-bg); }
/* 明细态返回钮暗色对比度（2026-10-06 审核 #61）：琥珀染底状态条上 --mk-blue 实测 4.28:1
   （< 正文 4.5:1 门限）。页面侧走 --mk-back-color 覆盖钩子（原语层提亮档属共享改动），
   暗色取 --mk-blue-hover（#6a9cf3，本仓暗色文字提亮档，压琥珀 tint ≥5:1）。 */
html[data-theme='dark'] .mr__back { --mk-back-color: var(--mk-blue-hover); }
/* 明细态错误条（形态走共享 .mk-alert，页私有只留外边距；原 .mr__error micro 字号私有类已撤） */
.mr__detail-error { margin: 8px 16px 0; }

/* 到期清单预览 · 逾期格（P1#13）：逾期红、未来时刻中性墨色——此前未来时刻裸 toLocaleString
   与逾期时刻同貌，「急不急」要人肉换算 */
.mr__overdue { color: var(--mk-red-strong); font-weight: 600; }

.mr__warn { margin: 8px 16px 14px; padding: 8px 10px; border-radius: var(--mk-radius-xl); border: 1px solid color-mix(in srgb, var(--mk-amber) 30%, transparent); background: color-mix(in srgb, var(--mk-amber) 6%, transparent); font-size: var(--mk-fs-micro); }
.mr__chip { display: inline-block; margin-left: 8px; }
/* 明细态容器：二级页里自己是滚动容器（头部返回栏常驻）。flex:1 + min-height:0 缺一不可，
   否则卡片按内容撑高、被 .mk-page--fill 的 overflow:hidden 裁掉 */
.mr__detail { display: grid; gap: 12px; align-content: start; flex: 1; min-height: 0; overflow-y: auto; }
/* 温故计划指标条：MkStatStrip 首格 padding-left:0，放进卡里需自备横向内边距 */
.mr__strip { padding: 8px 16px 10px; border-bottom: 1px solid var(--mk-line); }
/* 明细区百分比列（批E）：数字+色阶条，与概览带/用户表同一语言 */
.mr-pct { display: inline-grid; justify-items: end; gap: 2px; }
.mr-pct b { font-variant-numeric: tabular-nums; font-weight: 700; }
/* 比例条已换共享 mk-minibar（默认蓝承接原绿档；warn 琥珀由模板 data-tone 驱动，2026-10-03） */
.mr-pct--warn b { color: var(--mk-amber); }
/* 审计处理队列（批E）：复用概览带队列格语言 */
/* auto-fit：窄屏不挤成 5 等份，宽屏不浪费（原固定 repeat(5) 在窄屏下每格 <100px） */
.mr-audit-queue { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; padding: 10px 16px 4px; }
.mr-audit-queue__item { display: grid; gap: 1px; padding: 8px 11px; border-radius: var(--mk-radius-lg); background: var(--mk-surface-2); }
.mr-audit-queue__item--hot { background: color-mix(in srgb, var(--mk-amber) 10%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mk-amber) 32%, transparent); }
.mr-audit-queue__item--hot b { color: var(--mk-amber); }
.mr-audit-queue__item--quiet { background: transparent; }
.mr-audit-queue__item b { font-size: 18px; font-weight: 800; color: var(--mk-ink); font-variant-numeric: tabular-nums; }
.mr-audit-queue__item b i { font-style: normal; font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-faint); }
.mr-audit-queue__item span { font-size: var(--mk-fs-micro); color: var(--mk-muted); } /* 12px 下限（设计语言规则 5），原 11px */
.mr__sub-inline { margin-left: 8px; font-weight: 400; color: var(--mk-muted, #5b6577); font-size: var(--mk-fs-micro); }
.mr__bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 6px 16px 10px; }
.mr__warn-inline { color: var(--mk-amber); font-size: var(--mk-fs-micro); }
</style>
