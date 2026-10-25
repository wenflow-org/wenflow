<template>
  <!-- 记忆调度与治理面板（2026-10-12 用户拍板「合并过去，保留详情页一个」）：
       原 /admin/memory-review 独立页（列表态 + 明细态）退役，明细五卡整体并入
       学习者详情「记忆与复习」页签；本组件只服务单个用户（userId prop），
       路由 /admin/memory-review 保留为重定向 shim（旧深链/收藏可达）。 -->
  <div class="mr-panels">
    <!-- 取数失败人类必须可感知（P1#12）：错误条在面板顶层，明细缺失时也能看见 -->
    <p v-if="error" class="mk-alert mr__detail-error" role="alert">{{ error }}</p>

    <!-- 明细取数中：骨架占位（T2 硬约束 4） -->
    <template v-if="detailLoading && !detail">
      <div class="mr__detail mr__detail--embed">
        <MockSkeletonTable :cols="4" :rows="4" />
      </div>
    </template>

    <p v-else-if="!detail" class="mr__sub mr-panels__empty">该学习者暂无可复盘的记忆数据。</p>

    <template v-else>

      <!-- 2026-10-23 用户「有什么意义吗下面表格都有了」：原面板栏「记忆调度与治理 + 痕迹/到期/
           同族重复/从未提取/有强度数据」整条撤除——五个数全由下面各卡的表格/空态表达，栏名又与
           页签名「记忆调度」重复。唯一有动作价值的「重新观察」并入概念归并审计卡头（结果就长在那张卡里）。 -->
      <div class="mr__detail mr__detail--embed">
      <!-- 1. 课内温故计划：本节该接几个 + 每个记忆点的负担与来源 -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">课内温故计划</h3>
          <!-- 2026-10-23 用户走查「还有后面的这几种文案」：撤掉「本节该接几个 · 按负担预算排队」——
               下面指标条已逐项给出负担预算/已占用/本节接几个/排队中，卡头再说一遍规则是复述 -->
        </div>

        <!-- 温故计划整块按 detail.reviewPlan 有无渲染：reviewPlan=null 时原来只剩一个裸标题 -->
        <template v-if="detail.reviewPlan">
          <!-- 指标条走 grid 档（读数条，与虚拟学习者页头同构）：2026-10-11 用户走查「都挤在
               左侧」——inline 档自由宽度在 1.5k 宽的卡里左侧聚堆，grid 档 auto-fit 等宽格撑满 -->
          <div class="mr__strip"><MkStatStrip :items="planKpiItems" layout="grid" aria-label="课内温故计划指标" /></div>

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
                <td>{{ reasonText(item.reason) }}</td>
                <td class="mk-num">{{ item.load }}</td>
                <td class="mr__sub">{{ loadFactorText(item.loadFactors) }}</td>
                <td>
                  <!-- 来源路径可点（2026-10-12 走查「记忆与复习的跳转」）：记忆的出处此前是死文本，
                       openSubPage('path') 走适配层反查会话进路径座舱；from 带上所属学习者详情，
                       座舱返回钮据它命名并回跳 -->
                  <button
                    v-if="item.originPathId && item.originPathTitle"
                    type="button"
                    class="mk-link"
                    @click="openPath(item.originPathId)"
                  >{{ item.originPathTitle }}</button>
                  <template v-else>{{ item.originPathTitle || '—' }}</template>
                </td>
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

      <!-- 2. 概念归并审计：可写动作（勾选执行 / 单条确认 / 驳回 / 回滚），默认观察模式。
           R7 概念本体治理批：三组建议（归并 / 需人工看 / 散键清理）全部给出入口——
           此前 dropCandidates 只在类型里声明计数（审计 CC-2）、ambiguous 无操作位； -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">概念归并审计</h3>
          <!-- 来源（任务书 B：每条建议可见来源——同组建议同源，来源挂在卡头不逐行复读）。
               未观察状态不放卡头（2026-10-23 用户「这几种文案」）：改为卡内一行空态，卡头只报来源 -->
          <span v-if="detail.audit" class="mk-card__meta">来源：概念归并观察（{{ detail.audit.mode === 'apply' ? '自动执行' : '观察' }}模式）· {{ timeAgo(detail.audit.generatedAt) }}</span>
          <!-- 重新观察：原面板栏唯一有动作价值的一项，跟着它产出的建议走（未观察时也是这张卡的动作） -->
          <button
            type="button"
            class="mk-btn mk-btn--sm"
            :disabled="recomputing"
            title="重新跑一次该用户的记忆复盘，结果实时刷新"
            @click="recompute"
          >{{ recomputing ? '观察中…' : '重新观察' }}</button>
          <!-- 已执行历史入口（R7 任务书 B：mode=apply 审计一个入口可见）：默认展开保持既有可达性，
               可收起给三组建议让出主视觉；aria-expanded 供读屏 -->
          <button
            v-if="detail.audit && appliedHistoryCount > 0"
            type="button"
            class="mk-btn mk-btn--sm"
            :aria-expanded="historyOpen"
            title="该用户已执行过的归并记录（含别名归并），可回滚"
            @click="historyOpen = !historyOpen"
          >已执行历史（{{ appliedHistoryCount }}）</button>
        </div>
        <!-- 审计计数（批E）：卡头 6 计数平摊 → 处理队列四格（与概览带同一语言）；R7 补「散键清理」格 -->
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
          <div class="mr-audit-queue__item" :class="{ 'mr-audit-queue__item--hot': mrAmbiguousCount > 0 }">
            <b>{{ mrAmbiguousCount }}</b><span>需人工看</span>
          </div>
          <div class="mr-audit-queue__item" :class="{ 'mr-audit-queue__item--hot': mrDropCount > 0 }">
            <b>{{ mrDropCount }}</b><span>散键清理</span>
          </div>
          <div class="mr-audit-queue__item mr-audit-queue__item--quiet">
            <b>{{ detail.audit.stats.applied }}<i>/{{ detail.audit.stats.deleted }}</i></b><span>已执行 / 删除</span>
          </div>
        </div>

        <!-- 未观察：卡内一行空态（动作钮「重新观察」在面板栏，那里是唯一入口） -->
        <p v-if="!detail.audit" class="mr__sub">尚未观察过这个用户的记忆归并。</p>

        <template v-if="detail.audit">
          <!-- 归并处理条（2026-10-19 用户走查「这个重新设计一下」）：原实现是三枚小按钮飘在
               「归并建议」标题与表格之间，既看不出作用范围（其实同时覆盖三组建议），
               0 选中时还挂着一条禁用的「执行选中（0）」。现改为卡内工具条：左侧常驻读数，
               右侧动作按状态显隐（无可自动执行项时不摆死按钮），警告另起一行常显。 -->
          <div
            v-if="hasSuggestions"
            class="mr-bulk"
            :class="{ 'is-active': selectedTotal > 0 }"
            role="group"
            aria-label="批量处理选中建议"
          >
            <div class="mr-bulk__status" aria-live="polite">
              <template v-if="selectedTotal">
                <span class="mr-bulk__count">已选 {{ selectedTotal }} 项</span>
                <span class="mr-bulk__parts">{{ selectedPartsText }}</span>
              </template>
              <template v-else>
                <span class="mr-bulk__count">批量处理</span>
                <span class="mr-bulk__parts">{{ bulkHintText }}</span>
              </template>
            </div>
            <div class="mr-bulk__actions">
              <button
                v-if="autoApplicableCount"
                type="button"
                class="mk-btn mk-btn--sm"
                @click="selectAllApplicable"
              >全选可自动执行（{{ autoApplicableCount }}）</button>
              <button v-if="selectedTotal" type="button" class="mk-link" @click="clearSelection">清空</button>
              <button
                v-if="selectedTotal"
                type="button"
                class="mk-btn mk-btn--sm mk-btn--danger-ghost"
                :disabled="busy"
                @click="applySelected"
              >{{ busy ? '执行中…' : `执行选中（${selectedTotal}）` }}</button>
            </div>
            <p v-if="bulkWarnText" class="mr-bulk__warn">{{ bulkWarnText }}</p>
          </div>

          <h4 class="mr__h4">
            归并建议（将别名并入主概念）
          </h4>
          <div v-if="detail.audit.proposals.length" class="mk-table-scroll">
          <table class="mk-table">
            <!-- 列宽契约（2026-10-12 外部批评采纳：归并目标列 301px 概念名折行）：A/B 与散键列
                 给保底宽，证据列不写 width 独吞余量（948px 案判例：留一列不写 = 它吸收余量） -->
            <colgroup>
              <col style="width: 40px" />
              <col style="width: 22%" />
              <col />
              <col style="width: 96px" />
              <col style="width: 116px" />
              <col style="width: 96px" />
              <col style="width: 132px" />
            </colgroup>
            <thead>
              <tr>
                <th class="mr__th-check">选择</th>
                <th>归并目标</th><th>证据（别名 · 理由）</th><th class="mk-num">置信度</th><th class="mk-num">名称相似度</th>
                <th>可自动执行</th><th class="mk-th--right">操作</th>
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
                <td class="mr__sub">
                  <div>{{ proposal.aliases.join(' / ') }}</div>
                  <div>{{ proposal.rationale || '—' }}</div>
                </td>
                <td class="mk-num">
                  <span class="mr-pct" :title="`置信度 ${Math.round(proposal.confidence * 100)}%`">
                    <b>{{ Math.round(proposal.confidence * 100) }}%</b>
                    <span class="mk-minibar mr__bar mr__bar--sm" aria-hidden="true"><i class="mk-minibar__fill" :style="{ width: Math.round(proposal.confidence * 100) + '%' }"></i></span>
                  </span>
                </td>
                <td class="mk-num">
                  <span class="mr-pct" :class="{ 'mr-pct--warn': !proposal.autoApplicable }" :title="`名称相似度 ${Math.round(proposal.lexicalSimilarity * 100)}%${proposal.autoApplicable ? '' : '（相似度不足，需人工确认）'}`">
                    <b>{{ Math.round(proposal.lexicalSimilarity * 100) }}%</b>
                    <span class="mk-minibar mr__bar mr__bar--sm" aria-hidden="true"><i class="mk-minibar__fill" :data-tone="proposal.autoApplicable ? undefined : 'warn'" :style="{ width: Math.round(proposal.lexicalSimilarity * 100) + '%' }"></i></span>
                  </span>
                </td>
                <td>
                  <!-- 词面闸门结果用胶囊（原型记忆域 pill 状态词汇；与上方审计队列「可自动/需人工看」同标签） -->
                  <span
                    class="mk-badge"
                    :class="proposal.autoApplicable ? 'mk-badge--ok' : 'mk-badge--warn'"
                  >{{ proposal.autoApplicable ? '可自动' : '需人工确认' }}</span>
                </td>
                <td>
                  <div class="mk-actions">
                    <button
                      type="button"
                      class="mk-btn mk-btn--sm"
                      :disabled="busy"
                      title="确认执行这条归并"
                      @click="applyOne({ canonicals: [proposal.canonical] }, `归并「${proposal.aliases.join('、')}」→「${proposal.canonical}」`, { includeNeedsReview: !proposal.autoApplicable })"
                    >确认</button>
                    <button
                      type="button"
                      class="mk-btn mk-btn--sm"
                      :disabled="busy"
                      :title="REJECT_BTN_HINT"
                      @click="rejectOne({ canonicals: [proposal.canonical] }, `归并建议「${proposal.canonical}」`)"
                    >驳回</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          </div>
          <p v-else class="mr__sub">本次没有达到置信度阈值的归并建议。</p>

          <h4 class="mr__h4">
            需人工看（不会自动执行）
            <span class="mr__sub-inline">置信度不足，需人工确认</span>
          </h4>
          <div v-if="detail.audit.ambiguous.length" class="mk-table-scroll">
          <table class="mk-table">
            <!-- 列宽契约同归并建议表：A/B 保底宽防概念名折行，证据列吞余量 -->
            <colgroup>
              <col style="width: 40px" />
              <col style="width: 21%" />
              <col style="width: 19%" />
              <col />
              <col style="width: 132px" />
            </colgroup>
            <!-- 表头补明「候选 A / B 是概念键」（2026-10-06 审核 #62）：原表头只写 A / B
                 两个单字母；A/B 两列是无人类可读 label 的裸 conceptKey，与另三表同降 .mr__sub 档。
                 R7：补 选择/操作 两列——此前这组建议只可看不可动（审计 CC-2） -->
            <thead><tr><th class="mr__th-check">选择</th><th>归并目标（候选 A）</th><th>并入（候选 B）</th><th>证据（理由）</th><th class="mk-th--right">操作</th></tr></thead>
            <tbody>
              <tr v-for="(item, index) in detail.audit.ambiguous" :key="`${item.a}-${item.b}-${index}`">
                <td>
                  <input
                    type="checkbox"
                    class="mr__check"
                    :checked="selectedAmbiguous[ambiguousKey(item)] === true"
                    :aria-label="`勾选执行归并：${item.b} 并入 ${item.a}（需人工确认）`"
                    @change="toggleSelectAmbiguous(item)"
                  />
                </td>
                <td class="mr__sub">{{ item.a }}</td>
                <td class="mr__sub">{{ item.b }}</td>
                <td class="mr__sub">{{ item.reason || '—' }}</td>
                <td>
                  <div class="mk-actions">
                    <button
                      type="button"
                      class="mk-btn mk-btn--sm"
                      :disabled="busy"
                      title="确认这确实是同一概念，执行归并"
                      @click="applyOne({ ambiguous: [{ a: item.a, b: item.b }] }, `「${item.b}」并入「${item.a}」`, { includeNeedsReview: true })"
                    >确认</button>
                    <button
                      type="button"
                      class="mk-btn mk-btn--sm"
                      :disabled="busy"
                      :title="REJECT_BTN_HINT"
                      @click="rejectOne({ ambiguous: [{ a: item.a, b: item.b }] }, `人工确认对「${item.a} ← ${item.b}」`)"
                    >驳回</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          </div>
          <p v-else class="mr__sub">没有待人工确认项。</p>

          <h4 class="mr__h4">
            散键清理（误提取的无用概念）
            <span class="mr__sub-inline">误提取的无用概念，确认后清理</span>
          </h4>
          <!-- R7 任务书 B：dropCandidates 此前只在类型里声明计数、从不渲染（审计 CC-2）——补第三组建议列表 -->
          <div v-if="mrDropCount" class="mk-table-scroll">
          <table class="mk-table">
            <colgroup>
              <col style="width: 40px" />
              <col style="width: 24%" />
              <col />
              <col style="width: 132px" />
            </colgroup>
            <thead><tr><th class="mr__th-check">选择</th><th>散键（概念标识）</th><th>证据（理由）</th><th class="mk-th--right">操作</th></tr></thead>
            <tbody>
              <tr v-for="(drop, index) in detail.audit.dropCandidates" :key="`${drop.conceptKey}-${index}`">
                <td>
                  <input
                    type="checkbox"
                    class="mr__check"
                    :checked="selectedDrops[drop.conceptKey] === true"
                    :aria-label="`勾选清理散键：${drop.conceptKey}`"
                    @change="toggleSelectDrop(drop.conceptKey)"
                  />
                </td>
                <td class="mr__sub">{{ drop.conceptKey }}</td>
                <td class="mr__sub">{{ drop.reason || '—' }}</td>
                <td>
                  <div class="mk-actions">
                    <button
                      type="button"
                      class="mk-btn mk-btn--sm"
                      :disabled="busy"
                      title="确认清理该散键"
                      @click="applyOne({ drops: [drop.conceptKey] }, `清理散键「${drop.conceptKey}」`)"
                    >确认</button>
                    <button
                      type="button"
                      class="mk-btn mk-btn--sm"
                      :disabled="busy"
                      :title="REJECT_BTN_HINT"
                      @click="rejectOne({ drops: [drop.conceptKey] }, `散键清理「${drop.conceptKey}」`)"
                    >驳回</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          </div>
          <p v-else class="mr__sub">没有待清理的散键。</p>

          <!-- 已执行历史（R7 任务书 B：mode=apply 审计一个入口可见——卡头「已执行历史」开关；
               默认展开保持既有可达性）。含破坏性归并凭据与 alias 式归并凭据两族。
               2026-10-12 用户走查「这个地方再优化一下」：两族全空时不再铺两个幽灵标题
               （两个 h4 + 两句「没有可回滚的…」共 166px 死区，且卡头开关此时也不渲染），
               收成一行留痕；有任一族记录才展开两段式——单族空态在另一族有数据时保留，承担对照语义 -->
          <template v-if="historyOpen">
          <template v-if="appliedHistoryCount > 0">
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
            另有 {{ legacyWindowOnlyMerges.length }} 条早期归并：已超出可回滚保留期，页面内暂不支持回滚，如需回滚请联系管理员——
            {{ legacyWindowOnlyMerges.map((m) => m.canonical).slice(0, 3).join('、') }}
          </p>
          <p v-if="rolledBackMerges.length" class="mr__sub">
            已回滚 {{ rolledBackMerges.length }} 条（保留凭据痕迹，不再重复回滚）：
            {{ rolledBackMerges.map((m) => m.canonical).slice(0, 3).join('、') }}
          </p>

          <!-- alias 式归并（S3 非破坏策略，现行默认）：凭据同样按次留档；此前前端从未渲染（detail 里一直有） -->
          <h4 class="mr__h4">别名归并（不删除记录：登记别名并改指向）</h4>
          <div v-if="appliedAliasRollbackable.length" class="mk-table-scroll">
          <table class="mk-table">
            <thead><tr><th>归并目标</th><th>别名</th><th class="mk-num">改指向记录数</th><th>执行时间</th><th></th></tr></thead>
            <tbody>
              <tr v-for="merge in appliedAliasRollbackable" :key="merge.aliasMergeId || `${merge.canonical}-${merge.appliedAt}`">
                <td class="mr__sub">{{ merge.canonical }}</td>
                <td class="mr__sub">{{ merge.aliases.join(' / ') }}</td>
                <td class="mk-num">{{ merge.repointedRows }}</td>
                <td><span class="mk-cell-sub mono" :title="merge.appliedAt">{{ fmtDateTime(merge.appliedAt) }}</span></td>
                <td>
                  <button type="button" class="mk-btn mk-btn--sm" :disabled="busy" title="回滚该归并：删除别名并还原记录指向" @click="rollbackOne(merge.canonical)">回滚</button>
                </td>
              </tr>
            </tbody>
          </table>
          </div>
          <p v-else class="mr__sub">没有可回滚的别名归并。</p>
          <p v-if="appliedAliasLegacy.length" class="mr__sub">
            另有 {{ appliedAliasLegacy.length }} 条早期别名归并：已超出可回滚保留期，页面内暂不支持回滚。
          </p>
          <p v-if="appliedAliasRolledBack.length" class="mr__sub">
            已回滚 {{ appliedAliasRolledBack.length }} 条 alias 归并（保留凭据痕迹，不再重复回滚）：
            {{ appliedAliasRolledBack.map((m) => m.canonical).slice(0, 3).join('、') }}
          </p>
          </template>
          <p v-else class="mr__sub">已执行的归并 / 别名归并：暂无记录（执行后在此按次留档、可回滚）。</p>
          </template>
        </template>
      </section>

      <!-- 3. 到期清单预览：到期积压的证据（谁先到期、掌握多少）。排在审计卡之后（2026-10-12
           外部批评采纳：审计是本页签主动作，证据卡放后面，不再把它挤到首屏之下） -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">到期清单预览</h3>
          <!-- 2026-10-23 用户走查：排序状态归列头 caret / aria-sort，卡头只说真正影响读数含义的一件事
               ——这里只预览前 20 条（不写「记忆强度升序」及排序/回退估算的机制解释） -->
          <span class="mk-card__meta" title="全部到期痕迹里只预览 20 条，排序在截断之前完成">仅前 20 条</span>
        </div>
        <div v-if="detail.duePreview.length" class="mk-table-scroll">
          <table class="mk-table">
          <thead><tr>
            <th>概念</th>
            <th
              scope="col"
              class="mk-num mk-th--sortable"
              :title="dueStrengthTitle"
              :aria-sort="dueSortState('retention')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleDueSort('retention')">记忆强度<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              scope="col"
              class="mk-num mk-th--sortable"
              title="记忆模型给出的掌握分。点列头排序：升序 = 掌握最弱的在前，降序 = 已掌握但到期的在前"
              :aria-sort="dueSortState('mastery')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleDueSort('mastery')">掌握<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              scope="col"
              class="mk-num mk-th--sortable"
              title="点列头排序：降序 = 复现最多的在前"
              :aria-sort="dueSortState('extractions')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleDueSort('extractions')">提取次数<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th>来源</th>
            <th
              scope="col"
              class="mk-th--sortable"
              title="相对表达：已逾期 N 天 / 今天 / 明天 / N 天后。点列头排序：升序 = 逾期最久的在前"
              :aria-sort="dueSortState('due')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleDueSort('due')">到期<span class="mk-th__caret" aria-hidden="true"></span></button></th>
          </tr></thead>
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
              <td class="mr__sub">{{ sourceText(trace.source) }}</td>
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
        <MkEmptyState v-else title="当前没有到期点" description="该用户的记忆痕迹都还没到复习时间；到期后会在这里列出前 20 条。" />
      </section>

      <!-- 4. 同族重复：措辞不同、说的是同一件事（归并的输入） -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">同族重复</h3>
          <!-- 2026-10-23：撤掉「措辞不同、含义相同的记录」——卡名已是这件事，下面每一行就是同义成员本身 -->
        </div>
        <p v-if="!detail.duplicatedFamilies.length" class="mr__sub">没有同族重复。</p>
        <div v-else class="mk-table-scroll">
          <table class="mk-table">
          <thead><tr><th>重复组</th><th class="mk-num">条数</th><th>成员</th></tr></thead>
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
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { adminMemoryReviewApi } from '@/api/adminApi'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkStatStrip from '@/components/mk/MkStatStrip.vue'
import MockSkeletonTable from './SkeletonTable.vue'
import type { MkStatItem } from '@/components/mk/MkStatStrip.vue'
import { askConfirm } from './useConfirm'
import { useTableSort } from './useTableSort'
import { openSubPage, subPage } from './store'
import { toast } from '@/utils/toast'
import { errMsg, shortId, timeAgo } from './live'

const props = defineProps<{ userId: string }>()

/* 文案单源（R6 复读单源化）：三处「驳回」动作钮的悬停释共用一份 */
const REJECT_BTN_HINT = '驳回后不再提示，不影响学习记录'

interface AppliedMergeView {
  mergeId: string | null
  canonical: string
  aliases: string[]
  appliedAt: string
  rolledBackAt: string | null
  deletedRows: number
}

/** alias 式归并凭据视图（S3 非破坏策略；R7 已执行历史入口新增渲染——此前 detail 一直回、前端从未声明） */
interface AppliedAliasMergeView {
  aliasMergeId: string | null
  canonical: string
  aliases: string[]
  appliedAt: string
  rolledBackAt: string | null
  repointedRows: number
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
  /** 来源路径 id（2026-10-12 走查「记忆与复习的跳转」）：标题从死文本升级为可点进路径座舱；旧后端无此字段 */
  originPathId?: string | null
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
    /** R7：散键清理建议（ConceptConsolidationAudit.dropCandidates；此前只声明过计数 drops、从不渲染） */
    dropCandidates?: Array<{ conceptKey: string; reason: string }>
  } | null
  appliedMerges?: {
    rollbackable: AppliedMergeView[]
    rolledBack: AppliedMergeView[]
    legacyWindowOnly: AppliedMergeView[]
  }
  appliedAliasMerges?: {
    rollbackable: AppliedAliasMergeView[]
    rolledBack: AppliedAliasMergeView[]
    legacyWindowOnly: AppliedAliasMergeView[]
  }
  duplicatedFamilies: Array<{ family: string; size: number; members: Array<{ conceptKey: string; extractionCount: number; masteryScore: number }> }>
  duePreview: Array<{ conceptKey: string; label: string; retention: number; masteryScore: number; extractionCount: number; source?: string | null; dueAt?: string | null; fsrsScheduled?: boolean }>
  /** 到期清单预览实际生效的排序（后端回显；排序在截断前执行） */
  dueSort?: { key: string; order: 'asc' | 'desc' }
}

const rollbackableMerges = computed<AppliedMergeView[]>(() => detail.value?.appliedMerges?.rollbackable ?? [])
const rolledBackMerges = computed<AppliedMergeView[]>(() => detail.value?.appliedMerges?.rolledBack ?? [])
const legacyWindowOnlyMerges = computed<AppliedMergeView[]>(() => detail.value?.appliedMerges?.legacyWindowOnly ?? [])
/* alias 式归并凭据（R7 已执行历史入口）：非破坏策略的执行记录（现行默认策略，此前前端从未渲染） */
const appliedAliasRollbackable = computed<AppliedAliasMergeView[]>(() => detail.value?.appliedAliasMerges?.rollbackable ?? [])
const appliedAliasRolledBack = computed<AppliedAliasMergeView[]>(() => detail.value?.appliedAliasMerges?.rolledBack ?? [])
const appliedAliasLegacy = computed<AppliedAliasMergeView[]>(() => detail.value?.appliedAliasMerges?.legacyWindowOnly ?? [])
/** 已执行历史入口计数（卡头「已执行历史（N）」）：两族凭据合计 */
const appliedHistoryCount = computed(
  () =>
    rollbackableMerges.value.length +
    rolledBackMerges.value.length +
    legacyWindowOnlyMerges.value.length +
    appliedAliasRollbackable.value.length +
    appliedAliasRolledBack.value.length +
    appliedAliasLegacy.value.length
)
/** 已执行历史展开态（默认展开保持既有可达性；收起给三组建议让出主视觉） */
const historyOpen = ref(true)
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

/* ---------- 到期清单预览的排序（2026-10-18 用户走查「排序呢」）----------
   为什么是服务端排序：这张卡只发前 20 条（后端 dueTraces.slice(0,20)），客户端排序
   只会在那 20 条里换序，读起来像「按掌握排序」其实不是——useTableSort 头注明的
   截断列表禁用判例。故排序键当请求参数下发、在后端截断之前生效（判例 ExecLogs 服务端排序），
   这里只用它的状态/语义（caret + aria-sort），不调用 sortRows。 */
const {
  toggle: toggleDueSort,
  sortState: dueSortState,
  sortKey: dueSortKey,
  sortDir: dueSortDir
} = useTableSort({
  keys: ['retention', 'mastery', 'extractions', 'due'],
  defaultKey: 'retention',
  defaultDir: 'asc'
})
/** 记忆强度列头：口径 + 本页回退估算条数（2026-10-23 卡头长释撤除，数据质量就地下钻到这一列） */
const dueStrengthTitle = computed(
  () =>
    '由记忆模型计算的记住概率' +
    (duePreviewLegacyCount.value ? `（本页 ${duePreviewLegacyCount.value} 条为旧记录回退估算）` : '') +
    '。点列头排序：升序 = 越靠前越该先复习'
)

const busy = ref(false)
const error = ref('')

/* ---- 到期/来源的枚举中文化与相对表达（自原独立页明细态原样迁移） ---- */

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
  'kt-estimate': 'KT 估算',
  'review-event': '复习事件',
  manual: '人工添加',
  consolidated: '归并合并'
}
const reasonText = (r?: string | null) => (r ? REASON_ZH[r] || r : '—')
const sourceText = (s?: string | null) => (s ? SOURCE_ZH[s] || s : '—')
/* 负担因子码（review-plan / concept-load 的内部键）→ 运营词：
   2026-10-23 走查「负担因子列在写 granularity:compound」——枚举码不得直出界面。 */
const LOAD_FACTOR_ZH: Record<string, string> = {
  'granularity:long': '表述过长',
  'granularity:compound': '复合概念',
  'type:process': '过程型',
  'llm:cluster': '技能簇',
  'llm:procedural': '过程型',
  'llm:hard': '难度高'
}
const loadFactorText = (factors: string[] | undefined) =>
  (factors || []).map((f) => LOAD_FACTOR_ZH[f] || f).join('、') || '—'

/** 日期时间格式化（#66）：与最近复习列同参（zh-CN 24 小时制带分组），
 *  避免同屏两处时间格式不同（执行时间列原用无参 toLocaleString，随浏览器 locale 变） */
function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—'
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
      title: '低于 70% 时收缩安排，高于 90% 时扩大安排'
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

const detail = ref<ReviewDetail | null>(null)
/** 明细取数中（T2 硬约束 4：详情加载态用骨架） */
const detailLoading = ref(false)
/** 勾选状态（R7：三组建议共用一套「选中 → 执行」，组内 key 唯一）；归并建议默认只勾「可自动执行」的 */
const selected = ref<Record<string, boolean>>({})
/** 需人工看对的勾选（key = `${a} => ${b}`）；散键清理的勾选（key = conceptKey）默认不勾 */
const selectedAmbiguous = ref<Record<string, boolean>>({})
const selectedDrops = ref<Record<string, boolean>>({})

const selectedKeys = computed(() => Object.keys(selected.value).filter((key) => selected.value[key]))
const selectedNeedsReview = computed(() => {
  const proposals = detail.value?.audit?.proposals ?? []
  return selectedKeys.value.filter((key) => {
    const proposal = proposals.find((item: any) => item.canonical === key)
    return proposal && !proposal.autoApplicable
  })
})

/** 需人工看对的勾选键（同序渲染用同一把 key） */
function ambiguousKey(item: { a: string; b: string }): string {
  return `${item.a} => ${item.b}`
}
/** 勾中的「需人工看」对（执行时随确认列表上送） */
const selectedAmbiguousPairs = computed(() =>
  (detail.value?.audit?.ambiguous ?? [])
    .filter((item) => selectedAmbiguous.value[ambiguousKey(item)] === true)
    .map((item) => ({ a: item.a, b: item.b }))
)
/** 勾中的散键清理建议 */
const selectedDropKeys = computed(() =>
  (detail.value?.audit?.dropCandidates ?? [])
    .filter((drop) => selectedDrops.value[drop.conceptKey] === true)
    .map((drop) => drop.conceptKey)
)
/** 三组合计的选中数（批量执行按钮读数） */
const selectedTotal = computed(
  () => selectedKeys.value.length + selectedAmbiguousPairs.value.length + selectedDropKeys.value.length
)
/** 三组建议有没有可展示的行（批量条只在有建议时出现） */
const hasSuggestions = computed(() => {
  const audit = detail.value?.audit
  if (!audit) return false
  return audit.proposals.length > 0 || audit.ambiguous.length > 0 || (audit.dropCandidates?.length ?? 0) > 0
})
/** 可自动执行的建议数：按钮读数与「死按钮」判据都取渲染行，不取审计统计口径 */
const autoApplicableCount = computed(
  () => (detail.value?.audit?.proposals ?? []).filter((item) => item.autoApplicable).length
)
/** 选中项构成：批量执行同时覆盖三组建议，工具条要说清这次会动到哪几组 */
const selectedPartsText = computed(() => {
  return [
    selectedKeys.value.length ? `归并 ${selectedKeys.value.length}` : '',
    selectedAmbiguousPairs.value.length ? `人工确认对 ${selectedAmbiguousPairs.value.length}` : '',
    selectedDropKeys.value.length ? `散键 ${selectedDropKeys.value.length}` : ''
  ].filter(Boolean).join(' · ')
})
/** 0 选中时的引导：无可自动执行项时不摆一枚永远点不动的「全选」按钮 */
const bulkHintText = computed(() =>
  autoApplicableCount.value
    ? '勾选条目后批量执行，或全选可自动执行的建议'
    : '逐条核对后勾选，本次没有可自动执行的建议'
)
const bulkWarnText = computed(() => {
  const parts = [
    selectedNeedsReview.value.length ? `${selectedNeedsReview.value.length} 条属于「需人工确认」` : '',
    selectedAmbiguousPairs.value.length ? `${selectedAmbiguousPairs.value.length} 条「需人工看」对` : ''
  ].filter(Boolean)
  return parts.length ? `选中项里 ${parts.join('、')}，执行前请核对证据` : ''
})
/** 散键清理建议计数（审计队列格 + 列表空态分支共用） */
const mrDropCount = computed(() => (detail.value?.audit?.dropCandidates ?? []).length)
/** 需人工看的对数：取渲染行而非 stats.ambiguous——真实接口不返回该字段，格子会成空读数 */
const mrAmbiguousCount = computed(() => detail.value?.audit?.ambiguous.length ?? 0)

function resetSelection(audit?: ReviewDetail['audit']) {
  const next: Record<string, boolean> = {}
  for (const proposal of audit?.proposals ?? []) next[proposal.canonical] = !!proposal.autoApplicable
  selected.value = next
  selectedAmbiguous.value = {}
  selectedDrops.value = {}
}

function toggleSelect(canonical: string, _auto: boolean) {
  selected.value = { ...selected.value, [canonical]: !selected.value[canonical] }
}

function toggleSelectAmbiguous(item: { a: string; b: string }) {
  const key = ambiguousKey(item)
  selectedAmbiguous.value = { ...selectedAmbiguous.value, [key]: !selectedAmbiguous.value[key] }
}

function toggleSelectDrop(conceptKey: string) {
  selectedDrops.value = { ...selectedDrops.value, [conceptKey]: !selectedDrops.value[conceptKey] }
}

function selectAllApplicable() {
  const next: Record<string, boolean> = {}
  for (const proposal of detail.value?.audit?.proposals ?? []) next[proposal.canonical] = !!proposal.autoApplicable
  selected.value = next
}

function clearSelection() {
  selected.value = {}
  selectedAmbiguous.value = {}
  selectedDrops.value = {}
}

/** 来源路径 → 路径座舱：本组件住在学习者详情（subPage）里，from 带上所属 subPage，
 *  座舱返回钮据此回学习者详情并命名「← 学习者」（LearnerDetail 打开座舱的同款三参）。 */
function openPath(pathId: string) {
  const sp = subPage.value
  openSubPage('path', pathId, sp ? { from: { view: sp.view, id: sp.id, label: sp.label } } : undefined)
}

/** apply 的迁移面（R7 outlet 域任务书 A：合并面 = 所有按「用户 × 概念键」键控的表；
 *  服务端以其实际合并语义为准，这里列进确认弹层——任务书 D：批量 apply 是破坏性操作，
 *  二次确认弹层必须列明将迁移哪些表）。 */
const MERGE_MIGRATED_TABLES = [
  '记忆记录',
  '学习证据',
  '概念掌握情况',
  '误解记录'
].join('\n')

/** 批量执行选中项（三组建议同一入口）：确认弹层列明迁移表 → apply（确认列表 = 勾选的规范键 + 对 + 散键） */
async function applySelected() {
  const canonicals = selectedKeys.value
  const ambiguous = selectedAmbiguousPairs.value
  const drops = selectedDropKeys.value
  const total = canonicals.length + ambiguous.length + drops.length
  if (!total) return
  const needsReview = selectedNeedsReview.value.length + ambiguous.length
  const parts = [
    canonicals.length ? `归并 ${canonicals.length} 条` : '',
    ambiguous.length ? `人工确认对 ${ambiguous.length} 条` : '',
    drops.length ? `散键清理 ${drops.length} 条` : ''
  ].filter(Boolean).join(' · ')
  const ok = await askConfirm({
    title: '执行概念归并',
    message: `将执行 ${total} 项（${parts}）${needsReview > 0 ? `，其中 ${needsReview} 项属于「需人工确认」` : ''}。\n会同时整理该用户的：\n${MERGE_MIGRATED_TABLES}\n执行后可回滚，但请先确认这些确实是同一个概念。`,
    confirmText: '执行归并',
    danger: true,
  })
  if (!ok) return
  busy.value = true
  error.value = ''
  try {
    const res: any = await adminMemoryReviewApi.apply(props.userId, canonicals, {
      includeNeedsReview: needsReview > 0,
      ...(ambiguous.length ? { ambiguous } : {}),
      ...(drops.length ? { drops } : {})
    })
    const body = res.data?.data ?? res.data ?? {}
    toast.success(`已执行 ${body.applied ?? 0} 条归并${body.skipped?.length ? `，跳过 ${body.skipped.length} 条` : ''}`)
    await load()
  } catch (e) {
    error.value = errMsg(e)
    // 明细态失败必须有感知（P1#12）：error 渲染点可能在滚动视野外，toast 兜底
    toast.error(`执行归并失败：${errMsg(e)}`)
  } finally {
    busy.value = false
  }
}

/** 单条建议的「确认」（三组建议同一条路径，任务书 B 操作位）：确认弹层同批量口径（列明迁移表） */
async function applyOne(
  payload: { canonicals?: string[]; ambiguous?: Array<{ a: string; b: string }>; drops?: string[] },
  summary: string,
  opts: { includeNeedsReview?: boolean } = {}
) {
  const ok = await askConfirm({
    title: '执行概念归并',
    message: `将执行：${summary}。\n会同时整理该用户的：\n${MERGE_MIGRATED_TABLES}\n执行后可回滚。`,
    confirmText: '执行归并',
    danger: true,
  })
  if (!ok) return
  busy.value = true
  error.value = ''
  try {
    const res: any = await adminMemoryReviewApi.apply(props.userId, payload.canonicals ?? [], {
      includeNeedsReview: opts.includeNeedsReview === true,
      ...(payload.ambiguous?.length ? { ambiguous: payload.ambiguous } : {}),
      ...(payload.drops?.length ? { drops: payload.drops } : {})
    })
    const body = res.data?.data ?? res.data ?? {}
    toast.success(`已执行 ${body.applied ?? 0} 条归并${body.skipped?.length ? `，跳过 ${body.skipped.length} 条` : ''}`)
    await load()
  } catch (e) {
    error.value = errMsg(e)
    toast.error(`执行归并失败：${errMsg(e)}`)
  } finally {
    busy.value = false
  }
}

/** 驳回单条建议（R7 outlet 契约 POST reject）：非破坏写动作——不迁移数据，服务端留痕后
 *  不再重复给出这条建议；按写动作惯例过确认弹层（非危险档，同「重新观察」） */
async function rejectOne(
  payload: { canonicals?: string[]; ambiguous?: Array<{ a: string; b: string }>; drops?: string[] },
  describe: string
) {
  const ok = await askConfirm({
    title: '驳回建议',
    message: `驳回${describe}？服务端会留痕，这条建议之后不再重复给出（不改动记忆痕迹。重新观察仍可能生成新建议）。`,
    confirmText: '驳回',
    danger: false,
  })
  if (!ok) return
  busy.value = true
  error.value = ''
  try {
    await adminMemoryReviewApi.reject(props.userId, payload)
    toast.success('已驳回，这条建议之后不再重复给出')
    await load()
  } catch (e) {
    error.value = errMsg(e)
    toast.error(`驳回失败：${errMsg(e)}`)
  } finally {
    busy.value = false
  }
}

async function rollbackOne(canonical: string) {
  const ok = await askConfirm({
    title: '回滚归并',
    message: `将「${canonical}」恢复合并前的记录状态。`,
    confirmText: '回滚',
    danger: true,
  })
  if (!ok) return
  busy.value = true
  error.value = ''
  try {
    const res: any = await adminMemoryReviewApi.rollback(props.userId, [canonical])
    const body = res.data?.data ?? res.data ?? {}
    toast.success(body.rolledBack ? '已回滚' : '未找到可回滚的记录')
    await load()
  } catch (e) {
    error.value = errMsg(e)
    toast.error(`回滚失败：${errMsg(e)}`)
  } finally {
    busy.value = false
  }
}

/* last-wins 代际号（P2）：换用户/连点刷新时，旧响应不得覆盖新状态 */
let detailSeq = 0

/** 到期预览排序随请求下发（服务端在截断前排序，见排序块注释）；
 *  quietSort = 只是换排序口径：不置 busy（页内动作钮不该因换序闪一下禁用），
 *  已渲染的明细也不清空——骨架只在「首载且无数据」时出。 */
async function load(opts: { quietSort?: boolean } = {}) {
  const seq = ++detailSeq
  detailLoading.value = true
  if (!opts.quietSort) busy.value = true
  error.value = ''
  try {
    const res: any = await adminMemoryReviewApi.detail(props.userId, {
      dueSort: dueSortKey.value,
      dueOrder: dueSortDir.value
    })
    if (seq !== detailSeq) return // 已有更新的明细请求在途/完成：丢弃过期响应
    // 载荷归一：data:null（该用户无记忆数据）不得经 ?? res.data 兜成缺 summary 的空壳对象
    const body = (res.data?.data ?? res.data) ?? null
    detail.value = body && typeof body === 'object' && 'summary' in body ? (body as ReviewDetail) : null
    /* 生效排序以响应回显为准（参数非法时后端回落默认）：卡头不再写排序文字后，
       列头 caret / aria-sort 是唯一口径，必须跟回显走。回显与本地一致时不触发 value watch。 */
    const echo = detail.value?.dueSort
    if (echo) {
      if (echo.key !== dueSortKey.value) dueSortKey.value = echo.key
      if (echo.order !== dueSortDir.value) dueSortDir.value = echo.order
    }
    resetSelection(detail.value?.audit)
  } catch (e) {
    if (seq !== detailSeq) return
    error.value = errMsg(e)
    detail.value = null
  } finally {
    if (seq === detailSeq) {
      busy.value = false
      detailLoading.value = false
    }
  }
}

watch(() => props.userId, () => { void load() }, { immediate: true })

/* 换排序口径 → 重取（服务端排序）：判例 ExecLogs「watch([sortKey, sortDir]) → reload」；
   首次挂载时上面的 userId watch 已带当前键取过一次，这里不重复发请求（只在两者变化时跑） */
watch([dueSortKey, dueSortDir], () => { void load({ quietSort: true }) })

/** 行内「重新观察」进行中标记：只转该按钮文案，不锁整页 */
const recomputing = ref(false)

async function recompute() {
  if (recomputing.value) return
  /* B5-F3-5：写动作补确认——与同后台「学习状态」页的行级「重算」同一口径。
     服务端 observe 语义（只记录建议），仍写审计投影行，所以不能免确认。 */
  const ok = await askConfirm({
    title: '重新观察',
    message: `确认对「${detail.value?.user.name || shortId(props.userId)}」重新跑一次记忆复盘？将重新观察其记忆痕迹与归并建议（只记录建议，不改动记忆痕迹），结果实时刷新。`,
    confirmText: '重新观察',
    danger: false
  })
  if (!ok) return
  busy.value = true
  recomputing.value = true
  error.value = ''
  try {
    await adminMemoryReviewApi.recompute(props.userId)
    await load()
    toast.success('已完成一次记忆复盘')
  } catch (e) {
    error.value = errMsg(e)
    toast.error(`重新观察失败：${errMsg(e)}`)
  } finally {
    busy.value = false
    recomputing.value = false
  }
}
</script>

<style scoped>
/* 面板容器：住学习者详情页签里，不自带滚动（页面级滚动） */
.mr-panels { display: grid; gap: 12px; align-content: start; min-width: 0; }
/* 窄屏（2026-10-19 修复 390 被外壳裁掉）：本组件是详情页签 grid 的直接子项，
   默认 min-width:auto 会被三张审计表的 min-content 撑到 551px，外层 overflow:hidden
   直接把右半截裁掉。逐层给 0，让宽度回到页签列，横向溢出由 .mk-table-scroll 自己滚。 */
.mr-panels > *,
.mr__detail > * { min-width: 0; }

/* 面板栏样式已随「记忆调度与治理」条撤除（2026-10-23）：重新观察并入概念归并审计卡头 */
.mr-panels__empty { margin: 0; }

/* 卡内小节标题（归并审计卡里的三段子列表）：左右 16px 与卡头对齐 */
.mr__h4 { margin: 14px 16px 6px; font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); }
/* 归并表勾选列表头：收窄，别把「选择」撑成正文列宽 */
.mr__th-check { width: 40px; }
/* 归并建议勾选框配色（2026-10-06 审核 #63）：accent-color 从浏览器默认蓝收回品牌蓝 */
.mr__check { accent-color: var(--mk-blue); }
.mr__sub { display: block; color: var(--mk-muted); font-size: var(--mk-fs-micro); }
/* 但写在 <td> 上的降档文本必须是 table-cell：display:block 会把 td 移出表格布局，
   浏览器把连续的非单元格子元素包进同一个匿名单元格，整行自「别名」列起左移一列
   （实测：95% 落在「别名」表头下、理由长文落在「可自动执行」列，最右「理由」恒空）。
   归并建议表与已执行归并表均受影响；非单元格场景（p / small）仍按块渲染。 */
td.mr__sub { display: table-cell; }
/* 卡内说明段（非表格单元格里的 sub 文本）：补 16px 内边距与卡头文字对齐 —— 原来贴着卡左缘，
   看起来像漏排；表格仍按设计通边（单元格自带 padding）。
   祖先类用 .mr-panels（2026-10-12 组件化改根类后，旧 .mr 前缀选择器失配 → 文字贴边） */
.mr-panels p.mr__sub { margin: 0; padding: 10px 16px 14px; }
/* 明细区错误条（形态走共享 .mk-alert，页私有只留外边距） */
.mr__detail-error { margin: 8px 16px 0; }

/* 到期清单预览 · 逾期格（P1#13）：逾期红、未来时刻中性墨色——此前未来时刻裸 toLocaleString
   与逾期时刻同貌，「急不急」要人肉换算 */
.mr__overdue { color: var(--mk-red-strong); font-weight: 600; }

/* 列内比例条宽度（mk-minibar 管形状，这里只管两档宽度） */
.mr__bar { width: 64px; }
.mr__bar--sm { width: 52px; }

.mr__warn { margin: 8px 16px 14px; padding: 8px 10px; border-radius: var(--mk-radius-xl); border: 1px solid color-mix(in srgb, var(--mk-amber) 30%, transparent); background: color-mix(in srgb, var(--mk-amber) 6%, transparent); font-size: var(--mk-fs-micro); }
.mr__chip { display: inline-block; margin-left: 8px; }
/* 明细容器：嵌入态不做内部滚动（列表态的 flex:1 + overflow-y:auto 随独立页退役） */
.mr__detail { display: grid; gap: 12px; align-content: start; }
.mr__detail--embed { flex: 0 0 auto; overflow: visible; }
/* 温故计划指标条：grid 档（读数条）格自带 12px 16px 内边距、auto-fit 等宽摊满卡宽，
   外层不再叠 padding（原 inline 档首格 padding-left:0 的 16px 补偿随之退役） */
.mr__strip { padding: 0; border-bottom: 1px solid var(--mk-line); }
/* 明细区百分比列（批E）：数字+色阶条，与概览带/用户表同一语言 */
.mr-pct { display: inline-grid; justify-items: end; gap: 2px; }
.mr-pct b { font-variant-numeric: tabular-nums; font-weight: 700; }
/* 比例条走共享 mk-minibar（默认蓝承接原绿档；warn 琥珀由模板 data-tone 驱动） */
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
.mr-audit-queue__item span { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.mr__sub-inline { margin-left: 8px; font-weight: 400; color: var(--mk-muted, #5b6577); font-size: var(--mk-fs-micro); }
/* 归并处理条（2026-10-19 重设计）：卡内工具条，左读数 / 右动作 / 警告独立一行。
   0 选中保持静默表面，选中后点亮描边，避免与下方三张表争视觉。 */
.mr-bulk {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px 12px;
  margin: 10px 16px 14px;
  padding: 8px 10px 8px 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-lg);
  background: var(--mk-surface-2);
}
.mr-bulk.is-active {
  border-color: color-mix(in srgb, var(--mk-blue) 38%, transparent);
  background: color-mix(in srgb, var(--mk-blue) 5%, var(--mk-surface-2));
}
.mr-bulk__status { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-width: 0; }
.mr-bulk__count { font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); font-variant-numeric: tabular-nums; }
.mr-bulk__parts { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.mr-bulk__actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.mr-bulk__warn { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-amber); }
.mr-bulk__warn::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
@media (max-width: 900px) {
  .mr-bulk { grid-template-columns: minmax(0, 1fr); }
  .mr-bulk__actions { justify-content: flex-start; }
}

/* ===== 行内确认/驳回降噪（2026-10-12 外部批评采纳）：审计三表 42 行 × 2 颗按钮 = 84 颗
   常驻灰框，视觉噪声压过建议内容本身。悬停/键盘聚焦所在行才显现（按钮仍在 DOM、可达），
   触屏（hover:none）常显；顶部批量执行栏不受影响、常驻。 ===== */
.mr-panels tr .mk-actions { opacity: 0; transition: opacity 0.12s ease; }
.mr-panels tr:hover .mk-actions,
.mr-panels tr:focus-within .mk-actions { opacity: 1; }
@media (hover: none) {
  .mr-panels tr .mk-actions { opacity: 1; }
}
</style>
