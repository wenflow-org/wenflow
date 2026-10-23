<template>
  <div v-if="detailError" class="mk-page ld">
    <!-- 返回入口在壳层顶栏（面包屑 back）；错误态保留重试 -->
    <MkEmptyState
      icon="◌"
      tone="error"
      title="详情加载失败"
      description="暂时无法获取该学习者的完整档案。"
      action-text="重试"
      @action="loadDetail(subPage?.id)"
    />
  </div>
  <div v-else-if="loading" class="mk-page ld">
    <!-- 审核 #25（2026-10-06）：整页加载改用骨架屏（与同页「账号与许可」pane 的 UserAccountPane
         骨架同源），不再 spinner + 文字——同一详情页两种加载语言，且切人/刷新会先转圈再出骨架。
         版式对齐 hero(identity) / statstrip(cards×4) / 页签内容(cards×2) 的实际高度。 -->
    <div class="ld-skel" aria-hidden="true">
      <MkSkeleton variant="identity" :avatar="48" />
      <MkSkeleton variant="cards" :count="4" :h="64" :cols="4" :radius="10" />
      <MkSkeleton variant="cards" :count="4" :h="140" :cols="2" :radius="12" />
    </div>
  </div>
  <div v-else-if="d" class="mk-page ld">

    <!-- 详情页头（newui/admin hero 形态，MkDetailHero）：返回钮在壳层顶栏，页内不重复 -->
    <MkDetailHero :avatar="d.name.charAt(0)" :title="d.name" :sub="d.email">
      <template #pills>
        <span class="mk-badge" :class="trendBadge">趋势：{{ trendText }}</span>
        <span class="mk-badge" :class="fatigueBadge">疲劳：{{ d.fatigue }}</span>
        <!-- 「档案 置信 100%」会读成两个并列词；snapshotLabel 已以「置信」开头，直接拼成「档案置信」 -->
        <span class="mk-badge" :class="snapshotBadge" :title="snapshotHint">档案{{ snapshotLabel }}</span>
      </template>
      <template #actions>
        <button v-if="linkedVirtualProfile" type="button" class="mk-btn" title="同一账号的仿真档案视图（故事池 / 运行 / 运行预算）" @click="openVirtualProfile">
          虚拟档案 →
        </button>
        <button type="button" class="mk-btn" :disabled="recomputing" @click="recompute">
          {{ recomputing ? '重算中…' : '重算档案' }}
        </button>
      </template>
    </MkDetailHero>

    <!-- 页级 statstrip 已撤（2026-10-11 用户走查「拿掉不要了」）：四格读数的实体都在归属页签
         （路径进度→概览当前进度卡、知识信号→证据信号卡、复习到期→记忆与复习、最近会话→教学会话），
         常驻条整条成为纯复读；跨页签定位由页签栏本身承担。历史：P2（2026-10-04）曾按账号轴隐藏、
         2026-10-05 收敛共享 MkStatStrip、2026-10-11 上午重设计为四格可点条，同日整体撤除 -->

    <!-- 路径作用域（页级开关）：一个学习者可并存多条路径，原先页面焊死在「当前路径」上——
         读者既看不见还有别的路径、也切不过去（只有图谱一处自带路径轨）。现升为页级，
         驱动「概念掌握 / 证据 / 当前进度 / 图谱 / 教学会话」；记忆与行为基线不随它走（见 title）。

         不提供「全部路径」档：学习者模型快照**没有跨路径聚合口径**——不传 pathId 时后端自动回落到
         「该学习者 status=active 且 updatedAt 最新的那条」（LearnerKnowledgeMemoryService.build 的
         path 解析：`input.learningPathId ? findUnique : findFirst(active, updatedAt desc)`），是回落不是求和。
         给一个做不出区别的档位等于假动作，故只做「选哪一条」。 -->
    <div class="ld-scope" role="group" aria-label="路径范围">
      <label class="ld-scope__label" for="ld-scope-path">路径范围</label>
      <select
        id="ld-scope-path"
        class="mk-filter__select ld-scope__select"
        :value="scopePathId"
        :disabled="pathOptionsLoading || !pathOptions.length"
        @change="scopePathId = ($event.target as HTMLSelectElement).value"
      >
        <option v-if="!pathOptionsLoading && !pathOptions.length" value="" disabled>该学习者暂无学习路径</option>
        <option v-for="p in pathOptions" :key="p.id" :value="p.id">
          {{ p.title }}（{{ pathStatusText(p.status) }}）{{ p.id === learnerCurrentPathId ? ' · 当前' : '' }}
        </option>
      </select>
      <!-- 路径选项加载态走共享原语（select 内放不下组件），转圈挂在其后：select 不被挤位 -->
      <MkLoading v-if="pathOptionsLoading" inline min />
    </div>

    <!-- Tab 栏（6 → 3 合并：总览 / 画像 / 证据；旧 tab 名由 normalizeLearnerTab 重定向）。
         形态换 MkSubTabs（newui/admin 下划线式，替换胶囊 mk-pill） -->
    <MkSubTabs
      :tabs="tabs.map((t) => ({ key: t.id, label: t.label }))"
      :model-value="tab"
      id-base="ld"
      @update:model-value="switchTab"
    />

    <!-- ============ 总览：进度 + 概念掌握图形 + 活跃 + 会话 + 建议行动 ============ -->
    <div v-if="tab === 'overview'" class="ld-grid" id="ld-panel-overview" role="tabpanel" aria-labelledby="ld-tab-overview">
      <div class="ld-col">
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">当前进度</h3>
            <!-- 审核 #22（2026-10-06）：原「学习路径」页签读数并入本卡——里程碑分母 + 路径状态徽章
                 （页签已撤，下钻入口即右侧「查看路径结构 →」，同页不再复读一处卡片栅格） -->
            <span
              v-if="pathInfo && pathInfo.total"
              class="mk-card__meta"
              :title="`里程碑完成 ${pathInfo.done}/${pathInfo.total}`"
            >里程碑 {{ pathInfo.done }}/{{ pathInfo.total }}</span>
            <span
              v-if="pathInfo"
              class="mk-badge"
              :class="`mk-badge--${pathStatus.tone}`"
              :title="`路径状态：${pathStatus.text}`"
            >{{ pathStatus.text }}</span>
            <!-- P2（2026-10-04 全站评审）：卡头 0% badge 与阶段/「正在做」两行撤——正上方 statstrip
                 已逐项承载同三个事实（0% / 阶段 / 任务），卡内只留增量：路径名 + 里程碑分母 + 进度条 -->
            <button v-if="currentPathId" type="button" class="mk-link" @click="openPathDetail">查看路径结构 →</button>
          </div>
          <div class="ld-progress">
            <strong>{{ d.path }}</strong>
            <span class="mk-minibar ld-progress__bar"><i class="mk-minibar__fill" :style="{ width: d.pct + '%' }"></i></span>
            <p v-if="milestoneTasks" class="ld-progress__task">当前里程碑：已完成 {{ milestoneTasks.done }}/{{ milestoneTasks.total }} 个任务</p>
          </div>
        </section>

        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">概念掌握</h3>
            <span class="mk-card__meta">{{ conceptBars.length }} 个概念 · {{ scopeNote.label }}</span>
          </div>
          <!-- T2 硬约束 2：结论行常驻（数字全部由现有 conceptBars 的 tone 派生，未新增判断） -->
          <p v-if="conceptBars.length" class="mk-section__conclusion">
            共 {{ conceptBars.length }} 个概念：{{ conceptBars.filter((c) => c.tone === 'ok').length }} 个可迁移、{{
              conceptBars.filter((c) => c.tone === 'warn' || c.tone === 'bad').length
            }} 个待巩固<template v-if="conceptBars.filter((c) => c.tone === 'muted').length"
              >、{{ conceptBars.filter((c) => c.tone === 'muted').length }} 个证据不足</template
            >。
          </p>
          <!-- 逐概念明细已并入「知识图谱」页签的节点详情（2026-10-20 用户拍板）：
               可迁移 / 误解风险 / 证据数三样与侧栏的记忆强度、提取练习是同一个概念的读数，
               同一份事实只在一个地方出现；本卡只留上面那行结论与概念总数 -->
          <button
            v-if="conceptBars.length"
            type="button"
            class="mk-link ld-concepts__more"
            @click="tab = 'graph'"
          >去图谱逐个查看 →</button>
          <p v-else class="ld-none">
            {{ '暂无概念掌握数据' }}
            <span class="ld-none__hint">{{ CONCEPT_NONE_HINT }}</span>
          </p>
        </section>

        <!-- 最近会话（真实接口 userId 过滤）：填平原左栏下方空旷，行点击下钻只读座舱 -->
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">最近课堂</h3>
            <span class="mk-card__meta">
              <MkLoading v-if="ldSessLoading" inline min text="加载中…" />
              <template v-else-if="ldSessError">加载失败</template>
              <!-- 「最近」语义恒在：左栏只取有效会话窗口前 5 条，裸「N 条」会被读成总量 -->
              <template v-else>{{ sessionPreviewMeta }}</template>
            </span>
          </div>
          <!-- 审核 #23（2026-10-06）：原卡头 MkLoading + MkRowList :loading 同时出两个转圈——
               卡头文案保留为全卡唯一加载信号，列表 loading 撤；同时把空态挂起条件补上
               ldSessLoading，避免加载中先闪「暂无教学会话」 -->
          <MkRowList :empty="!recentSessionRows.length && !ldSessLoading" :empty-text="discardedHiddenCount ? '暂无有效课堂' : '暂无课堂'" empty-hint="该学习者上课后，这里会出现课堂记录。">
            <MkRow
              v-for="s in recentSessionRows"
              :key="s.id"
              clickable
              :title="s.topic"
              :sub="s.subText"
              :time="s.startAgo"
              @click="openSessionCockpit(s.id)"
            >
              <template #lead>
                <span class="mk-badge" :class="sessBadgeCls(s.status)">{{ statusText(s.status) || '—' }}</span>
              </template>
            </MkRow>
          </MkRowList>
        </section>

        <!-- 最近目标对话（2026-10-19 用户拍板）：对象轴与「最近会话」并列。
             原挂在「账号与许可」页的「最近活动」里，会话部分与左卡同源同对象、目标部分
             又不跟页级路径作用域；账号页只留账户与许可后，目标对话迁到概览。 -->
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">最近目标对话</h3>
            <span class="mk-card__meta">
              <MkLoading v-if="ldGoalLoading" inline min text="加载中…" />
              <template v-else-if="ldGoalError">加载失败</template>
              <template v-else>{{ goalPreviewMeta }}</template>
            </span>
          </div>
          <MkRowList
            :empty="!recentGoalRows.length && !ldGoalLoading"
            :empty-text="scopePathId ? '该路径下暂无目标对话' : '暂无目标对话'"
            empty-hint="学习者发起目标对话后，这里会出现记录。"
          >
            <MkRow
              v-for="g in recentGoalRows"
              :key="g.id"
              clickable
              :title="g.summary"
              :sub="g.subText"
              :time="g.createdAgo"
              @click="openSessionCockpit(g.id)"
            >
              <template #lead>
                <span class="mk-badge" :class="sessBadgeCls(g.status)">{{ statusText(g.status) || '—' }}</span>
              </template>
            </MkRow>
          </MkRowList>
        </section>

        <!-- 学习状态追踪（原型 renderLearnerDetail 概览 pane 2189 / lsm 样式 517-522）：
             与证据 tab 指标卡同源（dynamicState.metrics）。同屏不同 tab 复用，证据 tab 保持不动。 -->
        <section v-if="dynamicState" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">学习状态追踪</h3>
            <!-- 四码不在卡头复读（2026-10-19 文案优化）：卡内四行的标签各自带码（LSS 学习压力…），
                 卡头只说到来源与取样时刻 -->
            <span class="mk-card__meta" :title="loadCaliberNote.title">{{ loadCaliberNote.label }}</span>
          </div>
          <div class="ld-lsm">
            <div v-for="r in learningStateRows" :key="r.label" class="ld-lsm__row">
              <span class="ld-lsm__label">{{ r.label }}</span>
              <span class="mk-minibar ld-lsm__track">
                <i
                  class="mk-minibar__fill"
                  :data-tone="r.tone === 'muted' ? undefined : r.tone"
                  :class="{ 'ld-bar__fill--muted': r.tone === 'muted' }"
                  :style="{ width: r.width + '%' }"
                ></i>
              </span>
              <span class="ld-lsm__val">{{ r.value }}</span>
              <span class="ld-lsm__hint" :title="r.hintTitle">{{ r.hint }}</span>
            </div>
          </div>
        </section>

        <!-- 「学习者画像」kv 卡已撤（2026-10-11 走查）：邮箱与 hero 重复、层级/路径数/注册时间
             与「账号与许可」页签三重覆盖；概览左列以学习状态追踪收尾 -->
      </div>

      <div class="ld-col">
        <!-- （原「7 天活跃趋势」卡已移除：trend7d 无任何数据来源，恒为 0 的假卡只会渲染
             「学习者产生会话后将自动生成」的误导空态；后端 learner-models 无按日活跃接口） -->
        <section class="mk-card">
          <div class="mk-card__head">
            <!-- 「学习动态」：卡内是合并后的学习事件（教学/目标/路径域），与对象轴的
                 「最近会话」「最近目标对话」区分命名，避免两个「最近 X」读成一回事 -->
            <h3 class="mk-card__title">学习动态</h3>
            <span class="mk-card__meta">最近 {{ d.sessions.length }} 条事件</span>
          </div>
          <div class="ld-sessions">
            <div v-for="(s, i) in recentActivityMerged" :key="i" class="ld-session">
              <span class="ld-session__dot" :class="`is-${s.tone}`"></span>
              <div class="ld-session__main">
                <strong>{{ s.titles.map((t) => evidenceTypeZh(t)).join(' + ') }}<span v-if="s.count > s.titles.length" class="ld-session__x">×{{ s.count }}</span></strong>
                <span>{{ s.result }}</span>
                <span v-if="s.concepts && s.concepts.length" class="ld-chips">
                  <span v-for="c in s.concepts.slice(0, 3)" :key="c" class="ld-chip">{{ c }}</span>
                </span>
              </div>
              <span class="ld-session__time">{{ s.time }}</span>
            </div>
            <p v-if="!d.sessions.length" class="ld-none">暂无动态记录</p>
          </div>
        </section>

        <section v-if="teachingHints" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">建议行动</h3>
            <span class="mk-card__meta">教学建议摘要</span>
          </div>
          <div class="ld-actions">
            <p v-if="teachingHints.recommendedApproach"><span class="ld-actions__k">方式</span>{{ cleanHint(teachingHints.recommendedApproach) }}</p>
            <!-- 个性化要求（原标签「Prompt」）：后端文本每句自带句号、拼接处出「。。」——
                 显示层归一句读并按句拆行（2026-10-11 走查） -->
            <p v-if="promptHintLines.length">
              <span class="ld-actions__k">个性化要求</span><span class="ld-actions__body">
                <span v-for="(line, i) in promptHintLines" :key="i" class="ld-actions__line">{{ line }}</span>
              </span>
            </p>
            <p v-if="riskFactors.length"><span class="ld-actions__k ld-actions__k--warn">风险</span>{{ cleanHint(riskFactors.join('；')) }}</p>
            <!-- 教学控制信号 + 强调/避免（2026-10-11 走查自画像页签迁入）：只读信号与行动建议同卡；
                 控制项只列命中（on）的，强调/避免列表空则整块不出现 -->
            <p v-if="controlFlags.some((f) => f.on)" class="ld-actions__ctrl">
              <span class="ld-actions__k ld-actions__k--warn">控制</span>
              <span v-for="f in controlFlags.filter((f) => f.on)" :key="f.text" class="mk-badge mk-badge--warn">{{ f.text }}</span>
            </p>
            <div v-if="emphasizeList.length || avoidList.length" class="ld-actions__lists">
              <div v-if="emphasizeList.length">
                <span class="ld-concept-label ld-concept-label--ok">强调</span>
                <div class="ld-concept-list">
                  <span v-for="c in emphasizeList" :key="c" class="ld-concept ld-concept--ok">{{ c }}</span>
                </div>
              </div>
              <div v-if="avoidList.length">
                <span class="ld-concept-label ld-concept-label--bad">避免</span>
                <div class="ld-concept-list">
                  <span v-for="c in avoidList" :key="c" class="ld-concept ld-concept--bad">{{ c }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 「关联实体」卡已撤（2026-10-11 用户走查）：两个入口分别是本页「账号与许可」「证据」
             页签的跳转——同一实体的自有页签不该以"关联记录"形态复读页签栏 -->
      </div>
    </div>

    <!-- ============ 画像：认知 + 偏好情绪 + 行为历史 + 课程控制 + 派生 + 记忆 + 教学建议 ============ -->
    <div v-else-if="tab === 'profile'" class="ld-tabpage" id="ld-panel-profile" role="tabpanel" aria-labelledby="ld-tab-profile">
      <template v-if="profile">
        <!-- 2026-10-10 走查（低危登记转修）：零证据账号的三张画像卡直渲先验常量
             （自评准确度=准确 / 平均响应=10s…），逐卡阅读易把先验当实测；页级「证据不足」
             徽章兜底之外，卡内再挂一枚「初始先验」标注。判据=证据列表为空（本页同源数据）。
             2026-10-11 走查：六张 kv 卡改双列栅格——单列竖排时每卡 5 行内容占满全宽，右半屏全空。 -->
        <!-- 2026-10-10 走查（低危登记转修）：零证据账号的画像卡直渲先验常量
             （自评准确度=准确 / 平均响应=10s…），逐卡阅读易把先验当实测；页级「证据不足」
             徽章兜底之外，卡内再挂一枚「初始先验」标注。判据=证据列表为空（本页同源数据）。
             2026-10-11 走查重构：六张散卡并为三张（卡内 .ld-pf-sub 双列子组），叙述洞察为第四卡；
             FSRS 表撤（记忆与复习页签单源）；全局信号与背景迁证据页签；教学控制/强调避免迁概览建议行动。 -->
        <div class="ld-pf-grid">
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">认知与偏好</h3>
            <span v-if="!evidence.length" class="mk-card__meta" :title="PRIOR_EMPTY_TITLE">{{ PRIOR_EMPTY_LABEL }}</span>
          </div>
          <div class="ld-pf-sub">
            <div>
              <h4 class="ld-pf-sub__h">认知特征</h4>
              <div class="ld-kv">
                <div v-for="kv in cognitiveRows" :key="kv.label" class="ld-kv__row">
                  <span>{{ kv.label }}</span>
                  <strong>{{ kv.value }}</strong>
                </div>
              </div>
            </div>
            <div>
              <h4 class="ld-pf-sub__h">偏好与情绪</h4>
              <div class="ld-kv">
                <div v-for="kv in preferenceRows" :key="kv.label" class="ld-kv__row">
                  <span>{{ kv.label }}</span>
                  <strong>{{ kv.value }}</strong>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section v-if="behaviorRows.length || historyRows.length" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">行为基线与互动</h3>
            <span v-if="!evidence.length" class="mk-card__meta" :title="PRIOR_EMPTY_TITLE">{{ PRIOR_EMPTY_LABEL }}</span>
            <span class="mk-card__meta" :title="allPathsScope.title">{{ allPathsScope.label }}</span>
          </div>
          <div class="ld-pf-sub">
            <div v-if="behaviorRows.length">
              <h4 class="ld-pf-sub__h">学习行为基线</h4>
              <div class="ld-kv">
                <div v-for="kv in behaviorRows" :key="kv.label" class="ld-kv__row">
                  <span>{{ kv.label }}</span>
                  <strong>{{ kv.value }}</strong>
                </div>
              </div>
            </div>
            <div v-if="historyRows.length">
              <h4 class="ld-pf-sub__h">互动历史</h4>
              <div class="ld-kv">
                <div v-for="kv in historyRows" :key="kv.label" class="ld-kv__row">
                  <span>{{ kv.label }}</span>
                  <strong>{{ kv.value }}</strong>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section v-if="curriculumRows.length || derivedRows.length" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">课程控制与派生洞察</h3>
          </div>
          <div class="ld-pf-sub">
            <div v-if="curriculumRows.length">
              <h4 class="ld-pf-sub__h">课程控制</h4>
              <div class="ld-kv">
                <div v-for="kv in curriculumRows" :key="kv.label" class="ld-kv__row">
                  <span>{{ kv.label }}</span>
                  <strong>{{ kv.value }}</strong>
                </div>
              </div>
            </div>
            <div v-if="derivedRows.length">
              <h4 class="ld-pf-sub__h">派生洞察</h4>
              <div class="ld-kv">
                <div v-for="kv in derivedRows" :key="kv.label" class="ld-kv__row">
                  <span>{{ kv.label }}</span>
                  <strong>{{ kv.value }}</strong>
                </div>
              </div>
            </div>
          </div>
        </section>
        <!-- 叙述洞察通栏卡（2026-10-11 走查：长文本与参数卡解耦——上排三张参数卡收成等高水平带，
             叙述独占通栏按语义分区 + 两栏文本流，不再把同行参数卡拉出半屏空洞） -->
        <section v-if="narrativeSections.length" class="mk-card ld-pf-narr">
          <div class="mk-card__head">
            <h3 class="mk-card__title">叙述洞察</h3>
            <span v-if="narrativeSource" class="mk-card__meta" :title="narrativeSourceTitle">{{ narrativeSourceLabel }}</span>
          </div>
          <div class="ld-insights ld-insights--cols">
            <div v-for="g in narrativeSections" :key="g.label" class="ld-insights__sec">
              <h4 v-if="g.label" class="ld-insights__h">{{ g.label }}</h4>
              <p v-for="(t, i) in g.items" :key="i">{{ t }}</p>
            </div>
          </div>
        </section>
        </div>
      </template>
      <MkEmptyState
        v-else
        icon="◌"
        title="暂无认知画像数据"
        description="重算快照后自动生成，画像/派生洞察等卡将随快照一起更新。"
      />
    </div>

    <!-- ============ 证据：全局信号 + 左时间线 / 右曲线·建议·密度 两栏 ============ -->
    <div v-else-if="tab === 'evidence'" class="ld-tabpage" id="ld-panel-evidence" role="tabpanel" aria-labelledby="ld-tab-evidence">
      <!-- 指标卡横排已撤（2026-10-11 用户走查）：LSS/KTL/LF/LSB 与「学习压力记录」曲线同族指标，
           当前值并入曲线卡头部读数行（.ld-load__hits），不再占页宽一整排 -->

      <!-- 全局信号与背景（2026-10-11 用户走查三修）：撤堆条与折叠，三组全部常驻可见——
           组一概念信号（学没学会）、组二教学基础（能不能踩）、组三反复困惑（在哪跌倒，此前只有计数没实体）。
           原始句子无「概念名|诊断」字段结构，标签化方案维持否决 -->
      <section v-if="signalTierRows.some((t) => t.n > 0) || foundations.reusable.length || foundations.blocked.length || recurringConfusions.length" class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">全局信号与背景</h3>
          <!-- 口径纠错：原 title 写「跨全部学习路径汇总」，实测数据源是当前路径的会话与学习证据
               （sessions/learner_evidence 均按 pathId 过滤）+ 该学习者全部记忆痕迹，不是跨全部路径 -->
          <span class="mk-card__meta">{{ sigHeadMeta }} · {{ scopeNote.label }}</span>
        </div>
        <div class="ld-sigbody">
          <div class="ld-sig-sec">
            <h4 class="ld-sig-sec__h">概念信号</h4>
            <div class="ld-sig-tiers">
              <p v-for="t in signalTierRows" :key="t.key" class="ld-sig-tier">
                <span class="ld-sig-tier__head">
                  <i class="ld-sig-tier__dot" :class="`is-${t.key}`" aria-hidden="true"></i>
                  <strong>{{ t.label }} {{ t.n }}</strong>
                </span>
                <span class="ld-sig-tier__names">{{ t.names.length ? t.names.join('、') : '—' }}</span>
              </p>
            </div>
          </div>
          <div class="ld-sig-sec">
            <h4 class="ld-sig-sec__h">教学基础</h4>
            <div class="ld-pf-sub">
              <div>
                <span class="ld-concept-label ld-concept-label--ok">可复用基础 {{ foundations.reusable.length }}</span>
                <ul class="ld-fnd">
                  <li v-for="c in foundations.reusable" :key="c" class="ld-fnd__item ld-fnd__item--ok">{{ c }}</li>
                </ul>
              </div>
              <div>
                <span class="ld-concept-label ld-concept-label--bad">被阻塞基础 {{ foundations.blocked.length }}</span>
                <ul class="ld-fnd">
                  <li v-for="c in foundations.blocked" :key="c" class="ld-fnd__item ld-fnd__item--bad">{{ c }}</li>
                </ul>
              </div>
            </div>
          </div>
          <div class="ld-sig-sec">
            <h4 class="ld-sig-sec__h">反复困惑 {{ recurringConfusions.length }}</h4>
            <ul class="ld-fnd ld-fnd--rc">
              <li v-for="rc in recurringConfusions" :key="rc.label" class="ld-fnd__item ld-fnd__item--warn">
                <span class="ld-rc__main">
                  <strong class="ld-rc__label">{{ rc.label }}</strong>
                  <span class="ld-rc__pattern">{{ rc.pattern }}</span>
                </span>
                <em class="ld-rc__count">{{ rc.count }} 次</em>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <div class="ld-ev-grid">
        <!-- 左栏：证据时间线（主内容） -->
        <section class="mk-card ld-ev-main">
          <div class="mk-card__head">
            <h3 class="mk-card__title">证据时间线</h3>
            <!-- 教学域 items 接口侧 limit=20，learner_evidence 域事件全量并入（见 loadDetail 合并处）
                 ——渲染条数=响应条数，口径写「教学域仅近 20 条」防「共 N 条」误读（2026-10-11 走查修正：
                 域合并后「仅最近 20 条」已失实） -->
            <!-- 卡头 meta 只留图形编码图例——条数/低置信计数归结论行（2026-10-11 用户走查：两处复读）。
                 2026-10-23 用户「这文案为什么还在」：图例本身也是在复述图形怎么读，整句撤除——
                 圆点色阶与信号档同名（可迁移/待巩固/证据不足），横条长度由行尾读数兜住。 -->
          </div>
          <!-- T2 硬约束 2「结论与细节分层」：结论行常驻可见，明细折叠。
               结论文字完全取自本卡已有数据（条数 + 卡片里本来就标的「证据不足」），未新增判断。
               P2 口径：「共 N 条」改「最近 N 条」——接口侧 limit=20，列表不是全量。
               2026-10-18 用户走查「这类文案」：两个限定语（教学域截断、低置信仅供参照）从结论行
               移入 title——结论行只报两个读数，悬停仍能看到它们成立的前提。 -->
          <p
            v-if="evidence.length"
            class="mk-section__conclusion"
            title="教学类事件接口侧只取近 20 条，目标与路径类事件全量并入，故本行是「最近」而非「共」。低置信计数仅供参考，不构成「证据不足」判定"
          >
            最近 {{ evidence.length }} 条学习事件，其中
            {{ evidence.filter((e) => evidenceLowConfidence(e.score) && !isDomainEvidence(e.title)).length }} 条置信度低于 50%。
          </p>
          <!-- 明细常驻（2026-10-11 用户走查「折叠干嘛」）：监控窗改内滚后折叠失去职责——
               它挡住的正是视口内的滚动容器，结论行本就常驻其上；撤 details 直接渲染。
               P2：带 sessionId 的行可点下钻只读座舱（与教学会话 pane 同一 openSessionCockpit） -->
          <div v-if="evidence.length" class="ld-ev-details">
            <div class="ld-evidence">
            <div
              v-for="(e, i) in evidence"
              :key="i"
              class="ld-ev"
              :class="{ 'ld-ev--link': !!e.sessionId }"
              :role="e.sessionId ? 'button' : undefined"
              :tabindex="e.sessionId ? 0 : undefined"
              :title="e.sessionId ? '打开该事件的只读详情' : undefined"
              @click="e.sessionId && openSessionCockpit(e.sessionId)"
              @keydown.enter="e.sessionId && openSessionCockpit(e.sessionId)"
              @keydown.space.prevent="e.sessionId && openSessionCockpit(e.sessionId)"
            >
              <span class="ld-ev__rail" aria-hidden="true"></span>
              <span
                class="ld-ev__dot"
                :class="`is-${evidenceDotTone(e.signal, e.score, e.title)}`"
                :title="evidenceFullTooltip(e.title, e.signal, e.score, { sessionId: e.sessionId, taskId: e.taskId, happenedAt: e.happenedAt })"
              ></span>
              <div class="ld-ev__main">
                <div class="ld-ev__top">
                  <strong>{{ evidenceTypeZh(e.title) }}</strong>
                  <span class="ld-ev__signal" :class="`is-${evidenceDotTone(e.signal, e.score, e.title)}`">{{ evidenceSignalZh(e.signal, e.title) || '—' }}</span>
                  <span v-if="evidenceLowConfidence(e.score) && !isDomainEvidence(e.title)" class="ld-ev__lack" title="置信度低于 50%，结论仅供参考">证据不足</span>
                </div>
                <span v-if="e.detail" class="ld-ev__detail">{{ e.detail }}</span>
                <span class="ld-ev__conf" :title="evidenceFullTooltip(e.title, e.signal, e.score, { sessionId: e.sessionId, taskId: e.taskId, happenedAt: e.happenedAt })">
                  <i
                    class="ld-ev__confbar"
                    :class="`is-${evidenceConfidenceTone(e.score)}`"
                    :style="{ width: Math.max(3, Math.round(e.score * 100)) + '%' }"
                  ></i>
                  <em>{{ Math.round(e.score * 100) }}%</em>
                </span>
                <span v-if="e.concepts.length" class="ld-chips">
                  <span v-for="c in e.concepts.slice(0, 4)" :key="c" class="ld-chip">{{ c }}</span>
                </span>
                <span v-if="e.sessionId || e.taskId" class="ld-ev__src">
                  {{ e.sessionId ? `课堂 ${shortId(e.sessionId)}` : '' }}{{ e.sessionId && e.taskId ? ' · ' : '' }}{{ e.taskId ? `任务 ${shortId(e.taskId)}` : '' }}
                </span>
              </div>
              <span class="ld-ev__time">{{ e.time }}</span>
            </div>
          </div>
          </div>
          <p v-else class="ld-none">
            {{ '暂无证据记录' }}
            <span class="ld-none__hint">{{ EVIDENCE_NONE_HINT }}</span>
          </p>
        </section>

        <!-- 右栏：压力曲线（上移）+ 趋势与建议 + 概念证据密度 -->
        <div class="ld-ev-side">
          <!-- 学习压力记录曲线：LSS/LF/LSB 真实指标历史（learning_metrics），与指标卡同源 -->
          <section class="mk-card ld-load">
            <div class="mk-card__head">
              <h3 class="mk-card__title">学习压力记录</h3>
              <div class="ld-load__controls">
                <div class="mk-seg">
                  <button type="button" class="mk-seg__item" :class="{ 'mk-seg__item--active': loadRange === 42 }" @click="loadRange = 42">42 天</button>
                  <button type="button" class="mk-seg__item" :class="{ 'mk-seg__item--active': loadRange === 90 }" @click="loadRange = 90">90 天</button>
                </div>
              </div>
            </div>
            <!-- 当前读数行（2026-10-11 用户走查）：四张 KPI 卡与曲线卡同族指标合流——当前值并入
                 曲线卡头部，撤页宽 KPI 横排；四个读数全缺省时整行不出现（曲线/空态自足） -->
            <div v-if="metricCards.some((m) => m.value !== '—')" class="ld-load__hits">
              <div v-for="m in metricCards" :key="m.label" class="ld-load__hit" :title="m.title">
                <span>{{ m.label }}</span>
                <strong :class="{ 'is-good': m.tone === 'ok', 'is-bad': m.tone === 'bad' }">{{ m.value }}</strong>
              </div>
            </div>
            <div v-if="hasLoad" class="ld-load__body">
              <div class="ld-load__legend">
                <span><i class="ld-load__dot is-lss"></i>LSS 压力</span>
                <span><i class="ld-load__dot is-lf"></i>LF 疲劳</span>
                <span><i class="ld-load__dot is-lsb"></i>LSB 状态</span>
                <span v-if="loadDisplayDay" class="ld-load__chip" :class="`ld-load__chip${loadZoneCls(loadZoneOf(loadDisplayDay))}`">
                  {{ loadZoneCls(loadZoneOf(loadDisplayDay)) === '--fresh' ? '状态良好' : loadZoneCls(loadZoneOf(loadDisplayDay)) === '--optimal' ? '需要休息' : '高风险' }}
                </span>
              </div>
              <MkChart :option="loadChartOption" height="260px" />
              <div v-if="loadDisplayDay" class="ld-load__info">
                <b>{{ loadDisplayDay.label }}</b>
                <span class="is-lss-t">LSS {{ loadFmt(loadDisplayDay.lss) }}</span>
                <span class="is-lf-t">LF {{ loadFmt(loadDisplayDay.lf) }}</span>
                <span class="is-lsb-t">LSB {{ loadFmt(loadDisplayDay.lsb) }}</span>
              </div>
              <div class="ld-load__zones">
                <span><i class="ld-load__dot is-lss"></i>{{ LOAD_ZONE_LSS }}</span>
                <span><i class="ld-load__dot is-lf"></i>{{ LOAD_ZONE_LF }}</span>
                <span><i class="ld-load__dot is-lsb"></i>{{ LOAD_ZONE_LSB }}</span>
              </div>
            </div>
            <div v-else class="ld-none">
              {{ '暂无压力记录' }}
              <span class="ld-none__hint">{{ LOAD_NONE_HINT }}</span>
            </div>
          </section>

          <section v-if="dynamicState" class="mk-card">
            <div class="mk-card__head"><h3 class="mk-card__title">趋势与建议</h3></div>
            <div class="ld-kv">
              <div v-for="kv in dynamicRows" :key="kv.label" class="ld-kv__row">
                <span>{{ kv.label }}</span>
                <strong>{{ kv.value }}</strong>
              </div>
            </div>
          </section>

          <!-- 概念证据密度：概念名 + 证据条 + 计数；有证据置顶、无证据折叠 -->
          <section v-if="conceptStats.length" class="mk-card">
            <div class="mk-card__head">
              <h3 class="mk-card__title">概念证据密度</h3>
              <!-- 2026-10-23 用户「这文案为什么还在」：条长/颜色的读法由图本身与行尾「N 条」表达，卡头不再写图例 -->
            </div>
            <div class="ld-bars ld-bars--dense">
              <div v-for="c in conceptStats" :key="c.label" class="ld-bar" :class="{ 'ld-bar--empty': c.count === 0 }">
                <div class="ld-bar__head">
                  <strong :title="evidenceDensityTooltip(c.label, c.count)">{{ c.label }}</strong>
                  <span class="ld-bar__badges">
                    <span class="ld-bar__ev" :class="{ 'ld-bar__ev--zero': c.count === 0 }" :title="evidenceDensityTooltip(c.label, c.count)">
                      {{ c.count === 0 ? '暂无' : `${c.count} 条` }}
                    </span>
                  </span>
                </div>
                <span class="mk-minibar ld-bar__track">
                  <i class="mk-minibar__fill" :data-tone="c.tone === 'muted' ? undefined : c.tone" :class="{ 'ld-bar__fill--muted': c.tone === 'muted' }" :style="{ width: c.width + '%' }"></i>
                </span>
              </div>
            </div>
          </section>
          <!-- 预测校准：实证命中率 + 校准分布 + 最近预测 vs 实际 -->
          <section v-if="predictionCalib && (predictionCalib.stats.total > 0 || predictionCalib.recent.length)" class="mk-card">
            <div class="mk-card__head">
              <h3 class="mk-card__title">预测校准</h3>
              <!-- 结论常驻：卡头给结论（就地派生），原「非自报置信度」说明降级到 title -->
              <span class="mk-card__meta" :title="CALIB_META_TITLE">{{ calibConclusion }}</span>
            </div>
            <div class="ld-cal">
              <div class="ld-cal__hits">
                <div class="ld-cal__hit">
                  <span>卡壳命中率</span>
                  <strong :class="calHitCls(predictionCalib?.stats.stallHitRate)">
                    {{ predictionCalib?.stats.stallHitRate != null ? `${Math.round(predictionCalib.stats.stallHitRate * 100)}%` : '—' }}
                  </strong>
                  <em>n={{ predictionCalib?.stats.total ?? 0 }}{{ (predictionCalib?.stats.total ?? 0) < 5 ? ' · 样本不足' : '' }}</em>
                </div>
                <div class="ld-cal__hit">
                  <span>基调命中率</span>
                  <strong :class="calHitCls(predictionCalib?.stats.toneHitRate)">
                    {{ predictionCalib?.stats.toneHitRate != null ? `${Math.round(predictionCalib.stats.toneHitRate * 100)}%` : '—' }}
                  </strong>
                  <em>&nbsp;</em>
                </div>
              </div>
              <details class="ld-cal-details">
                <summary class="mk-section__summary">校准分布与最近预测</summary>
                <div class="ld-cal__buckets">
                <div v-for="b in predictionCalib?.stats.calibration ?? []" :key="b.range" class="ld-cal__bucket">
                  <span class="ld-cal__range">{{ b.range }}</span>
                  <span class="mk-minibar ld-cal__bar"><i class="mk-minibar__fill" data-tone="warn" :style="{ width: calBarWidth(b) }"></i></span>
                  <span class="ld-cal__val">{{ b.hardRate != null ? `${Math.round(b.hardRate * 100)}%` : '—' }} (n={{ b.n }})</span>
                </div>
              </div>
              <div v-if="predictionCalib?.recent?.length" class="ld-cal__recent">
                <div v-for="p in predictionCalib.recent.slice(0, 5)" :key="p.id" class="ld-cal__row">
                  <span class="ld-cal__task" :title="p.rationale">{{ shortId(p.taskId) || '任务' }}</span>
                  <span class="ld-cal__risk">风险 {{ Math.round(p.stallRisk * 100) }}%</span>
                  <span class="ld-cal__outcome" :class="calOutcomeCls(p.outcome)">
                    {{ calOutcomeZh(p.outcome) }}
                  </span>
                </div>
              </div>
              </details>
            </div>
          </section>
        </div>
      </div>
    </div>

    <!-- ============ 知识图谱：概念图画布（节点=概念，边=前置/属于）
         卡片走 .mk-card 原语（原 ld-card* 是不存在的私有类，渲染成无样式裸块） ============ -->
    <div v-else-if="tab === 'graph'" class="ld-tabpage" id="ld-panel-graph" role="tabpanel" aria-labelledby="ld-tab-graph">
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">知识图谱</h3>
          <span v-if="graphMeta" class="mk-card__meta">
            <template v-if="graphMeta.truncated">{{ GRAPH_TRUNCATED_NOTE }} {{ graphMeta.totalConcepts }} 个 · </template>
            {{ scopeNote.label }}
          </span>
        </div>
        <MkGraphExplorer
          :nodes="graphNodes"
          :edges="graphEdges"
          :paths="graphMeta?.paths ?? []"
          :path-id="scopePathId || null"
          :show-path-rail="false"
          :theme="graphTheme"
          :loading="graphLoading"
          :error="graphError"
          height="var(--ld-graph-h)"
          :concept-facts="conceptFacts"
          empty-hint="这位学习者还没有概念图数据，路径生成后会自动补齐前置依赖并生成图谱。"
        />
      </section>
    </div>

    <!-- ============ 教学会话（2026-10-11 深设计）：列方言对齐平台「教学会话」页 ============ -->
    <div v-else-if="tab === 'sessions'" class="ld-tabpage" id="ld-panel-sessions" role="tabpanel" aria-labelledby="ld-tab-sessions">
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">教学会话</h3>
          <!-- 2026-10-23 走查：卡头原来写「N 节 · 有效 N · 废弃 N」，与下一条工具栏的三枚
               pills（有效 / 已废弃 / 窗口全部）是同一组计数读了两遍——读数归 pills，
               卡头只保留加载中/失败的即时状态。 -->
          <span v-if="ldSessLoading || ldSessError" class="mk-card__meta">
            <MkLoading v-if="ldSessLoading" inline min text="加载中…" />
            <template v-else>加载失败</template>
          </span>
          <!-- 读数归 pills；卡头只留作用域（会话列表随页级路径范围收窄，必须自明）
               + 触及窗口上限时的截断披露 -->
          <span v-else class="mk-card__meta" :title="ldSessionMetaTitle">
            {{ scopeNote.label }}<template v-if="ldSessionRows.length >= LD_SESSION_WINDOW"> · 近 {{ LD_SESSION_WINDOW }} 节窗口</template>
          </span>
        </div>
        <!-- 工具栏：视角（有效/废弃重试/窗口全部）+ 阶段（>1 阶段才出）。视角默认「有效」——
             仿真驱动的 1 秒废弃重试是驱动产物，不是教学事件（与概览「最近会话」预览同一口径） -->
        <div v-if="!ldSessLoading && !ldSessError && ldSessionRows.length" class="ld-filtbar">
          <div class="ld-filtbar__grp" role="group" aria-label="课堂视角">
            <button
              v-for="v in ldSessViews" :key="v.key" type="button" class="mk-pill"
              :class="{ 'mk-pill--active': ldSessView === v.key }" :aria-pressed="ldSessView === v.key"
              :title="v.title" @click="ldSessView = v.key"
            >{{ v.label }} · {{ v.count }}</button>
          </div>
          <div v-if="ldStageChips.length > 1" class="ld-filtbar__grp" role="group" aria-label="按阶段筛选课堂">
            <button
              type="button" class="mk-pill" :class="{ 'mk-pill--active': ldStageFilter === 'all' }"
              :aria-pressed="ldStageFilter === 'all'" @click="ldStageFilter = 'all'"
            >全部阶段 · {{ ldSessViewRows.length }}</button>
            <button
              v-for="c in ldStageChips" :key="c.key" type="button" class="mk-pill"
              :class="{ 'mk-pill--active': ldStageFilter === c.key }" :aria-pressed="ldStageFilter === c.key"
              @click="ldStageFilter = c.key"
            >{{ c.label }} · {{ c.count }}</button>
          </div>
        </div>
        <div v-if="ldSessionRowsFiltered.length" class="mk-table-scroll">
          <table class="mk-table">
            <thead>
              <!-- 列方言对齐平台页（2026-10-06 审核 #39「三行并两行」同法），并按用户走查
                   把「阶段」拆回独立列（里程碑是被 阶段切换器 直接筛选的维度，混在身份副行里
                   既读不出可筛性、也让副行变成两件事的拼盘）：会话身份=主题+路径，阶段单列。
                   列序按「读一条会话的叙事」重排（2026-10-11）：身份 → 课程位置（阶段→进度，
                   两级位置相邻）→ 结果状态 → 过程量（互动）→ 产出（课后总结）→ 元信息（时间/ID） -->
              <tr><th>课堂</th><th>阶段</th><th>进度</th><th>状态</th><th>互动</th><th>课后总结</th><th>时间</th><th>课堂 ID</th></tr>
            </thead>
            <tbody>
              <tr v-for="s in ldSessionRowsFiltered" :key="s.id" class="ld-pane-row" @click="openSessionCockpit(s.id)">
                <td>
                  <!-- 审核 #20（2026-10-06）：整行可点（鼠标）但完全不可聚焦，键盘用户打不开任何会话。
                       主题格给出行级真按钮入口（原生 button，Enter/Space/焦点环天然可用）。 -->
                  <div class="mk-cell-main">
                    <strong :title="s.topic">
                      <button type="button" class="ld-topic-btn" :title="`打开只读座舱：${s.topic}`" @click.stop="openSessionCockpit(s.id)">{{ s.topic }}</button>
                    </strong>
                    <span class="mk-cell-sub" :title="s.skill">{{ s.skill }}</span>
                  </div>
                </td>
                <td>
                  <span v-if="s.stage !== '—'" class="mk-badge mk-badge--info" :title="`按里程碑归属：${s.stage}`">{{ s.stage }}</span>
                  <span v-else class="ld-sub">—</span>
                </td>
                <td>
                  <!-- 进度优先于「已完成」字样（2026-10-11 深设计）：状态列已写状态，
                       这里再写一次是同屏复读；有进度数据就出真实行程（完成态给绿条+绿字数），
                       完成后本节只推进到路径的 x/y 这本就是要点（原先被「已完成」盖掉） -->
                  <span v-if="sessionProgressPct(s.progress) !== null" class="ld-prog" :title="ldProgTitle(s)">
                    <span class="ld-prog__num">{{ sessionProgressText(s.progress, s.status) }}</span>
                    <span class="mk-minibar ld-prog__bar">
                      <i class="mk-minibar__fill" :data-tone="sessionProgressTone(s.status) || undefined" :style="{ width: (sessionProgressPct(s.progress) ?? 0) + '%' }"></i>
                    </span>
                  </span>
                  <span v-else class="ld-sub">—</span>
                </td>
                <td>
                  <span class="mk-badge" :class="sessPaneBadgeCls(s.status)">{{ statusText(s.status) || '—' }}</span>
                  <!-- 低参与标注（平台页拍板 #1 判例）：completed 但用户消息 <2 条——状态机确属终态，
                       运营口径单独标注，避免「完成」被读成真实参与过 -->
                  <span
                    v-if="s.lowPart" class="mk-badge mk-badge--sm mk-badge--muted"
                    title="低参与：完成时用户消息不足 2 条，无真实学习参与证据"
                  >低参与</span>
                </td>
                <td>
                  <div class="ld-ia" :title="ldInteractTitle(s)">
                    <b class="ld-ia__dur" :class="{ 'ld-ia__dur--long': s.durationMin >= LD_IDLE_LONG_MINUTES }">{{ s.duration }}</b>
                    <span class="mk-cell-sub">{{ s.turns }} 回合 · 知识 {{ s.kpCount }} 点</span>
                  </div>
                </td>
                <td>
                  <span class="mk-badge" :class="ldWrapupBadgeCls(s)" :title="ldWrapupTitle(s)">{{ ldWrapupText(s) }}</span>
                  <span
                    v-if="s.advisory" class="mk-badge ld-adv" :class="advisoryOpsBadgeCls(s.advisory)"
                    :title="advisoryOpsTitle(s.advisory)"
                  ><span class="ld-adv__txt">{{ advisoryOpsText(s.advisory) }}</span></span>
                </td>
                <td class="ld-mono ld-sub" :title="s.startAbs || undefined">{{ s.startAgo }}</td>
                <td class="ld-mono ld-sub" :title="s.id">{{ shortId(s.id) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <MkEmptyState
          v-else-if="!ldSessLoading && !ldSessError" icon="◌"
          :title="ldSessEmptyTitle" :description="ldSessEmptyDesc"
        />
      </section>
    </div>

    <!-- ============ 记忆与复习（FSRS）：调度状态表（2026-10-11 深设计） ============ -->
    <div v-else-if="tab === 'memory'" class="ld-tabpage" id="ld-panel-memory" role="tabpanel" aria-labelledby="ld-tab-memory">
      <section v-if="memoryPaneRows.length" class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">{{ MEMORY_PANE_TITLE }}</h3>
          <span class="mk-card__meta">{{ memMetaText }}</span>
        </div>
        <!-- 视角（按复习状态分档）：把「待复习」这一档单独拎出来看，是这张表唯一的可动作子集。
             操作列已撤（2026-10-11）：后端无单点复习接口，每行按钮都是同一个学习者级深链、
             不携带该行身份——逐行重复按钮等于暗示不存在的单点复习功能，入口收归卡头单链接。 -->
        <div class="ld-filtbar" role="group" aria-label="按复习状态筛选">
          <div class="ld-filtbar__grp">
            <button
              v-for="v in memViews" :key="v.key" type="button" class="mk-pill"
              :class="{ 'mk-pill--active': memView === v.key }" :aria-pressed="memView === v.key"
              :title="v.title" @click="memView = v.key"
            >{{ v.label }} · {{ v.count }}</button>
          </div>
        </div>
        <div class="mk-table-scroll">
          <table class="mk-table">
            <thead>
              <!-- 「来源」列名与取值不符（值是提取次数与最近提取时间，不是来源）→ 更名「提取史」，
                   并把 lastSeenAt 一并消费（原先只出计数，最近提取时间被 title 藏着） -->
              <tr>
                <th scope="col" class="mk-th--sortable" :aria-sort="memSortState('concept')"
                  title="点列头排序：按知识点名称（中文拼音序）"
                  @click="toggleMemSort('concept')"
                ><button type="button" class="mk-th__btn" @click.stop="toggleMemSort('concept')">知识点<span class="mk-th__caret" aria-hidden="true"></span></button></th>
                <th scope="col" class="mk-th--sortable" :aria-sort="memSortState('strength')"
                  title="点列头排序：升序 = 记忆强度最弱的在前（没有强度读数的行恒排末尾）"
                  @click="toggleMemSort('strength')"
                ><button type="button" class="mk-th__btn" @click.stop="toggleMemSort('strength')">记忆强度<span class="mk-th__caret" aria-hidden="true"></span></button></th>
                <th scope="col" class="mk-th--sortable" :aria-sort="memSortState('due')"
                  title="点列头排序：升序 = 逾期最久的在前（没有到期时间的行恒排末尾）"
                  @click="toggleMemSort('due')"
                ><button type="button" class="mk-th__btn" @click.stop="toggleMemSort('due')">复习到期<span class="mk-th__caret" aria-hidden="true"></span></button></th>
                <th scope="col" class="mk-th--sortable" :aria-sort="memSortState('extract')"
                  title="点列头排序：降序 = 提取次数最多的在前"
                  @click="toggleMemSort('extract')"
                ><button type="button" class="mk-th__btn" @click.stop="toggleMemSort('extract')">提取史<span class="mk-th__caret" aria-hidden="true"></span></button></th>
                <th scope="col" class="mk-th--sortable" :aria-sort="memSortState('state')"
                  title="点列头排序：按复习状态分档（待复习 → 稳固 → 学习中 → 薄弱 → 未初始化）"
                  @click="toggleMemSort('state')"
                ><button type="button" class="mk-th__btn" @click.stop="toggleMemSort('state')">状态<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              </tr>
            </thead>
            <tbody>
              <!-- 降透明度只标「未初始化」（无任何记忆痕迹），不标「无强度读数」：
                   待复习行可能同样没有 retrievability（FSRS 未算出），但它恰恰是最该看的一行 -->
              <tr v-for="r in memoryRowsFiltered" :key="r.key" :class="{ 'ld-memrow--uninit': r.uninit }">
                <td class="ld-strong">{{ r.label }}</td>
                <td>
                  <span v-if="r.strength != null" class="ld-mt" :title="r.strengthTitle">
                    <span class="mk-minibar ld-mt__bar">
                      <i class="mk-minibar__fill" :data-tone="r.barTone" :style="{ width: r.strength + '%' }"></i>
                    </span>
                    <em>{{ r.strength }}%</em>
                  </span>
                  <span v-else class="ld-none">—</span>
                </td>
                <td class="ld-sub" :class="{ 'ld-due--overdue': r.overdue }" :title="r.dueAbs || undefined">{{ r.due }}</td>
                <td class="ld-sub" :title="r.seenAbs || undefined">{{ r.extract }}</td>
                <td><span class="mk-badge" :class="`mk-badge--${r.tone}`">{{ r.stateText }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <MkEmptyState v-else icon="◌" title="暂无记忆数据" description="该学习者还没有记忆记录，完成教学回合后自动生成。" />
      <!-- 调度与治理（温故计划/归并审计/回滚）已拆到「记忆调度」页签（2026-10-12 拍板） -->
    </div>

    <!-- ============ 记忆调度：温故计划 / 到期清单 / 同族重复 / 归并审计 / 回滚 ============ -->
    <div v-else-if="tab === 'memory-ops'" class="ld-tabpage" id="ld-panel-memory-ops" role="tabpanel" aria-labelledby="ld-tab-memory-ops">
      <!-- 原独立页 2026-10-12 先并入本页、同日拆分：面板组件 userId 驱动，详见 MemoryReview.vue 头注 -->
      <MemoryReview :user-id="subPage?.id || ''" />
    </div>

    <!-- ============ 账号与许可（人员详情合并）：整块由原 UserDetail 抽为 UserAccountPane ============ -->
    <div v-else-if="tab === 'account'" class="ld-tabpage" id="ld-panel-account" role="tabpanel" aria-labelledby="ld-tab-account">
      <UserAccountPane :user-id="subPage?.id || ''" />
    </div>

    <!-- ============ 操作记录（原型 2184-2187）：feed/feedrow；口径见注释 ============ -->
    <!-- 「学习事件」页签已撤（2026-10-11 用户拍板）：与「证据」时间线同源同量（liveEvidence 单源），
         贫化流水副本零独有信息；旧深链 ?tab=audit 由 normalizeLdTab 回落证据页签 -->
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { subPage, openSubPage, setSubPageLabel } from './store'
import { liveLearners, liveVirtuals, liveGetLearnerDetail, liveGetLearnerEvidence, liveGetLearnerPredictions, liveRecomputeLearner, liveGetMemoryTraces, timeAgo, errMsg, type LearnerEvidenceRaw, type LoadCurvePoint, type PredictionCalibration, type MemoryTraceRow } from './live'
import { evidenceDotTone, evidenceLowConfidence, evidenceSignalZh, evidenceTypeZh, evidenceFullTooltip, evidenceConfidenceTone, evidenceDensityTooltip } from './evidence'
import { conceptBarTone, transferReadinessZh, misconceptionRiskZh, normalizeLearnerTab, levelWordZh } from './learner-profile'
import { learnerMetric, type LearnerMetricKey } from '@/utils/learnerMetrics'
// pathStatusText：路径域状态文案（active → 「学习中」；全局字典是「进行中」）。本文件已从
// './statusText' 引入同名 statusText（会话域），故此处显式改名，避免两条文案链混用。
import { loadCaliber, panelScopeNote, statusText as pathStatusText } from './opsShared'
import { useTableSort } from './useTableSort'
import { adminLearningContentApi, adminMemoryReviewApi, adminTeachingSessionsApi, adminGoalConversationsApi, getUserIncludingDeleted } from '@/api/adminApi'
import {
  statusText,
  sessionStatusBadgeCls,
  sessionProgressPct,
  sessionProgressText,
  sessionProgressTitle,
  sessionProgressTone,
  advisoryOpsText,
  advisoryOpsTitle,
  advisoryOpsBadgeCls
} from './statusText'
import type { SessionProgress, OpsAdvisoryLike } from './statusText'
import type { ConceptBarTone, ConceptLedgerItem, LearnerTab } from './learner-profile'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import type { EChartsCoreOption } from 'echarts/core'
import MkChart from '@/components/mk/MkChart.vue'
import MkGraphExplorer from '@/components/mk/MkGraphExplorer.vue'
import type { MkGraphConceptFacts } from '@/components/mk/MkGraph.vue'
import type { MkGraphNode, MkGraphEdge } from '@/components/mk/MkGraph.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import MkDetailHero from '@/components/mk/MkDetailHero.vue'
import MkSubTabs from '@/components/mk/MkSubTabs.vue'
import UserAccountPane from './UserAccountPane.vue'
import MemoryReview from './MemoryReview.vue'
import MkRowList from '@/components/mk/MkRowList.vue'
import MkRow from '@/components/mk/MkRow.vue'
import { useIsDark } from '@/composables/useIsDark'
import { MK_CHART_PALETTES } from '@/components/mk/chartPalette'

const isDark = useIsDark()

/* ---------- 文案单源（R6 同文件复读治理）：同一句用户可见文案只在此定义一次，模板/脚本就地引用 ---------- */
const CONCEPT_NONE_HINT = '重算快照后自动生成。'
const PRIOR_EMPTY_LABEL = '初始默认值 · 暂无学习记录'
const PRIOR_EMPTY_TITLE = '该账号尚无学习记录，以下展示的是初始默认值，会随学习记录积累更新，不是实测结论'
const EVIDENCE_NONE_HINT = '学习事件累积后自动生成。'
const LOAD_ZONE_LSS = 'LSS 学习压力（0-100，越高越累）'
const LOAD_ZONE_LF = 'LF 疲劳度（0-100，≥60 警戒）'
const LOAD_ZONE_LSB = 'LSB 状态平衡（训练负荷减疲劳，负值表示状态差）'
const LOAD_NONE_HINT = '学习者完成课堂/任务后，系统会记录每次的压力评估。'
const CALIB_META_TITLE = '预测与实际情况的吻合率（非学习者自评）'
const GRAPH_TRUNCATED_NOTE = '仅显示部分概念，共'
const MEMORY_PANE_TITLE = '记忆与复习'
/** 路径 stage 兜底文案（快照 / 列表两处同源） */
const milestoneStageText = (p: { completedMilestones?: unknown; totalMilestones?: unknown }) =>
  String(p.totalMilestones ? `已完成 ${p.completedMilestones ?? 0}/${p.totalMilestones} 个里程碑` : '')

interface Detail {
  name: string
  email: string
  trend: 'up' | 'down' | 'flat'
  fatigue: string
  path: string
  stage: string
  task: string
  pct: number
  /** 进度分母口径（P2 双分母标注）：pct 按路径全部任务折算，与「当前里程碑」行的里程碑内分母区分 */
  taskDone: number
  taskTotal: number
  concepts: { mastered: string[]; struggling: string[]; fragile: string[] }
  sessions: { time: string; title: string; result: string; tone: 'ok' | 'warn' | 'bad' | 'muted'; concepts?: string[] }[]
  snapshot: { version: string; generatedAt: string }
}

interface EvidenceItem {
  title: string
  detail: string
  time: string
  score: number
  signal: string
  concepts: string[]
  sessionId?: string
  taskId?: string
  happenedAt?: string
}

const liveDetail = ref<Detail | null>(null)
const rawDetail = ref<Record<string, unknown> | null>(null)
const liveEvidence = ref<EvidenceItem[]>([])
const memoryTraces = ref<MemoryTraceRow[]>([])
/** 学习压力记录曲线：learning_metrics 历史（LSS/KTL/LF/LSB），来自 evidence 接口 loadCurve */
const loadCurveRaw = ref<LoadCurvePoint[]>([])
/** 预测校准（实证命中率 + 最近预测），异步加载失败为 null */
const predictionCalib = ref<PredictionCalibration | null>(null)
const recomputing = ref(false)

/**
 * 页签（原型 renderLearnerDetail 2159-2163：subtabs 由 4 项扩到 8 项）。
 * 名称对齐原型：总览→概览、知识图谱→图谱；新增 学习路径/教学会话/记忆与复习/操作记录。
 * 其后两轮裁并：学习路径（审核 #22）与学习事件（2026-10-11）撤除；
 * 2026-10-12 用户拍板「页面滚动太长，拆成两个 tab」：记忆与复习拆出「记忆调度」
 * （温故计划/归并审计/回滚——调度与治理动作台），本页签留 FSRS 普查表（读数）。
 * 新增 id 只在本页扩展——共享的 learner-profile.ts `LearnerTab` 仍是 4 项联合（未改动），
 * 本地 normalizeLdTab 先识别本地项，再回落共享 normalizeLearnerTab 处理旧 6-tab 深链重定向。
 */
const LD_TAB_IDS = ['overview', 'profile', 'evidence', 'graph', 'sessions', 'memory', 'memory-ops', 'account'] as const
type LdTab = (typeof LD_TAB_IDS)[number] | LearnerTab
/** 撤页签后的旧深链兼容落点（判例=审核 #22 的 ?tab=paths）：
 *  paths→overview（路径读数归「当前进度」卡）；audit→evidence（学习事件流水与证据时间线
 *  同源同量——liveEvidence 单源富渲染，贫化副本零独有信息，2026-10-11 用户拍板撤除） */
const LD_TAB_ALIAS: Record<string, (typeof LD_TAB_IDS)[number]> = { paths: 'overview', audit: 'evidence' }
function isLdTab(v: unknown): v is (typeof LD_TAB_IDS)[number] {
  return typeof v === 'string' && (LD_TAB_IDS as readonly string[]).includes(v)
}
function normalizeLdTab(v: unknown): LdTab {
  const s = String(v || '').toLowerCase()
  if (LD_TAB_ALIAS[s]) return LD_TAB_ALIAS[s]
  return isLdTab(s) ? s : normalizeLearnerTab(s)
}

/* 缺省落点「概览」：无落点提示的入口（画像「查真实学习者」、会话列表下钻、裸深链）用它。
   列表条目自带落点页签（?tab=，常量单点在 store 的 LEARNER_DETAIL_LANDING）：学习状态列表
   落「证据」、记忆与复习列表落「记忆与复习」——2026-10-18 用户走查改「一律概览」为按列表主题
   落点（旧约定 2026-10-11「两轴入口一致」）。无学习数据的账号轴入口由 loadDetail 兜底切
   「账号与许可」（见该处注释）。 */
const tab = ref<LdTab>('overview')

const tabs = [
  { id: 'overview' as const, label: '概览' },
  { id: 'profile' as const, label: '画像' },
  { id: 'evidence' as const, label: '证据' },
  { id: 'graph' as const, label: '图谱' },
  { id: 'sessions' as const, label: '教学会话' },
  { id: 'memory' as const, label: '记忆与复习' },
  // 2026-10-12 用户拍板「滚动太长，拆成两个 tab」：FSRS 普查（读数）与调度治理（动作）分页签
  { id: 'memory-ops' as const, label: '记忆调度' },
  // 审核 #21（2026-10-06）：原「操作记录」语义暗示管理侧审计流水，实际渲染的是与「证据」
  // 同源的学习事件（liveEvidence）——页签名改「学习事件」，口径写进卡头 title，名实一致。
  // 审核 #22（2026-10-06）：原「学习路径」单卡栅格与页级 statstrip +「当前进度」卡高度重合，
  // 下钻入口在概览卡头也已有一条（同页复读）——撤该页签，里程碑分母/路径状态并进「当前进度」卡；
  // 旧深链 ?tab=paths 由 normalizeLdTab 回落概览。
  // 2026-10-11 用户拍板：撤「学习事件」页签（审核 #21 曾只改名未去重）——与「证据」时间线
  // 同源同量的贫化副本（每行仅 类型+结果 两词），独有信息为零；旧深链 ?tab=audit 回落证据。
  // 人员详情合并（2026-10-03 用户拍板）：账号轴并入本页，?view=user 深链别名默认落本页签
  { id: 'account' as const, label: '账号与许可' }
]

/* ── 知识图谱（概念图画布）：进入 tab 才加载，避免给总览页拖一个额外请求 ── */
const graphNodes = ref<MkGraphNode[]>([])
const graphEdges = ref<MkGraphEdge[]>([])
const graphMeta = ref<{ nodeCount: number; edgeCount: number; totalConcepts: number; truncated: boolean; paths: Array<{ id: string; title: string | null }> } | null>(null)
const graphLoading = ref(false)
const graphError = ref('')
/** 当前学习路径 ID（currentPath.learningPathId / 列表兜底 base.pathId）：路径详情下钻用。
 *  注意它**随作用域走**（选哪条就是哪条）——「查看路径结构」要打开当前在读的那条。 */
const currentPathId = ref<string | null>(null)
/** 该学习者**自己的**当前路径（status=active 且 updatedAt 最新），不随上方的筛选变。
 *  用途：路径下拉的「· 当前」标记、作用域读数里「所选是不是当前路径」的判据。
 *  与 currentPathId 分开是必须的——后者在按路径取值时会被快照回写成所选路径，
 *  拿它判断「当前」会让刚选中的陌生路径自称「当前路径」（实测踩到）。 */
const learnerCurrentPathId = ref<string>('')
/**
 * 学习路径 pane 的卡数据（原型 2165-2171）：直接来自快照 currentPath 与列表兜底，
 * 不复用「当前进度」卡 DOM——它已是该学习者能拿到的全部路径信息（快照只存当前路径）。
 */
const pathInfo = ref<{ id: string | null; title: string; stage: string; task: string; done: number; total: number; pct: number } | null>(null)

/* ---------- 路径作用域（页级开关：单路径 / 全部路径）----------
   一个学习者可并存多条路径，而详情页原先焊死在「当前路径」上——读者既看不见还有别的路径、
   也切不过去（只有图谱一处自带路径轨）。现升为页级开关，驱动「当前进度 / 概念掌握 / 证据 /
   图谱 / 教学会话」；「记忆与复习」「行为基线」不随它走：
   · 记忆块结构性不可分区——memory_traces 以 (userId, conceptKey) 唯一，一个概念只有一条痕迹
     （pathId 记的是最后写入的那条），按路径切会静默吞掉在另一条路径学过的概念；
   · 行为基线本就按用户聚合（证据先验），不含路径概念。
   词汇与长释单点在 opsShared.ts 的 panelScopeNote()。 */
const scopePathId = ref<string>('')   // '' = 未定（后端按当前 active 路径回落）；选中即按该路径收窄
/** 「换学习者时复位作用域」的抑制旗标：那种赋值不是读者在切作用域，不该触发一次重读 */
let applyingScopeDefault = false
const pathOptions = ref<Array<{ id: string; title: string; status: string; updatedAt: string }>>([])
const pathOptionsLoading = ref(false)
/** 学习者名下的路径清单（选择器选项）。
 *  includeTest 恒开：这里已按 userId 收窄，「真实/测试」闸门只会把虚拟学习者的路径整批滤空。 */
async function loadPathOptions(userId: string) {
  pathOptionsLoading.value = true
  try {
    const res = await adminLearningContentApi.listPaths({ userId, limit: 100, includeTest: true })
    const rows = res?.data?.data?.paths || []
    pathOptions.value = rows.map((p) => ({
      id: String(p.id),
      title: String(p.title || p.id),
      status: String(p.status || ''),
      updatedAt: String(p.updatedAt || '')
    }))
  } catch {
    pathOptions.value = []
  } finally {
    pathOptionsLoading.value = false
  }
}
/** 作用域读数：'' = 未定（后端按「当前 active 路径」回落，不是跨路径聚合）→ 也标「当前路径」 */
const scopeNote = computed(() => {
  const title = pathOptions.value.find((p) => p.id === scopePathId.value)?.title || ''
  return !scopePathId.value || scopePathId.value === learnerCurrentPathId.value
    ? panelScopeNote('current-path', { pathTitle: title || pathInfo.value?.title || '' })
    : panelScopeNote('path', { pathTitle: title })
})
const allPathsScope = computed(() => panelScopeNote('all-paths'))
/** 学习者画像 kv 卡：用户详情补充的层级/路径数/注册时间（后端 findUserDetailForAdmin） */
const userRecord = ref<{ currentLevel: string; xp: number; pathCount: number; createdAt: string } | null>(null)
/** 跟随 admin 主题（暗色用同族配色，见 MkGraph 的 colorOf）。
 *  审核 #17（2026-10-06）：原直接读 document.documentElement.dataset.theme，
 *  无响应依赖 → 运行时切主题时图谱 Edge/画布配色停在亮色。复用响应式 isDark
 *  （useIsDark 的 MutationObserver 跟随 data-theme），与同文件图表同源。 */
const graphTheme = computed<'light' | 'dark'>(() => (isDark.value ? 'dark' : 'light'))
async function loadConceptGraph(userId: string, pathId: string | null = scopePathId.value || null) {
  if (!userId) return
  graphLoading.value = true
  graphError.value = ''
  try {
    const res = await adminMemoryReviewApi.conceptGraph(userId, pathId ? { pathId } : undefined)
    const data = res?.data?.data ?? res?.data ?? {}
    graphNodes.value = Array.isArray(data.nodes) ? data.nodes : []
    graphEdges.value = Array.isArray(data.edges) ? data.edges : []
    graphMeta.value = data.meta ?? null
  } catch (error) {
    graphError.value = `概念图加载失败：${errMsg(error)}`
    graphNodes.value = []
    graphEdges.value = []
    graphMeta.value = null
  } finally {
    graphLoading.value = false
  }
}
/** 路径轨已上移到页级（ld-scope）：同一个作用域同时管图与「概念掌握/证据/教学会话」，
 *  故图内不再自带路径轨（避免一屏两个同义控件）——作用域变化由 watch(scopePathId) 统一重拉。 */
// 进入图 tab 时按需加载（同一学习者只加载一次；切走不清空，回来即见）
watch([tab, () => subPage.value?.id], ([t, id]) => {
  if (t === 'graph' && id && !graphNodes.value.length && !graphLoading.value) void loadConceptGraph(String(id))
})

/* P0-2 tab 路由化：?tab= 深链/刷新保持（与 subPage 的 view/id 同级，不侵入 AdminConsole 机制） */
const tabRoute = useRoute()
const tabRouter = useRouter()
// URL → tab（深链/刷新/前进后退）
watch(
  () => tabRoute.query.tab,
  (t) => {
    if (typeof t === 'string' && t && t !== tab.value) tab.value = normalizeLdTab(t)
  },
  { immediate: true }
)
// tab → URL（replace：不污染历史栈）
watch(tab, (t) => {
  const cur = tabRoute.query.tab
  const target = t === 'overview' ? undefined : t
  if (cur !== target) void tabRouter.replace({ query: { ...tabRoute.query, ...(target ? { tab: target } : {}) } })
})

/** 深链兼容：旧 6-tab 名（cognitive/dynamic/memory/teaching）重定向到新 tab（本地页签优先，撤除项走别名回落） */
function switchTab(id: string) {
  tab.value = normalizeLdTab(id)
}

/** 详情加载：成功全量数据；失败但有列表兜底 → 显示兜底；失败且无兜底 → 明确错误态 */
const detailError = ref(false)
/** 请求超时保护：详情接口挂起时不再无限「加载中…」，超时后走兜底/错误态 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('详情请求超时')), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}

/** 详情加载序号：id 快速切换时旧请求后到会覆盖新数据——last-wins 守卫（忙时新加载不被丢弃，直接重跑） */
let detailLoadSeq = 0
/** 上次成功发起加载的学习者 id：区分「换人」与「同人重算」 */
let lastLoadedId: string | null = null

/** 换学习者时清空派生 state：graphNodes/predictionCalib/memoryTraces/loadCurveRaw 等是
    异步独立加载的模块级 ref，不重置会把上一个人的图谱/校准/压力曲线渲染到新详情页上 */
function resetDerivedState(id: string) {
  liveDetail.value = null
  rawDetail.value = null
  liveEvidence.value = []
  memoryTraces.value = []
  loadCurveRaw.value = []
  predictionCalib.value = null
  ldSessionRows.value = []
  ldGoalRows.value = []
  currentPathId.value = null
  pathInfo.value = null
  userRecord.value = null
  // 图谱仅在进入 graph tab 时按需加载（无 watch 兜底重拉）：
  // 只在真正换人时清空；同人重算/刷新若也清空会留下一张再不加载的空图
  if (id !== lastLoadedId) {
    graphNodes.value = []
    graphEdges.value = []
    graphMeta.value = null
  }
}

// ===== 最近会话（概览左栏 + 教学会话 pane；teaching-sessions 支持 userId 过滤，行点击下钻只读座舱） =====
interface LdSessionRow {
  id: string
  topic: string
  subText: string
  status: string
  startAgo: string
  /** 时间列 title：本地化绝对时刻（后端 ISO 是 UTC，直读会差时区） */
  startAbs: string
  /** 会话身份副行（后端 subject = 学习路径名）／阶段标签（progress 里程碑，同格并副行） */
  skill: string
  stage: string
  /** 阶段切换器用数值序号（stage 展示串之外的原始 milestoneIndex；缺省 null 不入档） */
  msIndex: number | null
  /** 互动列副行：回合（口径=用户消息条数，后端无独立回合计数） */
  turns: string
  /** 互动列主值：时长（后端 duration 单位是分钟 → N 分钟） */
  duration: string
  /** 时长原值（互动列档位：<60s 秒退弱化 / ≥1500s 长时琥珀，与平台页同阈值） */
  durationMin: number
  /** 消息条数（互动列副行 + 低参与判定同源） */
  msgCount: number
  /** 教学产出知识点数（后端 knowledgePointCount，现成字段原先未消费） */
  kpCount: number
  /** 任务级进度（进度列 minibar；与平台页同源 statusText.sessionProgress*） */
  progress: SessionProgress | null
  /** 收尾总结档（同平台页 wrapupTier 语义：complete / missing / pending） */
  wrapupTier: 'complete' | 'missing' | 'pending'
  wrapupDegraded: boolean
  /** 重规划建议（后端 ReplanAdvisory 降维，平台页同款；无有效建议为 null） */
  advisory: OpsAdvisoryLike | null
  /** 低参与标注（completed 且用户消息 <2：与平台页拍板 #1、零证据门同阈值） */
  lowPart: boolean
}
const ldSessionRows = ref<LdSessionRow[]>([])
/** 概览左栏「最近会话」卡只取前 5 条；教学会话 pane 用全量（同源） */
/* 概览「最近会话」预览默认排除已废弃（2026-10-11 走查：仿真跑批的废弃会话把真实记录顶出
   预览，5 条里 4 条同名废弃）；教学会话页签仍看全量窗口。meta 如实标注隐藏了多少条。 */
const activeSessionRows = computed(() => ldSessionRows.value.filter((r) => r.status !== 'discarded'))
const recentSessionRows = computed(() => activeSessionRows.value.slice(0, 5))
const discardedHiddenCount = computed(() => ldSessionRows.value.length - activeSessionRows.value.length)
const sessionPreviewMeta = computed(() => {
  const shown = recentSessionRows.value.length
  if (discardedHiddenCount.value) return `最近 ${shown} 节有效 · 已隐藏废弃 ${discardedHiddenCount.value}`
  return ldSessionRows.value.length > shown ? `最近 ${shown} 节 · 共 ${ldSessionRows.value.length}` : `最近 ${shown} 节`
})
/** statstrip「最近会话」格已随定位条撤除（2026-10-11）；有效/总数口径仍由预览 meta 承载 */
/** 教学会话窗口上限（loadLdSessions 请求 limit 与此同源）：达上限时 meta 可见文案改
    「最近 20 条（窗口上限）」，不再让截断值被读成总量（审核 #24，2026-10-06） */
const LD_SESSION_WINDOW = 20

/* ---------- 会话视角（2026-10-11 深设计）----------
   窗口里过半是「已废弃」会话（实测 20 条中 14 条），真教学事件被顶出视线。
   语义核准（后端）：discarded 的唯一写入点是 resetSession（POST /sessions/:id/reset），
   即**学习者点「重新开始」后作废的旧会话**；users.ts 注释明确其时长按真实有效时长保留、
   仍属学习记录（不是可丢的脏数据）。口径与概览「最近会话」预览一致（废弃 = discarded）；
   超时/失败仍算有效（有教学过程与产出，是要看的信号）。 */
const ldSessView = ref<'active' | 'discarded' | 'all'>('active')
/* 有效行复用概览「最近会话」的同一过滤（activeSessionRows，本文件下方定义） */
const ldSessDiscardedRows = computed(() => ldSessionRows.value.filter((r) => r.status === 'discarded'))
const ldSessViews = computed(() => [
  { key: 'active' as const, label: '有效', count: activeSessionRows.value.length, title: '有教学内容的课堂，含超时与失败的信号记录，不含重置作废的旧课堂' },
  { key: 'discarded' as const, label: '已废弃', count: ldSessDiscardedRows.value.length, title: '学习者点「重新开始」后作废的旧课堂，时长按真实有效时长保留，仍属学习记录' },
  { key: 'all' as const, label: '窗口全部', count: ldSessionRows.value.length, title: `最近 ${LD_SESSION_WINDOW} 节窗口内的全部课堂（含已废弃）` }
])
const ldSessViewRows = computed(() =>
  ldSessView.value === 'active'
    ? activeSessionRows.value
    : ldSessView.value === 'discarded'
      ? ldSessDiscardedRows.value
      : ldSessionRows.value
)
/* 卡头读数已撤（见模板 2026-10-23 注）：计数由工具栏 pills 单点承载；title 仍是窗口口径，
   跨路径时补里程碑串档告警，单条路径下档位天然同源不再告警。 */
const ldSessionMetaTitle = computed(() => {
  const base = `该学习者最近 ${LD_SESSION_WINDOW} 节课堂（窗口上限）`
  return scopePathId.value
    ? base
    : `${base}\n注意：「里程碑 N」档位按各会话自己的里程碑序号归并，跨路径时不同路径的同序号里程碑会合到同一档。`
})

/* ---------- 阶段切换器（用户诉求「切换学习者不同阶段」）----------
   档位从会话行的 milestoneIndex 派生（后端 deriveTeachingSessionProgress 已归因，零新契约）；
   只在当前视角内有 >1 阶段时渲染（单档即全部，无筛选价值）。计数随视角走，避免跨视角误读。 */
const ldStageFilter = ref<string>('all')
const ldStageChips = computed(() => {
  const counts = new Map<number, number>()
  for (const r of ldSessViewRows.value) if (r.msIndex != null) counts.set(r.msIndex, (counts.get(r.msIndex) || 0) + 1)
  return [...counts.keys()].sort((a, b) => a - b).map((i) => ({ key: String(i), label: `里程碑 ${i}`, count: counts.get(i) as number }))
})
const ldSessionRowsFiltered = computed(() => {
  if (ldStageFilter.value === 'all') return ldSessViewRows.value
  const idx = Number(ldStageFilter.value)
  return ldSessViewRows.value.filter((r) => r.msIndex === idx)
})
/* 空态分流：窗口空 / 当前视角空（提示切视角） / 视角内阶段筛选空 */
const ldSessEmptyTitle = computed(() => (ldSessionRows.value.length ? '当前视角无课堂' : '暂无课堂'))
const ldSessEmptyDesc = computed(() => {
  if (!ldSessionRows.value.length) return '该学习者还没有产生回合记录。'
  if (!ldSessViewRows.value.length) {
    return ldSessView.value === 'active'
      ? `窗口内 ${ldSessDiscardedRows.value.length} 节均已被重置（学习者点「重新开始」后作废），切「已废弃」或「窗口全部」查看。`
      : '当前视角内没有课堂，换个视角看看。'
  }
  return '当前阶段档位下没有课堂，切回「全部阶段」。'
})

/* 课后总结列（总结 / 建议）——文案与档位照抄平台「教学会话」页，跨页同读法 */
function ldWrapupText(r: LdSessionRow): string {
  if (r.wrapupTier === 'complete') return '有总结'
  if (r.wrapupTier === 'missing') return r.wrapupDegraded ? '降级总结' : '缺总结'
  return '未生成'
}
function ldWrapupBadgeCls(r: LdSessionRow): string {
  return r.wrapupTier === 'complete' ? 'mk-badge--ok' : r.wrapupTier === 'missing' ? 'mk-badge--warn' : 'mk-badge--muted'
}
function ldWrapupTitle(r: LdSessionRow): string {
  if (r.wrapupTier === 'complete') return '收尾总结完整生成'
  if (r.wrapupTier === 'pending') return '课堂未到终态，总结尚未生成'
  return r.wrapupDegraded ? '总结不完整' : '终态课堂缺少收尾总结'
}
/* 互动列 title：长时是信号注记而非故障（与平台页同一 25 分钟阈值）。
   后端 duration 的单位是**分钟**（computeEffectiveDurationMinutes），不是秒——
   原先按秒解释，3 分钟的课在列表里显示成「3 秒」（2026-10-20 跑数时发现）。 */
const LD_IDLE_LONG_MINUTES = 25
function ldInteractTitle(r: LdSessionRow): string {
  const base = `${r.turns} 回合 · 知识 ${r.kpCount} 点`
  if (r.durationMin >= LD_IDLE_LONG_MINUTES) return `${base} · 时长 ≥ 25 分钟按长时标注（信号，非故障）`
  return base
}
function ldProgTitle(r: LdSessionRow): string {
  if (!r.progress) return '无任务级进度数据'
  const pos = sessionProgressTitle(r.progress, { withMilestone: true })
  return pos ? `路径任务进度：${pos}` : '无任务级进度数据'
}
const ldSessLoading = ref(false)
const ldSessError = ref(false)
/** 状态徽章降噪（有意域差异，收尾批 C10 登记）：仅异常态上色、正常态全灰——列表降噪视图；全彩版见 statusText.sessionStatusBadgeCls 单源 */
const sessBadgeCls = (s: string) =>
  s === 'failed' || s === 'timeout' || s === 'discarded' || s === 'finalization_failed'
    ? 'mk-badge--bad'
    : s === 'superseded'
      ? 'mk-badge--warn'
      : 'mk-badge--muted'

function openSessionCockpit(sessionId: string) {
  const sp = subPage.value
  openSubPage('session-real', sessionId, sp ? { from: { view: sp.view, id: sp.id, label: liveDetail.value?.name } } : undefined)
}

/* ===== 最近目标对话（2026-10-19 用户拍板：对象轴与「最近会话」并列） =====
   目标对话接口不支持 pathId，故由行上的 learningPathId 在客户端跟随页级路径作用域；
   includeTest 与同页会话读数同源。 */
interface LdGoalRow {
  id: string
  summary: string
  status: string
  subText: string
  createdAgo: string
  createdTs: number
  learningPathId: string
}
const ldGoalRows = ref<LdGoalRow[]>([])
const ldGoalLoading = ref(false)
const ldGoalError = ref(false)
/** 概览只取前 4 条（与会话预览 5 条同量级） */
const LD_GOAL_PREVIEW = 4
/* 目标对话上的 learningPathId 可能是路径创建时的临时前缀（真实 id 末尾还带 _xxxxx），
   故按「带 _ 边界的同源 id」匹配；严格相等会把本路径的目标全部过滤掉（实测：
   目标存 lp_1792431234902，路径实际是 lp_1792431234902_oyjo73i）。 */
function goalInScope(g: LdGoalRow): boolean {
  const pid = scopePathId.value
  if (!pid) return true
  const gid = g.learningPathId
  if (!gid) return false
  return pid === gid || pid.startsWith(`${gid}_`) || gid.startsWith(`${pid}_`)
}
const activeGoalRows = computed(() => ldGoalRows.value.filter(goalInScope))
const recentGoalRows = computed(() => activeGoalRows.value.slice(0, LD_GOAL_PREVIEW))
const goalPreviewMeta = computed(() => {
  const shown = recentGoalRows.value.length
  const scope = scopePathId.value ? ' · 当前路径' : ''
  return activeGoalRows.value.length > shown
    ? `最近 ${shown} 条 · 共 ${activeGoalRows.value.length}${scope}`
    : `最近 ${shown} 条${scope}`
})
/** goal 摘要（对齐 GoalConversations.summaryOf：description 优先，兜底解析 collectedData） */
function goalSummaryOf(c: Record<string, unknown>): string {
  if (c.description) return String(c.description)
  try {
    const cd = JSON.parse(String(c.collectedData || '{}'))
    return String(cd.goal || cd.learningGoal || cd.objective || cd.target || '—')
  } catch {
    return '—'
  }
}

/** 会话时长（后端 duration 单位：分钟）→ 「N 分钟 / N 小时 M 分」；0/缺省显 — */
function formatDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return '—'
  if (minutes < 60) return `${minutes} 分钟`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
}

/** 教学会话 pane 状态徽章：已上收共享单源 statusText.sessionStatusBadgeCls（收尾批 C10；别名超集逐值等价迁移） */
function sessPaneBadgeCls(s: string): string {
  return sessionStatusBadgeCls(s)
}

/** 当前学习路径 → 会话座舱 Path 阶段页签（2026-10-12 拍板：路径不再有独立详情页；
 *  view=path 是深链适配层，解析出对话后带本页 from 换开座舱，返回键回到这个学习者） */
function openPathDetail() {
  const sp = subPage.value
  /* 记来源：从本详情进路径后，面包屑返回要回到这个学习者（含原页签），
     而不是一级列表——同页开真实会话（openSession）的既有做法。 */
  if (currentPathId.value) {
    openSubPage('path', currentPathId.value, sp ? { from: { view: sp.view, id: sp.id, label: liveDetail.value?.name } } : undefined)
  }
}

async function loadLdSessions(id: string, includeTest: boolean) {
  const seq = detailLoadSeq
  ldSessLoading.value = true
  ldSessError.value = false
  const stale = () => seq !== detailLoadSeq || subPage.value?.id !== id
  try {
    // limit 20：教学会话 pane 需要更完整列表（原概览卡只展示 5 条，由 recentSessionRows 截取）
    // pathId：随页级路径作用域走（空 = 跨全部路径）；teaching_sessions.learningPathId 单列直连
    // includeTest：与详情同源（深链不带 includeTest 时，虚拟账号由账号身份兜底）
    const res = await adminTeachingSessionsApi.list({
      userId: id,
      limit: LD_SESSION_WINDOW,
      includeTest,
      ...(scopePathId.value ? { pathId: scopePathId.value } : {})
    })
    // 竞态守卫与 loadDetail 同款：换人/重载后丢弃旧响应
    if (stale()) return
    const body = res.data?.data ?? res.data ?? {}
    ldSessionRows.value = ((body.items as Record<string, unknown>[]) || []).map((s) => {
      const progress = (s.progress || null) as SessionProgress | null
      /* 产物列两条来源（降维口径照抄平台「教学会话」页 mapRow，保证跨页同读法）：
         wrapup.status/sources → 总结档；advisory.ui/{shouldSuggest,priority} → 有效建议 */
      const wrapup = (s.wrapup || null) as Record<string, unknown> | null
      const summary = (wrapup?.summary || null) as Record<string, unknown> | null
      const sources = (wrapup?.sources || {}) as Record<string, string>
      const rawAdvisory = (s.advisory || null) as Record<string, unknown> | null
      const advisory = rawAdvisory
        ? {
            priority: String(rawAdvisory.priority || ''),
            recommendation: String(rawAdvisory.recommendation || ''),
            scope: String(rawAdvisory.scope || ''),
            reasonCodes: Array.isArray(rawAdvisory.reasonCodes) ? rawAdvisory.reasonCodes.map(String) : [],
            rationale: String(rawAdvisory.rationale || ''),
            learnerResponse: (rawAdvisory.learnerResponse as OpsAdvisoryLike['learnerResponse']) || null,
            ui: (rawAdvisory.ui as OpsAdvisoryLike['ui']) || null
          }
        : null
      const advisoryRelevant = !!advisory && rawAdvisory?.shouldSuggest !== false && !['none', ''].includes(advisory.priority)
      const status = String(s.status || '')
      const msgCount = Number(s.messageCount || 0)
      const durationMin = Number(s.duration || 0)
      const terminal = ['completed', 'succeeded', 'failed', 'timeout', 'finalization_failed', 'discarded', 'superseded'].includes(status)
      return {
        id: String(s.id),
        topic: String(s.topic || s.taskId || '未命名课堂'),
        subText: `${String(s.subject || '—')} · ${msgCount} 条消息`,
        status,
        startAgo: timeAgo(String(s.startTime || '')),
        startAbs: s.startTime ? new Date(String(s.startTime)).toLocaleString() : '',
        skill: String(s.subject || s.taskType || '—'),
        stage: progress && progress.totalMilestones ? `里程碑 ${progress.milestoneIndex || 0}/${progress.totalMilestones}` : '—',
        msIndex: progress && typeof progress.milestoneIndex === 'number' && progress.milestoneIndex > 0 ? progress.milestoneIndex : null,
        turns: String(msgCount),
        duration: formatDuration(durationMin),
        durationMin,
        msgCount,
        kpCount: Number(s.knowledgePointCount || 0),
        progress,
        wrapupTier: wrapup?.status === 'complete' ? 'complete' : terminal ? 'missing' : 'pending',
        wrapupDegraded: wrapup?.status === 'summary-only'
          || String(sources.summary || '').includes('fallback')
          || /重新开始本节|重新完成一次完整的学习/.test(String(summary?.practiceAdvice || '')),
        advisory: advisoryRelevant ? advisory : null,
        lowPart: (status === 'completed' || status === 'succeeded') && msgCount < 2
      }
    })
    // 换人/重载后旧筛选档可能已不存在（阶段集合随会话窗口变化）→ 回到「全部」
    if (!ldStageChips.value.some((c) => c.key === ldStageFilter.value)) ldStageFilter.value = 'all'
  } catch {
    if (!stale()) ldSessError.value = true
  } finally {
    if (!stale()) ldSessLoading.value = false
  }
}

async function loadLdGoals(id: string, includeTest: boolean) {
  const seq = detailLoadSeq
  ldGoalLoading.value = true
  ldGoalError.value = false
  const stale = () => seq !== detailLoadSeq || subPage.value?.id !== id
  try {
    const api = adminGoalConversationsApi
    if (!api?.list) return
    const res = await api.list({
      userId: id,
      limit: 12,
      includeTest
    })
    if (stale()) return
    const body = res.data?.data ?? res.data ?? {}
    ldGoalRows.value = ((body.conversations as Record<string, unknown>[]) || [])
      .map((c) => ({
        id: String(c.id),
        summary: goalSummaryOf(c),
        status: String(c.status || ''),
        subText: c.learningPathId ? '已生成学习路径' : '未生成学习路径',
        createdAgo: timeAgo(String(c.createdAt || '')),
        createdTs: new Date(String(c.createdAt || '')).getTime() || 0,
        learningPathId: String(c.learningPathId || '')
      }))
      .sort((a, b) => b.createdTs - a.createdTs)
  } catch {
    if (!stale()) ldGoalError.value = true
  } finally {
    if (!stale()) ldGoalLoading.value = false
  }
}

async function loadDetail(id: string | undefined, opts: { soft?: boolean } = {}) {
  if (!id) return
  const seq = ++detailLoadSeq
  // soft = 同一学习者换路径作用域的重读：不撤 liveDetail（loading 是 computed(!liveDetail)，
  // 撤了整页骨架会闪一次），也不清派生态——下方各赋值本就全量覆盖，且路径作用域只改数据的
  // 取值范围、不改页面结构，用骨架遮住整页是过度反应。
  if (!opts.soft) resetDerivedState(id)
  lastLoadedId = id
  detailError.value = false
  // 深链保持：URL 明确带 ?tab= 时尊重它，否则回落总览。
  // （此前无条件置 'overview'，会把 ?tab=profile/evidence/graph 的深链与刷新全部冲掉——
  //  与上方「P0-2 tab 路由化：?tab= 深链/刷新保持」的约定相矛盾，实测发现。）
  const urlTab = typeof tabRoute.query.tab === 'string' ? tabRoute.query.tab.trim() : ''
  // 落点来源：?tab=（列表条目带进来的落点页签，或读者自己切过的页签）> 概览。
  // 2026-10-11 曾统一为「概览」（列表行已展示账号事实，点详情的动机是看学习侧）；
  // 2026-10-18 用户走查改为按列表主题落点（学习状态→证据、记忆与复习→记忆与复习），
  // 由列表页在打开二级页时带 ?tab=（映射单点在 store 的 LEARNER_DETAIL_LANDING）。
  tab.value = urlTab ? normalizeLdTab(urlTab) : 'overview'
  const base = liveLearners.value.find((l) => l.userId === id)
  // 路径作用域：取页级开关的值（'' = 全部路径 → 不传 pathId，后端走 global 聚合）。
  // 开关的默认值在「换学习者」watch 里置为该学习者的当前路径（= 本改动前的行为）。
  const pathId = scopePathId.value || undefined
  // 面包屑先以列表兜底名回写（详情加载成功后覆盖为详情名）
  if (base?.name) setSubPageLabel(base.name)
  // 竞态守卫：任一 await 之后 id 已变（或已触发更新的加载）→ 丢弃本响应
  const stale = () => seq !== detailLoadSeq || subPage.value?.id !== id
  // 用户记录先查一步（单行主键查询）：详情页是**用户作用域**页面，虚拟/测试口径从账号自身
  // 身份来，不取决于入口——2026-10-12 记忆页签合并后深链（重定向/总览 KPI/画像菜单）都不带
  // includeTest，虚拟账号的 traces/evidence 被全局口径拒成空（普查表「暂无记忆数据」与调度
  // 面板 46 条同屏矛盾，实测证据端点直接 404「需显式包含」）。
  let accountIsTest = !!base?.isVirtualLearner || /^virtual_/.test(id)
  let userRow: Record<string, unknown> | null = null
  try {
    const rec = await getUserIncludingDeleted(id)
    if (stale()) return
    userRow = (rec?.data?.data ?? rec?.data ?? null) as Record<string, unknown> | null
    if (userRow && (userRow as Record<string, unknown>).isVirtualLearner === true) accountIsTest = true
  } catch { /* 用户记录失败按入口旗标走（原行为），详情照常 */ }
  // 从用户详情显式进入学习者画像时携带 includeTest（虚拟/测试账号可查，默认视图仍排除）
  const includeTest = subPage.value?.includeTest || accountIsTest
  try {
    // 详情与证据并行（此前串行 await：两个独立接口白等一趟 RTT）
    const [raw, evidenceRes] = await Promise.all([
      withTimeout(liveGetLearnerDetail(id, pathId, includeTest), 12000) as Promise<Record<string, unknown>>,
      liveGetLearnerEvidence(id, pathId, includeTest).catch(() => ({ items: [], domain: [], loadCurve: [] }))
    ])
    if (stale()) return
    // 画像/证据/概览多处 computeds 读 rawDetail（:1370-1382）——此前只在 resetDerivedState
    // 里置 null、从未回填，导致画像页签 10 张卡、证据页签指标卡、概览学习状态追踪全部
    // 只落空态。这里补齐唯一的赋值点。
    rawDetail.value = raw
    const model = (raw.model as Record<string, unknown>) || raw
    const km = ((model.knowledgeMemory as Record<string, unknown>) || (raw.knowledgeMemory as Record<string, unknown>) || {}) as Record<string, unknown>
    const currentPath = (km.currentPath || {}) as Record<string, unknown>
    // 路径详情下钻的真实 ID：优先快照里的 currentPath.learningPathId，列表兜底 base.pathId
    currentPathId.value = String(currentPath.learningPathId || base?.pathId || '') || null
    // 开关读数落定：名单里查不到该学习者（虚拟/测试账号不在默认视角）时 scopePathId 仍是 ''，
    // 而本次响应的数据就是「当前路径」那份 → 把作用域写实成这条路径。
    // 不触发重读：加载用的就是同一份数据，只是把「隐式回落」标成显式的路径。
    if (!scopePathId.value && currentPathId.value) {
      applyingScopeDefault = true
      scopePathId.value = currentPathId.value
      applyingScopeDefault = false
      // 本次是「不带 pathId」的请求，故快照的 currentPath 就是该学习者自己的当前路径。
      // 按路径取值时不覆盖——那时 currentPath 反映的是所选路径，不是「当前路径」。
      if (!learnerCurrentPathId.value) learnerCurrentPathId.value = currentPathId.value
    }
    const progress = (currentPath.progress || {}) as Record<string, number>
    const globalSignals = (km.globalSignals || {}) as Record<string, unknown>
    const conceptStates = Array.isArray(currentPath.conceptStates)
      ? (currentPath.conceptStates as { label?: string; status?: string }[])
      : []
    const totalTasks = Number(progress.totalTasks || 0)
    // 审核 #15（2026-10-06）：不存在的 userId 深链——详情接口对未知 id 返回 200 空壳
    // （data 里有 scope.userId 但无 userName、无任务），列表兜底也没有。必须走既有错误态，
    // 否则渲染出「趋势：→ 稳定 / 疲劳：低 / 路径 0%」的假详情（同页 ?tab=account 却能正确报错）。
    // 例外：账号页签（?view=user / ?tab=account）由 UserAccountPane 自取用户记录、自带
    // 「该用户不存在或已被删除」错误态；且软删用户需在此恢复（列表域不含软删行），
    // 故该页签不置页级错误，避免挡住恢复入口。
    if (tab.value !== 'account' && !base && !model.userName && !totalTasks) {
      // 账号轴入口（用户与学习者）且无任何学习侧数据（虚拟/测试账号常态）：落「账号与许可」
      // ——UserAccountPane 自取用户记录、自带错误态与软删恢复入口（原 ?view=user 默认落点语义）
      if (subPage.value?.view === 'user') {
        tab.value = 'account'
      } else {
        detailError.value = true
        return
      }
    }
    const completedTasks = Number(progress.completedTasks || 0)
    const pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    // 学习路径 pane 卡数据：快照 currentPath + 列表兜底（快照只含当前路径，故栅格通常单卡）
    pathInfo.value = {
      id: currentPathId.value,
      title: String((currentPath.pathTitle as string) || model.pathTitle || ''),
      stage: base?.currentMilestone || milestoneStageText(progress),
      task: base?.currentTask || '',
      done: Number(progress.completedMilestones || 0),
      total: Number(progress.totalMilestones || 0),
      pct
    }
    const mapEvidence = (e: Record<string, unknown>): EvidenceItem => {
      const raw = e as LearnerEvidenceRaw
      return {
        title: String(raw.type || raw.kind || '学习事件'),
        detail: String(raw.detail || raw.signal || ''),
        time: timeAgo(String(raw.happenedAt || raw.createdAt || '')),
        signal: String(raw.signal || ''),
        score: Number(raw.score || 0),
        concepts: Array.isArray(raw.conceptKeys) ? raw.conceptKeys.map(String) : [],
        sessionId: raw.sessionId ? String(raw.sessionId) : undefined,
        taskId: raw.taskId ? String(raw.taskId) : undefined,
        happenedAt: raw.happenedAt ? String(raw.happenedAt) : undefined
      }
    }
    // 教学域 4 类 + 目标/路径域（learner_evidence 表持久化事件）合并为完整时间线，按时间倒序
    const merged = [
      ...evidenceRes.items.map(mapEvidence),
      ...evidenceRes.domain.map(mapEvidence)
    ].sort((a, b) => {
      const ta = a.happenedAt ? new Date(a.happenedAt).getTime() : 0
      const tb = b.happenedAt ? new Date(b.happenedAt).getTime() : 0
      return tb - ta
    })
    liveEvidence.value = merged
    loadCurveRaw.value = evidenceRes.loadCurve || []
    // 校准/记忆痕迹：fire-and-forget 但必须带序号守卫，否则旧 id 的迟响应会写穿新详情
    void liveGetLearnerPredictions(id, includeTest).then((calib) => {
      if (stale()) return
      predictionCalib.value = calib
    })
    void liveGetMemoryTraces({ userId: id, includeVirtual: includeTest })
      .then((rows) => {
        if (stale()) return
        memoryTraces.value = rows
      })
      .catch(() => {
        if (stale()) return
        memoryTraces.value = []
      })
    liveDetail.value = {
      name: base?.name || String(model.userName || id),
      email: base?.email || '',
      trend: base?.trend || 'flat',
      fatigue: base?.fatigue || '低',
      path: String((currentPath.pathTitle as string) || model.pathTitle || '尚未开始学习'),
      stage: base?.currentMilestone || milestoneStageText(progress),
      task: base?.currentTask || '未开始',
      pct,
      taskDone: completedTasks,
      taskTotal: totalTasks,
      concepts: {
        mastered: (globalSignals.masteredConcepts as string[]) || [],
        struggling: base?.struggling || conceptStates.filter((c) => c.status === 'struggling').map((c) => String(c.label)),
        fragile: base?.fragile || conceptStates.filter((c) => c.status === 'fragile').map((c) => String(c.label))
      },
      sessions: liveEvidence.value.slice(0, 6).map((e) => ({
        time: e.time,
        title: e.title,
        result: evidenceSignalZh(e.signal, e.title) || e.detail || '—',
        tone: evidenceDotTone(e.signal, e.score, e.title),
        concepts: e.concepts
      })),
      snapshot: {
        version: base
          ? base.confidence == null
            ? '置信未知'
            : `置信 ${(base.confidence * 100).toFixed(0)}%${evidenceLowConfidence(base.confidence) ? ' · 证据不足' : ''}`
          : '—',
        generatedAt: timeAgo(base?.generatedAt)
      }
    }
    // 面包屑回写详情名（内部 ID → 中文名；title 仍保留全 ID）
    setSubPageLabel(liveDetail.value.name)
    // 用户记录：主流程前段已取（含 isVirtualLearner 定虚拟/测试口径），此处仅回填
    // 「学习者画像」kv 卡的层级/路径数/注册时间与 h1 姓名（快照里没存昵称的账号，否则 h1 是裸 user_id）
    if (userRow) {
      const u = userRow as Record<string, unknown>
      const counts = (u._count || {}) as Record<string, unknown>
      userRecord.value = {
        currentLevel: String(u.currentLevel || ''),
        xp: Number(u.xp || 0),
        pathCount: Number(counts.learning_paths || 0),
        createdAt: String(u.createdAt || '')
      }
      const nm = String(u.name || '')
      if (nm && liveDetail.value && liveDetail.value.name === id) {
        liveDetail.value = { ...liveDetail.value, name: nm, email: String(u.email || liveDetail.value.email) }
        setSubPageLabel(nm)
      }
    }
    // 总览左栏「最近会话」「最近目标对话」：独立接口，失败不影响主详情
    void loadLdSessions(id, includeTest)
    void loadLdGoals(id, includeTest)
  } catch (e) {
    if (stale()) return
    if (base) {
      // 列表兜底：详情接口失败时至少展示列表里已有的信息
      liveDetail.value = {
        name: base.name,
        email: base.email,
        trend: base.trend,
        fatigue: base.fatigue,
        path: base.pathTitle || '尚未开始学习',
        stage: base.currentMilestone || '',
        task: base.currentTask || '未开始',
        pct: 0,
        taskDone: 0,
        taskTotal: 0,
        concepts: { mastered: [], struggling: base.struggling, fragile: base.fragile },
        sessions: [],
        snapshot: {
          version: base.confidence == null
            ? '置信未知'
            : `置信 ${(base.confidence * 100).toFixed(0)}%${evidenceLowConfidence(base.confidence) ? ' · 证据不足' : ''}`,
          generatedAt: timeAgo(base.generatedAt)
        }
      }
      setSubPageLabel(base.name)
      // 列表兜底也保留路径下钻能力（pathId 来自 liveLearners 列表行）
      currentPathId.value = base.pathId || null
      pathInfo.value = base.pathId
        ? { id: base.pathId, title: base.pathTitle || '尚未开始学习', stage: base.currentMilestone || '', task: base.currentTask || '', done: 0, total: 0, pct: 0 }
        : null
      toast.error(`详情接口暂时不可用，已显示列表快照：${errMsg(e)}`)
    } else {
      detailError.value = true
    }
  }
}

/**
 * 记忆与复习（归并凭据 / 回滚 / 到期明细）：跨页深链到 `/admin/memory-review?userId=…`。
 * 该页已支持 `userId` 深链（见 MemoryReview.vue 的 onMounted 注释），此前缺的正是"从学习者详情进去"这一环。
 */
watch(
  () => subPage.value?.id,
  (id) => {
    // 换学习者：路径作用域复位到该学习者的当前路径（= 本改动前的默认行为），并载入路径清单。
    // 置旗标抑制下面那个 watch——复位是「随换人重来」，不是读者切作用域，别重复发起一次重读。
    const base = liveLearners.value.find((l) => l.userId === id)
    applyingScopeDefault = true
    scopePathId.value = base?.pathId || ''
    applyingScopeDefault = false
    // 学习者自己的当前路径（不随筛选变）：名单口径优先，名单里没有（虚拟/测试账号不在默认视角）
    // 时留空，由首份快照回填（见 loadDetail）
    learnerCurrentPathId.value = base?.pathId || ''
    if (id) void loadPathOptions(String(id))
    void loadDetail(id)
  },
  { immediate: true, flush: 'sync' }
)

/* 路径作用域切换（页级开关的唯一副作用点）：同一学习者按所选路径重读。
   soft=1 不闪整页骨架；图缓存同步失效（旧图是另一条路径的，留着就是串数据）。
   「教学会话」随 loadDetail 一起重拉（pathId 已进该请求）。
   flush:'sync' 是必需的——复位/写实那两处靠 applyingScopeDefault 抑制本 watch，
   而默认的 'pre' 会把回调推到下一 tick，那时旗标早已复位，抑制就失效了（实测多发一次重读）。 */
watch(scopePathId, (next) => {
  if (applyingScopeDefault) return
  const id = subPage.value?.id
  if (!id) return
  graphNodes.value = []
  graphEdges.value = []
  graphMeta.value = null
  graphError.value = ''
  void loadDetail(id, { soft: true })
  if (tab.value === 'graph') void loadConceptGraph(String(id), next || null)
}, { flush: 'sync' })

async function recompute() {
  const id = subPage.value?.id
  if (!id || recomputing.value) return
  const name = liveDetail.value?.name || id
  const ok = await askConfirm({
    title: '重算快照',
    message: `确认重算「${name}」的学习者快照？将重新分析其学习状态与概念掌握情况。`,
    confirmText: '重算',
    danger: false
  })
  if (!ok) return
  recomputing.value = true
  try {
    const base = liveLearners.value.find((l) => l.userId === id)
    await liveRecomputeLearner(id, base?.pathId)
    toast.success('快照已重算')
    const prevTab = tab.value
    await loadDetail(id)
    tab.value = prevTab
  } catch (e) {
    toast.error(`重算失败：${errMsg(e)}`)
  } finally {
    recomputing.value = false
  }
}

const loading = computed(() => !liveDetail.value && !detailError.value)

/** statstrip 已整体撤除（2026-10-11 用户走查）：pctTitle/sessionStrip* 随之退役；
 *  四格读数各由归属页签承载，页签间定位交给页签栏 */

const d = computed<Detail | null>(() => {
  if (detailError.value) return null
  return liveDetail.value || null
})

/* ---------- Tab 数据推导 ---------- */
const profile = computed(() => (rawDetail.value?.profile || null) as Record<string, unknown> | null)
const dynamicState = computed(() => (rawDetail.value?.dynamicState || null) as Record<string, unknown> | null)
interface TeachingHintsShape {
  recommendedApproach?: string
  promptEnhancement?: string
  emphasize?: string[]
  avoid?: string[]
  riskFactors?: string[]
}

const teachingHints = computed(() => (rawDetail.value?.teachingHints || null) as TeachingHintsShape | null)
/** 后端建议文本每句自带句号、拼接处出「。。」，且原文自带「【个性化要求】」头与卡内标签重复：
    显示层归一句读、剥重复头（2026-10-11 走查） */
const cleanHint = (s: string) => s.replace(/^\s*【个性化要求】\s*/, '').replace(/。。+/g, '。').replace(/。，/g, '。')
/** 「个性化要求」按句拆行（原四句连排一坨，读感差） */
const promptHintLines = computed(() =>
  cleanHint(teachingHints.value?.promptEnhancement || '')
    .split('。')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${s}。`)
)
/** 最近动态连续合并（2026-10-11 用户拍板）：相邻且同概念+同结果的事件折叠为一条——
    每轮课会成对产出「教学会话」+「总结」两条事件，逐条列出读感重复；合并后类型并排
    「教学会话 + 总结」，×N 为组内条数。只合并相邻条目，交叉出现仍各占一行。 */
const recentActivityMerged = computed(() => {
  const out: Array<{ time: string; titles: string[]; result: string; tone: 'ok' | 'warn' | 'bad' | 'muted'; concepts?: string[]; count: number }> = []
  for (const s of d.value?.sessions || []) {
    const prev = out[out.length - 1]
    if (prev && prev.result === s.result && (prev.concepts || []).join('|') === (s.concepts || []).join('|')) {
      if (!prev.titles.includes(s.title)) prev.titles.push(s.title)
      prev.count++
      continue
    }
    out.push({ time: s.time, titles: [s.title], result: s.result, tone: s.tone, concepts: s.concepts, count: 1 })
  }
  return out
})
const knowledgeMemory = computed(() => (rawDetail.value?.knowledgeMemory || null) as Record<string, unknown> | null)
const controlState = computed(() => (rawDetail.value?.learningControlState || null) as Record<string, unknown> | null)
/** 证据记录：后端 learner-models 证据接口 */
const evidence = computed(() => liveEvidence.value)

/** 后端快照的英文枚举 → 中文（参照 LearnerCenter mapTrend/mapFatigue 模式） */
const EN_ZH: Record<string, string> = {
  high: '高', medium: '中', low: '低',
  intuitive: '直觉型', logical: '逻辑型', visual: '视觉型', practical: '实践型', mixed: '混合型',
  'concept-confusion': '概念混淆', 'application-difficulty': '应用困难', 'principle-misunderstanding': '原理误解', none: '无',
  scattered: '零散', systematic: '系统', blank: '空白',
  overconfident: '偏高', accurate: '准确', underconfident: '偏低',
  video: '视频', reading: '阅读', practice: '实践',
  'theory-first': '理论优先', 'practice-first': '实践优先', balanced: '均衡',
  short: '短', long: '长',
  easy: '简单', hard: '挑战',
  interest: '兴趣驱动', 'problem-solving': '问题驱动', 'external-pressure': '外部压力', career: '职业目标',
  confident: '自信', moderate: '适中', anxious: '焦虑',
  improving: '上升', stable: '稳定', declining: '下降',
  rising: '上升', falling: '下降',
  strong: '良好', weak: '较弱',
  slow: '放缓', fast: '加快',
  immediate: '即时', delayed: '延迟', 'on-request': '按需',
  small: '小步', large: '大步',
  true: '是', false: '否',
  /* 用户详情 currentLevel（学习者画像 kv 卡层级）——等级词汇单点在 learner-profile.ts levelWordZh */
  beginner: levelWordZh('beginner'), intermediate: levelWordZh('intermediate'), advanced: levelWordZh('advanced')
}
const zh = (v: unknown): string => {
  const s = String(v ?? '')
  return EN_ZH[s] ?? s
}

/** 会话/任务 ID 缩短显示：取末 8 位（前缀是稳定类型标识，末段是随机部分，足够区分） */
function shortId(id?: string): string {
  if (!id) return ''
  const s = String(id)
  return s.length <= 8 ? s : s.slice(-8)
}

/** 是否为 goal/path 域证据（目标澄清/路径事件：置信度=过程完成度，不套学习成败语义） */
function isDomainEvidence(type: string): boolean {
  return ['goal:understanding:updated', 'path:created', 'path:generated', 'path:adjusted', 'path:completed'].includes(type)
}

function kvRows(obj: Record<string, unknown> | null, labels: Record<string, string>) {
  if (!obj) return [] as { label: string; value: string }[]
  /* 后端原始浮点直出（23.06896551724138 / 0.9266399999999999）显示层收敛：
     小数 ≥5 位 → 四舍五入到 2 位（2026-10-11 走查） */
  const tidy = (v: unknown) => {
    const s = zh(v)
    return /^-?\d+\.\d{5,}$/.test(s) ? Number(s).toFixed(2) : s
  }
  return Object.entries(labels)
    .filter(([key]) => obj[key] != null && obj[key] !== '')
    .map(([key, label]) => ({ label, value: tidy(obj[key]) }))
}

const cognitiveRows = computed(() =>
  kvRows((profile.value?.cognitive || null) as Record<string, unknown> | null, {
    metacognitionLevel: '元认知水平',
    thinkingStyle: '思维风格',
    confusionPattern: '困惑模式',
    priorKnowledgeStructure: '先备知识结构',
    selfAssessmentAccuracy: '自评准确度'
  })
)

const preferenceRows = computed(() => [
  ...kvRows((profile.value?.preferences || null) as Record<string, unknown> | null, {
    preferredStyle: '偏好风格',
    theoryVsPractice: '理论 vs 实践',
    sessionLength: '单次时长',
    preferredDifficulty: '难度偏好',
    prefersHints: '是否偏好提示'
  }),
  ...kvRows((profile.value?.emotional || null) as Record<string, unknown> | null, {
    motivationTrigger: '动机触发',
    urgencyLevel: '紧迫感',
    confidenceLevel: '自信水平',
    frustrationTolerance: '挫败耐受',
    rewardSensitivity: '奖励敏感度'
  })
])

/** 画像补充展示：学习行为基线（behavioral）——运营价值：判断「节奏是否适合当前干预」 */
const behaviorRows = computed(() =>
  kvRows((profile.value?.behavioral || null) as Record<string, unknown> | null, {
    avgResponseTime: '平均响应（秒）',
    avgMessageLength: '平均消息长度（字）',
    avgInteractionInterval: '互动间隔（分钟）',
    engagementLevel: '投入度',
    consistencyScore: '一致性'
  })
)

/** 画像补充展示：互动历史（history）——运营价值：总盘子与主题分布，判断是否深耕单一主题 */
const historyRows = computed(() => {
  const h = (profile.value?.history || null) as Record<string, unknown> | null
  if (!h) return [] as { label: string; value: string }[]
  const rows = kvRows(h, {
    totalSessions: '总课堂数',
    totalMessages: '总消息数',
    avgSessionDuration: '平均课堂时长（分钟）'
  })
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
  if (arr(h.topicsExplored).length) rows.push({ label: '探索主题', value: arr(h.topicsExplored).slice(0, 8).join('、') })
  if (arr(h.conceptsStruggled).length) rows.push({ label: '挣扎过概念', value: arr(h.conceptsStruggled).slice(0, 8).join('、') })
  if (arr(h.conceptsMastered).length) rows.push({ label: '已掌握概念', value: arr(h.conceptsMastered).slice(0, 8).join('、') })
  return rows
})

/** 画像补充展示：课程控制（curriculumControls）——运营价值：平台侧可执行的粒度/密度/复习策略 */
const curriculumRows = computed(() =>
  kvRows((profile.value?.curriculumControls || null) as Record<string, unknown> | null, {
    taskGranularityLevel: '任务粒度',
    conceptDensityLevel: '概念密度',
    reviewFrequencyLevel: '复习频率',
    progressionStrategyNote: '推进策略'
  })
)

/** 画像补充展示：派生洞察（derivedInsights）——运营价值：速度/最佳时长/建议方式直接落到干预动作 */
const derivedRows = computed(() => {
  const dv = (profile.value?.derivedInsights || null) as Record<string, unknown> | null
  if (!dv) return [] as { label: string; value: string }[]
  const rows = kvRows(dv, {
    learningVelocity: '学习速度',
    optimalSessionLength: '最佳单次时长（分钟）',
    recommendedDifficulty: '推荐难度',
    suggestedApproach: '建议方式'
  })
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
  if (arr(dv.strengths).length) rows.push({ label: '优势', value: arr(dv.strengths).slice(0, 5).join('、') })
  if (arr(dv.riskFactors).length) rows.push({ label: '风险因素', value: arr(dv.riskFactors).slice(0, 5).join('、') })
  return rows
})

/** 叙述洞察分区：后端 narrativeInsights 是带语义字段名的对象（此前 Object.values 展平丢键，
 *  五段长文挤一卡无可读层级）。按业务维度归五组打小标、空字段不渲染（2026-10-11 走查采纳外部评审）。
 *  数组形态（旧快照）回退为无标单组平铺 */
const NARRATIVE_GROUPS: { label: string; keys: string[] }[] = [
  { label: '目标与动机', keys: ['goalNarrative', 'motivationNarrative'] },
  { label: '背景与现状', keys: ['backgroundContextNote'] },
  { label: '时间与自述', keys: ['timeConstraintNote', 'selfAssessmentNote'] },
  { label: '学习偏好', keys: ['contentReceptionPattern', 'practicePreferenceNote'] },
  { label: '卡点与教学适配', keys: ['frictionPatternNote', 'effectiveTeachingPattern', 'supportStyleNote', 'taskGranularityNote'] }
]
const narrativeSections = computed<{ label: string; items: string[] }[]>(() => {
  const n = profile.value?.narrativeInsights
  if (!n) return []
  if (Array.isArray(n)) {
    const items = n.map(String).filter((s) => s.trim())
    return items.length ? [{ label: '', items }] : []
  }
  const o = n as Record<string, unknown>
  const val = (k: string) => {
    const v = o[k]
    return v == null ? '' : String(v).trim()
  }
  return NARRATIVE_GROUPS.map((g) => ({ label: g.label, items: g.keys.map(val).filter((s) => s) })).filter((g) => g.items.length)
})

/** 叙述洞察的出处：这一卡取自「最近一次已完成目标对话」，不是跨目标聚合——同一学习者可有
 *  多个互不相干的目标（实测同账号并存「幼师考指南」「AI 教育平台」「和猫沟通」），不标出处
 *  会被读成「该学习者的全部背景」。可见短标 + 长解释收 title（家法：hint 短口径、长释悬停）。 */
const narrativeSource = computed(() => {
  const s = (profile.value?.narrativeSource || null) as { goalTitle?: string; completedAt?: string | null } | null
  return s && s.goalTitle ? s : null
})
const narrativeSourceLabel = computed(() => {
  const at = narrativeSource.value?.completedAt ? new Date(narrativeSource.value.completedAt) : null
  if (!at || Number.isNaN(at.getTime())) return '源自最近一次目标对话'
  return `源自 ${at.getMonth() + 1}-${String(at.getDate()).padStart(2, '0')} 那次目标对话`
})
const narrativeSourceTitle = computed(() => {
  const s = narrativeSource.value
  if (!s) return ''
  const at = s.completedAt ? new Date(s.completedAt) : null
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = at && !Number.isNaN(at.getTime())
    ? `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
    : '完成时间未知'
  return `「${s.goalTitle}」· ${stamp} 完成\n背景与现状等叙述只反映该次目标对话，不是该学习者的全部背景（同一学习者可有多个目标）。`
})

const metricCards = computed(() => {
  const m = (dynamicState.value?.metrics || {}) as Record<string, number>
  const fmt = (v?: number) => (v == null ? '—' : v.toFixed(1))
  /* 后端语义核实（backend/src/services/learning/learning-state.service.ts）：
     LSS=Learning Stress Score 学习压力（0-10，越高越累）、KTL=Knowledge Training Load 训练负荷
     （LSS 的慢 EWMA，高=负荷重）、LF=Learning Fatigue 疲劳（≥6 警戒）；三者均为负荷类——
     高值是坏（红）、低值是好（绿）。LSB=KTL−LF 状态平衡，正=状态好。
     标签/参考带/色调阈值单点取自 learnerMetrics.ts——此前本页两处渲染点
     （metricCards 与 learningStateRows）与 VirtualProfile.lsmRows 各写一套且互相打架。 */
  const card = (key: LearnerMetricKey) => {
    const def = learnerMetric(key)
    const v = m[key]
    const missing = v == null || v === 0
    return {
      label: def.label,
      value: fmt(v),
      band: def.band,
      title: missing ? '暂无数据' : `${def.band}\n${def.bandTitle}`,
      tone: def.toneOf(v)
    }
  }
  return [card('lss'), card('ktl'), card('lf'), card('lsb')]
})

const dynamicRows = computed(() => {
  /* recommendedInteraction 是 {hintTiming, encouragement, challenge} 对象，拆三项展示 */
  const ri = dynamicState.value?.recommendedInteraction
  const riRows: { label: string; value: string }[] = []
  if (ri != null) {
    const o = ri as Record<string, unknown>
    if (typeof o === 'string') {
      riRows.push({ label: '建议互动', value: zh(o) })
    } else {
      if (o.hintTiming != null && o.hintTiming !== '') riRows.push({ label: '提示时机', value: zh(o.hintTiming) })
      if (o.encouragement != null && o.encouragement !== '') riRows.push({ label: '鼓励方式', value: zh(o.encouragement) })
      if (o.challenge != null && o.challenge !== '') riRows.push({ label: '挑战设计', value: zh(o.challenge) })
    }
  }
  return [
    ...kvRows(dynamicState.value, {
      recentTrend: '近期趋势',
      fatigueRisk: '疲劳风险',
      confidenceTrend: '置信趋势',
      recentSessionQuality: '近期会话质量'
    }),
    ...kvRows(dynamicState.value, {
      recommendedPacing: '建议节奏'
    }),
    ...riRows
  ]
})

const controlFlags = computed(() => {
  const c = controlState.value
  if (!c) return [] as { text: string; on: boolean }[]
  return [
    { text: '避免新概念', on: !!c.shouldAvoidNewConcepts },
    { text: '优先巩固', on: !!c.shouldPreferConsolidation },
    { text: '建议休息', on: !!c.shouldOfferBreak }
  ]
})

/** 卡头一行：账本规模（三档信号在「概念信号」组、反复困惑在第三组各有实体，不再复读进卡头）。
    量与概览同口径同词（「N 个概念」）——同一页两处计数单位不再一个「项」一个「个」。 */
const sigHeadMeta = computed<string | null>(() => {
  const gb = (knowledgeMemory.value as Record<string, unknown> | null)?.globalBackground
  if (!gb || typeof gb !== 'object') return null
  const o = gb as Record<string, unknown>
  const ledger = Array.isArray(o.conceptLedger) ? o.conceptLedger.length : 0
  return ledger ? `${ledger} 个概念` : null
})

/** 信号三档原始数组（globalSignals 三组概念名） */
const signalTiers = computed<Record<'mastered' | 'struggling' | 'fragile', string[]>>(() => {
  const gs = (knowledgeMemory.value as Record<string, unknown> | null)?.globalSignals
  const o = (gs && typeof gs === 'object' ? gs : {}) as Record<string, unknown>
  const arr = (k: string): string[] => {
    const v: unknown = o[k]
    return Array.isArray(v) ? v.map(String) : []
  }
  return { mastered: arr('masteredConcepts'), struggling: arr('strugglingConcepts'), fragile: arr('fragileConcepts') }
})

/** 信号三档（学没学会）：已掌握=stable/mastered，脆弱=fragile/待复习，挣扎=learning 且掌握度<55%。
 *  分档依据是 performance 信号，与概览概念条的迁移准备度分档不同维 */
const signalTierRows = computed(() => [
  { key: 'mastered', label: '已掌握', n: signalTiers.value.mastered.length, names: signalTiers.value.mastered },
  { key: 'struggling', label: '挣扎', n: signalTiers.value.struggling.length, names: signalTiers.value.struggling },
  { key: 'fragile', label: '脆弱', n: signalTiers.value.fragile.length, names: signalTiers.value.fragile }
])

/** 反复困惑（在哪跌倒）：对话证据提炼的重复误解，概念+复发次数+模式说明 */
const recurringConfusions = computed<{ label: string; count: number; pattern: string }[]>(() => {
  const gb = (knowledgeMemory.value as Record<string, unknown> | null)?.globalBackground
  if (!gb || typeof gb !== 'object') return []
  const o = gb as Record<string, unknown>
  const rc = o.recurringConfusions
  return Array.isArray(rc)
    ? (rc as Record<string, unknown>[]).map((x) => ({
        label: String(x.label || x.conceptKey || ''),
        count: Number(x.count || 0),
        pattern: String(x.pattern || '')
      }))
    : []
})

const foundations = computed<{ reusable: string[]; blocked: string[] }>(() => {
  const gb = (knowledgeMemory.value as Record<string, unknown> | null)?.globalBackground
  if (!gb || typeof gb !== 'object') return { reusable: [], blocked: [] }
  const o = gb as Record<string, unknown>
  return {
    reusable: Array.isArray(o.reusableFoundations) ? o.reusableFoundations.map(String) : [],
    blocked: Array.isArray(o.blockedFoundations) ? o.blockedFoundations.map(String) : []
  }
})

/** 概览建议行动卡的强调/避免 chips（2026-10-11 走查自画像页签迁入） */
const emphasizeList = computed(() => teachingHints.value?.emphasize || [])
const avoidList = computed(() => teachingHints.value?.avoid || [])

/* ---------- 概念掌握图形化（conceptLedger 单源，旧快照回退三组列表） ---------- */
interface ConceptBar {
  label: string
  tone: ConceptBarTone
  readiness: string
  risk: string
  riskTone: 'ok' | 'warn' | 'bad'
  evidenceCount: number
}

/** 概念台账全量（不再截前 24 条）：概览卡已不铺列表，结论行要按全量报数，
 *  截断会让「共 N 个概念」少报（实测该学习者台账 41 条，截断后只报 24） */
const conceptBars = computed<ConceptBar[]>(() => {
  const km = knowledgeMemory.value as Record<string, unknown> | null
  const ledger = (km?.globalBackground as Record<string, unknown> | undefined)?.conceptLedger
  if (Array.isArray(ledger) && ledger.length) {
    return (ledger as ConceptLedgerItem[]).map((item) => ({
      label: String(item.label || item.conceptKey || '未命名概念'),
      tone: conceptBarTone(item),
      readiness: transferReadinessZh(item.transferReadiness),
      risk: misconceptionRiskZh(item.misconceptionRisk),
      riskTone: (String(item.misconceptionRisk || '').toLowerCase() === 'high' ? 'bad' : String(item.misconceptionRisk || '').toLowerCase() === 'medium' ? 'warn' : 'ok') as ConceptBar['riskTone'],
      evidenceCount: Number(item.evidenceCount || 0)
    }))
  }
  // 旧快照回退：无 ledger 时按 mastered/struggling/fragile 三组构建
  const c = d.value?.concepts
  if (!c) return []
  const fallback: ConceptBar[] = []
  for (const label of c.mastered) fallback.push({ label, tone: 'ok', readiness: '可迁移', risk: '低', riskTone: 'ok', evidenceCount: 0 })
  for (const label of c.fragile) fallback.push({ label, tone: 'warn', readiness: '待巩固', risk: '中', riskTone: 'warn', evidenceCount: 0 })
  for (const label of c.struggling) fallback.push({ label, tone: 'bad', readiness: '不宜迁移', risk: '高', riskTone: 'bad', evidenceCount: 0 })
  return fallback
})

/** 图谱节点详情的概念事实索引（概念名 → 可迁移 / 误解风险 / 证据数）。
 *  台账 conceptKey 就是概念名，图节点 label 也是同一份 canonical 概念名，按 label 对得上；
 *  对不上的节点不渲染这三行（不拿别的概念读数顶上）。 */
const conceptFacts = computed<Record<string, MkGraphConceptFacts>>(() => {
  const out: Record<string, MkGraphConceptFacts> = {}
  for (const c of conceptBars.value) {
    const key = c.label.trim().replace(/\s+/g, ' ')
    if (!key) continue
    out[key] = { readiness: c.readiness, risk: c.risk, riskTone: c.riskTone, evidenceCount: c.evidenceCount }
  }
  return out
})

/** 证据页「概念证据密度」：优先 ledger（evidenceCount），回退 conceptStates（masteryScore 归一化）。
 *  排序：有证据的概念置顶（按条数降序），无证据的沉底折叠，避免 14 行「0 证据」刷屏 */
const conceptStats = computed<{ label: string; count: number; tone: ConceptBarTone; width: number }[]>(() => {
  const km = knowledgeMemory.value as Record<string, unknown> | null
  const ledger = (km?.globalBackground as Record<string, unknown> | undefined)?.conceptLedger
  if (Array.isArray(ledger) && ledger.length) {
    const max = Math.max(1, ...(ledger as ConceptLedgerItem[]).map((i) => Number(i.evidenceCount || 0)))
    return (ledger as ConceptLedgerItem[])
      .map((item) => ({
        label: String(item.label || item.conceptKey || '未命名概念'),
        count: Number(item.evidenceCount || 0),
        tone: conceptBarTone(item),
        width: Number(item.evidenceCount || 0) > 0
          ? Math.max(8, Math.round((Number(item.evidenceCount || 0) / max) * 100))
          : 8
      }))
      .sort((a, b) => (b.count > 0 ? 1 : 0) - (a.count > 0 ? 1 : 0) || b.count - a.count || a.label.localeCompare(b.label, 'zh'))
      .slice(0, 16)
  }
  const states = (km?.currentPath as Record<string, unknown> | undefined)?.conceptStates
  if (Array.isArray(states) && states.length) {
    const max = Math.max(1, ...(states as { masteryScore?: number }[]).map((s) => Number(s.masteryScore || 0) * 100))
    return (states as { label?: string; masteryScore?: number }[])
      .map((s) => ({
        label: String(s.label || '未命名概念'),
        count: Math.round(Number(s.masteryScore || 0) * 100),
        tone: 'muted' as ConceptBarTone,
        width: Math.max(8, Math.round((Number(s.masteryScore || 0) * 100 / max) * 100))
      }))
      .slice(0, 16)
  }
  return []
})

const milestoneTasks = computed<{ done: number; total: number } | null>(() => {
  const km = knowledgeMemory.value as Record<string, unknown> | null
  const p = (km?.currentPath as Record<string, unknown> | undefined)?.progress as Record<string, unknown> | undefined
  const total = Number(p?.totalTasksInMilestone || 0)
  const done = Number(p?.completedTasksInMilestone ?? 0)
  return total > 0 ? { done, total } : null
})

/* ---------- 学习压力记录曲线（learning_metrics 真实指标：LSS/LF/LSB 历史趋势） ---------- */
const loadRange = ref<42 | 90>(42)
/** 压力趋势点（含坐标）：直接来自 learning_metrics 历史，无分钟 EWMA 推导 */
type LoadPoint = {
  date: string
  label: string
  lss: number | null
  lf: number | null
  lsb: number | null
}
const loadSeries = computed<LoadPoint[]>(() => {
  const days = loadRange.value
  const fmtKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const map = new Map(loadCurveRaw.value.map((p) => [p.date, p]))
  const hasVal = (p?: { lss: number | null; lf: number | null; lsb: number | null }) =>
    !!p && (p.lss != null || p.lf != null || p.lsb != null)
  if (!loadCurveRaw.value.some(hasVal)) return []
  /* B 案固定跨度（2026-10-13 用户拍板「42/90 切了没作用」）：x 轴宽度**恒等于所选档位**，
     开关真正控制跨度、永远可见地变宽变窄（不再自动贴合数据——那会让两档在数据不足 42 天时一模一样）。
     代价：学习史不足档位时，左侧留空（原 10-12「别拉满」的观感取舍，用户已知并选择）。
     右端锚点 = max(真实今天, 曲线里最新有值日)：跨日模拟下 learning_metrics 的业务日期
     （calculatedAt）可落在真实今天之后，锚在真实今天会把模拟日整条丢出窗口；真实用户不受影响。 */
  let endKey = fmtKey(new Date())
  for (const p of loadCurveRaw.value) {
    if (hasVal(p) && p.date > endKey) endKey = p.date
  }
  const end = new Date(endKey + 'T00:00:00')
  const out: Omit<LoadPoint, 'x' | 'ylss' | 'ylf' | 'ylsb'>[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setDate(d.getDate() - i)
    const key = fmtKey(d)
    const p = map.get(key)
    out.push({
      date: key,
      label: `${d.getMonth() + 1}月${d.getDate()}日`,
      lss: p?.lss ?? null,
      lf: p?.lf ?? null,
      lsb: p?.lsb ?? null
    })
  }
  return out as LoadPoint[]
})
const hasLoad = computed(() => loadSeries.value.some((p) => p.lss != null || p.lf != null || p.lsb != null))

/* ECharts option：LSS/LF/LSB 统一 0-10 轴（LF 偶发略超 10，上界放宽到 12 防贴顶裁切）；
   下界随数据自适应——LSB=KTL−LF 理论可到 −10，固定 -4 会截断曲线（无负值时仍取 -4 留白）；
   参考线：LSB=0（状态平衡线）与 LF=6（疲劳警戒线）；tooltip 跟随 + 平滑曲线 + 坐标轴刻度 */
const loadChartOption = computed<EChartsCoreOption>(() => {
  const pal = MK_CHART_PALETTES[isDark.value ? 'dark' : 'light'];
  const labels = loadSeries.value.map((p) => p.label)
  const lss = loadSeries.value.map((p) => p.lss)
  const lf = loadSeries.value.map((p) => p.lf)
  const lsb = loadSeries.value.map((p) => p.lsb)
  return {
    animationDuration: 400,
    grid: { left: 34, right: 16, top: 18, bottom: 26 },
    tooltip: {
      trigger: 'axis',
      confine: true,
      valueFormatter: (v: unknown) => (v == null ? '—' : Number(v).toFixed(1)),
    },
    legend: { show: false },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisTick: { show: false },
      axisLabel: { fontSize: 11, interval: Math.max(0, Math.floor(labels.length / 8)) },
    },
    yAxis: {
      type: 'value',
      // min 用回调：数据里出现 < -4 的 LSB（如 KTL=0、LF=10 → −10）时下界跟着走，避免截断
      min: (e: { min: number }) => Math.min(-4, e.min),
      // max 同样用回调：接口的 loadCurve 是 0-100 刻度（lss/ktl/lf/lsb），此前写死 12 会把
      // LSS/LF 两条线整段裁到网格外、只剩一个点。下界保底 12 只服务「全 0」的极端数据。
      max: (e: { max: number }) => Math.max(12, Math.ceil(e.max ?? 0)),
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        name: 'LSS 压力',
        type: 'line',
        data: lss,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        connectNulls: false,
        lineStyle: { width: 2, color: pal.primary },
        itemStyle: { color: pal.primary },
      },
      {
        name: 'LF 疲劳',
        type: 'line',
        data: lf,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        connectNulls: false,
        lineStyle: { width: 2, color: pal.danger },
        itemStyle: { color: pal.danger },
      },
      {
        name: 'LSB 状态',
        type: 'line',
        data: lsb,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        connectNulls: false,
        lineStyle: { width: 2, color: pal.success },
        itemStyle: { color: pal.success },
      },
      /* 参考线：LSB=0 平衡线（灰虚）与 LF=6 疲劳警戒线（红虚） */
      {
        name: '平衡线',
        type: 'line',
        data: Array(labels.length).fill(0),
        silent: true,
        symbol: 'none',
        lineStyle: { type: 'dashed', width: 1, color: 'rgba(23,32,51,0.18)' },
        tooltip: { show: false },
      },
      {
        name: '疲劳警戒',
        type: 'line',
        // 与图例同刻度：loadCurve 是 0-100，警戒线 = 60（原 6 属 0-10 口径的残留）
        data: Array(labels.length).fill(60),
        silent: true,
        symbol: 'none',
        lineStyle: { type: 'dashed', width: 1, color: 'rgba(220,38,38,0.35)' },
        tooltip: { show: false },
      },
    ],
  }
})

const loadDisplayDay = computed(() => loadSeries.value[loadSeries.value.length - 1] ?? null)
const loadFmt = (v: number | null) => (v == null ? '—' : v.toFixed(1))
/** 压力语义：LF 高 = 疲劳高；LSB = KTL-LF，负 = 状态不佳 */
function loadZoneOf(p: LoadPoint): 'fresh' | 'optimal' | 'risk' {
  if (p.lsb == null) return p.lf != null && p.lf >= 6 ? 'risk' : 'optimal'
  if (p.lsb >= 0) return 'fresh'
  if (p.lsb >= -3) return 'optimal'
  return 'risk'
}
const loadZoneCls = (z: 'fresh' | 'optimal' | 'risk') => (z === 'fresh' ? '--fresh' : z === 'optimal' ? '--optimal' : '--risk')

/* ---------- 预测校准（实证命中率） ---------- */
/** 预测校准结论（卡头结论常驻，就地派生；无样本时保持说明文案） */
const calibConclusion = computed(() => {
  const s = predictionCalib.value?.stats
  if (!s || !(s.total > 0)) return CALIB_META_TITLE
  const pct = (r: number | null | undefined) => (r != null ? `${Math.round(r * 100)}%` : '—')
  return `卡壳 ${pct(s.stallHitRate)} · 基调 ${pct(s.toneHitRate)} · n=${s.total}`
})

function calHitCls(rate: number | null | undefined): string {
  if (rate == null) return ''
  return rate >= 0.7 ? 'is-good' : rate >= 0.5 ? 'is-mid' : 'is-bad'
}
function calBarWidth(b: { n: number; hardRate: number | null }): string {
  if (!b.n || b.hardRate == null) return '4%'
  return `${Math.max(4, Math.round(b.hardRate * 100))}%`
}
function calOutcomeZh(outcome: string | null | undefined): string {
  if (!outcome) return '待回写'
  return { smooth: '顺畅', struggled: '挣扎', failed: '未完成' }[outcome] || outcome
}
function calOutcomeCls(outcome: string | null | undefined): string {
  if (!outcome) return 'is-pending'
  return outcome === 'smooth' ? 'is-smooth' : 'is-hard'
}

const riskFactors = computed(() => (teachingHints.value?.riskFactors || []) as string[])

/* ---------- 概览：学习状态追踪（lsm，原型 renderLearnerDetail 2189 / 样式 517-522） ----------
   与证据 tab 指标卡同源（dynamicState.metrics）；原型 lsm 的 ktl/320、lf/220 是原型自造量纲，
   后端 KTL/LF 与 LSS 同为 0-10（learning-state.service.ts）——故宽度按真实 0-10 归一，
   tone 对齐本页 metricCards 的负荷语义（高=坏）。 */
const learningStateRows = computed(() => {
  const m = (dynamicState.value?.metrics || {}) as Record<string, number>
  const width = (v: number | undefined) => (v == null || v === 0 ? 0 : Math.min(100, Math.round((v / 10) * 100)))
  const row = (key: LearnerMetricKey) => {
    const def = learnerMetric(key)
    const v = m[key]
    const t = def.toneOf(v)
    return {
      label: def.label,
      value: v ? (key === 'lsb' ? `${v > 0 ? '+' : ''}${v.toFixed(1)}` : v.toFixed(1)) : '—',
      width: key === 'lsb' ? (v ? Math.min(100, Math.round(Math.abs(v) * 8 + 10)) : 0) : width(v),
      // 共享口径的 '' = 缺值/中性 → 本页条形用 'muted'（本页只有 ok/bad 上色档）
      tone: (t === '' ? 'muted' : t) as 'ok' | 'warn' | 'bad' | 'muted',
      hint: def.band,
      hintTitle: def.bandTitle
    }
  }
  return [row('lss'), row('ktl'), row('lf'), row('lsb')]
})

/* ---------- 学习路径 pane：路径卡（原型 2165-2171） ---------- */
const pathStatus = computed<{ text: string; tone: 'ok' | 'info' | 'muted' }>(() => {
  const p = pathInfo.value
  if (!p) return { text: '未开始', tone: 'muted' }
  if (p.pct >= 100) return { text: '已完成', tone: 'ok' }
  if (p.pct > 0) return { text: '进行中', tone: 'info' }
  return { text: '未开始', tone: 'muted' }
})

/* ---------- 记忆与复习 pane（原型 2178-2183）：复用画像 tab 的 FSRS 单源 memoryTraces ----------
   状态/色调由 retrievability + dueAt 派生（原型 weak/due/stable/learning 四态）；
   「来源」列：后端无出处字段，用 extractionCount/lastSeenAt 近似标注（口径见 title）。 */
/* FSRS 到期三态：timeAgo 对未来时间返回「刚刚」，会把未到期复习项全部渲染成「到期：刚刚」——
   到期语义必须是 逾期/今天/N 天后；绝对时刻走 title。 */
function dueText(dueAt: string): string {
  const diffMs = new Date(dueAt).getTime() - Date.now()
  if (!Number.isFinite(diffMs)) return '—'
  const days = Math.floor(Math.abs(diffMs) / 86400000)
  if (diffMs <= 0) return days >= 1 ? `已逾期 ${days} 天` : '今天到期'
  return days >= 1 ? `${days} 天后` : '今天到期'
}

/* ---------- 记忆与复习 pane（2026-10-11 深设计）----------
   两处口径修正：
   ① 状态判定保持后端语义（逾期=待复习 / 无痕迹=未初始化 / <50 薄弱 / <80 学习中 / ≥80 稳固），
      但「记忆强度」条的语气改按**数值档**上色（<40 红 / <80 琥珀 / ≥80 绿），不再跟着状态走——
      3% 且逾期原先是琥珀，读数本身该是红的；
   ② 排序显式化：待复习（逾期最久在前）→ 有痕迹未到期（按到期升序）→ 未初始化压尾。
      此前直接透传接口顺序，口径不可读。 */
/** FSRS 普查表行（供客户端排序取数；其余字段与模板同源） */
interface MemoryRow {
  key: string
  label: string
  strength: number | null
  barTone: 'ok' | 'warn' | 'bad' | undefined
  strengthTitle: string
  tone: 'ok' | 'warn' | 'bad' | 'info'
  stateText: string
  stateKey: string
  uninit: boolean
  overdue: boolean
  due: string
  dueAbs: string
  dueTs: number | null
  extract: string
  extractCount: number
  seenAbs: string
}
const memoryPaneRows = computed<MemoryRow[]>(() =>
  memoryTraces.value.map((t) => {
    const strength = t.retrievability != null ? Math.round(t.retrievability * 100) : null
    const overdue = !!t.dueAt && new Date(t.dueAt).getTime() <= Date.now()
    let state: { text: string; tone: 'ok' | 'warn' | 'bad' | 'info' }
    if (overdue) state = { text: '待复习', tone: 'warn' }
    else if (strength == null) state = { text: '未初始化', tone: 'info' }
    else if (strength < 50) state = { text: '薄弱', tone: 'bad' }
    else if (strength < 80) state = { text: '学习中', tone: 'info' }
    else state = { text: '稳固', tone: 'ok' }
    const barTone: 'ok' | 'warn' | 'bad' | undefined =
      strength == null ? undefined : strength < 40 ? 'bad' : strength < 80 ? 'warn' : 'ok'
    /* 强度格 title 带出 FSRS 内部量（后端 stability/difficulty 一直有值但从未消费）：
       可提取率是「现在能想起来多大概率」，稳定性/难度是模型内部参数，解释间隔为何这么排 */
    const fsrsBits: string[] = []
    if (strength != null) fsrsBits.push(`可提取率 ${strength}%`)
    if (t.fsrsStability != null) fsrsBits.push(`稳定性 ${t.fsrsStability} 天`)
    if (t.fsrsDifficulty != null) fsrsBits.push(`难度 ${t.fsrsDifficulty}`)
    const strengthTitle = fsrsBits.length
      ? `记忆强度（可提取率）：${fsrsBits.join(' · ')}`
      : '系统尚未算出该知识点的记忆强度'
    const extract = t.extractionCount > 0
      ? `${t.extractionCount} 次${t.lastSeenAt ? ` · 最近 ${timeAgo(t.lastSeenAt)}` : ''}`
      : t.lastSeenAt
        ? `最近 ${timeAgo(t.lastSeenAt)}`
        : '—'
    const stateKey = overdue ? 'due' : strength == null ? 'uninit' : strength < 50 ? 'weak' : strength < 80 ? 'learning' : 'ok'
    return {
      key: t.conceptKey,
      label: t.label || t.conceptKey,
      strength,
      barTone,
      strengthTitle,
      tone: state.tone,
      stateText: state.text,
      stateKey,
      /** 仅「未初始化」压暗（无任何痕迹）；待复习行可能同样没有强度读数，但恰恰最该被看见 */
      uninit: stateKey === 'uninit',
      overdue,
      due: t.dueAt ? dueText(t.dueAt) : '—',
      dueAbs: t.dueAt ? new Date(t.dueAt).toLocaleString() : '',
      dueTs: t.dueAt ? new Date(t.dueAt).getTime() : null,
      extract,
      extractCount: t.extractionCount,
      seenAbs: t.lastSeenAt ? new Date(t.lastSeenAt).toLocaleString() : ''
    }
  })
)
/** 排序档位：待复习 0 / 有痕迹未到期 1 / 未初始化 2；同档按到期升序（无到期压尾） */
const memoryRank = (r: { stateKey: string }) => (r.stateKey === 'due' ? 0 : r.stateKey === 'uninit' ? 2 : 1)
const memorySortedRows = computed(() =>
  [...memoryPaneRows.value].sort((a, b) => {
    const d = memoryRank(a) - memoryRank(b)
    if (d) return d
    if (a.dueTs == null && b.dueTs == null) return a.label.localeCompare(b.label, 'zh-Hans-CN')
    if (a.dueTs == null) return 1
    if (b.dueTs == null) return -1
    return a.dueTs - b.dueTs
  })
)
/* 视角：分档计数从行派生；只有出现的档位才给 chips（+ 全部） */
const memView = ref<'all' | 'due' | 'ok' | 'weak' | 'learning' | 'uninit'>('all')
const MEM_STATE_ORDER: Array<{ key: Exclude<typeof memView.value, 'all'>; label: string; title: string }> = [
  { key: 'due', label: '待复习', title: '已到复习期（含此前提取过、还没算出记忆强度的点）' },
  { key: 'ok', label: '稳固', title: '可提取率 ≥ 80% 且未到复习期' },
  { key: 'learning', label: '学习中', title: '可提取率 50-79%，仍在形成期' },
  { key: 'weak', label: '薄弱', title: '可提取率 < 50%，临近遗忘' },
  { key: 'uninit', label: '未初始化', title: '尚无记忆记录（未产生提取记录）' }
]
const memViews = computed(() => {
  const counts = new Map<string, number>()
  for (const r of memoryPaneRows.value) counts.set(r.stateKey, (counts.get(r.stateKey) || 0) + 1)
  return [
    { key: 'all' as const, label: '全部', count: memoryPaneRows.value.length, title: '全部有记忆痕迹的知识点' },
    ...MEM_STATE_ORDER.filter((s) => (counts.get(s.key) || 0) > 0).map((s) => ({ ...s, count: counts.get(s.key) as number }))
  ]
})
/* FSRS 普查表排序（2026-10-18 用户走查「这张表也缺排序」）：行集是该学习者的全量痕迹，
   客户端排序诚实且最便宜（useTableSort 适用范围：数据完整的列表）。
   默认不选键 = 保留原有口径序（待复习 → 未到期 → 未初始化）。
   状态档位与上方「视角」pills 同序（MEM_STATE_ORDER：待复习 → 稳固 → 学习中 → 薄弱 →
   未初始化）：同一屏上同一根轴只有一种顺序——pills 按强弱梯子读，列头排序却按需关注度
   排，用户点完列头会以为点错了。 */
const MEM_STATE_RANK: Record<string, number> = { due: 0, ok: 1, learning: 2, weak: 3, uninit: 4 }
const {
  toggle: toggleMemSort,
  sortState: memSortState,
  sortRows: sortMemRows
} = useTableSort<MemoryRow>({
  accessors: {
    concept: (r) => r.label,
    strength: (r) => r.strength,
    due: (r) => r.dueTs,
    extract: (r) => r.extractCount,
    state: (r) => MEM_STATE_RANK[r.stateKey] ?? 9
  },
  defaultDir: 'asc',
  // 提取史首击降序（复现最多的先看）；其余列首击升序（最该关注的在前）
  defaultDirOf: { extract: 'desc' }
})
const memoryRowsFiltered = computed(() => {
  const base = memView.value === 'all' ? memorySortedRows.value : memorySortedRows.value.filter((r) => r.stateKey === memView.value)
  return sortMemRows([...base])
})
/** 卡头不再报状态分档（2026-10-23 走查：同一组计数已由工具栏 pills 承担，卡头复读一遍）；
    只留作用域标注——它不是页级开关的复读：记忆块按用户级、跨全部路径，与页内「路径范围」
    无关，读错会漏掉在另一条路径学过的概念。 */
const memMetaText = computed(() => allPathsScope.value.label)

const trendText = computed(() => (d.value?.trend === 'up' ? '↗ 上升' : d.value?.trend === 'down' ? '↘ 下降' : '→ 稳定'))
const trendBadge = computed(() => (d.value?.trend === 'up' ? 'mk-badge--ok' : d.value?.trend === 'down' ? 'mk-badge--bad' : 'mk-badge--muted'))
const fatigueBadge = computed(() => (d.value?.fatigue === '高' ? 'mk-badge--bad' : d.value?.fatigue === '中' ? 'mk-badge--warn' : 'mk-badge--ok'))
/** 低置信不渲染成风险色：中性→琥珀「证据不足」提示（与 LearnerCenter 同阈值，见 evidence.ts） */
/* 快照徽章单源（走查 F1-4）：详情响应自带的 freshness 优先（authoritative），
   缺失时退回列表行——列表晚到（深链竞态）时本 computed 随 liveLearners 响应自动重算，
   不再卡死在加载瞬间渲染的「— · 从未」。 */
const snapshotFresh = computed(() => {
  const raw = rawDetail.value
  const model = (raw?.model ?? null) as Record<string, unknown> | null
  const fr = (raw?.freshness ?? model?.freshness ?? null) as { generatedAt?: unknown; confidence?: unknown } | null
  if (fr && (fr.generatedAt || fr.confidence != null)) {
    const conf = fr.confidence == null ? null : Number(fr.confidence)
    return {
      version: conf == null ? '置信未知' : `置信 ${(conf * 100).toFixed(0)}%${evidenceLowConfidence(conf) ? ' · 证据不足' : ''}`,
      generatedAt: fr.generatedAt ? timeAgo(String(fr.generatedAt)) : '从未'
    }
  }
  const id = subPage.value?.id || ''
  const base = id ? liveLearners.value.find((l) => l.userId === id) : undefined
  if (base) {
    return {
      version: base.confidence == null ? '置信未知' : `置信 ${(base.confidence * 100).toFixed(0)}%${evidenceLowConfidence(base.confidence) ? ' · 证据不足' : ''}`,
      generatedAt: timeAgo(base.generatedAt)
    }
  }
  return null
})
const snapshotLabel = computed(() => {
  const f = snapshotFresh.value
  return f ? `${f.version} · ${f.generatedAt}` : `${d.value?.snapshot.version ?? '—'} · ${d.value?.snapshot.generatedAt ?? '从未'}`
})

/** 快照生成时刻（原始 ISO，与 snapshotFresh 同源）：供四读数出处标注（loadCaliber）用 */
const snapshotGeneratedAtIso = computed<string | null>(() => {
  const raw = rawDetail.value
  const model = (raw?.model ?? null) as Record<string, unknown> | null
  const fr = (raw?.freshness ?? model?.freshness ?? null) as { generatedAt?: unknown } | null
  if (fr?.generatedAt) return String(fr.generatedAt)
  const id = subPage.value?.id || ''
  const base = id ? liveLearners.value.find((l) => l.userId === id) : undefined
  return base?.generatedAt ?? null
})

/** 四读数出处（全部路径汇总快照）：与「虚拟学习者档案」页的单次会话快照不同源，数值本就不相等 */
const loadCaliberNote = computed(() => loadCaliber('aggregate', snapshotGeneratedAtIso.value))

/** 虚拟账号互跳：同一实体两个 ID（users.id ↔ virtual_learner_profiles.id）。从 boot 已载入的
 *  全量虚拟档案里按 userId 反查；真人账号无档案 → 不出入口（此前两页互不相通，要知道对方存在
 *  得自己记住两条 URL）。 */
const linkedVirtualProfile = computed(() => {
  const uid = subPage.value?.id
  if (!uid) return null
  return liveVirtuals.value.find((v) => String(v.raw?.userId || '') === uid) || null
})
function openVirtualProfile() {
  const p = linkedVirtualProfile.value
  const uid = subPage.value?.id
  if (!p || !uid) return
  openSubPage('virtual', p.id, { from: { view: 'learner', id: uid, label: d.value?.name } })
}
const snapshotBadge = computed(() =>
  snapshotLabel.value.includes('证据不足') ? 'mk-badge--warn' : 'mk-badge--muted'
)
const snapshotHint = computed(() =>
  snapshotLabel.value.includes('证据不足') ? '该档案置信度低于 50%，证据不足，建议重算' : '档案置信度'
)

</script>

<style scoped>
.ld { gap: 16px; }
/* 整页骨架（审核 #25）：段间距与真实 hero/statstrip/页签内容一致，避免加载完跳一次 */
.ld-skel { display: grid; gap: 16px; }

/* 状态条已在 2026-10-05（批次五 CM2）收敛为共享 MkStatStrip 的 grid 变体：
   原本地 .statstrip 复刻（18px 数值档/两行换行）整块退役，样式归组件。 */

/* 页头身份区走 .mk-entity（shared.css） */

.ld-tabpage { display: grid; gap: 14px; align-content: start; }
.ld-none { margin: 0; padding: 18px 16px; color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.ld-none__hint { display: block; margin-top: 4px; font-size: var(--mk-fs-micro); opacity: 0.9; }
/* 最近会话行已统一为全局原语 MkRowList/MkRow（components/mk），本页不再私有行样式 */

/* 主区双栏（左 2fr 主内容 · 右 1fr 侧栏） */
.ld-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.ld-col { display: grid; gap: 14px; align-content: start; }
/* 画像 tab 栅格（2026-10-11 走查再设计）：上排三张参数卡三列收成等高水平带，
   叙述洞察 .ld-pf-narr 通栏独占一行——长文本不再把同行参数卡拉出半屏空洞。
   不设 align-items:start——同行卡拉伸等高，矮卡不留洞 */
.ld-pf-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.ld-pf-narr { grid-column: 1 / -1; }
/* 合并卡内双子组（2026-10-11 走查：六散卡并三卡后的卡内左右分栏）。
   再设计（用户走查「认知特征」子标题）：子组标题升为分区头——细线衬底与卡头同语法，
   字色回前景（此前 0.72 透明度与字段标签混同层）；两子组间加竖分隔线；
   kv 在子组内去自带内边距（左缘与分区头对齐）并放开标签列宽（max-content），
   「平均会话时长（分）」这类带单位标签不再折行 */
.ld-pf-sub { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 0; align-content: start; padding: 12px 16px 14px; }
.ld-pf-sub > div + div { border-left: 1px solid var(--mk-line); padding-left: 18px; }
/* 1080~2K 三列档：参数卡约 535px 放不下卡内双子栏——纵向堆叠并撤销竖分隔线；
   ≥2000px 宽卡恢复双子栏（见 4K 媒体块） */
.ld-pf-grid .ld-pf-sub { grid-template-columns: 1fr; gap: 12px; }
.ld-pf-grid .ld-pf-sub > div + div { border-left: 0; padding-left: 0; }
.ld-pf-sub__h {
  margin: 0 0 9px;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--mk-line);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--mk-ink);
  opacity: 0.88;
}
.ld-pf-sub .ld-kv { padding: 0; --kv-label: max-content; }

.ld-progress { padding: 16px; display: grid; gap: 8px; }
.ld-progress strong { font-size: var(--mk-fs-emphasis); }

/* 进度条统一走 .mk-minibar（shared.css）；本类只保留外边距 */
.ld-progress__bar { margin: 4px 0; }
.ld-progress__task { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); }

.ld-concept-label { font-size: var(--mk-fs-micro); font-weight: 700; letter-spacing: 0.04em; }
.ld-concept-label--ok { color: var(--mk-green); }
.ld-concept-label--bad { color: var(--mk-red); }
.ld-concept-list { display: flex; gap: 6px; flex-wrap: wrap; }
/* 概念徽章（原型 .pill--ok/--bad 词汇）。2026-10-11 外部评审降噪：高饱和实底 →
   低透明底 + 彩边彩字，多枚并排时不再抢视觉焦点 */
.ld-concept {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: var(--mk-fs-micro);
  font-weight: 500;
}
.ld-concept--ok {
  background: color-mix(in srgb, var(--mk-green) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--mk-green) 26%, transparent);
  color: var(--mk-green);
}
.ld-concept--bad {
  background: color-mix(in srgb, var(--mk-red) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--mk-red) 26%, transparent);
  color: var(--mk-red);
}

/* 概念掌握条（conceptLedger 图形化） */
.ld-bars { padding: 14px 16px 16px; display: grid; gap: 12px; }
/* 概念掌握卡的图谱入口：与结论行共用 14px 左缘；卡内最后一个元素由它补底边距 */
.ld-concepts__more { margin: 0 14px 12px; }
.ld-bars--dense { padding-top: 12px; }
.ld-bar { display: grid; gap: 5px; }
/* 无证据概念：折叠态——半透明 + 更紧凑，降低「14 行 0 证据」的刷屏感；悬停恢复不透明度便于阅读 */
.ld-bar--empty { opacity: 0.6; gap: 3px; margin-top: -5px; }
.ld-bar--empty:hover { opacity: 1; }
.ld-bar__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
.ld-bar__head strong { font-size: var(--mk-fs-micro); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: help; }
.ld-bar__badges { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
.ld-bar__ev {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-muted);
  background: var(--mk-surface-2);
  border-radius: 6px;
  padding: 1px 6px;
  cursor: help;
  /* 计数列纵向对齐：min-width 固定胶囊宽 + tabular 数字（2026-10-11 走查采纳外部评审） */
  min-width: 46px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.ld-bar__ev--zero { background: var(--mk-surface-2); color: var(--mk-faint); }
/* 分布条统一走 .mk-minibar + data-tone（原为 4 套渐变，属 §4 点名的违规）；
   muted 档原语没有，保留本页一个色调类 */
.ld-bar__fill--muted { background: var(--mk-faint); }
/* 密度条在本卡是主视觉，6px 原语高度升到 8px（2026-10-11 外部评审：过细难读） */
.ld-bar__track { height: 8px; }

/* （.ld-trend* 柱图样式已随「7 天活跃趋势」假卡移除） */
/* 最近动态行（原型 .feedrow 词汇：行间 1px line 分隔 + mono 时间列） */
.ld-sessions { display: grid; }
.ld-session {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 16px;
  border-bottom: 1px solid var(--mk-line);
}
.ld-session:last-child { border-bottom: none; }
.ld-session__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
/* 连续同事件折叠计数（2026-10-11 走查）：弱化小字缀在类型名后 */
.ld-session__x { margin-left: 6px; font-size: var(--mk-fs-micro); font-weight: 400; color: var(--mk-muted); }
.ld-session__dot.is-ok { background: var(--mk-green); }
.ld-session__dot.is-warn { background: var(--mk-amber); }
.ld-session__dot.is-bad { background: var(--mk-red); }
.ld-session__dot.is-muted { background: var(--mk-muted); }
.ld-session__main { flex: 1; display: grid; min-width: 0; }
.ld-session__main strong { font-size: var(--mk-fs-micro); font-weight: 600; }
.ld-session__main span { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.ld-session__time { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); color: var(--mk-faint); white-space: nowrap; }

/* 建议行动卡 */
.ld-actions { padding: 14px 16px; display: grid; gap: 9px; }
.ld-actions p { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.7; }
.ld-actions__k {
  display: inline-block;
  margin-right: 8px;
  padding: 1px 7px;
  border-radius: 6px;
  background: var(--mk-blue-bg);
  color: var(--mk-blue);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
}
.ld-actions__k--warn { background: var(--mk-amber-bg); color: var(--mk-amber); }
/* 「个性化要求」逐句拆行：句块独立成行，行间微间距（2026-10-11 走查） */
.ld-actions__body { display: block; }
.ld-actions__line { display: block; }
.ld-actions .mk-status__action { justify-self: start; }
/* 控制信号行（只列命中项）+ 强调/避免 chips（2026-10-11 自画像页签迁入） */
.ld-actions__ctrl { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.ld-actions__lists { display: grid; gap: 9px; }
.ld-actions__lists > div { display: grid; gap: 6px; justify-items: start; }

/* 概念 chip（会话/证据行内；原型 .chip 词汇：胶囊描边、surface 底、muted 字） */
.ld-chips { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
.ld-chip {
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-muted);
  background: var(--mk-surface);
  border: 1px solid var(--mk-line);
  border-radius: 999px;
  padding: 0 8px;
}

/* Tab 通用 */
/* 键值对排版（原型 dl.kv：96px 标签列网格、行间不画线、标签 12px muted、值 body 常规字重）；
   __row 以 display:contents 透传，保持模板结构而网格行为与原型 kv 一致 */
.ld-kv {
  --kv-label: 96px;
  display: grid;
  grid-template-columns: var(--kv-label) minmax(0, 1fr);
  gap: 8px 14px;
  align-items: baseline;
  padding: 14px 16px;
}
.ld-kv__row { display: contents; }
.ld-kv__row span { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.ld-kv__row strong { font-weight: 400; font-size: var(--mk-fs-body); white-space: pre-wrap; overflow-wrap: anywhere; }

/* 记忆强度（原型 meterrow：meter 条 + mono %，沿用 .mk-minibar 原语） */
.ld-mt { display: inline-flex; align-items: center; gap: 8px; }
.ld-mt__bar { width: 72px; flex: none; }
.ld-mt em { font-style: normal; font-size: var(--mk-fs-micro); color: var(--mk-muted); font-variant-numeric: tabular-nums; }
/* FSRS 表：未初始化行整行降噪（状态列徽章已说明原因）；逾期到期日琥珀色呼应「待复习」pill */
.ld-memrow--uninit > td { opacity: 0.55; }
.ld-due--overdue { color: var(--mk-amber); font-weight: 600; }

/* 学习状态追踪（lsm，原型 517-522）：label / track / val / hint 四列 */
.ld-lsm { padding: 14px 16px; display: grid; gap: 12px; }
/* 参考带列 72 → 128px（2026-10-19 文案优化）：72px 时「0–10 · 参考 4–7」「慢 EWMA · 参考 ≤ 7」
   全部折成两行，四行读数的高度不齐、参考带被拆开读；128px 下最长的带也单行放得下，
   柱条仍占满剩余宽度（1600 / 1280 实测均不挤、无横向溢出） */
.ld-lsm__row { display: grid; grid-template-columns: 92px minmax(0, 1fr) auto 128px; align-items: center; gap: 10px; }
.ld-lsm__label { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.ld-lsm__track { min-width: 80px; }
.ld-lsm__val { font-size: var(--mk-fs-micro); font-weight: 700; font-variant-numeric: tabular-nums; }
.ld-lsm__hint { font-size: var(--mk-fs-micro); color: var(--mk-faint); text-align: right; }

/* 学习路径卡栅格样式已随「学习路径」页签撤销（审核 #22，2026-10-06）：
   里程碑分母 / 路径状态徽章并入概览「当前进度」卡，下钻入口沿用卡头「查看路径结构 →」。 */

/* 表格 pane（教学会话 / 记忆与复习）：行可点击 + 等宽列 */
.ld-pane-row { cursor: pointer; }
/* 表头筛选工具栏（会话页签的视角/阶段、记忆页签的复习状态共用一套形态）：
   两组 chips 同排、以竖分隔线分域；默认档（有效 / 全部）把噪声挡在默认视野外。
   下内边距不可省：实测 0 间距时胶囊底边与表头上边线贴合（用户走查「和下面重叠了」），
   给 12px 与区块节奏一致 */
.ld-filtbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding: 12px 16px; }
/* 路径范围（页级作用域开关）：夹在 hero 与页签栏之间的一行，形态沿用筛选条方言
   （mk-filter__select + 竖分隔 + 灰字 hint），不新造控件样式 */
.ld-scope { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin: 4px 0 10px; }
.ld-scope__label { font-size: 12px; color: var(--mk-faint); }
/* 路径名 +「（学习中）· 当前」经常超过 340px；原生 select 不会自动省略，
   340 封顶会把末字和箭头一起切掉（Windows 显示缩放不改变 CSS 布局，不是成因）。
   放宽到 480 并允许窄屏回落整行。
   纵向：共享档 height:32 + 上下 7px 内衬后内容区只剩 16px，而行高 1.4≈20px，
   中文字形底部会被切；本控件压缩上下内衬并收紧行高，保持 32px 外观高度。 */
.ld-scope__select {
  max-width: min(480px, 100%);
  padding-top: 4px;
  padding-bottom: 4px;
  line-height: 1.2;
}
/* 表格不做全出血：末行底边此前贴死卡底（实测仅剩 1px 边框），补 12px 收尾（同卡头下节奏） */
#ld-panel-sessions .mk-table-scroll,
#ld-panel-memory .mk-table-scroll { padding-bottom: 12px; }
.ld-filtbar__grp { display: flex; flex-wrap: wrap; gap: 6px; }
.ld-filtbar__grp + .ld-filtbar__grp { padding-left: 14px; border-left: 1px solid var(--mk-line); }
/* 会话身份真按钮（审核 #20 键盘可达）：mk-cell-main strong 的截断对 inline-block 按钮不生效，
   故按钮自带 block + 省略号，hover 用链接蓝（同 mk-link 语义，但不吃全局下划线） */
.ld-topic-btn {
  display: block;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.ld-topic-btn:hover { color: var(--mk-blue); }
/* 互动列：时长主值 + 副行（回合 · 知识点）——档位与平台页同阈值（<60s 秒退弱化 / ≥1500s 长时琥珀） */
.ld-ia { display: grid; gap: 1px; min-width: 0; }
.ld-ia__dur { font-size: var(--mk-fs-micro); font-weight: 600; font-variant-numeric: tabular-nums; }
.ld-ia__dur--long { color: var(--mk-amber); }
/* 进度列：任务 x/y + minibar（口径与平台页共享 statusText.sessionProgress*） */
.ld-prog { display: inline-flex; align-items: center; gap: 6px; }
.ld-prog__num { font-size: var(--mk-fs-micro); white-space: nowrap; }
.ld-prog__bar { width: 56px; }
/* 产物列的建议徽章：截断必须落在**内层 span**（平台页 .ts-adv-badge__txt 同法）——
   加在徽章本体上时 overflow 会先吃掉圆角内边距，长标题还会把末字竖切（用户走查
   「pill 字体尾部被压缩」）；内层截断则只会出干净省略号，徽章 padding 始终完整。
   横向内边距抬到 10px（compact 档 .mk-badge 默认 7）：CJK 字形墨迹左右各外扩 1px（侧边距），
   10 字标题会占满胶囊约 88% 宽度，实测末字墨迹离帽仅 6px → 观感「尾巴贴帽」。
   选择器带 #ld-panel-sessions 前缀：compact 密度规则 `html[data-density] .mk-badge`(0,2,1)
   比 scoped 类选择器(0,2,0) 高，不加 id 抬不动 */
#ld-panel-sessions .ld-adv { margin-left: 4px; max-width: 168px; padding-inline: 10px; }
.ld-adv__txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ld-mono { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); }
.ld-sub { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.ld-strong { font-weight: 600; }

/* 操作记录 feed（原型 .feed/.feedrow 297-304：62px mono 时间列 + 动作/详情） */

/* 学习压力曲线卡头部当前读数行（2026-10-11 自页宽 KPI 横排合流）：四格 mini hit，
   语气色沿用 is-good/is-bad（与预测校准 hit 同词汇），口径进 title */
.ld-load__hits {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  padding: 12px 14px 0;
}
.ld-load__hit { display: grid; gap: 2px; min-width: 0; }
.ld-load__hit span { font-size: var(--mk-fs-micro); color: var(--mk-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ld-load__hit strong { font-size: var(--mk-fs-emphasis); font-variant-numeric: tabular-nums; }
.ld-load__hit strong.is-good { color: var(--mk-green); }
.ld-load__hit strong.is-bad { color: var(--mk-red); }

.ld-insights { padding: 12px 16px; display: grid; gap: 8px; }
.ld-insights p { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.7; }
/* 通栏叙述卡：语义分区 + 多栏文本流（栏内行长维持可扫读宽度）；分区不跨栏断开；
   ≤1100px 回退单栏（见窄屏媒体块），≥2000px 升三栏（见 4K 媒体块） */
.ld-insights--cols { display: block; columns: 2; column-gap: 32px; padding-top: 14px; }
.ld-insights__sec { break-inside: avoid; display: grid; gap: 8px; margin-bottom: 14px; }
.ld-insights__sec:last-child { margin-bottom: 0; }
.ld-insights__h { margin: 0 0 2px; font-size: var(--mk-fs-micro); font-weight: 700; letter-spacing: 0.06em; color: var(--mk-ink); opacity: 0.88; }

/* 全局信号与背景（证据页签）：三档分段占比条 + 基础清单（清单式降噪，外部评审采纳项） */
.ld-sigbody { padding: 14px 16px 16px; display: grid; gap: 14px; }
/* 三组常驻（2026-10-11 用户走查：撤堆条与折叠）——组标题沿用分区头语法（细线衬底） */
.ld-sig-sec { display: grid; gap: 8px; }
.ld-sig-sec__h {
  margin: 0;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--mk-line);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--mk-ink);
  opacity: 0.88;
}
/* 信号三档行：色点 + 档名计数 + 概念名连排 */
/* 信号三档：三列并排压缩通栏（2026-10-11 外部评审二轮），窄屏回退单列 */
.ld-sig-tiers { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 18px; }
.ld-sig-tier { margin: 0; display: grid; gap: 3px; font-size: var(--mk-fs-micro); }
.ld-sig-tier__head { display: flex; align-items: center; gap: 6px; }
.ld-sig-tier__dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.ld-sig-tier__dot.is-mastered { background: var(--mk-green); }
.ld-sig-tier__dot.is-struggling { background: var(--mk-amber); }
.ld-sig-tier__dot.is-fragile { background: var(--mk-red); }
.ld-sig-tier strong { font-size: var(--mk-fs-micro); font-variant-numeric: tabular-nums; }
.ld-sig-tier__names { color: var(--mk-muted); line-height: 1.6; min-width: 0; }
/* 反复困惑行（2026-10-11 外部评审二轮）：概念加粗句首、说明降一档灰、频次改右侧轻徽标 */
.ld-fnd--rc .ld-fnd__item { display: flex; align-items: baseline; gap: 10px; }
.ld-fnd__item--warn::before { content: '↻'; color: var(--mk-amber); }
.ld-rc__main { flex: 1; min-width: 0; }
.ld-rc__label { font-weight: 600; color: var(--mk-ink); opacity: 0.9; margin-right: 8px; }
.ld-rc__count {
  flex: none;
  font-style: normal;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-muted);
  background: var(--mk-surface-2);
  border-radius: 6px;
  padding: 1px 7px;
  font-variant-numeric: tabular-nums;
}
.ld-rc__pattern { color: var(--mk-faint); }
/* 长句清单双栏排布（multicol，窄屏回退单栏见媒体块）；行条化：长短句参差时裸文本像文字墙，
   微底行条给出扫读节拍 */
/* 基础清单（2026-10-11 外部评审二轮）：单列大栏 + 行分隔线（不再是双栏碎片/行条小卡）；
   悬挂缩进保留——✓/✕ 绝对定位，换行后文字对齐 27px 基线 */
.ld-fnd { margin: 0; padding: 0; list-style: none; }
.ld-fnd__item {
  position: relative;
  padding: 7px 4px 7px 27px;
  break-inside: avoid;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  line-height: 1.6;
  border-bottom: 1px solid var(--mk-line);
}
.ld-fnd__item:last-child { border-bottom: 0; }
.ld-fnd__item::before { position: absolute; left: 10px; top: 8px; font-weight: 700; }
.ld-fnd__item--ok::before { content: '✓'; color: var(--mk-green); }
.ld-fnd__item--bad::before { content: '✕'; color: var(--mk-red); }

/* 证据时间线：竖线时间轴 + 信号徽章 + 置信度条 + 来源 */
.ld-evidence { display: grid; }
.ld-ev {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px 12px 22px;
  border-bottom: 1px solid var(--mk-line);
}
.ld-ev:last-child { border-bottom: none; }
/* P2 可点下钻（带 sessionId 的行 → 会话座舱）：悬停只换背景/光标，不做位移 */
.ld-ev--link { cursor: pointer; }
.ld-ev--link:hover { background: var(--mk-surface-2); }
.ld-ev--link:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: -2px; }
/* 竖线时间轴：贯穿每行左侧；单条时不显示（避免断裂） */
.ld-ev__rail {
  position: absolute;
  left: 15px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--mk-line); /* 原渐隐渐变已退役（材质一律平面），改 1px 发丝线同源实色 */
}
.ld-ev:first-child .ld-ev__rail { top: 50%; }
.ld-ev:last-child .ld-ev__rail { bottom: 50%; }
.ld-ev:only-child .ld-ev__rail { display: none; }
.ld-evidence:has(.ld-ev:only-child) .ld-ev__rail { display: none; }
/* 信号圆点：压在竖线上 */
.ld-ev__dot {
  position: relative;
  z-index: 1;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 4px;
  box-shadow: 0 0 0 3px var(--mk-surface);
}
.ld-ev__dot.is-ok { background: var(--mk-green); }
.ld-ev__dot.is-warn { background: var(--mk-amber); }
.ld-ev__dot.is-bad { background: var(--mk-red); }
.ld-ev__dot.is-muted { background: var(--mk-muted); }
.ld-ev__main { flex: 1; display: grid; gap: 3px; min-width: 0; }
.ld-ev__top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ld-ev__main strong { font-size: var(--mk-fs-micro); }
.ld-ev__detail { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
/* 信号徽章：与圆点同色的浅底小标 */
.ld-ev__signal {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
}
.ld-ev__signal.is-ok { background: var(--mk-green-bg); color: var(--mk-green); }
.ld-ev__signal.is-warn { background: var(--mk-amber-bg); color: var(--mk-amber); }
.ld-ev__signal.is-bad { background: var(--mk-red-bg); color: var(--mk-red); }
.ld-ev__signal.is-muted { background: var(--mk-surface-2); color: var(--mk-muted); }
/* 证据不足徽章（pill 语气：胶囊琥珀） */
.ld-ev__lack {
  flex-shrink: 0;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-amber);
  background: var(--mk-amber-bg);
  border-radius: 999px;
  padding: 1px 8px;
}
/* 置信度迷你条：绿(≥80%) / 蓝(50-79%) / 琥珀(<50%) */
.ld-ev__conf {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 200px;
  cursor: help;
}
.ld-ev__confbar {
  display: block;
  height: 5px;
  border-radius: var(--mk-radius-pill);
  background: var(--mk-surface-2);
  overflow: hidden;
  position: relative;
}
.ld-ev__confbar::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--mk-radius-pill);
}
.ld-ev__confbar.is-ok::after { background: var(--mk-green); }
.ld-ev__confbar.is-warn::after { background: var(--mk-amber); }
.ld-ev__confbar.is-info::after { background: var(--mk-blue); }
.ld-ev__conf em { font-style: normal; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
/* 来源行：会话/任务短 ID */
.ld-ev__src {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  font-family: var(--mk-mono);
  opacity: 0.85;
}
.ld-ev__time { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); color: var(--mk-faint); white-space: nowrap; margin-top: 3px; }

/* ---------- 证据页两栏布局：左时间线（主） / 右曲线·建议·密度（侧） ---------- */
.ld-ev-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  /* 双栏等高监控窗（2026-10-11 走查，外部评审「左右平齐」采纳）：高度锚定视口
     （页头+hero+页签栏约占 300px），行高锁 minmax(0,1fr)——左时间线与
     右曲线·趋势·密度各自内滚，两侧卡片框永远等高，任一侧内容多寡都不再拖出黑洞。
     4K zoom 档（≥2800→1.15 / ≥3600→1.3）内 100vh 会被 zoom 放大，须 ÷zoom 换算回
     逻辑坐标（与 admin-theme.css 的 .mshell 同一处理），否则卡片底越出视口 */
  grid-template-rows: minmax(0, 1fr);
  height: calc(100vh - 300px);
  min-height: 560px;
  gap: 14px;
}
@media (min-width: 2800px) {
  .ld-ev-grid { height: calc((100vh - 300px) / 1.15); }
}
@media (min-width: 3600px) {
  .ld-ev-grid { height: calc((100vh - 300px) / 1.3); }
}

/* 图谱画布高度（2026-10-11 走查：固定 560px 在 4K 下卡下方留大块空 → 视口锚定；
   zoom 档 ÷zoom 换算同 .ld-ev-grid——壳内 100vh 会被 zoom 等比放大，且页头/hero/
   页签/卡头这些 chrome 同被放大，故常数随 zoom 抬升（4K 实测 420 档溢出 141px）；
   再统一留 ~29px 页底呼吸，与页侧边距同档） */
/* 卡体 padding 由页面自管（mk-card 本体无 padding，mk-card__head 自带 12px 16px）：
   此前漏给 mk-ge 体补边距——统计行/底注/图例 1px 贴卡缘，与卡头 16px 缩进同卡错位
   （4K zoom 放大后尤其扎眼）。横向对齐卡头 16px；画布随体内缩，节点不再顶到卡框。
   下方三档高度常数含这笔 12+14 竖向 padding（466/546/616 = 贴边修正 440/520/590 +26） */
#ld-panel-graph .mk-ge { padding: 12px 16px 14px; }
#ld-panel-graph {
  --ld-graph-h: calc(100vh - 466px);
}
@media (min-width: 2800px) {
  #ld-panel-graph { --ld-graph-h: calc((100vh - 546px) / 1.15); }
}
@media (min-width: 3600px) {
  #ld-panel-graph { --ld-graph-h: calc((100vh - 616px) / 1.3); }
}
.ld-ev-main { min-width: 0; display: flex; flex-direction: column; }
/* 左卡随窗拉伸，时间线在卡内弹性内滚（flex-basis 0 + min-height 0 链路） */
.ld-ev-main .ld-ev-details { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.ld-ev-main .ld-evidence { flex: 1; min-height: 0; overflow-y: auto; }
.ld-ev-side { display: grid; gap: 14px; min-width: 0; align-content: start; min-height: 0; overflow-y: auto; }
/* 滚动条不再局部覆盖（2026-10-11 用户走查：硬编码浅色 thumb 在暗色主题下成亮条）——
   回归 design-system.css 全站规范（8px、主题 token），左侧时间线与右侧栏同规 */
.ld-ev-side { display: grid; gap: 14px; min-width: 0; }

/* ---------- 学习压力曲线（健康度/疲劳度 EWMA，风格对齐用户侧 V2LearningState） ---------- */
.ld-load__controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
/* 分段控件（42/90 天）走 .mk-seg（shared.css） */
.ld-load__body { padding: 12px 14px 14px; display: grid; gap: 10px; }
.ld-load__legend { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.ld-load__dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; margin-right: 5px; }
.ld-load__dot.is-lss { background: var(--mk-blue); }
.ld-load__dot.is-lf { background: var(--mk-red); }
.ld-load__dot.is-lsb { background: var(--mk-green); }
.ld-load__chip { margin-left: auto; font-size: var(--mk-fs-micro); font-weight: 800; padding: 2px 9px; border-radius: 999px; }
.ld-load__info { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; font-size: var(--mk-fs-micro); color: var(--mk-muted); border-top: 1px dashed var(--mk-line); padding-top: 8px; }
.ld-load__info b { color: var(--mk-ink); }
.ld-load__info .is-lss-t { color: var(--mk-blue); font-weight: 700; }
.ld-load__info .is-lf-t { color: var(--mk-red); font-weight: 700; }
.ld-load__info .is-lsb-t { color: var(--mk-green); font-weight: 700; }
.ld-load__zones { display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: var(--mk-fs-micro); color: var(--mk-faint); }

/* ---------- 预测校准（实证命中率 + 校准分布 + 最近预测） ---------- */
.ld-cal { padding: 12px 14px 14px; display: grid; gap: 12px; }
.ld-cal__hits { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ld-cal__hit { display: grid; gap: 2px; padding: 10px 12px; border: 1px solid var(--mk-line); border-radius: var(--mk-radius-xl); background: var(--mk-surface); }
.ld-cal__hit span { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted); }
.ld-cal__hit strong { font-size: var(--mk-fs-20); font-variant-numeric: tabular-nums; }
.ld-cal__hit strong.is-good { color: var(--mk-green); }
.ld-cal__hit strong.is-mid { color: var(--mk-amber); }
.ld-cal__hit strong.is-bad { color: var(--mk-red); }
.ld-cal__hit em { font-style: normal; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.ld-cal__buckets { display: grid; gap: 6px; }
.ld-cal__bucket { display: grid; grid-template-columns: 52px 1fr 72px; align-items: center; gap: 8px; font-size: var(--mk-fs-micro); }
.ld-cal__range { color: var(--mk-faint); font-variant-numeric: tabular-nums; }
/* 校准分布条走 .mk-minibar + data-tone（原为琥珀渐变） */
.ld-cal__val { color: var(--mk-muted); font-variant-numeric: tabular-nums; text-align: right; }
.ld-cal__recent { display: grid; gap: 0; border-top: 1px dashed var(--mk-line); padding-top: 8px; }
.ld-cal__row { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: var(--mk-fs-micro); border-bottom: 1px solid var(--mk-line); }
.ld-cal__row:last-child { border-bottom: none; }
.ld-cal__task { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--mk-ink); font-family: var(--mk-mono); cursor: help; }
.ld-cal__risk { color: var(--mk-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ld-cal__outcome { font-size: var(--mk-fs-micro); font-weight: 700; padding: 1px 7px; border-radius: 999px; white-space: nowrap; }
.ld-cal__outcome.is-smooth { color: var(--mk-green); background: var(--mk-green-bg); }
.ld-cal__outcome.is-hard { color: var(--mk-red); background: var(--mk-red-bg); }
.ld-cal__outcome.is-pending { color: var(--mk-faint); background: var(--mk-surface-2); }

@media (max-width: 1100px) {
  .ld-grid { grid-template-columns: 1fr; }
  .ld-pf-grid { grid-template-columns: 1fr; }
  .ld-pf-sub { grid-template-columns: 1fr; gap: 12px; }
  .ld-pf-sub > div + div { border-left: 0; padding-left: 0; }
  .ld-insights--cols { columns: 1; }
  .ld-sig-tiers { grid-template-columns: 1fr; }
  .ld-load__hits { grid-template-columns: repeat(2, 1fr); }
  .ld-ev-grid { grid-template-columns: 1fr; grid-template-rows: none; height: auto; min-height: 0; }
  .ld-ev-main .ld-evidence { max-height: none; overflow: visible; }
  .ld-ev-side { overflow: visible; }
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  /* 4K 档：三列栅格不变（上排三参数卡 + 叙述通栏）；参数卡内双子栏恢复并排、叙述升三栏 */
  .ld-pf-grid .ld-pf-sub { grid-template-columns: 1fr 1fr; }
  .ld-pf-grid .ld-pf-sub > div + div { border-left: 1px solid var(--mk-line); padding-left: 18px; }
  .ld-insights--cols { columns: 3; }
  .ld-none { font-size: var(--mk-fs-body); }
  .mk-row__sub { font-size: var(--mk-fs-body); }
  .ld-progress strong { font-size: var(--mk-fs-emphasis); }
  .ld-progress__task { font-size: var(--mk-fs-body); }
  .ld-concept-label { font-size: var(--mk-fs-micro); }
  .ld-concept { font-size: var(--mk-fs-body); }
  .ld-bar__head strong { font-size: var(--mk-fs-body); }
  .ld-bar__ev { font-size: var(--mk-fs-micro); }
  .ld-actions p { font-size: var(--mk-fs-body); }
  .ld-actions__k { font-size: var(--mk-fs-micro); }
  .ld-chip { font-size: var(--mk-fs-micro); }
  .ld-session__main strong { font-size: var(--mk-fs-body); }
  .ld-session__main span, .ld-session__time { font-size: var(--mk-fs-micro); }
  .ld-kv__row { font-size: var(--mk-fs-body); }
  .ld-insights p { font-size: var(--mk-fs-body); }
  .ld-ev__main strong { font-size: var(--mk-fs-body); }
  .ld-ev__main span { font-size: var(--mk-fs-micro); }
  .ld-ev__time { font-size: var(--mk-fs-micro); }
  .ld-ev__signal { font-size: var(--mk-fs-micro); }
  .ld-ev__conf em { font-size: var(--mk-fs-micro); }
  .ld-ev__src { font-size: var(--mk-fs-micro); }
  .ld-none { padding: 21px 19px; }
  .ld-none__hint { font-size: var(--mk-fs-micro); }
  .ld-progress { padding: 18px; gap: 9px; }
  .ld-concept { padding: 4px 12px; }
  .ld-bars { padding: 16px 18px 18px; }
  .ld-actions { padding: 16px 18px; }
  .ld-session { padding: 13px 18px; gap: 14px; }
  .ld-session__dot { width: 9px; height: 9px; }
  .ld-kv { --kv-label: 112px; padding: 16px 18px; }
  .ld-insights { padding: 14px 18px; }
  .ld-ev { padding: 12px 18px; gap: 14px; }
  .ld-ev__dot { width: 9px; height: 9px; }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号沿用 2000 档的基础上再升一档，对齐 mk 体系 2800（17px 级） */
  .ld-none { font-size: var(--mk-fs-body); }
  .ld-progress strong { font-size: var(--mk-fs-emphasis); }
  .ld-progress__task { font-size: var(--mk-fs-body); }
  .ld-concept-label { font-size: var(--mk-fs-micro); }
  .ld-concept { font-size: var(--mk-fs-body); }
  .ld-bar__head strong { font-size: var(--mk-fs-body); }
  .ld-bar__ev { font-size: var(--mk-fs-micro); }
  .ld-actions p { font-size: var(--mk-fs-body); }
  .ld-actions__k { font-size: var(--mk-fs-micro); }
  .ld-chip { font-size: var(--mk-fs-micro); }
  .ld-session__main strong { font-size: var(--mk-fs-body); }
  .ld-session__main span, .ld-session__time { font-size: var(--mk-fs-micro); }
  .ld-kv__row { font-size: var(--mk-fs-body); }
  .ld-insights p { font-size: var(--mk-fs-body); }
  .ld-ev__main strong { font-size: var(--mk-fs-body); }
  .ld-ev__main span { font-size: var(--mk-fs-micro); }
  .ld-ev__time { font-size: var(--mk-fs-micro); }
  .ld-ev__signal { font-size: var(--mk-fs-micro); }
  .ld-ev__conf em { font-size: var(--mk-fs-micro); }
  .ld-ev__src { font-size: var(--mk-fs-micro); }
  .ld-none { padding: 25px 22px; }
  .ld-none__hint { font-size: var(--mk-fs-micro); }
  .ld-progress { padding: 21px; gap: 10px; }
  .ld-concept { padding: 4px 14px; }
  .ld-bars { padding: 19px 21px 21px; }
  .ld-actions { padding: 19px 21px; }
  .ld-session { padding: 15px 21px; gap: 16px; }
  .ld-session__dot { width: 11px; height: 11px; }
  .ld-kv { --kv-label: 128px; padding: 18px 21px; }
  .ld-insights { padding: 16px 21px; }
  .ld-ev { padding: 14px 21px; gap: 16px; }
  .ld-ev__dot { width: 11px; height: 11px; }
}
@media (min-width: 3600px) {
  /* zoom 1.3 档：4K 屏幕字号继续放大（≈2800 档的 1.17×，对齐 19-20px 级） */
  .ld-none { font-size: var(--mk-fs-emphasis); }
  .ld-progress strong { font-size: 24px; }
  .ld-progress__task { font-size: var(--mk-fs-emphasis); }
  .ld-concept-label { font-size: var(--mk-fs-body); }
  .ld-concept { font-size: var(--mk-fs-emphasis); }
  .ld-bar__head strong { font-size: var(--mk-fs-emphasis); }
  .ld-bar__ev { font-size: var(--mk-fs-body); }
  .ld-actions p { font-size: var(--mk-fs-emphasis); }
  .ld-actions__k { font-size: var(--mk-fs-body); }
  .ld-chip { font-size: var(--mk-fs-body); }
  .ld-session__main strong { font-size: var(--mk-fs-emphasis); }
  .ld-session__main span, .ld-session__time { font-size: var(--mk-fs-emphasis); }
  .ld-kv__row { font-size: var(--mk-fs-emphasis); }
  .ld-insights p { font-size: var(--mk-fs-emphasis); }
  .ld-ev__main strong { font-size: var(--mk-fs-emphasis); }
  .ld-ev__main span { font-size: var(--mk-fs-emphasis); }
  .ld-ev__time { font-size: var(--mk-fs-body); }
  .ld-ev__signal { font-size: var(--mk-fs-body); }
  .ld-ev__conf em { font-size: var(--mk-fs-body); }
  .ld-ev__src { font-size: var(--mk-fs-body); }
  .ld-none { padding: 29px 26px; }
  .ld-none__hint { font-size: var(--mk-fs-emphasis); }
  .ld-progress { padding: 25px; gap: 12px; }
  .ld-concept { padding: 5px 16px; }
  .ld-bars { padding: 22px 25px 25px; }
  .ld-actions { padding: 22px 25px; }
  .ld-session { padding: 17px 25px; gap: 19px; }
  .ld-session__dot { width: 13px; height: 13px; }
  .ld-kv { --kv-label: 152px; padding: 21px 25px; }
  .ld-insights { padding: 19px 25px; }
  .ld-ev { padding: 16px 25px; gap: 19px; }
  .ld-ev__dot { width: 13px; height: 13px; }
}

/* ================= 暗色模式（D1 补完）：学习者详情 ================= */
html[data-theme='dark'] {
  /* 进度条/概念账本/校准行 深底（行分隔线已走 --mk-line token，随主题自适应，不再需要覆写） */
  .ld-progress__bar,
  .ld-bar__track,
  .ld-bar__ev--zero,
  .ld-cal__bar,
  .ld-cal__outcome.is-pending,
  .ld-ev__signal.is-muted,
  .ld-bar__ev { border-bottom-color: var(--wf-border-light); }
  .ld-bar__ev { background: var(--wf-bg-hover); }
  /* 补漏：操作提示标签/置信条/加载分段（chip/kv 已 token 化） */
  .ld-actions__k { background: color-mix(in srgb, var(--wf-color-primary) 16%, transparent); color: var(--wf-color-primary-light); }
  .ld-ev__confbar { background: var(--wf-bg-hover); }
}
</style>
